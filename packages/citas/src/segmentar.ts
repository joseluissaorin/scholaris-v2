/** División de un texto del usuario en párrafos y afirmaciones, con posiciones exactas. */

export interface TramoTexto { inicio: number; fin: number; texto: string }

export interface Parrafo extends TramoTexto { indice: number }

export interface Afirmacion extends TramoTexto {
  id: string;
  parrafo: number;
  /** Ya lleva una cita en el texto: «(Darwin, 1859, p. 81)», «[3]», una nota. */
  yaCitada: boolean;
}

/**
 * Párrafos: separados por líneas en blanco, separadores «---» o títulos Markdown.
 * Como en la versión anterior, los párrafos cortos se unen al siguiente hasta
 * pasar de `minimo` caracteres, para dar al modelo contexto suficiente.
 */
export function dividirParrafos(texto: string, minimo = 200): Parrafo[] {
  const bloques: TramoTexto[] = [];
  const re = /\n[ \t]*\n|\n-{3,}[ \t]*\n/g;
  let desde = 0;
  const empujar = (a: number, b: number) => {
    let i = a, j = b;
    while (i < j && /\s/.test(texto[i] as string)) i++;
    while (j > i && /\s/.test(texto[j - 1] as string)) j--;
    if (j > i) bloques.push({ inicio: i, fin: j, texto: texto.slice(i, j) });
  };
  for (const m of texto.matchAll(re)) { empujar(desde, m.index); desde = m.index + m[0].length; }
  empujar(desde, texto.length);
  const salida: Parrafo[] = [];
  let actual: TramoTexto | null = null;
  for (const b of bloques) {
    if (/^#{1,6}\s/.test(b.texto)) { // un título cierra el párrafo en curso y no se cita
      if (actual) { salida.push({ ...actual, indice: salida.length }); actual = null; }
      continue;
    }
    actual = actual ? { inicio: actual.inicio, fin: b.fin, texto: texto.slice(actual.inicio, b.fin) } : b;
    if (actual.texto.length > minimo) { salida.push({ ...actual, indice: salida.length }); actual = null; }
  }
  if (actual) salida.push({ ...actual, indice: salida.length });
  return salida;
}

const ABREVIATURAS = /(?:^|[\s(])(?:p|pp|cf|cfr|vid|vol|vols|ed|eds|ibid|op|cit|s|ss|n|núm|art|cap|fig|trad|coord|dir|etc|sr|sra|dr|dra|st|vs|e\.g|i\.e|et al|al|aprox|pág|págs|fol|ff|ca|c|no|nr|mr|mrs|ms|prof|lib|sig)\.$/i;
const CITA_PREVIA = /\([^()]*\b(1[4-9]\d{2}|20\d{2}|s\.\s?f\.|n\.d\.)[^()]*\)|\[\d+(?:[,–-]\s?\d+)*\]|\[\^\d+\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+/;

/** Afirmaciones: frases de un párrafo con al menos `minimo` caracteres. */
export function dividirAfirmaciones(parrafo: Parrafo, minimo = 25): Afirmacion[] {
  const t = parrafo.texto;
  const salida: Afirmacion[] = [];
  let inicio = 0;
  const cerrar = (fin: number) => {
    let a = inicio, b = fin;
    while (a < b && /\s/.test(t[a] as string)) a++;
    while (b > a && /\s/.test(t[b - 1] as string)) b--;
    const texto = t.slice(a, b);
    if (texto.replace(/[^\p{L}]/gu, '').length >= minimo * 0.6 && texto.length >= minimo) {
      salida.push({ id: `A${parrafo.indice + 1}.${salida.length + 1}`, parrafo: parrafo.indice, inicio: parrafo.inicio + a, fin: parrafo.inicio + b, texto, yaCitada: CITA_PREVIA.test(texto) });
    }
    inicio = fin;
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (c === '\n' && t[i + 1] === '\n') { cerrar(i); continue; }
    if (!'.?!…'.includes(c)) continue;
    // Absorbe cierres: comillas, paréntesis, notas.
    let j = i + 1;
    while (j < t.length && /[»”"')\]¹²³⁴⁵⁶⁷⁸⁹⁰]/.test(t[j] as string)) j++;
    if (j < t.length && !/\s/.test(t[j] as string)) continue; // «3.5», «e.g.x»
    if (c === '.' && ABREVIATURAS.test(t.slice(Math.max(0, i - 8), i + 1))) continue;
    if (c === '.' && /\b\p{Lu}\.$/u.test(t.slice(Math.max(0, i - 2), i + 1))) continue; // iniciales: «C. S. Lewis»
    if (j < t.length && /^\s+\p{Ll}/u.test(t.slice(j, j + 3))) continue; // sigue en minúscula: no es fin de frase
    cerrar(j);
    i = j - 1;
  }
  cerrar(t.length);
  return salida;
}

/**
 * Posición donde se inserta la cita de una afirmación:
 * - fecha-autor: antes del punto final (y de comillas de cierre no; después de ellas);
 * - notas: después de la puntuación final.
 */
export function puntoDeInsercion(texto: string, inicio: number, fin: number, modo: 'autor-fecha' | 'nota'): number {
  let f = fin;
  if (modo === 'autor-fecha') {
    while (f > inicio && '.?!…:;,'.includes(texto[f - 1] as string)) f--;
    // «… de visibilidad».  → la cita va tras las comillas y antes del punto: «…» (Darwin, 1859).
    return f;
  }
  while (f < texto.length && /[.?!…:;,»”"')\]]/.test(texto[f] as string)) f++;
  return f;
}
