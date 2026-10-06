/**
 * Las páginas públicas para personas y agentes (portada, /saber, /agentes, la
 * guía de la API): cada una tiene un gemelo .md generado al construir la web.
 *
 *   - Con `Accept: text/markdown` (preferido a text/html), la página se sirve
 *     en Markdown, con `Vary: Accept`.
 *   - En HTML, se añade una cabecera `Link` con el gemelo, /llms.txt y la
 *     especificación OpenAPI, para que un agente lo encuentre sin leer el HTML.
 *
 * Lo usan el Worker de Cloudflare y la versión local; `leer` es la manera de
 * pedir un estático en cada sitio (env.ASSETS.fetch o el disco).
 */

/** Rutas públicas que tienen gemelo .md (sin barra final). */
const PUBLICAS = /^\/(acerca|en|api|en\/api|saber(\/[a-z0-9-]+)?|agentes|en\/knowledge(\/[a-z0-9-]+)?|en\/agents)$/;

export function esPaginaPublica(ruta: string): boolean {
  return PUBLICAS.test(ruta.replace(/\/$/, '') || '/');
}

/** ¿Prefiere el cliente Markdown? (text/markdown con más peso que text/html, o sin text/html). */
export function prefiereMarkdown(accept: string | null): boolean {
  if (!accept || !/text\/markdown|text\/x-markdown/i.test(accept)) return false;
  const peso = (tipo: RegExp) => {
    let max = -1;
    for (const parte of accept.split(',')) {
      const [t, ...params] = parte.trim().split(';');
      if (!tipo.test(t!.trim())) continue;
      const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
      max = Math.max(max, q ? Number(q) : 1);
    }
    return max;
  };
  return peso(/^text\/(x-)?markdown$/i) >= peso(/^text\/html$/i);
}

function cabeceraLink(origen: string, ruta: string): string {
  return [
    `<${origen}${ruta}.md>; rel="alternate"; type="text/markdown"`,
    `<${origen}/llms.txt>; rel="describedby"; type="text/plain"`,
    `<${origen}/api/v1/openapi.json>; rel="service-desc"; type="application/json"`,
    `<${origen}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
  ].join(', ');
}

/**
 * Atiende una petición a una página pública: Markdown si se pide, y el HTML con
 * su Link. Devuelve null si la ruta no es pública (o no es GET/HEAD).
 */
export async function servirPublica(
  peticion: Request,
  leer: (ruta: string, peticion: Request) => Promise<Response | null>,
): Promise<Response | null> {
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') return null;
  const url = new URL(peticion.url);
  const ruta = url.pathname.replace(/\/$/, '') || '/';
  const md = prefiereMarkdown(peticion.headers.get('accept'));
  // «/» en Markdown: el índice para agentes.
  if (ruta === '/' && md) {
    const r = await leer('/llms.txt', peticion);
    if (!r || !r.ok) return null;
    return conCabeceras(r, { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept, Cookie, Accept-Language', link: cabeceraLink(url.origin, '/acerca') });
  }
  // El gemelo pedido por su nombre: con su tipo y abierto a cualquier origen.
  if (ruta.endsWith('.md') && esPaginaPublica(ruta.slice(0, -3))) {
    const r = await leer(ruta, peticion);
    if (!r) return null;
    if (!r.ok) return r;
    if (/text\/html/i.test(r.headers.get('content-type') ?? '')) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return conCabeceras(r, {
      'content-type': 'text/markdown; charset=utf-8', 'access-control-allow-origin': '*',
      link: `<${url.origin}${ruta.slice(0, -3)}>; rel="canonical"; type="text/html"`,
    });
  }
  if (!esPaginaPublica(ruta)) return null;
  if (md) {
    const r = await leer(`${ruta}.md`, peticion);
    if (r && r.ok && !/text\/html/i.test(r.headers.get('content-type') ?? '')) {
      return conCabeceras(r, {
        'content-type': 'text/markdown; charset=utf-8', vary: 'Accept', 'access-control-allow-origin': '*',
        'content-location': `${ruta}.md`, link: `<${url.origin}${ruta}>; rel="alternate"; type="text/html"`,
      });
    }
  }
  const r = await leer(ruta, peticion);
  if (!r) return null;
  if (!r.ok || !/text\/html/i.test(r.headers.get('content-type') ?? '')) return r;
  return conCabeceras(r, { vary: 'Accept', link: cabeceraLink(url.origin, ruta) });
}

function conCabeceras(r: Response, extra: Record<string, string>): Response {
  const nueva = new Response(r.body, r);
  for (const [k, v] of Object.entries(extra)) nueva.headers.set(k, v);
  return nueva;
}
