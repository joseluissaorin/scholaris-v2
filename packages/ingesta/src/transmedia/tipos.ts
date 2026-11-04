/**
 * Tipos de la capa transmedia y transidioma (docs/COMPRENSION.md, «Relaciones y
 * alineaciones» y «Transidioma»): qué obras de la biblioteca se relacionan entre
 * sí (una película y el cuento que adapta, un original y su traducción, dos
 * ediciones) y qué tramo de una corresponde a qué tramo de la otra.
 *
 * Como la comprensión, son pasos puros sobre puertos: los mismos en el Workflow
 * `scholaris-comprension`, en `apps/local`, en las pruebas y en el guion local.
 */
import type { Evidencia, FuenteRelacion, TipoCorrespondencia, TipoRelacion } from '@scholaris/nucleo';

/** Versión del método (detección, alineación y ficha de relación). Si cambia, las alineaciones se rehacen. */
export const VERSION_TRANSMEDIA = 'transmedia@1';

/** De dónde sale cada indicio de una relación. */
export type OrigenSenal = 'metadatos' | 'contenido' | 'wikidata' | 'citas' | 'entidades' | 'fichas' | 'modelo';

/** Un indicio de que dos documentos se relacionan, con su peso y su prueba. */
export interface SenalRelacion {
  origen: OrigenSenal;
  /** Qué relación sugiere (si sugiere alguna en concreto). */
  tipo?: TipoRelacion;
  /** Sentido: «a» (el primero adapta, traduce o cita al segundo), «b» (al revés) o sin sentido. */
  sentido?: 'a' | 'b';
  /** Fuerza del indicio, 0-1. */
  peso: number;
  /** Qué se ha visto, en una frase legible. */
  descripcion: string;
  evidencias?: Evidencia[];
}

/** Una relación propuesta entre dos documentos, antes de guardarla. */
export interface CandidataRelacion {
  origen: string;
  destino: string;
  tipo: TipoRelacion;
  confianza: number;
  fuente: FuenteRelacion;
  nota: string;
  evidencias: Evidencia[];
  senales: SenalRelacion[];
}

export interface OpcionesDeteccion {
  /** Consultar Wikidata (por defecto, sí si hay `fetch`). */
  wikidata?: boolean;
  /** Pedir al modelo que decida los casos dudosos (por defecto, sí si hay modelo). */
  modelo?: boolean;
  /** Confianza mínima para guardar una relación (por defecto 0,5). */
  umbral?: number;
  /** Solo con estos documentos (por defecto, toda la biblioteca). */
  con?: string[];
}

export interface OpcionesAlineacion {
  /** Rehacer aunque ya esté hecha con la misma huella. */
  forzar?: boolean;
  /** Tope de gasto por relación, en dólares (por defecto 4). */
  presupuestoUsd?: number;
  /** Calidad del modelo en la alineación fina (por defecto «alta»). */
  calidad?: 'alta' | 'rapida';
  /** Llamadas al modelo a la vez (por defecto 4). */
  concurrencia?: number;
  /** Hasta cuántos caracteres van las dos obras enteras en cada llamada (por defecto 1 200 000). */
  maxCaracteres?: number;
  /** Calidad del modelo en la ficha de la relación (por defecto «alta»: es un ensayo, y el rápido inventa más). */
  calidadFicha?: 'alta' | 'rapida';
  /** Escribir también la ficha de la relación (por defecto, sí). */
  ficha?: boolean;
  /** Quién lleva la alineación (para el cerrojo; por defecto, uno al azar). */
  instancia?: string;
}

/** Lo que devuelve el modelo como prueba en una alineación: unidad y cita, o un tramo de tiempo. */
export interface LadoModelo {
  u?: number;
  cita?: string;
  /** Si el pasaje es largo: dónde acaba (unidad y cita literal del final). */
  u_fin?: number;
  cita_fin?: string;
  /** En los medios, cuando no hay diálogo que citar: el tramo y lo que se ve o se oye. */
  t0?: number;
  t1?: number;
  t?: number;
  que?: string;
}

export interface AlineacionModelo {
  tipo: TipoCorrespondencia;
  a?: LadoModelo;
  b?: LadoModelo;
  nota: string;
  confianza?: number;
}

/** Una correspondencia gruesa: segmentos de una obra frente a segmentos de la otra. */
export interface CorrespondenciaGruesa {
  a: string[];
  b: string[];
  tipo: TipoCorrespondencia;
  nota: string;
  confianza: number;
}

/** Estado de la alineación de una relación (en la procedencia del documento de origen). */
export interface EstadoAlineacion {
  relacion: string;
  estado: 'en_marcha' | 'hecho' | 'error';
  version: string;
  huella: string;
  instancia: string;
  alineaciones: number;
  gruesas: number;
  descartadas: number;
  usd: number;
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
  modelo?: string;
  avisos: string[];
  error?: string;
  iniciado: string;
  actualizado: string;
}

/** Lo que deja un paso transmedia (para el Workflow y la interfaz). */
export interface ResultadoTransmedia {
  relaciones: number;
  nuevas: number;
  /** Relaciones que quedan por alinear (las dos obras comprendidas, sin alineación vigente). */
  porAlinear: string[];
  avisos: string[];
}
