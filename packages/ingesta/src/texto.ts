/** Utilidades de texto puras: tokens, frases, párrafos y comparación. */

/** Estimación barata de tokens (BPE de los modelos actuales ≈ 4 caracteres en inglés, algo menos en español). */
export function contarTokens(texto: string): number {
  if (!texto) return 0;
  const palabras = texto.match(/\S+/g)?.length ?? 0;
  return Math.max(Math.ceil(texto.length / 4), Math.ceil(palabras * 1.3));
}

const ABREVIATURAS = new Set([
  // inglés
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'vol', 'vols', 'no', 'pp', 'p', 'ed', 'eds', 'fig', 'figs', 'ch', 'chap', 'sec', 'al', 'jr', 'sr', 'inc', 'ltd', 'co', 'approx', 'ca', 'viz', 'op', 'cit', 'ibid', 'id',
  // español
  'sra', 'srta', 'dña', 'd', 'av', 'pág', 'págs', 'cap', 'núm', 'n', 'ob', 'trad', 'coord', 'coords', 'ej', 'aprox', 'art', 'arts', 'col', 'cols', 'ss', 'v', 'vid', 'lib', 'tít', 't', 'dir', 'ed', 'reimp', 'fol', 'fols', 'f', 'ff',
  // francés, alemán, latín
  'mme', 'mlle', 'm', 'bd', 'bzw', 'usw', 'vgl', 'z.b', 'ders', 'hrsg', 'sq', 'sqq', 'loc', 'ead', 'eiusd',
]);

/**
 * Parte un texto en frases. Respeta abreviaturas, iniciales («C. S. Lewis»),
 * números («3.2»), llamadas a nota y signos de apertura del español.
 */
export function partirFrases(texto: string): string[] {
  const t = texto.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const frases: string[] = [];
  let inicio = 0;
  const re = /([.!?…]+)(["”»’)\]]*)(\[\^[^\]]+\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?\s+(?=["“«¿¡(\[—–-]?\s*[\p{Lu}\p{N}])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const fin = m.index + m[0].length;
    const antes = t.slice(inicio, m.index);
    const ultima = antes.match(/(\S+)$/)?.[1] ?? '';
    const limpia = ultima.replace(/^[("“«¿¡\[]+/, '').toLowerCase();
    // Inicial suelta («C.», «J.») o abreviatura conocida: no es fin de frase.
    if (m[1] === '.' && (/^\p{L}$/u.test(limpia) || ABREVIATURAS.has(limpia) || /^(\p{L}\.)+\p{L}?$/u.test(limpia))) continue;
    frases.push(t.slice(inicio, fin).trim());
    inicio = fin;
  }
  const resto = t.slice(inicio).trim();
  if (resto) frases.push(resto);
  return frases;
}

/** Parte un bloque de texto en párrafos (líneas en blanco). Une los guiones de fin de línea. */
export function partirParrafos(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => unirLineas(p))
    .filter((p) => p.length > 0);
}

/** Une las líneas de un párrafo: «pala-\nbra» → «palabra»; respeta listas y títulos Markdown. */
export function unirLineas(parrafo: string): string {
  const lineas = parrafo.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lineas.length <= 1) return lineas[0] ?? '';
  // Listas y tablas: se conservan las líneas.
  if (lineas.every((l) => /^([-*+•]|\d+[.)]|\|)/.test(l))) return lineas.join('\n');
  // Verso (teatro, poesía): muchas líneas cortas sin guion de corte. Se conservan.
  const cortas = lineas.filter((l) => l.length < 60).length;
  if (lineas.length >= 3 && cortas >= lineas.length * 0.8 && !lineas.some((l) => /\p{L}-$/u.test(l))) return lineas.join('\n');
  let s = lineas[0] as string;
  for (let i = 1; i < lineas.length; i++) {
    const l = lineas[i] as string;
    if (/^#{1,6}\s/.test(l) || /^#{1,6}\s/.test(s.split('\n').at(-1) ?? '')) { s += '\n' + l; continue; }
    if (/\p{L}-$/u.test(s) && /^\p{Ll}/u.test(l)) s = s.slice(0, -1) + l;
    else s += ' ' + l;
  }
  return s;
}

/** ¿El párrafo es un título Markdown? Devuelve nivel y texto. */
export function esTituloMarkdown(p: string): { nivel: number; texto: string } | null {
  const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(p.trim());
  if (!m || p.includes('\n')) return null;
  return { nivel: (m[1] as string).length, texto: limpiarMarkdown(m[2] as string) };
}

export function limpiarMarkdown(s: string): string {
  return s.replace(/[*_`]+/g, '').replace(/\[\^[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
}

/** Normaliza para comparar: minúsculas, sin diacríticos, sin puntuación. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Similitud 0-1 entre dos cadenas (Dice sobre bigramas de la forma normalizada). */
export function similitud(a: string, b: string): number {
  const x = normalizar(a).replace(/ /g, '');
  const y = normalizar(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bigramas = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
    return m;
  };
  const bx = bigramas(x), by = bigramas(y);
  let comun = 0;
  for (const [g, n] of bx) comun += Math.min(n, by.get(g) ?? 0);
  return (2 * comun) / (x.length - 1 + y.length - 1);
}

/** ¿El texto termina como termina una frase? */
export function terminaFrase(s: string): boolean {
  return /[.!?…:;»”"')\]]\s*(\[\^[^\]]+\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?\s*$/.test(s.trim());
}

/** Proporción de caracteres «raros» (capa de texto rota, mojibake, CID). */
export function proporcionBasura(s: string): number {
  if (!s) return 1;
  const raros = s.match(/[�\u0000-\u0008\u000E-\u001F]|\(cid:\d+\)|[ÃÂ][\u0080-¿]/g)?.length ?? 0;
  const letras = s.match(/\p{L}/gu)?.length ?? 0;
  return Math.min(1, (raros * 4) / Math.max(1, s.length) + (letras / Math.max(1, s.length) < 0.4 ? 0.5 : 0));
}
