import type { AnclaPagina, PaginaLeida } from '@scholaris/nucleo';

/**
 * Lo que necesita el cálculo de folios de cada página física. Es un
 * subconjunto de `PaginaLeida`: se le puede pasar tal cual lo que devuelve el lector.
 */
export type PaginaFolio = Pick<PaginaLeida, 'fisica'> &
  Partial<Pick<PaginaLeida, 'cabecera' | 'pie' | 'folio' | 'texto' | 'vacia' | 'confianza' | 'titulos' | 'figuras'>> & {
    /**
     * Etiqueta de página del PDF (/PageLabels), si la trae: «xiv», «23», «dj A»,
     * «Cover». Las del editor mandan cuando cuadran con lo que se ve; las que no
     * son números (sobrecubierta, cubierta) dejan la página sin folio.
     */
    etiqueta?: string | null;
  };

/** Cómo se reparten las páginas del libro en las páginas físicas. */
export type Disposicion =
  | 'simple'     // una página del libro por página física
  | 'doble'      // dos páginas del libro por página física (escaneo a doble página)
  | 'doble_rtl'; // ídem, de derecha a izquierda

/** De dónde sale un número candidato. */
export type FuenteCandidato =
  | 'lector'        // el lector dijo «el folio es este»
  | 'pie'
  | 'cabecera'
  | 'texto-inicio'  // primeras líneas del cuerpo (lectores que no separan la cabecera)
  | 'texto-fin'     // últimas líneas del cuerpo
  | 'juez';         // lo eligió el juez

export interface Candidato {
  /** Valor numérico (los romanos, en positivo). */
  valor: number;
  romana: boolean;
  /** Romano en mayúsculas («XIV»). */
  mayusculas: boolean;
  /** Texto tal como se vio («l23», «— 23 —», «p. 23»). */
  texto: string;
  fuente: FuenteCandidato;
  /** Fiabilidad a priori 0-1, según la fuente y la forma. */
  peso: number;
  /** Se corrigió un error típico de OCR (l→1, O→0). */
  corregido: boolean;
  /** En una doble página, el número de la derecha. */
  derecha?: number;
  /** Foliación: «23r», «23v». */
  lado?: 'r' | 'v';
}

/**
 * Qué es cada página física. Sin folio: `portada` (antes de la numeración),
 * `cubierta` (tapas, sobrecubierta, solapas), `guarda` (blancas tras la última
 * página con contenido) y `lamina` (sin numerar ni contar dentro del cuerpo).
 */
export type TipoPagina = 'portada' | 'cubierta' | 'preliminar' | 'cuerpo' | 'final' | 'lamina' | 'guarda';

/** El folio de una página: un `AnclaPagina` con lo que explica cómo se obtuvo. */
export interface FolioPagina extends AnclaPagina {
  tipoPagina: TipoPagina;
  /** Candidatos que vio el código en la página. */
  candidatos: Candidato[];
  /** El candidato que se tomó como lectura, si lo hubo. */
  elegido?: Candidato;
  /** En doble página: los dos folios [izquierda, derecha]. */
  impresas?: [string, string];
}

export interface ResultadoFolios {
  paginas: FolioPagina[];
  /** Cómo se obtuvo la numeración en conjunto. */
  estrategia: 'leido' | 'deducido' | 'ninguno';
  disposicion: Disposicion;
  /** El libro está foliado (un número por hoja, solo en el recto). */
  foliacion: boolean;
  /** Página física donde empieza la numeración arábiga tras los preliminares. */
  transicion: number | null;
  /** Primera página física que lleva (o cuenta para) número. */
  primeraNumerada: number;
  /** De dónde sale la numeración: la secuencia de lecturas o las etiquetas del PDF. */
  fuente: 'secuencia' | 'etiquetas';
  /** Lecturas usadas como anclas tras el filtrado de consistencia. */
  anclas: number;
  /** Preguntas al juez y llamadas hechas (debería ser una sola). */
  juez: { llamadas: number; preguntas: number };
  avisos: string[];
}
