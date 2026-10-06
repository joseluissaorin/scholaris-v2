/** Fusión de las vías por rangos recíprocos, ponderada por intención, y limpieza de la lista. */
import { fusionarRangos } from '@scholaris/nucleo';
import type { Fragmento } from '@scholaris/nucleo';
import type { Intencion, Via } from './tipos.js';

export const PESOS_POR_INTENCION: Record<Intencion, Record<Via, number>> = {
  conceptual: { lexica: 0.8, densa: 1.0, visual: 0.3 },
  visual: { lexica: 0.4, densa: 0.6, visual: 1.0 },
  cita: { lexica: 1.0, densa: 0.45, visual: 0.1 },
  temporal: { lexica: 0.8, densa: 1.0, visual: 0.2 },
};

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

export function fusionar(listas: ListaVia[], intencion: Intencion, k = 60): Candidato[] {
  const pesos = PESOS_POR_INTENCION[intencion];
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
export function limpiar(candidatos: Candidato[], fragmentos: Map<string, Fragmento>, fundirContiguos = true): Candidato[] {
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
    if (n > 1) c.puntos *= 0.85 ** (n - 1);
  }
  return guardados.sort((a, b) => b.puntos - a.puntos);
}

/** Normaliza a 0-1 por mín-máx. */
export function normalizar(xs: number[]): number[] {
  if (!xs.length) return [];
  const min = Math.min(...xs), max = Math.max(...xs);
  const r = max - min;
  return xs.map((x) => (r > 0 ? (x - min) / r : 1));
}
