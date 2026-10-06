/**
 * @scholaris/normalizacion: la capa de ortografía modernizada.
 *
 * El texto fiel (el que se cita) no se toca nunca. Junto a él, cada fragmento
 * lleva un texto SOMBRA, solo para buscar, en el que «aſsi», «Què», «coraçon»,
 * «q̃», «muger», «dixo», «aora» o «fee» se han reducido a una clave que también
 * produce la consulta moderna («así», «corazón», «que», «mujer», «dijo»,
 * «ahora», «fe»). FTS5 indexa las dos columnas.
 *
 * - `normalizarParaBusqueda(texto, idioma, epoca?)`: el texto normalizado.
 * - `textoBusqueda(texto, idioma, epoca?)`: lo que se guarda en
 *   `fragmentos.texto_busqueda`: '' cuando la normalización no aporta nada sobre
 *   el plegado de FTS5 (inglés, castellano moderno…), para no duplicar el índice.
 * - `variantesConsulta(palabra)`: las claves de una palabra de la consulta en
 *   todas las lenguas con reglas, para buscarlas en la columna normalizada.
 *
 * Basado en reglas, sin diccionarios grandes ni modelos: > 5 MB/s.
 */

import {
  codigoAntiguo,
  lenguaDe,
  Memoria,
  plegadoBasico,
  prepararCaracteres,
  RE_PALABRA,
  solo,
  UMBRAL_MODERNO,
  type Epoca,
  type Lengua,
  type PalabraNormalizada,
} from './comun.js';
import { palabraEs, senalesEs } from './espanol.js';
import { palabraLatin } from './latin.js';
import { palabraFr, palabraIt, senalesRomance } from './romances.js';

export { lenguaDe, plegadoBasico, prepararCaracteres, type Epoca, type Lengua, type PalabraNormalizada } from './comun.js';
export { arreglarSLarga, palabraEs, plegarEs, PALABRAS_ES, PREFIJOS_ES } from './espanol.js';
export { palabraLatin, plegarLatin, raizNominal, raizVerbal, separarEnclitico, PALABRAS_QUE } from './latin.js';
export { palabraFr, palabraIt } from './romances.js';

/** Versión de las reglas: si cambia, conviene recalcular `texto_busqueda`. */
export const VERSION_NORMALIZACION = '1';

const memorias: Partial<Record<Lengua, Memoria>> = {
  es: new Memoria(palabraEs),
  la: new Memoria(palabraLatin),
  fr: new Memoria(palabraFr),
  it: new Memoria(palabraIt),
};

// ---------------------------------------------------------------------------
// Época
// ---------------------------------------------------------------------------

/** Mínimo de señales y proporción por palabra para dar un texto por antiguo. */
const MINIMO_SENALES = 2;
const PROPORCION_ANTIGUA = 0.01;

/**
 * ¿Ortografía antigua o moderna? Por las señales del propio texto: ſ, q̃,
 * vocales con tilde de abreviatura, acentos graves en castellano, ç, -sse, y
 * palabras-testigo («assi», «quando», «dixo», «muger», «estoit», «huomo»…).
 */
export function detectarEpoca(texto: string, idioma?: string | null): 'antigua' | 'moderna' {
  const lengua = lenguaDe(idioma);
  if (lengua === 'la') return 'antigua';
  if (lengua !== 'es' && lengua !== 'fr' && lengua !== 'it') return 'moderna';
  if (codigoAntiguo(idioma)) return 'antigua';
  const { senales, palabras } = lengua === 'es' ? senalesEs(texto) : senalesRomance(texto, lengua);
  if (senales >= MINIMO_SENALES && senales >= palabras * PROPORCION_ANTIGUA) return 'antigua';
  // Textos muy cortos (un verso, un título): basta una señal clara cada 20 palabras.
  if (palabras < 40 && senales >= 1 && senales * 20 >= palabras) return 'antigua';
  return 'moderna';
}

/** Resuelve la época: año, decisión explícita o detección sobre el texto. */
export function resolverEpoca(texto: string, idioma?: string | null, epoca?: Epoca | null): 'antigua' | 'moderna' {
  const lengua = lenguaDe(idioma);
  if (lengua === 'la') return 'antigua';
  if (epoca === 'antigua' || epoca === 'moderna') return epoca;
  if (typeof epoca === 'number' && Number.isFinite(epoca) && epoca > 0) {
    if (codigoAntiguo(idioma)) return 'antigua';
    return epoca < UMBRAL_MODERNO[lengua] ? 'antigua' : 'moderna';
  }
  return detectarEpoca(texto, idioma);
}

/**
 * Época de un documento entero: antigua si el año (de la obra original o de la
 * edición) es anterior al umbral de la lengua, o si el texto lo delata (el texto
 * manda sobre un año moderno: un facsímil de 1990 sigue siendo de 1618).
 * `muestra` puede ser el texto o una lista de fragmentos (se miran ~200 000 caracteres).
 */
export function epocaDeDocumento(muestra: string | readonly string[], idioma?: string | null, anio?: number | null): 'antigua' | 'moderna' {
  const lengua = lenguaDe(idioma);
  if (lengua === 'la') return 'antigua';
  if (!memorias[lengua]) return 'moderna';
  if (codigoAntiguo(idioma)) return 'antigua';
  if (typeof anio === 'number' && Number.isFinite(anio) && anio > 0 && anio < UMBRAL_MODERNO[lengua]) return 'antigua';
  let texto = '';
  if (typeof muestra === 'string') texto = muestra.slice(0, 200_000);
  else for (const t of muestra) { texto += `${t}\n`; if (texto.length > 200_000) break; }
  return detectarEpoca(texto, idioma);
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

export interface TextoNormalizado {
  /** Las palabras normalizadas, en orden (las frases siguen casando aquí). */
  principal: string;
  /** Tokens añadidos (raíces latinas), sin repetir. */
  extras: string[];
  lengua: Lengua;
  epoca: 'antigua' | 'moderna';
}

/** Normalización con detalle: principal y extras por separado. */
export function normalizarDetallado(texto: string, idioma?: string | null, epoca?: Epoca | null): TextoNormalizado {
  const lengua = lenguaDe(idioma);
  const e = resolverEpoca(texto, idioma, epoca);
  const memoria = memorias[lengua];
  if (!memoria || e === 'moderna') {
    return { principal: plegadoBasico(texto), extras: [], lengua, epoca: e };
  }
  const preparado = prepararCaracteres(texto, lengua);
  const salida: string[] = [];
  let extras: Set<string> | null = null;
  for (const m of preparado.matchAll(RE_PALABRA)) {
    const r = memoria.get(m[0]);
    salida.push(r.p);
    if (r.x) {
      extras ??= new Set();
      for (const x of r.x) extras.add(x);
    }
  }
  return { principal: salida.join(' '), extras: extras ? [...extras] : [], lengua, epoca: e };
}

/**
 * El texto normalizado para buscar: palabras normalizadas en orden y, al final,
 * los tokens extra (raíces latinas). Sin época, se deduce del texto.
 */
export function normalizarParaBusqueda(texto: string, idioma?: string | null, epoca?: Epoca | null): string {
  const r = normalizarDetallado(texto, idioma, epoca);
  return r.extras.length ? `${r.principal} ${r.extras.join(' ')}` : r.principal;
}

/**
 * Lo que se guarda en `fragmentos.texto_busqueda`: el texto normalizado, o ''
 * si no aporta nada sobre el plegado que ya hace FTS5 (así los documentos
 * modernos no duplican su índice ni reciben ruido de las variantes antiguas).
 */
export function textoBusqueda(texto: string, idioma?: string | null, epoca?: Epoca | null): string {
  if (!texto) return '';
  const lengua = lenguaDe(idioma);
  if (!memorias[lengua]) return '';
  const r = normalizarDetallado(texto, idioma, epoca);
  if (r.epoca === 'moderna') return '';
  const n = r.extras.length ? `${r.principal} ${r.extras.join(' ')}` : r.principal;
  return n === plegadoBasico(texto) ? '' : n;
}

/** Normaliza una sola palabra (ya sin preparar) con las reglas antiguas de una lengua. */
export function normalizarPalabra(palabra: string, lengua: Lengua): PalabraNormalizada {
  const memoria = memorias[lengua];
  if (!memoria) return solo(plegadoBasico(palabra));
  const preparada = prepararCaracteres(palabra, lengua);
  const partes = preparada.match(RE_PALABRA) ?? [];
  if (partes.length === 1) return memoria.get(partes[0] as string);
  const rs = partes.map((p) => memoria.get(p));
  const x = rs.flatMap((r) => r.x ?? []);
  return { p: rs.map((r) => r.p).join(' '), x: x.length ? x : null };
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

const LENGUAS_CONSULTA: Lengua[] = ['es', 'la', 'fr', 'it'];
const ENCLITICOS = new Set(['que', 'ne', 'ue']);

/**
 * Variantes de búsqueda de una palabra (o frase) de la consulta: su clave en
 * castellano, latín, francés e italiano antiguos, más las raíces latinas. Cada
 * variante es una o varias palabras separadas por espacio (frase). No incluye la
 * propia palabra plegada. Pensado para buscarse SOLO en `texto_busqueda`.
 */
export function variantesConsulta(texto: string, opciones: { raices?: boolean; lenguas?: Lengua[] } = {}): string[] {
  const plegada = plegadoBasico(texto);
  if (!plegada) return [];
  const vistas = new Set<string>([plegada]);
  const salida: string[] = [];
  const poner = (v: string) => {
    const t = v.trim();
    if (t && !vistas.has(t)) { vistas.add(t); salida.push(t); }
  };
  const varias = plegada.includes(' ');
  for (const lengua of opciones.lenguas ?? LENGUAS_CONSULTA) {
    const r = normalizarDetallado(texto, lengua, 'antigua');
    // En latín, una sola palabra no busca su enclítico suelto («uirumque» → «uirum»).
    const principal = !varias && lengua === 'la' ? r.principal.split(' ').filter((t) => !ENCLITICOS.has(t)).join(' ') : r.principal;
    poner(principal);
    if (lengua === 'la' && !varias && opciones.raices !== false) for (const x of r.extras) if (x.length >= 3) poner(x);
  }
  return salida;
}
