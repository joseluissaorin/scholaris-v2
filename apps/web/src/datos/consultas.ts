/**
 * Claves y opciones de TanStack Query. Una sola fuente de verdad para que las
 * rutas puedan precargar (al pasar el ratón por un enlace) exactamente lo que
 * la pantalla va a pedir.
 */
import { QueryClient, queryOptions, keepPreviousData } from '@tanstack/react-query';
import { limpiarMarcadoOCR, type Filtros } from '@scholaris/nucleo';
import type { DetalleDocumento, FiltrosDocumentos, RespuestaBusqueda, TipoEntidad, UnidadVista } from '@scholaris/contrato';
import { api } from './api';
import { esMedio } from '../lib/formato';

export const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

/** Unidades por bloque al leer: 12 páginas por petición. */
export const BLOQUE = 12;

/*
 * La API numera las unidades desde 0. Los documentos migrados de la v1 que aún
 * no se han reparado llegan desde 1: la web lo detecta (en el primer bloque o en
 * los folios) y lo compensa, en vez de dejar la primera fila en esqueleto.
 */
const basesUnidades = new Map<string, number>();
const baseDe = (id: string) => basesUnidades.get(id) ?? 0;
function anotarBase(id: string, minimo: number) {
  const b = minimo === 1 ? 1 : 0;
  if (basesUnidades.get(id) === b) return;
  const antes = basesUnidades.has(id);
  basesUnidades.set(id, b);
  // Si ya se habían traducido bloques con otra base, se vuelven a pedir.
  if (antes || b) for (const k of ['unidades', 'folios', 'secciones', 'figuras']) void clienteConsultas.invalidateQueries({ queryKey: [k, id], refetchType: 'active' });
}

async function leerBloque(id: string, bloque: number): Promise<UnidadVista[]> {
  const desde = bloque * BLOQUE, hasta = (bloque + 1) * BLOQUE - 1;
  let b = baseDe(id);
  // El primer bloque pide una unidad de más para saber dónde empieza la numeración.
  const crudas = await api().documentos.unidades(id, desde + b, hasta + b + (bloque === 0 && !basesUnidades.has(id) ? 1 : 0));
  if (bloque === 0 && !basesUnidades.has(id) && crudas.length) {
    const minimo = Math.min(...crudas.map((u) => u.orden));
    basesUnidades.set(id, minimo === 1 ? 1 : 0);
    b = baseDe(id);
  }
  const unidades = crudas
    .filter((u) => u.orden - b >= desde && u.orden - b <= hasta)
    .map((u) => ({ ...u, orden: u.orden - b + 1, texto: limpiarMarcadoOCR(u.texto) }));
  // Huecos en un documento ya leído: la página existe aunque no haya llegado su unidad; se pinta vacía.
  const doc = clienteConsultas.getQueryData<DetalleDocumento>(['documento', id]);
  if (doc?.estado === 'listo' && doc.unidades > 0) {
    const tiene = new Set(unidades.map((u) => u.orden));
    const tipoPagina = !esMedio(doc.tipo);
    for (let o = desde + 1; o <= Math.min(hasta + 1, doc.unidades); o++) {
      if (tiene.has(o) || !tipoPagina) continue;
      unidades.push({ id: `hueco:${id}:${o}`, orden: o, etiqueta: '', lector: 'hueco', confianza: 0, texto: '',
        ancla: { tipo: 'pagina', fisica: o, impresa: null, romana: false, origen: 'ninguno', confianza: 0 } } as UnidadVista);
    }
    unidades.sort((x, y) => x.orden - y.orden);
  }
  return unidades;
}

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
    queryFn: () => leerBloque(id, bloque),
    staleTime: 5 * 60_000,
  }),
  folios: (id: string) => queryOptions({ queryKey: ['folios', id], queryFn: async () => {
    const m = await api().documentos.folios(id);
    if (m.folios.length) anotarBase(id, Math.min(...m.folios.map((f) => f.orden)));
    const b = baseDe(id);
    return { folios: m.folios.map((f) => ({ ...f, orden: f.orden - b + 1 })) };
  }, staleTime: 5 * 60_000 }),
  secciones: (id: string) => queryOptions({ queryKey: ['secciones', id], queryFn: async () => { const r = await api().documentos.secciones(id); const b = baseDe(id); return r.map((s) => ({ ...s, unidadDesde: s.unidadDesde - b + 1, ...(s.unidadHasta != null ? { unidadHasta: s.unidadHasta - b + 1 } : {}) })); }, staleTime: 5 * 60_000 }),
  figuras: (id: string) => queryOptions({ queryKey: ['figuras', id], queryFn: async () => { const r = await api().documentos.figuras(id); const b = baseDe(id); return r.map((f) => ({ ...f, unidad: f.unidad - b + 1 })); }, staleTime: 5 * 60_000 }),
  original: (id: string) => queryOptions({ queryKey: ['original', id], queryFn: () => api().documentos.original(id), staleTime: 50 * 60_000 }),
  bibliotecas: () => queryOptions({ queryKey: ['bibliotecas'], queryFn: () => api().bibliotecas.listar() }),
  /*
   * Búsqueda en dos tiempos: el orden preliminar (~350 ms) se escribe en la caché
   * en cuanto llega, marcado `preliminar`, y la respuesta final lo sustituye. Las
   * tarjetas se recolocan por id (FLIP) sin vaciar la lista. Si la API no habla
   * en dos tiempos, se cae a la búsqueda de una sola vez.
   */
  busqueda: (consulta: string, filtros: Filtros) => queryOptions({
    queryKey: ['busqueda', consulta, filtros],
    queryFn: async ({ signal }): Promise<RespuestaBusqueda & { preliminar?: boolean }> => {
      const clave = ['busqueda', consulta, filtros];
      try {
        return await api().busqueda.buscarProgresivo({ consulta, filtros, k: 30 }, (resultados) => {
          if (signal.aborted) return;
          clienteConsultas.setQueryData(clave, { resultados, ms: 0, preliminar: true });
        });
      } catch (e) {
        if (signal.aborted) throw e;
        return api().busqueda.buscar({ consulta, filtros, k: 30 });
      }
    },
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

/**
 * Lo que el lector necesita para su primer pintado: el documento, su índice, el
 * primer bloque y, en audio y vídeo, la URL firmada del medio. La URL del original
 * se pide a la vez que el documento cuando ya se sabe (o se sospecha, por `?t=`
 * o por llegar desde un enlace directo) que es un medio; si no, en cuanto llega el documento.
 */
export function precargarLector(c: QueryClient, id: string, u = 1, pedirOriginal = false) {
  void c.prefetchQuery(q.secciones(id));
  void c.prefetchQuery(q.folios(id));
  void c.prefetchQuery(q.bloque(id, Math.floor((u - 1) / BLOQUE)));
  const tipoSabido = c.getQueryData(q.documento(id).queryKey)?.tipo
    ?? c.getQueriesData<{ elementos?: Array<{ id: string; tipo: string }> }>({ queryKey: ['documentos'] }).flatMap(([, v]) => v?.elementos ?? []).find((x) => x.id === id)?.tipo;
  const original = pedirOriginal || (tipoSabido && esMedio(tipoSabido as never)) ? c.prefetchQuery(q.original(id)) : null;
  const documento = c.ensureQueryData(q.documento(id));
  // Los de YouTube no tienen original: se ven con su reproductor insertado.
  return documento.then(async (d) => { if (esMedio(d.tipo) && d.mime !== 'application/x-youtube') await (original ?? c.prefetchQuery(q.original(id))); return d; });
}
