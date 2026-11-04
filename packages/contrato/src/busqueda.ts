/**
 * Búsqueda.
 *
 *   POST /busqueda              Buscar      → RespuestaBusqueda
 *        con «accept: text/event-stream», en dos tiempos (EventoBusquedaEnDos):
 *        «preliminar» con lo léxico en cuanto lo hay y luego con el orden de la fusión, y
 *        «final» con la RespuestaBusqueda reordenada. Si no hace falta reordenar,
 *        llega solo «final». Los ids de fragmento son los mismos en los dos: la
 *        interfaz pinta el preliminar y recoloca cada tarjeta por su id al llegar
 *        el definitivo (sin vaciar la lista).
 *   POST /busqueda/responder    Responder   → text/event-stream de EventoRespuesta
 *   POST /busqueda/similares    Similares   → RespuestaBusqueda
 *   POST /busqueda/multilingue  BuscarMultilingue → RespuestaMultilingue
 *   POST /busqueda/investigar   Investigar  → text/event-stream de EventoInvestigacion
 *        (el agente de investigación: plan, pasos con herramientas, pruebas,
 *        respuesta larga con citas [E1]… a pruebas materiales, verificación y
 *        memoria en el historial y en un cuaderno; docs/COMPRENSION.md)
 *
 * Los resultados llevan el fragmento con su ancla: la etiqueta («p. 23»,
 * «12:04») es lo que se cita, nunca lo que diga un modelo.
 */

import type { AnclaMaterial, Filtros, ModoEvidencia, Pasaje, Resultado } from '@scholaris/nucleo';
import type { FiguraResultado } from './contenido.js';

export type ModoBusqueda = 'hibrida' | 'lexica' | 'densa' | 'visual';

export type IntencionConsulta = 'conceptual' | 'literal' | 'visual' | 'temporal' | 'factual';

export interface Buscar {
  consulta: string;
  filtros?: Filtros;
  /** Número de resultados (por defecto 20, máximo 100). */
  k?: number;
  modo?: ModoBusqueda;
  reordenar?: boolean;
  /** Explicar por qué sale cada resultado (cuesta una llamada más). */
  explicar?: boolean;
  /** No guardar en el historial. */
  sinHistorial?: boolean;
}

export interface ResultadoVista extends Resultado {
  /** «p. 23», «pp. 23-24», «12:04»: la del pasaje relevante (`pasaje`), no la del fragmento entero. */
  etiqueta: string;
  /** Cita corta del pasaje lista para pegar: «(Darwin, 1859, p. 81)». */
  citaCorta: string;
  miniaturaUrl?: string;
  explicacion?: string;
  /** Si el resultado sale de una figura o de un fotograma (vía visual): cuál, con su imagen y su descripción. */
  figura?: FiguraResultado;
}

export interface RespuestaBusqueda {
  resultados: ResultadoVista[];
  intencion?: IntencionConsulta;
  /** Consulta reescrita/expandida que se usó de verdad. */
  expansion?: string[];
  /** Evento del historial (para fijar, anotar, repetir). */
  evento?: string;
  ms: number;
  /** Milisegundos por fase (comprension, lexica, densa, fusion, hidratacion, reordenacion…), para diagnosticar. */
  tiempos?: Record<string, number>;
}

export interface Responder extends Buscar {
  /** Estilo de la respuesta. */
  formato?: 'breve' | 'extensa' | 'esquema';
  /** Verificar cada cita con el juez antes de darla. */
  verificar?: boolean;
}

/** Eventos SSE de /busqueda en dos tiempos (campo `event` = `tipo`). */
export type EventoBusquedaEnDos =
  /**
   * Puede llegar dos veces, y cada una sustituye a la anterior: primero la vía
   * léxica sola (`via: 'lexica'`, en cuanto la hay) y luego la fusión sin reordenar (`via: 'fusion'`).
   */
  | { tipo: 'preliminar'; resultados: ResultadoVista[]; intencion?: IntencionConsulta; ms: number; via?: 'lexica' | 'fusion' }
  | { tipo: 'final'; respuesta: RespuestaBusqueda }
  | { tipo: 'error'; mensaje: string };

/** Eventos SSE de /busqueda/responder (campo `event` = `tipo`). */
export type EventoRespuesta =
  | { tipo: 'resultados'; resultados: ResultadoVista[]; intencion?: IntencionConsulta }
  | { tipo: 'texto'; delta: string }
  /** Una cita usada en la respuesta: [n] → fragmento. */
  /** `pasaje`: las oraciones del fragmento que sostienen la frase que lleva la nota (con su ancla); la etiqueta y la cita son las suyas. */
  | { tipo: 'cita'; n: number; fragmento: string; documento: string; etiqueta: string; citaCorta: string; respaldo?: number; pasaje?: Pasaje }
  | { tipo: 'fin'; evento?: string; ms: number; confianza?: 'alta' | 'media' | 'baja' }
  | { tipo: 'error'; mensaje: string };

export interface Similares {
  /** Fragmento o documento de partida. */
  fragmento?: string;
  documento?: string;
  filtros?: Filtros;
  k?: number;
}

export interface BuscarMultilingue extends Buscar {
  /** Idiomas a los que traducir la consulta (BCP-47). Por defecto, los de la biblioteca. */
  idiomas?: string[];
}

export interface RespuestaMultilingue extends RespuestaBusqueda {
  traducciones: Array<{ idioma: string; consulta: string }>;
}

// ---------------------------------------------------------------------------
// Investigar: el agente (docs/COMPRENSION.md, «Responder: el modo Investigar»)
// ---------------------------------------------------------------------------

/** Cuánto se investiga: pasos, tiempo y coste crecen de una a otra. */
export type ProfundidadInvestigacion = 'rapida' | 'normal' | 'exhaustiva';

export interface PresupuestoInvestigacion {
  /** Llamadas a herramientas como mucho. */
  pasos: number;
  /** Segundos de reloj para investigar (la redacción y la verificación van aparte, con su propio margen). */
  segundos: number;
  /** Dólares como mucho (estimación por tokens). */
  usd: number;
}

export interface Investigar {
  pregunta: string;
  /** Dónde investigar (documentos, bibliotecas, años, idiomas…). Sin filtros, toda la biblioteca. */
  filtros?: Filtros;
  /** Por defecto, «normal». */
  profundidad?: ProfundidadInvestigacion;
  /** Para bajar el presupuesto de la profundidad (nunca se sube por encima del del plan). */
  presupuesto?: Partial<PresupuestoInvestigacion>;
  /** Idioma de la respuesta (BCP-47); por defecto, el de la pregunta. */
  idioma?: string;
  /** Cuaderno donde dejar las pruebas y la respuesta: un id para seguir uno, `false` para no guardar. Por defecto, uno nuevo. */
  cuaderno?: string | false;
  /** No guardar la pregunta en el historial. */
  sinHistorial?: boolean;
  /** Modelo del agente (para el banco); si no es uno admitido, se usa el de siempre. */
  modelo?: string;
}

/** De qué capa sale una prueba. */
export type CapaEvidencia = 'literal' | 'comprension' | 'percepcion' | 'memoria';

/**
 * Una prueba de la investigación: una `Evidencia` (documento, ancla material, cita,
 * modo) con lo que hace falta para enseñarla y abrirla. El ancla siempre sale de la
 * biblioteca (unidades, fragmentos, figuras, fichas) o de lo que el modelo vio en un
 * tramo real del vídeo o en una página real; nunca del texto del modelo.
 */
export interface EvidenciaInvestigacion {
  /**
   * La marca: «P3» en los eventos «evidencia» (las pruebas según llegan) y «E1», «E2»…
   * en la respuesta final, numeradas por orden de aparición.
   */
  id: string;
  documento: string;
  titulo: string;
  ancla: AnclaMaterial;
  anclaFin?: AnclaMaterial;
  /** La cita literal, en su lengua; si no hay texto, lo que se ve o se oye. */
  cita?: string;
  modo: ModoEvidencia;
  unidad?: string;
  fragmento?: string;
  figura?: string;
  capa: CapaEvidencia;
  /** Herramienta que la trajo (buscar, leer, ver…). */
  herramienta: string;
  /** «p. 14», «1:02:03-1:03:10». */
  etiqueta: string;
  /** «(Paz, 1991/1994, p. 14)». */
  citaCorta: string;
  /** Lengua de la cita (la del documento). */
  idioma?: string;
  /** Traducción a la lengua de la respuesta, si la cita está en otra. */
  traduccion?: string;
  /** Orden de la unidad desde 0, como el resto de la API (en un libro, la página física es `ancla.fisica`). */
  orden?: number;
  /** La imagen entera de la página o del fotograma (no un recorte): la región, si la hay, va en `ancla.region`. */
  imagenUrl?: string;
  /** Para qué sirve en la investigación (lo que muestra). */
  nota?: string;
  /**
   * En la respuesta final: la prueba del cuaderno de la investigación de donde sale
   * («P7», la marca de los eventos «evidencia»), estrechada a la cita si la hay.
   */
  prueba?: string;
}

/** Lo que el agente decide antes de buscar. */
export interface PlanInvestigacion {
  /** Una o dos frases: cómo se va a responder. */
  enfoque: string;
  /** Obras que intervienen y su papel en la pregunta. */
  documentos: Array<{ id: string; titulo: string; papel: string }>;
  subpreguntas: Array<{
    pregunta: string;
    /** Qué pruebas hacen falta. */
    pruebas: Array<'literal' | 'visual' | 'sonora' | 'estructural' | 'comparativa'>;
    documentos?: string[];
  }>;
  /** Lenguas en que hay que buscar. */
  idiomas: string[];
  /** Lengua de la respuesta. */
  idiomaRespuesta: string;
}

/** Un paso del agente: una llamada a una herramienta. */
export interface PasoInvestigacion {
  n: number;
  herramienta: string;
  entrada: Record<string, unknown>;
  /** Lo que devolvió, en una línea. */
  resumen: string;
  ms: number;
  /** Pruebas nuevas que trajo. */
  evidencias: string[];
  error?: string;
}

/** Comprobación de una frase de la respuesta contra sus pruebas. */
export interface FraseVerificada {
  frase: string;
  evidencias: string[];
  /**
   * `respaldada`: las pruebas dicen lo que afirma la frase; `parcial`: solo en parte;
   * `sin_respaldo`: no lo dicen; `sin_prueba`: afirma un hecho sin citar ninguna prueba.
   */
  veredicto: 'respaldada' | 'parcial' | 'sin_respaldo' | 'sin_prueba';
  nota?: string;
  /** Se comprobó volviendo a mirar el vídeo o la página. */
  revisada?: boolean;
}

export interface CosteInvestigacion {
  usd: number;
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
  pasos: number;
  ms: number;
  modelo: string;
}

/** Una obra citada en la respuesta. */
export interface FuenteInvestigacion {
  documento: string;
  titulo: string;
  autores: string;
  anio?: number;
  tipo: string;
  /** Pruebas de esta obra que cita la respuesta. */
  evidencias: string[];
}

/** Eventos SSE de /busqueda/investigar (campo `event` = `tipo`). */
export type EventoInvestigacion =
  | { tipo: 'inicio'; id: string; modelo: string; presupuesto: PresupuestoInvestigacion }
  | { tipo: 'plan'; plan: PlanInvestigacion }
  | ({ tipo: 'paso' } & PasoInvestigacion)
  | { tipo: 'evidencia'; evidencia: EvidenciaInvestigacion }
  /**
   * La respuesta mientras se escribe (Markdown con marcas [E1]). La definitiva es la de «fin».
   * `marcas`: las marcas nuevas de este trozo y la prueba de donde salen ({ E3: 'P7' }).
   * `reinicio`: la redacción anterior falló (vacía o cortada) y se vuelve a escribir: lo
   * recibido hasta aquí se descarta.
   */
  | { tipo: 'texto'; delta: string; marcas?: Record<string, string>; reinicio?: boolean }
  | { tipo: 'verificacion'; frases: FraseVerificada[]; respaldadas: number; total: number }
  | {
    tipo: 'fin';
    /** La respuesta definitiva en Markdown: marcas [E1]… y, al final, la lista de pruebas. */
    markdown: string;
    /** Las pruebas citadas, en el orden de sus marcas (E1, E2…). */
    evidencias: EvidenciaInvestigacion[];
    fuentes: FuenteInvestigacion[];
    /** Cuaderno donde quedaron las pruebas y la respuesta. */
    cuaderno?: string;
    /** Entrada del historial. */
    evento?: string;
    confianza: 'alta' | 'media' | 'baja';
    coste: CosteInvestigacion;
    avisos: string[];
    ms: number;
  }
  | { tipo: 'error'; mensaje: string };
