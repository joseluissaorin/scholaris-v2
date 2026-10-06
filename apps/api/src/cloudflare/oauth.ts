/**
 * OAuth 2.1 para el servidor MCP (workers-oauth-provider), con Clerk como
 * identidad. Así, un cliente MCP (Claude, el que sea) se registra solo, manda
 * a la persona a /oauth/autorizar, esta entra con Clerk y concede acceso, y el
 * cliente recibe un token que vale solo para /mcp.
 *
 * Además, /mcp sigue aceptando las claves de API personales (sch_…) y el token
 * de sesión de Clerk: el proveedor los valida con `resolveExternalToken`.
 */
import { OAuthProvider, type AuthRequest, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { PREFIJO_API } from '@scholaris/contrato';
import type { UsuarioSesion } from '../puertos.js';
import { crearVerificadorClerk, emisorDesdeClave } from '../compartido/clerk.js';
import type { Env } from './env.js';
import { cuentasDesdeEnv, origenDe } from './puertos-cf.js';

type EnvOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers };

interface Props { usuario: string; via: 'oauth' | 'clave_api' | 'clerk'; alcances: string[] }

const verificadores = new Map<string, ReturnType<typeof crearVerificadorClerk>>();
function clerkDe(env: Env) {
  if (!env.CLERK_PUBLISHABLE_KEY) return null;
  let v = verificadores.get(env.CLERK_PUBLISHABLE_KEY);
  if (!v) {
    v = crearVerificadorClerk({ publishableKey: env.CLERK_PUBLISHABLE_KEY, ...(env.CLERK_EMISOR ? { emisor: env.CLERK_EMISOR } : {}), ...(env.CLERK_JWKS ? { jwks: env.CLERK_JWKS } : {}) });
    verificadores.set(env.CLERK_PUBLISHABLE_KEY, v);
  }
  return v;
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** La página de autorización: entra con Clerk y concede el acceso. */
function paginaAutorizar(env: Env, cliente: string, consulta: string): Response {
  const pk = env.CLERK_PUBLISHABLE_KEY ?? '';
  const frontal = pk ? emisorDesdeClave(pk) : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar ${escapar(cliente)} con Scholaris</title>
<style>body{font-family:Georgia,serif;background:#f6f1e7;color:#2b2622;max-width:34rem;margin:8vh auto;padding:0 1.2rem;line-height:1.5}
h1{font-weight:normal;font-size:1.6rem}button{font:inherit;background:#b5523b;color:#fff;border:0;border-radius:.4rem;padding:.6rem 1.2rem;cursor:pointer}
button[disabled]{opacity:.5}.nota{color:#6b625a;font-size:.95rem}#acceso{margin:1.5rem 0}</style></head>
<body><h1>¿Dejas que <strong>${escapar(cliente)}</strong> consulte tu biblioteca?</h1>
<p>Podrá buscar en tus documentos, abrir sus páginas, citar y verificar afirmaciones. No podrá subir, cambiar ni borrar nada.</p>
<div id="acceso"></div><p><button id="permitir" disabled>Permitir el acceso</button></p>
<p class="nota" id="estado">Comprobando tu sesión…</p>
<script async crossorigin="anonymous" data-clerk-publishable-key="${escapar(pk)}" src="${escapar(frontal)}/npm/@clerk/clerk-js@5/dist/clerk.browser.js"></script>
<script>
const consulta = ${JSON.stringify(consulta)};
const estado = document.getElementById('estado'), boton = document.getElementById('permitir');
async function preparar() {
  await window.Clerk.load();
  if (!window.Clerk.user) { estado.textContent = 'Entra con tu cuenta de Scholaris para continuar.'; window.Clerk.mountSignIn(document.getElementById('acceso'), { forceRedirectUrl: location.href }); return; }
  estado.textContent = 'Has entrado como ' + (window.Clerk.user.primaryEmailAddress?.emailAddress ?? window.Clerk.user.id) + '.';
  boton.disabled = false;
}
boton.onclick = async () => {
  boton.disabled = true; estado.textContent = 'Concediendo el acceso…';
  const token = await window.Clerk.session.getToken();
  const r = await fetch('/oauth/autorizar/completar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consulta, token }) });
  const j = await r.json();
  if (j.redirectTo) location.href = j.redirectTo; else { estado.textContent = j.error?.mensaje ?? 'No se pudo conceder el acceso.'; boton.disabled = false; }
};
(function esperar() { window.Clerk ? preparar() : setTimeout(esperar, 50); })();
</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}

/** Rutas propias de la autorización (las llama el defaultHandler). */
export async function rutasOAuth(peticion: Request, env: EnvOAuth): Promise<Response | null> {
  const url = new URL(peticion.url);
  if (url.pathname === '/oauth/autorizar' && peticion.method === 'GET') {
    let solicitud: AuthRequest;
    try { solicitud = await env.OAUTH_PROVIDER.parseAuthRequest(peticion); } catch (e) {
      return new Response(`Solicitud de autorización no válida: ${(e as Error).message}`, { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const cliente = await env.OAUTH_PROVIDER.lookupClient(solicitud.clientId);
    return paginaAutorizar(env, cliente?.clientName ?? 'Una aplicación', url.search);
  }
  if (url.pathname === '/oauth/autorizar/completar' && peticion.method === 'POST') {
    const b = (await peticion.json().catch(() => ({}))) as { consulta?: string; token?: string };
    const error = (mensaje: string, estado = 400) => Response.json({ error: { codigo: 'no_autenticado', mensaje } }, { status: estado });
    if (!b.consulta || !b.token) return error('Faltan la solicitud o la sesión.');
    const clerk = clerkDe(env);
    const id = clerk ? await clerk(b.token) : null;
    if (!id) return error('La sesión no es válida. Vuelve a entrar.', 401);
    const original = new Request(`${url.origin}/oauth/autorizar${b.consulta.startsWith('?') ? b.consulta : `?${b.consulta}`}`);
    let solicitud: AuthRequest;
    try { solicitud = await env.OAUTH_PROVIDER.parseAuthRequest(original); } catch (e) { return error(`Solicitud no válida: ${(e as Error).message}`); }
    await cuentasDesdeEnv(env).asegurarUsuario({ id: id.id, correo: id.correo, nombre: id.nombre, plan: id.plan, ...(id.imagen ? { imagen: id.imagen } : {}) });
    const props: Props = { usuario: id.id, via: 'oauth', alcances: ['mcp', 'lectura'] };
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: solicitud, userId: encodeURIComponent(id.id), metadata: { concedido: new Date().toISOString() }, scope: ['mcp'], props,
    });
    return Response.json({ redirectTo });
  }
  return null;
}

/** /mcp protegido: el usuario sale de ctx.props y la petición va a su estantería. */
function manejadorMcp(atender: (env: Env, u: UsuarioSesion, p: Request) => Promise<Response>) {
  return {
    async fetch(peticion: Request, env: Env, ctx: ExecutionContext & { props?: Props }): Promise<Response> {
      const props = ctx.props;
      if (!props?.usuario) return new Response('Sin autorización', { status: 401 });
      const u = await cuentasDesdeEnv(env).usuario(props.usuario);
      if (!u) return new Response('La cuenta ya no existe', { status: 401 });
      const sesion: UsuarioSesion = { ...u, funciones: u.plan === 'pro' ? ['scholaris'] : [], via: props.via === 'clerk' ? 'clerk' : 'clave_api', alcances: props.alcances };
      const destino = new URL(peticion.url);
      destino.pathname = `${PREFIJO_API}/mcp`;
      return atender(env, sesion, new Request(destino.toString(), peticion));
    },
  };
}

/** Envuelve el manejador del Worker con el proveedor OAuth (uno por origen). */
export function conOAuth(normal: ExportedHandler<Env>, atender: (env: Env, u: UsuarioSesion, p: Request) => Promise<Response>) {
  const proveedores = new Map<string, OAuthProvider<Env>>();
  const proveedorPara = (origen: string) => {
    let p = proveedores.get(origen);
    if (!p) {
      p = new OAuthProvider<Env>({
        apiRoute: '/mcp',
        apiHandler: manejadorMcp(atender) as never,
        defaultHandler: {
          async fetch(peticion, env, ctx) {
            const r = await rutasOAuth(peticion, env as EnvOAuth);
            return r ?? normal.fetch!(peticion as never, env, ctx);
          },
        },
        authorizeEndpoint: '/oauth/autorizar',
        tokenEndpoint: '/oauth/token',
        clientRegistrationEndpoint: '/oauth/registro',
        scopesSupported: ['mcp'],
        accessTokenTTL: 3600,
        resourceMetadata: { resource: `${origen}/mcp`, resource_name: 'Scholaris: tu biblioteca' },
        resolveExternalToken: async ({ token, env }) => {
          const cuentas = cuentasDesdeEnv(env);
          if (token.startsWith('sch_')) {
            const k = await cuentas.autenticarClave(token);
            if (!k || !k.alcances.includes('mcp')) return null;
            return { props: { usuario: k.usuario, via: 'clave_api', alcances: k.alcances } satisfies Props, audience: `${origen}/mcp` };
          }
          const clerk = clerkDe(env);
          const id = clerk ? await clerk(token) : null;
          if (!id) return null;
          await cuentas.asegurarUsuario({ id: id.id, correo: id.correo, nombre: id.nombre, plan: id.plan });
          return { props: { usuario: id.id, via: 'clerk', alcances: ['mcp', 'lectura'] } satisfies Props, audience: `${origen}/mcp` };
        },
      });
      proveedores.set(origen, p);
    }
    return p;
  };
  return {
    fetch(peticion: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      if (!env.OAUTH_KV) return normal.fetch!(peticion as never, env, ctx) as Promise<Response>;
      return proveedorPara(origenDe(env, peticion)).fetch(peticion, env, ctx);
    },
  };
}
