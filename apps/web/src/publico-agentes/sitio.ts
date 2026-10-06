/**
 * La parte pública que leen las personas, los buscadores y los agentes: la base
 * de conocimiento (/saber, /en/knowledge) y la página para agentes (/agentes,
 * /en/agents). Cada página se escribe una sola vez en Markdown (contenido/) y
 * de ahí salen, al construir, su HTML estático (sin JavaScript para leerla) y
 * su gemelo .md, con JSON-LD, Open Graph, canónica y hreflang.
 *
 * Además: /llms.txt, /llms-full.txt, robots.txt, sitemap.xml y los ficheros de
 * /.well-known (ver vite-publico.ts).
 */
import cssPortada from '../portada/portada.css?raw';
import cssGuia from '../guia-api/guia.css?raw';
import css from './publico.css?raw';
import { aSvg, type Dibujo } from '../dibujo/boceto';
import { CSS_TINTAS } from '../dibujo/tintas';
import { aHtml, idDe, textoPlano, type Encabezado } from './md';
import { PAGINAS, type Lengua, type Pagina } from './contenido';

export type { Lengua, Pagina };
export { PAGINAS };

import { ORIGEN } from './origen';
export { ORIGEN };
export const AUTOR = { nombre: 'José Luis Saorín Ferrer', web: 'https://joseluissaorin.com', correo: 'jl@joseluissaorin.com' };
export const REPOSITORIO = 'https://github.com/joseluissaorin/scholaris-v2';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const OTRA: Record<Lengua, Lengua> = { es: 'en', en: 'es' };

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export function rutaDe(p: Pagina, l: Lengua): string {
  return p.rutas[l];
}
/** El fichero HTML que sirve una ruta (Cloudflare encuentra /saber/x en saber/x.html). */
export const ficheroHtml = (ruta: string) => `${ruta.slice(1)}.html`;
export const rutaMd = (ruta: string) => `${ruta}.md`;

/** Las páginas públicas que ya existían (portada y guía de la API), con sus gemelos .md. */
export const OTRAS_PUBLICAS: { ruta: string; lengua: Lengua; alterna: string }[] = [
  { ruta: '/acerca', lengua: 'es', alterna: '/en' },
  { ruta: '/en', lengua: 'en', alterna: '/acerca' },
  { ruta: '/api', lengua: 'es', alterna: '/en/api' },
  { ruta: '/en/api', lengua: 'en', alterna: '/api' },
];

// ---------------------------------------------------------------------------
// Textos de la interfaz
// ---------------------------------------------------------------------------

const UI = {
  es: {
    saltar: 'Saltar al texto', principal: 'Principal', pie: 'Pie', saber: 'Saber', api: 'API', agentes: 'Agentes', entrar: 'Entrar',
    indice: 'La base de conocimiento', formatos: 'Para máquinas', enEsta: 'En esta página', migas: 'Estás en',
    revisado: 'Revisado el', markdown: 'Esta página en Markdown', anterior: 'Anterior', siguiente: 'Siguiente',
    copiar: 'Copiar', copiado: 'Copiado', inicio: 'Scholaris', lema: 'una biblioteca leída y citable', otra: 'English',
    otraTitulo: 'Read this page in English',
  },
  en: {
    saltar: 'Skip to the text', principal: 'Main', pie: 'Footer', saber: 'Knowledge', api: 'API', agentes: 'Agents', entrar: 'Sign in',
    indice: 'The knowledge base', formatos: 'For machines', enEsta: 'On this page', migas: 'You are in',
    revisado: 'Reviewed on', markdown: 'This page as Markdown', anterior: 'Previous', siguiente: 'Next',
    copiar: 'Copy', copiado: 'Copied', inicio: 'Scholaris', lema: 'a library, read and citable', otra: 'Español',
    otraTitulo: 'Lee esta página en español',
  },
} as const;

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function compactar(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
}
/** Los primitivos de la portada (variables, papel, botones, cabecera, pie), sin el titular ni los folios. */
function primitivos(c: string): string {
  const corte = c.indexOf('Folio primero');
  const base = corte < 0 ? c : c.slice(0, c.lastIndexOf('/* ----', corte));
  const pie = /\.pie \{[\s\S]*?\.pie a \{[^}]*\}/.exec(c)?.[0] ?? '';
  return `${base}${pie}.dibujo{overflow:visible}.dibujo .c-pl,.dibujo .c-co,.dibujo .c-en{mix-blend-mode:multiply}.dibujo .nt{font-family:var(--mano)}`;
}
let cssListo = '';
const estilos = () => (cssListo ||= `:root{${CSS_TINTAS}}${compactar(primitivos(cssPortada))}${compactar(cssGuia)}${compactar(css)}`);

const SCRIPT = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.copiar');if(!b)return;var c=b.parentNode.querySelector('code').innerText;navigator.clipboard.writeText(c).then(function(){var o=b.textContent;b.textContent=b.getAttribute('data-copiado')||'✓';b.classList.add('hecho');setTimeout(function(){b.textContent=o;b.classList.remove('hecho')},1600)})});`;

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

export const ID = {
  autor: `${ORIGEN}/#autor`,
  sitio: `${ORIGEN}/#sitio`,
  app: `${ORIGEN}/#aplicacion`,
};

function persona() {
  return {
    '@type': 'Person', '@id': ID.autor, name: AUTOR.nombre, url: AUTOR.web, email: AUTOR.correo,
    jobTitle: 'Filólogo y programador',
    address: { '@type': 'PostalAddress', addressLocality: 'Santa Cruz de Tenerife', addressRegion: 'Canarias', addressCountry: 'ES' },
    sameAs: ['https://github.com/joseluissaorin', 'https://www.linkedin.com/in/jos%C3%A9-luis-saor%C3%ADn-ferrer-0372b5192'],
  };
}

export function aplicacion(l: Lengua) {
  return {
    '@type': 'SoftwareApplication', '@id': ID.app, name: 'Scholaris', url: `${ORIGEN}${l === 'es' ? '/acerca' : '/en'}`,
    applicationCategory: 'EducationalApplication', applicationSubCategory: l === 'es' ? 'Gestión de citas y bibliografía' : 'Citation and reference management',
    operatingSystem: 'Web, macOS, Linux, Windows', softwareVersion: '2',
    description: l === 'es'
      ? 'Scholaris lee libros, artículos, apuntes, audio y vídeo, y al preguntarle señala el pasaje con su página impresa o su segundo exactos. Las citas se comprueban contra el texto: nunca se inventan.'
      : 'Scholaris reads books, papers, notes, audio and video and, when asked, points to the passage with its exact printed page or second. Citations are checked against the text: they are never invented.',
    image: `${ORIGEN}/portada/tarjeta-${l}.png`,
    author: { '@id': ID.autor }, creator: { '@id': ID.autor },
    inLanguage: ['es', 'en'],
    featureList: l === 'es'
      ? ['Página impresa exacta (folio) en PDF, escaneados y EPUB', 'Segundo exacto en audio y vídeo', 'Búsqueda léxica, semántica y visual', 'Capa de ortografía modernizada para castellano antiguo y latín', 'Citas en 9 estilos CSL, BibTeX y RIS', 'Verificación de afirmaciones', 'Formato abierto SPDF', 'API v1 y servidor MCP']
      : ['Exact printed page (folio) in PDFs, scans and EPUB', 'Exact second in audio and video', 'Lexical, semantic and visual search', 'Modernised-spelling layer for Old Spanish and Latin', 'Citations in 9 CSL styles, BibTeX and RIS', 'Claim verification', 'Open SPDF format', 'API v1 and MCP server'],
    offers: [
      { '@type': 'Offer', name: l === 'es' ? 'Gratis' : 'Free', price: '0', priceCurrency: 'EUR', url: `${ORIGEN}${l === 'es' ? '/saber/planes' : '/en/knowledge/plans'}`, description: l === 'es' ? '25 documentos, 1500 páginas o minutos al mes, 100 búsquedas al día.' : '25 documents, 1,500 pages or minutes a month, 100 searches a day.' },
    ],
    softwareHelp: { '@type': 'CreativeWork', url: `${ORIGEN}${l === 'es' ? '/saber' : '/en/knowledge'}` },
    sameAs: [REPOSITORIO],
  };
}

function sitioWeb(l: Lengua) {
  return {
    '@type': 'WebSite', '@id': ID.sitio, name: 'Scholaris', url: `${ORIGEN}/`, inLanguage: l,
    publisher: { '@id': ID.autor }, about: { '@id': ID.app },
  };
}

/** Preguntas y respuestas: cada «### pregunta» con su texto hasta el siguiente encabezado. */
export function preguntasDe(md: string): { pregunta: string; respuesta: string }[] {
  const fuera: { pregunta: string; respuesta: string }[] = [];
  const partes = md.split(/^### /m).slice(1);
  for (const p of partes) {
    const [primera, ...resto] = p.split('\n');
    const cuerpo = resto.join('\n').split(/^#{1,3} /m)[0]!;
    fuera.push({ pregunta: primera!.replace(/\s*\{#[\w-]+\}$/, '').trim(), respuesta: textoPlano(cuerpo) });
  }
  return fuera;
}

/** Los pasos de una sección: la primera lista numerada debajo del encabezado con ese id. */
export function pasosDe(md: string, id: string): string[] {
  const i = md.indexOf(`{#${id}}`);
  if (i < 0) return [];
  const resto = md.slice(i).split('\n').slice(1);
  const pasos: string[] = [];
  let empezado = false;
  for (const l of resto) {
    if (/^\d+\. /.test(l)) { empezado = true; pasos.push(l.replace(/^\d+\. /, '')); }
    else if (empezado && /^ {2,}\S/.test(l)) pasos[pasos.length - 1] += ' ' + l.trim();
    else if (empezado && l.trim() === '') break;
    else if (/^#{1,3} /.test(l)) break;
  }
  return pasos.map((p) => textoPlano(p));
}

/** Términos del glosario: las listas de definiciones del Markdown. */
export function terminosDe(md: string): { termino: string; definicion: string }[] {
  const lineas = md.split('\n');
  const fuera: { termino: string; definicion: string }[] = [];
  for (let i = 0; i < lineas.length - 1; i++) {
    if (lineas[i]!.trim() && !lineas[i]!.startsWith(': ') && lineas[i + 1]!.startsWith(': ')) {
      fuera.push({ termino: textoPlano(lineas[i]!), definicion: textoPlano(lineas[i + 1]!.slice(2)) });
    }
  }
  return fuera;
}

export function jsonLd(p: Pagina, l: Lengua, fecha: string): Record<string, unknown> {
  const v = p[l];
  const url = `${ORIGEN}${rutaDe(p, l)}`;
  const indice = PAGINAS.find((x) => x.clave === 'indice')!;
  const migas = [
    { '@type': 'ListItem', position: 1, name: 'Scholaris', item: `${ORIGEN}${l === 'es' ? '/acerca' : '/en'}` },
    ...(p.clave === 'indice' || p.clave === 'agentes' ? [] : [{ '@type': 'ListItem', position: 2, name: indice[l].titulo, item: `${ORIGEN}${rutaDe(indice, l)}` }]),
  ];
  migas.push({ '@type': 'ListItem', position: migas.length + 1, name: v.titulo, item: url });
  const tipo = p.tipo ?? 'TechArticle';
  const pagina: Record<string, unknown> = {
    '@type': tipo, '@id': `${url}#pagina`, url, name: v.titulo, headline: v.titulo, description: v.descripcion,
    inLanguage: l, isPartOf: { '@id': ID.sitio }, about: { '@id': ID.app }, author: { '@id': ID.autor }, publisher: { '@id': ID.autor },
    dateModified: fecha, datePublished: '2026-10-06', breadcrumb: { '@id': `${url}#migas` },
    image: `${ORIGEN}/portada/tarjeta-${l}.png`,
    encoding: { '@type': 'MediaObject', encodingFormat: 'text/markdown', contentUrl: `${ORIGEN}${rutaMd(rutaDe(p, l))}` },
    translationOfWork: l === 'en' ? { '@id': `${ORIGEN}${rutaDe(p, 'es')}#pagina` } : undefined,
  };
  if (tipo === 'FAQPage') {
    pagina.mainEntity = preguntasDe(v.md).map((q) => ({ '@type': 'Question', name: q.pregunta, acceptedAnswer: { '@type': 'Answer', text: q.respuesta } }));
  }
  if (tipo === 'TechArticle') pagina.proficiencyLevel = 'Beginner';
  const grafo: Record<string, unknown>[] = [persona(), sitioWeb(l), aplicacion(l), pagina, { '@type': 'BreadcrumbList', '@id': `${url}#migas`, itemListElement: migas }];
  if (p.comoSe) {
    const pasos = pasosDe(v.md, p.comoSe.id);
    grafo.push({
      '@type': 'HowTo', '@id': `${url}#${p.comoSe.id}`, name: p.comoSe[l], inLanguage: l, totalTime: 'PT5M',
      tool: [{ '@type': 'HowToTool', name: 'Scholaris' }],
      step: pasos.map((t, i) => ({ '@type': 'HowToStep', position: i + 1, name: t.split(/[.:]/)[0]!.slice(0, 90), text: t, url: `${url}#${p.comoSe!.id}` })),
    });
  }
  if (p.clave === 'glosario') {
    grafo.push({
      '@type': 'DefinedTermSet', '@id': `${url}#terminos`, name: v.titulo, inLanguage: l,
      hasDefinedTerm: terminosDe(v.md).map((t) => ({ '@type': 'DefinedTerm', name: t.termino, description: t.definicion, url: `${url}#${idDe(t.termino)}` })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': grafo };
}

// ---------------------------------------------------------------------------
// La hoja en HTML
// ---------------------------------------------------------------------------

/** Enlaces internos del Markdown → en el gemelo .md apuntan a los .md, con el origen delante. */
export function enlacesParaMd(md: string): string {
  return md.replace(/\]\((\/[^)\s#]*)(#[^)\s]*)?\)/g, (_, ruta: string, ancla = '') => {
    const conGemelo = PAGINAS.some((p) => p.rutas.es === ruta || p.rutas.en === ruta) || OTRAS_PUBLICAS.some((o) => o.ruta === ruta);
    return conGemelo ? `](${ORIGEN}${ruta}.md${ancla})` : `](${ORIGEN}${ruta}${ancla})`;
  });
}

/** Las notas a lápiz de los bocetos de la aplicación están en castellano; en inglés, se traducen. */
const NOTAS_EN: Record<string, string> = {
  'aquí': 'here', 'aquí irán\ntus libros': 'your books\nwill go here', 'se lee…': 'reading…', 'guárdala bien': 'keep it safe',
  'suéltalo\naquí': 'drop it\nhere', 'faltan\nestrellas': 'stars\nmissing', '¿con cuál?': 'which one?',
  'aquí faltaba una hoja': 'a leaf was missing here', 'el centro,\nquieto': 'the centre,\nstill', '12°, a ojo': '12°, by eye',
  '¡ojo!': 'look!', 'a escuadra': 'square', 'mide dos\nveces': 'measure\ntwice', 'para ti': 'for you', 'sin línea': 'no line',
  'vuelve a intentarlo': 'try again', 'nada por\naquí…': 'nothing\nhere…', 'todavía': 'yet', 'empieza por\nuna frase': 'start with\na sentence',
};

function boceto(d0: Dibujo | undefined, l: Lengua): string {
  if (!d0) return '';
  const d: Dibujo = l === 'es' ? d0 : {
    ...d0,
    elementos: d0.elementos.map((e) => (e.tipo === 'nota' && typeof e.texto === 'string' && NOTAS_EN[e.texto] ? { ...e, texto: { es: e.texto, en: NOTAS_EN[e.texto]! } } : e)),
  };
  return `<div class="boceto-margen" aria-hidden="true">${aSvg(d, { lengua: l, decorativo: true })}</div>`;
}

function enEsta(enc: Encabezado[], l: Lengua): string {
  const h2 = enc.filter((e) => e.nivel === 2);
  if (h2.length < 3) return '';
  return `<nav class="en-esta" aria-labelledby="en-esta"><h2 id="en-esta">${UI[l].enEsta}</h2><ol>${h2.map((e) => `<li><a href="#${e.id}">${esc(e.texto)}</a></li>`).join('')}</ol></nav>`;
}

function indiceLateral(actual: Pagina, l: Lengua): string {
  const u = UI[l];
  const saber = PAGINAS.filter((p) => p.clave !== 'agentes');
  const enlace = (p: Pagina) => `<li><a href="${rutaDe(p, l)}"${p === actual ? ' aria-current="page"' : ''}>${esc(p[l].corto ?? p[l].titulo)}</a></li>`;
  const agentes = PAGINAS.find((p) => p.clave === 'agentes')!;
  return `<aside class="indice-saber" aria-label="${u.indice}"><div class="pegado">
<h2>${u.indice}</h2>
<ol>${saber.map(enlace).join('')}</ol>
<h2>${u.formatos}</h2>
<div class="formatos">
<a href="${rutaDe(agentes, l)}"${agentes === actual ? ' aria-current="page"' : ''}>${esc(agentes[l].corto ?? agentes[l].titulo)}</a>
<a href="${rutaMd(rutaDe(actual, l))}" type="text/markdown">${u.markdown}</a>
<a href="/llms.txt" type="text/plain">llms.txt</a>
<a href="/llms-full.txt" type="text/plain">llms-full.txt</a>
<a href="/api/v1/openapi.json" type="application/json">OpenAPI</a>
<a href="${l === 'es' ? '/api' : '/en/api'}">${l === 'es' ? 'Guía de la API' : 'API guide'}</a>
</div></div></aside>`;
}

function cabeza(p: Pagina, l: Lengua, fecha: string): string {
  const v = p[l];
  const ruta = rutaDe(p, l);
  const url = `${ORIGEN}${ruta}`;
  const tarjeta = `${ORIGEN}/portada/tarjeta-${l}.png`;
  const titulo = p.clave === 'indice' ? v.titulo : `${v.titulo} · Scholaris`;
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(v.descripcion)}">
<meta name="author" content="${AUTOR.nombre}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="es" href="${ORIGEN}${rutaDe(p, 'es')}">
<link rel="alternate" hreflang="en" href="${ORIGEN}${rutaDe(p, 'en')}">
<link rel="alternate" hreflang="x-default" href="${ORIGEN}${rutaDe(p, 'es')}">
<link rel="alternate" type="text/markdown" title="${esc(v.titulo)} (Markdown)" href="${ORIGEN}${rutaMd(ruta)}">
<link rel="alternate" type="text/plain" title="llms.txt" href="${ORIGEN}/llms.txt">
<link rel="service-desc" type="application/json" title="OpenAPI" href="${ORIGEN}/api/v1/openapi.json">
<link rel="author" href="${AUTOR.web}">
<meta name="theme-color" content="#F5F0E8">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon-64.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Scholaris">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(v.titulo)}">
<meta property="og:description" content="${esc(v.descripcion)}">
<meta property="og:image" content="${tarjeta}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="${l === 'es' ? 'es_ES' : 'en_GB'}">
<meta property="og:locale:alternate" content="${l === 'es' ? 'en_GB' : 'es_ES'}">
<meta property="article:modified_time" content="${fecha}">
<meta property="article:author" content="${AUTOR.web}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(v.titulo)}">
<meta name="twitter:description" content="${esc(v.descripcion)}">
<meta name="twitter:image" content="${tarjeta}">
<style>${estilos()}</style>
<script type="application/ld+json">${JSON.stringify(jsonLd(p, l, fecha)).replace(/</g, '\\u003c')}</script>
</head>`;
}

/** El índice de la base: una tarjeta por hoja, con su descripción. */
function hojas(l: Lengua): string {
  const lista = PAGINAS.filter((p) => p.clave !== 'indice');
  return `<ul class="hojas">${lista.map((p) => `<li><a href="${rutaDe(p, l)}"><strong>${esc(p[l].titulo)}</strong><span>${esc(p[l].descripcion)}</span></a></li>`).join('')}</ul>`;
}

/** El Markdown de las hojas en el índice (el mismo listado, para el gemelo .md y llms-full). */
export function hojasMd(l: Lengua): string {
  return PAGINAS.filter((p) => p.clave !== 'indice').map((p) => `- [${p[l].titulo}](${rutaDe(p, l)}): ${p[l].descripcion}`).join('\n');
}

export function cuerpoMd(p: Pagina, l: Lengua): string {
  return p.clave === 'indice' ? p[l].md.replace('<!-- hojas -->', hojasMd(l)) : p[l].md;
}

export function pagina(p: Pagina, l: Lengua, fecha: string): string {
  const u = UI[l];
  const v = p[l];
  const ruta = rutaDe(p, l);
  const otra = OTRA[l];
  const md = p.clave === 'indice' ? v.md.replace('<!-- hojas -->', '') : v.md;
  const { html, encabezados } = aHtml(md, { copiar: u.copiar });
  const cuerpo = p.clave === 'indice' ? html.replace(/(<h2 id="hojas"[^>]*>.*?<\/h2>)/, `$1${hojas(l)}`) : html;
  const indice = PAGINAS.find((x) => x.clave === 'indice')!;
  const orden = PAGINAS.filter((x) => x.clave !== 'agentes');
  const i = orden.indexOf(p);
  const ant = i > 0 ? orden[i - 1] : undefined;
  const sig = i >= 0 && i < orden.length - 1 ? orden[i + 1] : undefined;
  const fechaLegible = new Date(`${fecha}T12:00:00Z`).toLocaleDateString(l === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<!doctype html>
<html lang="${l}">
${cabeza(p, l, fecha)}
<body>
<a class="saltar" href="#texto">${u.saltar}</a>
<header class="cabecera">
<a class="marca" href="${l === 'es' ? '/acerca' : '/en'}" aria-label="Scholaris"><img src="/portada/logo-96.webp" width="46" height="46" alt=""><span>Scholaris</span></a>
<nav aria-label="${u.principal}">
<a href="${rutaDe(indice, l)}"${p.clave !== 'agentes' ? ' aria-current="true"' : ''}>${u.saber}</a>
<a href="${l === 'es' ? '/api' : '/en/api'}">${u.api}</a>
<a href="${rutaDe(PAGINAS.find((x) => x.clave === 'agentes')!, l)}"${p.clave === 'agentes' ? ' aria-current="true"' : ''}>${u.agentes}</a>
<a href="${rutaDe(p, otra)}" hreflang="${otra}" lang="${otra}" title="${u.otraTitulo}">${u.otra}</a>
<a class="boton boton-tinta boton-p" href="/?entrar">${u.entrar}</a>
</nav>
</header>
<main id="texto" class="marco">
<article class="doc" aria-labelledby="titulo">
<nav class="miga" aria-label="${u.migas}"><ol><li><a href="${l === 'es' ? '/acerca' : '/en'}">Scholaris</a></li>${p.clave === 'indice' || p.clave === 'agentes' ? '' : `<li><a href="${rutaDe(indice, l)}">${esc(indice[l].corto ?? indice[l].titulo)}</a></li>`}<li aria-current="page">${esc(v.corto ?? v.titulo)}</li></ol></nav>
<header class="cabeza-doc">
${boceto(p.boceto, l)}
<h1 id="titulo">${esc(v.titulo)}</h1>
<p class="entradilla">${esc(v.descripcion)}</p>
<p class="datos-doc"><span>${u.revisado} <time datetime="${fecha}">${fechaLegible}</time></span><a href="${rutaMd(ruta)}" type="text/markdown">${u.markdown}</a></p>
</header>
${enEsta(encabezados, l)}
<div class="cuerpo-doc">
${cuerpo}
</div>
<footer class="pie-doc">
<nav aria-label="${l === 'es' ? 'Hojas vecinas' : 'Neighbouring pages'}">${ant ? `<a href="${rutaDe(ant, l)}" rel="prev"><span>${u.anterior}</span>${esc(ant[l].corto ?? ant[l].titulo)}</a>` : ''}${sig ? `<a class="sig" href="${rutaDe(sig, l)}" rel="next"><span>${u.siguiente}</span>${esc(sig[l].corto ?? sig[l].titulo)}</a>` : ''}</nav>
</footer>
</article>
${indiceLateral(p, l)}
</main>
<footer class="pie">
<span>Scholaris · ${u.lema}</span>
<nav aria-label="${u.pie}"><a href="${l === 'es' ? '/acerca' : '/en'}">${l === 'es' ? 'Portada' : 'Home'}</a><a href="${rutaDe(indice, l)}">${u.saber}</a><a href="/llms.txt">llms.txt</a><a href="/api/v1/openapi.json">OpenAPI</a><a href="${rutaDe(p, otra)}" hreflang="${otra}" lang="${otra}">${u.otra}</a><a href="${AUTOR.web}" rel="author">joseluissaorin.com</a></nav>
</footer>
<script>${SCRIPT.replace("||'✓'", `||'${u.copiado}'`)}</script>
</body>
</html>
`;
}

/** El gemelo .md de una hoja: cabecera YAML, título, entradilla y el texto con enlaces absolutos. */
export function markdown(p: Pagina, l: Lengua, fecha: string): string {
  const v = p[l];
  const ruta = rutaDe(p, l);
  const otra = OTRA[l];
  return `---
title: ${JSON.stringify(v.titulo)}
description: ${JSON.stringify(v.descripcion)}
url: ${ORIGEN}${ruta}
markdown: ${ORIGEN}${rutaMd(ruta)}
lang: ${l}
alternate_${otra}: ${ORIGEN}${rutaMd(rutaDe(p, otra))}
updated: ${fecha}
author: ${AUTOR.nombre} (${AUTOR.web})
---

# ${v.titulo}

> ${v.descripcion}

${enlacesParaMd(cuerpoMd(p, l)).trim()}
`;
}
