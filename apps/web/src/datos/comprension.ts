/**
 * La comprensión de los documentos en la web: el mapa (estructura, ficha global,
 * estado), los segmentos, las fichas y las apariciones, las relaciones con otras
 * obras y sus alineaciones, y pedir que se comprenda. El avance llega en vivo por
 * el canal de tiempo real (evento «comprension») y, si no llega, se consulta cada
 * pocos segundos mientras está en marcha.
 *
 * Las relaciones y las alineaciones (ola 2, transmedia) todavía no tienen método
 * en el cliente tipado: se piden con `api().pedir` y el tipo de lib/comprension.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { queryOptions, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Alineacion, Ficha, TipoCorrespondencia } from '@scholaris/nucleo';
import type { AparicionVista, MapaComprension, Pagina, PedirComprension } from '@scholaris/contrato';
import { api, escucharTiempoReal } from './api';
import type { AvanceVivo, RelacionVista } from '../lib/comprension';

/** Las páginas de una lista hasta el final (o hasta `max`). */
async function todas<T>(pedir: (desde: number) => Promise<Pagina<T> | T[]>, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0, vueltas = 0; vueltas < 50; vueltas++) {
    const p = await pedir(desde);
    // La API de transmedia puede dar la lista tal cual o paginada.
    if (Array.isArray(p)) { out.push(...p); break; }
    out.push(...p.elementos);
    if (!p.siguiente || !p.elementos.length || out.length >= max) break;
    desde = Number(p.siguiente) || out.length;
  }
  return out;
}

export const qc = {
  mapa: (id: string) => queryOptions({
    queryKey: ['comprension', 'mapa', id],
    queryFn: () => api().comprension.mapa(id),
    staleTime: 60_000,
    retry: (n, e) => (e as { estado?: number })?.estado !== 404 && n < 1,
    // Mientras trabaja, se mira cada pocos segundos (el tiempo real adelanta, pero no siempre llega).
    refetchInterval: (q) => (q.state.data?.estado?.estado === 'en_marcha' ? 6000 : false),
  }),
  /** Todos los segmentos, planos incluidos (la película los necesita). */
  segmentos: (id: string) => queryOptions({ queryKey: ['comprension', 'segmentos', id], queryFn: () => api().comprension.segmentos(id), staleTime: 5 * 60_000 }),
  /** Las fichas de una clase («escena», «plano», «capitulo», «personaje»…), todas. */
  fichas: (id: string, clase?: string) => queryOptions({
    queryKey: ['comprension', 'fichas', id, clase ?? ''],
    queryFn: () => todas((desde) => api().comprension.fichas(id, { ...(clase ? { clase } : {}), desde, limite: 1000 })),
    staleTime: 5 * 60_000,
  }),
  /** La ficha de un segmento (o de una entidad, con `entidad`). */
  fichasDe: (id: string, p: { segmento?: string; entidad?: string }) => queryOptions({
    queryKey: ['comprension', 'fichas-de', id, p.segmento ?? '', p.entidad ?? ''],
    queryFn: async () => (await api().comprension.fichas(id, { ...p, limite: 20 })).elementos,
    enabled: !!(p.segmento || p.entidad),
    staleTime: 5 * 60_000,
  }),
  /** Todas las apariciones de un documento (o las de una entidad). */
  apariciones: (id: string, entidad?: string) => queryOptions({
    queryKey: ['comprension', 'apariciones', id, entidad ?? ''],
    queryFn: () => todas((desde) => api().comprension.apariciones(id, { ...(entidad ? { entidad } : {}), desde, limite: 5000 })),
    staleTime: 5 * 60_000,
  }),
  estados: () => queryOptions({ queryKey: ['comprension', 'estados'], queryFn: () => api().comprension.estados(), staleTime: 30_000 }),
  relaciones: (id: string) => queryOptions({
    queryKey: ['comprension', 'relaciones', id],
    queryFn: async () => { try { return await api().pedir<RelacionVista[]>('GET', `/documentos/${encodeURIComponent(id)}/relaciones`); } catch (e) { if ((e as { estado?: number }).estado === 404) return []; throw e; } },
    staleTime: 5 * 60_000,
    retry: 0,
  }),
  relacion: (id: string) => queryOptions({
    queryKey: ['comprension', 'relacion', id],
    queryFn: () => api().pedir<RelacionVista>('GET', `/relaciones/${encodeURIComponent(id)}`),
    staleTime: 5 * 60_000,
    retry: (n, e) => (e as { estado?: number })?.estado !== 404 && n < 1,
  }),
  alineaciones: (relacion: string, tipo?: TipoCorrespondencia) => queryOptions({
    queryKey: ['comprension', 'alineaciones', relacion, tipo ?? ''],
    queryFn: () => todas<Alineacion>((desde) => api().pedir<Pagina<Alineacion> | Alineacion[]>('GET', `/relaciones/${encodeURIComponent(relacion)}/alineaciones`, undefined, { desde, limite: 500, ...(tipo ? { tipo } : {}) })),
    staleTime: 5 * 60_000,
  }),
};

/** La ficha global de la lente principal (la primera del mapa). */
export function fichaGlobal(m: MapaComprension | undefined): Ficha | undefined {
  if (!m) return undefined;
  return m.global.find((f) => f.lente === m.lentes[0]) ?? m.global[0];
}

// ---------------------------------------------------------------------------
// El avance en vivo (evento «comprension» del tiempo real)
// ---------------------------------------------------------------------------

const vivos = new Map<string, AvanceVivo>();
const oyentes = new Set<() => void>();
let quitar: (() => void) | null = null;
let clienteConsultas: QueryClient | null = null;

function escuchar(qcl: QueryClient) {
  clienteConsultas = qcl;
  if (quitar) return;
  quitar = escucharTiempoReal((e) => {
    if (e.tipo !== 'comprension') return;
    const terminado = e.estado === 'hecho' || e.estado === 'error' || e.avance >= 1;
    vivos.set(e.documento, { paso: e.paso, avance: e.avance, mensaje: e.mensaje, ...(e.estado ? { estado: e.estado } : {}) });
    for (const o of oyentes) o();
    // Cada paso cambia el mapa (segmentos, fichas, apariciones): se vuelve a pedir lo que se esté viendo.
    void clienteConsultas?.invalidateQueries({ queryKey: ['comprension', 'mapa', e.documento] });
    if (terminado || /estructura|global|entidades|fin/.test(e.paso)) {
      for (const k of ['segmentos', 'fichas', 'fichas-de', 'apariciones', 'relaciones']) void clienteConsultas?.invalidateQueries({ queryKey: ['comprension', k, e.documento] });
      void clienteConsultas?.invalidateQueries({ queryKey: ['comprension', 'estados'] });
    }
  });
}

/** El último aviso en vivo de la comprensión de un documento (o nada). */
export function useAvanceVivo(documento: string): AvanceVivo | undefined {
  const qcl = useQueryClient();
  useEffect(() => { escuchar(qcl); }, [qcl]);
  return useSyncExternalStore((o) => { oyentes.add(o); return () => { oyentes.delete(o); }; }, () => vivos.get(documento), () => undefined);
}

/** Pide la comprensión (o que se rehaga). Devuelve el estado con que arranca y deja el mapa en «en marcha». */
export function useComprender(documento: string) {
  const qcl = useQueryClient();
  const [pidiendo, setPidiendo] = useState(false);
  const pedir = async (p: PedirComprension = {}) => {
    setPidiendo(true);
    try {
      escuchar(qcl);
      vivos.delete(documento);
      const r = await api().comprension.comprender(documento, p);
      qcl.setQueryData(qc.mapa(documento).queryKey, (m) => (m && m.estado ? { ...m, estado: { ...m.estado, estado: r.estado } } : m));
      await qcl.invalidateQueries({ queryKey: ['comprension', 'mapa', documento] });
      return r;
    } finally {
      setPidiendo(false);
    }
  };
  return { pedir, pidiendo };
}

/** Las apariciones de una entidad en las otras obras de la biblioteca (por su ficha del grafo). */
export function aparicionesFuera(documentos: string[], entidad: string) {
  return queryOptions({
    queryKey: ['comprension', 'fuera', entidad, documentos.join(',')],
    queryFn: async () => {
      const r = await Promise.all(documentos.map(async (d) => [d, await api().comprension.apariciones(d, { entidad, limite: 60 }).then((p) => p.elementos).catch(() => [] as AparicionVista[])] as const));
      return new Map(r);
    },
    enabled: documentos.length > 0 && !!entidad,
    staleTime: 5 * 60_000,
  });
}
