/** Métricas de recuperación con relevancia graduada (0-3). */
import type { Juicio } from './juego.js';

/** Umbral de «relevante» para las métricas binarias (Recall, MRR). */
export const RELEVANTE = 2;

export function dcg(notas: number[], k: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(k, notas.length); i++) s += (2 ** (notas[i] ?? 0) - 1) / Math.log2(i + 2);
  return s;
}

export interface MetricasConsulta {
  ndcg10: number;
  recall20: number;
  mrr: number;
  /** Proporción de los 10 primeros que tienen juicio (cobertura del pool). */
  juzgados10: number;
  /** Algún resultado repetido (mismo fragmento o mismo documento+ancla+texto). */
  repetidos: number;
}

export function medir(ids: string[], juicios: Record<string, Juicio>): MetricasConsulta {
  const nota = (id: string) => juicios[id]?.nota ?? 0;
  const notas = ids.map(nota);
  const ideal = Object.values(juicios).map((j) => j.nota).sort((a, b) => b - a);
  const idcg = dcg(ideal, 10);
  const relevantes = Object.entries(juicios).filter(([, j]) => j.nota >= RELEVANTE).map(([id]) => id);
  const top20 = new Set(ids.slice(0, 20));
  const recall20 = relevantes.length ? relevantes.filter((id) => top20.has(id)).length / relevantes.length : 0;
  const primera = notas.slice(0, 10).findIndex((n) => n >= RELEVANTE);
  const top10 = ids.slice(0, 10);
  return {
    ndcg10: idcg > 0 ? dcg(notas, 10) / idcg : 0,
    recall20,
    mrr: primera >= 0 ? 1 / (primera + 1) : 0,
    juzgados10: top10.length ? top10.filter((id) => juicios[id]).length / top10.length : 1,
    repetidos: ids.length - new Set(ids).size,
  };
}

export function media(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function percentil(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1))] as number;
}
