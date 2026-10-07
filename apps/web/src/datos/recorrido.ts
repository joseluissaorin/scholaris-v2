/**
 * Del resultado al lector y de vuelta, sin repetir nada.
 *
 * - Un resultado abre el lector en su pasaje (`?f=&pd=&ph=`): la página o el
 *   segundo de sus oraciones, subrayadas. El enlace sirve tal cual para compartir.
 * - Si se llega desde Buscar, la URL lleva también la búsqueda (`rb`) y el
 *   número del resultado (`ri`): el lector recorre los resultados (anterior,
 *   siguiente) leyéndolos de la caché, y «Volver a los resultados» es volver
 *   atrás en el historial: misma consulta, mismos filtros, mismo desplazamiento,
 *   ninguna búsqueda nueva, y el resultado del que se vino, destacado.
 */
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';
import type { Filtros, TipoEntrada } from '@scholaris/nucleo';
import type { FragmentoVista, ResultadoVista } from '@scholaris/contrato';
import { anclaABusqueda, type BusquedaLector, type ContextoBusqueda } from '../lib/anclas';
import { precargarLector, q } from './consultas';

export const GRUPOS: Array<{ id: string; nombre: string; tipos: TipoEntrada[] }> = [
  { id: 'libros', nombre: 'Libros y artículos', tipos: ['pdf', 'epub', 'pdf_escaneado', 'fotos'] },
  { id: 'medios', nombre: 'Audio y vídeo', tipos: ['audio', 'video'] },
  { id: 'textos', nombre: 'Textos y web', tipos: ['documento', 'web'] },
  { id: 'otros', nombre: 'Diapositivas, hojas e imágenes', tipos: ['presentacion', 'hoja', 'imagen'] },
];

export function filtrosDe(b: Partial<ContextoBusqueda>): Filtros {
  const g = GRUPOS.find((x) => x.id === b.grupo);
  return { ...(g ? { tipos: g.tipos } : {}), ...(b.col ? { bibliotecas: [b.col] } : {}), ...(b.doc ? { documentos: [b.doc] } : {}), ...(b.desde ? { anioDesde: b.desde } : {}), ...(b.hasta ? { anioHasta: b.hasta } : {}) };
}

type ListaResultados = { resultados: ResultadoVista[]; preliminar?: boolean };

/** Las opciones de la consulta que pinta Buscar para ese contexto (la misma clave de caché). */
export function opcionesDeContexto(c: ContextoBusqueda): UseQueryOptions<ListaResultados> {
  const f = filtrosDe(c);
  const o = c.alcance && !c.cruzada ? q.busquedaConjunta(c.q, f, c.alcance) : c.cruzada ? q.busquedaCruzada(c.q, f) : q.busqueda(c.q, f);
  return o as unknown as UseQueryOptions<ListaResultados>;
}

/** Los resultados de un contexto, solo si ya están en la caché (el lector no busca de nuevo). */
export function resultadosEnCache(qc: QueryClient, c: ContextoBusqueda | undefined): ResultadoVista[] | undefined {
  if (!c) return undefined;
  return qc.getQueryData<ListaResultados>(opcionesDeContexto(c).queryKey)?.resultados;
}

/** El contexto que guarda la URL: sin claves vacías. */
export function contextoLimpio(c: ContextoBusqueda): ContextoBusqueda {
  const x: ContextoBusqueda = { q: c.q };
  for (const k of ['grupo', 'col', 'doc', 'desde', 'hasta', 'cruzada', 'alcance'] as const) if (c[k] !== undefined && c[k] !== '') (x as unknown as Record<string, unknown>)[k] = c[k];
  return x;
}

/** Parámetros del lector para un resultado: su pasaje (página o segundo, y desplazamientos) y, si viene de Buscar, el recorrido. */
export function busquedaDeResultado(r: ResultadoVista, o: { consulta?: string; contexto?: ContextoBusqueda; indice?: number } = {}): BusquedaLector {
  const p = r.pasaje;
  const ancla = p?.ancla ?? r.fragmento.ancla;
  return anclaABusqueda(ancla, {
    ...(o.consulta ? { q: o.consulta } : {}),
    f: r.fragmento.id,
    ...(p?.texto && p.hasta > p.desde ? { pd: p.desde, ph: p.hasta } : {}),
    ...(o.contexto ? { rb: contextoLimpio(o.contexto), ri: o.indice ?? 0 } : {}),
  });
}

/** El texto crudo del fragmento, en la caché: el lector lo tiene sin pedirlo. */
export function sembrarFragmento(qc: QueryClient, r: ResultadoVista) {
  const clave = q.fragmento(r.documento.id, r.fragmento.id).queryKey;
  if (qc.getQueryData(clave)) return;
  const f = r.fragmento;
  const v: FragmentoVista = { id: f.id, unidad: 0, orden: f.orden, texto: f.texto, textoCrudo: f.texto, contexto: f.contexto, seccion: f.seccion, ancla: f.ancla, etiqueta: r.etiqueta, ...(f.anclaFin ? { anclaFin: f.anclaFin } : {}) };
  qc.setQueryData(clave, v);
}

/** Precarga lo que el lector necesitará para pintar ese resultado: su documento, sus páginas y su texto. */
export function precargarResultado(qc: QueryClient, r: ResultadoVista) {
  sembrarFragmento(qc, r);
  const b = busquedaDeResultado(r);
  return precargarLector(qc, r.documento.id, b.u ?? 1, b.t != null).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// El resultado del que se vino (para destacarlo al volver)
// ---------------------------------------------------------------------------

const CLAVE_VENIDA = 'scholaris:resultado-abierto';

export function anotarVenida(c: ContextoBusqueda, fragmento: string) {
  try { sessionStorage.setItem(CLAVE_VENIDA, JSON.stringify({ c: JSON.stringify(contextoLimpio(c)), fragmento })); } catch { /* sin almacenamiento */ }
}

export function leerVenida(c: ContextoBusqueda): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLAVE_VENIDA) ?? 'null') as { c: string; fragmento: string } | null;
    return v && v.c === JSON.stringify(contextoLimpio(c)) ? v.fragmento : null;
  } catch { return null; }
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Esta entrada del lector se abrió desde la lista de resultados: «Volver» es volver atrás. */
    desdeResultados?: boolean;
  }
}
