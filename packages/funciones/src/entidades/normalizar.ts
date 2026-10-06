/**
 * Piezas puras de las entidades: tipos, claves normalizadas y búsqueda de las
 * formas de una entidad dentro del texto de un fragmento.
 */

import type { TipoEntidad } from '@scholaris/contrato';
import { normalizarClave } from '../util.js';

export const TIPOS_ENTIDAD: readonly TipoEntidad[] = ['persona', 'obra', 'lugar', 'organizacion', 'concepto', 'evento', 'fecha'];

/** Códigos de una letra que usa el redactor (la salida cuesta más que la entrada). */
export const CODIGOS_TIPO: Record<string, TipoEntidad> = {
  p: 'persona', o: 'obra', l: 'lugar', g: 'organizacion', c: 'concepto', e: 'evento', f: 'fecha',
};

export function esTipoEntidad(t: unknown): t is TipoEntidad {
  return typeof t === 'string' && (TIPOS_ENTIDAD as readonly string[]).includes(t);
}

/** Tratamientos que no forman parte del nombre («Sr.», «don», «Dr.»). */
const TRATAMIENTOS = new Set(['sr', 'sra', 'srta', 'don', 'dona', 'dr', 'dra', 'mr', 'mrs', 'ms', 'sir', 'fray', 'san', 'santa', 'st']);

/** Clave de una entidad: minúsculas, sin diacríticos ni puntuación; las fechas, tal cual. */
export function claveEntidad(nombre: string, tipo: TipoEntidad): string {
  if (tipo === 'fecha') return nombre.trim().replace(/\s+/g, ' ').toLowerCase();
  let palabras = normalizarClave(nombre).split(' ').filter(Boolean);
  if (tipo === 'persona' && palabras.length > 1 && TRATAMIENTOS.has(palabras[0]!)) palabras = palabras.slice(1);
  if ((tipo === 'obra' || tipo === 'organizacion') && palabras.length > 1 && /^(el|la|los|las|the|le|les|il|lo)$/.test(palabras[0]!)) {
    // «El perseguidor» y «perseguidor» son la misma obra; se guarda sin artículo.
    palabras = palabras.slice(1);
  }
  return palabras.join(' ');
}

/** Partículas de los apellidos compuestos («de», «van»), que no cuentan como apellido. */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'van', 'von', 'der', 'den', 'da', 'di', 'do', 'dos', 'du', 'le', 'bin', 'ibn', 'el']);

export function palabrasSignificativas(clave: string): string[] {
  return clave.split(' ').filter((p) => p && !PARTICULAS.has(p));
}

/** Año de una fecha normalizada («1959», «1959-03-01», «s. XIX» no). */
export function anioDeFecha(f: string): number | undefined {
  const m = /^(-?\d{3,4})(?:-\d{1,2}(?:-\d{1,2})?)?$/.exec(f.trim());
  return m ? Number(m[1]) : undefined;
}

export interface Coincidencia {
  ini: number;
  fin: number;
  forma: string;
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rangos que no cuentan como mención: la etiqueta del hablante en las
 * transcripciones («**Joaquín Soler Serrano:**» al principio de un turno).
 */
export function rangosExcluidos(texto: string): Array<[number, number]> {
  const salida: Array<[number, number]> = [];
  const re = /(^|\n)\s*\*\*[^*\n]{1,80}:\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) salida.push([m.index, m.index + m[0].length]);
  return salida;
}

/**
 * Busca las formas en el texto, con límites de palabra Unicode. Los nombres
 * propios distinguen mayúsculas («Bird» no es «bird»); los conceptos, no.
 * Los espacios de la forma casan con cualquier blanco (saltos de línea).
 */
export function buscarFormas(texto: string, formas: readonly string[], distinguirMayusculas: boolean, excluidos: Array<[number, number]> = []): Coincidencia[] {
  const salida: Coincidencia[] = [];
  for (const forma of formas) {
    const f = forma.trim();
    if (f.length < 2) continue;
    const patron = escapar(f).replace(/\s+/g, '\\s+');
    let re: RegExp;
    try {
      re = new RegExp(`(?<![\\p{L}\\p{N}])${patron}(?![\\p{L}\\p{N}])`, distinguirMayusculas ? 'gu' : 'giu');
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const ini = m.index, fin = m.index + m[0].length;
      if (!excluidos.some(([a, b]) => ini < b && fin > a)) salida.push({ ini, fin, forma: f });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return salida;
}

/** Deja las coincidencias sin solapes: gana la más larga (y, a igualdad, la primera). */
export function sinSolapes<T extends { ini: number; fin: number }>(cs: T[]): T[] {
  const elegidas: T[] = [];
  for (const c of [...cs].sort((a, b) => (b.fin - b.ini) - (a.fin - a.ini) || a.ini - b.ini)) {
    if (!elegidas.some((e) => c.ini < e.fin && c.fin > e.ini)) elegidas.push(c);
  }
  return elegidas.sort((a, b) => a.ini - b.ini);
}

/**
 * Un trozo legible alrededor de una mención, con la mención entre «⟦» y «⟧».
 * Quita el marcado de negritas y cursivas y corta en límites de palabra.
 */
export function contextoMencion(texto: string, ini: number, fin: number, radio = 120): string {
  const a = Math.max(0, ini - radio), b = Math.min(texto.length, fin + radio);
  let antes = texto.slice(a, ini), despues = texto.slice(fin, b);
  if (a > 0) antes = antes.replace(/^\S*\s/, '');
  if (b < texto.length) despues = despues.replace(/\s\S*$/, '');
  const limpiar = (s: string) => s.replace(/\*\*|__|(?<!\w)[*_](?!\s)|(?<!\s)[*_](?!\w)/g, '').replace(/\s+/g, ' ');
  return `${a > 0 ? '…' : ''}${limpiar(antes).trimStart()}⟦${limpiar(texto.slice(ini, fin))}⟧${limpiar(despues).trimEnd()}${b < texto.length ? '…' : ''}`;
}

function prefijoComun(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Dos palabras que pueden ser la misma («plato»/«platon», «aristotle»/«aristoteles»). */
function palabrasCompatibles(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  return prefijoComun(a, b) >= 5;
}

/**
 * ¿Puede una forma escrita nombrar a esta persona? Ha de compartir una palabra
 * con el nombre («Cortázar» de «Julio Cortázar»), o ser sus iniciales en orden
 * («CH.P.» de «Charlie Parker»). Lo demás («Dédée» dicho de Johnny Carter,
 * «Johnny» dicho de Charlie Parker, apodos como «Bird») no se acepta: si hay
 * duda, la forma es de otra entidad. Para los demás tipos no se exige nada
 * (las obras se traducen: «Paradise Lost», «El paraíso perdido»).
 */
export function formaCompatible(forma: string, nombre: string, tipo: TipoEntidad): boolean {
  if (tipo !== 'persona') return true;
  const f = normalizarClave(forma), n = normalizarClave(nombre);
  if (!f || f === n) return true;
  const pn = palabrasSignificativas(n);
  const pf = palabrasSignificativas(f);
  if (pf.some((x) => x.length >= 3 && pn.some((y) => palabrasCompatibles(x, y)))) return true;
  // Iniciales: cada trozo es el comienzo de una palabra del nombre, en orden.
  const trozos = forma.split(/[\s.]+/).map((t) => normalizarClave(t)).filter(Boolean);
  if (trozos.length >= 2 && trozos.every((t) => t.length <= 3)) {
    let j = 0;
    for (const t of trozos) {
      while (j < pn.length && !pn[j]!.startsWith(t)) j++;
      if (j >= pn.length) return false;
      j++;
    }
    return true;
  }
  return false;
}
