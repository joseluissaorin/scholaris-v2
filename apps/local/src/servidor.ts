/**
 * Scholaris en casa: la misma aplicación que en la nube (la puerta y las rutas
 * de usuario de apps/api) sobre Node o Bun, SQLite y el disco.
 *
 *   <datos>/cuentas.sqlite                  usuarios, cuotas, claves, ajustes, cola
 *   <datos>/usuarios/<id>/estanteria.sqlite la estantería (SPDF v4 + funciones)
 *   <datos>/almacen/…                       originales, páginas, paquetes
 *   <datos>/secreto.json                    secretos de la instancia (se generan)
 *
 * Sin Clerk es de un solo usuario («local»), con un token opcional
 * (SCHOLARIS_TOKEN). Con CLERK_PUBLISHABLE_KEY, multiusuario como la nube.
 * La inteligencia llega por las mismas APIs con las claves del entorno o las
 * del usuario; InferBox (INFERBOX_URL) es opcional.
 *
 * Sin conexión (SCHOLARIS_SIN_CONEXION=1 + INFERENCIA_URL): toda la
 * inteligencia en el servidor propio, nada de claves de nube (ni las del
 * usuario), sin Clerk, sin YouTube y sin catálogos (OpenAlex, Crossref, Open
 * Library, Wikidata) salvo SCHOLARIS_CATALOGOS=1. La guardia de red
 * (guardia-red.ts) la instala principal.ts.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { IndiceVectorial, Inteligencia } from '@scholaris/nucleo';
import { crearInteligencia, modoSinConexion, type EntornoInteligencia } from '@scholaris/proveedores';
import { crearAppUsuario, crearPuerta, VERSION, type Plataforma } from '@scholaris/api/app';
import type { ConfigInstancia, PuertosUsuario, UsuarioSesion } from '@scholaris/api/puertos';
import { Cuentas } from '@scholaris/api/compartido/cuentas';
import { servirPublica } from '@scholaris/api/compartido/markdown-publico';
import { crearVerificadorClerk } from '@scholaris/api/compartido/clerk';
import { prepararEstanteria } from '@scholaris/api/compartido/esquema-plataforma';
import { verificarBillete } from '@scholaris/api/compartido/firmas';
import { crearAlmacenDisco, TAM_PARTE } from './almacen-disco.js';
import { SqlLocal, type BaseSqlite } from './sql.js';
import { CentralTiempoReal } from './tiempo-real.js';
import { ColaLocal } from './cola.js';
import { cargarSqliteVec, crearIndiceLocal } from './indice-sqlite-vec.js';
import { crearRasterizador } from './rasterizar-pdf.js';

export interface DriverSqlite {
  abrir(ruta: string): BaseSqlite;
  /** Carga sqlite-vec en la conexión; si falta o falla, búsqueda densa por fuerza bruta. */
  cargarVec?(db: BaseSqlite): void;
}

export interface OpcionesServidor {
  datos: string;
  puerto: number;
  /** URL pública («http://localhost:8790»). */
  origen?: string;
  /** Carpeta con la web construida (apps/web/dist). */
  web?: string;
  driver: DriverSqlite;
  /** Variables de entorno (claves de API, Clerk, InferBox…). */
  entorno?: Record<string, string | undefined>;
  /** Imprenta del servidor (opcional, `@scholaris/imprenta/node`). */
  convertir?: ConstructorParameters<typeof ColaLocal>[0]['convertir'];
  recortar?: ConstructorParameters<typeof ColaLocal>[0]['recortar'];
  /** Fábrica de inteligencia alternativa (pruebas). */
  fabricaInteligencia?: (entorno: EntornoInteligencia) => Inteligencia;
}

export interface ServidorLocal {
  fetch(peticion: Request): Promise<Response>;
  tiempoReal: CentralTiempoReal;
  /** Verifica un billete de WebSocket; devuelve el canal o null. */
  canalDeBillete(billete: string): Promise<string | null>;
  cola: ColaLocal;
  origen: string;
  cerrar(): void;
}

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

function secretos(datos: string): { secreto: string; claveMaestra: string } {
  const f = join(datos, 'secreto.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as { secreto: string; claveMaestra: string };
  const s = { secreto: randomBytes(32).toString('base64url'), claveMaestra: randomBytes(32).toString('base64url') };
  writeFileSync(f, JSON.stringify(s), { mode: 0o600 });
  return s;
}

export async function crearServidorLocal(o: OpcionesServidor): Promise<ServidorLocal> {
  const env = o.entorno ?? process.env;
  const datos = resolve(o.datos);
  mkdirSync(join(datos, 'usuarios'), { recursive: true });
  const { secreto, claveMaestra } = secretos(datos);
  let origen = (o.origen ?? env.PUBLIC_URL ?? `http://localhost:${o.puerto}`).replace(/\/$/, '');

  const baseCuentas = o.driver.abrir(join(datos, 'cuentas.sqlite'));
  baseCuentas.exec('PRAGMA journal_mode = WAL');
  const sqlCuentas = new SqlLocal(baseCuentas);
  const cuentas = new Cuentas(sqlCuentas, env.CLAVE_MAESTRA || claveMaestra);
  await cuentas.preparar();

  const almacen = crearAlmacenDisco(join(datos, 'almacen'), { secreto, origen: () => origen });
  const tiempoReal = new CentralTiempoReal();
  const sinConexion = modoSinConexion(env);
  const catalogos = !sinConexion || env.SCHOLARIS_CATALOGOS === '1';
  if (sinConexion && env.CLERK_PUBLISHABLE_KEY) console.warn('[sin conexión] se ignora CLERK_PUBLISHABLE_KEY: Clerk vive en internet. Usa SCHOLARIS_TOKEN o SCHOLARIS_USUARIOS.');
  const conClerk = !sinConexion && !!env.CLERK_PUBLISHABLE_KEY;
  const rasterizar = sinConexion ? crearRasterizador() : undefined;

  const config: ConfigInstancia = {
    modo: 'local', version: VERSION, origen,
    ...(conClerk ? { clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY } : {}),
    requiereAutenticacion: conClerk || !!env.SCHOLARIS_TOKEN || !!env.SCHOLARIS_USUARIOS,
    conversionServidor: true, youtube: !sinConexion && !!env.GEMINI_API_KEY, mcp: true, inferbox: !!env.INFERBOX_URL || (sinConexion && !!env.INFERENCIA_URL),
    bytesMaximos: 16 * 1024 * 1024 * 1024, tamParte: TAM_PARTE,
    espacioNombres: (u) => u,
  };

  // --- Estanterías (una base por usuario, abierta bajo demanda) ------------
  interface Abierta { db: BaseSqlite; sql: SqlLocal; conVec: boolean; indice?: IndiceVectorial }
  const abiertas = new Map<string, Promise<Abierta>>();
  const carpeta = (usuario: string) => join(datos, 'usuarios', usuario.replace(/[^\w.-]/g, '_'));
  const abrir = (usuario: string): Promise<Abierta> => {
    let a = abiertas.get(usuario);
    if (!a) {
      a = (async () => {
        mkdirSync(carpeta(usuario), { recursive: true });
        const db = o.driver.abrir(join(carpeta(usuario), 'estanteria.sqlite'));
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA foreign_keys = ON');
        const conVec = o.driver.cargarVec ? cargarSqliteVec(db, o.driver.cargarVec) : false;
        const sql = new SqlLocal(db);
        await prepararEstanteria(sql);
        return { db, sql, conVec };
      })();
      abiertas.set(usuario, a);
    }
    return a;
  };

  // --- Inteligencia (claves del entorno + las propias del usuario) ----------
  const cacheIA = new Map<string, { ia: Inteligencia; hasta: number }>();
  const inteligenciaDe = async (usuario: string): Promise<Inteligencia> => {
    const hay = cacheIA.get(usuario);
    if (hay && hay.hasta > Date.now()) return hay.ia;
    // Sin conexión, ni las claves propias del usuario: nada de nube.
    const propias = sinConexion ? {} as Record<string, string> : await cuentas.clavesPropias(usuario).catch(() => ({} as Record<string, string>));
    const e: EntornoInteligencia = {
      ...env,
      GEMINI_API_KEY: propias.gemini ?? env.GEMINI_API_KEY,
      OPENROUTER_API_KEY: propias.openrouter ?? env.OPENROUTER_API_KEY,
      TYPESAFE_API_KEY: propias.typesafe ?? env.TYPESAFE_API_KEY,
    };
    const ia = o.fabricaInteligencia ? o.fabricaInteligencia(e) : crearInteligencia(e, { concurrencia: 12, ...(rasterizar ? { rasterizar } : {}) });
    // Abre ya la conexión del embebedor: la primera consulta se ahorra ~200 ms.
    void (ia.embebedor as { precalentar?: () => Promise<void> }).precalentar?.().catch(() => undefined);
    cacheIA.set(usuario, { ia, hasta: Date.now() + 600_000 });
    return ia;
  };

  let cola: ColaLocal;

  const puertosDe = async (usuario: UsuarioSesion): Promise<PuertosUsuario> => {
    const est = await abrir(usuario.id);
    let ia: Promise<Inteligencia> | null = null;
    const inteligencia = () => (ia ??= inteligenciaDe(usuario.id));
    const indicePerezoso: IndiceVectorial = {
      get espacio() { if (!est.indice) throw new Error('Índice aún no inicializado'); return est.indice.espacio; },
      insertar: async (ns, e) => (est.indice ??= crearIndiceLocal(est.db, est.sql, (await inteligencia()).embebedor.espacio, est.conVec)).insertar(ns, e),
      consultar: async (ns, v, op) => (est.indice ??= crearIndiceLocal(est.db, est.sql, (await inteligencia()).embebedor.espacio, est.conVec)).consultar(ns, v, op),
      borrar: async (ns, ids) => (est.indice ??= crearIndiceLocal(est.db, est.sql, (await inteligencia()).embebedor.espacio, est.conVec)).borrar(ns, ids),
    };
    return {
      usuario,
      sql: est.sql,
      almacen,
      indice: indicePerezoso,
      inteligencia,
      emisor: tiempoReal.emisorDe(usuario.id),
      orquestador: cola,
      cuentas,
      config,
      segundoPlano: (p) => { void p.catch((e: unknown) => console.error('[segundo plano]', e)); },
      vaciarEstanteria: async () => {
        est.sql.cerrar();
        abiertas.delete(usuario.id);
        rmSync(carpeta(usuario.id), { recursive: true, force: true });
        await abrir(usuario.id);
      },
      ...(o.convertir ? { convertir: o.convertir } : {}),
      ...(o.recortar ? { recortar: o.recortar } : {}),
    };
  };

  cola = new ColaLocal({
    sql: sqlCuentas,
    puertosPara: async (id, plan) => {
      const u = await cuentas.usuario(id);
      return puertosDe({ id, plan: u?.plan ?? plan, correo: u?.correo ?? '', nombre: u?.nombre ?? '', funciones: [], via: conClerk ? 'clerk' : 'local' });
    },
    ...(o.convertir ? { convertir: o.convertir } : {}),
    ...(o.recortar ? { recortar: o.recortar } : {}),
    concurrencia: Number(env.SCHOLARIS_CONCURRENCIA ?? 2),
    // Sin conexión, la verificación y el enriquecimiento de metadatos (catálogos en internet) se apagan.
    sinVerificacion: env.SCHOLARIS_SIN_VERIFICACION === '1' || !catalogos,
    gemini: async (u) => {
      if (sinConexion) return undefined;
      const propias = await cuentas.clavesPropias(u).catch(() => ({} as Record<string, string>));
      const clave = propias.gemini ?? env.GEMINI_API_KEY;
      return clave ? { clave, ...(env.GEMINI_BASE_URL ? { baseUrl: env.GEMINI_BASE_URL } : {}) } : undefined;
    },
  });

  // Varias personas sin Clerk (una casa, un seminario): SCHOLARIS_USUARIOS="token:id:correo:Nombre;…".
  const usuariosLocales = new Map<string, UsuarioSesion>();
  for (const trozo of (env.SCHOLARIS_USUARIOS ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [tok, id, correo, ...nombre] = trozo.split(':');
    if (!tok || tok.length < 8 || !id || !/^[\w-]{2,60}$/.test(id)) { console.warn(`[usuarios] entrada no válida en SCHOLARIS_USUARIOS: «${trozo.slice(0, 20)}…»`); continue; }
    const u: UsuarioSesion = { id, correo: (correo ?? '').toLowerCase(), nombre: nombre.join(':') || id, plan: 'pro', funciones: ['scholaris'], via: 'local' };
    usuariosLocales.set(tok, u);
    await cuentas.asegurarUsuario(u);
  }
  const usuarioLocal: UsuarioSesion | undefined = conClerk || usuariosLocales.size ? undefined : {
    id: 'local', correo: env.SCHOLARIS_CORREO ?? 'local@scholaris', nombre: env.SCHOLARIS_NOMBRE ?? 'Scholaris', plan: 'pro', funciones: ['scholaris'], via: 'local',
  };
  if (usuarioLocal) await cuentas.asegurarUsuario(usuarioLocal);
  // Al arrancar: la inteligencia del usuario local, con el embebedor ya precalentado.
  if (usuarioLocal && !o.fabricaInteligencia) void inteligenciaDe(usuarioLocal.id).catch(() => undefined);

  const appUsuario = crearAppUsuario();
  const plataforma: Plataforma = {
    config, secreto, cuentas, almacen,
    ...(usuarioLocal ? { usuarioLocal } : {}),
    ...(usuariosLocales.size ? { usuariosLocales } : {}),
    ...(env.SCHOLARIS_TOKEN ? { tokenLocal: env.SCHOLARIS_TOKEN } : {}),
    ...(env.ADMINS ? { admins: env.ADMINS.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(conClerk ? { clerk: crearVerificadorClerk({ publishableKey: env.CLERK_PUBLISHABLE_KEY!, ...(env.CLERK_EMISOR ? { emisor: env.CLERK_EMISOR } : {}), ...(env.CLERK_JWKS ? { jwks: env.CLERK_JWKS } : {}) }) } : {}),
    atender: async (usuario, p) => appUsuario.fetch(p, { puertos: await puertosDe(usuario) }),
    // El WebSocket lo atiende el servidor HTTP (Node o Bun) antes de llegar aquí.
    tiempoReal: async () => new Response('Usa el WebSocket del servidor local.', { status: 426 }),
  };
  const puerta = crearPuerta(plataforma);

  const web = o.web && existsSync(join(o.web, 'index.html')) ? resolve(o.web) : null;
  const estatico = (ruta: string): Response | null => {
    if (!web) return null;
    let limpia = decodeURIComponent(ruta);
    if (limpia.includes('..')) return null;
    if (limpia.endsWith('/')) limpia += 'index.html';
    const f = join(web, limpia);
    try { if (!statSync(f).isFile()) return null; } catch { return null; }
    const inmutable = /\/assets\//.test(limpia) || /\.[a-f0-9]{8,}\./.test(limpia);
    return new Response(readFileSync(f), { headers: { 'content-type': TIPOS[extname(f)] ?? 'application/octet-stream', 'cache-control': inmutable ? 'public, max-age=31536000, immutable' : 'no-cache' } });
  };

  const reanudadas = await cola.reanudar();
  if (reanudadas) console.log(`[cola] ${reanudadas} ingestas reanudadas`);

  // Vigilantes programados: a diario (y los lunes, los semanales).
  const { ejecutarVigilantesProgramados } = await import('@scholaris/funciones');
  const { puertosFunciones } = await import('@scholaris/api/compartido/servicios');
  const vigilar = async () => {
    for (const id of await cuentas.usuariosActivos(60)) {
      const p = await puertosDe({ id, plan: 'pro', correo: '', nombre: '', funciones: [], via: 'local' }).catch(() => null);
      if (!p) continue;
      try {
        const pf = await puertosFunciones(p);
        await ejecutarVigilantesProgramados(pf, 'diario');
        if (new Date().getDay() === 1) await ejecutarVigilantesProgramados(pf, 'semanal');
      } catch (e) { console.error('[vigilantes]', (e as Error).message); }
    }
  };
  const reloj = setInterval(() => void vigilar(), 24 * 3600_000);
  reloj.unref?.();

  return {
    origen,
    tiempoReal,
    cola,
    async canalDeBillete(billete) {
      const d = await verificarBillete<{ u: string; t?: string }>(secreto, billete);
      return d ? (d.t ? `tarea:${d.u}:${d.t}` : `usuario:${d.u}`) : null;
    },
    async fetch(peticion) {
      const url = new URL(peticion.url);
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') return puerta.fetch(peticion);
      // Páginas públicas: Markdown con «Accept: text/markdown» y cabecera Link en el HTML.
      const publica = await servirPublica(peticion, async (ruta) => estatico(ruta) ?? (/\.[a-z0-9]+$/i.test(ruta) ? null : estatico(`${ruta}.html`)));
      if (publica) return publica;
      // Las páginas prerenderizadas (/acerca, /api, /en/api) se sirven sin «.html», como en Cloudflare.
      const r = estatico(url.pathname) ?? (/\.[a-z0-9]+$/i.test(url.pathname) ? null : estatico(`${url.pathname.replace(/\/$/, '')}.html`));
      if (r) return r;
      // Rutas de la web (SPA): index.html. Un fichero que no existe es un 404 de verdad.
      if (peticion.method === 'GET' && !/\.[a-z0-9]+$/i.test(url.pathname.split('/').pop() ?? '')) {
        const i = estatico('/index.html');
        if (i) return i;
        return new Response('Scholaris local: la API está en /api/v2. Construye la web con «pnpm --filter @scholaris/web build».', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      return new Response('No encontrado', { status: 404 });
    },
    cerrar() {
      clearInterval(reloj);
      for (const a of abiertas.values()) void a.then((x) => x.sql.cerrar()).catch(() => undefined);
      sqlCuentas.cerrar();
    },
    set _origen(v: string) { origen = v; },
  } as ServidorLocal;
}
