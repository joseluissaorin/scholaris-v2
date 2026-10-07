/**
 * Todo lo que se escribe al construir para personas, buscadores y agentes:
 * cada hoja en HTML y en Markdown, los gemelos .md de la portada y de la guía,
 * /llms.txt, /llms-full.txt, robots.txt, sitemap.xml, los ficheros de
 * /.well-known y las cabeceras de los estáticos (_headers).
 *
 * `ficheros(fechas)` devuelve [ruta en dist, contenido]; vite-publico.ts los
 * escribe (y los sirve en desarrollo).
 */
import { AUTOR, ORIGEN, OTRAS_PUBLICAS, PAGINAS, REPOSITORIO, cuerpoMd, enlacesParaMd, ficheroHtml, markdown, pagina, rutaDe, rutaMd, type Lengua, type Pagina } from './sitio';
import { fichaDe, guiaMd, portadaMd } from './gemelos';
import { TEXTOS_VIDEO, VIDEO, videoMd } from '../portada/video';

/** Fecha (AAAA-MM-DD) de la última revisión de cada ruta pública. */
export type Fechas = (ruta: string) => string;

const OTRA: Record<Lengua, Lengua> = { es: 'en', en: 'es' };

/** Todas las rutas públicas con su gemelo .md, su lengua y su alterna. */
export function rutasPublicas(): { ruta: string; lengua: Lengua; alterna: string; titulo: string; descripcion: string; pagina?: Pagina }[] {
  const otras = OTRAS_PUBLICAS.map((o) => ({ ...o, ...fichaDe(o.ruta) }));
  const hojas = PAGINAS.flatMap((p) => (['es', 'en'] as const).map((l) => ({ ruta: rutaDe(p, l), lengua: l, alterna: rutaDe(p, OTRA[l]), titulo: p[l].titulo, descripcion: p[l].descripcion, pagina: p })));
  return [...otras, ...hojas];
}

function llmsTxt(): string {
  const hoja = (p: Pagina, l: Lengua) => `- [${p[l].titulo}](${ORIGEN}${rutaMd(rutaDe(p, l))}): ${p[l].descripcion}`;
  const saber = PAGINAS.filter((p) => p.clave !== 'indice' && p.clave !== 'agentes');
  const indice = PAGINAS.find((p) => p.clave === 'indice')!;
  const agentes = PAGINAS.find((p) => p.clave === 'agentes')!;
  return `# Scholaris

> Scholaris lee libros, artículos, apuntes, entrevistas y vídeos y, cuando le preguntas, señala el pasaje con su página impresa o su segundo exactos. Las citas salen del ancla guardada al leer y se comprueban contra el texto: nunca se inventan. (Scholaris reads books, papers, notes, interviews and videos and, when asked, points to the passage with its exact printed page or second. Citations come from the anchor stored at reading time and are checked against the text: they are never invented.)

Hecho por ${AUTOR.nombre} (${AUTOR.web}), Santa Cruz de Tenerife. Aplicación web en ${ORIGEN}, con API v1, servidor MCP y versión local. Cada página pública tiene un gemelo en Markdown (la misma dirección terminada en .md) y también responde en Markdown a \`Accept: text/markdown\`. Todo el texto de estas páginas, junto, está en ${ORIGEN}/llms-full.txt.

## Para agentes / For agents

- [${agentes.es.titulo}](${ORIGEN}${rutaMd(rutaDe(agentes, 'es'))}): ${agentes.es.descripcion}
- [${agentes.en.titulo}](${ORIGEN}${rutaMd(rutaDe(agentes, 'en'))}): ${agentes.en.descripcion}
- [Instrucciones de la API v1 para modelos (llms.txt de la API)](${ORIGEN}/api/v1/llms.txt): verbos, campos y reglas para citar sin inventar.
- [OpenAPI 3.1 de la API v1](${ORIGEN}/api/v1/openapi.json)
- [Servidor MCP](${ORIGEN}/mcp): Streamable HTTP con OAuth 2.1 o clave con alcance mcp; tarjeta en ${ORIGEN}/.well-known/mcp/server-card.json

## Base de conocimiento (castellano)

- [${indice.es.titulo}](${ORIGEN}${rutaMd(rutaDe(indice, 'es'))}): ${indice.es.descripcion}
${saber.map((p) => hoja(p, 'es')).join('\n')}

## Knowledge base (English)

- [${indice.en.titulo}](${ORIGEN}${rutaMd(rutaDe(indice, 'en'))}): ${indice.en.descripcion}
${saber.map((p) => hoja(p, 'en')).join('\n')}

## Portada y guía de la API / Front page and API guide

${OTRAS_PUBLICAS.map((o) => { const f = fichaDe(o.ruta); return `- [${f.titulo}](${ORIGEN}${o.ruta}.md): ${f.descripcion}`; }).join('\n')}

## Vídeo de demostración / Demo video

${videoMd('es', ORIGEN, '/acerca')}

## Optional

- [Todo el texto, en las dos lenguas / Full text, both languages](${ORIGEN}/llms-full.txt)
- [Sitemap](${ORIGEN}/sitemap.xml)
- [SDK de Python (PyPI: scholaris-sdk)](https://pypi.org/project/scholaris-sdk/)
`;
}

function llmsFull(f: Fechas): string {
  const partes = [`# Scholaris: todas las páginas públicas / all public pages

Fuente / source: ${ORIGEN}/llms.txt · Generado / generated: ${f('/')}
`];
  for (const l of ['es', 'en'] as const) {
    partes.push(`\n# ===== ${l === 'es' ? 'CASTELLANO' : 'ENGLISH'} =====\n`);
    for (const p of PAGINAS) {
      partes.push(`\n---\n\n# ${p[l].titulo}\n\nURL: ${ORIGEN}${rutaDe(p, l)}\n\n> ${p[l].descripcion}\n\n${enlacesParaMd(cuerpoMd(p, l)).trim()}\n`);
    }
    for (const o of OTRAS_PUBLICAS.filter((x) => x.lengua === l)) {
      const texto = o.ruta.endsWith('api') ? guiaMd(l, f(o.ruta)) : portadaMd(l, f(o.ruta));
      partes.push(`\n---\n\nURL: ${ORIGEN}${o.ruta}\n\n${texto.replace(/^---[\s\S]*?---\n/, '').trim()}\n`);
    }
  }
  return partes.join('');
}

/** Rastreadores de IA a los que se da la bienvenida, uno por uno. */
export const RASTREADORES_IA = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent',
  'Amazonbot', 'DuckAssistBot', 'MistralAI-User', 'cohere-ai', 'Bytespider',
];

function robots(): string {
  // Todo lo público abierto por defecto; solo se cierran las rutas privadas. Sin comodines «$» ni «*»:
  // muchos lectores de robots.txt de agentes no los entienden y, con «Disallow: /», daban el sitio por cerrado.
  const privado = [
    '/api/v2/', '/mcp', '/oauth/', '/authorize', '/token', '/register',
    '/administracion', '/ajustes', '/buscar', '/compartida', '/documentos', '/escribir', '/explorar',
    '/invitaciones', '/lector', '/lotes', '/recibir', '/binarios', '/tiempo-real',
  ];
  const abierto = ['/', '/demo/', '/api/v1/openapi.json', '/api/v1/llms.txt'];
  const reglas = [...abierto.map((r) => `Allow: ${r}`), ...privado.map((r) => `Disallow: ${r}`)].join('\n');
  const senal = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';
  const bloques = [
    `# Scholaris. Lo público (la portada, la base de conocimiento /saber, la guía de la API y /agentes)
# se puede leer, indexar, citar y usar para responder o entrenar. La aplicación, la API y las
# bibliotecas de las personas, no. Índice para agentes: ${ORIGEN}/llms.txt
# Public pages are welcome to search engines and AI crawlers; the app, the API and people's
# libraries are not. Index for agents: ${ORIGEN}/llms.txt

User-agent: *
${senal}
${reglas}`,
    ...RASTREADORES_IA.map((b) => `User-agent: ${b}\n${senal}\n${reglas}`),
  ];
  return `${bloques.join('\n\n')}\n\nSitemap: ${ORIGEN}/sitemap.xml\n`;
}

const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** La demostración en vídeo, en la entrada de la portada de cada lengua. */
function videoSitemap(l: Lengua): string {
  const v = TEXTOS_VIDEO[l];
  return `
    <video:video>
      <video:thumbnail_loc>${ORIGEN}${VIDEO.poster}</video:thumbnail_loc>
      <video:title>${xml(v.nombre)}</video:title>
      <video:description>${xml(v.descripcion)}</video:description>
      <video:content_loc>${ORIGEN}${VIDEO.mp4}</video:content_loc>
      <video:duration>${VIDEO.segundos}</video:duration>
      <video:publication_date>${VIDEO.publicado}</video:publication_date>
      <video:family_friendly>yes</video:family_friendly>
    </video:video>`;
}

function sitemap(f: Fechas): string {
  const urls = rutasPublicas().map((r) => {
    const [es, en] = r.lengua === 'es' ? [r.ruta, r.alterna] : [r.alterna, r.ruta];
    const prioridad = r.ruta === '/acerca' || r.ruta === '/en' ? '1.0' : r.pagina?.clave === 'indice' || r.pagina?.clave === 'agentes' ? '0.9' : '0.7';
    return `  <url>
    <loc>${ORIGEN}${r.ruta}</loc>
    <lastmod>${f(r.ruta)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${prioridad}</priority>
    <xhtml:link rel="alternate" hreflang="es" href="${ORIGEN}${es}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${ORIGEN}${en}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGEN}${es}"/>${r.ruta === '/acerca' || r.ruta === '/en' ? videoSitemap(r.lengua) : ''}
  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${urls.join('\n')}
</urlset>
`;
}

function tarjetaMcp(): string {
  return JSON.stringify({
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json',
    name: 'com.joseluissaorin.scholaris/biblioteca',
    title: 'Scholaris',
    description: 'Busca en tu biblioteca de Scholaris y cita con la página impresa o el segundo exactos; verifica afirmaciones. Search your Scholaris library and cite with the exact printed page or second; verify claims.',
    version: '2.0.0',
    websiteUrl: `${ORIGEN}/saber/api-y-mcp`,
    remotes: [{ type: 'streamable-http', url: `${ORIGEN}/mcp` }],
    supportedProtocolVersions: ['2025-06-18', '2025-03-26'],
    icons: [{ src: `${ORIGEN}/portada/logo-192.webp`, mimeType: 'image/webp', sizes: ['192x192'] }],
    _meta: {
      'com.joseluissaorin.scholaris/autenticacion': {
        oauth: `${ORIGEN}/.well-known/oauth-protected-resource/mcp`,
        clave: 'Authorization: Bearer sch_… (alcance «mcp»)',
      },
      'com.joseluissaorin.scholaris/herramientas': ['search', 'cite', 'open_page', 'verify_claim'],
      'com.joseluissaorin.scholaris/documentacion': [`${ORIGEN}/saber/api-y-mcp.md`, `${ORIGEN}/en/knowledge/api-and-mcp.md`, `${ORIGEN}/agentes.md`],
    },
  }, null, 2);
}

function catalogoApi(): string {
  return JSON.stringify({
    linkset: [{
      anchor: `${ORIGEN}/api/v1`,
      'service-desc': [{ href: `${ORIGEN}/api/v1/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1' }],
      'service-doc': [{ href: `${ORIGEN}/api`, type: 'text/html', hreflang: ['es'] }, { href: `${ORIGEN}/en/api`, type: 'text/html', hreflang: ['en'] }, { href: `${ORIGEN}/saber/api-y-mcp.md`, type: 'text/markdown' }],
      'service-meta': [{ href: `${ORIGEN}/api/v1/llms.txt`, type: 'text/plain' }],
    }, {
      anchor: `${ORIGEN}/mcp`,
      'service-desc': [{ href: `${ORIGEN}/.well-known/mcp/server-card.json`, type: 'application/json' }],
      'service-doc': [{ href: `${ORIGEN}/agentes`, type: 'text/html', hreflang: ['es'] }, { href: `${ORIGEN}/en/agents`, type: 'text/html', hreflang: ['en'] }],
    }],
  }, null, 2);
}

function seguridad(): string {
  const caduca = new Date(Date.now() + 365 * 86400_000).toISOString().replace(/\.\d+Z$/, 'Z');
  return `Contact: mailto:${AUTOR.correo}
Expires: ${caduca}
Preferred-Languages: es, en
Canonical: ${ORIGEN}/.well-known/security.txt
Policy: ${ORIGEN}/saber/privacidad
`;
}

function habilidades(): string {
  return JSON.stringify({
    $schema: 'https://agentskills.io/schema/v0.2.0.json',
    version: '0.2.0',
    skills: [
      { name: 'scholaris-api-v1', type: 'api', description: 'Subir, buscar, preguntar, citar y verificar sobre la biblioteca de una persona. Upload, search, ask, cite and verify over a person’s library.', url: `${ORIGEN}/api/v1/llms.txt` },
      { name: 'scholaris-agentes', type: 'docs', description: 'Cómo usar Scholaris en nombre de alguien: acceso, límites y reglas para citar. How to use Scholaris on someone’s behalf.', url: `${ORIGEN}/agentes.md` },
      { name: 'scholaris-saber', type: 'docs', description: 'La base de conocimiento entera en Markdown. The whole knowledge base as Markdown.', url: `${ORIGEN}/llms-full.txt` },
    ],
  }, null, 2);
}

/**
 * Cabeceras de los estáticos (las lee Cloudflare al servir dist/). Las páginas
 * HTML pasan antes por el Worker, que añade el Link y negocia el Markdown.
 */
function cabeceras(): string {
  const agente = `  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=600\n  X-Robots-Tag: index, follow`;
  return `/*.md
  Content-Type: text/markdown; charset=utf-8
${agente}

/llms.txt
  Content-Type: text/plain; charset=utf-8
${agente}

/llms-full.txt
  Content-Type: text/plain; charset=utf-8
${agente}

/robots.txt
  Cache-Control: public, max-age=600

/sitemap.xml
  Content-Type: application/xml; charset=utf-8
  Cache-Control: public, max-age=600

/.well-known/api-catalog
  Content-Type: application/linkset+json
${agente}

/.well-known/mcp/*
  Content-Type: application/json
${agente}

/.well-known/agent-skills/*
${agente}

/.well-known/security.txt
  Content-Type: text/plain; charset=utf-8

/portada/demo/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/portada/demo/*.vtt
  Content-Type: text/vtt; charset=utf-8
`;
}

export function ficheros(f: Fechas): [string, string][] {
  const fuera: [string, string][] = [];
  for (const p of PAGINAS) {
    for (const l of ['es', 'en'] as const) {
      const ruta = rutaDe(p, l);
      fuera.push([ficheroHtml(ruta), pagina(p, l, f(ruta))]);
      fuera.push([rutaMd(ruta).slice(1), markdown(p, l, f(ruta))]);
    }
  }
  for (const o of OTRAS_PUBLICAS) {
    const texto = o.ruta.endsWith('api') ? guiaMd(o.lengua, f(o.ruta)) : portadaMd(o.lengua, f(o.ruta));
    fuera.push([rutaMd(o.ruta).slice(1), texto]);
  }
  fuera.push(['llms.txt', llmsTxt()]);
  fuera.push(['llms-full.txt', llmsFull(f)]);
  fuera.push(['robots.txt', robots()]);
  fuera.push(['sitemap.xml', sitemap(f)]);
  fuera.push(['.well-known/mcp/server-card.json', tarjetaMcp()]);
  fuera.push(['.well-known/mcp/server-cards.json', JSON.stringify({ servers: [JSON.parse(tarjetaMcp())] }, null, 2)]);
  fuera.push(['.well-known/api-catalog', catalogoApi()]);
  fuera.push(['.well-known/security.txt', seguridad()]);
  fuera.push(['.well-known/agent-skills/index.json', habilidades()]);
  fuera.push(['_headers', cabeceras()]);
  void REPOSITORIO;
  return fuera;
}
