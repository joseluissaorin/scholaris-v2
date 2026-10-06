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
 *   4. Sube el PaqueteConversion como recurso «paquete.json» y
 *      POST /subidas/:id/ingestar  { paquete: 'paquete.json' } → IngestaIniciada
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

import type { MetadatosDocumento, SubidaDirecta, TipoEntrada } from '@scholaris/nucleo';
import type { PaqueteConversion } from '@scholaris/imprenta';

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
 * Lo que entrega la imprenta del navegador es un `PaqueteConversion` de
 * `@scholaris/imprenta` (JSON serializable; las partes binarias viajan aparte,
 * subidas con /recursos bajo `<prefijo>/<parte.id>`). Aquí se le da el nombre
 * del contrato.
 */
export type ManifiestoConversion = PaqueteConversion;

export interface Ingestar {
  /**
   * Ruta (relativa al prefijo) del paquete JSON ya subido con /recursos, p. ej.
   * «paquete.json». Es lo recomendable: un libro de 600 páginas con su capa de
   * texto pesa varios MB.
   */
  paquete?: string;
  /** El paquete en línea (solo para paquetes pequeños, < 1 MB). */
  manifiesto?: ManifiestoConversion;
  /** Sin paquete ni manifiesto, el servidor convierte (reserva). */
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
