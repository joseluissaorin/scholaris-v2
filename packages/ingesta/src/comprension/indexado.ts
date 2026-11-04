/**
 * Indexado de la comprensión (docs/COMPRENSION.md, paso 6): un vector por ficha,
 * en el mismo espacio que los fragmentos (el buscador fusiona las dos capas), y
 * su entrada en el índice con `objetivo: 'ficha'` (la capa) y `documento` como
 * metadatos filtrables. El FTS de las fichas (`fichas_fts`) se mantiene solo.
 */
import type { Documento, Ficha, Vector } from '@scholaris/nucleo';
import { leerDocumento, leerFichas, leerSegmentos } from '@scholaris/spdf';
import { entradasIndice, escribirEspacio, escribirVectores } from '../pasos/indexado.js';
import { vectorizar } from '../pasos/vectores.js';
import type { ContextoComprension } from './tipos.js';

/** El texto que se vectoriza: clase y título, los resúmenes en las dos lenguas y la prosa. */
export function textoVectorFicha(f: Ficha): string {
  const r = (f.datos.resumen ?? {}) as { es?: string; en?: string };
  const titulo = typeof f.datos.titulo === 'string' ? f.datos.titulo : typeof f.datos.nombre === 'string' ? f.datos.nombre : '';
  const cabeza = [`${f.clase}${titulo ? `: ${titulo}` : ''}`, r.es, r.en].filter(Boolean).join('\n');
  return `${cabeza}\n\n${f.texto}`.slice(0, 24_000);
}

export async function indexarFichas(ctx: ContextoComprension, documento: string): Promise<{ vectores: number; pendientes: boolean }> {
  const emb = ctx.embebedor;
  if (!emb || !emb.admite('texto')) return { vectores: 0, pendientes: false };
  const doc = (await leerDocumento(ctx.sql, documento)) as Documento | null;
  if (!doc) return { vectores: 0, pendientes: false };
  const fichas = (await leerFichas(ctx.sql, { documento })).filter((f) => f.texto.trim());
  if (!fichas.length) return { vectores: 0, pendientes: false };
  // El segundo de inicio de las fichas de un medio, para filtrar por tramo de tiempo.
  const t0 = new Map<string, number>();
  const segmentos = new Map((await leerSegmentos(ctx.sql, documento)).map((s) => [s.id, s]));
  for (const f of fichas) {
    const s = f.objetivo === 'segmento' ? segmentos.get(f.objetivoId) : undefined;
    if (s?.ancla.tipo === 'tiempo') t0.set(f.id, s.ancla.t0);
  }
  const vectores: Vector[] = [];
  await vectorizar(fichas.map((f) => ({ objetivo: 'ficha' as const, id: f.id, texto: textoVectorFicha(f) })), emb, { parte: async () => null }, async (vs) => { vectores.push(...vs); }, { concurrencia: 4 });
  await escribirEspacio(ctx.sql, emb.espacio);
  for (let i = 0; i < vectores.length; i += 200) await escribirVectores(ctx.sql, documento, vectores.slice(i, i + 200));
  let pendientes = false;
  if (ctx.indice && ctx.espacioNombres) {
    const base = vectores.filter((v) => v.espacio === ctx.indice!.espacio.id);
    for (let i = 0; i < base.length; i += 200) {
      try { await ctx.indice.insertar(ctx.espacioNombres, entradasIndice(doc, base.slice(i, i + 200), t0)); } catch { pendientes = true; }
    }
  }
  return { vectores: vectores.length, pendientes };
}
