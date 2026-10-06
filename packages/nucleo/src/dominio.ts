/**
 * El dominio de Scholaris: lo que es un documento, una unidad citable, un
 * fragmento y un vector, independientemente de dónde se guarde o quién lo calcule.
 *
 * Regla de oro: TODO fragmento sabe exactamente de dónde viene (su `Ancla`).
 * Una cita solo puede imprimir lo que dice un ancla; nunca lo que diga un modelo.
 */

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export type TipoEntrada =
  | 'pdf'            // PDF con capa de texto
  | 'pdf_escaneado'  // PDF sin texto útil: se lee con visión
  | 'fotos'          // varias fotos de un libro, una por página
  | 'imagen'         // una imagen suelta: captura, manuscrito, pizarra, lámina
  | 'audio'
  | 'video'
  | 'documento'      // DOCX, ODT, RTF, HTML, Markdown, TXT
  | 'epub'
  | 'presentacion'   // PPTX, Keynote
  | 'hoja'           // XLSX, CSV, ODS
  | 'web';           // una URL

// ---------------------------------------------------------------------------
// Anclas: a qué apunta una cita
// ---------------------------------------------------------------------------

/** Página de un libro o artículo. `impresa` es el folio que se ve en el papel. */
export interface AnclaPagina {
  tipo: 'pagina';
  /** Índice físico, empezando en 1 (página del PDF o número de foto). */
  fisica: number;
  /** Folio impreso tal como aparece («23», «xiv», «A-3»). null si la página no lleva número. */
  impresa: string | null;
  /** El folio es romano (preliminares). */
  romana: boolean;
  /** Cómo se obtuvo el folio. */
  origen: 'leido' | 'deducido' | 'epub' | 'ninguno';
  /** Confianza 0-1 del folio. */
  confianza: number;
}

export interface AnclaTiempo {
  tipo: 'tiempo';
  /** Segundos desde el inicio. */
  t0: number;
  t1: number;
  hablante?: string;
}

export interface AnclaSeccion {
  tipo: 'seccion';
  /** Ruta de títulos: ["Capítulo 3", "3.2 El panóptico"]. */
  ruta: string[];
  parrafo: number;
  /** En EPUB con lista de páginas del libro impreso, el folio equivalente. */
  impresa?: string | null;
}

export interface AnclaDiapositiva {
  tipo: 'diapositiva';
  n: number;
}

export interface AnclaHoja {
  tipo: 'hoja';
  hoja: string;
  filaDesde: number;
  filaHasta: number;
}

export interface AnclaWeb {
  tipo: 'web';
  url: string;
  ruta: string[];
  parrafo: number;
  /** Fecha de consulta ISO: la copia fechada se guarda en el almacén. */
  consultada: string;
}

export interface AnclaImagen {
  tipo: 'imagen';
  /** Región normalizada 0-1 dentro de la imagen, si aplica. */
  region?: { x: number; y: number; w: number; h: number };
}

export type Ancla =
  | AnclaPagina
  | AnclaTiempo
  | AnclaSeccion
  | AnclaDiapositiva
  | AnclaHoja
  | AnclaWeb
  | AnclaImagen;

// ---------------------------------------------------------------------------
// Documento y sus partes
// ---------------------------------------------------------------------------

export interface Autor {
  nombre: string;       // «Michel»
  apellidos: string;    // «Foucault»
  orcid?: string;
}

export interface MetadatosDocumento {
  titulo: string;
  subtitulo?: string;
  autores: Autor[];
  editores?: Autor[];
  anio?: number;
  /** Año de la edición original, si difiere (clave para la lógica temporal). */
  anioOriginal?: number;
  editorial?: string;
  lugar?: string;
  revista?: string;
  volumen?: string;
  numero?: string;
  paginas?: string;
  doi?: string;
  isbn?: string;
  url?: string;
  idioma?: string;            // BCP-47: «es», «la», «fr»
  tipoCSL?: string;           // «book», «article-journal», «chapter», «interview»…
  resumen?: string;
  /** Confianza 0-1 por campo, y de dónde salió cada uno. */
  procedencia?: Record<string, { fuente: 'lectura' | 'crossref' | 'openalex' | 'usuario' | 'epub' | 'pdf'; confianza: number }>;
}

export type EstadoDocumento = 'pendiente' | 'procesando' | 'listo' | 'error';

export interface Documento {
  id: string;
  tipo: TipoEntrada;
  metadatos: MetadatosDocumento;
  estado: EstadoDocumento;
  /** SHA-256 del original. */
  huella: string;
  /** Clave del original en el almacén. */
  original: string;
  mime: string;
  bytes: number;
  /** Páginas físicas, diapositivas, hojas… según el tipo. */
  unidades: number;
  /** Duración en segundos (audio y vídeo). */
  duracion?: number;
  creado: string;
  actualizado: string;
  bibliotecas: string[];
}

/** Una unidad citable: una página, un tramo de tiempo, una diapositiva, una sección. */
export interface Unidad {
  id: string;
  documento: string;
  orden: number;
  ancla: Ancla;
  /** Texto completo de la unidad (Markdown ligero). */
  texto: string;
  /** Notas al pie separadas del cuerpo. */
  notas?: string[];
  /** Clave en el almacén de la imagen de la unidad (página, fotograma, diapositiva). */
  imagen?: string;
  /** Miniatura. */
  miniatura?: string;
  /** Qué lector produjo el texto y con qué confianza. */
  lector: string;
  confianza: number;
}

/** Un trozo citable de texto, con su contexto y su ancla. */
export interface Fragmento {
  id: string;
  documento: string;
  unidad: string;
  orden: number;
  texto: string;
  /** Línea que sitúa el fragmento en la obra (recuperación contextual). */
  contexto: string;
  /** Ruta de títulos de la sección. */
  seccion: string[];
  ancla: Ancla;
  /** Fragmento que cruza dos unidades: la cita imprime el rango. */
  anclaFin?: Ancla;
}

export interface Figura {
  id: string;
  documento: string;
  unidad: string;
  imagen: string;
  pie?: string;
  descripcion?: string;
  ancla: Ancla;
}

// ---------------------------------------------------------------------------
// Vectores
// ---------------------------------------------------------------------------

export type Modalidad = 'texto' | 'imagen' | 'audio' | 'video' | 'pdf';

/** Un espacio vectorial: quién produjo los vectores y cómo compararlos. */
export interface EspacioVectorial {
  id: string;               // «gemini-embedding-2@1536»
  proveedor: string;        // «google», «inferbox», «jina»
  modelo: string;           // «gemini-embedding-2»
  version?: string;
  dims: number;
  normalizado: boolean;
  modalidades: Modalidad[];
}

export type ObjetivoVector = 'fragmento' | 'unidad' | 'figura';

export interface Vector {
  objetivo: ObjetivoVector;
  id: string;
  espacio: string;
  valores: Float32Array;
}

// ---------------------------------------------------------------------------
// Búsqueda y citas
// ---------------------------------------------------------------------------

export interface Filtros {
  bibliotecas?: string[];
  documentos?: string[];
  tipos?: TipoEntrada[];
  autores?: string[];
  anioDesde?: number;
  anioHasta?: number;
  idiomas?: string[];
}

export interface Resultado {
  fragmento: Fragmento;
  documento: Pick<Documento, 'id' | 'tipo' | 'metadatos'>;
  puntuacion: number;
  /** De qué vía salió: léxica, densa, visual. */
  vias: Array<'lexica' | 'densa' | 'visual'>;
  /** Fragmento con las coincidencias resaltadas. */
  resaltado?: string;
}

export type RelacionCita =
  | 'APOYO_DIRECTO'
  | 'APLICACION_DE_MARCO'
  | 'CONTEXTO'
  | 'CONTRIBUCION_PROPIA'
  | 'IMPOSIBLE_TEMPORAL'
  | 'CONTRADICCION'
  | 'OPINION_REFERIDA'
  | 'AFIRMACION_NEGATIVA';

export interface CitaVerificada {
  fragmento: string;
  documento: string;
  ancla: Ancla;
  anclaFin?: Ancla;
  relacion: RelacionCita;
  /** Probabilidad 0-1 de que el pasaje respalde la afirmación (juez). */
  respaldo: number;
  /** Texto del pasaje citado, literal. */
  pasaje: string;
}

// ---------------------------------------------------------------------------
// Progreso de una ingesta
// ---------------------------------------------------------------------------

export type FaseIngesta =
  | 'subida'
  | 'conversion'
  | 'lectura'
  | 'folios'
  | 'metadatos'
  | 'estructura'
  | 'contexto'
  | 'vectores'
  | 'figuras'
  | 'indexado'
  | 'listo';

export interface Progreso {
  tarea: string;
  documento: string;
  fase: FaseIngesta;
  /** 0-1 dentro de la fase. */
  avance: number;
  /** 0-1 global. */
  total: number;
  mensaje?: string;
  /** Unidades ya leídas: permite que la interfaz enseñe páginas mientras se procesa. */
  unidadesListas?: number;
  error?: string;
  /** Milisegundos desde el inicio. */
  transcurrido: number;
}
