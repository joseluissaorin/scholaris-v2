/**
 * Entrada del Worker de Scholaris en Cloudflare.
 *
 *   fetch      La puerta (auth, límites, binarios, tiempo real, MCP) delante
 *              de la estantería de cada usuario (Durable Object), más la web
 *              estática (apps/web/dist) con vuelta a index.html.
 *   queue      Trabajo de fondo (vigilantes programados).
 *   scheduled  Cron: encola los vigilantes diarios (y los semanales los lunes).
 */
import type { MensajeCorreo } from '../rutas/social.js';
import { recordarDemostracion, servirPortadaEnRaiz } from './portada.js';
import { servirPublica } from '../compartido/markdown-publico.js';
import { prepararMotorWorkers } from '@scholaris/spdf/workers';
import { PREFIJO_API, PREFIJO_V1 } from '@scholaris/contrato';
import { crearPuerta, type Plataforma } from '../app.js';
import { crearVerificadorClerk } from '../compartido/clerk.js';
import type { UsuarioSesion } from '../puertos.js';
import type { Env } from './env.js';
import type { MensajeCola } from './cola.js';
import { almacenDesdeEnv, configDesdeEnv, cuentasDesdeEnv, origenDe } from './puertos-cf.js';
import { conOAuth } from './oauth.js';

export { Estanteria } from './estanteria-do.js';
export { Tarea } from './tarea-do.js';
export { Limitador } from './limitador-do.js';
export { FlujoIngesta } from './flujo-ingesta.js';
export { Conversor } from './conversor.js';
export { Trabajador } from './trabajador-do.js';

prepararMotorWorkers();

const verificadores = new Map<string, ReturnType<typeof crearVerificadorClerk>>();

function plataforma(env: Env, peticion: Request): Plataforma {
  const origen = origenDe(env, peticion);
  const cuentas = cuentasDesdeEnv(env);
  let clerk: ReturnType<typeof crearVerificadorClerk> | undefined;
  if (env.CLERK_PUBLISHABLE_KEY) {
    const clave = `${env.CLERK_PUBLISHABLE_KEY}|${env.CLERK_EMISOR ?? ''}`;
    clerk = verificadores.get(clave);
    if (!clerk) {
      clerk = crearVerificadorClerk({
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
        ...(env.CLERK_EMISOR ? { emisor: env.CLERK_EMISOR } : {}),
        ...(env.CLERK_JWKS ? { jwks: env.CLERK_JWKS } : {}),
        ...(env.CLERK_ORIGENES ? { origenes: env.CLERK_ORIGENES.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
        cache: cacheSesionesCf,
      });
      verificadores.set(clave, clerk);
    }
  }
  return {
    config: configDesdeEnv(env, origen),
    secreto: env.SECRETO,
    cuentas,
    almacen: almacenDesdeEnv(env, origen),
    ...(clerk ? { clerk } : {}),
    ...(env.ADMIN_TOKEN ? { tokenAdmin: env.ADMIN_TOKEN } : {}),
    ...(env.ADMINS ? { admins: env.ADMINS.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
    ...(env.ORIGENES_CORS ? { origenes: env.ORIGENES_CORS.split(',').map((s) => s.trim()) } : {}),
    // El ritmo por usuario lo lleva la propia Estantería (atender): sin un salto más a otro DO.
    cacheSesiones: cacheSesionesCf,
    ...(env.CORREO ? {
      correo: async (m: MensajeCorreo) => {
        await env.CORREO!.send({
          to: m.para,
          from: { email: env.CORREO_REMITENTE ?? 'scholaris@joseluissaorin.com', name: 'Scholaris' },
          subject: m.asunto, text: m.texto, ...(m.html ? { html: m.html } : {}),
        });
        return true;
      },
    } : {}),
    atender: (usuario: UsuarioSesion, p: Request) => env.ESTANTERIA.getByName(usuario.id).atender(usuario, p),
    tiempoReal: async (p, canal) => {
      const nombre = canal.tarea ? `tarea:${canal.usuario}:${canal.tarea}` : `usuario:${canal.usuario}`;
      const h = new Headers(p.headers);
      h.set('x-scholaris-usuario', canal.usuario);
      if (canal.tarea) h.set('x-scholaris-tarea', canal.tarea);
      return env.TAREA.getByName(nombre).fetch(new Request(p.url, { headers: h }));
    },
  };
}

/** Sesiones resueltas en la Cache API de la ubicación (milisegundos, frente a un viaje a D1). */
const cacheSesionesCf = {
  async leer(clave: string): Promise<string | null> {
    const r = await caches.default.match(`https://sesiones.scholaris.interno/${encodeURIComponent(clave)}`);
    return r ? r.text() : null;
  },
  async guardar(clave: string, valor: string, segundos: number): Promise<void> {
    await caches.default.put(`https://sesiones.scholaris.interno/${encodeURIComponent(clave)}`, new Response(valor, { headers: { 'cache-control': `max-age=${segundos}` } }));
  },
  async borrar(clave: string): Promise<void> {
    await caches.default.delete(`https://sesiones.scholaris.interno/${encodeURIComponent(clave)}`);
  },
};

const esPagina = (ruta: string) => !/\.[a-z0-9]+$/i.test(ruta.split('/').pop() ?? '');

/** API, web y MCP sin OAuth (el proveedor OAuth lo envuelve más abajo). */
const normal: ExportedHandler<Env> = {
  async fetch(peticion: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(peticion.url);
    const esApi = url.pathname.startsWith(`${PREFIJO_API}/`) || url.pathname === PREFIJO_API || url.pathname === '/mcp'
      || url.pathname.startsWith(`${PREFIJO_V1}/`) || url.pathname === PREFIJO_V1;
    if (esApi) {
      return crearPuerta(plataforma(env, peticion)).fetch(peticion, env, ctx);
    }
    // La web: estáticos y, para las rutas de la SPA, index.html.
    if (!env.ASSETS) return new Response('Scholaris API', { status: 200 });
    // Páginas públicas: Markdown con «Accept: text/markdown» y cabecera Link en el HTML.
    const publica = await servirPublica(peticion, (ruta, p) => env.ASSETS!.fetch(new Request(new URL(ruta, p.url), p)));
    if (publica) return publica;
    // «/» sin sesión de Clerk: la portada estática servida en la propia raíz (200, sin redirección).
    const portada = await servirPortadaEnRaiz(peticion, (ruta) => env.ASSETS!.fetch(new Request(new URL(ruta, peticion.url), { method: 'GET', headers: peticion.headers })));
    if (portada) return portada;
    const r = recordarDemostracion(peticion, await env.ASSETS.fetch(peticion));
    if (r.status === 404 && peticion.method === 'GET' && esPagina(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), peticion));
    }
    return r;
  },
};

const conAutorizacion = conOAuth(normal, (env, u, p) => env.ESTANTERIA.getByName(u.id).atender(u, p));

export default {
  fetch: (peticion: Request, env: Env, ctx: ExecutionContext) => conAutorizacion.fetch(peticion, env, ctx),

  async queue(lote: MessageBatch<MensajeCola>, env: Env): Promise<void> {
    for (const m of lote.messages) {
      try {
        const b = m.body;
        if (b.tipo === 'vigilantes') await env.ESTANTERIA.getByName(b.usuario).vigilantes({ id: b.usuario, plan: b.plan }, b.modo);
        else if (b.tipo === 'reindexar') await env.ESTANTERIA.getByName(b.usuario).reindexar(b.usuario, b.documento);
        else if (b.tipo === 'mantenimiento') await env.ESTANTERIA.getByName(b.usuario).mantenimiento(b.usuario, b.trabajo, b.desde);
        m.ack();
      } catch (e) {
        console.error(JSON.stringify({ nivel: 'error', cola: m.body, error: (e as Error).message }));
        m.retry({ delaySeconds: Math.min(900, 60 * 2 ** Math.min(4, m.attempts)) });
      }
    }
  },

  async scheduled(evento: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cuentas = cuentasDesdeEnv(env);
    const lunes = new Date(evento.scheduledTime).getUTCDay() === 1;
    ctx.waitUntil((async () => {
      const usuarios = await cuentas.usuariosActivos(60);
      const mensajes: Array<{ body: MensajeCola }> = [];
      for (const id of usuarios) {
        const u = await cuentas.usuario(id);
        const plan = u?.plan ?? 'gratis';
        mensajes.push({ body: { tipo: 'vigilantes', usuario: id, plan, modo: 'diario' } });
        if (lunes) mensajes.push({ body: { tipo: 'vigilantes', usuario: id, plan, modo: 'semanal' } });
      }
      for (let i = 0; i < mensajes.length; i += 100) await env.COLA.sendBatch(mensajes.slice(i, i + 100));
    })());
  },
} satisfies ExportedHandler<Env, MensajeCola>;
