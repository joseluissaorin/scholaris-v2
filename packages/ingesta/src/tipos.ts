/**
 * Tipos de la ingesta.
 *
 * La ingesta es una cadena de PASOS PUROS sobre puertos: cada paso recibe datos
 * serializables (y, si necesita binarios, una `FuentePaquete` que los trae del
 * almacén o de memoria) y devuelve un resultado serializable de menos de 1 MiB
 * con su `procedencia`. Así el mismo código corre como paso de un Workflow de
 * Cloudflare, como cola local en Node y en el banco de pruebas.
 */

import type { PaqueteConversion } from '@scholaris/imprenta';
import type {
  Ancla,
  AnclaPagina,
  EspacioVectorial,
  FaseIngesta,
  Inteligencia,
  Lector,
  MetadatosDocumento,
  PaginaLeida,
  Progreso,
  SQL,
  EntradaIndice,
  TipoEntrada,
} from '@scholaris/nucleo';

// ---------------------------------------------------------------------------
// Entrada: el paquete de la imprenta y sus binarios
// ---------------------------------------------------------------------------

export type { PaqueteConversion };

export interface Binario {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Trae los binarios del paquete por su id de parte («paginas/0001.jpg»): de
 * memoria (Node, banco) o de R2 (Workflow).
 */
export interface FuentePaquete {
  parte(id: string): Promise<Binario | null>;
  /** Un PDF con las páginas físicas [desde, hasta], para leer por pliegos. */
  subPdf?(desde: number, hasta: number): Promise<Uint8Array | null>;
  /** Recorte de una región normalizada de una imagen (figuras). */
  recorte?(parte: string, region: { x: number; y: number; w: number; h: number }): Promise<Binario | null>;
}

export interface TramoPlan {
  n: number;
  t0: number;
  t1: number;
  propioDesde: number;
  propioHasta: number;
  parte: string;
}

export interface FotogramaPlan {
  t: number;
  parte: string;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type ViaLectura = 'capa' | 'vision';

export interface Pliego {
  id: number;
  desde: number;
  hasta: number;
  /** Cómo se manda: sub-PDF (más barato y limpio) o imágenes sueltas. */
  envio: 'pdf' | 'imagenes';
  motivo: 'sin_capa' | 'capa_mala' | 'capa_ocr' | 'maquetacion' | 'todo_vision' | 'fotos';
  /** Modo económico: páginas fáciles (lector barato) o difíciles (API por lotes). */
  dificultad?: 'facil' | 'dificil';
}

/**
 * Una tanda de la tubería: un trozo del documento que se lee y se vuelve
 * buscable por su cuenta (un pliego de visión, un lote de páginas con capa de
 * texto, un tramo de audio, todos los bloques de un DOCX).
 */
export interface Tanda {
  id: number;
  clase: 'pliego' | 'capa' | 'tramo' | 'bloques';
  /** Unidades físicas [desde, hasta] (páginas desde 1); en medios, el número de tramo. */
  desde: number;
  hasta: number;
  /** Id del pliego (clase 'pliego') o número de tramo (clase 'tramo'). */
  pliego?: number;
  tramo?: number;
}

export interface Plan {
  modo: 'paginas' | 'medio' | 'bloques';
  /** Las tandas de la tubería, en el orden en que conviene procesarlas (lo barato primero). */
  tandas: Tanda[];
  tipo: TipoEntrada;
  unidades: number;
  /** Vía de lectura de cada página física (índice = fisica - 1). */
  vias: ViaLectura[];
  pliegos: Pliego[];
  tramos: TramoPlan[];
  fotogramas: FotogramaPlan[];
  /** Páginas cuya imagen se vectoriza (vía visual): física y parte. */
  paginasImagen: Array<{ fisica: number; parte: string }>;
  concurrencia: number;
  notas: string[];
}

export interface OpcionesPlan {
  /** Páginas por pliego de visión. */
  paginasPorPliego?: number;
  /**
   * Qué hacer con las páginas digitales: 'capa' usa la capa de texto; 'vision'
   * las manda también al lector (Markdown más limpio, notas separadas); 'auto'
   * decide por la calidad de la capa.
   */
  digital?: 'capa' | 'vision' | 'auto';
  concurrencia?: number;
  /** Vectorizar la imagen de cada página. */
  vectorPorPagina?: boolean;
  /**
   * Qué páginas llevan vector de imagen: 'todas'; 'utiles' (escaneadas, fotos,
   * diapositivas y páginas con figuras; no las digitales de solo texto, cuyo
   * vector repite lo que ya dice el texto); 'ninguna'. Por defecto 'utiles'.
   */
  vistaPaginas?: 'todas' | 'utiles' | 'ninguna';
  /** Páginas por tanda de capa de texto. */
  paginasPorTandaCapa?: number;
  /**
   * 'rapido' (por defecto): todo en línea, cuanto antes. 'economico': API por
   * lotes (mitad de precio, entrega en horas), lector barato para las páginas
   * fáciles y la capa de OCR buena se aprovecha en vez de releerla.
   */
  modo?: 'rapido' | 'economico';
}

// ---------------------------------------------------------------------------
// Resultados de los pasos
// ---------------------------------------------------------------------------

/** Registro de lo que hizo un paso: auditable y con su coste. */
export interface Procedencia {
  fase: FaseIngesta;
  proveedor?: string;
  ms: number;
  detalle?: Record<string, unknown>;
}

/** Una unidad citable ya leída (página, tramo, sección). Serializable. */
export interface UnidadLeida {
  orden: number;
  /** Página física (páginas) o índice de tramo (medios). */
  fisica: number;
  texto: string;
  notas: string[];
  cabecera: string;
  pie: string;
  /** Folio impreso que vio el lector o la capa. */
  folioVisto: string | null;
  /** Etiqueta de página del PDF o del EPUB. */
  etiqueta?: string | null;
  titulos: Array<{ nivel: number; texto: string }>;
  figuras: Array<{ pie?: string; descripcion?: string; region?: { x: number; y: number; w: number; h: number } }>;
  vacia: boolean;
  idioma?: string;
  lector: string;
  confianza: number;
  /** Medios. */
  t0?: number;
  t1?: number;
  hablante?: string;
  /** Medios: el instante exacto de cada palabra del texto (sin las marcas «**Nombre:**»). */
  palabras?: import('@scholaris/spdf').PalabrasTiempo;
  /** Ancla definitiva (la pone el paso de folios o el de medios). */
  ancla?: Ancla;
}

export interface ResultadoLectura {
  unidades: UnidadLeida[];
  procedencia: Procedencia[];
  avisos: string[];
}

export interface Seccion {
  id: string;
  padre: string | null;
  nivel: number;
  titulo: string;
  /** Unidad (orden) y párrafo dentro de ella donde empieza. */
  desde: { unidad: number; parrafo: number };
  /** Última unidad (orden) que abarca. */
  hasta: number;
}

export interface FragmentoPlano {
  id: string;
  orden: number;
  /** Orden de la unidad donde empieza. */
  unidad: number;
  unidadFin?: number;
  texto: string;
  contexto: string;
  seccion: string[];
  seccionId: string | null;
  ancla: Ancla;
  anclaFin?: Ancla;
  tokens: number;
}

export interface FiguraPlana {
  id: string;
  unidad: number;
  fisica: number;
  pie?: string;
  descripcion?: string;
  region?: { x: number; y: number; w: number; h: number };
  /** Clave del recorte en el almacén, si se hizo. */
  imagen?: string;
}

// ---------------------------------------------------------------------------
// Puertos que recibe la ingesta
// ---------------------------------------------------------------------------

/** Acceso HTTP (Crossref, OpenAlex). Por defecto, `fetch` global. */
export type Http = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * La API por lotes de un proveedor (Gemini Batch: mitad de precio, entrega en
 * horas). Se mandan muchas lecturas de golpe y se recogen después.
 */
export interface LotesLectura {
  readonly nombre: string;
  enviar(peticiones: Array<{ clave: string; entrada: { pdf?: Uint8Array; imagenes?: Array<{ bytes: Uint8Array; mime: string }>; primeraFisica: number; pista?: string } }>): Promise<string>;
  consultar(id: string): Promise<{ estado: 'pendiente' | 'listo' | 'error'; resultados?: Record<string, PaginaLeida[]>; error?: string }>;
}

export interface PuertosIngesta {
  inteligencia: Inteligencia;
  /** Modo económico: lector barato para las páginas fáciles (Workers AI, si hay credenciales). */
  lectorEconomico?: Lector;
  /** Modo económico: API por lotes para las páginas difíciles. */
  lotes?: LotesLectura;
  fuente: FuentePaquete;
  /** Base SQLite con el esquema v4 aplicado (el SPDF o la estantería). */
  sql?: SQL;
  /** Índice vectorial (Vectorize) por espacio; opcional. */
  indice?: { insertar(espacio: EspacioVectorial, entradas: EntradaIndice[]): Promise<void>; borrar?(espacio: EspacioVectorial, ids: string[]): Promise<void> };
  /** Guarda binarios derivados (miniaturas, recortes de figuras). */
  guardarBlob?(clave: string, datos: Binario): Promise<void>;
  http?: Http;
  /** Correo para el «polite pool» de Crossref y OpenAlex. */
  correoContacto?: string;
  reloj?: () => number;
}

export interface OpcionesIngesta extends OpcionesPlan {
  tarea?: string;
  onProgreso?: (p: Progreso) => void;
  /** Saltar la verificación externa de metadatos (sin red). */
  sinVerificacion?: boolean;
  /** Sin línea de contexto (para medir su efecto). */
  sinContexto?: boolean;
  /** Metadatos que da el usuario: mandan sobre todo lo demás. */
  metadatosUsuario?: Partial<MetadatosDocumento>;
}

export type { AnclaPagina };
