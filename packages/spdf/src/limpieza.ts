/**
 * Limpieza de metadatos heredados: autores, títulos, idioma. Funciones puras.
 */

import type { Autor } from '@scholaris/nucleo';

const VACIOS = /^(?:\[?not[_ ]found\]?|n\/?a|none|null|unknown|desconocido|sin datos|-+)$/i;

export function esVacio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return !s || VACIOS.test(s);
}

export function limpiarEspacios(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'i', 'van', 'von', 'der', 'den', 'da', 'das', 'do', 'dos', 'di', 'du', 'le', 'el', 'af', 'zu', 'ten', 'ter', 'st.', 'san', 'santa']);
const INICIAL = /^\p{Lu}\.(?:-?\p{Lu}\.)*$/u;

/**
 * «Julio Cortázar» → {Julio, Cortázar}; «C. S. Lewis» → {C. S., Lewis};
 * «Lope de Vega Carpio» → {Lope, de Vega Carpio}; «Foucault, Michel» → {Michel, Foucault};
 * «José Luis Saorín Ferrer» → {José Luis, Saorín Ferrer}; «Vaswani» → {"", Vaswani}.
 */
export function parsearAutor(entrada: string): Autor | null {
  const s = limpiarEspacios(entrada.replace(/^[;,.\s]+|[;,\s]+$/g, ''));
  if (esVacio(s)) return null;
  if (s.includes(',')) {
    const [apellidos, ...resto] = s.split(',');
    const nombre = limpiarEspacios(resto.join(','));
    return { nombre, apellidos: limpiarEspacios(apellidos ?? '') };
  }
  const fichas = s.split(' ');
  if (fichas.length === 1) return { nombre: '', apellidos: s };
  // Nombre: primera ficha + iniciales que la sigan.
  let corte = 1;
  while (corte < fichas.length - 1 && INICIAL.test(fichas[corte] as string)) corte++;
  // Cuatro fichas o más sin partículas: nombre compuesto («José Luis Saorín Ferrer»).
  const sinParticulas = !fichas.some((f) => PARTICULAS.has(f.toLowerCase()));
  if (corte === 1 && fichas.length >= 4 && sinParticulas) corte = 2;
  return { nombre: fichas.slice(0, corte).join(' '), apellidos: fichas.slice(corte).join(' ') };
}

/** Autores de v3: lista JSON de cadenas, o una cadena «A; B», «A and B», «A y B». */
export function parsearAutores(valor: unknown): Autor[] {
  if (esVacio(valor)) return [];
  let lista: unknown[] = [];
  if (Array.isArray(valor)) lista = valor;
  else {
    const s = String(valor).trim();
    try {
      const j = JSON.parse(s);
      lista = Array.isArray(j) ? j : [j];
    } catch {
      lista = s.split(/\s*;\s*|\s+(?:and|y|et|und|&)\s+/i);
    }
  }
  const salida: Autor[] = [];
  for (const x of lista) {
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const nombre = limpiarEspacios(String(o.nombre ?? o.given ?? o.first ?? ''));
      const apellidos = limpiarEspacios(String(o.apellidos ?? o.family ?? o.last ?? ''));
      if (nombre || apellidos) salida.push({ nombre, apellidos });
      else if (typeof o.name === 'string') { const a = parsearAutor(o.name); if (a) salida.push(a); }
      continue;
    }
    const a = parsearAutor(String(x ?? ''));
    if (a) salida.push(a);
  }
  return salida;
}

/** Títulos que salieron de un nombre de fichero: «The_Discarded_Image_…_z_library_sk,_1lib_sk,». */
export function limpiarTitulo(titulo: string): string {
  let t = titulo;
  if (!/\s/.test(t.trim()) && t.includes('_')) t = t.replace(/_+/g, ' ');
  t = t.replace(/\s*\(?\b(?:z[\s-]?lib(?:rary)?(?:\.\w+)?|1lib(?:\.\w+)?|libgen(?:\.\w+)?|b-ok\.\w+)\b.*$/i, '');
  t = t.replace(/\s+\bt\s*$/i, ''); // resto «t» de «t z library»
  t = t.replace(/\.(?:pdf|epub|djvu|docx?)$/i, '');
  t = limpiarEspacios(t).replace(/[\s,;:–—-]+$/, '');
  return t;
}

// ---------------------------------------------------------------------------
// Idioma por palabras vacías
// ---------------------------------------------------------------------------

const VACIAS: Record<string, string[]> = {
  es: ['de', 'la', 'que', 'el', 'en', 'y', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'este', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos', 'durante', 'mi', 'qué', 'él', 'ha', 'era', 'es'],
  en: ['the', 'of', 'and', 'to', 'in', 'a', 'is', 'that', 'for', 'it', 'as', 'was', 'with', 'be', 'by', 'on', 'not', 'he', 'this', 'are', 'or', 'his', 'from', 'at', 'which', 'but', 'have', 'an', 'they', 'you', 'were', 'their', 'one', 'all', 'we', 'can', 'her', 'has', 'there', 'been', 'if', 'more', 'when', 'will', 'would', 'who', 'so', 'no', 'what', 'its'],
  fr: ['de', 'la', 'le', 'et', 'les', 'des', 'en', 'un', 'du', 'une', 'que', 'est', 'pour', 'qui', 'dans', 'par', 'plus', 'pas', 'au', 'sur', 'ne', 'se', 'ce', 'il', 'sont', 'avec', 'ou', 'mais', 'nous', 'comme', 'elle', 'aux', 'son', 'leur', 'été', 'cette', 'ses', 'ont', 'je', 'tout'],
  it: ['di', 'e', 'il', 'la', 'che', 'in', 'a', 'per', 'un', 'è', 'del', 'non', 'una', 'le', 'si', 'da', 'con', 'i', 'sono', 'della', 'al', 'gli', 'come', 'più', 'ma', 'anche', 'nel', 'questo', 'alla', 'dei', 'delle', 'era', 'lo', 'suo', 'ci'],
  pt: ['de', 'a', 'o', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'é', 'com', 'não', 'uma', 'os', 'no', 'se', 'na', 'por', 'mais', 'as', 'dos', 'como', 'mas', 'ao', 'ele', 'das', 'à', 'seu', 'sua', 'ou', 'quando', 'muito', 'nos', 'já', 'eu', 'também', 'só', 'pelo', 'pela'],
  de: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im', 'dem', 'nicht', 'ein', 'eine', 'als', 'auch', 'es', 'an', 'werden', 'aus', 'er', 'hat', 'dass', 'sie', 'nach', 'wird', 'bei', 'einer', 'um', 'am', 'sind', 'noch', 'wie', 'einem', 'über'],
  la: ['et', 'in', 'est', 'non', 'ad', 'cum', 'ut', 'quod', 'sed', 'qui', 'quae', 'enim', 'per', 'ex', 'de', 'esse', 'sunt', 'nec', 'atque', 'autem', 'quam', 'vel', 'hoc', 'etiam', 'aut', 'quoque', 'neque', 'ab', 'eius', 'sicut', 'inter', 'post', 'tamen', 'ita', 'nam'],
  ca: ['de', 'la', 'i', 'el', 'que', 'a', 'les', 'en', 'del', 'per', 'un', 'una', 'amb', 'no', 'els', 'és', 'es', 'al', 'com', 'més', 'però', 'seu', 'seva', 'hi', 'ha', 'aquest', 'aquesta', 'molt', 'quan', 'també'],
};

/** Detecta el idioma de un texto por proporción de palabras vacías. */
export function detectarIdioma(texto: string): { idioma: string; confianza: number; puntos: Record<string, number> } | null {
  const palabras = texto.toLowerCase().normalize('NFC').match(/\p{L}+/gu) ?? [];
  if (palabras.length < 30) return null;
  const muestra = palabras.slice(0, 20000);
  const puntos: Record<string, number> = {};
  for (const [lengua, lista] of Object.entries(VACIAS)) {
    const conjunto = new Set(lista);
    let n = 0;
    for (const p of muestra) if (conjunto.has(p)) n++;
    puntos[lengua] = n / muestra.length;
  }
  const orden = Object.entries(puntos).sort((a, b) => b[1] - a[1]);
  const [primero, segundo] = orden as [[string, number], [string, number]];
  if (primero[1] < 0.08) return null;
  const confianza = Math.max(0, Math.min(1, (primero[1] - segundo[1]) / primero[1] * 2));
  return { idioma: primero[0], confianza: Math.round(confianza * 100) / 100, puntos };
}

/** Normaliza un código de idioma («EN», «en_US», «Spanish») a BCP-47 corto, o null. */
export function normalizarIdioma(v: unknown): string | null {
  if (esVacio(v)) return null;
  const s = String(v).trim().toLowerCase().replace('_', '-');
  const nombres: Record<string, string> = {
    spanish: 'es', español: 'es', castellano: 'es', english: 'en', inglés: 'en', french: 'fr', francés: 'fr',
    italian: 'it', italiano: 'it', portuguese: 'pt', portugués: 'pt', german: 'de', alemán: 'de', latin: 'la', latín: 'la', catalan: 'ca', catalán: 'ca',
  };
  if (nombres[s]) return nombres[s] as string;
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(s) ? s : null;
}
