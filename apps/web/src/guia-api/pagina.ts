/**
 * La guía de la API (/api y /en/api), compuesta como HTML estático que se
 * prerenderiza al construir (ver vite-guia-api.ts). Sin React ni Clerk: los
 * primitivos de la portada (papel, tinta, botones con relieve) y un script de
 * diez líneas para copiar los ejemplos.
 */
import cssPortada from '../portada/portada.css?raw';
import css from './guia.css?raw';
import { llmsTxtV1, PREFIJO_V1 } from '@scholaris/contrato';
import sesion from './sesion.json';
import { TEXTOS, type Lengua, type TextosGuia } from './textos';

export const ORIGEN = (typeof process !== 'undefined' && process.env.SCHOLARIS_ORIGEN) || 'https://scholaris-v2.jlsf2005.workers.dev';
const B = `${ORIGEN}${PREFIJO_V1}`;
const CREAR_CLAVE = '/ajustes/claves';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** «comillas» de los textos → <code> para los nombres de campos y valores. */
const conCodigo = (t: string) => esc(t).replace(/«([^»]+)»/g, '<code>$1</code>');

/** Los primitivos de la portada: variables, papel, botones y cabecera (sin el titular ni los dibujos). */
function primitivos(c: string): string {
  const corte = c.indexOf('Folio primero');
  if (corte < 0) return c;
  return c.slice(0, c.lastIndexOf('/* ----', corte));
}

function compactar(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
}

// ---------------------------------------------------------------------------
// Ejemplos (los mismos en las dos lenguas; se pueden copiar y pegar)
// ---------------------------------------------------------------------------

const A = '-H "Authorization: Bearer $SCHOLARIS"';

export const EJEMPLOS: Record<string, string> = {
  minuto: `export SCHOLARIS=sch_…   # tu clave

curl -s ${B}/documentos ${A} \\
  -H "Content-Type: application/pdf" --data-binary @articulo.pdf

curl -sG ${B}/buscar ${A} \\
  --data-urlencode "q=atención escalada" -d k=3 -d formato=markdown`,
  subir: `# Un fichero, como cuerpo (con su tipo y su nombre)
curl -s "${B}/documentos?nombre=libro.epub" ${A} \\
  -H "Content-Type: application/epub+zip" --data-binary @libro.epub

# Una URL (web, PDF, YouTube, Vimeo, pódcast), sin esperar
curl -s "${B}/documentos?esperar=0" ${A} \\
  -H "Content-Type: application/json" -d '{"url": "https://www.youtube.com/watch?v=fNk_zzaMoSs"}'

# Un formulario, con la ficha
curl -s ${B}/documentos ${A} \\
  -F archivo=@entrevista.mp3 -F titulo="A fondo" -F autores="Cortázar, Julio" -F anio=1977`,
  listar: `curl -sG ${B}/documentos ${A} -d estado=listo -d formato=markdown`,
  documento: `curl -s "${B}/documentos/ID?esperar=30" ${A}`,
  borrar: `curl -s -X DELETE ${B}/documentos/ID ${A}`,
  texto: `# Las páginas 23 a 25 tal como están impresas
curl -sG ${B}/documentos/ID/texto ${A} -d desde=23 -d hasta=25 -d formato=markdown

# Un tramo de una entrevista
curl -sG ${B}/documentos/ID/texto ${A} -d desde=1:06:00 -d hasta=1:08:00`,
  buscar: `curl -sG ${B}/buscar ${A} \\
  --data-urlencode "q=la música me metía en el tiempo" -d k=5`,
  preguntar: `curl -s ${B}/preguntar ${A} -H "Content-Type: application/json" \\
  -d '{"pregunta": "¿Qué le pasa a Johnny con el tiempo cuando toca?"}'`,
  citar: `curl -s ${B}/citar ${A} -H "Content-Type: application/json" \\
  -d '{"texto": "La música no saca a Johnny del tiempo: lo mete en otro.", "estilo": "chicago-author-date"}'

# Un .docx, devuelto citado
curl -s "${B}/citar?estilo=apa" ${A} \\
  -H "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \\
  -H "Accept: application/vnd.openxmlformats-officedocument.wordprocessingml.document" \\
  --data-binary @trabajo.docx -o trabajo-citado.docx`,
  verificar: `curl -s ${B}/verificar ${A} -H "Content-Type: application/json" \\
  -d '{"afirmacion": "Johnny Carter dice que la música lo mete en el tiempo."}'`,
  js: `import { readFile } from 'node:fs/promises';
const B = '${B}';
const h = { Authorization: \`Bearer \${process.env.SCHOLARIS}\` };
const pedir = async (ruta, o = {}) => (await fetch(B + ruta, { ...o, headers: { ...h, ...o.headers } })).json();

const doc = await pedir('/documentos?nombre=articulo.pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: await readFile('articulo.pdf') });
const { pasajes } = await pedir(\`/buscar?k=3&q=\${encodeURIComponent('atención escalada')}\`);
for (const p of pasajes) console.log(p.cita, p.texto.slice(0, 80), p.enlace);
const r = await pedir('/preguntar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pregunta: '¿Qué es la atención multicabeza?' }) });
console.log(r.respuesta);`,
  pyInstalar: 'pip install scholaris',
  py: `from scholaris.api import Scholaris

s = Scholaris("sch_…")                      # o la variable SCHOLARIS_CLAVE
doc = s.subir("articulo.pdf")                # también una URL
for p in s.buscar("atención escalada", k=3):
    print(p["cita"], p["texto"][:80], p["enlace"])
print(s.preguntar("¿Qué es la atención multicabeza?")["respuesta"])
print(s.citar("La atención sustituye a la recurrencia.")["texto"])
print(s.verificar("El Transformer prescinde de la recurrencia.")["veredicto"])`,
  claudeCode: `claude mcp add --transport http scholaris ${ORIGEN}/mcp \\
  --header "Authorization: Bearer sch_…"`,
  claudeApp: `${ORIGEN}/mcp`,
  otros: `{
  "mcpServers": {
    "scholaris": {
      "url": "${ORIGEN}/mcp",
      "headers": { "Authorization": "Bearer sch_…" }
    }
  }
}`,
  llms: `curl -s ${ORIGEN}/llms.txt`,
};

function bloque(codigo: string, t: TextosGuia, lengua = 'sh'): string {
  return `<div class="codigo"><button class="copiar" type="button" data-copiado="${esc(t.copiado)}">${esc(t.copiar)}</button><pre><code class="l-${lengua}">${esc(codigo)}</code></pre></div>`;
}

/** Una orden larga en varias líneas, con «\» (se sigue pudiendo pegar tal cual). */
function partir(orden: string): string {
  return orden.replace(/ (-H "|--data-binary |--data-urlencode |-d '|\| jq )/g, ' \\\n  $1');
}

function salida(texto: string): string {
  return `<pre class="salida"><code>${esc(texto)}</code></pre>`;
}

// ---------------------------------------------------------------------------
// La página
// ---------------------------------------------------------------------------

function cabeza(t: TextosGuia): string {
  const url = `${ORIGEN}${t.ruta}`;
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t.titulo)}</title>
<meta name="description" content="${esc(t.descripcion)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="es" href="${ORIGEN}/api">
<link rel="alternate" hreflang="en" href="${ORIGEN}/en/api">
<link rel="alternate" type="application/json" title="OpenAPI" href="${B}/openapi.json">
<link rel="alternate" type="text/plain" title="llms.txt" href="${ORIGEN}/llms.txt">
<meta name="theme-color" content="#F5F0E8">
<meta name="color-scheme" content="light">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Scholaris">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(t.heroe.titular)}">
<meta property="og:description" content="${esc(t.descripcion)}">
<meta property="og:image" content="${ORIGEN}/portada/tarjeta-${t.lengua}.png">
<style>${compactar(primitivos(cssPortada))}${compactar(css)}</style>
</head>`;
}

const SCRIPT = `document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.copiar');if(!b)return;var c=b.parentNode.querySelector('code').innerText;navigator.clipboard.writeText(c).then(function(){var o=b.textContent;b.textContent=b.getAttribute('data-copiado');b.classList.add('hecho');setTimeout(function(){b.textContent=o;b.classList.remove('hecho')},1600)})});`;

function seccion(id: string, rubrica: string, cuerpo: string): string {
  return `<section class="hoja" id="${id}" aria-labelledby="h-${id}">
<h2 class="rubrica" id="h-${id}">${esc(rubrica)}</h2>
${cuerpo}
</section>`;
}

export function pagina(lengua: Lengua): string {
  const t = TEXTOS[lengua];
  const v = t.verbos;
  const verbos = v.lista.map((x) => `<article class="verbo" id="v-${x.ejemplo}">
<h3><span class="metodo m-${x.metodo.toLowerCase()}">${x.metodo}</span> <span class="ruta">${esc(PREFIJO_V1)}${esc(x.ruta)}</span></h3>
<p>${conCodigo(x.que)}</p>
${bloque(EJEMPLOS[x.ejemplo]!, t)}
</article>`).join('\n');

  const pasos = t.minuto.pasos.map((p, i) => `<li>${i === 0 ? `${conCodigo(p)} <a class="boton boton-tinta boton-p" href="${CREAR_CLAVE}">${esc(t.nav.crear)} <span class="flecha" aria-hidden="true">→</span></a>` : conCodigo(p)}</li>`).join('');

  const grabacion = sesion.sesion.map((s, i) => `<li><p class="paso">${esc(t.sesion.comandos[i] ?? '')}</p>
${bloque(partir(s.comando), t)}
${salida(s.salida)}</li>`).join('\n');

  const errores = `<table class="errores"><thead><tr>${t.errores.cabecera.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.errores.codigos
    .map(([c, h, q]) => `<tr><td><code>${esc(c)}</code></td><td>${h}</td><td>${conCodigo(q)}</td></tr>`).join('')}</tbody></table>`;

  const cuerpoError = JSON.stringify({
    error: {
      codigo: 'prohibido', mensaje: 'Esta clave de API es de solo lectura.',
      message: 'This key is not allowed to do that (check its scopes: lectura, escritura, mcp).', estado: 403, documentacion: `${ORIGEN}/api#errores`,
    },
  }, null, 2);

  return `<!doctype html>
<html lang="${t.html}">
${cabeza(t)}
<body>
<a class="saltar" href="#guia">${esc(t.saltar)}</a>
<header class="cabecera">
<a class="marca" href="${lengua === 'es' ? '/acerca' : '/en'}" aria-label="Scholaris"><img src="/portada/logo-96.webp" width="46" height="46" alt=""><span>Scholaris</span></a>
<nav aria-label="${lengua === 'es' ? 'Principal' : 'Main'}">
<a href="#verbos">${esc(t.nav.verbos)}</a>
<a href="#agentes">${esc(t.nav.agentes)}</a>
<a href="${t.otra.ruta}" hreflang="${t.otra.hreflang}" lang="${t.otra.hreflang}" title="${esc(t.otra.etiqueta)}">${esc(t.otra.nombre)}</a>
<a class="boton boton-tinta boton-p" href="${CREAR_CLAVE}">${esc(t.nav.crear)}</a>
</nav>
</header>
<main id="guia">
<section class="portadilla">
<p class="rotulo">${esc(t.heroe.rotulo)} <span>${esc(B)}</span></p>
<h1 class="titular-api">${esc(t.heroe.titular)}</h1>
<p class="entradilla">${esc(t.heroe.entradilla)}</p>
<div class="acciones"><a class="boton boton-tinta boton-g" href="${CREAR_CLAVE}">${esc(t.heroe.crear)} <span class="flecha" aria-hidden="true">→</span></a><a class="boton boton-papel boton-g" href="${B}/openapi.json">${esc(t.heroe.openapi)}</a></div>
<p class="nota">${esc(t.heroe.nota)}</p>
</section>

${seccion('minuto', t.minuto.rubrica, `<ol class="pasos">${pasos}</ol>
${bloque(EJEMPLOS.minuto!, t)}
<p>${esc(t.minuto.despues)}</p>`)}

${seccion('verbos', v.rubrica, `<p>${esc(v.intro)}</p>
<p class="base"><code>${esc(B)}</code></p>
${verbos}
<p>${conCodigo(v.formato)}</p>
<p>${conCodigo(v.espera)}</p>`)}

${seccion('sesion', t.sesion.rubrica, `<p>${esc(t.sesion.intro)}</p>
${bloque('export B=http://localhost:8795/api/v1 SCHOLARIS=sch_…', t)}
<ol class="grabacion">${grabacion}</ol>`)}

${seccion('javascript', t.js.rubrica, `<p>${esc(t.js.intro)}</p>
${bloque(EJEMPLOS.js!, t, 'js')}`)}

${seccion('python', t.py.rubrica, `<p>${esc(t.py.intro)} ${esc(t.py.instalar)}</p>
${bloque(EJEMPLOS.pyInstalar!, t)}
${bloque(EJEMPLOS.py!, t, 'py')}`)}

${seccion('agentes', t.agentes.rubrica, `<p>${esc(t.agentes.intro)}</p>
<p>${esc(t.agentes.claudeCode)}</p>
${bloque(EJEMPLOS.claudeCode!, t)}
<p>${esc(t.agentes.claudeApp)}</p>
${bloque(EJEMPLOS.claudeApp!, t)}
<p>${esc(t.agentes.otros)}</p>
${bloque(EJEMPLOS.otros!, t, 'json')}
<p>${esc(t.agentes.llms)}</p>
${bloque(EJEMPLOS.llms!, t)}
<ol class="reglas">${t.agentes.reglas.map((r) => `<li>${conCodigo(r)}</li>`).join('')}</ol>`)}

${seccion('errores', t.errores.rubrica, `<p>${esc(t.errores.intro)}</p>
${salida(cuerpoError)}
${errores}
<p>${esc(t.errores.ritmo)}</p>
<p>${esc(t.errores.idem)}</p>`)}

${seccion('anclas', t.anclas.rubrica, t.anclas.parrafos.map((p) => `<p>${conCodigo(p)}</p>`).join('\n'))}
</main>
<footer class="pie">
<span>${esc(t.pie)}</span>
<nav aria-label="${lengua === 'es' ? 'Pie' : 'Footer'}"><a href="${B}/openapi.json">OpenAPI</a><a href="/llms.txt">llms.txt</a><a href="${t.otra.ruta}" hreflang="${t.otra.hreflang}">${esc(t.otra.nombre)}</a><a href="https://joseluissaorin.com" rel="author">joseluissaorin.com</a></nav>
</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

export const PAGINAS: { lengua: Lengua; fichero: string; ruta: string }[] = [
  { lengua: 'es', fichero: 'api.html', ruta: '/api' },
  { lengua: 'en', fichero: 'en/api.html', ruta: '/en/api' },
];

/** El llms.txt de la raíz: el mismo que sirve la API en /api/v1/llms.txt. */
export const llmsTxt = () => llmsTxtV1(ORIGEN);
