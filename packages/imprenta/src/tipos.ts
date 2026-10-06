/**
 * El contrato de la imprenta: lo que sale de convertir un archivo.
 *
 * La imprenta corre en el navegador del usuario (dentro de un Web Worker, con
 * OffscreenCanvas) y, con la misma API, en Node (banco de pruebas, versión local,
 * reserva del servidor). Convierte cualquier entrada en un `PaqueteConversion`:
 *
 *   - un MANIFIESTO JSON (este tipo), serializable tal cual con `JSON.stringify`;
 *   - una lista de PARTES binarias (JPEG de páginas, miniaturas, tramos de audio,
 *     fotogramas…), cada una con un `id` que es también su ruta relativa de subida
 *     («paginas/0001.jpg»). El manifiesto solo las nombra; los bytes viajan aparte.
 *
 * Todo es progresivo: `convertir()` es un iterador asíncrono que emite cada
 * página, tramo o fotograma en cuanto está listo (`EventoConversion`), de modo que
 * la subida y la ingesta pueden empezar con la página 1 mientras la 300 aún se
 * rasteriza. El evento `fin` trae el manifiesto completo.
 *
 * Coordenadas: siempre normalizadas 0-1, origen arriba a la izquierda, sobre la
 * página tal como se ve (con la rotación ya aplicada).
 */

import type { MetadatosDocumento, TipoEntrada } from '@scholaris/nucleo';

export const VERSION_PAQUETE = 1 as const;

// ---------------------------------------------------------------------------
// Utilidades comunes
// ---------------------------------------------------------------------------

/** Región normalizada 0-1 (origen arriba a la izquierda). Igual que en `AnclaImagen`. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ClaseParte =
  | 'pagina'        // imagen de una página (PDF, foto, imagen suelta)
  | 'miniatura'     // miniatura de una página o fotograma
  | 'figura'        // recorte de una figura dentro de una página
  | 'audio'         // un tramo de audio listo para transcribir
  | 'fotograma'     // fotograma clave de un vídeo
  | 'recurso';      // imagen incrustada en un DOCX/EPUB, etc.

/**
 * Una parte binaria del paquete. `id` es único dentro del paquete y sirve de
 * ruta relativa en el almacén: la ingesta la sube a `<prefijo>/<id>`.
 */
export interface ParteBinaria {
  id: string;
  clase: ClaseParte;
  mime: string;
  bytes: number;
  /** Página física, número de foto o de diapositiva (desde 1), si aplica. */
  unidad?: number;
  /** Tramo temporal en segundos (audio, fotogramas). */
  t0?: number;
  t1?: number;
  /** Dimensiones en píxeles (imágenes). */
  ancho?: number;
  alto?: number;
}

/** Algo que hay que hacer en el servidor porque el navegador no puede. */
export interface ReservaServidor {
  motivo: string;
  /** Qué falta: 'imagenes_diapositivas', 'decodificar_audio', 'fotogramas', 'heic', 'web', 'conversion_completa'… */
  tareas: string[];
}

/** Metadatos encontrados durante la conversión (sin consultar a nadie). */
export interface MetadatosIncrustados extends Partial<MetadatosDocumento> {
  /** Fechas crudas del archivo (ISO cuando se pueden interpretar). */
  creado?: string;
  modificado?: string;
  /** Programa que lo produjo (Producer / Creator / generator). */
  productor?: string;
  creador?: string;
  palabrasClave?: string[];
  /** DOI hallado en el texto de las primeras páginas (no en la ficha). */
  doiEnTexto?: string;
  /** Identificadores crudos (EPUB dc:identifier, ISBN…). */
  identificadores?: string[];
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Una línea de la capa de texto. */
export interface LineaTexto {
  texto: string;
  /** Caja de la línea, normalizada. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cuerpo de letra en puntos (mediana de la línea). */
  tam: number;
  /** Bloque al que pertenece (índice en `PaginaPdf.bloques`). -1 si va en cabecera o pie. */
  bloque: number;
}

/** Un bloque (párrafo o columna de líneas contiguas) de la capa de texto. */
export interface BloqueCapa {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Índices de sus líneas en `PaginaPdf.lineas`. */
  lineas: number[];
  /** Texto del bloque, líneas unidas (con guiones de corte resueltos). */
  texto: string;
  /** Cuerpo de letra medio: sirve para detectar títulos y notas. */
  tam: number;
}

/** Un número que podría ser el folio impreso, hallado en cabecera o pie. */
export interface CandidatoFolio {
  texto: string;
  zona: 'cabecera' | 'pie';
  /** Posición horizontal: izquierda, centro o derecha de la página. */
  lado: 'izquierda' | 'centro' | 'derecha';
  /** Es un número romano. */
  romano: boolean;
  /** Valor numérico (arábigo o romano). */
  valor: number | null;
  region: Region;
}

/** Cómo es la capa de texto de una página. */
export interface DiagnosticoTexto {
  /** El texto sirve para leer y citar sin pasar por visión. */
  util: boolean;
  /** 0-1: calidad estimada de la capa (1 = texto nacido digital limpio). */
  calidad: number;
  /** De dónde parece venir el texto. */
  origen: 'digital' | 'ocr' | 'ninguno';
  caracteres: number;
  /** Proporción de caracteres sospechosos (U+FFFD, uso privado, control, símbolos sueltos). */
  basura: number;
  /** Proporción de «palabras» que no parecen palabras. */
  palabrasRaras: number;
  /** Fracción del área de la página cubierta por imágenes (≥ 0,85 = página escaneada). */
  coberturaImagen: number;
}

export interface PaginaPdf {
  /** Índice físico, desde 1. */
  fisica: number;
  /** Tamaño en puntos tal como se ve (con la rotación aplicada). */
  ancho: number;
  alto: number;
  rotacion: number;
  /** Etiqueta de /PageLabels («xiv», «23», «A-3»): el folio impreso gratis, si el PDF lo trae. */
  etiqueta: string | null;
  /** Clasificación de ESTA página: hay documentos mixtos. */
  clase: 'pdf' | 'pdf_escaneado';
  texto: DiagnosticoTexto;
  /** Texto del cuerpo (sin cabecera ni pie), bloques separados por línea en blanco. */
  cuerpo: string;
  /** Líneas de todo la página, en orden de lectura. */
  lineas: LineaTexto[];
  bloques: BloqueCapa[];
  /** Líneas en el 8 % superior e inferior (zonas de folio y titulillo). */
  cabecera: LineaTexto[];
  pie: LineaTexto[];
  candidatosFolio: CandidatoFolio[];
  /** Imágenes incrustadas visibles en la página (regiones normalizadas). */
  imagenes: Array<Region & { parte?: string }>;
  /** Partes: imagen de la página para visión y miniatura. */
  imagen?: string;
  miniatura?: string;
  /** Milisegundos que costó esta página. */
  ms: number;
}

export interface EntradaEsquema {
  titulo: string;
  /** 1 = primer nivel. */
  nivel: number;
  /** Página física de destino (desde 1), si se pudo resolver. */
  fisica: number | null;
  /** Para EPUB/DOCX: índice del bloque donde empieza. */
  bloque?: number;
  /** Para EPUB: href del capítulo. */
  href?: string;
}

export interface ContenidoPdf {
  clase: 'pdf';
  paginas: PaginaPdf[];
  /** Marcadores del PDF (/Outlines): las secciones, gratis. */
  esquema: EntradaEsquema[];
  /** /PageLabels completo (una entrada por página física), o null si no hay. */
  etiquetas: Array<string | null> | null;
  /** Hay páginas de las dos clases. */
  mixto: boolean;
  paginasEscaneadas: number[];
  /** Titulillos repetidos (texto sin números) detectados en cabecera y pie. */
  titulillos: { cabecera: string[]; pie: string[] };
  /** Diccionario Info crudo y XMP (clave → valor). */
  info: Record<string, string>;
  xmp: Record<string, string> | null;
  version?: string;
  cifrado: boolean;
}

// ---------------------------------------------------------------------------
// Fotos e imagen suelta
// ---------------------------------------------------------------------------

export interface PaginaImagen {
  /** Orden físico (desde 1), tras ordenar por nombre con criterio numérico. */
  fisica: number;
  nombre: string;
  /** Dimensiones originales (ya orientadas) y finales. */
  anchoOriginal: number;
  altoOriginal: number;
  ancho: number;
  alto: number;
  /** Orientación EXIF leída (1-8) y si se corrigió. */
  orientacionExif: number;
  /** Región recortada (bordes vacíos), normalizada sobre la original orientada. */
  recorte?: Region;
  imagen: string;
  miniatura: string;
}

export interface ContenidoImagenes {
  clase: 'imagenes';
  paginas: PaginaImagen[];
}

// ---------------------------------------------------------------------------
// Audio y vídeo
// ---------------------------------------------------------------------------

export interface TramoAudio {
  n: number;
  /** Segundos del tramo completo (incluido el solape del principio). */
  t0: number;
  t1: number;
  /** Parte del tramo que le es propia (sin solape): para deduplicar al unir. */
  propioDesde: number;
  propioHasta: number;
  parte: string;
}

export interface Fotograma {
  t: number;
  motivo: 'escena' | 'periodico' | 'inicio';
  /** Diferencia con el fotograma anterior elegido (0-1). */
  diferencia: number;
  parte: string;
  miniatura?: string;
}

export interface ContenidoMedio {
  clase: 'medio';
  duracion: number;
  audio: {
    muestreo: number;   // 16000
    canales: number;    // 1
    formato: 'opus' | 'wav';
    mime: string;
    tramos: TramoAudio[];
  } | null;
  video: {
    ancho: number;
    alto: number;
    codec?: string;
    fotogramas: Fotograma[];
  } | null;
}

// ---------------------------------------------------------------------------
// Documentos de texto (DOCX, ODT, RTF, HTML, Markdown, TXT, EPUB)
// ---------------------------------------------------------------------------

export type TipoBloque = 'titulo' | 'parrafo' | 'lista' | 'cita' | 'tabla' | 'codigo' | 'nota' | 'imagen';

export interface BloqueTexto {
  tipo: TipoBloque;
  /** Nivel del título (1-6). */
  nivel?: number;
  /** Markdown ligero (cursivas, negritas, enlaces; tablas en Markdown). */
  texto: string;
  /** Ruta de títulos vigente: ["Capítulo 3", "3.2 El panóptico"]. */
  ruta: string[];
  /** Número de párrafo dentro de la sección (desde 1), como en `AnclaSeccion`. */
  parrafo: number;
  /** Folio impreso equivalente (EPUB con pagebreak / page-list). */
  impresa?: string | null;
  /** Identificadores de las notas a las que remite el bloque. */
  notas?: string[];
  /** EPUB: documento del lomo (spine) del que viene. */
  capitulo?: string;
  /** Parte binaria si es una imagen. */
  parte?: string;
}

export interface NotaTexto {
  id: string;
  texto: string;
  /** Índice del bloque que la llama, si se sabe. */
  bloque?: number;
}

export interface ContenidoDocumento {
  clase: 'documento';
  formato: 'docx' | 'odt' | 'rtf' | 'html' | 'markdown' | 'txt' | 'epub';
  bloques: BloqueTexto[];
  notas: NotaTexto[];
  /** Índice (títulos del documento, o nav/NCX en EPUB). */
  esquema: EntradaEsquema[];
  /** EPUB: lista de páginas del libro impreso (page-list / pagebreak) → bloque. */
  paginasImpresas: Array<{ etiqueta: string; bloque: number }>;
  /** EPUB: orden del lomo. */
  lomo?: Array<{ href: string; titulo?: string; desde: number }>;
}

// ---------------------------------------------------------------------------
// Presentaciones y hojas
// ---------------------------------------------------------------------------

export interface Diapositiva {
  n: number;
  titulo: string;
  /** Texto de la diapositiva (Markdown ligero, viñetas como lista). */
  texto: string;
  /** Notas del orador. */
  notas: string;
  /** Imagen de la diapositiva: no se puede en el navegador; la pone el servidor. */
  imagen?: string;
}

export interface ContenidoPresentacion {
  clase: 'presentacion';
  diapositivas: Diapositiva[];
}

export interface TramoHoja {
  filaDesde: number;   // 1-based, como en `AnclaHoja`
  filaHasta: number;
  /** Tabla Markdown con la fila de cabecera repetida. */
  markdown: string;
}

export interface Hoja {
  nombre: string;
  filas: number;
  columnas: number;
  cabecera: string[];
  tramos: TramoHoja[];
}

export interface ContenidoHoja {
  clase: 'hoja';
  hojas: Hoja[];
}

// ---------------------------------------------------------------------------
// Web (solo el tipo: la descarga la hace el servidor, por CORS)
// ---------------------------------------------------------------------------

export interface ContenidoWeb {
  clase: 'web';
  url: string;
  /** Fecha de consulta ISO. */
  consultada: string;
  /** Copia fechada guardada (HTML) en el almacén. */
  copia?: string;
  /** Artículo extraído, en bloques como un documento. */
  bloques: BloqueTexto[];
  esquema: EntradaEsquema[];
}

export type Contenido =
  | ContenidoPdf
  | ContenidoImagenes
  | ContenidoMedio
  | ContenidoDocumento
  | ContenidoPresentacion
  | ContenidoHoja
  | ContenidoWeb;

// ---------------------------------------------------------------------------
// El paquete
// ---------------------------------------------------------------------------

export interface OrigenArchivo {
  nombre: string;
  mime: string;
  bytes: number;
  /** SHA-256 del original (hex). */
  huella: string;
}

export interface PaqueteConversion {
  version: typeof VERSION_PAQUETE;
  tipo: TipoEntrada;
  origen: OrigenArchivo;
  /** Varios archivos (fotos de un libro): uno por página, en orden. */
  origenes?: OrigenArchivo[];
  metadatos: MetadatosIncrustados;
  /** Páginas físicas, diapositivas, hojas, bloques… según el tipo. */
  unidades: number;
  /** Segundos (audio y vídeo). */
  duracion?: number;
  contenido: Contenido;
  /** Todas las partes binarias, en el orden en que se produjeron. */
  partes: ParteBinaria[];
  reserva: ReservaServidor | null;
  avisos: string[];
  /** Dónde se convirtió y cuánto costó (ms por fase). */
  entorno: 'navegador' | 'node';
  tiempos: Record<string, number>;
}

// ---------------------------------------------------------------------------
// La API progresiva
// ---------------------------------------------------------------------------

export type FaseConversion = 'analisis' | 'paginas' | 'audio' | 'fotogramas' | 'texto' | 'cierre';

export type EventoConversion =
  /** Lo primero que sale: qué es y cuánto hay. */
  | { tipo: 'inicio'; entrada: TipoEntrada; origen: OrigenArchivo; unidades: number | null; duracion?: number; metadatos: MetadatosIncrustados }
  | { tipo: 'progreso'; fase: FaseConversion; hechas: number; total: number | null; mensaje?: string }
  /** Una parte binaria lista para subir. Llega SIEMPRE antes que la pieza que la nombra. */
  | { tipo: 'parte'; parte: ParteBinaria; datos: Uint8Array }
  /** Una página de PDF lista (texto + imagen): la ingesta puede leerla ya. */
  | { tipo: 'pagina_pdf'; pagina: PaginaPdf }
  | { tipo: 'pagina_imagen'; pagina: PaginaImagen }
  | { tipo: 'tramo_audio'; tramo: TramoAudio }
  | { tipo: 'fotograma'; fotograma: Fotograma }
  | { tipo: 'aviso'; mensaje: string }
  /** El manifiesto completo. Último evento. */
  | { tipo: 'fin'; paquete: PaqueteConversion };

/** Un archivo de entrada, sea cual sea la plataforma. */
export interface ArchivoEntrada {
  nombre: string;
  mime?: string;
  /** Bytes completos (lo habitual), o un lector perezoso. */
  bytes: Uint8Array;
}

export interface OpcionesConversion {
  /** Forzar el tipo (si no, se detecta por firma, MIME y extensión). */
  tipo?: TipoEntrada;
  /** Varias fotos de un libro: se ordenan por nombre (criterio numérico). */
  fotos?: ArchivoEntrada[];

  // PDF
  /** Lado largo de la imagen de página escaneada (px). Por defecto 1600. */
  ladoEscaneada?: number;
  /** Lado largo de la imagen de página digital (px). Por defecto 1200: solo se usa para folio y figuras. 0 = no rasterizar. */
  ladoDigital?: number;
  /** Calidad JPEG 0-1. Por defecto 0,8. */
  calidadJpeg?: number;
  /** Lado largo de la miniatura. Por defecto 240. 0 = sin miniatura. */
  ladoMiniatura?: number;
  /** Rasterizadores en paralelo (Web Workers o worker_threads). Por defecto: núcleos − 1, máx. 8. 0 = en el mismo hilo. */
  hilos?: number;
  /** Recortar las figuras incrustadas como partes propias. Por defecto false. */
  recortarFiguras?: boolean;
  /** Solo estas páginas físicas (pruebas). */
  paginas?: number[];

  // Medios
  /** Duración de cada tramo de audio en segundos. Por defecto 600. */
  tramo?: number;
  /** Solape entre tramos en segundos. Por defecto 2. */
  solape?: number;
  /** Formato de los tramos. Por defecto 'opus' (si la plataforma lo sabe hacer). */
  formatoAudio?: 'opus' | 'wav';
  /** Un fotograma periódico cada N s como mínimo si no hay cambios de escena. Por defecto 20 (nunca menos de 10). */
  intervaloFotogramas?: number;
  /** Umbral de cambio de escena (0-1). Por defecto 0,18. */
  umbralEscena?: number;
  /** Lado largo de los fotogramas. Por defecto 960. */
  ladoFotograma?: number;

  // Hojas
  /** Filas por tramo de hoja. Por defecto 50. */
  filasPorTramo?: number;

  /** Cancelación. */
  senal?: AbortSignal;
}

/** Un paquete con sus bytes, ya recogido entero (para pruebas y para la reserva del servidor). */
export interface PaqueteEnMemoria {
  paquete: PaqueteConversion;
  datos: Map<string, Uint8Array>;
}
