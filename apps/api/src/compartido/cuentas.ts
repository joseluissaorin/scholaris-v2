/**
 * Cuentas: usuarios, uso y cuotas, claves de API personales, ajustes con
 * claves propias cifradas, bibliotecas compartidas y auditoría. Vive en D1 en
 * la nube y en un SQLite en local; el código es el mismo sobre el puerto SQL.
 */
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { nuevoId } from '@scholaris/nucleo';
import type {
  AlcanceClave, Ajustes, ClaveApi, ClaveApiCreada, Cuotas, Plan, Preferencias, ProveedorClave, Usuario,
} from '@scholaris/contrato';
import { cifrar, descifrar, sha256Hex } from './cifrado.js';
import { LIMITES, periodo, type Metrica } from './planes.js';
import { aBase64Url } from './firmas.js';

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
];

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

export class Cuentas {
  private listo: Promise<void> | null = null;

  constructor(private readonly sql: SQL, private readonly claveMaestra: string) {}

  /** Crea las tablas si faltan (una vez por instancia). */
  preparar(): Promise<void> {
    this.listo ??= (async () => {
      for (const s of ESQUEMA_CUENTAS) await this.sql.ejecutar(s);
    })();
    return this.listo;
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

  async usuario(id: string): Promise<(Usuario & { plan: Plan }) | null> {
    const [f] = await this.q<{ id: string; correo: string; nombre: string; imagen: string | null; plan: Plan }>('SELECT id, correo, nombre, imagen, plan FROM usuarios WHERE id = ?', id);
    return f ? { id: f.id, correo: f.correo, nombre: f.nombre, imagen: f.imagen ?? undefined, plan: f.plan } : null;
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
  // Bibliotecas compartidas
  // -------------------------------------------------------------------------

  async compartir(biblioteca: string, propietario: string, nombre: string, correo: string, permiso: 'edicion' | 'lectura') {
    const usuario = await this.usuarioPorCorreo(correo);
    const desde = ahora();
    await this.q(
      `INSERT INTO comparticiones (biblioteca, propietario, correo, usuario, permiso, nombre, desde) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(biblioteca, correo) DO UPDATE SET permiso = excluded.permiso, nombre = excluded.nombre`,
      biblioteca, propietario, correo.toLowerCase(), usuario, permiso, nombre, desde,
    );
    await this.auditar(propietario, 'biblioteca_compartida', { biblioteca, correo });
    return { usuario: usuario ?? undefined, correo: correo.toLowerCase(), permiso, pendiente: !usuario, desde };
  }

  async miembros(biblioteca: string) {
    return (await this.q<{ usuario: string | null; correo: string; permiso: 'edicion' | 'lectura'; desde: string }>(
      'SELECT usuario, correo, permiso, desde FROM comparticiones WHERE biblioteca = ? ORDER BY desde', biblioteca,
    )).map((f) => ({ usuario: f.usuario ?? undefined, correo: f.correo, permiso: f.permiso, pendiente: !f.usuario, desde: f.desde }));
  }

  async dejarDeCompartir(biblioteca: string, propietario: string, usuarioOCorreo: string): Promise<void> {
    await this.q('DELETE FROM comparticiones WHERE biblioteca = ? AND propietario = ? AND (usuario = ? OR correo = ?)', biblioteca, propietario, usuarioOCorreo, usuarioOCorreo.toLowerCase());
  }

  async borrarComparticiones(biblioteca: string): Promise<void> {
    await this.q('DELETE FROM comparticiones WHERE biblioteca = ?', biblioteca);
  }

  /** Bibliotecas que otros comparten conmigo. */
  async compartidasConmigo(usuario: string) {
    return this.q<{ biblioteca: string; propietario: string; permiso: 'edicion' | 'lectura'; nombre: string | null; desde: string }>(
      'SELECT biblioteca, propietario, permiso, nombre, desde FROM comparticiones WHERE usuario = ?', usuario,
    );
  }

  async permisoSobre(biblioteca: string, usuario: string): Promise<{ propietario: string; permiso: 'edicion' | 'lectura' } | null> {
    const [f] = await this.q<{ propietario: string; permiso: 'edicion' | 'lectura' }>('SELECT propietario, permiso FROM comparticiones WHERE biblioteca = ? AND usuario = ?', biblioteca, usuario);
    return f ?? null;
  }

  // -------------------------------------------------------------------------

  async auditar(usuario: string, accion: string, detalle?: Record<string, unknown>): Promise<void> {
    await this.q('INSERT INTO auditoria (usuario, accion, detalle, cuando) VALUES (?, ?, ?, ?)', usuario, accion, detalle ? JSON.stringify(detalle) : null, ahora());
  }
}
