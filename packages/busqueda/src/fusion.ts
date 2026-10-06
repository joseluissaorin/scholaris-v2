/** Fusión de las vías por rangos recíprocos, ponderada por intención, y limpieza de la lista. */
import { fusionarRangos } from '@scholaris/nucleo';
import type { Fragmento } from '@scholaris/nucleo';
import type { Intencion, Via } from './tipos.js';

/**
 * Pesos medidos con el banco de calidad (bench/calidad, 183 consultas): la vía
 * densa es la que más aporta; la léxica, con peso bajo, salva las citas
 * literales y la grafía antigua; los vectores de página solo ayudan cuando se
 * busca una imagen (con peso 0,3 o 0,6 en consultas de texto bajaban el nDCG@10).
 */
export const PESOS_POR_INTENCION: Record<Intencion, Record<Via, number>> = {
  conceptual: { lexica: 0.35, densa: 1.0, visual: 0 },
  visual: { lexica: 0.35, densa: 0.6, visual: 1.0 },
  cita: { lexica: 1.0, densa: 0.45, visual: 0 },
  temporal: { lexica: 0.35, densa: 1.0, visual: 0 },
};

/** k de la fusión por rangos recíprocos: 10 (60, el clásico, aplana demasiado con listas cortas y buenas). */
export const K_RRF = 10;

export interface ListaVia {
  via: Via;
  ids: string[];
  /** Peso propio de la lista (el de la expansión que la produjo). */
  peso: number;
}

export interface Candidato {
  id: string;
  puntos: number;
  vias: Set<Via>;
}

export function fusionar(listas: ListaVia[], intencion: Intencion, k = K_RRF, pesosPropios?: Record<Via, number>): Candidato[] {
  const pesos = pesosPropios ?? PESOS_POR_INTENCION[intencion];
  const puntos = fusionarRangos(listas.map((l) => ({ ids: l.ids, peso: l.peso * pesos[l.via] })), k);
  const vias = new Map<string, Set<Via>>();
  for (const l of listas) for (const id of l.ids) {
    let s = vias.get(id);
    if (!s) vias.set(id, (s = new Set()));
    s.add(l.via);
  }
  return [...puntos.entries()]
    .map(([id, p]) => ({ id, puntos: p, vias: vias.get(id) ?? new Set<Via>() }))
    .sort((a, b) => b.puntos - a.puntos);
}

/**
 * Funde fragmentos contiguos del mismo documento (el mejor se queda y hereda las
 * vías del vecino) y penaliza varios aciertos en la misma unidad (0,85ⁿ, como
 * hacía la versión anterior), para que la lista no sea diez trozos de una página.
 */
export function limpiar(candidatos: Candidato[], fragmentos: Map<string, Fragmento>, fundirContiguos = false, penalizacionUnidad = 1): Candidato[] {
  const guardados: Candidato[] = [];
  const porDoc = new Map<string, Array<{ orden: number; c: Candidato }>>();
  for (const c of candidatos) {
    const f = fragmentos.get(c.id);
    if (!f) { guardados.push(c); continue; }
    const vecinos = porDoc.get(f.documento) ?? [];
    const vecino = fundirContiguos && f.orden >= 0 ? vecinos.find((v) => Math.abs(v.orden - f.orden) === 1) : undefined;
    if (vecino) {
      for (const v of c.vias) vecino.c.vias.add(v);
      continue;
    }
    vecinos.push({ orden: f.orden, c });
    porDoc.set(f.documento, vecinos);
    guardados.push(c);
  }
  const porUnidad = new Map<string, number>();
  for (const c of guardados) {
    const f = fragmentos.get(c.id);
    if (!f) continue;
    const n = (porUnidad.get(f.unidad) ?? 0) + 1;
    porUnidad.set(f.unidad, n);
    if (n > 1 && penalizacionUnidad < 1) c.puntos *= penalizacionUnidad ** (n - 1);
  }
  return guardados.sort((a, b) => b.puntos - a.puntos);
}

/** Clave de texto para reconocer el mismo pasaje en dos fragmentos (copias de un documento, reintentos de ingesta). */
function claveTexto(texto: string): string {
  return texto.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 200);
}

/**
 * Quita repetidos conservando el primero (el mejor puntuado) y pasándole las
 * vías del repetido: mismo fragmento, mismo documento + ancla + texto, o el
 * mismo texto en otro documento (el mismo libro subido dos veces).
 */
export function sinDuplicados(candidatos: Candidato[], fragmentos: Map<string, Fragmento>): Candidato[] {
  const vistos = new Map<string, Candidato>();
  const salida: Candidato[] = [];
  for (const c of candidatos) {
    const f = fragmentos.get(c.id);
    const claves = [`i:${c.id}`];
    if (f) {
      const t = claveTexto(f.texto);
      claves.push(`a:${f.documento}|${JSON.stringify(f.ancla)}|${t.slice(0, 120)}`);
      if (t.length >= 40) claves.push(`t:${t}`);
    }
    const previo = claves.map((k) => vistos.get(k)).find(Boolean);
    if (previo) { for (const v of c.vias) previo.vias.add(v); continue; }
    for (const k of claves) vistos.set(k, c);
    salida.push(c);
  }
  return salida;
}

/** Normaliza a 0-1 por mín-máx. */
export function normalizar(xs: number[]): number[] {
  if (!xs.length) return [];
  const min = Math.min(...xs), max = Math.max(...xs);
  const r = max - min;
  return xs.map((x) => (r > 0 ? (x - min) / r : 1));
}
