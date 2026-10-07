/**
 * Cuentas: usuarios, uso y cuotas, claves de API personales, ajustes con
 * claves propias cifradas, bibliotecas compartidas y auditoría. Vive en D1 en
 * la nube y en un SQLite en local; el código es el mismo sobre el puerto SQL.
 */
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { nuevoId } from '@scholaris/nucleo';
import type {
  AlcanceClave, Ajustes, ClaveApi, ClaveApiCreada, Concesion, CuponAdmin, Cuotas, OrigenConcesion, Plan, Preferencias, ProveedorClave,
  ResumenLote, Usuario,
} from '@scholaris/contrato';
import { cifrar, descifrar, sha256Hex } from './cifrado.js';
import { LIMITES, periodo, type Metrica } from './planes.js';
import { aBase64Url } from './firmas.js';
import { ErrorScholaris, fallo } from './errores.js';
import { huellaCupon, mejorPlan, normalizarCodigoCupon, nuevoCodigoCupon, pistaCupon, rangoPlan } from './cupones.js';

interface FilaConcesion {
  id: string; usuario: string; plan: Plan; origen: OrigenConcesion; cupon: string | null; nota: string | null;
  concedida: string; caduca: string | null; revocada: string | null; por: string | null;
}

interface FilaCupon {
  codigo: string; pista: string; plan: Plan; duracion_dias: number | null; lote: string; nota: string | null; creado: string;
  creado_por: string | null; canjeado_por: string | null; canjeado_en: string | null; revocado: string | null;
}

const aConcesion = (f: FilaConcesion): Concesion => ({
  id: f.id, usuario: f.usuario, plan: f.plan, origen: f.origen, concedida: f.concedida,
  ...(f.cupon ? { cupon: f.cupon } : {}), ...(f.nota ? { nota: f.nota } : {}), ...(f.caduca ? { caduca: f.caduca } : {}), ...(f.revocada ? { revocada: f.revocada } : {}),
});

const NOMBRE_PLAN: Record<Plan, string> = { gratis: 'el plan gratuito', pro: 'Pro' };
/** «Pro de por vida» o «Pro hasta el 6 de octubre de 2027». */
export function describirConcesion(plan: Plan, caduca: string | null | undefined): string {
  if (!caduca) return `${NOMBRE_PLAN[plan]} de por vida`;
  return `${NOMBRE_PLAN[plan]} hasta el ${new Date(caduca).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })}`;
}

/** Intentos fallidos de canjear un cupón que se admiten por cuenta y hora. */
export const INTENTOS_CUPON_HORA = 10;

export const ESQUEMA_CUENTAS = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY, correo TEXT NOT NULL DEFAULT '', nombre TEXT NOT NULL DEFAULT '', imagen TEXT,
    plan TEXT NOT NULL DEFAULT 'gratis', creado TEXT NOT NULL, visto TEXT NOT NULL,
    documentos INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, borrado TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS usuarios_correo ON usuarios(correo)`,
  `CREATE TABLE IF NOT EXISTS uso (
    usuario TEXT NOT NULL, metrica TEXT NOT NULL, periodo TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (usuario, metrica, periodo)
  )`,
  `CREATE TABLE IF NOT EXISTS claves_api (
    id TEXT PRIMARY KEY, usuario TEXT NOT NULL, nombre TEXT NOT NULL, prefijo TEXT NOT NULL, huella TEXT NOT NULL,
    alcances TEXT NOT NULL, creada TEXT NOT NULL, ultimo_uso TEXT, caduca TEXT, revocada TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS claves_usuario ON claves_api(usuario)`,
  `CREATE TABLE IF NOT EXISTS ajustes (
    usuario TEXT PRIMARY KEY, preferencias TEXT NOT NULL DEFAULT '{}', claves TEXT NOT NULL DEFAULT '{}',
    grabacion INTEGER NOT NULL DEFAULT 1, grabacion_desde TEXT, actualizado TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS comparticiones (
    biblioteca TEXT NOT NULL, propietario TEXT NOT NULL, correo TEXT NOT NULL, usuario TEXT,
    permiso TEXT NOT NULL, nombre TEXT, desde TEXT NOT NULL, PRIMARY KEY (biblioteca, correo)
  )`,
  `CREATE INDEX IF NOT EXISTS comparticiones_usuario ON comparticiones(usuario)`,
  `CREATE INDEX IF NOT EXISTS comparticiones_correo ON comparticiones(correo)`,
  `CREATE TABLE IF NOT EXISTS auditoria (
    usuario TEXT NOT NULL, accion TEXT NOT NULL, detalle TEXT, cuando TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auditoria_usuario ON auditoria(usuario, cuando)`,
  // Enlaces de solo lectura (sin cuenta) a una biblioteca o a un documento.
  `CREATE TABLE IF NOT EXISTS enlaces (
    id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, propietario TEXT NOT NULL, biblioteca TEXT, documento TEXT, titulo TEXT NOT NULL,
    clave TEXT, caduca TEXT, creado TEXT NOT NULL, revocado TEXT, visitas INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS enlaces_biblioteca ON enlaces(propietario, biblioteca)`,
  `CREATE TABLE IF NOT EXISTS notificaciones (
    id TEXT PRIMARY KEY, usuario TEXT, correo TEXT, tipo TEXT NOT NULL, texto TEXT NOT NULL, biblioteca TEXT, destino TEXT,
    creada TEXT NOT NULL, leida TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS notificaciones_usuario ON notificaciones(usuario, creada)`,
  `CREATE INDEX IF NOT EXISTS notificaciones_correo ON notificaciones(correo)`,
  // Copias sin duplicar binarios: quién apunta a los ficheros de otro, y los que se
  // quedan en el almacén porque su dueño los borró mientras alguien los usaba.
  `CREATE TABLE IF NOT EXISTS referencias_almacen (
    prefijo TEXT NOT NULL, usuario TEXT NOT NULL, documento TEXT NOT NULL, creada TEXT NOT NULL, PRIMARY KEY (prefijo, usuario, documento)
  )`,
  `CREATE INDEX IF NOT EXISTS referencias_usuario ON referencias_almacen(usuario, documento)`,
  `CREATE TABLE IF NOT EXISTS prefijos_retenidos (prefijo TEXT PRIMARY KEY, propietario TEXT NOT NULL, desde TEXT NOT NULL)`,
  // Planes concedidos sin pasar por la pasarela (a mano o con un cupón). caduca NULL = de por vida.
  `CREATE TABLE IF NOT EXISTS concesiones (
    id TEXT PRIMARY KEY, usuario TEXT NOT NULL, plan TEXT NOT NULL, origen TEXT NOT NULL, cupon TEXT, nota TEXT,
    concedida TEXT NOT NULL, caduca TEXT, revocada TEXT, por TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS concesiones_usuario ON concesiones(usuario, revocada)`,
  // Cupones de un solo uso. codigo = HMAC-SHA-256 del código canónico (nunca en claro); duracion_dias NULL = de por vida.
  `CREATE TABLE IF NOT EXISTS cupones (
    codigo TEXT PRIMARY KEY, pista TEXT NOT NULL, plan TEXT NOT NULL, duracion_dias INTEGER, lote TEXT NOT NULL, nota TEXT,
    creado TEXT NOT NULL, creado_por TEXT, canjeado_por TEXT, canjeado_en TEXT, revocado TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS cupones_lote ON cupones(lote)`,
  `CREATE INDEX IF NOT EXISTS cupones_canjeado ON cupones(canjeado_por)`,
];

/** Columnas que se añadieron después a `comparticiones` (invitaciones con estado, rol, caducidad y mensaje). */
const COLUMNAS_COMPARTICIONES: Array<[string, string]> = [
  ['id', 'TEXT'], ['estado', "TEXT NOT NULL DEFAULT 'aceptada'"], ['token', 'TEXT'], ['mensaje', 'TEXT'], ['caduca', 'TEXT'],
  ['invitador', 'TEXT'], ['respondida', 'TEXT'], ['enlace', 'TEXT'], ['descripcion', 'TEXT'], ['derechos', 'TEXT'],
];

export type PermisoCompartido = 'lectura' | 'edicion' | 'administrador';

export interface FilaComparticion {
  id: string; biblioteca: string; propietario: string; correo: string; usuario: string | null; permiso: PermisoCompartido;
  nombre: string | null; desde: string; estado: 'pendiente' | 'aceptada' | 'rechazada'; token: string | null; mensaje: string | null;
  caduca: string | null; invitador: string | null; respondida: string | null; enlace: string | null; descripcion: string | null; derechos: string | null;
}

export interface FilaEnlace {
  id: string; token: string; propietario: string; biblioteca: string | null; documento: string | null; titulo: string;
  clave: string | null; caduca: string | null; creado: string; revocado: string | null; visitas: number;
}

const azar = (n = 18) => aBase64Url(crypto.getRandomValues(new Uint8Array(n)));

/** Huella de una contraseña de enlace (PBKDF2, 100 000 vueltas: el máximo de Workers). */
export async function huellaClave(clave: string, sal = azar(12)): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(sal), iterations: 100_000 }, base, 256);
  return `pbkdf2$${sal}$${aBase64Url(new Uint8Array(bits))}`;
}

export async function comprobarClave(clave: string, guardada: string): Promise<boolean> {
  const [, sal] = guardada.split('$');
  if (!sal) return false;
  const h = await huellaClave(clave, sal);
  if (h.length !== guardada.length) return false;
  let d = 0;
  for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ guardada.charCodeAt(i);
  return d === 0;
}


export const PREFERENCIAS_POR_DEFECTO: Preferencias = {
  idioma: 'es',
  estiloCita: 'apa',
  idiomaCitas: 'es-ES',
  reordenar: true,
  usarClavesPropias: true,
  tema: 'sistema',
};

export interface AutenticadoClave {
  usuario: string;
  alcances: AlcanceClave[];
  clave: string;
}

const ahora = () => new Date().toISOString();

/**
 * Si el esquema ya se comprobó. Se puede compartir entre instancias que hablan con
 * la misma base: en Cloudflare cada petición crea su `Cuentas`, y sin compartirlo
 * cada una repetía el esquema entero (~30 viajes a D1, unos 700 ms por petición).
 */
export interface EstadoEsquemaCuentas { listo: Promise<void> | null }

/** Una base que sabe mandar varias sentencias sin parámetros en un solo viaje (D1: `batch`). */
interface SqlConLote extends SQL { ejecutarVarias(sentencias: string[]): Promise<void> }
const conLote = (s: SQL): s is SqlConLote => typeof (s as Partial<SqlConLote>).ejecutarVarias === 'function';

export class Cuentas {
  private readonly esquema: EstadoEsquemaCuentas;

  constructor(private readonly sql: SQL, private readonly claveMaestra: string, esquema?: EstadoEsquemaCuentas) {
    this.esquema = esquema ?? { listo: null };
  }

  /** Crea las tablas si faltan (una vez por instancia, o por aislamiento si se comparte el estado). */
  preparar(): Promise<void> {
    const estado = this.esquema;
    estado.listo ??= (async () => {
      if (conLote(this.sql)) await this.sql.ejecutarVarias(ESQUEMA_CUENTAS);
      else for (const s of ESQUEMA_CUENTAS) await this.sql.ejecutar(s);
      // Columnas nuevas de las invitaciones: solo las que falten (una consulta en frío).
      const hay = new Set((await this.sql.ejecutar<{ name: string }>('PRAGMA table_info(comparticiones)')).map((f) => f.name));
      for (const [c, tipo] of COLUMNAS_COMPARTICIONES) {
        if (hay.has(c)) continue;
        try { await this.sql.ejecutar(`ALTER TABLE comparticiones ADD COLUMN ${c} ${tipo}`); } catch (e) {
          if (!/duplicate column/i.test((e as Error).message)) throw e;
        }
      }
      if (!hay.has('id')) await this.sql.ejecutar("UPDATE comparticiones SET id = 'i' || lower(hex(randomblob(8))) WHERE id IS NULL");
      await this.sql.ejecutar('CREATE UNIQUE INDEX IF NOT EXISTS comparticiones_id ON comparticiones(id)');
      await this.sql.ejecutar('CREATE INDEX IF NOT EXISTS comparticiones_token ON comparticiones(token)');
    })();
    const listo = estado.listo;
    listo.catch(() => { if (estado.listo === listo) estado.listo = null; });
    return listo;
  }

  private async q<T = Record<string, ValorSQL>>(consulta: string, ...p: ValorSQL[]): Promise<T[]> {
    await this.preparar();
    return this.sql.ejecutar<T>(consulta, ...p);
  }

  // -------------------------------------------------------------------------
  // Usuarios
  // -------------------------------------------------------------------------

  async asegurarUsuario(u: Usuario & { plan: Plan }): Promise<void> {
    const t = ahora();
    await this.q(
      `INSERT INTO usuarios (id, correo, nombre, imagen, plan, creado, visto) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         correo = CASE WHEN excluded.correo <> '' THEN excluded.correo ELSE usuarios.correo END,
         nombre = CASE WHEN excluded.nombre <> '' THEN excluded.nombre ELSE usuarios.nombre END,
         imagen = COALESCE(excluded.imagen, usuarios.imagen), plan = excluded.plan, visto = excluded.visto, borrado = NULL`,
      u.id, u.correo, u.nombre, u.imagen ?? null, u.plan, t, t,
    );
    // Invitaciones pendientes por correo: quedan enlazadas al usuario.
    if (u.correo) await this.q('UPDATE comparticiones SET usuario = ? WHERE usuario IS NULL AND correo = ?', u.id, u.correo.toLowerCase());
  }

  /**
   * La cuenta con su plan EFECTIVO: el mejor entre el guardado (el del token de
   * Clerk en el último acceso) y el de la concesión vigente.
   */
  async usuario(id: string): Promise<(Usuario & { plan: Plan; concesion?: Concesion }) | null> {
    const [f] = await this.q<{ id: string; correo: string; nombre: string; imagen: string | null; plan: Plan }>('SELECT id, correo, nombre, imagen, plan FROM usuarios WHERE id = ?', id);
    if (!f) return null;
    const c = await this.concesionVigente(id);
    return {
      id: f.id, correo: f.correo, nombre: f.nombre, imagen: f.imagen ?? undefined, plan: mejorPlan(f.plan, c?.plan),
      ...(c ? { concesion: c } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Concesiones de plan y cupones
  // -------------------------------------------------------------------------

  /** La mejor concesión vigente (mejor plan; a igualdad, la de por vida o la que dura más). */
  async concesionVigente(usuario: string): Promise<Concesion | null> {
    const [f] = await this.q<FilaConcesion>(
      `SELECT * FROM concesiones WHERE usuario = ? AND revocada IS NULL AND (caduca IS NULL OR caduca > ?)
       ORDER BY CASE plan WHEN 'pro' THEN 1 ELSE 0 END DESC, (caduca IS NULL) DESC, caduca DESC LIMIT 1`, usuario, ahora());
    return f ? aConcesion(f) : null;
  }

  async concesiones(usuario?: string): Promise<Concesion[]> {
    const filas = usuario
      ? await this.q<FilaConcesion>('SELECT * FROM concesiones WHERE usuario = ? ORDER BY concedida DESC', usuario)
      : await this.q<FilaConcesion>('SELECT * FROM concesiones ORDER BY concedida DESC LIMIT 500');
    return filas.map(aConcesion);
  }

  /** Concede un plan (a mano o por un cupón). No toca el plan del token: el efectivo es el mejor de los dos. */
  async conceder(c: { usuario: string; plan: Plan; origen: OrigenConcesion; dias?: number | null; nota?: string | null; cupon?: string | null; por: string; caduca?: string | null }): Promise<Concesion> {
    const id = nuevoId('c');
    const caduca = c.caduca !== undefined ? c.caduca : c.dias ? new Date(Date.now() + c.dias * 86400_000).toISOString() : null;
    await this.q('INSERT INTO concesiones (id, usuario, plan, origen, cupon, nota, concedida, caduca, por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, c.usuario, c.plan, c.origen, c.cupon ?? null, c.nota ?? null, ahora(), caduca, c.por);
    await this.auditar(c.usuario, 'plan_concedido', { id, plan: c.plan, origen: c.origen, caduca, por: c.por, ...(c.cupon ? { cupon: c.cupon } : {}) });
    if (c.por !== c.usuario) await this.auditar(c.por, 'admin_concede', { id, usuario: c.usuario, plan: c.plan, caduca });
    return aConcesion((await this.q<FilaConcesion>('SELECT * FROM concesiones WHERE id = ?', id))[0]!);
  }

  /** Revoca una concesión. Devuelve el usuario afectado (para invalidar su caché) o null. */
  async revocarConcesion(id: string, por: string): Promise<string | null> {
    const [f] = await this.q<{ usuario: string }>('UPDATE concesiones SET revocada = ? WHERE id = ? AND revocada IS NULL RETURNING usuario', ahora(), id);
    if (!f) return null;
    await this.auditar(f.usuario, 'plan_revocado', { id, por });
    return f.usuario;
  }

  /** Crea un lote de cupones y devuelve los códigos en claro (la única vez que existen fuera de quien los reparte). */
  async crearCupones(o: { cantidad: number; plan: Plan; dias: number | null; lote: string; nota: string | null; por: string }): Promise<string[]> {
    const [hay] = await this.q<{ n: number }>('SELECT COUNT(*) AS n FROM cupones WHERE lote = ?', o.lote);
    if (hay?.n) fallo('conflicto', `Ya hay un lote que se llama «${o.lote}». Elige otro nombre.`);
    const creado = ahora();
    const codigos: string[] = [];
    while (codigos.length < o.cantidad) {
      const tanda = Array.from({ length: Math.min(10, o.cantidad - codigos.length) }, nuevoCodigoCupon);
      const filas: ValorSQL[] = [];
      for (const codigo of tanda) filas.push(await huellaCupon(this.claveMaestra, codigo), pistaCupon(codigo), o.plan, o.dias, o.lote, o.nota, creado, o.por);
      // Una colisión (improbabilísima) simplemente no se inserta y el bucle genera otro.
      const metidas = new Set((await this.q<{ codigo: string }>(
        `INSERT INTO cupones (codigo, pista, plan, duracion_dias, lote, nota, creado, creado_por) VALUES ${tanda.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
         ON CONFLICT(codigo) DO NOTHING RETURNING codigo`, ...filas)).map((f) => f.codigo));
      for (let i = 0; i < tanda.length; i++) if (metidas.has(filas[i * 8] as string)) codigos.push(tanda[i]!);
    }
    await this.auditar(o.por, 'cupones_creados', { lote: o.lote, cantidad: o.cantidad, plan: o.plan, dias: o.dias });
    return codigos;
  }

  async lotesCupones(): Promise<ResumenLote[]> {
    const filas = await this.q<{ lote: string; plan: Plan; dias: number | null; nota: string | null; creado: string; total: number; canjeados: number; revocados: number }>(
      `SELECT lote, MAX(plan) AS plan, MAX(duracion_dias) AS dias, MAX(nota) AS nota, MIN(creado) AS creado, COUNT(*) AS total,
         SUM(CASE WHEN canjeado_por IS NOT NULL THEN 1 ELSE 0 END) AS canjeados, SUM(CASE WHEN revocado IS NOT NULL THEN 1 ELSE 0 END) AS revocados
       FROM cupones GROUP BY lote ORDER BY MIN(creado) DESC`);
    return filas.map((f) => ({ lote: f.lote, plan: f.plan, dias: f.dias ?? null, ...(f.nota ? { nota: f.nota } : {}), creado: f.creado, total: f.total, canjeados: f.canjeados, revocados: f.revocados }));
  }

  async cuponesDeLote(lote: string): Promise<CuponAdmin[]> {
    const filas = await this.q<FilaCupon>('SELECT * FROM cupones WHERE lote = ? ORDER BY canjeado_en DESC, pista', lote);
    return filas.map((f) => ({
      huella: f.codigo, pista: f.pista, lote: f.lote, plan: f.plan, dias: f.duracion_dias ?? null, creado: f.creado,
      ...(f.nota ? { nota: f.nota } : {}), ...(f.canjeado_por ? { canjeadoPor: f.canjeado_por } : {}),
      ...(f.canjeado_en ? { canjeadoEn: f.canjeado_en } : {}), ...(f.revocado ? { revocado: f.revocado } : {}),
    }));
  }

  /** Anula cupones sin canjear (por código, por huella o un lote entero). Los ya canjeados no se tocan. */
  async revocarCupones(o: { codigos?: string[]; huellas?: string[]; lote?: string; por: string }): Promise<number> {
    const huellas = [...(o.huellas ?? []).filter((h) => /^[a-f0-9]{64}$/.test(h))];
    for (const c of o.codigos ?? []) {
      const n = normalizarCodigoCupon(c);
      if (n) huellas.push(await huellaCupon(this.claveMaestra, n));
    }
    let n = 0;
    if (huellas.length) {
      n += (await this.q('UPDATE cupones SET revocado = ? WHERE codigo IN (SELECT value FROM json_each(?)) AND revocado IS NULL AND canjeado_por IS NULL RETURNING codigo',
        ahora(), JSON.stringify(huellas))).length;
    }
    if (o.lote) n += (await this.q('UPDATE cupones SET revocado = ? WHERE lote = ? AND revocado IS NULL AND canjeado_por IS NULL RETURNING codigo', ahora(), o.lote)).length;
    if (n) await this.auditar(o.por, 'cupones_revocados', { n, lote: o.lote, huellas: huellas.length });
    return n;
  }

  /**
   * Canjea un cupón. El reparto es atómico: el UPDATE solo se lleva la fila si
   * sigue libre y sin anular (RETURNING dice si fue esta petición). Nunca
   * rebaja ni gasta un cupón que no daría nada: si ya hay una concesión igual o
   * mejor que dura lo mismo o más, se rechaza y el cupón sigue libre.
   */
  async canjearCupon(usuario: string, bruto: string): Promise<Concesion> {
    const desde = new Date(Date.now() - 3600_000).toISOString();
    const [fallos] = await this.q<{ n: number }>("SELECT COUNT(*) AS n FROM auditoria WHERE usuario = ? AND accion = 'cupon_fallido' AND cuando > ?", usuario, desde);
    if ((fallos?.n ?? 0) >= INTENTOS_CUPON_HORA) {
      throw new ErrorScholaris('limite_de_ritmo', 'Demasiados intentos con cupones que no valen. Espera una hora y vuelve a probar.', { reintentar: 3600 });
    }
    const fallido = async (codigo: Parameters<typeof fallo>[0], mensaje: string): Promise<never> => {
      await this.auditar(usuario, 'cupon_fallido', { motivo: codigo });
      fallo(codigo, mensaje);
    };
    const codigo = normalizarCodigoCupon(bruto);
    if (!codigo) return fallido('peticion_invalida', 'Eso no parece un cupón de Scholaris. Tiene la forma SCHO-XXXX-XXXX.');
    const huella = await huellaCupon(this.claveMaestra, codigo);
    const [cupon] = await this.q<FilaCupon>('SELECT * FROM cupones WHERE codigo = ?', huella);
    if (!cupon) return fallido('no_encontrado', 'Ese cupón no existe. Comprueba que esté bien copiado.');
    const explicar = (f: FilaCupon): never => {
      if (f.canjeado_por === usuario) fallo('conflicto', 'Ya canjeaste este cupón: el plan está en tu cuenta.');
      if (f.canjeado_por) fallo('conflicto', 'Este cupón ya se ha canjeado y solo vale una vez.');
      fallo('conflicto', 'Este cupón se ha anulado y ya no se puede canjear.');
    };
    if (cupon.canjeado_por || cupon.revocado) {
      await this.auditar(usuario, 'cupon_fallido', { motivo: cupon.revocado ? 'anulado' : 'usado', pista: cupon.pista });
      explicar(cupon);
    }
    // Nunca rebajar ni malgastar: ¿la concesión que ya tiene da lo mismo o más?
    // (Un plan temporal sobre otro temporal del mismo plan sí suma: se alarga.)
    const actual = await this.concesionVigente(usuario);
    if (actual && (rangoPlan(actual.plan) > rangoPlan(cupon.plan) || (actual.plan === cupon.plan && !actual.caduca))) {
      fallo('conflicto', `Ya tienes ${describirConcesion(actual.plan, actual.caduca)}: este cupón no te daría nada más. Guárdalo para otra persona.`);
    }
    const t = ahora();
    const [mio] = await this.q<{ plan: Plan; duracion_dias: number | null }>(
      'UPDATE cupones SET canjeado_por = ?, canjeado_en = ? WHERE codigo = ? AND canjeado_por IS NULL AND revocado IS NULL RETURNING plan, duracion_dias',
      usuario, t, huella);
    if (!mio) {
      // Otra petición se lo ha llevado entre la lectura y el UPDATE.
      const [ahoraEs] = await this.q<FilaCupon>('SELECT * FROM cupones WHERE codigo = ?', huella);
      return explicar(ahoraEs ?? { ...cupon, canjeado_por: 'otro' });
    }
    // Un plan temporal se suma a lo que quede de otra concesión temporal del mismo plan.
    let caduca: string | null = null;
    if (mio.duracion_dias) {
      const base = actual && actual.plan === mio.plan && actual.caduca ? Math.max(Date.now(), Date.parse(actual.caduca)) : Date.now();
      caduca = new Date(base + mio.duracion_dias * 86400_000).toISOString();
    }
    try {
      const c = await this.conceder({ usuario, plan: mio.plan, origen: 'cupon', cupon: cupon.pista, nota: cupon.nota, caduca, por: usuario });
      await this.auditar(usuario, 'cupon_canjeado', { pista: cupon.pista, lote: cupon.lote, plan: mio.plan, caduca });
      return c;
    } catch (e) {
      // Sin concesión, el cupón vuelve a quedar libre.
      await this.q('UPDATE cupones SET canjeado_por = NULL, canjeado_en = NULL WHERE codigo = ? AND canjeado_por = ?', huella, usuario).catch(() => undefined);
      throw e;
    }
  }

  async usuarioPorCorreo(correo: string): Promise<string | null> {
    const [f] = await this.q<{ id: string }>('SELECT id FROM usuarios WHERE correo = ? AND borrado IS NULL', correo.toLowerCase());
    return f?.id ?? null;
  }

  /** Usuarios activos (para los vigilantes programados). */
  async usuariosActivos(desdeDias = 60): Promise<string[]> {
    const desde = new Date(Date.now() - desdeDias * 86400_000).toISOString();
    return (await this.q<{ id: string }>('SELECT id FROM usuarios WHERE visto >= ? AND borrado IS NULL', desde)).map((f) => f.id);
  }

  async totales(usuario: string, documentos: number, bytes: number): Promise<void> {
    await this.q('UPDATE usuarios SET documentos = ?, bytes = ? WHERE id = ?', documentos, bytes, usuario);
  }

  async borrarUsuario(usuario: string): Promise<void> {
    await this.q("UPDATE usuarios SET borrado = ?, correo = '', nombre = '' WHERE id = ?", ahora(), usuario);
    await this.q('DELETE FROM claves_api WHERE usuario = ?', usuario);
    await this.q('DELETE FROM ajustes WHERE usuario = ?', usuario);
    await this.q('DELETE FROM uso WHERE usuario = ?', usuario);
    await this.q('DELETE FROM comparticiones WHERE propietario = ? OR usuario = ?', usuario, usuario);
    await this.q('UPDATE enlaces SET revocado = ? WHERE propietario = ? AND revocado IS NULL', ahora(), usuario);
    await this.q('DELETE FROM notificaciones WHERE usuario = ?', usuario);
  }

  // -------------------------------------------------------------------------
  // Uso y cuotas
  // -------------------------------------------------------------------------

  async cuotas(usuario: string, plan: Plan | 'local'): Promise<Cuotas> {
    const l = LIMITES[plan];
    const [u] = await this.q<{ documentos: number; bytes: number }>('SELECT documentos, bytes FROM usuarios WHERE id = ?', usuario);
    const usado = async (m: Metrica) => (await this.q<{ n: number }>('SELECT n FROM uso WHERE usuario = ? AND metrica = ? AND periodo = ?', usuario, m, periodo(m)))[0]?.n ?? 0;
    return {
      documentos: { usados: u?.documentos ?? 0, limite: l.documentos },
      bytes: { usados: u?.bytes ?? 0, limite: l.bytes },
      paginasMes: { usados: await usado('paginasMes'), limite: l.paginasMes },
      busquedasDia: { usados: await usado('busquedasDia'), limite: l.busquedasDia },
      autocitasMes: { usados: await usado('autocitasMes'), limite: l.autocitasMes },
    };
  }

  /**
   * Consume `n` unidades de una métrica si caben en el límite. Atómico: la
   * condición va en el propio UPDATE. Devuelve false si se superaría.
   */
  async consumir(usuario: string, plan: Plan | 'local', m: Metrica, n = 1): Promise<boolean> {
    const limite = LIMITES[plan][m];
    const p = periodo(m);
    await this.q('INSERT INTO uso (usuario, metrica, periodo, n) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING', usuario, m, p);
    if (limite === null) {
      await this.q('UPDATE uso SET n = n + ? WHERE usuario = ? AND metrica = ? AND periodo = ?', n, usuario, m, p);
      return true;
    }
    const filas = await this.q<{ n: number }>('UPDATE uso SET n = n + ? WHERE usuario = ? AND metrica = ? AND periodo = ? AND n + ? <= ? RETURNING n', n, usuario, m, p, n, limite);
    return filas.length > 0;
  }

  async devolver(usuario: string, m: Metrica, n: number): Promise<void> {
    await this.q('UPDATE uso SET n = MAX(0, n - ?) WHERE usuario = ? AND metrica = ? AND periodo = ?', n, usuario, m, periodo(m));
  }

  // -------------------------------------------------------------------------
  // Claves de API personales: «sch_<id>_<secreto>»; se guarda solo la huella.
  // -------------------------------------------------------------------------

  async crearClave(usuario: string, nombre: string, alcances: AlcanceClave[], dias?: number): Promise<ClaveApiCreada> {
    const id = nuevoId('k');
    const secreto = `sch_${id}_${aBase64Url(crypto.getRandomValues(new Uint8Array(24)))}`;
    const creada = ahora();
    const caduca = dias ? new Date(Date.now() + dias * 86400_000).toISOString() : null;
    const prefijo = `${secreto.slice(0, 12)}…`;
    await this.q('INSERT INTO claves_api (id, usuario, nombre, prefijo, huella, alcances, creada, caduca) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, usuario, nombre, prefijo, await sha256Hex(secreto), JSON.stringify(alcances), creada, caduca);
    await this.auditar(usuario, 'clave_creada', { id, nombre });
    return { id, nombre, prefijo, alcances, creada, caduca: caduca ?? undefined, secreto };
  }

  async listarClaves(usuario: string): Promise<ClaveApi[]> {
    const filas = await this.q<Record<string, string | null>>('SELECT * FROM claves_api WHERE usuario = ? ORDER BY creada DESC', usuario);
    return filas.map((f) => ({
      id: f.id!, nombre: f.nombre!, prefijo: f.prefijo!, alcances: JSON.parse(f.alcances!) as AlcanceClave[], creada: f.creada!,
      ultimoUso: f.ultimo_uso ?? undefined, caduca: f.caduca ?? undefined, revocada: f.revocada ?? undefined,
    }));
  }

  async revocarClave(usuario: string, id: string): Promise<boolean> {
    const r = await this.q('UPDATE claves_api SET revocada = ? WHERE id = ? AND usuario = ? AND revocada IS NULL RETURNING id', ahora(), id, usuario);
    if (r.length) await this.auditar(usuario, 'clave_revocada', { id });
    return r.length > 0;
  }

  async autenticarClave(secreto: string): Promise<AutenticadoClave | null> {
    const m = /^sch_(k[a-z0-9]+)_[A-Za-z0-9_-]+$/.exec(secreto);
    if (!m) return null;
    const [f] = await this.q<Record<string, string | null>>('SELECT * FROM claves_api WHERE id = ?', m[1]!);
    if (!f || f.revocada || (f.caduca && f.caduca < ahora())) return null;
    if (f.huella !== (await sha256Hex(secreto))) return null;
    // El último uso se apunta como mucho una vez por hora.
    if (!f.ultimo_uso || Date.now() - Date.parse(f.ultimo_uso) > 3600_000) await this.q('UPDATE claves_api SET ultimo_uso = ? WHERE id = ?', ahora(), f.id!);
    return { usuario: f.usuario!, alcances: JSON.parse(f.alcances!) as AlcanceClave[], clave: f.id! };
  }

  // -------------------------------------------------------------------------
  // Ajustes y claves propias
  // -------------------------------------------------------------------------

  private async filaAjustes(usuario: string) {
    const [f] = await this.q<{ preferencias: string; claves: string; grabacion: number; grabacion_desde: string | null }>('SELECT preferencias, claves, grabacion, grabacion_desde FROM ajustes WHERE usuario = ?', usuario);
    return {
      preferencias: { ...PREFERENCIAS_POR_DEFECTO, ...(f ? (JSON.parse(f.preferencias) as Partial<Preferencias>) : {}) },
      claves: f ? (JSON.parse(f.claves) as Record<string, { cifrada: string; final: string; guardada: string }>) : {},
      grabacion: f ? f.grabacion === 1 : true,
      grabacionDesde: f?.grabacion_desde ?? undefined,
    };
  }

  private async guardarFila(usuario: string, cambios: { preferencias?: Preferencias; claves?: Record<string, unknown>; grabacion?: boolean }) {
    const a = await this.filaAjustes(usuario);
    await this.q(
      `INSERT INTO ajustes (usuario, preferencias, claves, grabacion, grabacion_desde, actualizado) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(usuario) DO UPDATE SET preferencias = excluded.preferencias, claves = excluded.claves, grabacion = excluded.grabacion,
         grabacion_desde = excluded.grabacion_desde, actualizado = excluded.actualizado`,
      usuario,
      JSON.stringify(cambios.preferencias ?? a.preferencias),
      JSON.stringify(cambios.claves ?? a.claves),
      (cambios.grabacion ?? a.grabacion) ? 1 : 0,
      cambios.grabacion !== undefined && cambios.grabacion !== a.grabacion ? ahora() : a.grabacionDesde ?? null,
      ahora(),
    );
  }

  async ajustes(usuario: string): Promise<Ajustes> {
    const a = await this.filaAjustes(usuario);
    return {
      preferencias: a.preferencias,
      claves: Object.entries(a.claves).map(([proveedor, v]) => ({ proveedor: proveedor as ProveedorClave, final: v.final, guardada: v.guardada })),
    };
  }

  async preferencias(usuario: string, p: Partial<Preferencias>): Promise<Ajustes> {
    const a = await this.filaAjustes(usuario);
    const limpio = Object.fromEntries(Object.entries(p).filter(([k]) => k in PREFERENCIAS_POR_DEFECTO));
    await this.guardarFila(usuario, { preferencias: { ...a.preferencias, ...limpio } as Preferencias });
    return this.ajustes(usuario);
  }

  async guardarClaveProveedor(usuario: string, proveedor: ProveedorClave, clave: string): Promise<Ajustes> {
    const a = await this.filaAjustes(usuario);
    a.claves[proveedor] = { cifrada: await cifrar(this.claveMaestra, usuario, clave), final: clave.slice(-4), guardada: ahora() };
    await this.guardarFila(usuario, { claves: a.claves });
    await this.auditar(usuario, 'byok_guardada', { proveedor });
    return this.ajustes(usuario);
  }

  async borrarClaveProveedor(usuario: string, proveedor: ProveedorClave): Promise<Ajustes> {
    const a = await this.filaAjustes(usuario);
    delete a.claves[proveedor];
    await this.guardarFila(usuario, { claves: a.claves });
    return this.ajustes(usuario);
  }

  /** Claves propias descifradas (solo para montar la inteligencia del usuario). */
  async clavesPropias(usuario: string): Promise<Partial<Record<ProveedorClave, string>>> {
    const a = await this.filaAjustes(usuario);
    if (!a.preferencias.usarClavesPropias) return {};
    const salida: Partial<Record<ProveedorClave, string>> = {};
    for (const [p, v] of Object.entries(a.claves)) {
      try { salida[p as ProveedorClave] = await descifrar(this.claveMaestra, usuario, v.cifrada); } catch { /* clave maestra rotada */ }
    }
    return salida;
  }

  async grabacion(usuario: string): Promise<{ activa: boolean; desde?: string }> {
    const a = await this.filaAjustes(usuario);
    return { activa: a.grabacion, desde: a.grabacionDesde };
  }

  async cambiarGrabacion(usuario: string, activa: boolean): Promise<{ activa: boolean; desde?: string }> {
    await this.guardarFila(usuario, { grabacion: activa });
    return this.grabacion(usuario);
  }

  // -------------------------------------------------------------------------
  // Bibliotecas compartidas: invitaciones, miembros y quien las sigue
  // -------------------------------------------------------------------------

  /** Condición SQL (alias `c`) de una compartición que da acceso ahora mismo. */
  private static readonly VIGENTE = `c.estado = 'aceptada' AND (c.caduca IS NULL OR c.caduca > ?)
    AND (c.enlace IS NULL OR EXISTS (SELECT 1 FROM enlaces e WHERE e.id = c.enlace AND e.revocado IS NULL AND (e.caduca IS NULL OR e.caduca > ?)))`;

  /**
   * Invita por correo. Si ya había invitación, se actualiza (permiso, mensaje,
   * caducidad); una rechazada vuelve a quedar pendiente. Quien ya aceptó solo
   * cambia de permiso.
   */
  async invitar(i: {
    biblioteca: string; propietario: string; invitador: string; nombre: string; descripcion?: string | null; derechos?: string | null;
    correo: string; permiso: PermisoCompartido; mensaje?: string | null; caducaDias?: number | null;
  }): Promise<FilaComparticion> {
    const correo = i.correo.trim().toLowerCase();
    const usuario = await this.usuarioPorCorreo(correo);
    const caduca = i.caducaDias ? new Date(Date.now() + i.caducaDias * 86400_000).toISOString() : null;
    await this.q(
      `INSERT INTO comparticiones (id, biblioteca, propietario, correo, usuario, permiso, nombre, desde, estado, token, mensaje, caduca, invitador, descripcion, derechos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(biblioteca, correo) DO UPDATE SET permiso = excluded.permiso, nombre = excluded.nombre, mensaje = excluded.mensaje,
         caduca = excluded.caduca, invitador = excluded.invitador, descripcion = excluded.descripcion, derechos = excluded.derechos,
         usuario = COALESCE(comparticiones.usuario, excluded.usuario), enlace = NULL,
         estado = CASE WHEN comparticiones.estado = 'rechazada' THEN 'pendiente' ELSE comparticiones.estado END,
         token = COALESCE(comparticiones.token, excluded.token)`,
      `i${azar(9).toLowerCase().replace(/[^a-z0-9]/g, '')}`, i.biblioteca, i.propietario, correo, usuario, i.permiso, i.nombre, ahora(),
      azar(24), i.mensaje ?? null, caduca, i.invitador, i.descripcion ?? null, i.derechos ?? null,
    );
    await this.auditar(i.invitador, 'biblioteca_compartida', { biblioteca: i.biblioteca, correo, permiso: i.permiso });
    const fila = (await this.q<FilaComparticion>('SELECT * FROM comparticiones WHERE biblioteca = ? AND correo = ?', i.biblioteca, correo))[0]!;
    if (fila.estado === 'pendiente') {
      const quien = (await this.usuario(i.invitador))?.nombre || 'Alguien';
      await this.notificar({ usuario, correo, tipo: 'invitacion', texto: `${quien} te invita a ${i.permiso === 'lectura' ? 'leer' : 'trabajar en'} «${i.nombre}».`, biblioteca: i.biblioteca, destino: '/invitaciones' });
    }
    return fila;
  }

  /** Compatibilidad: invitar con lo mínimo. */
  async compartir(biblioteca: string, propietario: string, nombre: string, correo: string, permiso: PermisoCompartido) {
    const f = await this.invitar({ biblioteca, propietario, invitador: propietario, nombre, correo, permiso });
    return { usuario: f.usuario ?? undefined, correo: f.correo, permiso: f.permiso, pendiente: f.estado !== 'aceptada', desde: f.desde };
  }

  async miembros(biblioteca: string) {
    return (await this.q<FilaComparticion & { unombre: string | null }>(
      `SELECT c.*, u.nombre AS unombre FROM comparticiones c LEFT JOIN usuarios u ON u.id = c.usuario
       WHERE c.biblioteca = ? AND c.estado <> 'rechazada' AND c.enlace IS NULL ORDER BY c.desde`, biblioteca,
    )).map((f) => ({
      usuario: f.usuario ?? undefined, correo: f.correo, nombre: f.unombre || undefined, permiso: f.permiso, pendiente: f.estado !== 'aceptada',
      estado: f.estado, invitacion: f.id, token: f.token ?? undefined, caduca: f.caduca ?? undefined, desde: f.desde,
    }));
  }

  /** Cuántos tienen acceso o invitación (para el distintivo «compartida»). */
  async cuantosMiembros(bibliotecas: string[]): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    if (!bibliotecas.length) return m;
    const filas = await this.q<{ biblioteca: string; n: number }>(
      "SELECT biblioteca, COUNT(*) AS n FROM comparticiones WHERE biblioteca IN (SELECT value FROM json_each(?)) AND estado <> 'rechazada' GROUP BY biblioteca",
      JSON.stringify(bibliotecas));
    for (const f of filas) m.set(f.biblioteca, f.n);
    return m;
  }

  async cambiarPermiso(biblioteca: string, propietario: string, quien: string, permiso: PermisoCompartido): Promise<boolean> {
    const r = await this.q('UPDATE comparticiones SET permiso = ? WHERE biblioteca = ? AND propietario = ? AND (usuario = ? OR correo = ?) RETURNING id',
      permiso, biblioteca, propietario, quien, quien.toLowerCase());
    return r.length > 0;
  }

  /** Revoca el acceso (o la invitación pendiente) de un usuario o un correo. */
  async dejarDeCompartir(biblioteca: string, propietario: string, usuarioOCorreo: string): Promise<void> {
    const filas = await this.q<FilaComparticion>('DELETE FROM comparticiones WHERE biblioteca = ? AND propietario = ? AND (usuario = ? OR correo = ?) RETURNING *',
      biblioteca, propietario, usuarioOCorreo, usuarioOCorreo.toLowerCase());
    for (const f of filas) {
      if (f.estado === 'aceptada' && f.usuario) await this.notificar({ usuario: f.usuario, tipo: 'acceso_retirado', texto: `Ya no tienes acceso a «${f.nombre ?? 'una biblioteca compartida'}».`, biblioteca });
    }
  }

  async borrarComparticiones(biblioteca: string): Promise<void> {
    await this.q('DELETE FROM comparticiones WHERE biblioteca = ?', biblioteca);
    await this.q('UPDATE enlaces SET revocado = ? WHERE biblioteca = ? AND revocado IS NULL', ahora(), biblioteca);
  }

  /** Cambia el nombre, la descripción o los derechos que ven los invitados. */
  async actualizarDatosBiblioteca(biblioteca: string, d: { nombre?: string | null; descripcion?: string | null; derechos?: string | null }): Promise<void> {
    await this.q('UPDATE comparticiones SET nombre = COALESCE(?, nombre), descripcion = COALESCE(?, descripcion), derechos = COALESCE(?, derechos) WHERE biblioteca = ?',
      d.nombre ?? null, d.descripcion ?? null, d.derechos ?? null, biblioteca);
  }

  /** Invitaciones que me esperan (por mi usuario o por mi correo). */
  async invitacionesPara(usuario: string, correo: string) {
    const t = ahora();
    return this.q<FilaComparticion & { pnombre: string | null; pcorreo: string | null; inombre: string | null }>(
      `SELECT c.*, p.nombre AS pnombre, p.correo AS pcorreo, i.nombre AS inombre FROM comparticiones c
       LEFT JOIN usuarios p ON p.id = c.propietario LEFT JOIN usuarios i ON i.id = c.invitador
       WHERE c.estado = 'pendiente' AND (c.caduca IS NULL OR c.caduca > ?) AND (c.usuario = ? OR (c.usuario IS NULL AND c.correo = ?))
       ORDER BY c.desde DESC`, t, usuario, correo.toLowerCase());
  }

  /** Una invitación por su id o por el token del enlace del correo. */
  async invitacion(idOToken: string) {
    const [f] = await this.q<FilaComparticion & { pnombre: string | null; pcorreo: string | null; inombre: string | null }>(
      `SELECT c.*, p.nombre AS pnombre, p.correo AS pcorreo, i.nombre AS inombre FROM comparticiones c
       LEFT JOIN usuarios p ON p.id = c.propietario LEFT JOIN usuarios i ON i.id = c.invitador
       WHERE c.id = ? OR c.token = ? LIMIT 1`, idOToken, idOToken);
    return f ?? null;
  }

  /**
   * Acepta o rechaza. Por id vale si la invitación es para mí (usuario o
   * correo); con el token del correo, si nadie la ha reclamado aún (el token es
   * el que llegó a ese correo).
   */
  async responder(idOToken: string, yo: { id: string; correo: string; nombre: string }, aceptar: boolean): Promise<FilaComparticion | 'no_encontrada' | 'ajena' | 'caducada'> {
    const f = await this.invitacion(idOToken);
    if (!f || f.enlace) return 'no_encontrada';
    const porToken = f.token === idOToken;
    const mia = f.usuario === yo.id || (!f.usuario && (porToken || f.correo === yo.correo.toLowerCase()));
    if (!mia) return 'ajena';
    if (f.caduca && f.caduca <= ahora()) return 'caducada';
    if (f.propietario === yo.id) return 'ajena';
    const t = ahora();
    await this.q('UPDATE comparticiones SET estado = ?, usuario = ?, respondida = ?, desde = CASE WHEN ? THEN ? ELSE desde END WHERE id = ?',
      aceptar ? 'aceptada' : 'rechazada', yo.id, t, aceptar ? 1 : 0, t, f.id);
    await this.q("UPDATE notificaciones SET leida = ? WHERE tipo = 'invitacion' AND biblioteca = ? AND (usuario = ? OR correo = ?)", t, f.biblioteca, yo.id, yo.correo.toLowerCase());
    await this.notificar({
      usuario: f.invitador ?? f.propietario, tipo: aceptar ? 'invitacion_aceptada' : 'invitacion_rechazada',
      texto: `${yo.nombre || yo.correo} ${aceptar ? 'ha aceptado' : 'no ha aceptado'} tu invitación a «${f.nombre ?? 'la biblioteca'}».`, biblioteca: f.biblioteca,
    });
    return { ...f, estado: aceptar ? 'aceptada' : 'rechazada', usuario: yo.id };
  }

  /** Bibliotecas que otros comparten conmigo y que sigo (aceptadas y vigentes). */
  async compartidasConmigo(usuario: string) {
    const t = ahora();
    return this.q<FilaComparticion & { pnombre: string | null; pcorreo: string | null }>(
      `SELECT c.*, p.nombre AS pnombre, p.correo AS pcorreo FROM comparticiones c LEFT JOIN usuarios p ON p.id = c.propietario
       WHERE c.usuario = ? AND ${Cuentas.VIGENTE} ORDER BY c.nombre COLLATE NOCASE`, usuario, t, t);
  }

  async permisoSobre(biblioteca: string, usuario: string): Promise<{ propietario: string; permiso: PermisoCompartido } | null> {
    const t = ahora();
    const [f] = await this.q<{ propietario: string; permiso: PermisoCompartido }>(
      `SELECT c.propietario, c.permiso FROM comparticiones c WHERE c.biblioteca = ? AND c.usuario = ? AND ${Cuentas.VIGENTE}`, biblioteca, usuario, t, t);
    return f ?? null;
  }

  /** Dejar de seguir (o salir de) una biblioteca compartida. */
  async salir(biblioteca: string, usuario: string): Promise<boolean> {
    const r = await this.q('DELETE FROM comparticiones WHERE biblioteca = ? AND usuario = ? RETURNING id', biblioteca, usuario);
    return r.length > 0;
  }

  /** Seguir una biblioteca desde un enlace de solo lectura: lectura, mientras el enlace viva. */
  async seguirPorEnlace(e: FilaEnlace, yo: { id: string; correo: string }, nombre: string): Promise<void> {
    const correo = (yo.correo || `${yo.id}@sin-correo`).toLowerCase();
    await this.q(
      `INSERT INTO comparticiones (id, biblioteca, propietario, correo, usuario, permiso, nombre, desde, estado, enlace, invitador)
       VALUES (?, ?, ?, ?, ?, 'lectura', ?, ?, 'aceptada', ?, ?)
       ON CONFLICT(biblioteca, correo) DO NOTHING`,
      `i${azar(9).toLowerCase().replace(/[^a-z0-9]/g, '')}`, e.biblioteca!, e.propietario, correo, yo.id, nombre, ahora(), e.id, e.propietario,
    );
  }

  // -------------------------------------------------------------------------
  // Enlaces de solo lectura
  // -------------------------------------------------------------------------

  async crearEnlace(e: { propietario: string; biblioteca?: string | null; documento?: string | null; titulo: string; clave?: string | null; caducaDias?: number | null }): Promise<FilaEnlace> {
    const id = nuevoId('e');
    const token = azar(18);
    const caduca = e.caducaDias ? new Date(Date.now() + e.caducaDias * 86400_000).toISOString() : null;
    await this.q('INSERT INTO enlaces (id, token, propietario, biblioteca, documento, titulo, clave, caduca, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, token, e.propietario, e.biblioteca ?? null, e.documento ?? null, e.titulo, e.clave ? await huellaClave(e.clave) : null, caduca, ahora());
    await this.auditar(e.propietario, 'enlace_creado', { id, biblioteca: e.biblioteca, documento: e.documento });
    return (await this.q<FilaEnlace>('SELECT * FROM enlaces WHERE id = ?', id))[0]!;
  }

  async enlaces(propietario: string, biblioteca?: string): Promise<FilaEnlace[]> {
    return biblioteca
      ? this.q<FilaEnlace>('SELECT * FROM enlaces WHERE propietario = ? AND biblioteca = ? AND revocado IS NULL ORDER BY creado DESC', propietario, biblioteca)
      : this.q<FilaEnlace>('SELECT * FROM enlaces WHERE propietario = ? AND revocado IS NULL ORDER BY creado DESC', propietario);
  }

  async enlace(id: string): Promise<FilaEnlace | null> {
    return (await this.q<FilaEnlace>('SELECT * FROM enlaces WHERE id = ?', id))[0] ?? null;
  }

  async enlacePorToken(token: string): Promise<FilaEnlace | null> {
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
    return (await this.q<FilaEnlace>('SELECT * FROM enlaces WHERE token = ?', token))[0] ?? null;
  }

  async revocarEnlace(propietario: string, id: string): Promise<boolean> {
    const r = await this.q('UPDATE enlaces SET revocado = ? WHERE id = ? AND propietario = ? AND revocado IS NULL RETURNING id', ahora(), id, propietario);
    if (r.length) await this.auditar(propietario, 'enlace_revocado', { id });
    return r.length > 0;
  }

  async contarVisita(id: string): Promise<void> {
    await this.q('UPDATE enlaces SET visitas = visitas + 1 WHERE id = ?', id);
  }

  // -------------------------------------------------------------------------
  // Notificaciones
  // -------------------------------------------------------------------------

  async notificar(n: { usuario?: string | null; correo?: string | null; tipo: string; texto: string; biblioteca?: string | null; destino?: string | null }): Promise<void> {
    if (!n.usuario && !n.correo) return;
    await this.q('INSERT INTO notificaciones (id, usuario, correo, tipo, texto, biblioteca, destino, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      nuevoId('n'), n.usuario ?? null, n.usuario ? null : (n.correo ?? '').toLowerCase(), n.tipo, n.texto, n.biblioteca ?? null, n.destino ?? null, ahora());
  }

  async notificaciones(usuario: string, correo: string, pendientes = false) {
    const filas = await this.q<{ id: string; tipo: string; texto: string; biblioteca: string | null; destino: string | null; creada: string; leida: string | null }>(
      `SELECT id, tipo, texto, biblioteca, destino, creada, leida FROM notificaciones WHERE (usuario = ? OR (usuario IS NULL AND correo = ?))
       ${pendientes ? 'AND leida IS NULL' : ''} ORDER BY creada DESC LIMIT 100`, usuario, correo.toLowerCase());
    return filas;
  }

  async marcarLeidas(usuario: string, correo: string, ids?: string[]): Promise<void> {
    if (ids?.length) {
      await this.q('UPDATE notificaciones SET leida = ? WHERE leida IS NULL AND (usuario = ? OR (usuario IS NULL AND correo = ?)) AND id IN (SELECT value FROM json_each(?))',
        ahora(), usuario, correo.toLowerCase(), JSON.stringify(ids));
    } else {
      await this.q('UPDATE notificaciones SET leida = ? WHERE leida IS NULL AND (usuario = ? OR (usuario IS NULL AND correo = ?))', ahora(), usuario, correo.toLowerCase());
    }
  }

  // -------------------------------------------------------------------------
  // Copias que apuntan a los binarios de otro (sin duplicar bytes)
  // -------------------------------------------------------------------------

  async referenciar(prefijo: string, usuario: string, documento: string): Promise<void> {
    await this.q('INSERT INTO referencias_almacen (prefijo, usuario, documento, creada) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', prefijo, usuario, documento, ahora());
  }

  /** ¿Alguien más usa estos binarios? Si es así, quedan retenidos al borrar el documento de su dueño. */
  async retenerSiReferenciado(prefijo: string, propietario: string): Promise<boolean> {
    const [f] = await this.q<{ n: number }>('SELECT COUNT(*) AS n FROM referencias_almacen WHERE prefijo = ?', prefijo);
    if (!f?.n) return false;
    await this.q('INSERT INTO prefijos_retenidos (prefijo, propietario, desde) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', prefijo, propietario, ahora());
    return true;
  }

  /**
   * Quita las referencias de un documento copiado. Devuelve los prefijos que se
   * han quedado sin nadie y cuyo dueño ya los había borrado: hay que borrarlos.
   */
  async soltarReferencias(usuario: string, documento: string): Promise<string[]> {
    const prefijos = (await this.q<{ prefijo: string }>('DELETE FROM referencias_almacen WHERE usuario = ? AND documento = ? RETURNING prefijo', usuario, documento)).map((f) => f.prefijo);
    const huerfanos: string[] = [];
    for (const p of prefijos) {
      const [r] = await this.q<{ n: number }>('SELECT COUNT(*) AS n FROM referencias_almacen WHERE prefijo = ?', p);
      if (r?.n) continue;
      const borrado = await this.q('DELETE FROM prefijos_retenidos WHERE prefijo = ? RETURNING prefijo', p);
      if (borrado.length) huerfanos.push(p);
    }
    return huerfanos;
  }

  /** ¿Hay referencias de otros a algo dentro de este prefijo (p. ej. «u/<usuario>/»)? */
  async prefijosReferenciados(prefijo: string): Promise<string[]> {
    return (await this.q<{ prefijo: string }>("SELECT DISTINCT prefijo FROM referencias_almacen WHERE substr(prefijo, 1, length(?)) = ?", prefijo, prefijo)).map((f) => f.prefijo);
  }

  // -------------------------------------------------------------------------

  async auditar(usuario: string, accion: string, detalle?: Record<string, unknown>): Promise<void> {
    await this.q('INSERT INTO auditoria (usuario, accion, detalle, cuando) VALUES (?, ?, ?, ?)', usuario, accion, detalle ? JSON.stringify(detalle) : null, ahora());
  }
}
