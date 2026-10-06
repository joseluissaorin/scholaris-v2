/**
 * Claves y opciones de TanStack Query. Una sola fuente de verdad para que las
 * rutas puedan precargar (al pasar el ratón por un enlace) exactamente lo que
 * la pantalla va a pedir.
 */
import { QueryClient, queryOptions, keepPreviousData } from '@tanstack/react-query';
import type { Filtros } from '@scholaris/nucleo';
import type { FiltrosDocumentos } from '@scholaris/contrato';
import { api } from './api';

export const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

/** Unidades por bloque al leer: 12 páginas por petición. */
export const BLOQUE = 12;

export const q = {
  yo: () => queryOptions({ queryKey: ['yo'], queryFn: () => api().auth.yo(), staleTime: 5 * 60_000 }),
  documentos: (f: FiltrosDocumentos = {}) => queryOptions({ queryKey: ['documentos', f], queryFn: () => api().documentos.listar({ limite: 500, ...f }), placeholderData: keepPreviousData }),
  documento: (id: string) => queryOptions({ queryKey: ['documento', id], queryFn: () => api().documentos.obtener(id) }),
  bloque: (id: string, bloque: number) => queryOptions({
    queryKey: ['unidades', id, bloque],
    queryFn: () => api().documentos.unidades(id, bloque * BLOQUE + 1, (bloque + 1) * BLOQUE),
    staleTime: 5 * 60_000,
  }),
  folios: (id: string) => queryOptions({ queryKey: ['folios', id], queryFn: () => api().documentos.folios(id), staleTime: 5 * 60_000 }),
  secciones: (id: string) => queryOptions({ queryKey: ['secciones', id], queryFn: () => api().documentos.secciones(id), staleTime: 5 * 60_000 }),
  figuras: (id: string) => queryOptions({ queryKey: ['figuras', id], queryFn: () => api().documentos.figuras(id), staleTime: 5 * 60_000 }),
  original: (id: string) => queryOptions({ queryKey: ['original', id], queryFn: () => api().documentos.original(id), staleTime: 50 * 60_000 }),
  bibliotecas: () => queryOptions({ queryKey: ['bibliotecas'], queryFn: () => api().bibliotecas.listar() }),
  busqueda: (consulta: string, filtros: Filtros) => queryOptions({
    queryKey: ['busqueda', consulta, filtros],
    queryFn: () => api().busqueda.buscar({ consulta, filtros, k: 30 }),
    enabled: consulta.trim().length > 1,
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  }),
  tareas: () => queryOptions({ queryKey: ['tareas'], queryFn: () => api().tareas.listar(true) }),
  historial: () => queryOptions({ queryKey: ['historial'], queryFn: () => api().historial.listar({ limite: 200 }) }),
  vigilantes: () => queryOptions({ queryKey: ['vigilantes'], queryFn: () => api().vigilantes.listar() }),
  alertas: () => queryOptions({ queryKey: ['alertas'], queryFn: () => api().alertas.listar() }),
  cuadernos: () => queryOptions({ queryKey: ['cuadernos'], queryFn: () => api().cuadernos.listar() }),
  tarjetas: (id: string) => queryOptions({ queryKey: ['tarjetas', id], queryFn: () => api().cuadernos.tarjetas(id) }),
  estilos: (texto = '') => queryOptions({ queryKey: ['estilos', texto], queryFn: () => api().citas.estilos(texto), staleTime: 60 * 60_000 }),
  mapa: () => queryOptions({ queryKey: ['mapa'], queryFn: () => api().mapa.obtener() }),
  grupo: (i: number) => queryOptions({ queryKey: ['mapa', 'grupo', i], queryFn: () => api().mapa.grupo(i) }),
  grafo: () => queryOptions({ queryKey: ['grafo'], queryFn: () => api().grafo.obtener() }),
  huerfanas: () => queryOptions({ queryKey: ['grafo', 'huerfanas'], queryFn: () => api().grafo.huerfanas() }),
  arqueologia: () => queryOptions({ queryKey: ['perspectivas', 'arqueologia'], queryFn: () => api().perspectivas.arqueologia() }),
  huecos: () => queryOptions({ queryKey: ['perspectivas', 'huecos'], queryFn: () => api().perspectivas.huecos() }),
  recomendaciones: () => queryOptions({ queryKey: ['perspectivas', 'recomendaciones'], queryFn: () => api().perspectivas.recomendaciones() }),
  corpus: () => queryOptions({ queryKey: ['corpus'], queryFn: () => api().corpus.instantanea() }),
  conceptos: () => queryOptions({ queryKey: ['conceptos'], queryFn: () => api().conceptos.listar() }),
  claves: () => queryOptions({ queryKey: ['claves'], queryFn: () => api().claves.listar() }),
  ajustes: () => queryOptions({ queryKey: ['ajustes'], queryFn: () => api().ajustes.obtener() }),
  grabacion: () => queryOptions({ queryKey: ['grabacion'], queryFn: () => api().privacidad.grabacion() }),
};
