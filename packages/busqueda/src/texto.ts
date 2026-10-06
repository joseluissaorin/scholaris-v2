/**
 * Utilidades de texto para la búsqueda: normalización sin acentos que conserva
 * posiciones, términos de consulta, consultas FTS5 bien escapadas y resaltado.
 */

import { variantesConsulta } from '@scholaris/normalizacion';
import { limpiarMarcadoOCR, separarHablantes } from '@scholaris/nucleo';

/** Pliega un carácter: minúscula y sin diacríticos. Devuelve siempre un carácter. */
function plegarCaracter(c: string): string {
  const base = c.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  if (base.length === 1) return base;
  if (base.length === 0) return c;
  return base[0] as string;
}

/**
 * Normaliza texto para comparar: minúsculas, sin acentos, misma longitud que el
 * original (cada unidad UTF-16 se pliega a una), de modo que las posiciones de
 * una coincidencia en el texto normalizado valen para el original.
 */
export function plegar(texto: string): string {
  let s = '';
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i] as string;
    const cod = c.charCodeAt(0);
    if (cod < 128) s += cod >= 65 && cod <= 90 ? String.fromCharCode(cod + 32) : c;
    else if (cod >= 0xd800 && cod <= 0xdfff) s += c; // sustitutos: se dejan tal cual
    else s += plegarCaracter(c);
  }
  return s;
}

/** Normaliza una consulta para usarla como clave de caché. */
export function normalizarConsulta(consulta: string): string {
  return plegar(consulta)
    .replace(/[“”«»„"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras vacías mínimas por idioma (es, en, fr, it, la, de). No pretenden ser
// exhaustivas: solo evitan que un OR de FTS5 case todo el corpus.
const VACIAS = new Set(
  (
    // español
    'a al algo ante antes como con contra cual cuando de del desde donde e el ella ellas ellos en entre era es esa ese eso esta este esto fue ha han hay la las le les lo los mas me mi mis muy ni no nos o os para pero por que quien se sea segun ser si sin sobre son su sus tambien te tiene tu un una uno unos unas y ya ' +
    // inglés
    'about after all also an and any are as at be been before but by can could did do does for from had has have he her his how i if in into is it its may more most not of on or our she should so than that the their them then there these they this those to was we were what when where which who why will with would you ' +
    // francés
    'au aux avec ce ces dans des du elle en est et il ils je la le les leur lui mais me meme ne nous on ou par pas pour qu que qui sa se ses son sur ta te un une vous ' +
    // italiano
    'agli ai alla alle che chi col con da dagli dai dal dalla degli dei del della delle di ed gli il in la le lo nel nella non per piu quale questo se sono su tra un una uno ' +
    // latín
    'ac ad atque aut cum de enim est et etiam ex hic in inter nam ne nec non per post pro quae qui quid quod sed sic sub sunt tamen ut vel ' +
    // alemán
    'aber als am an auch auf aus bei das dem den der des die ein eine einem einen einer es fur hat im ist mit nach nicht oder sich sie sind und von vor war wie zu zum zur ' +
    // términos de búsqueda que no aportan
    'cita citas pagina paginas pag libro libros texto textos documento documentos dice dijo segun'
  ).split(/\s+/),
);

export function esVacia(termino: string): boolean {
  return VACIAS.has(termino);
}

/** Términos significativos (plegados) de un texto. */
export function terminos(texto: string, { conVacias = false, minimo = 2 } = {}): string[] {
  const salida: string[] = [];
  for (const m of plegar(texto).matchAll(/[\p{L}\p{N}]+/gu)) {
    const t = m[0];
    if (t.length < minimo) continue;
    if (!conVacias && VACIAS.has(t)) continue;
    salida.push(t);
  }
  return salida;
}

/** Extrae los fragmentos entrecomillados de una consulta («…», "…", “…”). */
export function citasLiterales(consulta: string): string[] {
  const salida: string[] = [];
  for (const m of consulta.matchAll(/«([^»]{2,})»|"([^"]{2,})"|“([^”]{2,})”|„([^“”]{2,})[“”]/g)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (t) salida.push(t);
  }
  return salida;
}

/** Escapa un término para FTS5: comillas dobles alrededor, comillas internas dobladas. */
export function escaparFts(termino: string): string {
  return `"${termino.replace(/"/g, '""')}"`;
}

/**
 * Variantes de ortografía antigua de un término o frase, solo en la capa
 * `texto_busqueda` (SPDF 4.1): `texto_busqueda : ("onra" OR "honr")`. null si no hay.
 */
export function filtroNormalizado(termino: string): string | null {
  const vs = variantesConsulta(termino);
  return vs.length ? `texto_busqueda : (${vs.map(escaparFts).join(' OR ')})` : null;
}

/** Un término (o frase) y, si las hay, sus variantes antiguas en la capa normalizada. */
function conVariantes(fts: string, termino: string, normalizada: boolean): string {
  const extra = normalizada ? filtroNormalizado(termino) : null;
  return extra ? `(${fts} OR ${extra})` : fts;
}

/**
 * Construye una expresión MATCH de FTS5 a partir de una consulta libre.
 *
 * - Las frases entre comillas se buscan como frase exacta.
 * - Con `normalizada` (estanterías SPDF 4.1), cada término y cada frase casan
 *   también con sus claves de ortografía antigua en `texto_busqueda`: «así es la
 *   muerte» encuentra «aſsi es la muerte». La frase literal sigue buscándose en
 *   el texto fiel.
 * - El resto de términos se combinan con OR (BM25 premia a quien casa más) y se
 *   escapan siempre: nada de lo que escribe el usuario llega como sintaxis FTS.
 * - Los acentos no importan: el índice usa `remove_diacritics 2` y aquí se
 *   pliegan los términos igual.
 *
 * Devuelve null si no queda nada que buscar.
 */
export function consultaFts(consulta: string, opciones: { modo?: 'o' | 'y'; extra?: string[]; prefijo?: boolean; normalizada?: boolean } = {}): string | null {
  const normalizada = opciones.normalizada ?? false;
  const frases = citasLiterales(consulta);
  const partes: string[] = [];
  for (const f of frases) {
    const ts = terminos(f, { conVacias: true, minimo: 1 });
    if (ts.length) partes.push(conVariantes(escaparFts(ts.join(' ')), ts.join(' '), normalizada));
  }
  if (partes.length) return partes.join(' AND ');
  const vistos = new Set<string>();
  const sueltos: string[] = [];
  for (const t of [...terminos(consulta), ...(opciones.extra ?? []).flatMap((e) => terminos(e))]) {
    if (vistos.has(t)) continue;
    vistos.add(t);
    sueltos.push(t);
    if (sueltos.length >= 32) break;
  }
  // Con frases, las frases mandan (arriba): son obligatorias y lo demás lo cubre la vía densa.
  // Si todo eran palabras vacías («ser o no ser»), se buscan tal cual.
  if (!partes.length && !sueltos.length) {
    for (const t of terminos(consulta, { conVacias: true })) if (!vistos.has(t)) { vistos.add(t); sueltos.push(t); }
  }
  const unir = opciones.modo === 'y' ? ' AND ' : ' OR ';
  const sueltosFts = sueltos.map((t, i) => conVariantes(opciones.prefijo && i === sueltos.length - 1 && t.length >= 3 ? `${escaparFts(t)}*` : escaparFts(t), t, normalizada));
  return sueltosFts.length ? sueltosFts.join(unir) : null;
}

/** Corta un texto en el primer final de frase después de `objetivo` caracteres. */
export function cortarEnFrase(texto: string, objetivo = 500, maximo = 700): string {
  if (texto.length <= objetivo) return texto;
  for (let i = objetivo; i < Math.min(texto.length, maximo); i++) {
    if ('.?!'.includes(texto[i] as string) && /\s/.test(texto[i + 1] ?? '')) return texto.slice(0, i + 1);
  }
  const corte = texto.slice(0, maximo);
  const espacio = corte.lastIndexOf(' ');
  return (espacio > objetivo ? corte.slice(0, espacio) : corte) + '…';
}

/** La etiqueta de un turno en el resaltado: `<b class="hablante">Nombre</b> `. */
export function etiquetaHablante(nombre: string): string {
  return `<b class="hablante">${escaparHtml(nombre)}</b> `;
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Resalta en `texto` los términos de la consulta (sin importar acentos ni
 * mayúsculas) y devuelve una ventana de unos `ventana` caracteres centrada en la
 * zona con más coincidencias. El texto sale escapado como HTML y las
 * coincidencias envueltas en `<mark>`.
 */
export function resaltar(textoCrudo: string, consultaTerminos: string[], ventana = 280): string {
  // Las marcas de hablante («**Nombre:**») se separan antes de recortar: si la
  // ventana las partiera, el Markdown saldría crudo. Vuelven como etiqueta propia.
  const { texto, hablantes } = separarHablantes(limpiarMarcadoOCR(textoCrudo));
  const plano = plegar(texto);
  const unicos = [...new Set(consultaTerminos.filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  const tramos: Array<[number, number]> = [];
  if (unicos.length) {
    const patron = new RegExp(`(?<![\\p{L}\\p{N}])(?:${unicos.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]{0,3}(?![\\p{L}\\p{N}])`, 'gu');
    for (const m of plano.matchAll(patron)) tramos.push([m.index, m.index + m[0].length]);
  }
  // Ventana: la que contiene más coincidencias.
  let desde = 0;
  let hasta = texto.length;
  if (texto.length > ventana) {
    let mejor = 0, mejorInicio = 0;
    for (let i = 0; i < tramos.length; i++) {
      const inicio = (tramos[i] as [number, number])[0];
      let n = 0;
      for (let j = i; j < tramos.length && (tramos[j] as [number, number])[1] <= inicio + ventana; j++) n++;
      if (n > mejor) { mejor = n; mejorInicio = inicio; }
    }
    desde = Math.max(0, mejorInicio - Math.floor(ventana / 4));
    // Ajusta al principio de palabra.
    if (desde > 0) { const e = texto.indexOf(' ', desde); if (e !== -1 && e - desde < 20) desde = e + 1; }
    hasta = Math.min(texto.length, desde + ventana);
    if (hasta < texto.length) { const e = texto.lastIndexOf(' ', hasta); if (e > desde + ventana / 2) hasta = e; }
  }
  // El tramo [a, b) escapado, con la etiqueta de cada turno que empiece dentro.
  // `antesDeMarca`: la etiqueta que cae justo donde empieza una coincidencia va fuera del <mark>.
  const trozo = (a: number, b: number, antesDeMarca = false, dentroDeMarca = false) => {
    let out = '', c = a;
    for (const h of hablantes) if ((dentroDeMarca ? h.pos > a : h.pos >= a) && (antesDeMarca ? h.pos <= b : h.pos < b)) { out += escaparHtml(texto.slice(c, h.pos)) + etiquetaHablante(h.nombre); c = h.pos; }
    return out + escaparHtml(texto.slice(c, b));
  };
  let salida = desde > 0 ? '…' : '';
  // Si la ventana empieza a mitad de un turno, se dice de quién es.
  const enCurso = desde > 0 && !hablantes.some((h) => h.pos === desde) ? hablantes.filter((h) => h.pos < desde).at(-1) : undefined;
  if (enCurso) salida += etiquetaHablante(enCurso.nombre);
  let cursor = desde;
  for (const [a, b] of tramos) {
    if (b <= desde || a >= hasta) continue;
    const aa = Math.max(a, desde), bb = Math.min(b, hasta);
    salida += trozo(cursor, aa, true) + '<mark>' + trozo(aa, bb, false, true) + '</mark>';
    cursor = bb;
  }
  salida += trozo(cursor, hasta);
  if (hasta < texto.length) salida += '…';
  return salida;
}

/** Proporción de términos de `a` presentes en `b` (plegados). */
export function solape(a: string, b: string): number {
  const ta = new Set(terminos(a));
  if (!ta.size) return 0;
  const tb = new Set(terminos(b));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / ta.size;
}

/** ¿Aparece `aguja` literalmente en `pajar`, sin contar acentos, comillas ni espacios? */
export function contieneLiteral(pajar: string, aguja: string): boolean {
  const n = (s: string) => plegar(s).replace(/[“”«»„"'‘’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const a = n(aguja);
  return a.length > 0 && n(pajar).includes(a);
}
