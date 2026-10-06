/**
 * Subidas e ingesta.
 *
 * Camino normal (el navegador es la imprenta):
 *   1. POST /subidas  NuevaSubida → SubidaCreada
 *      Devuelve el id del documento, la subida directa del original (a R2 o al
 *      disco, prefirmada o firmada por la API) y el prefijo de sus recursos.
 *   2. Si `original.modo === 'partes'`:
 *        POST /subidas/:id/partes     { numeros: [1,2,…] } → UrlsPartes
 *        PUT  <url de cada parte>  (guardar la cabecera ETag de la respuesta)
 *        POST /subidas/:id/completar  { partes: [{ numero, etag }] } → Ok
 *      Si es 'simple': PUT <url> con el cuerpo y las `cabeceras` indicadas.
 *   3. El navegador convierte (imprenta) y pide URLs para los derivados:
 *        POST /subidas/:id/recursos   PedirRecursos → RecursosFirmados
 *      y los sube con PUT.
 *   4. POST /subidas/:id/ingestar  { manifiesto } → IngestaIniciada
 *      Lanza el Workflow; el progreso llega por /tiempo-real.
 *
 * Reserva sin navegador (SDK, API, importaciones masivas):
 *   4'. POST /subidas/:id/ingestar  {}  → el servidor convierte.
 *   POST /subidas/url  SubidaUrl → IngestaIniciada  (páginas web, YouTube, PDF por URL)
 *
 * Subida firmada por la API (cuando no hay credenciales S3 o en local):
 *   PUT /subidas/directa?clave=…&exp=…&sig=…[&parte=…&idSubida=…]
 *
 *   DELETE /subidas/:id → Ok  (cancela y borra lo subido)
 */

import type { Ancla, MetadatosDocumento, SubidaDirecta, TipoEntrada } from '@scholaris/nucleo';

export interface NuevaSubida {
  nombre: string;
  mime: string;
  bytes: number;
  /** SHA-256 del original, si el navegador ya lo calculó: detecta duplicados antes de subir. */
  huella?: string;
  /** Tipo de entrada si ya se sabe (el navegador lo deduce); si no, se deduce del MIME. */
  tipo?: TipoEntrada;
  /** Bibliotecas a las que añadir el documento al terminar. */
  bibliotecas?: string[];
  /** Metadatos que el usuario ya conoce (título, autores…). */
  metadatos?: Partial<MetadatosDocumento>;
}

export interface SubidaCreada {
  subida: string;
  documento: string;
  tipo: TipoEntrada;
  original: SubidaDirecta;
  /** Prefijo de los recursos derivados en el almacén: «u/<usuario>/d/<documento>/». */
  prefijo: string;
  /** Si ya existe un documento con la misma huella, su id (no hace falta subir). */
  duplicado?: string;
}

export interface PedirPartes {
  numeros: number[];
}

export interface UrlsPartes {
  partes: Array<{ numero: number; url: string; cabeceras?: Record<string, string> }>;
}

export interface CompletarSubida {
  partes: Array<{ numero: number; etag: string }>;
}

export interface PedirRecursos {
  /** Rutas relativas al prefijo: «paginas/0001.jpg», «miniaturas/0001.webp», «audio.opus». */
  recursos: Array<{ ruta: string; mime: string; bytes?: number }>;
}

export interface RecursosFirmados {
  recursos: Array<{ ruta: string; clave: string; subida: SubidaDirecta }>;
}

/**
 * Lo que entrega la imprenta del navegador: el original ya subido y sus
 * derivados (imágenes de página, capa de texto, fotogramas, audio extraído).
 * Las rutas son relativas al prefijo de la subida.
 */
export interface ManifiestoConversion {
  version: 1;
  tipo: TipoEntrada;
  original: { nombre: string; mime: string; bytes: number; huella: string };
  /** Metadatos que salen del propio fichero (info del PDF, OPF del EPUB, etiquetas ID3). */
  metadatos?: Partial<MetadatosDocumento>;
  /** Duración en segundos (audio y vídeo). */
  duracion?: number;
  unidades: UnidadManifiesto[];
  /** Índice embebido (marcadores del PDF, NCX/nav del EPUB). */
  secciones?: Array<{ nivel: number; titulo: string; unidad: number }>;
  /** Audio extraído en el navegador (vídeo) o troceado (audio largo). */
  audio?: Array<{ ruta: string; mime: string; t0: number; t1: number }>;
  /** Fotogramas clave del vídeo. */
  fotogramas?: Array<{ ruta: string; t: number; miniatura?: string }>;
  /** Imágenes incrustadas que el navegador ya separó. */
  figuras?: Array<{ unidad: number; ruta: string; region?: { x: number; y: number; w: number; h: number } }>;
  portada?: string;
  /** Avisos de la conversión que la interfaz puede enseñar. */
  avisos?: string[];
  /** Qué imprenta y con qué versión. */
  generador?: string;
}

export interface UnidadManifiesto {
  /** Orden desde 1. */
  orden: number;
  ancla: Ancla;
  /** Texto ya extraído (capa de texto del PDF, DOCX, EPUB…). */
  texto?: string;
  /** El texto viene de una capa fiable: no hace falta visión salvo para el folio. */
  textoFiable?: boolean;
  /** Imagen de la unidad (página rasterizada, diapositiva). */
  imagen?: string;
  miniatura?: string;
  ancho?: number;
  alto?: number;
  /** Cabecera y pie si la imprenta los separó (ayuda al folio). */
  cabecera?: string;
  pie?: string;
}

export interface Ingestar {
  /** Sin manifiesto, el servidor convierte (reserva). */
  manifiesto?: ManifiestoConversion;
  /** Fuerza la lectura por visión aunque haya capa de texto. */
  forzarVision?: boolean;
  /** Pista para el lector: idioma, «manuscrito», «tabla»… */
  pista?: string;
}

export interface SubidaUrl {
  url: string;
  /** web | video | audio | pdf: si no se da, se deduce. */
  tipo?: TipoEntrada;
  bibliotecas?: string[];
  metadatos?: Partial<MetadatosDocumento>;
}

export interface IngestaIniciada {
  documento: string;
  tarea: string;
}
