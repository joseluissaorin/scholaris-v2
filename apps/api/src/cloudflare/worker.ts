/**
 * Entrada del Worker de Scholaris en Cloudflare.
 *
 *   fetch      La puerta (auth, límites, binarios, tiempo real, MCP) delante
 *              de la estantería de cada usuario (Durable Object), más la web
 *              estática (apps/web/dist) con vuelta a index.html.
 *   queue      Trabajo de fondo (vigilantes programados).
 *   scheduled  Cron: encola los vigilantes diarios (y los semanales los lunes).
 */
import wasmSqlite from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
import { configurarMotor } from '@scholaris/spdf';
import { PREFIJO_API } from '@scholaris/contrato';
import { crearPuerta, type Plataforma } from '../app.js';
import { crearVerificadorClerk } from '../compartido/clerk.js';
import type { UsuarioSesion } from '../puertos.js';
import type { Env } from './env.js';
import type { MensajeCola } from './cola.js';
import { almacenDesdeEnv, configDesdeEnv, cuentasDesdeEnv, origenDe } from './puertos-cf.js';

export { Estanteria } from './estanteria-do.js';
export { Tarea } from './tarea-do.js';
export { Limitador } from './limitador-do.js';
export { FlujoIngesta } from './flujo-ingesta.js';

configurarMotor({ moduloWasm: wasmSqlite });

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
        ...(env.CLERK_ORIGENES ? { origenes: env.CLERK_ORIGENES.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
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
    ...(env.ORIGENES_CORS ? { origenes: env.ORIGENES_CORS.split(',').map((s) => s.trim()) } : {}),
    admitir: (clave, porMinuto) => env.LIMITADOR.getByName(clave).admitir(porMinuto),
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

const esPagina = (ruta: string) => !/\.[a-z0-9]+$/i.test(ruta.split('/').pop() ?? '');

export default {
  async fetch(peticion: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(peticion.url);
    const esApi = url.pathname.startsWith(`${PREFIJO_API}/`) || url.pathname === PREFIJO_API || url.pathname === '/mcp';
    if (esApi) {
      return crearPuerta(plataforma(env, peticion)).fetch(peticion, env, ctx);
    }
    // La web: estáticos y, para las rutas de la SPA, index.html.
    if (!env.ASSETS) return new Response('Scholaris API', { status: 200 });
    const r = await env.ASSETS.fetch(peticion);
    if (r.status === 404 && peticion.method === 'GET' && esPagina(url.pathname)) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), peticion));
    }
    return r;
  },

  async queue(lote: MessageBatch<MensajeCola>, env: Env): Promise<void> {
    for (const m of lote.messages) {
      try {
        const b = m.body;
        if (b.tipo === 'vigilantes') await env.ESTANTERIA.getByName(b.usuario).vigilantes({ id: b.usuario, plan: b.plan }, b.modo);
        m.ack();
      } catch (e) {
        console.error(JSON.stringify({ nivel: 'error', cola: m.body, error: (e as Error).message }));
        m.retry({ delaySeconds: 60 });
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
