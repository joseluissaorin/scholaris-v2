/**
 * El Markdown de las respuestas de Investigar: títulos, párrafos, listas
 * (también numeradas y anidadas), citas en bloque, tablas, separadores, código,
 * cursivas, negritas, enlaces y las marcas de las pruebas («[E1]», «[E1][E3]»)
 * y de lo que no se pudo probar («[sin prueba]»).
 *
 * Se analiza a un árbol (sin HTML: nada del texto llega al DOM como marcado) que
 * la interfaz pinta con elementos de React y que, para copiar, se convierte en
 * HTML escapado. Aguanta el texto a medias mientras se escribe: lo que aún no se
 * ha cerrado (una tabla sin su línea de guiones, una negrita sin sus asteriscos
 * finales) se queda como texto hasta que llega lo que falta.
 */

export type EnLinea =
  | { t: 'texto'; v: string }
  | { t: 'negrita'; hijos: EnLinea[] }
  | { t: 'cursiva'; hijos: EnLinea[] }
  | { t: 'codigo'; v: string }
  | { t: 'enlace'; href: string; hijos: EnLinea[] }
  /** Una o varias pruebas: «[E1]» → ['E1']; «[E2-E4]» → ['E2', 'E3', 'E4']. */
  | { t: 'cita'; ids: string[] }
  /** La verificación no encontró prueba para lo que se acaba de afirmar. */
  | { t: 'sin-prueba' }
  | { t: 'salto' };

export type Alineacion = 'izquierda' | 'centro' | 'derecha' | null;

export type Bloque =
  | { t: 'titulo'; nivel: number; hijos: EnLinea[] }
  | { t: 'parrafo'; hijos: EnLinea[] }
  | { t: 'lista'; ordenada: boolean; inicio: number; elementos: Bloque[][] }
  | { t: 'cita-bloque'; hijos: Bloque[] }
  | { t: 'tabla'; alineacion: Alineacion[]; cabecera: EnLinea[][]; filas: EnLinea[][][] }
  | { t: 'separador' }
  | { t: 'codigo'; v: string };

// ---------------------------------------------------------------------------
// Las marcas de las pruebas
// ---------------------------------------------------------------------------

/** «E1», «E1, E3», «E2-E4», «E2–4»: el interior de una marca de prueba. */
const INTERIOR_CITA = String.raw`E\d{1,4}(?:\s*[,;–—-]\s*E?\d{1,4})*`;

/** Las pruebas de una marca, en orden y sin repetir (los tramos, hasta 20). */
export function idsDeMarca(interior: string): string[] {
  const ids: string[] = [];
  const poner = (n: number) => { const id = `E${n}`; if (!ids.includes(id)) ids.push(id); };
  const partes = interior.split(/\s*[,;]\s*/);
  for (const p of partes) {
    const tramo = /^E(\d+)\s*[–—-]\s*E?(\d+)$/.exec(p.trim());
    if (tramo) {
      const a = Number(tramo[1]), b = Number(tramo[2]);
      if (b >= a && b - a < 20) { for (let n = a; n <= b; n++) poner(n); continue; }
      poner(a); poner(b);
      continue;
    }
    const una = /^E?(\d+)$/.exec(p.trim());
    if (una) poner(Number(una[1]));
  }
  return ids;
}

/** Todas las marcas de prueba de un texto, en orden de aparición y sin repetir. */
export function marcasDe(texto: string): string[] {
  const ids: string[] = [];
  for (const m of texto.matchAll(new RegExp(String.raw`\[(${INTERIOR_CITA})\]`, 'g'))) {
    for (const id of idsDeMarca(m[1]!)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// En línea
// ---------------------------------------------------------------------------

const EN_LINEA = new RegExp([
  '(\\\\[\\\\`*_\\[\\]()#|>~-])', // 1 escape
  '(`[^`\\n]+`)', // 2 código
  String.raw`(\[(?:${INTERIOR_CITA})\])`, // 3 prueba
  String.raw`(\[sin prueba\])`, // 4 sin prueba
  String.raw`(\[[^\]\n]+\]\((?:[^()\s]|\([^()\s]*\))+\))`, // 5 enlace
  String.raw`(\*\*[^\s*](?:[^\n]*?[^\s])?\*\*)`, // 6 negrita
  String.raw`(__[^\s_](?:[^\n]*?[^\s])?__)`, // 7 negrita
  String.raw`(\*[^\s*](?:[^*\n]*[^\s*])?\*)`, // 8 cursiva
  String.raw`((?<![\p{L}\p{N}_])_[^\s_](?:[^_\n]*[^\s_])?_(?![\p{L}\p{N}_]))`, // 9 cursiva
  String.raw`(\n)`, // 10 salto
].join('|'), 'gu');

/** Solo enlaces web, de correo o de la propia aplicación: nada de «javascript:». */
export function enlaceSeguro(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h) || /^mailto:/i.test(h)) return h;
  if (/^\/(?!\/)/.test(h)) return h;
  return null;
}

/** El texto de una línea (o de un párrafo, con `\n` como salto si `saltos`). */
export function analizarEnLinea(texto: string, saltos = false): EnLinea[] {
  const out: EnLinea[] = [];
  const texto_ = (v: string) => {
    if (!v) return;
    const ultimo = out[out.length - 1];
    if (ultimo?.t === 'texto') ultimo.v += v;
    else out.push({ t: 'texto', v });
  };
  let ultimo = 0;
  EN_LINEA.lastIndex = 0;
  const re = new RegExp(EN_LINEA.source, EN_LINEA.flags);
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    texto_(texto.slice(ultimo, m.index));
    ultimo = m.index + m[0].length;
    const s = m[0];
    if (m[1]) texto_(s.slice(1));
    else if (m[2]) out.push({ t: 'codigo', v: s.slice(1, -1) });
    else if (m[3]) out.push({ t: 'cita', ids: idsDeMarca(s.slice(1, -1)) });
    else if (m[4]) out.push({ t: 'sin-prueba' });
    else if (m[5]) {
      const corte = s.indexOf('](');
      const etiqueta = s.slice(1, corte), href = enlaceSeguro(s.slice(corte + 2, -1));
      if (href) out.push({ t: 'enlace', href, hijos: analizarEnLinea(etiqueta) });
      else for (const h of analizarEnLinea(etiqueta)) h.t === 'texto' ? texto_(h.v) : out.push(h);
    } else if (m[6] || m[7]) out.push({ t: 'negrita', hijos: analizarEnLinea(s.slice(2, -2)) });
    else if (m[8] || m[9]) out.push({ t: 'cursiva', hijos: analizarEnLinea(s.slice(1, -1)) });
    else if (m[10]) { if (saltos) out.push({ t: 'salto' }); else texto_(' '); }
  }
  texto_(texto.slice(ultimo));
  return out;
}

// ---------------------------------------------------------------------------
// Bloques
// ---------------------------------------------------------------------------

const TITULO = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const SEPARADOR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const CERCA = /^\s{0,3}(```|~~~)/;
const CITA = /^\s{0,3}>\s?/;
const ELEMENTO = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const GUIONES_TABLA = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const sangria = (l: string) => (/^\s*/.exec(l)?.[0] ?? '').replace(/\t/g, '    ').length;
const blanca = (l: string) => !l.trim();

function celdas(l: string): string[] {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let actual = '', codigo = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\' && s[i + 1] === '|') { actual += '|'; i++; continue; }
    if (c === '`') codigo = !codigo;
    if (c === '|' && !codigo) { out.push(actual.trim()); actual = ''; continue; }
    actual += c;
  }
  out.push(actual.trim());
  return out;
}

const empiezaTabla = (lineas: string[], i: number) => lineas[i]!.includes('|') && i + 1 < lineas.length && GUIONES_TABLA.test(lineas[i + 1]!) && lineas[i + 1]!.includes('-');

function empiezaBloque(lineas: string[], i: number): boolean {
  const l = lineas[i]!;
  return TITULO.test(l) || SEPARADOR.test(l) || CERCA.test(l) || CITA.test(l) || ELEMENTO.test(l) || empiezaTabla(lineas, i);
}

/**
 * El Markdown entero, en bloques. `saltos`: los saltos de línea dentro de un
 * párrafo se respetan (en las citas en bloque, donde suele ir verso).
 */
export function analizarMarkdown(md: string, saltos = false): Bloque[] {
  const lineas = md.replace(/\r\n?/g, '\n').split('\n');
  const bloques: Bloque[] = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i]!;
    if (blanca(l)) { i++; continue; }

    const cerca = CERCA.exec(l);
    if (cerca) {
      const cuerpo: string[] = [];
      i++;
      while (i < lineas.length && !lineas[i]!.trim().startsWith(cerca[1]!)) cuerpo.push(lineas[i++]!);
      i++;
      bloques.push({ t: 'codigo', v: cuerpo.join('\n') });
      continue;
    }

    const titulo = TITULO.exec(l);
    if (titulo) { bloques.push({ t: 'titulo', nivel: titulo[1]!.length, hijos: analizarEnLinea(titulo[2]!) }); i++; continue; }

    // «---», «* * *»: un separador, aunque parezca un elemento de lista.
    if (SEPARADOR.test(l)) { bloques.push({ t: 'separador' }); i++; continue; }

    if (CITA.test(l)) {
      const dentro: string[] = [];
      while (i < lineas.length && CITA.test(lineas[i]!)) dentro.push(lineas[i++]!.replace(CITA, ''));
      bloques.push({ t: 'cita-bloque', hijos: analizarMarkdown(dentro.join('\n'), true) });
      continue;
    }

    if (empiezaTabla(lineas, i)) {
      const cabecera = celdas(l);
      const alineacion: Alineacion[] = celdas(lineas[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'centro' : c.endsWith(':') ? 'derecha' : c.startsWith(':') ? 'izquierda' : null));
      i += 2;
      const filas: EnLinea[][][] = [];
      while (i < lineas.length && !blanca(lineas[i]!) && lineas[i]!.includes('|')) {
        const f = celdas(lineas[i++]!);
        // Todas las filas con las columnas de la cabecera: ni de más ni de menos.
        filas.push(cabecera.map((_, k) => analizarEnLinea(f[k] ?? '')));
      }
      bloques.push({ t: 'tabla', alineacion: cabecera.map((_, k) => alineacion[k] ?? null), cabecera: cabecera.map((c) => analizarEnLinea(c)), filas });
      continue;
    }

    const el = ELEMENTO.exec(l);
    if (el) { i = analizarLista(lineas, i, bloques); continue; }

    // Párrafo: hasta una línea en blanco o el principio de otro bloque.
    const parrafo: string[] = [l.trim()];
    i++;
    while (i < lineas.length && !blanca(lineas[i]!) && !empiezaBloque(lineas, i)) parrafo.push(lineas[i++]!.trim());
    bloques.push({ t: 'parrafo', hijos: analizarEnLinea(parrafo.join('\n'), saltos) });
  }
  return bloques;
}

/** Una lista desde la línea `i`: sus elementos (cada uno, sus propios bloques). Devuelve dónde sigue. */
function analizarLista(lineas: string[], i: number, bloques: Bloque[]): number {
  const primero = ELEMENTO.exec(lineas[i]!)!;
  const base = sangria(lineas[i]!);
  const ordenada = /\d/.test(primero[2]!);
  const inicio = ordenada ? Number.parseInt(primero[2]!, 10) : 1;
  const elementos: string[][] = [];
  let actual: string[] | null = null;
  let contenido = base + primero[2]!.length + 1;
  while (i < lineas.length) {
    const l = lineas[i]!;
    const m = ELEMENTO.exec(l);
    if (m && sangria(l) <= base + 1 && /\d/.test(m[2]!) === ordenada) {
      actual = [m[3]!];
      elementos.push(actual);
      contenido = sangria(l) + m[2]!.length + 1;
      i++;
      continue;
    }
    if (blanca(l)) {
      // Una línea en blanco sigue en la lista si lo siguiente es otro elemento o va sangrado.
      let k = i + 1;
      while (k < lineas.length && blanca(lineas[k]!)) k++;
      const sig = lineas[k];
      const otro = sig != null ? ELEMENTO.exec(sig) : null;
      if (sig != null && ((otro && sangria(sig) <= base + 1 && /\d/.test(otro[2]!) === ordenada) || sangria(sig) > base + 1)) { actual?.push(''); i++; continue; }
      break;
    }
    if (sangria(l) > base + 1) { actual?.push(l.slice(Math.min(sangria(l), contenido))); i++; continue; }
    // Continuación perezosa: una línea sin sangría que no empieza otro bloque.
    if (!empiezaBloque(lineas, i) && actual) { actual.push(l.trim()); i++; continue; }
    break;
  }
  bloques.push({ t: 'lista', ordenada, inicio, elementos: elementos.map((e) => analizarMarkdown(e.join('\n'))) });
  return i;
}

// ---------------------------------------------------------------------------
// La lista de pruebas del final
// ---------------------------------------------------------------------------

/**
 * Separa la lista de pruebas con que acaba la respuesta definitiva («## Pruebas»):
 * en pantalla la enseñan las tarjetas; al copiar, va con la respuesta.
 */
export function separarPruebas(bloques: Bloque[]): { cuerpo: Bloque[]; pruebas: Bloque[] } {
  for (let k = bloques.length - 1; k >= 0; k--) {
    const b = bloques[k]!;
    if (b.t !== 'titulo') continue;
    const t = textoDe(b.hijos).trim().toLocaleLowerCase('es');
    if (/^(pruebas|evidencias|pruebas citadas|lista de pruebas)$/.test(t)) return { cuerpo: bloques.slice(0, k), pruebas: bloques.slice(k) };
    break;
  }
  return { cuerpo: bloques, pruebas: [] };
}

/** El texto plano de unos nodos en línea (sin las marcas). */
export function textoDe(hijos: EnLinea[]): string {
  return hijos.map((h) => (h.t === 'texto' || h.t === 'codigo' ? h.v : h.t === 'salto' ? '\n' : 'hijos' in h ? textoDe(h.hijos) : '')).join('');
}

// ---------------------------------------------------------------------------
// HTML para el portapapeles (escapado: el texto nunca es marcado)
// ---------------------------------------------------------------------------

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Las marcas seguidas («[E1][E3]») como una sola, para citarlas juntas. */
export function juntarCitas(hijos: EnLinea[]): EnLinea[] {
  const out: EnLinea[] = [];
  for (const h of hijos) {
    const previo = out[out.length - 1];
    if (h.t === 'cita' && previo?.t === 'cita') out[out.length - 1] = { t: 'cita', ids: [...new Set([...previo.ids, ...h.ids])] };
    else out.push(h);
  }
  return out;
}

function htmlEnLinea(hijos: EnLinea[], citar: (ids: string[]) => string): string {
  return juntarCitas(hijos).map((h) => {
    switch (h.t) {
      case 'texto': return escapar(h.v);
      case 'negrita': return `<strong>${htmlEnLinea(h.hijos, citar)}</strong>`;
      case 'cursiva': return `<em>${htmlEnLinea(h.hijos, citar)}</em>`;
      case 'codigo': return `<code>${escapar(h.v)}</code>`;
      case 'enlace': return `<a href="${escapar(h.href)}">${htmlEnLinea(h.hijos, citar)}</a>`;
      case 'cita': { const c = citar(h.ids); return c ? ` ${escapar(c)}` : ''; }
      case 'sin-prueba': return ' [sin prueba]';
      case 'salto': return '<br>';
    }
  }).join('').replace(/ {2,}/g, ' ');
}

/** Los bloques como HTML (para pegar con formato en un procesador de textos). */
export function aHtml(bloques: Bloque[], citar: (ids: string[]) => string): string {
  return bloques.map((b): string => {
    switch (b.t) {
      case 'titulo': { const n = Math.min(6, b.nivel + 1); return `<h${n}>${htmlEnLinea(b.hijos, citar)}</h${n}>`; }
      case 'parrafo': return `<p>${htmlEnLinea(b.hijos, citar)}</p>`;
      case 'lista': {
        const et = b.ordenada ? 'ol' : 'ul';
        const inicio = b.ordenada && b.inicio !== 1 ? ` start="${b.inicio}"` : '';
        return `<${et}${inicio}>${b.elementos.map((e) => `<li>${e.length === 1 && e[0]!.t === 'parrafo' ? htmlEnLinea(e[0]!.hijos, citar) : aHtml(e, citar)}</li>`).join('')}</${et}>`;
      }
      case 'cita-bloque': return `<blockquote>${aHtml(b.hijos, citar)}</blockquote>`;
      case 'tabla': return `<table><thead><tr>${b.cabecera.map((c) => `<th>${htmlEnLinea(c, citar)}</th>`).join('')}</tr></thead><tbody>${b.filas.map((f) => `<tr>${f.map((c) => `<td>${htmlEnLinea(c, citar)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      case 'separador': return '<hr>';
      case 'codigo': return `<pre><code>${escapar(b.v)}</code></pre>`;
    }
  }).join('\n');
}
