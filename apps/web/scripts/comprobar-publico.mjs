#!/usr/bin/env node
/**
 * Comprueba lo público de dist/ después de construir la web:
 *
 *   - cada página pública tiene su gemelo .md, canónica, hreflang es/en,
 *     <link rel="alternate" type="text/markdown"> y Open Graph;
 *   - todos los enlaces internos (en el HTML, en los .md, en llms.txt y en el
 *     sitemap) llevan a un fichero que existe, y las anclas (#id), a un id;
 *   - el JSON-LD se lee y tiene la forma que piden schema.org y Google
 *     (SoftwareApplication con offers, FAQPage, HowTo, BreadcrumbList…);
 *   - el castellano no tiene las faltas más típicas de un texto sin tildes.
 *
 *   node scripts/comprobar-publico.mjs [dist] [origen]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] ?? new URL('../dist', import.meta.url).pathname;
const ORIGEN = process.argv[3] ?? process.env.SCHOLARIS_ORIGEN ?? 'https://scholaris.joseluissaorin.com';

/** Lo que sirve el Worker y no está en dist. */
const DINAMICAS = new Set(['/api/v1/openapi.json', '/api/v1/llms.txt', '/api/v1', '/mcp', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/']);
const errores = [];
const fallo = (donde, que) => errores.push(`${donde}: ${que}`);

function todos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? todos(f) : [f];
  });
}

/** La ruta pública → el fichero de dist que la sirve. */
function fichero(ruta) {
  const r = decodeURIComponent(ruta.replace(/\/$/, '') || '/');
  for (const c of [r, `${r}.html`, `${r}/index.html`]) {
    const f = join(DIST, c);
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

const ids = new Map();
function idsDe(f) {
  if (!ids.has(f)) ids.set(f, new Set([...readFileSync(f, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(f);
}

function comprobarEnlace(donde, href) {
  if (/^(mailto:|https?:\/\/(?!scholaris)|#$)/.test(href)) return;
  let ruta = href;
  if (href.startsWith(ORIGEN)) ruta = href.slice(ORIGEN.length) || '/';
  else if (/^https?:/.test(href)) return; // otro despliegue de Scholaris (no debería pasar)
  if (ruta.startsWith('#')) {
    const f = join(DIST, donde);
    if (f.endsWith('.html') && !idsDe(f).has(ruta.slice(1))) fallo(donde, `ancla ${ruta} inexistente`);
    return;
  }
  const [camino, ancla] = ruta.split('#');
  const sinConsulta = camino.split('?')[0];
  if (camino.includes('?') && sinConsulta === '/') return; // /?entrar, /?demostracion
  if (DINAMICAS.has(sinConsulta) || /^\/(ajustes|buscar|escribir|explorar|lector)(\/|$)/.test(sinConsulta)) return; // la aplicación
  const f = fichero(sinConsulta);
  if (!f) return fallo(donde, `enlace roto ${href}`);
  if (ancla && f.endsWith('.html') && !idsDe(f).has(ancla)) fallo(donde, `ancla rota ${href}`);
  if (ancla && f.endsWith('.md')) {
    const html = fichero(sinConsulta.replace(/\.md$/, ''));
    if (html && !idsDe(html).has(ancla)) fallo(donde, `ancla rota ${href}`);
  }
}

// ---------------------------------------------------------------------------
// Las páginas públicas, desde el sitemap
// ---------------------------------------------------------------------------
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
if (sitemap.includes('workers.dev') !== ORIGEN.includes('workers.dev')) fallo('sitemap.xml', 'el origen no es el de este despliegue');
const paginas = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const m of sitemap.matchAll(/href="([^"]+)"/g)) comprobarEnlace('sitemap.xml', m[1]);
for (const u of paginas) {
  if (!u.startsWith(ORIGEN)) { fallo('sitemap.xml', `${u} no es de ${ORIGEN}`); continue; }
  const ruta = u.slice(ORIGEN.length);
  const f = fichero(ruta);
  if (!f) { fallo('sitemap.xml', `${ruta} no existe`); continue; }
  const donde = relative(DIST, f);
  const html = readFileSync(f, 'utf8');
  if (!fichero(`${ruta}.md`)) fallo(donde, 'sin gemelo .md');
  const deben = [
    [`<link rel="canonical" href="${u}">`, 'canónica'],
    ['hreflang="es"', 'hreflang es'], ['hreflang="en"', 'hreflang en'],
    [`type="text/markdown"`, 'alternate text/markdown'],
    ['property="og:title"', 'og:title'], ['property="og:image"', 'og:image'], ['name="description"', 'description'],
  ];
  for (const [t, que] of deben) if (!html.includes(t)) fallo(donde, `falta ${que}`);
  if (!/<html lang="(es|en)"/.test(html)) fallo(donde, 'sin lang');
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) fallo(donde, 'debe tener un solo h1');
  if (!/<main[\s>]/.test(html)) fallo(donde, 'sin <main>');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) comprobarEnlace(donde, m[1].replace(/&amp;/g, '&'));
  // Encabezados sin saltos de nivel.
  let antes = 1;
  for (const m of html.matchAll(/<h([1-6])[\s>]/g)) {
    const n = Number(m[1]);
    if (n > antes + 1 && !html.includes('class="hoja"')) fallo(donde, `salto de h${antes} a h${n}`);
    antes = n;
  }
  // JSON-LD
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let d;
    try { d = JSON.parse(m[1]); } catch (e) { fallo(donde, `JSON-LD ilegible: ${e.message}`); continue; }
    if (d['@context'] !== 'https://schema.org') fallo(donde, 'JSON-LD sin @context schema.org');
    const nodos = d['@graph'] ?? [d];
    for (const n of nodos) comprobarNodo(donde, n);
  }
}

function comprobarNodo(donde, n) {
  const t = n['@type'];
  const pide = (campos) => { for (const c of campos) if (n[c] === undefined || n[c] === '' || (Array.isArray(n[c]) && !n[c].length)) fallo(donde, `${t} sin ${c}`); };
  switch (t) {
    case 'SoftwareApplication':
      pide(['name', 'applicationCategory', 'operatingSystem', 'offers']);
      for (const o of [].concat(n.offers ?? [])) if (o.price === undefined || !o.priceCurrency) fallo(donde, 'Offer sin price o priceCurrency');
      break;
    case 'FAQPage':
      pide(['mainEntity']);
      for (const q of n.mainEntity ?? []) if (q['@type'] !== 'Question' || !q.name || !q.acceptedAnswer?.text) fallo(donde, `pregunta incompleta: ${q.name}`);
      break;
    case 'HowTo':
      pide(['name', 'step']);
      (n.step ?? []).forEach((s, i) => { if (s['@type'] !== 'HowToStep' || !s.text || s.position !== i + 1) fallo(donde, `paso ${i + 1} incompleto`); });
      break;
    case 'BreadcrumbList':
      (n.itemListElement ?? []).forEach((x, i) => { if (x.position !== i + 1 || !x.name || !x.item) fallo(donde, `miga ${i + 1} incompleta`); });
      break;
    case 'TechArticle': case 'AboutPage': case 'CollectionPage': case 'WebPage':
      pide(['headline', 'url', 'inLanguage', 'dateModified', 'author']);
      if ((n.headline ?? '').length > 110) fallo(donde, `headline de más de 110 caracteres (${n.headline.length})`);
      break;
    case 'DefinedTermSet':
      pide(['hasDefinedTerm']);
      break;
    case 'Person': pide(['name', 'url']); break;
    case 'WebSite': pide(['name', 'url']); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Los .md, llms.txt y llms-full.txt
// ---------------------------------------------------------------------------
const textos = todos(DIST).filter((f) => /\.md$|llms(-full)?\.txt$/.test(f));
for (const f of textos) {
  const donde = relative(DIST, f);
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\]\((\S+?)\)/g)) comprobarEnlace(donde, m[1]);
  // Castellano: las faltas típicas de un texto sin tildes (fuera del código).
  const prosa = t.replace(/pagina con/g, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '');
  const esCastellano = /^lang: es$/m.test(t);
  if (esCastellano) {
    for (const mal of [/\b(pagina|paginas|busqueda|version|tambien|ademas|ultimo|numero|codigo|informacion|aplicacion|via|asi|aun no|segun|facil|rapido|dias|metodo|titulo|indice|traduccion)\b/gi]) {
      for (const m of prosa.matchAll(mal)) {
        const ctx = prosa.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\n/g, ' ');
        if (!/[a-z_]\w*[_-]|«|scholaris-|\/|\.\w/.test(ctx.slice(25, 35))) fallo(donde, `¿falta una tilde? «${m[0]}» en «…${ctx}…»`);
      }
    }
  }
}

// /.well-known
for (const f of ['.well-known/mcp/server-card.json', '.well-known/api-catalog', '.well-known/agent-skills/index.json']) {
  try { JSON.parse(readFileSync(join(DIST, f), 'utf8')); } catch (e) { fallo(f, `JSON ilegible: ${e.message}`); }
}
if (!/^Contact: mailto:/m.test(readFileSync(join(DIST, '.well-known/security.txt'), 'utf8'))) fallo('security.txt', 'sin Contact');
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
for (const b of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) if (!robots.includes(`User-agent: ${b}`)) fallo('robots.txt', `sin ${b}`);
if (!robots.includes(`Sitemap: ${ORIGEN}/sitemap.xml`)) fallo('robots.txt', 'Sitemap con otro origen');

console.log(`${paginas.length} páginas, ${textos.length} textos para agentes.`);
if (errores.length) {
  console.error(`\n${errores.length} problemas:\n${[...new Set(errores)].map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('Todo en orden.');
