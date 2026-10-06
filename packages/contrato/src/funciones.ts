/**
 * Las funciones que viven sobre la estantería (las implementa
 * `@scholaris/funciones`; la plataforma las monta con estas mismas rutas).
 *
 * Historial
 *   GET    /historial?…FiltrosHistorial      → Pagina<EventoBusqueda>
 *   GET    /historial/estadisticas           → EstadisticasHistorial
 *   GET    /historial/:id                    → DetalleEventoBusqueda
 *   POST   /historial/:id/fijar   { fijado } → Ok
 *   POST   /historial/:id/nota    { nota }   → Ok
 *   POST   /historial/:id/ocultar            → Ok      (borra la consulta y la respuesta, deja la estadística)
 *   POST   /historial/:id/repetir            → Buscar  (parámetros listos para POST /busqueda/responder)
 *   DELETE /historial/:id                    → Ok
 *
 * Cuadernos
 *   GET    /cuadernos                        → Cuaderno[]
 *   POST   /cuadernos   NuevoCuaderno        → Cuaderno
 *   GET    /cuadernos/:id                    → Cuaderno
 *   PATCH  /cuadernos/:id  Partial<NuevoCuaderno> → Cuaderno
 *   DELETE /cuadernos/:id                    → Ok
 *   GET    /cuadernos/:id/tarjetas           → Tarjeta[]
 *   POST   /cuadernos/:id/tarjetas  NuevaTarjeta → Tarjeta
 *   PATCH  /cuadernos/:id/tarjetas/:tarjeta  { contenido?, posicion? } → Tarjeta
 *   DELETE /cuadernos/:id/tarjetas/:tarjeta  → Ok
 *   POST   /cuadernos/:id/tarjetas/ordenar  { orden: string[] } → Ok
 *   POST   /cuadernos/:id/sintesis  { instrucciones } → Sintesis
 *   GET    /cuadernos/:id/sintesis           → Sintesis[]
 *   GET    /cuadernos/sintesis/:sintesis     → Sintesis
 *   POST   /cuadernos/:id/reverificar        → { tarjetas: Tarjeta[] }  (citas vivas)
 *
 * Vigilantes y alertas
 *   GET    /vigilantes                       → Vigilante[]
 *   POST   /vigilantes  NuevoVigilante       → Vigilante
 *   GET    /vigilantes/:id                   → Vigilante
 *   PATCH  /vigilantes/:id  Partial<NuevoVigilante> → Vigilante
 *   DELETE /vigilantes/:id                   → Ok
 *   POST   /vigilantes/:id/ejecutar          → Alerta | { nada: true }
 *   GET    /vigilantes/:id/alertas           → Alerta[]
 *   GET    /alertas?pendientes=1             → Alerta[]
 *   POST   /alertas/:id/visto                → Ok
 *   (las alertas nuevas llegan también por /tiempo-real como EventoTiempoReal 'alerta')
 *
 * Conceptos (informes de un concepto a lo largo del corpus)
 *   GET    /conceptos                        → Concepto[]
 *   POST   /conceptos   NuevoConcepto        → Concepto
 *   GET    /conceptos/:id                    → Concepto
 *   PATCH  /conceptos/:id  Partial<NuevoConcepto> → Concepto
 *   DELETE /conceptos/:id                    → Ok
 *   POST   /conceptos/:id/ejecutar           → { informe, tarea }
 *   GET    /conceptos/:id/informes           → InformeConcepto[]
 *   GET    /conceptos/informes/:informe      → InformeConcepto
 *   GET    /conceptos/informes/:informe/tramos?…ParamsPagina → Pagina<TramoConcepto>
 *   GET    /conceptos/informes/:informe/agregados → AgregadosConcepto
 *   GET    /conceptos/informes/:informe/exportar?formato=csv|json → fichero
 *   POST   /conceptos/tramos/:tramo/etiqueta  { etiqueta } → TramoConcepto
 *
 * Mapa de conceptos (agrupación de la biblioteca)
 *   GET    /mapa/meta                        → MetaMapa
 *   GET    /mapa?biblioteca=                 → MapaConceptos
 *   GET    /mapa/grupos/:indice              → MiembrosGrupo
 *   POST   /mapa/construir  { biblioteca? }  → text/event-stream de { fase, avance, mensaje } y al final { fin: MetaMapa }
 *
 * Grafo de citas (quién cita a quién dentro de la biblioteca)
 *   GET    /grafo?biblioteca=                → GrafoCitas
 *   GET    /grafo/nodos/:documento           → NodoGrafoDetalle
 *   GET    /grafo/huerfanas                  → ReferenciaHuerfana[]   (citadas pero no en la biblioteca)
 *   POST   /grafo/reconstruir                → { nodos, aristas, ms }
 *
 * Perspectivas (insights)
 *   GET    /perspectivas/arqueologia         → Arqueologia     (lo que leíste y olvidaste)
 *   GET    /perspectivas/huecos              → Hueco[]         (temas que buscas y no tienes)
 *   GET    /perspectivas/recomendaciones     → Recomendacion[]
 *   POST   /perspectivas/abierto  { documento, unidad? } → Ok   (registra lectura)
 *
 * Corpus
 *   GET    /corpus/kpis                      → KpisCorpus
 *   GET    /corpus/instantanea               → InstantaneaCorpus
 *   POST   /corpus/instantanea/refrescar     → InstantaneaCorpus
 */

import type { Filtros, TipoEntrada } from '@scholaris/nucleo';
import type { ParamsPagina } from './comun.js';
import type { IntencionConsulta } from './busqueda.js';

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

export interface FiltrosHistorial extends ParamsPagina {
  q?: string;
  fijados?: boolean;
  desde?: string;
  hasta?: string;
  intencion?: IntencionConsulta;
}

export interface EventoBusqueda {
  id: string;
  consulta: string;
  tipo: 'busqueda' | 'respuesta' | 'multilingue' | 'verificacion' | 'similares';
  intencion?: IntencionConsulta;
  filtros?: Filtros;
  resultados: number;
  confianza?: 'alta' | 'media' | 'baja';
  estado: 'ok' | 'error';
  ms?: number;
  fijado: boolean;
  nota?: string;
  oculto: boolean;
  cuando: string;
}

export interface DetalleEventoBusqueda extends EventoBusqueda {
  respuesta?: string;
  /** Los primeros resultados tal como se vieron. */
  principales: Array<{ fragmento: string; documento: string; etiqueta: string; titulo: string; puntuacion: number }>;
  error?: string;
}

export interface EstadisticasHistorial {
  total: number;
  porIntencion: Record<string, number>;
  porConfianza: Record<string, number>;
  porEstado: Record<string, number>;
  porDia: Array<{ dia: string; n: number }>;
}

// ---------------------------------------------------------------------------
// Cuadernos
// ---------------------------------------------------------------------------

export interface NuevoCuaderno {
  titulo: string;
  /** Cuerpo en Markdown. */
  cuerpo?: string;
}

export interface Cuaderno {
  id: string;
  titulo: string;
  cuerpo: string;
  tarjetas: number;
  creado: string;
  actualizado: string;
}

export type TipoTarjeta = 'fragmento' | 'unidad' | 'figura' | 'tramo' | 'nota' | 'sintesis';

export interface NuevaTarjeta {
  tipo: TipoTarjeta;
  documento?: string;
  /** Fragmento, unidad o figura citada. */
  objetivo?: string;
  /** Tramo de un medio, en segundos. */
  t0?: number;
  t1?: number;
  /** Texto de la nota, o datos propios de la tarjeta. */
  contenido?: Record<string, unknown>;
  posicion?: number;
}

export interface Tarjeta {
  id: string;
  tipo: TipoTarjeta;
  documento?: string;
  objetivo?: string;
  t0?: number;
  t1?: number;
  contenido: Record<string, unknown>;
  /** Texto citado y su etiqueta, resueltos contra la estantería. */
  cita?: { texto: string; etiqueta: string; citaCorta: string };
  posicion: number;
  /** El documento o el fragmento ya no existen. */
  huerfana: boolean;
  creada: string;
}

export interface PedirSintesis {
  instrucciones: string;
}

export interface Sintesis {
  id: string;
  cuaderno: string;
  instrucciones: string;
  texto: string;
  /** Citas usadas: [n] → tarjeta / fragmento. */
  citas: Array<{ n: number; tarjeta?: string; fragmento?: string; etiqueta: string }>;
  creada: string;
}

// ---------------------------------------------------------------------------
// Vigilantes
// ---------------------------------------------------------------------------

export type ModoVigilante = 'manual' | 'al_ingerir' | 'diario' | 'semanal';

export interface NuevoVigilante {
  nombre: string;
  consulta: string;
  filtros?: Filtros;
  modo?: ModoVigilante;
  alertas?: boolean;
}

export interface Vigilante {
  id: string;
  nombre: string;
  consulta: string;
  filtros?: Filtros;
  modo: ModoVigilante;
  alertas: boolean;
  ultimaEjecucion?: string;
  ultimaConfianza?: 'alta' | 'media' | 'baja';
  pendientes: number;
  creado: string;
  actualizado: string;
}

export interface Alerta {
  id: string;
  vigilante: string;
  nombreVigilante?: string;
  /** Documentos nuevos que responden a la consulta. */
  documentosNuevos: string[];
  /** Qué cambia en la respuesta respecto a la última vez. */
  cambio?: string;
  disparadaPor: 'manual' | 'ingesta' | 'programada';
  vista?: string;
  creada: string;
}

// ---------------------------------------------------------------------------
// Conceptos
// ---------------------------------------------------------------------------

export interface NuevoConcepto {
  nombre: string;
  descripcion?: string;
  /** Términos y variantes (latín, otras lenguas…). */
  terminos?: string[];
  filtros?: Filtros;
}

export interface Concepto {
  id: string;
  nombre: string;
  descripcion?: string;
  terminos: string[];
  filtros?: Filtros;
  ultimoInforme?: string;
  creado: string;
  actualizado: string;
}

export interface InformeConcepto {
  id: string;
  concepto: string;
  estado: 'en_cola' | 'procesando' | 'listo' | 'error';
  tramos: number;
  documentos: number;
  resumen?: string;
  error?: string;
  creado: string;
  terminado?: string;
}

export interface TramoConcepto {
  id: string;
  informe: string;
  documento: string;
  titulo: string;
  fragmento: string;
  texto: string;
  etiqueta: string;
  /** Uso detectado: definición, aplicación, crítica, mención… */
  uso?: string;
  puntuacion: number;
  etiquetaUsuario?: string;
}

export interface AgregadosConcepto {
  porDocumento: Array<{ documento: string; titulo: string; n: number }>;
  porAnio: Array<{ anio: number; n: number }>;
  porUso: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Mapa de conceptos
// ---------------------------------------------------------------------------

export interface MetaMapa {
  construido?: string;
  grupos?: number;
  puntos?: number;
  muestreados?: number;
  ms?: number;
}

export interface GrupoMapa {
  indice: number;
  etiqueta?: string;
  confianzaEtiqueta?: number;
  tamano: number;
  modalidades: Record<string, number>;
  documentosPrincipales: string[];
  x: number;
  y: number;
}

export interface PuntoMapa {
  grupo: number;
  documento: string;
  objetivo: 'fragmento' | 'unidad' | 'figura';
  id: string;
  x: number;
  y: number;
}

export interface MapaConceptos {
  meta: MetaMapa;
  grupos: GrupoMapa[];
  puntos: PuntoMapa[];
}

export interface MiembrosGrupo {
  indice: number;
  miembros: Array<{ documento: string; titulo: string; objetivo: string; id: string; texto?: string; etiqueta?: string }>;
}

export interface EventoConstruccionMapa {
  fase?: string;
  avance?: number;
  mensaje?: string;
  fin?: MetaMapa;
  error?: string;
}

// ---------------------------------------------------------------------------
// Grafo de citas
// ---------------------------------------------------------------------------

export interface NodoGrafo {
  documento: string;
  titulo: string;
  autores: string;
  anio?: number;
  tipo: TipoEntrada;
  citas: number;
  citadoPor: number;
}

export interface AristaGrafo {
  desde: string;
  hacia: string;
  /** Unidades donde aparece la cita. */
  unidades?: number[];
  peso: number;
}

export interface GrafoCitas {
  nodos: NodoGrafo[];
  aristas: AristaGrafo[];
  construido?: string;
}

export interface NodoGrafoDetalle extends NodoGrafo {
  cita: Array<{ documento: string; titulo: string; etiquetas: string[] }>;
  citadoEn: Array<{ documento: string; titulo: string; etiquetas: string[] }>;
}

export interface ReferenciaHuerfana {
  referencia: string;
  doi?: string;
  anio?: number;
  citadaPor: string[];
}

// ---------------------------------------------------------------------------
// Perspectivas y corpus
// ---------------------------------------------------------------------------

export interface Arqueologia {
  olvidados: Array<{ documento: string; titulo: string; ultimaApertura?: string; motivo: string }>;
}

export interface Hueco {
  tema: string;
  consultas: number;
  resultadosMedios: number;
  sugerencia?: string;
}

export interface Recomendacion {
  documento?: string;
  titulo: string;
  motivo: string;
  referencia?: string;
}

export interface KpisCorpus {
  documentos: number;
  unidades: number;
  fragmentos: number;
  figuras: number;
  segundosDeMedio: number;
  bytes: number;
  refrescado?: string;
}

export interface InstantaneaCorpus extends KpisCorpus {
  porIdioma: Record<string, number>;
  porTipo: Record<string, number>;
  porAnio: Record<string, number>;
  porDecada: Record<string, number>;
  ms?: number;
}
