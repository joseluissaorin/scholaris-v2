/**
 * La portada pública, compuesta como HTML estático. Se genera al construir la
 * web (ver `vite-portada.ts`) y se sirve tal cual: sin React, sin el paquete de
 * la aplicación, sin Clerk. Todo lo que pesa (los dibujos) ya viene dibujado en
 * el HTML; el único JavaScript es un observador de veinte líneas que hace que
 * la pluma dibuje cuando el dibujo entra en pantalla.
 */
import css from './portada.css?raw';
import { aSvg, enLengua, type Lengua } from './dibujo/boceto';
import { DIBUJOS, type NombreDibujo } from './dibujo/dibujos';
import { CSS_TINTAS } from './dibujo/tintas';
import { TEXTOS, type Capitulo, type Textos } from './textos';

export const ORIGEN = (typeof process !== 'undefined' && process.env.SCHOLARIS_ORIGEN) || 'https://scholaris-v2.jlsf2005.workers.dev';

/** Rutas de la aplicación a las que llevan las llamadas a la acción. */
export const ENTRAR = '/?entrar';
export const DEMOSTRACION = '/?demostracion';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function dibujo(nombre: NombreDibujo, lengua: Lengua, o: { decorativo?: boolean; espera?: number; sufijo?: string } = {}): string {
  return aSvg(DIBUJOS[nombre], { lengua, ...o });
}

/**
 * Las láminas de más abajo no van dentro del HTML: se prerenderizan como SVG
 * sueltos en /portada/laminas/ y el script los mete en la página, en línea
 * (para que la pluma pueda dibujarlos), un poco antes de que lleguen a la
 * pantalla. Mientras tanto ocupan su caja exacta (cero saltos) y, sin
 * JavaScript, se ven como imagen.
 */
const laminas = new Map<string, string>();

/** El SVG suelto lleva sus tintas dentro, para verse también como <img>. */
function independiente(svg: string): string {
  const estilo = `<style>:root{${CSS_TINTAS}}.nt{font-family:'Segoe Print','Bradley Hand',cursive}.c-pl,.c-co,.c-en{mix-blend-mode:multiply}</style>`;
  return svg.replace(/^(<svg[^>]*>)/, `$1${estilo}`);
}

function diferido(nombre: NombreDibujo, lengua: Lengua, o: { decorativo?: boolean; clase?: string } = {}): string {
  const d = DIBUJOS[nombre];
  const [, , w, h] = d.caja ?? [0, 0, d.ancho, d.alto];
  const fichero = `${nombre}-${lengua}.svg`;
  if (!laminas.has(fichero)) laminas.set(fichero, independiente(aSvg(d, { lengua, decorativo: o.decorativo })));
  const ruta = `/portada/laminas/${fichero}`;
  const alt = o.decorativo ? '' : enLengua(d.descripcion, lengua);
  return `<span class="diferido${o.clase ? ` ${o.clase}` : ''}" data-lamina="${ruta}" style="aspect-ratio:${w}/${h}"><noscript><img src="${ruta}" width="${w}" height="${h}" alt="${esc(alt)}" loading="lazy"></noscript></span>`;
}

/** Los SVG sueltos de una lengua, para escribirlos al construir (o servirlos en desarrollo). */
export function laminasDe(lengua: Lengua): { fichero: string; svg: string }[] {
  pagina(lengua);
  return [...laminas].filter(([f]) => f.endsWith(`-${lengua}.svg`)).map(([fichero, svg]) => ({ fichero, svg }));
}

/** CSS sin comentarios ni espacios de sobra: va entero dentro del HTML. */
function compactar(c: string): string {
  return c
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/** Antes de pintar: si se puede animar, se marca; si no, los dibujos se ven ya hechos. */
const SCRIPT_CABEZA =
  "try{if('IntersectionObserver'in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('anima')}catch(e){}";

/** La pluma: cada dibujo se dibuja la primera vez que entra en pantalla. */
const SCRIPT_PIE = `(function(){var d=document.documentElement,n=0,io='IntersectionObserver'in window,todos=function(q,f){[].forEach.call(document.querySelectorAll(q),f)};var dib=d.classList.contains('anima')&&new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('visto');dib.unobserve(e.target)}})},{rootMargin:'0px 0px -10% 0px',threshold:0.15});function mirar(s){if(dib)dib.observe(s)}todos('svg.dibujo',mirar);function cargar(el){var u=el.getAttribute('data-lamina');if(!u)return;el.removeAttribute('data-lamina');fetch(u).then(function(r){return r.text()}).then(function(t){var k=++n;el.innerHTML=t.replace(/\\b(m[tc]-[\\w-]+)/g,'$1-'+k);var s=el.querySelector('svg');if(s)mirar(s)})}function luego(){try{[['DM Sans','dm-sans',{weight:'100 1000'}],['Mano','mano',{}]].forEach(function(f){new FontFace(f[0],'url(/portada/'+f[1]+'.woff2)',f[2]).load().then(function(x){document.fonts.add(x)})})}catch(e){}if(io){var lz=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){lz.unobserve(e.target);cargar(e.target)}})},{rootMargin:'700px 0px'});todos('[data-lamina]',function(e){lz.observe(e)})}else todos('[data-lamina]',cargar)}if(document.readyState==='complete')luego();else addEventListener('load',luego);addEventListener('beforeprint',function(){todos('svg.dibujo',function(s){s.classList.add('visto')})})})()`;

function cabeza(t: Textos): string {
  const url = `${ORIGEN}${t.ruta}`;
  const tarjeta = `${ORIGEN}/portada/tarjeta-${t.lengua}.png`;
  const datos = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Scholaris',
    url,
    inLanguage: t.html,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web, macOS, Linux, Windows',
    description: t.descripcion,
    image: tarjeta,
    author: { '@type': 'Person', name: 'José Luis Saorín Ferrer', url: 'https://joseluissaorin.com' },
  };
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t.titulo)}</title>
<meta name="description" content="${esc(t.descripcion)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="es" href="${ORIGEN}/acerca">
<link rel="alternate" hreflang="en" href="${ORIGEN}/en">
<link rel="alternate" hreflang="x-default" href="${ORIGEN}/acerca">
<meta name="theme-color" content="#F5F0E8">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon-64.png" type="image/png" sizes="64x64">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Scholaris">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(t.heroe.titular)}">
<meta property="og:description" content="${esc(t.descripcion)}">
<meta property="og:image" content="${tarjeta}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.lengua === 'es' ? 'Una manícula dibujada a pluma señala hacia un gran círculo rojo; al lado, el titular de Scholaris.' : 'A pen-drawn manicule points towards a large red circle; beside it, the Scholaris headline.')}">
<meta property="og:locale" content="${t.lengua === 'es' ? 'es_ES' : 'en_GB'}">
<meta property="og:locale:alternate" content="${t.lengua === 'es' ? 'en_GB' : 'es_ES'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(t.heroe.titular)}">
<meta name="twitter:description" content="${esc(t.descripcion)}">
<meta name="twitter:image" content="${tarjeta}">
<script>${SCRIPT_CABEZA}</script>
<style>:root{${CSS_TINTAS}}${compactar(css)}</style>
<script type="application/ld+json">${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>
</head>`;
}

function heroe(t: Textos): string {
  const h = t.heroe;
  return `<section class="heroe" aria-labelledby="titular">
<div class="heroe-sol">${dibujo('sol', t.lengua, { decorativo: true })}</div>
<p class="rotulo">${esc(h.rotulo)} <span>fol. 1r</span></p>
<h1 class="titular" id="titular">${esc(h.titular)}</h1>
<div class="heroe-mano">${dibujo('manicula', t.lengua, { espera: 0.2 })}</div>
<div class="heroe-pie">
<p class="entradilla">${esc(h.entradilla)}</p>
<div class="acciones"><a class="boton boton-tinta boton-g" href="${ENTRAR}">${esc(h.empezar)} <span class="flecha" aria-hidden="true">→</span></a><a class="boton boton-papel boton-g" href="${DEMOSTRACION}">${esc(h.probar)}</a></div>
<p class="nota-mano" aria-hidden="true">${esc(h.nota)}</p>
<a class="leer" href="#texto">${esc(h.leer)} ↓</a>
</div>
</section>`;
}

interface Extras {
  /** HTML que va dentro del cuerpo, antes del primer párrafo (la inicial). */
  inicial?: string;
  /** Lo que va después del texto: una lámina, el espécimen… */
  despues?: string;
}

function capitulo(c: Capitulo, lengua: Lengua, x: Extras = {}, indice = 0): string {
  const mano = () => diferido('manecilla', lengua, { decorativo: true, clase: 'mano-margen' });
  const parrafos = c.parrafos
    .map((p, i) => {
      const conMano = p.replace(/<strong class="senalada">/g, () => `${mano()}<strong class="senalada">`);
      return `<p>${i === 0 && x.inicial ? x.inicial : ''}${conMano}</p>`;
    })
    .join('');
  return `<section class="folio-hoja" id="${c.id}" aria-labelledby="h-${c.id}" data-folio="${indice}">
<p class="foliacion" aria-hidden="true">${esc(c.folio)}</p>
<h2 class="rubrica" id="h-${c.id}"><span class="num">${esc(c.numero)}</span> ${esc(c.rubrica)}</h2>
<div class="cuerpo">${parrafos}</div>
${c.glosa ? `<aside class="glosa">${c.glosa}</aside>` : ''}
${x.despues ?? ''}
${c.reclamo ? `<p class="reclamo" aria-hidden="true">${esc(c.reclamo)}</p>` : ''}
</section>`;
}

/** La primera palabra del primer capítulo pierde su letra, que la pone la inicial. */
function sinPrimeraLetra(c: Capitulo): Capitulo {
  const [primero, ...resto] = c.parrafos;
  return { ...c, parrafos: [primero!.slice(1), ...resto] };
}

function ensayo(t: Textos): string {
  const [abundancia, archivo, maquinas, mano, constelaciones, nunca] = t.capitulos as [Capitulo, Capitulo, Capitulo, Capitulo, Capitulo, Capitulo];
  const l = t.lengua;
  const letra = abundancia.parrafos[0]!.charAt(0);
  const inicial = `${diferido('inicial', l, { decorativo: true, clase: 'inicial' })}<span class="solo-lector">${letra}</span>`;
  const e = t.especimen;
  const especimen = `<figure class="especimen">
<blockquote lang="es"><p style="margin:0">«${esc(e.cita)}»</p></blockquote>
<figcaption><span>${e.fuente}</span><span class="folio">${esc(e.folio)}</span></figcaption>
${diferido('manecilla', l, { decorativo: true, clase: 'mano-ficha' })}
<span class="nota-mano" aria-hidden="true">${esc(e.nota)}</span>
</figure>
<p class="especimen-minuto">${esc(e.minuto).replace('12:04', '<span class="folio">12:04</span>')}</p>`;
  const hace = t.hace;
  const indice = `<section class="folio-hoja" id="que-hace" aria-labelledby="h-que-hace">
<p class="foliacion" aria-hidden="true">${esc(hace.folio)}</p>
<h2 class="rubrica" id="h-que-hace"><span class="num">${esc(hace.numero)}</span> ${esc(hace.rubrica)}</h2>
<ol class="indice">${hace.cosas
    .map((c) => `<li><div class="linea"><span class="que">${esc(c.que)}</span><span class="puntos" aria-hidden="true"></span><span class="dato">${esc(c.dato)}</span></div><p class="como">${esc(c.como)}</p></li>`)
    .join('')}</ol>
<p class="reclamo" aria-hidden="true">${esc(t.quien.parrafos[0]!.split(' ').slice(0, 3).join(' '))}</p>
</section>`;
  return `<article id="texto" class="ensayo">
${capitulo(sinPrimeraLetra(abundancia), l, { inicial, despues: `<figure class="lamina lamina-ancha">${diferido('biblioteca', l)}</figure>` }, 1)}
${capitulo(archivo, l, {}, 2)}
${capitulo(maquinas, l, { despues: `<figure class="lamina lamina-media">${diferido('maquina', l)}</figure>` }, 3)}
${capitulo(mano, l, { despues: especimen }, 4)}
${capitulo(constelaciones, l, { despues: `<figure class="lamina lamina-derecha">${diferido('constelacion', l)}</figure>` }, 5)}
${capitulo(nunca, l, { despues: `<figure class="lamina lamina-media">${diferido('triada', l)}</figure>` }, 6)}
${indice}
${capitulo(t.quien, l, {}, 8)}
</article>`;
}

function colofon(t: Textos): string {
  const c = t.colofon;
  return `<section class="colofon" aria-labelledby="h-colofon">
<h2 id="h-colofon">${esc(c.titulo)}</h2>
<p class="lampara">${esc(c.texto)}</p>
<p class="firma">${esc(c.firma)}</p>
${diferido('caracol', t.lengua, { clase: 'caracol' })}
<div class="acciones"><a class="boton boton-tinta boton-g" href="${ENTRAR}">${esc(c.empezar)} <span class="flecha" aria-hidden="true">→</span></a><a class="boton boton-papel boton-g" href="${DEMOSTRACION}">${esc(c.probar)}</a></div>
<img class="logo" src="/portada/logo-192.webp" width="88" height="88" alt="" loading="lazy" decoding="async">
</section>`;
}

export function pagina(lengua: Lengua): string {
  const t = TEXTOS[lengua];
  return `<!doctype html>
<html lang="${t.html}">
${cabeza(t)}
<body>
<a class="saltar" href="#texto">${esc(t.saltar)}</a>
<header class="cabecera">
<a class="marca" href="${t.ruta}" aria-label="${esc(t.nav.inicio)}"><img src="/portada/logo-96.webp" width="46" height="46" alt="" fetchpriority="low"><span>Scholaris</span></a>
<nav aria-label="${lengua === 'es' ? 'Principal' : 'Main'}">
<a class="ensayo-enlace" href="#texto">${esc(t.nav.ensayo)}</a>
<a href="${t.otra.ruta}" hreflang="${t.otra.hreflang}" lang="${t.otra.hreflang}" title="${esc(t.otra.etiqueta)}">${esc(t.otra.nombre)}</a>
<a class="boton boton-papel boton-p" href="${ENTRAR}">${esc(t.nav.entrar)}</a>
</nav>
</header>
<main>
${heroe(t)}
${ensayo(t)}
${colofon(t)}
</main>
<footer class="pie">
<span>${esc(t.colofon.pie)} · ${lengua === 'es' ? 'una biblioteca leída y citable' : 'a library, read and citable'}</span>
<nav aria-label="${lengua === 'es' ? 'Pie' : 'Footer'}"><a href="${ENTRAR}">${esc(t.nav.entrar)}</a><a href="${DEMOSTRACION}">${esc(t.heroe.probar)}</a><a href="${t.otra.ruta}" hreflang="${t.otra.hreflang}" lang="${t.otra.hreflang}">${esc(t.otra.nombre)}</a><a href="https://joseluissaorin.com" rel="author">joseluissaorin.com</a></nav>
</footer>
<script>${SCRIPT_PIE}</script>
</body>
</html>
`;
}

export const PAGINAS: { lengua: Lengua; fichero: string; ruta: string }[] = [
  { lengua: 'es', fichero: 'acerca.html', ruta: '/acerca' },
  { lengua: 'en', fichero: 'en.html', ruta: '/en' },
];
