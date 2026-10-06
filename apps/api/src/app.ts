/**
 * La aplicación Hono de Scholaris, en dos capas:
 *
 *   crearPuerta(plataforma)  La entrada: CORS, configuración pública, binarios
 *                            firmados, subidas directas, billetes de tiempo
 *                            real, autenticación (Clerk, claves de API o modo
 *                            local), límites de ritmo. Luego entrega la
 *                            petición a la estantería del usuario.
 *
 *   crearAppUsuario()        Las rutas que trabajan sobre la estantería de UN
 *                            usuario. En la nube corre dentro de su Durable
 *                            Object (SQL local y síncrono); en casa, en el
 *                            mismo proceso. Recibe los puertos por `env`.
 *
 * Ninguna de las dos sabe si está en Cloudflare o en Node: todo llega por la
 * interfaz `Plataforma` y por `PuertosUsuario`.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Billete, ConfigPublica, PedirBillete } from '@scholaris/contrato';
import { PREFIJO_API } from '@scholaris/contrato';
import type { Entorno } from './entorno.js';
import type { AlmacenAmpliado, ConfigInstancia, PuertosUsuario, UsuarioSesion } from './puertos.js';
import { cuerpoError, cuerpoJson, ErrorScholaris, fallo, responderError } from './compartido/errores.js';
import { firmarBillete, igualesSeguro, verificarParametros } from './compartido/firmas.js';
import type { Cuentas } from './compartido/cuentas.js';
import type { VerificadorClerk } from './compartido/clerk.js';
import { LIMITES } from './compartido/planes.js';
import { rutasSubidas } from './rutas/subidas.js';
import { rutasDocumentos } from './rutas/documentos.js';
import { rutasBibliotecas } from './rutas/bibliotecas.js';
import { rutasTareas } from './rutas/tareas.js';
import { rutasCuenta } from './rutas/cuenta.js';
import { rutasBusqueda } from './rutas/busqueda.js';
import { rutasCitas } from './rutas/citas.js';
import { rutasSpdf } from './rutas/spdf.js';
import { montarFunciones } from './rutas/funciones.js';
import { rutasMcp } from './rutas/mcp.js';
import { restringirAmbito } from './rutas/ambito.js';

export { VERSION } from './version.js';

// ---------------------------------------------------------------------------
// App de usuario
// ---------------------------------------------------------------------------

export interface EnvUsuario {
  puertos: PuertosUsuario;
}

export function crearAppUsuario() {
  const app = new Hono<Entorno & { Bindings: EnvUsuario }>().basePath(PREFIJO_API);
  app.onError((e, c) => responderError(c, e));
  app.notFound((c) => c.json(cuerpoError('no_encontrado', `La ruta ${c.req.method} ${c.req.path} no existe.`), 404));
  app.use('*', async (c, next) => {
    const p = c.env.puertos;
    c.set('puertos', p);
    c.set('usuario', p.usuario);
    await next();
  });
  app.use('*', restringirAmbito);
  const sub = app as unknown as Hono<Entorno>;
  rutasCuenta(sub);
  rutasSubidas(sub);
  rutasDocumentos(sub);
  rutasSpdf(sub);
  rutasBibliotecas(sub);
  rutasTareas(sub);
  rutasBusqueda(sub);
  rutasCitas(sub);
  montarFunciones(sub);
  rutasMcp(sub);
  return app;
}

// ---------------------------------------------------------------------------
// La puerta
// ---------------------------------------------------------------------------

export interface Plataforma {
  config: ConfigInstancia;
  secreto: string;
  cuentas: Cuentas;
  /** Almacén para binarios firmados y subidas pass-through. */
  almacen: AlmacenAmpliado;
  /** Sin Clerk (local): usuario fijo, o null si exige token propio. */
  usuarioLocal?: UsuarioSesion;
  /** Token fijo opcional del modo local (SCHOLARIS_TOKEN). */
  tokenLocal?: string;
  /**
   * Token de administración (migraciones): con la cabecera `x-scholaris-como`
   * actúa como ese usuario. Solo existe si se define el secreto ADMIN_TOKEN.
   */
  tokenAdmin?: string;
  clerk?: VerificadorClerk;
  /** Orígenes CORS admitidos (además del propio). */
  origenes?: string[];
  /** Limitador de ritmo: true si se admite la petición. */
  admitir?(clave: string, porMinuto: number): Promise<{ ok: boolean; reintentar?: number }>;
  /** Entrega una petición ya autenticada a la estantería del usuario. */
  atender(usuario: UsuarioSesion, peticion: Request): Promise<Response>;
  /** Abre el WebSocket de tiempo real (ya verificado el billete). */
  tiempoReal(peticion: Request, canal: { usuario: string; tarea?: string }): Promise<Response>;
}

/** Ruta de los billetes: usuario y tarea opcional, firmados 60 s. */
interface DatosBillete { u: string; t?: string }

export function crearPuerta(pl: Plataforma) {
  const app = new Hono<{ Variables: { usuario: UsuarioSesion } }>();
  app.onError((e, c) => responderError(c, e));

  app.use(`${PREFIJO_API}/*`, cors({
    origin: (origen) => (!origen || origen === pl.config.origen || pl.origenes?.includes(origen) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen) ? origen : null),
    allowHeaders: ['authorization', 'content-type', 'range', 'x-scholaris-cliente'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['etag', 'content-range', 'accept-ranges', 'content-length', 'retry-after'],
    maxAge: 86400,
  }));

  // --- Sin autenticar ------------------------------------------------------
  app.get(`${PREFIJO_API}/salud`, (c) => c.json({ ok: true, version: pl.config.version }));
  app.get(`${PREFIJO_API}/config`, (c) => {
    const k = pl.config;
    const cfg: ConfigPublica = {
      modo: k.modo, version: k.version, requiereAutenticacion: k.requiereAutenticacion,
      funciones: { conversionServidor: k.conversionServidor, youtube: k.youtube, mcp: k.mcp, inferbox: k.inferbox, subidaPorPartes: true },
      limites: { bytesMaximos: k.bytesMaximos, tamParte: k.tamParte },
    };
    if (k.clerkPublishableKey) cfg.clerkPublishableKey = k.clerkPublishableKey;
    return c.json(cfg);
  });

  // Binarios firmados (imágenes de página, originales, medios con Range).
  app.on(['GET', 'HEAD'], `${PREFIJO_API}/binarios`, async (c) => {
    const ps = await verificarParametros(pl.secreto, new URL(c.req.url).searchParams);
    if (!ps?.clave) return c.json(cuerpoError('prohibido', 'El enlace no es válido o ha caducado.'), 403);
    return servirBinario(pl.almacen, ps.clave, c.req.raw, { descarga: ps.dl, tipo: ps.tipo });
  });

  // Subidas a través de la API (sin credenciales S3 o en local).
  app.put(`${PREFIJO_API}/subidas/directa`, async (c) => {
    const ps = await verificarParametros(pl.secreto, new URL(c.req.url).searchParams);
    if (!ps?.clave || ps.op !== 'subir') return c.json(cuerpoError('prohibido', 'El enlace de subida no es válido o ha caducado.'), 403);
    const cuerpo = c.req.raw.body;
    if (!cuerpo) fallo('peticion_invalida', 'La subida no trae cuerpo.');
    const max = Number(ps.max ?? 0);
    const largo = Number(c.req.header('content-length') ?? 0);
    if (max && largo > max) fallo('demasiado_grande', 'El fichero es más grande de lo anunciado.');
    if (ps.parte && ps.idSubida) {
      const etag = await pl.almacen.ponerParte(ps.clave, ps.idSubida, Number(ps.parte), cuerpo);
      c.header('etag', etag);
      return c.json({ etag });
    }
    await pl.almacen.poner(ps.clave, cuerpo, ps.tipo ?? c.req.header('content-type') ?? undefined);
    return c.json({ ok: true });
  });

  // WebSocket de tiempo real con billete.
  app.get(`${PREFIJO_API}/tiempo-real`, async (c) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.json(cuerpoError('peticion_invalida', 'Esta ruta solo admite WebSocket.'), 426);
    const { verificarBillete } = await import('./compartido/firmas.js');
    const d = await verificarBillete<DatosBillete>(pl.secreto, c.req.query('billete') ?? '');
    if (!d) return c.json(cuerpoError('no_autenticado', 'El billete no es válido o ha caducado. Pide otro.'), 401);
    return pl.tiempoReal(c.req.raw, { usuario: d.u, tarea: d.t });
  });

  // --- Autenticación ------------------------------------------------------
  const autenticar = async (peticion: Request): Promise<UsuarioSesion> => {
    const cab = peticion.headers.get('authorization') ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(cab)?.[1]?.trim() ?? new URL(peticion.url).searchParams.get('token') ?? '';
    if (pl.usuarioLocal) {
      if (pl.tokenLocal && token !== pl.tokenLocal) fallo('no_autenticado', 'Falta el token de esta instancia (SCHOLARIS_TOKEN).');
      return pl.usuarioLocal;
    }
    if (!token) fallo('no_autenticado', 'Inicia sesión para continuar.');
    if (pl.tokenAdmin && pl.tokenAdmin.length >= 32 && igualesSeguro(token, pl.tokenAdmin)) {
      const como = peticion.headers.get('x-scholaris-como') ?? '';
      if (!/^[\w-]{3,80}$/.test(como)) fallo('peticion_invalida', 'Falta la cabecera x-scholaris-como con el usuario.');
      let u = await pl.cuentas.usuario(como);
      if (!u) {
        await pl.cuentas.asegurarUsuario({ id: como, correo: '', nombre: '', plan: 'gratis' });
        u = (await pl.cuentas.usuario(como))!;
      }
      await pl.cuentas.auditar(como, 'admin', { metodo: peticion.method, ruta: new URL(peticion.url).pathname });
      return { ...u, funciones: u.plan === 'pro' ? ['scholaris'] : [], via: 'admin' };
    }
    if (token.startsWith('sch_')) {
      const k = await pl.cuentas.autenticarClave(token);
      if (!k) fallo('no_autenticado', 'La clave de API no es válida, ha caducado o se ha revocado.');
      const u = await pl.cuentas.usuario(k.usuario);
      if (!u) fallo('no_autenticado', 'La cuenta de esta clave ya no existe.');
      return { ...u, funciones: u.plan === 'pro' ? ['scholaris'] : [], via: 'clave_api', alcances: k.alcances };
    }
    if (!pl.clerk) fallo('no_autenticado', 'Esta instancia no tiene inicio de sesión configurado.');
    const id = await pl.clerk(token);
    if (!id) fallo('no_autenticado', 'La sesión ha caducado. Vuelve a iniciar sesión.');
    const u: UsuarioSesion = { id: id.id, correo: id.correo, nombre: id.nombre, plan: id.plan, funciones: id.funciones, via: 'clerk' };
    if (id.imagen) u.imagen = id.imagen;
    await pl.cuentas.asegurarUsuario(u);
    // El token de sesión de Clerk no siempre lleva el correo: se completa con lo guardado.
    if (!u.correo) {
      const guardado = await pl.cuentas.usuario(u.id);
      if (guardado?.correo) { u.correo = guardado.correo; u.nombre = guardado.nombre || u.nombre; }
    }
    return u;
  };

  app.use(`${PREFIJO_API}/*`, async (c, next) => {
    const u = await autenticar(c.req.raw);
    if (pl.admitir) {
      const l = LIMITES[pl.config.modo === 'local' ? 'local' : u.plan];
      const r = await pl.admitir(`u:${u.id}`, l.porMinuto);
      if (!r.ok) {
        c.header('retry-after', String(r.reintentar ?? 30));
        throw new ErrorScholaris('limite_de_ritmo', 'Vas demasiado deprisa. Espera unos segundos y vuelve a intentarlo.', { reintentar: r.reintentar ?? 30 });
      }
    }
    c.set('usuario', u);
    await next();
  });

  app.post(`${PREFIJO_API}/tiempo-real/billete`, async (c) => {
    const u = c.get('usuario');
    const b = await cuerpoJson<PedirBillete>(c);
    const billete = await firmarBillete<DatosBillete>(pl.secreto, b.tarea ? { u: u.id, t: b.tarea } : { u: u.id }, 60);
    const ws = new URL(pl.config.origen);
    ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
    ws.pathname = `${PREFIJO_API}/tiempo-real`;
    ws.search = `?billete=${encodeURIComponent(billete)}`;
    return c.json<Billete>({ billete, url: ws.toString(), caduca: new Date(Date.now() + 60_000).toISOString() });
  });

  // Bibliotecas compartidas: a la estantería del PROPIETARIO, con el ámbito del invitado.
  app.all(`${PREFIJO_API}/compartidas/:biblioteca/*`, async (c) => {
    const u = c.get('usuario');
    const biblioteca = c.req.param('biblioteca');
    const p = await pl.cuentas.permisoSobre(biblioteca, u.id);
    if (!p) return c.json(cuerpoError('no_encontrado', 'La biblioteca no existe o no está compartida contigo.'), 404);
    const dueno = await pl.cuentas.usuario(p.propietario);
    if (!dueno) return c.json(cuerpoError('no_encontrado', 'La biblioteca ya no existe.'), 404);
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(`${PREFIJO_API}/compartidas/${encodeURIComponent(biblioteca)}`, PREFIJO_API).replace(`${PREFIJO_API}/compartidas/${biblioteca}`, PREFIJO_API);
    const sesion: UsuarioSesion = {
      id: dueno.id, correo: dueno.correo, nombre: dueno.nombre, plan: dueno.plan, funciones: dueno.plan === 'pro' ? ['scholaris'] : [],
      via: u.via, ...(u.alcances ? { alcances: u.alcances } : {}),
      ambito: { biblioteca, permiso: p.permiso, invitado: { id: u.id, correo: u.correo, nombre: u.nombre } },
    };
    return pl.atender(sesion, new Request(url.toString(), c.req.raw));
  });

  // Todo lo demás: a la estantería del usuario.
  app.all(`${PREFIJO_API}/*`, async (c) => pl.atender(c.get('usuario'), c.req.raw));

  // MCP (fuera de /api/v2): la autenticación es la misma.
  app.all('/mcp', async (c) => {
    if (!pl.config.mcp) return c.json(cuerpoError('no_disponible', 'El servidor MCP no está activado en esta instancia.'), 404);
    const u = await autenticar(c.req.raw);
    if (u.via === 'clave_api' && !u.alcances?.includes('mcp')) fallo('prohibido', 'Esta clave de API no tiene el alcance «mcp».');
    const url = new URL(c.req.url);
    url.pathname = `${PREFIJO_API}/mcp`;
    return pl.atender(u, new Request(url.toString(), c.req.raw));
  });

  return app;
}

/** Sirve un objeto del almacén con soporte de Range (medios, PDF). */
export async function servirBinario(almacen: AlmacenAmpliado, clave: string, peticion: Request, o: { descarga?: string; tipo?: string } = {}): Promise<Response> {
  const cab = await almacen.cabecera(clave);
  if (!cab) return Response.json(cuerpoError('no_encontrado', 'El fichero no existe.'), { status: 404 });
  const tipo = o.tipo ?? cab.tipo ?? 'application/octet-stream';
  const h = new Headers({ 'content-type': tipo, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' });
  if (cab.etag) h.set('etag', cab.etag);
  if (o.descarga) h.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(o.descarga)}`);
  const rango = /^bytes=(\d*)-(\d*)$/.exec(peticion.headers.get('range') ?? '');
  if (rango && (rango[1] || rango[2])) {
    let desde: number, hasta: number;
    if (!rango[1]) { desde = Math.max(0, cab.bytes - Number(rango[2])); hasta = cab.bytes - 1; }
    else { desde = Number(rango[1]); hasta = rango[2] ? Math.min(Number(rango[2]), cab.bytes - 1) : cab.bytes - 1; }
    if (desde >= cab.bytes || desde > hasta) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${cab.bytes}` } });
    }
    h.set('content-range', `bytes ${desde}-${hasta}/${cab.bytes}`);
    h.set('content-length', String(hasta - desde + 1));
    if (peticion.method === 'HEAD') return new Response(null, { status: 206, headers: h });
    const trozo = await almacen.rango(clave, desde, hasta);
    return new Response(trozo as Uint8Array<ArrayBuffer>, { status: 206, headers: h });
  }
  h.set('content-length', String(cab.bytes));
  if (peticion.method === 'HEAD') return new Response(null, { status: 200, headers: h });
  const o2 = await almacen.obtener(clave);
  if (!o2) return Response.json(cuerpoError('no_encontrado', 'El fichero no existe.'), { status: 404 });
  return new Response(o2.cuerpo, { status: 200, headers: h });
}
