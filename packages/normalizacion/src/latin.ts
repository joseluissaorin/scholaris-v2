/**
 * Latín: grafías (u/v → u, i/j → i, æ → ae → e, œ → oe → e, y → i, michi →
 * mihi, -cio/-cia medievales → -tio/-tia), enclíticos (-que, -ne, -ve) como
 * tokens aparte y raíces con el lematizador de sufijos de Schinke et al. (1996),
 * «A stemming algorithm for Latin text databases», Journal of Documentation 52.
 *
 * Schinke da dos raíces por palabra (nominal y verbal); las dos van como tokens
 * extra al final del texto de búsqueda, de modo que «amoris», «amorem» y «amor»
 * comparten «amor», y «amabat», «amant», «amo» comparten «am»/«ama».
 */

import { solo, type PalabraNormalizada } from './comun.js';

/** Palabras en -que que NO llevan el enclítico (Schinke, lista original con u/i). */
export const PALABRAS_QUE = new Set(
  ('atque quoque neque itaque absque apsque abusque adaeque adusque denique deque susque oblique peraeque plenisque ' +
    'quandoque quisque quaeque cuiusque cuique quemque quamque quaque quique quorumque quarumque quibusque quosque ' +
    'quasque quotusquisque quousque ubique undique usque uterque utique utroque utribique torque coque concoque ' +
    'contorque detorque decoque excoque extorque obtorque optorque retorque recoque attorque incoque intorque praetorque ' +
    // y algunas frecuentes que faltan en la lista original
    'namque utrumque utraque utrique utriusque quidque quodque quicumque quaecumque quodcumque quacumque quocumque ' +
    'ubicumque undecumque quantumque plerumque plerique pleraque quinque')
    .split(/\s+/),
);

/** Palabras en -ne / -ve que no son enclíticos. */
const NO_ENCLITICAS = new Set(['omne', 'bene', 'sine', 'pone', 'paene', 'pene', 'mane', 'inane', 'immane', 'abstine', 'sustine', 'retine', 'contine', 'pertine', 'obtine', 'detine', 'neue', 'siue', 'seue', 'breue', 'graue', 'leue', 'suaue', 'caue', 'aue', 'saeue']);

const SUFIJOS_NOMBRE = ['ibus', 'ius', 'ae', 'am', 'as', 'em', 'es', 'ia', 'is', 'nt', 'os', 'ud', 'um', 'us', 'a', 'e', 'i', 'o', 'u'];
const SUFIJOS_VERBO: Array<[string, string]> = [
  ['iuntur', 'i'], ['beris', 'bi'], ['erunt', 'i'], ['untur', 'i'], ['iunt', 'i'], ['mini', ''], ['ntur', ''], ['stis', ''],
  ['bor', 'bi'], ['ero', 'eri'], ['mur', ''], ['mus', ''], ['ris', ''], ['sti', ''], ['tis', ''], ['tur', ''], ['unt', 'i'],
  ['bo', 'bi'], ['ns', ''], ['nt', ''], ['ri', ''], ['m', ''], ['r', ''], ['s', ''], ['t', ''],
];

/** Raíz nominal de Schinke (la palabra ya con u/i). */
export function raizNominal(w: string): string {
  for (const s of SUFIJOS_NOMBRE) {
    if (w.endsWith(s) && w.length - s.length >= 2) return w.slice(0, -s.length);
  }
  return w;
}

/** Raíz verbal de Schinke (la palabra ya con u/i). */
export function raizVerbal(w: string): string {
  for (const [s, r] of SUFIJOS_VERBO) {
    if (w.endsWith(s)) {
      const raiz = w.slice(0, -s.length) + r;
      if (raiz.length >= 2) return raiz;
      return w;
    }
  }
  return w;
}

/** Grafías medievales y clásicas en una sola forma. */
export function plegarLatin(w: string): string {
  let s = w;
  if (s.includes('ae')) s = s.replace(/ae/g, 'e');
  if (s.includes('oe')) s = s.replace(/oe/g, 'e');
  if (s.includes('y')) s = s.replace(/y/g, 'i');
  if (s === 'michi') return 'mihi';
  if (s === 'nichil') return 'nihil';
  if (s.includes('ci')) s = s.replace(/(?<=[a-z])ci(?=[aeiou])/g, 'ti');
  return s;
}

/** Separa el enclítico (-que, -ne, -ue); devuelve [palabra, enclítico | null]. */
export function separarEnclitico(w: string): [string, string | null] {
  if (w.length > 4 && w.endsWith('que')) {
    if (PALABRAS_QUE.has(w)) return [w, null];
    return [w.slice(0, -3), 'que'];
  }
  if (w === 'nonne') return ['non', 'ne'];
  if (w.length > 4 && /[st]ne$/.test(w) && !NO_ENCLITICAS.has(w)) return [w.slice(0, -2), 'ne'];
  if (w.length > 4 && /[stm]ue$/.test(w) && !NO_ENCLITICAS.has(w)) return [w.slice(0, -2), 'ue'];
  return [w, null];
}

/** Normaliza una palabra latina: grafía, enclítico y raíces extra. */
export function palabraLatin(w0: string): PalabraNormalizada {
  if (w0.length === 0 || /^\d+$/.test(w0)) return solo(w0);
  let w = w0;
  if (w.includes('v')) w = w.replace(/v/g, 'u');
  if (w.includes('j')) w = w.replace(/j/g, 'i');
  const [base, enclitico] = separarEnclitico(w);
  const plegada = plegarLatin(base);
  const p = enclitico ? `${plegada} ${enclitico}` : plegada;
  if (PALABRAS_QUE.has(base) || plegada.length < 3) return solo(p);
  const extras: string[] = [];
  const n = raizNominal(plegada);
  const v = raizVerbal(plegada);
  // Raíces de menos de tres letras casan con demasiado: se quedan fuera.
  if (n !== plegada && n.length >= 3) extras.push(n);
  if (v !== plegada && v !== n && v.length >= 3) extras.push(v);
  return { p, x: extras.length ? extras : null };
}
