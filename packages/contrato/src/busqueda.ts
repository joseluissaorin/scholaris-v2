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
 *
 * Los resultados llevan el fragmento con su ancla: la etiqueta («p. 23»,
 * «12:04») es lo que se cita, nunca lo que diga un modelo.
 */

import type { Filtros, Resultado } from '@scholaris/nucleo';
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
  /** «p. 23», «pp. 23-24», «12:04». */
  etiqueta: string;
  /** Cita corta lista para pegar: «(Foucault, 1975, p. 23)». */
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
  | { tipo: 'cita'; n: number; fragmento: string; documento: string; etiqueta: string; citaCorta: string; respaldo?: number }
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
