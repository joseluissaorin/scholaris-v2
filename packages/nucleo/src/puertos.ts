/**
 * Los puertos de Scholaris.
 *
 * Regla de oro: ningún módulo de dominio habla con un proveedor ni con una
 * plataforma. Todo pasa por estas interfaces. `@scholaris/proveedores` trae las
 * implementaciones por API (Gemini, Workers AI, OpenRouter, Jev) y las locales
 * (InferBox, opcional); `apps/api` monta las de Cloudflare y `apps/local` las de
 * Node. La versión local no es un puerto: es la misma aplicación.
 */

import type { EspacioVectorial, Modalidad } from './dominio.js';

// ---------------------------------------------------------------------------
// Almacén de objetos (R2 / disco)
// ---------------------------------------------------------------------------

export interface ObjetoAlmacen {
  clave: string;
  bytes: number;
  tipo?: string;
}

export interface Almacen {
  poner(clave: string, cuerpo: ReadableStream | ArrayBuffer | Uint8Array | string, tipo?: string): Promise<void>;
  obtener(clave: string): Promise<{ cuerpo: ReadableStream; meta: ObjetoAlmacen } | null>;
  bytes(clave: string): Promise<Uint8Array | null>;
  /** Lectura parcial (para servir medios con Range y leer trozos de un PDF). */
  rango(clave: string, desde: number, hasta: number): Promise<Uint8Array | null>;
  existe(clave: string): Promise<boolean>;
  borrar(clave: string): Promise<void>;
  borrarPrefijo(prefijo: string): Promise<number>;
  /** URL de subida directa del navegador (prefirmada o firmada por la propia API). */
  subidaDirecta(clave: string, opciones: { tipo?: string; bytes?: number; partes?: boolean }): Promise<SubidaDirecta>;
}

export interface SubidaDirecta {
  modo: 'simple' | 'partes';
  clave: string;
  url?: string;
  idSubida?: string;
  tamParte?: number;
  cabeceras?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// SQL (Durable Object SQLite, D1, better-sqlite3)
// ---------------------------------------------------------------------------

export type ValorSQL = string | number | null | ArrayBuffer | Uint8Array;

/** Interfaz mínima común a `ctx.storage.sql`, D1 y better-sqlite3. Síncrona o no, siempre se espera. */
export interface SQL {
  ejecutar<T = Record<string, ValorSQL>>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]>;
  /** Ejecuta varias sentencias en una transacción. */
  transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Índice vectorial (Vectorize / sqlite-vec)
// ---------------------------------------------------------------------------

export interface EntradaIndice {
  id: string;
  valores: Float32Array | number[];
  /** Metadatos filtrables: documento, tipo, anio, idioma, objetivo, bibliotecas… */
  metadatos: Record<string, string | number | boolean>;
}

export interface CoincidenciaIndice {
  id: string;
  puntuacion: number;
  metadatos?: Record<string, string | number | boolean>;
}

export interface IndiceVectorial {
  readonly espacio: EspacioVectorial;
  insertar(espacioNombres: string, entradas: EntradaIndice[]): Promise<void>;
  consultar(
    espacioNombres: string,
    vector: Float32Array | number[],
    opciones: { k: number; filtro?: Record<string, unknown>; conMetadatos?: boolean },
  ): Promise<CoincidenciaIndice[]>;
  borrar(espacioNombres: string, ids: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Inteligencia: todo lo que llega por API (o por InferBox, sin conexión)
// ---------------------------------------------------------------------------

/** Una pieza a vectorizar. Los binarios van en bytes con su MIME. */
export type PiezaEmbebible =
  | { modalidad: 'texto'; texto: string }
  | { modalidad: 'imagen'; bytes: Uint8Array; mime: string }
  | { modalidad: 'audio'; bytes: Uint8Array; mime: string }
  | { modalidad: 'video'; bytes: Uint8Array; mime: string }
  | { modalidad: 'pdf'; bytes: Uint8Array };

export interface Embebedor {
  readonly espacio: EspacioVectorial;
  admite(modalidad: Modalidad): boolean;
  /** `tarea` permite a los modelos que lo soportan distinguir documento y consulta. */
  vectorizar(piezas: PiezaEmbebible[], tarea: 'documento' | 'consulta'): Promise<Float32Array[]>;
}

/** Lo que devuelve la lectura de una página (o de una imagen). */
export interface PaginaLeida {
  /** Índice físico absoluto, desde 1 (primeraFisica + posición en el pliego). */
  fisica: number;
  /** Qué lector la leyó al final (la cascada lo rellena). */
  lector?: string;
  /** Cuerpo en Markdown ligero (títulos con #, cursivas, listas), sin cabecera ni pie. */
  texto: string;
  /** Notas al pie, separadas. */
  notas: string[];
  /** Texto de la cabecera y del pie de página tal como se ve. */
  cabecera: string;
  pie: string;
  /** Folio impreso que el lector cree ver, si lo ve. */
  folio: string | null;
  /** Títulos de sección que empiezan en esta página. */
  titulos: Array<{ nivel: number; texto: string }>;
  /** Figuras: pie y región normalizada. */
  figuras: Array<{ pie?: string; descripcion?: string; region?: { x: number; y: number; w: number; h: number } }>;
  /** La página no tiene contenido (en blanco, guarda, lámina sin texto). */
  vacia: boolean;
  idioma?: string;
  confianza: number;
}

export interface Lector {
  readonly nombre: string;
  /**
   * Lector de un servidor propio (una GPU o una CPU, un inquilino): las páginas
   * esperan en su cola, así que la ingesta no le pone plazo por llamada ni
   * lanza llamadas de cobertura, que solo duplicarían la cola.
   */
  readonly local?: boolean;
  /**
   * Lee un pliego: varias páginas a la vez, como PDF o como imágenes. Leer por
   * pliegos es lo que hace la ingesta rápida: una llamada, muchas páginas.
   */
  leerPliego(entrada: { pdf?: Uint8Array; imagenes?: Array<{ bytes: Uint8Array; mime: string }>; primeraFisica: number; pista?: string }): Promise<PaginaLeida[]>;
}

export interface PalabraTranscrita {
  texto: string;
  t0: number;
  t1: number;
  hablante?: string;
}

export interface Transcripcion {
  idioma?: string;
  palabras: PalabraTranscrita[];
  texto: string;
}

export interface Transcriptor {
  readonly nombre: string;
  transcribir(audio: { bytes: Uint8Array; mime: string; desplazamiento?: number }, opciones?: { idioma?: string; hablantes?: boolean; pista?: string }): Promise<Transcripcion>;
}

export interface Reordenador {
  readonly nombre: string;
  /** Devuelve una puntuación por documento, en el mismo orden. */
  reordenar(consulta: string, textos: string[]): Promise<number[]>;
}

/** Preguntas tipadas con respuesta probabilística (Jev, clef, o un LLM local). */
export type PreguntaJuez =
  | { tipo: 'si_no'; instrucciones: string; criterios: { si: string; no: string } }
  | { tipo: 'eleccion'; instrucciones: string; opciones: Record<string, string | null> }
  | { tipo: 'escala'; instrucciones: string; niveles: string[] };

export type RespuestaJuez =
  | { tipo: 'si_no'; probabilidad: number }
  | { tipo: 'eleccion'; probabilidades: Record<string, number>; eleccion: string }
  | { tipo: 'escala'; valor: number; probabilidades: number[] };

export interface Juez {
  readonly nombre: string;
  juzgar(estado: unknown, preguntas: Record<string, PreguntaJuez>): Promise<Record<string, RespuestaJuez>>;
}

/** Un LLM que devuelve JSON con un esquema. */
export interface Redactor {
  readonly nombre: string;
  generar<T>(peticion: {
    sistema?: string;
    mensajes: Array<{ rol: 'usuario' | 'modelo'; partes: Array<{ texto: string } | { bytes: Uint8Array; mime: string }> }>;
    esquema?: Record<string, unknown>;
    temperatura?: number;
    maxTokens?: number;
    calidad?: 'rapida' | 'alta';
  }): Promise<{ texto: string; json?: T }>;
}

// ---------------------------------------------------------------------------
// Tiempo real y tareas
// ---------------------------------------------------------------------------

export interface Emisor<T> {
  emitir(canal: string, evento: T): Promise<void>;
}

export interface Cola<T> {
  encolar(mensaje: T, opciones?: { retraso?: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// El conjunto: lo que recibe cada módulo de dominio
// ---------------------------------------------------------------------------

export interface Inteligencia {
  lector: Lector;
  /** Lectores de reserva, en orden, por si el primero falla. */
  lectoresReserva?: Lector[];
  embebedor: Embebedor;
  /** Espacios adicionales que también se calculan (p. ej. InferBox sin conexión). */
  embebedoresExtra?: Embebedor[];
  transcriptor: Transcriptor;
  reordenador: Reordenador;
  juez: Juez;
  redactor: Redactor;
  /** Contador de uso y coste, si el montaje lo lleva. */
  contador?: { total(): { usd: number; llamadas: number } } | unknown;
}
