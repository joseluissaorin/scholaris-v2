/**
 * Piezas comunes de la normalización: lengua, época, preparación de caracteres
 * (abreviaturas con tilde o macrón, ſ, ligaduras, cedilla) y la memoria de
 * palabras ya normalizadas, que es lo que hace rápida la capa: el vocabulario de
 * un texto sigue la ley de Zipf y casi todas las palabras se repiten.
 */

/** Lenguas con reglas propias. «otra» solo recibe el plegado básico. */
export type Lengua = 'es' | 'la' | 'fr' | 'it' | 'otra';

/**
 * Época de la ortografía: un año (de la edición original), o ya decidida.
 * Sin época, se deduce del propio texto (`detectarEpoca`).
 */
export type Epoca = number | 'antigua' | 'moderna';

/** Resultado de normalizar una palabra: la forma principal y, si hay, tokens extra (raíces latinas). */
export interface PalabraNormalizada {
  /** Una o varias palabras separadas por espacios («desta» → «de esta», «uirumque» → «uirum que»). */
  p: string;
  /** Tokens que se añaden al final del texto (no rompen las frases de la forma principal). */
  x: string[] | null;
}

/** Códigos que ya dicen «ortografía antigua» por sí mismos (ISO 639-3). */
const CODIGOS_ANTIGUOS = new Set(['osp', 'fro', 'frm', 'ita-old', 'es-old']);

/** Lengua de un código BCP-47 / ISO 639 / nombre («es», «es-ES», «spa», «lat», «fr», «osp»…). */
export function lenguaDe(idioma?: string | null): Lengua {
  const i = (idioma ?? '').toLowerCase().trim();
  if (!i) return 'otra';
  const base = i.split(/[-_\s]/)[0] ?? '';
  switch (base) {
    case 'es': case 'spa': case 'esp': case 'osp': case 'castellano': case 'espanol': case 'español': case 'spanish':
      return 'es';
    case 'la': case 'lat': case 'latin': case 'latín':
      return 'la';
    case 'fr': case 'fra': case 'fre': case 'frm': case 'fro': case 'francais': case 'français': case 'french':
      return 'fr';
    case 'it': case 'ita': case 'italiano': case 'italian':
      return 'it';
    default:
      return 'otra';
  }
}

/** ¿El código ya marca una variedad antigua? */
export function codigoAntiguo(idioma?: string | null): boolean {
  return CODIGOS_ANTIGUOS.has((idioma ?? '').toLowerCase().trim());
}

/** Año a partir del cual se considera moderna la ortografía de cada lengua. */
export const UMBRAL_MODERNO: Record<Lengua, number> = {
  es: 1830, // la Ortografía de la RAE de 1815 y su asentamiento
  fr: 1800, // la ortografía de 1835 del Diccionario de la Academia, con margen
  it: 1800,
  la: 0,
  otra: 0,
};

// ---------------------------------------------------------------------------
// Caracteres
// ---------------------------------------------------------------------------

/** Letras especiales y ligaduras que NFD no descompone. */
const ESPECIALES: Record<string, string> = {
  'ſ': 's', 'ʃ': 's', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ꝑ': 'per', 'ꝓ': 'pro', 'ꝗ': 'que', 'ꝙ': 'quod', 'ꝯ': 'con',
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', 'ꝛ': 'r', 'ı': 'i', 'ȷ': 'j',
  'ø': 'o', 'đ': 'd', 'ł': 'l', 'ħ': 'h',
};
const RE_ESPECIALES = /[ſʃßæœꝑꝓꝗꝙꝯﬀﬁﬂﬃﬄﬅﬆꝛıȷøđłħ]/g;

/** Conjunción que representa «&» o la nota tironiana «⁊» en cada lengua. */
const ET: Record<Lengua, string> = { es: ' y ', la: ' et ', fr: ' et ', it: ' e ', otra: ' ' };

/** Marcas combinantes (tras NFD). */
const RE_COMBINANTES = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const RE_NO_ASCII = /[^\x00-\x7f]/;

/**
 * Prepara un texto para trocearlo en palabras: NFD, minúsculas, letras
 * especiales, abreviaturas con tilde o macrón («q̃» → que, «ẽ» → en, «õ» → on, y
 * «m» delante de p/b), ñ conservada, cedilla castellana (ç → z ante a/o/u, c ante
 * e/i) y fuera el resto de diacríticos.
 */
export function prepararCaracteres(texto: string, lengua: Lengua): string {
  let s = texto.normalize('NFD').toLowerCase();
  if (s.includes('&') || s.includes('⁊')) s = s.replace(/[&⁊]/g, ET[lengua]);
  if (!RE_NO_ASCII.test(s)) return s;
  s = s.replace(RE_ESPECIALES, (c) => ESPECIALES[c] ?? c);
  if (lengua !== 'otra') {
    // Abreviaturas: q̃ / q̄ = que; vocal con tilde o macrón = vocal + nasal.
    s = s.replace(/q[̃̄]/g, 'que');
    s = s.replace(/([aeiou])[̃̄]+([pb]?)/g, (_m, v: string, pb: string) => `${v}${pb ? 'm' : 'n'}${pb}`);
  }
  if (lengua === 'es') {
    s = s.replace(/ñ/g, 'ñ');
    s = s.replace(/ç([ei]?)/g, (_m, v: string) => (v ? `c${v}` : 'z'));
  }
  return s.replace(RE_COMBINANTES, '');
}

/** Palabras del texto ya preparado (letras y cifras de cualquier escritura). */
export const RE_PALABRA = /[\p{L}\p{N}]+/gu;

/** Plegado básico, el mismo que hace FTS5 con `remove_diacritics`: minúsculas, sin diacríticos, solo palabras. */
export function plegadoBasico(texto: string): string {
  const s = texto.normalize('NFD').toLowerCase().replace(RE_COMBINANTES, '');
  return (s.match(RE_PALABRA) ?? []).join(' ');
}

// ---------------------------------------------------------------------------
// Memoria de palabras
// ---------------------------------------------------------------------------

const MAXIMO_MEMORIA = 200_000;

/** Memoria acotada palabra → normalización, una por regla (lengua + época). */
export class Memoria {
  private mapa = new Map<string, PalabraNormalizada>();
  constructor(private readonly fn: (palabra: string) => PalabraNormalizada) {}

  get(palabra: string): PalabraNormalizada {
    let r = this.mapa.get(palabra);
    if (r === undefined) {
      r = this.fn(palabra);
      if (this.mapa.size >= MAXIMO_MEMORIA) this.mapa.clear();
      this.mapa.set(palabra, r);
    }
    return r;
  }
}

/** Atajo para reglas sin tokens extra. */
export const solo = (p: string): PalabraNormalizada => ({ p, x: null });

/**
 * Sustituye el prefijo más largo que case con alguna clave del mapa.
 * El mapa se compila a una expresión regular anclada al principio.
 */
export function compilarPrefijos(mapa: Record<string, string>): (w: string) => string {
  const claves = Object.keys(mapa).sort((a, b) => b.length - a.length);
  const re = new RegExp(`^(?:${claves.join('|')})`);
  return (w) => {
    const m = re.exec(w);
    return m ? (mapa[m[0]] as string) + w.slice(m[0].length) : w;
  };
}
