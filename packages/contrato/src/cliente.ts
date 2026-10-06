/**
 * Cliente tipado de la API v2. Sin dependencias: `fetch`, `WebSocket` y
 * `ReadableStream` del entorno (navegador, Workers, Node ≥ 20, Bun).
 *
 *   const api = crearCliente({ base: '', token: () => clerk.session?.getToken() });
 *   const { elementos } = await api.documentos.listar({ orden: 'anio' });
 */

import type { Filtros, MetadatosDocumento } from '@scholaris/nucleo';
import { ErrorApi, PREFIJO_API, type CodigoError, type CuerpoError, type Ok, type Pagina, type ParamsPagina, type RefTarea } from './comun.js';
import type {
  Ajustes, ClaveApi, ClaveApiCreada, ConfigPublica, CrearClaveApi, EstadoGrabacion, PreferenciasParciales,
  ProveedorClave, ResultadoPurga, Yo,
} from './cuenta.js';
import type {
  CompletarSubida, IngestaIniciada, Ingestar, NuevaSubida, PedirRecursos, RecursosFirmados, SubidaCreada, SubidaUrl, UrlsPartes,
} from './subidas.js';
import type {
  DetalleDocumento, FiguraVista, FiltrosDocumentos, FragmentoVista, ImportacionSpdf, MapaFolios, ParcheMetadatos,
  Reprocesar, ResumenDocumento, SeccionVista, UnidadVista, VolcadoDocumento,
} from './documentos.js';
import type { AnadirDocumentos, Biblioteca, Compartir, Miembro, NuevaBiblioteca } from './bibliotecas.js';
import type {
  Buscar, BuscarMultilingue, EventoRespuesta, Responder, RespuestaBusqueda, RespuestaMultilingue, Similares,
} from './busqueda.js';
import type {
  Autocita, AutocitaIniciada, Bibliografia, FicheroCitas, CitaDocumento, DecisionesAutocita, DetalleAutocita, EstiloCsl, ExportarReferencias,
  ImportacionBibtex, ImportarBibtex, InsertarEnDocx, PedirBibliografia, ResumenAutocita, TextoExtraido, Verificacion, Verificar,
} from './citas.js';
import type {
  AgregadosConcepto, Alerta, Arqueologia, Concepto, Cuaderno, DetalleEventoBusqueda, EstadisticasHistorial,
  EventoBusqueda, EventoConstruccionMapa, FiltrosHistorial, GrafoCitas, Hueco, InformeConcepto, InstantaneaCorpus, KpisCorpus,
  MapaConceptos, MetaMapa, MiembrosGrupo, NodoGrafoDetalle, NuevaTarjeta, NuevoConcepto, NuevoCuaderno, NuevoVigilante,
  Recomendacion, ReferenciaHuerfana, Sintesis, Tarjeta, TramoConcepto, Vigilante,
} from './funciones.js';
import type { Billete, EventoTiempoReal, MensajeCliente, Tarea } from './tiempo-real.js';

export type FuenteToken = string | null | undefined | (() => string | null | undefined | Promise<string | null | undefined>);

export interface OpcionesCliente {
  /** Origen de la API («https://scholaris.app», «» para el mismo origen). */
  base: string;
  token?: FuenteToken;
  /** fetch alternativo (pruebas, SSR). */
  fetch?: typeof fetch;
  /** Trabajar dentro de una biblioteca que otro usuario comparte conmigo. */
  compartida?: string;
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Consulta = Record<string, string | number | boolean | string[] | undefined | null>;

/** Convierte un objeto en query string; los arrays se repiten (`tipo=pdf&tipo=epub`). */
export function aConsulta(q?: Consulta | object): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const x of v) p.append(k, String(x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Lee un text/event-stream y entrega cada evento con su JSON. */
export async function* leerSSE<T>(cuerpo: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const lector = cuerpo.getReader();
  const dec = new TextDecoder();
  let resto = '';
  while (true) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i: number;
    while ((i = resto.indexOf('\n\n')) >= 0) {
      const bloque = resto.slice(0, i);
      resto = resto.slice(i + 2);
      const datos = bloque.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (datos) yield JSON.parse(datos) as T;
    }
  }
}

export function crearCliente(opciones: OpcionesCliente) {
  const base = opciones.base.replace(/\/$/, '');
  const f = opciones.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function token(): Promise<string | null> {
    const t = opciones.token;
    if (typeof t === 'function') return (await t()) ?? null;
    return t ?? null;
  }

  async function bruto(metodo: Metodo, ruta: string, cuerpo?: unknown, consulta?: Consulta | object, cabeceras: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { ...cabeceras };
    const t = await token();
    if (t) h.authorization = `Bearer ${t}`;
    let body: BodyInit | undefined;
    if (cuerpo instanceof Uint8Array || cuerpo instanceof ArrayBuffer || cuerpo instanceof Blob || cuerpo instanceof ReadableStream) {
      body = cuerpo as BodyInit;
      h['content-type'] ??= 'application/octet-stream';
    } else if (cuerpo !== undefined) {
      body = JSON.stringify(cuerpo);
      h['content-type'] = 'application/json';
    }
    const prefijo = opciones.compartida ? `/compartidas/${encodeURIComponent(opciones.compartida)}` : '';
    const res = await f(`${base}${PREFIJO_API}${prefijo}${ruta}${aConsulta(consulta)}`, { method: metodo, headers: h, body, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
    if (!res.ok) {
      let e: CuerpoError | null = null;
      try { e = (await res.json()) as CuerpoError; } catch { /* sin cuerpo JSON */ }
      throw new ErrorApi(res.status, (e?.error?.codigo ?? 'interno') as CodigoError, e?.error?.mensaje ?? `Error ${res.status}`, e?.error?.detalles);
    }
    return res;
  }

  async function pedir<T>(metodo: Metodo, ruta: string, cuerpo?: unknown, consulta?: Consulta | object): Promise<T> {
    const res = await bruto(metodo, ruta, cuerpo, consulta);
    if (res.status === 204) return { ok: true } as T;
    return (await res.json()) as T;
  }

  const get = <T>(ruta: string, consulta?: Consulta | object) => pedir<T>('GET', ruta, undefined, consulta);
  const post = <T>(ruta: string, cuerpo?: unknown, consulta?: Consulta | object) => pedir<T>('POST', ruta, cuerpo ?? {}, consulta);
  const patch = <T>(ruta: string, cuerpo: unknown) => pedir<T>('PATCH', ruta, cuerpo);
  const put = <T>(ruta: string, cuerpo: unknown) => pedir<T>('PUT', ruta, cuerpo);
  const del = <T = Ok>(ruta: string) => pedir<T>('DELETE', ruta);
  const e = encodeURIComponent;

  async function* sse<T>(ruta: string, cuerpo: unknown): AsyncGenerator<T> {
    const res = await bruto('POST', ruta, cuerpo, undefined, { accept: 'text/event-stream' });
    if (!res.body) return;
    yield* leerSSE<T>(res.body);
  }

  return {
    /** Acceso de bajo nivel para lo que no tenga método propio. */
    pedir,
    bruto,

    /** El mismo cliente, dentro de una biblioteca compartida conmigo (rutas /compartidas/:id/…). */
    compartida: (biblioteca: string) => crearCliente({ ...opciones, compartida: biblioteca }),

    config: () => get<ConfigPublica>('/config'),
    salud: () => get<{ ok: true; version: string }>('/salud'),

    auth: {
      yo: () => get<Yo>('/auth/yo'),
      borrarCuenta: () => post<Ok>('/auth/borrar', { confirmar: 'BORRAR' }),
    },

    subidas: {
      crear: (p: NuevaSubida) => post<SubidaCreada>('/subidas', p),
      partes: (id: string, numeros: number[]) => post<UrlsPartes>(`/subidas/${e(id)}/partes`, { numeros }),
      completar: (id: string, p: CompletarSubida) => post<Ok>(`/subidas/${e(id)}/completar`, p),
      recursos: (id: string, p: PedirRecursos) => post<RecursosFirmados>(`/subidas/${e(id)}/recursos`, p),
      ingestar: (id: string, p: Ingestar = {}) => post<IngestaIniciada>(`/subidas/${e(id)}/ingestar`, p),
      desdeUrl: (p: SubidaUrl) => post<IngestaIniciada>('/subidas/url', p),
      cancelar: (id: string) => del(`/subidas/${e(id)}`),
    },

    documentos: {
      listar: (p: FiltrosDocumentos = {}) => get<Pagina<ResumenDocumento>>('/documentos', p),
      obtener: (id: string) => get<DetalleDocumento>(`/documentos/${e(id)}`),
      metadatos: (id: string, p: ParcheMetadatos) => patch<DetalleDocumento>(`/documentos/${e(id)}/metadatos`, p),
      borrar: (id: string) => del(`/documentos/${e(id)}`),
      reprocesar: (id: string, p: Reprocesar = {}) => post<IngestaIniciada>(`/documentos/${e(id)}/reprocesar`, p),
      reintentar: (id: string) => post<IngestaIniciada>(`/documentos/${e(id)}/reintentar`),
      unidades: (id: string, desde: number, hasta: number) => get<UnidadVista[]>(`/documentos/${e(id)}/unidades`, { desde, hasta }),
      unidad: (id: string, orden: number) => get<UnidadVista>(`/documentos/${e(id)}/unidades/${orden}`),
      /** URL de la imagen (redirige a la firmada). Para <img>, mejor `imagenUrl` de la unidad. */
      urlImagen: (id: string, orden: number, miniatura = false) => `${base}${PREFIJO_API}/documentos/${e(id)}/unidades/${orden}/imagen${miniatura ? '?miniatura=1' : ''}`,
      folios: (id: string) => get<MapaFolios>(`/documentos/${e(id)}/folios`),
      secciones: (id: string) => get<SeccionVista[]>(`/documentos/${e(id)}/secciones`),
      fragmentos: (id: string, p: { unidad?: number; desde?: number; hasta?: number } = {}) => get<FragmentoVista[]>(`/documentos/${e(id)}/fragmentos`, p),
      figuras: (id: string) => get<FiguraVista[]>(`/documentos/${e(id)}/figuras`),
      original: (id: string) => get<{ url: string }>(`/documentos/${e(id)}/original`),
      /** URL del medio con Range (necesita token: úsese con fetch o pida `original`). */
      urlMedio: (id: string) => `${base}${PREFIJO_API}/documentos/${e(id)}/medio`,
      volcado: (id: string) => get<VolcadoDocumento>(`/documentos/${e(id)}/volcado`),
      spdf: async (id: string) => new Uint8Array(await (await bruto('GET', `/documentos/${e(id)}/spdf`)).arrayBuffer()),
      importar: (spdf: Uint8Array | Blob, opciones: { biblioteca?: string } = {}) =>
        bruto('POST', '/documentos/importar', spdf, opciones, { 'content-type': 'application/x-spdf' }).then((r) => r.json() as Promise<ImportacionSpdf>),
      cita: (id: string, p: { estilo?: string; idioma?: string } = {}) => get<CitaDocumento>(`/documentos/${e(id)}/cita`, p),
    },

    bibliotecas: {
      listar: () => get<Biblioteca[]>('/bibliotecas'),
      crear: (p: NuevaBiblioteca) => post<Biblioteca>('/bibliotecas', p),
      obtener: (id: string) => get<Biblioteca>(`/bibliotecas/${e(id)}`),
      editar: (id: string, p: Partial<NuevaBiblioteca>) => patch<Biblioteca>(`/bibliotecas/${e(id)}`, p),
      borrar: (id: string) => del(`/bibliotecas/${e(id)}`),
      anadir: (id: string, p: AnadirDocumentos) => post<Biblioteca>(`/bibliotecas/${e(id)}/documentos`, p),
      quitar: (id: string, documento: string) => del<Biblioteca>(`/bibliotecas/${e(id)}/documentos/${e(documento)}`),
      miembros: (id: string) => get<Miembro[]>(`/bibliotecas/${e(id)}/miembros`),
      compartir: (id: string, p: Compartir) => post<Miembro>(`/bibliotecas/${e(id)}/compartir`, p),
      dejarDeCompartir: (id: string, usuario: string) => del(`/bibliotecas/${e(id)}/miembros/${e(usuario)}`),
      exportar: async (id: string) => (await bruto('GET', `/bibliotecas/${e(id)}/exportar`)).blob(),
    },

    busqueda: {
      buscar: (p: Buscar) => post<RespuestaBusqueda>('/busqueda', p),
      responder: (p: Responder) => sse<EventoRespuesta>('/busqueda/responder', p),
      similares: (p: Similares) => post<RespuestaBusqueda>('/busqueda/similares', p),
      multilingue: (p: BuscarMultilingue) => post<RespuestaMultilingue>('/busqueda/multilingue', p),
    },

    citas: {
      autocita: (p: Autocita) => post<AutocitaIniciada>('/citas/autocita', p),
      autocitas: (p: ParamsPagina = {}) => get<Pagina<ResumenAutocita>>('/citas/autocita', p),
      detalleAutocita: (id: string) => get<DetalleAutocita>(`/citas/autocita/${e(id)}`),
      decidir: (id: string, p: DecisionesAutocita) => patch<DetalleAutocita>(`/citas/autocita/${e(id)}`, p),
      borrarAutocita: (id: string) => del(`/citas/autocita/${e(id)}`),
      exportarAutocita: async (id: string, formato: 'docx' | 'md' | 'txt' | 'latex') => (await bruto('GET', `/citas/autocita/${e(id)}/exportar`, undefined, { formato })).blob(),
      subir: (fichero: Blob | Uint8Array, mime: string, nombre?: string) =>
        bruto('POST', '/citas/subir', fichero, nombre ? { nombre } : undefined, { 'content-type': mime }).then((r) => r.json() as Promise<FicheroCitas>),
      extraerTexto: (fichero: Blob | Uint8Array, mime: string) =>
        bruto('POST', '/citas/extraer-texto', fichero, undefined, { 'content-type': mime }).then((r) => r.json() as Promise<TextoExtraido>),
      verificar: (p: Verificar) => post<Verificacion>('/citas/verificar', p),
      exportar: async (p: ExportarReferencias) => (await bruto('POST', '/citas/exportar', p)).text(),
      bibliografia: (p: PedirBibliografia) => post<Bibliografia>('/citas/bibliografia', p),
      docx: (p: InsertarEnDocx) => post<{ url: string }>('/citas/docx', p),
      importarBibtex: (p: ImportarBibtex) => post<ImportacionBibtex>('/citas/importar-bibtex', p),
      estilos: (q?: string) => get<EstiloCsl[]>('/citas/estilos', { q }),
    },

    historial: {
      listar: (p: FiltrosHistorial = {}) => get<Pagina<EventoBusqueda>>('/historial', p),
      estadisticas: () => get<EstadisticasHistorial>('/historial/estadisticas'),
      obtener: (id: string) => get<DetalleEventoBusqueda>(`/historial/${e(id)}`),
      fijar: (id: string, fijado: boolean) => post<Ok>(`/historial/${e(id)}/fijar`, { fijado }),
      nota: (id: string, nota: string | null) => post<Ok>(`/historial/${e(id)}/nota`, { nota }),
      ocultar: (id: string) => post<Ok>(`/historial/${e(id)}/ocultar`),
      repetir: (id: string) => post<Buscar>(`/historial/${e(id)}/repetir`),
      borrar: (id: string) => del(`/historial/${e(id)}`),
    },

    cuadernos: {
      listar: () => get<Cuaderno[]>('/cuadernos'),
      crear: (p: NuevoCuaderno) => post<Cuaderno>('/cuadernos', p),
      obtener: (id: string) => get<Cuaderno>(`/cuadernos/${e(id)}`),
      editar: (id: string, p: Partial<NuevoCuaderno>) => patch<Cuaderno>(`/cuadernos/${e(id)}`, p),
      borrar: (id: string) => del(`/cuadernos/${e(id)}`),
      tarjetas: (id: string) => get<Tarjeta[]>(`/cuadernos/${e(id)}/tarjetas`),
      crearTarjeta: (id: string, p: NuevaTarjeta) => post<Tarjeta>(`/cuadernos/${e(id)}/tarjetas`, p),
      editarTarjeta: (id: string, tarjeta: string, p: { contenido?: Record<string, unknown>; posicion?: number }) => patch<Tarjeta>(`/cuadernos/${e(id)}/tarjetas/${e(tarjeta)}`, p),
      borrarTarjeta: (id: string, tarjeta: string) => del(`/cuadernos/${e(id)}/tarjetas/${e(tarjeta)}`),
      ordenar: (id: string, orden: string[]) => post<Ok>(`/cuadernos/${e(id)}/tarjetas/ordenar`, { orden }),
      sintetizar: (id: string, instrucciones: string) => post<Sintesis>(`/cuadernos/${e(id)}/sintesis`, { instrucciones }),
      sintesis: (id: string) => get<Sintesis[]>(`/cuadernos/${e(id)}/sintesis`),
      unaSintesis: (sintesis: string) => get<Sintesis>(`/cuadernos/sintesis/${e(sintesis)}`),
      reverificar: (id: string) => post<{ tarjetas: Tarjeta[] }>(`/cuadernos/${e(id)}/reverificar`),
    },

    vigilantes: {
      listar: () => get<Vigilante[]>('/vigilantes'),
      crear: (p: NuevoVigilante) => post<Vigilante>('/vigilantes', p),
      obtener: (id: string) => get<Vigilante>(`/vigilantes/${e(id)}`),
      editar: (id: string, p: Partial<NuevoVigilante>) => patch<Vigilante>(`/vigilantes/${e(id)}`, p),
      borrar: (id: string) => del(`/vigilantes/${e(id)}`),
      ejecutar: (id: string) => post<Alerta | { nada: true }>(`/vigilantes/${e(id)}/ejecutar`),
      alertas: (id: string) => get<Alerta[]>(`/vigilantes/${e(id)}/alertas`),
    },

    alertas: {
      listar: (pendientes = false) => get<Alerta[]>('/alertas', { pendientes: pendientes ? 1 : undefined }),
      visto: (id: string) => post<Ok>(`/alertas/${e(id)}/visto`),
    },

    conceptos: {
      listar: () => get<Concepto[]>('/conceptos'),
      crear: (p: NuevoConcepto) => post<Concepto>('/conceptos', p),
      obtener: (id: string) => get<Concepto>(`/conceptos/${e(id)}`),
      editar: (id: string, p: Partial<NuevoConcepto>) => patch<Concepto>(`/conceptos/${e(id)}`, p),
      borrar: (id: string) => del(`/conceptos/${e(id)}`),
      ejecutar: (id: string) => post<{ informe: string; tarea: string }>(`/conceptos/${e(id)}/ejecutar`),
      informes: (id: string) => get<InformeConcepto[]>(`/conceptos/${e(id)}/informes`),
      informe: (informe: string) => get<InformeConcepto>(`/conceptos/informes/${e(informe)}`),
      tramos: (informe: string, p: ParamsPagina = {}) => get<Pagina<TramoConcepto>>(`/conceptos/informes/${e(informe)}/tramos`, p),
      agregados: (informe: string) => get<AgregadosConcepto>(`/conceptos/informes/${e(informe)}/agregados`),
      exportar: async (informe: string, formato: 'csv' | 'json') => (await bruto('GET', `/conceptos/informes/${e(informe)}/exportar`, undefined, { formato })).blob(),
      etiquetar: (tramo: string, etiqueta: string) => post<TramoConcepto>(`/conceptos/tramos/${e(tramo)}/etiqueta`, { etiqueta }),
    },

    mapa: {
      meta: () => get<MetaMapa>('/mapa/meta'),
      obtener: (biblioteca?: string) => get<MapaConceptos>('/mapa', { biblioteca }),
      grupo: (indice: number) => get<MiembrosGrupo>(`/mapa/grupos/${indice}`),
      construir: (biblioteca?: string) => sse<EventoConstruccionMapa>('/mapa/construir', { biblioteca }),
    },

    grafo: {
      obtener: (biblioteca?: string) => get<GrafoCitas>('/grafo', { biblioteca }),
      nodo: (documento: string) => get<NodoGrafoDetalle>(`/grafo/nodos/${e(documento)}`),
      huerfanas: () => get<ReferenciaHuerfana[]>('/grafo/huerfanas'),
      reconstruir: () => post<{ nodos: number; aristas: number; ms: number }>('/grafo/reconstruir'),
    },

    perspectivas: {
      arqueologia: () => get<Arqueologia>('/perspectivas/arqueologia'),
      huecos: () => get<Hueco[]>('/perspectivas/huecos'),
      recomendaciones: () => get<Recomendacion[]>('/perspectivas/recomendaciones'),
      abierto: (documento: string, unidad?: number) => post<Ok>('/perspectivas/abierto', { documento, unidad }),
    },

    corpus: {
      kpis: () => get<KpisCorpus>('/corpus/kpis'),
      instantanea: () => get<InstantaneaCorpus>('/corpus/instantanea'),
      refrescar: () => post<InstantaneaCorpus>('/corpus/instantanea/refrescar'),
    },

    claves: {
      listar: () => get<ClaveApi[]>('/claves'),
      crear: (p: CrearClaveApi) => post<ClaveApiCreada>('/claves', p),
      revocar: (id: string) => del(`/claves/${e(id)}`),
    },

    ajustes: {
      obtener: () => get<Ajustes>('/ajustes'),
      preferencias: (p: PreferenciasParciales) => patch<Ajustes>('/ajustes', p),
      guardarClave: (proveedor: ProveedorClave, clave: string) => put<Ajustes>(`/ajustes/claves/${e(proveedor)}`, { clave }),
      borrarClave: (proveedor: ProveedorClave) => del<Ajustes>(`/ajustes/claves/${e(proveedor)}`),
    },

    privacidad: {
      grabacion: () => get<EstadoGrabacion>('/privacidad/grabacion'),
      cambiarGrabacion: (activa: boolean) => post<EstadoGrabacion>('/privacidad/grabacion', { activa }),
      exportar: async () => (await bruto('GET', '/privacidad/exportar')).blob(),
      borrarHistorial: () => del<ResultadoPurga>('/privacidad/historial'),
      purgar: () => post<ResultadoPurga>('/privacidad/purgar', { confirmar: 'BORRAR' }),
    },

    tareas: {
      listar: (activas = false) => get<Tarea[]>('/tareas', { activas: activas ? 1 : undefined }),
      obtener: (id: string) => get<Tarea>(`/tareas/${e(id)}`),
      reintentar: (id: string) => post<Tarea>(`/tareas/${e(id)}/reintentar`),
      cancelar: (id: string) => del(`/tareas/${e(id)}`),
    },

    tiempoReal: {
      billete: (tarea?: string) => post<Billete>('/tiempo-real/billete', { tarea }),
      /**
       * Abre el WebSocket de progreso (pide el billete y conecta). Reconecta solo
       * si se cae, hasta que se llame a `cerrar()`.
       */
      conectar(alEvento: (e: EventoTiempoReal) => void, opciones: { tarea?: string; alError?: (e: unknown) => void } = {}) {
        let ws: WebSocket | null = null;
        let cerrado = false;
        let espera = 1000;
        // Latido cada 25 s: los proxies cierran los WebSocket callados (unos 100 s en Cloudflare).
        // Es el texto «ping», al que el servidor contesta «pong» sin despertar al Durable Object.
        const latido = setInterval(() => { if (ws?.readyState === 1) ws.send('ping'); }, 25_000);
        const abrir = async () => {
          try {
            const b = await post<Billete>('/tiempo-real/billete', { tarea: opciones.tarea });
            let url = b.url;
            if (url.startsWith('/')) {
              const origen = base || ((globalThis as { location?: { origin: string } }).location?.origin ?? '');
              url = origen.replace(/^http/, 'ws') + url;
            }
            ws = new WebSocket(url);
            ws.addEventListener('open', () => { espera = 1000; });
            ws.addEventListener('message', (m: { data: unknown }) => {
              if (m.data === 'pong') return;
              try { alEvento(JSON.parse(String(m.data)) as EventoTiempoReal); } catch { /* mensaje no JSON */ }
            });
            ws.addEventListener('close', () => { if (!cerrado) setTimeout(abrir, (espera = Math.min(espera * 2, 30000))); });
            ws.addEventListener('error', (ev: unknown) => opciones.alError?.(ev));
          } catch (err) {
            opciones.alError?.(err);
            if (!cerrado) setTimeout(abrir, (espera = Math.min(espera * 2, 30000)));
          }
        };
        void abrir();
        return {
          enviar: (m: MensajeCliente) => ws?.readyState === 1 && ws.send(JSON.stringify(m)),
          cerrar: () => { cerrado = true; clearInterval(latido); ws?.close(); },
        };
      },
    },
  };
}

export type ClienteScholaris = ReturnType<typeof crearCliente>;

/**
 * Sube un fichero entero siguiendo la `SubidaDirecta` que devolvió la API
 * (simple o por partes, con reintentos por parte). Lo usan la web y el SDK.
 */
export async function subirFichero(
  api: ClienteScholaris,
  subida: string,
  destino: SubidaCreada['original'],
  fichero: Blob,
  alAvance?: (enviados: number, total: number) => void,
): Promise<void> {
  if (destino.modo === 'simple') {
    if (!destino.url) throw new Error('La subida no trae URL');
    const r = await fetch(destino.url, { method: 'PUT', body: fichero, headers: destino.cabeceras });
    if (!r.ok) throw new Error(`La subida falló (${r.status})`);
    alAvance?.(fichero.size, fichero.size);
    return;
  }
  const tam = destino.tamParte ?? 10 * 1024 * 1024;
  const n = Math.max(1, Math.ceil(fichero.size / tam));
  const numeros = Array.from({ length: n }, (_, i) => i + 1);
  const hechas: Array<{ numero: number; etag: string }> = [];
  let enviados = 0;
  for (let i = 0; i < n; i += 8) {
    const lote = numeros.slice(i, i + 8);
    const { partes } = await api.subidas.partes(subida, lote);
    await Promise.all(partes.map(async (p) => {
      const trozo = fichero.slice((p.numero - 1) * tam, Math.min(p.numero * tam, fichero.size));
      let ultimo: unknown;
      for (let intento = 0; intento < 4; intento++) {
        try {
          const r = await fetch(p.url, { method: 'PUT', body: trozo, headers: p.cabeceras });
          if (!r.ok) throw new Error(`Parte ${p.numero}: ${r.status}`);
          const etag = r.headers.get('etag') ?? (await r.json().catch(() => ({})) as { etag?: string }).etag;
          if (!etag) throw new Error(`Parte ${p.numero} sin ETag (¿falta exponer la cabecera en CORS?)`);
          hechas.push({ numero: p.numero, etag });
          enviados += trozo.size;
          alAvance?.(enviados, fichero.size);
          return;
        } catch (err) {
          ultimo = err;
          await new Promise((r) => setTimeout(r, 500 * 2 ** intento));
        }
      }
      throw ultimo;
    }));
  }
  await api.subidas.completar(subida, { partes: hechas.sort((a, b) => a.numero - b.numero) });
}

export type { Filtros, MetadatosDocumento };
