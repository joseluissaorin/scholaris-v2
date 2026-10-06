/** Consultas del inspector (las unidades vuelven a la numeración de la web, desde 1). */
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { api } from '../../datos/api';

/** Unidades por bloque en el inspector. */
export const BLOQUE_INSPECCION = 25;

export const qi = {
  contenido: (id: string) => queryOptions({ queryKey: ['inspector', id, 'contenido'], queryFn: () => api().documentos.contenido(id), staleTime: 60_000 }),
  unidades: (id: string, bloque: number) => queryOptions({
    queryKey: ['inspector', id, 'unidades', bloque],
    queryFn: async () => (await api().documentos.unidadesInspeccion(id, bloque * BLOQUE_INSPECCION, (bloque + 1) * BLOQUE_INSPECCION - 1)).map((u) => ({ ...u, orden: u.orden + 1 })),
    staleTime: 5 * 60_000,
  }),
  fragmentos: (id: string) => infiniteQueryOptions({
    queryKey: ['inspector', id, 'fragmentos'],
    queryFn: async ({ pageParam }) => {
      const p = await api().documentos.fragmentosInspeccion(id, { limite: 120, ...(pageParam ? { cursor: pageParam } : {}) });
      return { ...p, elementos: p.elementos.map((f) => ({ ...f, unidad: f.unidad + 1 })) };
    },
    initialPageParam: '' as string,
    getNextPageParam: (p) => p.siguiente,
    staleTime: 5 * 60_000,
  }),
  mapa: (id: string, espacio?: string) => queryOptions({ queryKey: ['inspector', id, 'mapa', espacio ?? ''], queryFn: () => api().documentos.mapaVectores(id, espacio ? { espacio } : {}), staleTime: 10 * 60_000 }),
  entidades: (id: string) => queryOptions({ queryKey: ['inspector', id, 'entidades'], queryFn: () => api().entidades.documento(id), staleTime: 5 * 60_000, retry: 0 }),
};
