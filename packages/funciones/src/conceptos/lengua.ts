/**
 * Utilidades lingüísticas ligeras para la extracción de conceptos: detección
 * de idioma por palabras vacías, tokenización con posiciones, frases, plurales
 * y normalización. Sin modelos: corre igual en un Worker que en Node.
 */

const VACIAS: Record<string, string[]> = {
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'por', 'con', 'para', 'es', 'se', 'su', 'al', 'lo', 'como', 'pero', 'sus', 'más'],
  en: ['the', 'of', 'and', 'to', 'in', 'is', 'that', 'for', 'it', 'with', 'as', 'was', 'on', 'be', 'by', 'this', 'which', 'are', 'from', 'an'],
  fr: ['le', 'la', 'les', 'de', 'des', 'du', 'et', 'en', 'un', 'une', 'est', 'que', 'qui', 'dans', 'pour', 'pas', 'sur', 'au', 'avec', 'ce', 'il'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'del', 'della', 'che', 'e', 'un', 'una', 'per', 'con', 'non', 'sono', 'nel', 'nella', 'è', 'si'],
  pt: ['o', 'a', 'os', 'as', 'de', 'do', 'da', 'que', 'e', 'em', 'um', 'uma', 'para', 'com', 'não', 'por', 'se', 'na', 'no', 'mais'],
  de: ['der', 'die', 'das', 'und', 'zu', 'den', 'ist', 'nicht', 'von', 'sie', 'mit', 'dem', 'des', 'auf', 'für', 'ein', 'eine', 'auch', 'es', 'sich'],
  ca: ['el', 'la', 'els', 'les', 'de', 'del', 'que', 'i', 'en', 'un', 'una', 'per', 'amb', 'és', 'al', 'als', 'no', 'però', 'més', 'seu'],
  la: ['et', 'in', 'est', 'non', 'ad', 'cum', 'quod', 'qui', 'quae', 'ut', 'sed', 'enim', 'autem', 'esse', 'ab', 'per', 'ex', 'nec', 'sunt', 'quam'],
};

const CONJUNTOS = Object.fromEntries(Object.entries(VACIAS).map(([k, v]) => [k, new Set(v)]));

/** Idioma más probable de un texto (o null si no hay pistas). */
export function detectarIdioma(texto: string): string | null {
  const palabras = texto.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (palabras.length < 4) return null;
  let mejor: string | null = null, max = 0;
  for (const [idioma, conj] of Object.entries(CONJUNTOS)) {
    let n = 0;
    for (const p of palabras.slice(0, 400)) if (conj.has(p)) n++;
    if (n > max) { max = n; mejor = idioma; }
  }
  return max >= 2 ? mejor : null;
}

/** Minúsculas y sin diacríticos (la ñ se conserva). */
export function normalizar(s: string): string {
  return s.toLowerCase().replace(/ñ/g, '\u0000').normalize('NFD').replace(/\p{M}+/gu, '').replace(/\u0000/g, 'ñ');
}

export interface Token { texto: string; norma: string; ini: number; fin: number }

export function tokenizar(texto: string): Token[] {
  const salida: Token[] = [];
  for (const m of texto.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    salida.push({ texto: m[0], norma: normalizar(m[0]), ini: m.index!, fin: m.index! + m[0].length });
  }
  return salida;
}

/** Límites de la frase que contiene la posición `pos`. */
export function fraseEn(texto: string, ini: number, fin: number): { ini: number; fin: number } {
  let a = ini;
  while (a > 0 && !/[.!?…\n]/.test(texto[a - 1]!)) a--;
  while (a < ini && /\s/.test(texto[a]!)) a++;
  let b = fin;
  while (b < texto.length && !/[.!?…\n]/.test(texto[b]!)) b++;
  if (b < texto.length) b++;
  // Frases desmesuradas (sin puntuación): se recortan a ±200 caracteres.
  if (ini - a > 200) a = texto.lastIndexOf(' ', ini - 200) + 1;
  if (b - fin > 200) { const c = texto.indexOf(' ', fin + 200); b = c < 0 ? texto.length : c; }
  return { ini: a, fin: b };
}

export function frases(texto: string): Array<{ ini: number; fin: number }> {
  const salida: Array<{ ini: number; fin: number }> = [];
  for (const m of texto.matchAll(/[^.!?…\n]+[.!?…]*/gu)) {
    const t = m[0];
    const lead = t.length - t.trimStart().length;
    if (t.trim().length > 3) salida.push({ ini: m.index! + lead, fin: m.index! + t.trimEnd().length });
  }
  return salida;
}

/** Formas flexionadas probables (plural y género básicos) de un lema, ya normalizadas. */
export function variantes(lema: string, idioma: string | null): string[] {
  const l = normalizar(lema.trim());
  const v = new Set([l]);
  if (!l || l.includes(' ')) return [...v];
  switch (idioma) {
    case 'es': case 'ca': case 'pt': case 'gl':
      if (/[aeiou]$/.test(l)) v.add(l + 's'); else v.add(l + 'es');
      if (l.endsWith('z')) v.add(l.slice(0, -1) + 'ces');
      if (l.endsWith('o')) { v.add(l.slice(0, -1) + 'a'); v.add(l.slice(0, -1) + 'as'); }
      if (l.endsWith('or')) { v.add(l + 'a'); v.add(l + 'as'); }
      if (idioma === 'pt' && l.endsWith('m')) v.add(l.slice(0, -1) + 'ns');
      if (idioma === 'pt' && l.endsWith('ao')) { v.add(l.slice(0, -2) + 'oes'); v.add(l.slice(0, -2) + 'aes'); }
      break;
    case 'fr':
      v.add(l + 's');
      if (l.endsWith('al')) v.add(l.slice(0, -2) + 'aux');
      if (l.endsWith('eau') || l.endsWith('eu')) v.add(l + 'x');
      if (l.endsWith('e')) v.add(l + 's'); else { v.add(l + 'e'); v.add(l + 'es'); }
      break;
    case 'it':
      if (l.endsWith('o')) { v.add(l.slice(0, -1) + 'i'); v.add(l.slice(0, -1) + 'a'); v.add(l.slice(0, -1) + 'e'); }
      if (l.endsWith('a')) v.add(l.slice(0, -1) + 'e');
      if (l.endsWith('e')) v.add(l.slice(0, -1) + 'i');
      break;
    case 'de':
      for (const s of ['e', 'en', 'n', 'er', 's', 'in', 'innen']) v.add(l + s);
      break;
    case 'la':
      for (const s of ['ae', 'am', 'arum', 'is', 'as', 'i', 'o', 'um', 'orum', 'os', 'es', 'em', 'ibus', 'us']) {
        if (/(a|us|um)$/.test(l)) v.add(l.replace(/(a|us|um)$/, '') + s);
      }
      break;
    default: // inglés y desconocidos
      v.add(l + 's');
      if (/(s|x|z|ch|sh)$/.test(l)) v.add(l + 'es');
      if (/[^aeiou]y$/.test(l)) v.add(l.slice(0, -1) + 'ies');
      if (l.endsWith('man')) v.add(l.slice(0, -3) + 'men');
  }
  return [...v];
}

export const NOMBRES_IDIOMAS: Record<string, string> = {
  es: 'español', en: 'inglés', fr: 'francés', it: 'italiano', pt: 'portugués', de: 'alemán', ca: 'catalán', la: 'latín',
  gl: 'gallego', eu: 'euskera', nl: 'neerlandés', ru: 'ruso', zh: 'chino', ja: 'japonés', ar: 'árabe', el: 'griego', grc: 'griego antiguo',
};
