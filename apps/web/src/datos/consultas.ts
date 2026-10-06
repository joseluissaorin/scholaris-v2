/**
 * Claves y opciones de TanStack Query. Una sola fuente de verdad para que las
 * rutas puedan precargar (al pasar el ratón por un enlace) exactamente lo que
 * la pantalla va a pedir.
 */
import { QueryClient, queryOptions, keepPreviousData } from '@tanstack/react-query';
import type { Filtros } from '@scholaris/nucleo';
import type { FiltrosDocumentos, TipoEntidad } from '@scholaris/contrato';
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
  /*
   * La API numera las unidades desde 0; la web, desde 1 (la página física 1 es
   * la unidad 1). Se traduce aquí, en un solo sitio, y el resto de la web no lo sabe.
   */
  bloque: (id: string, bloque: number) => queryOptions({
    queryKey: ['unidades', id, bloque],
    queryFn: async () => (await api().documentos.unidades(id, bloque * BLOQUE, (bloque + 1) * BLOQUE - 1)).map((u) => ({ ...u, orden: u.orden + 1 })),
    staleTime: 5 * 60_000,
  }),
  folios: (id: string) => queryOptions({ queryKey: ['folios', id], queryFn: async () => { const m = await api().documentos.folios(id); return { folios: m.folios.map((f) => ({ ...f, orden: f.orden + 1 })) }; }, staleTime: 5 * 60_000 }),
  secciones: (id: string) => queryOptions({ queryKey: ['secciones', id], queryFn: async () => (await api().documentos.secciones(id)).map((s) => ({ ...s, unidadDesde: s.unidadDesde + 1, ...(s.unidadHasta != null ? { unidadHasta: s.unidadHasta + 1 } : {}) })), staleTime: 5 * 60_000 }),
  figuras: (id: string) => queryOptions({ queryKey: ['figuras', id], queryFn: async () => (await api().documentos.figuras(id)).map((f) => ({ ...f, unidad: f.unidad + 1 })), staleTime: 5 * 60_000 }),
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
  entidades: (consulta = '', tipo?: TipoEntidad) => queryOptions({ queryKey: ['entidades', 'lista', consulta, tipo ?? ''], queryFn: () => api().entidades.buscar({ q: consulta || undefined, tipo, limite: 120 }), placeholderData: keepPreviousData }),
  entidad: (id: string) => queryOptions({ queryKey: ['entidades', 'ficha', id], queryFn: () => api().entidades.obtener(id) }),
  vecindario: (id: string) => queryOptions({ queryKey: ['entidades', 'vecindario', id], queryFn: () => api().entidades.vecinos(id, { saltos: 2 }), placeholderData: keepPreviousData }),
  lineaEntidad: (id: string) => queryOptions({ queryKey: ['entidades', 'linea', id], queryFn: () => api().entidades.linea(id) }),
  caminoEntidades: (desde: string, hasta: string) => queryOptions({ queryKey: ['entidades', 'camino', desde, hasta], queryFn: () => api().entidades.camino(desde, hasta), enabled: !!desde && !!hasta }),
  estadoEntidades: () => queryOptions({ queryKey: ['entidades', 'estado'], queryFn: () => api().entidades.estado() }),
  entidadesLector: (documento: string) => queryOptions({ queryKey: ['entidades', 'lector', documento], queryFn: () => api().entidades.lector(documento), staleTime: 5 * 60_000, retry: 0 }),
  arqueologia: () => queryOptions({ queryKey: ['perspectivas', 'arqueologia'], queryFn: () => api().perspectivas.arqueologia() }),
  huecos: () => queryOptions({ queryKey: ['perspectivas', 'huecos'], queryFn: () => api().perspectivas.huecos() }),
  recomendaciones: () => queryOptions({ queryKey: ['perspectivas', 'recomendaciones'], queryFn: () => api().perspectivas.recomendaciones() }),
  corpus: () => queryOptions({ queryKey: ['corpus'], queryFn: () => api().corpus.instantanea() }),
  conceptos: () => queryOptions({ queryKey: ['conceptos'], queryFn: () => api().conceptos.listar() }),
  claves: () => queryOptions({ queryKey: ['claves'], queryFn: () => api().claves.listar() }),
  ajustes: () => queryOptions({ queryKey: ['ajustes'], queryFn: () => api().ajustes.obtener() }),
  grabacion: () => queryOptions({ queryKey: ['grabacion'], queryFn: () => api().privacidad.grabacion() }),
};
