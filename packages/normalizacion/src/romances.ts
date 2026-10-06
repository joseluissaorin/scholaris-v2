/**
 * Francés e italiano antiguos: reglas básicas, de alto rendimiento y bajo riesgo.
 * Como en castellano, la salida es una clave que se aplica igual al texto y a la
 * consulta.
 *
 * Francés (s. XVI-XVIII): u/v e i/j por posición, -oit/-oient → -ait/-aient,
 * s muda ante consonante (estre → etre, maistre → maitre), y final → i
 * (luy → lui, roy → roi) y una lista de formas frecuentes (estoit, faict, sçavoir…).
 *
 * Italiano (s. XVI-XVIII): h etimológica (huomo, hauere, hoggi), u/v, j → i,
 * -tione/-tia → -zione/-zia, ct/pt → tt, x → s, ph → f, th → t, et → e.
 */

import { compilarPrefijos, solo, type PalabraNormalizada } from './comun.js';

// ---------------------------------------------------------------------------
// Francés
// ---------------------------------------------------------------------------

export const PALABRAS_FR: Record<string, string> = {
  estoit: 'etait', estoient: 'etaient', avoit: 'avait', avoient: 'avaient', estre: 'etre', mesme: 'meme', mesmes: 'memes',
  nostre: 'notre', nostres: 'notres', vostre: 'votre', vostres: 'votres', aussy: 'aussi', ainsy: 'ainsi', cy: 'ci', icy: 'ici',
  ung: 'un', vng: 'un', faict: 'fait', faicts: 'faits', faicte: 'faite', dict: 'dit', dicts: 'dits', dicte: 'dite',
  aultre: 'autre', aultres: 'autres', eust: 'eut', fust: 'fut', nuict: 'nuit', scavoir: 'savoir', sçavoir: 'savoir',
  scay: 'sais', scait: 'sait', cognoistre: 'connaitre', connoistre: 'connaitre', paroistre: 'paraitre', françois: 'francais',
  francois: 'francais', anglois: 'anglais', foible: 'faible', foiblesse: 'faiblesse', monsr: 'monsieur', mr: 'monsieur',
  roy: 'roi', loy: 'loi', foy: 'foi', moy: 'moi', toy: 'toi', soy: 'soi', luy: 'lui', celuy: 'celui', ay: 'ai', vray: 'vrai', vraye: 'vraie',
};

/** -oit / -oient que no son imperfectos (o donde el cambio crearía choques). */
const OIT_LEGITIMOS = new Set(['soit', 'voit', 'doit', 'croit', 'boit', 'toit', 'droit', 'endroit', 'adroit', 'maladroit', 'etroit', 'exploit', 'recoit', 'decoit', 'concoit', 'apercoit', 'percoit', 'soient', 'voient', 'croient', 'envoient']);

export function palabraFr(w: string): PalabraNormalizada {
  if (w.length === 0 || /^\d+$/.test(w)) return solo(w);
  const directa = PALABRAS_FR[w];
  if (directa !== undefined) return solo(directa);
  let s = w;
  s = s.replace(/^v(?=[^aeiouy])/, 'u');
  if (s.includes('u')) s = s.replace(/([aeiou])u(?=[aeiou])/g, '$1v');
  s = s.replace(/^i(?=[aeou])/, 'j');
  if (!OIT_LEGITIMOS.has(s)) {
    if (s.length >= 6 && s.endsWith('oit')) s = `${s.slice(0, -3)}ait`;
    else if (s.length >= 7 && s.endsWith('oient')) s = `${s.slice(0, -5)}aient`;
  }
  // s muda ante consonante (no la doble): estre, maistre, teste, isle, mesme
  if (s.includes('s')) s = s.replace(/(?<=[aeiou])s(?=[tmlnpcq])/g, '');
  if (s.endsWith('y') && s.length > 1 && /[aeiou]y$/.test(s)) s = `${s.slice(0, -1)}i`;
  return solo(s);
}

// ---------------------------------------------------------------------------
// Italiano
// ---------------------------------------------------------------------------

export const PALABRAS_IT: Record<string, string> = {
  huomo: 'uomo', huomini: 'uomini', hoggi: 'oggi', hora: 'ora', hore: 'ore', hebbe: 'ebbe', hebbero: 'ebbero', et: 'e',
  hauere: 'avere', havere: 'avere', haueua: 'aveva', haveva: 'aveva', hauea: 'avea', havea: 'avea', anchora: 'ancora',
  imperoche: 'imperocche', percioche: 'perciocche', conciosia: 'conciossia',
};
const MODERNAS_CON_H = new Set(['ho', 'hai', 'ha', 'hanno']);

const prefijosIt = compilarPrefijos({ hau: 'av', hav: 'av', huom: 'uom', histor: 'istor', honor: 'onor', honest: 'onest', human: 'uman', humil: 'umil' });

export function palabraIt(w: string): PalabraNormalizada {
  if (w.length === 0 || /^\d+$/.test(w)) return solo(w);
  const directa = PALABRAS_IT[w];
  if (directa !== undefined) return solo(directa);
  let s = prefijosIt(w);
  if (s.startsWith('h') && !MODERNAS_CON_H.has(s)) s = s.slice(1);
  s = s.replace(/^v(?=[^aeiou])/, 'u');
  if (s.includes('u')) s = s.replace(/([aeiou])u(?=[aeiou])/g, '$1v');
  if (s.includes('j')) s = s.replace(/j/g, 'i');
  if (s.includes('ph')) s = s.replace(/ph/g, 'f');
  if (s.includes('th')) s = s.replace(/th/g, 't');
  if (s.includes('x')) s = s.replace(/x/g, 's');
  if (s.includes('ct') || s.includes('pt')) s = s.replace(/[cp]t/g, 'tt');
  if (s.includes('ti')) s = s.replace(/(?<=[a-rt-z])ti(?=[aeiou])/g, 'zi');
  return solo(s);
}

// ---------------------------------------------------------------------------
// Detección
// ---------------------------------------------------------------------------

const RE_SENALES_FR = /ſ|(?<![\p{L}])(?:estoit|estoient|avoit|avoient|faisoit|disoit|estre|mesme|mesmes|nostre|vostre|aussy|ainsy|icy|faict|dict|aultre|eust|fust|nuict|sçavoir|scavoir|cognoistre|connoistre|roy|loy|foy|moy|luy|celuy|vray|maistre|teste|beste|feste|isle|ung)(?![\p{L}])|\p{L}{3,}oient(?![\p{L}])/gu;
const RE_SENALES_IT = /ſ|(?<![\p{L}])(?:huomo|huomini|hoggi|hauere|havere|haueua|haveva|hauea|havea|hebbe|anchora|imperoche|percioche|et)(?![\p{L}])|\p{L}+tione(?![\p{L}])|\p{L}+tia(?![\p{L}])/gu;

export function senalesRomance(texto: string, lengua: 'fr' | 'it'): { senales: number; palabras: number } {
  const t = texto.normalize('NFC').toLowerCase();
  const palabras = (t.match(/\p{L}+/gu) ?? []).length;
  const senales = (t.match(lengua === 'fr' ? RE_SENALES_FR : RE_SENALES_IT) ?? []).length;
  return { senales, palabras };
}
