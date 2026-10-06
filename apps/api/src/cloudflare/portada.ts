/**
 * «/» sin sesión: 302 a la portada estática (/acerca o /en) antes de servir la
 * aplicación, sin descargar ni React ni Clerk. Replica en el servidor el script
 * de apps/web/index.html, que sigue ahí de red de seguridad:
 *
 *   - solo «/» exacto y sin consulta: «/?entrar» y «/?demostracion» entran siempre;
 *   - con sesión de Clerk (cookie __session o __client_uat distinta de 0) se sirve la app;
 *   - la demostración se recuerda con una cookie de sesión del navegador (el
 *     script usa sessionStorage, que el servidor no ve);
 *   - idioma: Accept-Language en español (o ausente) → /acerca; si no, /en.
 *
 * El fragmento (#...) no llega al servidor; el navegador lo conserva en la redirección.
 */
export const COOKIE_DEMOSTRACION = 'scholaris_demostracion';

const conSesion = (c: string) =>
  /(?:^|;\s*)__session(?:_[^=]*)?=[^;]/.test(c) || /(?:^|;\s*)__client_uat(?:_[^=]*)?=(?!0(?:;|$))[^;]/.test(c);

/** Ruta de la portada que corresponde a «/» sin sesión (o null si se sirve la aplicación). */
export function destinoPortada(peticion: Request): '/acerca' | '/en' | null {
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') return null;
  const url = new URL(peticion.url);
  if (url.pathname !== '/' || url.search) return null;
  const c = peticion.headers.get('cookie') ?? '';
  if (conSesion(c) || new RegExp(`(?:^|;\\s*)${COOKIE_DEMOSTRACION}=1`).test(c)) return null;
  const idioma = (peticion.headers.get('accept-language') ?? 'es').trim();
  return !idioma || /^(es\b|\*)/i.test(idioma) ? '/acerca' : '/en';
}

export function redireccionPortada(peticion: Request): Response | null {
  const destino = destinoPortada(peticion);
  if (!destino) return null;
  return new Response(null, {
    status: 302,
    headers: { location: destino, 'cache-control': 'no-store', vary: 'Cookie, Accept-Language' },
  });
}

/**
 * «/» sin sesión servida DIRECTAMENTE (200 con el HTML de la portada), no con un 302:
 * curl, fetch y las herramientas de los agentes que no siguen redirecciones leen el
 * contenido a la primera. La canónica sigue siendo /acerca (o /en).
 */
export async function servirPortadaEnRaiz(peticion: Request, estaticos: (ruta: string) => Promise<Response>): Promise<Response | null> {
  const destino = destinoPortada(peticion);
  if (!destino) return null;
  const r = await estaticos(destino);
  if (!r.ok) return redireccionPortada(peticion);
  const nueva = new Response(peticion.method === 'HEAD' ? null : r.body, { status: 200, headers: r.headers });
  const origen = new URL(peticion.url).origin;
  nueva.headers.set('content-location', destino);
  nueva.headers.append('link', `<${origen}${destino}>; rel="canonical"`);
  nueva.headers.set('cache-control', 'no-store');
  nueva.headers.set('vary', 'Cookie, Accept-Language, Accept');
  return nueva;
}

/** «/?demostracion»: la app se sirve tal cual y se recuerda la visita mientras dure el navegador. */
export function recordarDemostracion(peticion: Request, r: Response): Response {
  const url = new URL(peticion.url);
  if (url.pathname !== '/' || !url.searchParams.has('demostracion') || !r.ok) return r;
  const nueva = new Response(r.body, r);
  nueva.headers.append('set-cookie', `${COOKIE_DEMOSTRACION}=1; Path=/; Secure; SameSite=Lax`);
  nueva.headers.set('cache-control', 'no-store');
  return nueva;
}
