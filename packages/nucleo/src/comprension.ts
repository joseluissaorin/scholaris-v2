/**
 * La capa de comprensión (docs/COMPRENSION.md): estructura, fichas, entidades,
 * menciones, relaciones entre obras, alineaciones y memoria. Todo derivado,
 * versionado y anclado al sitio material exacto de donde sale.
 */
import type { Ancla } from './dominio.js';

// ---------------------------------------------------------------------------
// Anclaje material
// ---------------------------------------------------------------------------

/** Región normalizada (fracciones 0-1) de la imagen de la unidad: página, fotograma, diapositiva. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Un ancla de siempre con la precisión que permita el soporte (SPDF 5.0 §3: `chars`, `region`).
 * - `caracteres`: [inicio, fin) en puntos de código NFC del texto de la unidad.
 * - `region`: dónde está en la imagen de la unidad.
 * - `instante`: en vídeo, el segundo del fotograma al que se refiere la región.
 */
export type AnclaMaterial = Ancla & {
  caracteres?: [number, number];
  region?: Region;
  instante?: number;
};

export type ModoEvidencia = 'texto' | 'imagen' | 'video' | 'audio' | 'dato';

/** Una prueba concreta: el sitio exacto del material y lo que dice, muestra o suena. */
export interface Evidencia {
  documento: string;
  ancla: AnclaMaterial;
  anclaFin?: AnclaMaterial;
  /** La cita literal; si no hay texto (una imagen, un sonido), lo que se ve o se oye. */
  cita?: string;
  modo: ModoEvidencia;
  unidad?: string;
  fragmento?: string;
  figura?: string;
}

// ---------------------------------------------------------------------------
// Lentes
// ---------------------------------------------------------------------------

/** Con qué ojos de especialista se analiza un documento (docs/COMPRENSION.md, «Lentes»). */
export type Lente =
  | 'narrativa'
  | 'poesia'
  | 'teatro'
  | 'cine'
  | 'documental'
  | 'periodismo'
  | 'entrevista'
  | 'podcast'
  | 'clase'
  | 'ensayo'
  | 'cientifico'
  | 'archivo'
  | 'juridico'
  | 'datos'
  | 'presentacion'
  | 'general';

export const LENTES: readonly Lente[] = [
  'narrativa', 'poesia', 'teatro', 'cine', 'documental', 'periodismo', 'entrevista', 'podcast',
  'clase', 'ensayo', 'cientifico', 'archivo', 'juridico', 'datos', 'presentacion', 'general',
];

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

export type TipoSegmento =
  | 'obra'
  | 'parte'
  | 'capitulo'
  | 'apartado'
  | 'secuencia'
  | 'escena'
  | 'plano'
  | 'acto'
  | 'cuadro'
  | 'poema'
  | 'estrofa'
  | 'tema'
  | 'bloque'
  | 'intervencion'
  | 'diapositiva'
  | 'tabla'
  | 'folio'
  | 'articulo'
  | 'otro';

/** Una parte del documento en el árbol de su estructura. */
export interface Segmento {
  id: string;
  documento: string;
  padre: string | null;
  nivel: number;
  /** Orden de lectura dentro del documento (en todo el árbol, en preorden). */
  orden: number;
  tipo: TipoSegmento;
  titulo: string;
  ancla: AnclaMaterial;
  anclaFin?: AnclaMaterial;
  unidadDesde: string;
  unidadHasta: string;
  /** Una línea: qué es, para índices y capítulos. */
  resumen?: string;
  /** `leido`: del índice del propio documento; `deducido`: de la maqueta; `modelo`: lo propuso el modelo. */
  origen: 'leido' | 'deducido' | 'modelo';
  confianza: number;
}

// ---------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------

export type ObjetivoFicha = 'documento' | 'segmento' | 'entidad' | 'figura' | 'relacion';

/** El análisis de algo (el documento entero, una escena, un personaje, una relación entre obras). */
export interface Ficha {
  id: string;
  /** null en las fichas de una entidad o de una relación entre obras, que son de la biblioteca. */
  documento: string | null;
  objetivo: ObjetivoFicha;
  objetivoId: string;
  lente: Lente;
  /** Qué clase de ficha: «global», «escena», «capitulo», «plano», «personaje», «argumento»… */
  clase: string;
  idioma: string;
  /** Prosa analítica: lo que se busca y se lee. */
  texto: string;
  /** Campos estructurados según la lente. */
  datos: Record<string, unknown>;
  evidencias: Evidencia[];
  modelo: string;
  /** Versión del prompt y del esquema de la lente que la produjo. */
  version: string;
  creada: string;
}

// ---------------------------------------------------------------------------
// Entidades y menciones
// ---------------------------------------------------------------------------

export type TipoEntidad =
  | 'persona'
  | 'personaje'
  | 'lugar'
  | 'obra'
  | 'organizacion'
  | 'concepto'
  | 'evento'
  | 'objeto'
  | 'motivo'
  | 'tema'
  | 'obra_musical'
  | 'fecha';

/** Algo de lo que hablan los documentos, uno para toda la biblioteca. */
export interface Entidad {
  id: string;
  tipo: TipoEntidad;
  nombre: string;
  /** Otras formas, en cualquier lengua. */
  alias: string[];
  /** Nombre por idioma (BCP 47 → nombre). */
  etiquetas?: Record<string, string>;
  /** Wikidata. */
  qid?: string;
  descripcion?: string;
  /** Según el tipo: un personaje lleva `interpretadoPor` (QID o nombre); un evento, `ordenHistoria`. */
  datos?: Record<string, unknown>;
}

export type RolMencion =
  | 'nombrado'
  | 'aludido'
  | 'presente'
  | 'habla'
  | 'visible'
  | 'audible'
  | 'citado'
  | 'definido'
  | 'otro';

/** Una aparición de una entidad en un documento. */
export interface Mencion {
  id: string;
  entidad: string;
  documento: string;
  segmento?: string;
  ancla: AnclaMaterial;
  anclaFin?: AnclaMaterial;
  /** Cómo aparece: «Diego», «el maricón», una silueta en el plano. */
  forma: string;
  rol: RolMencion;
  confianza: number;
}

// ---------------------------------------------------------------------------
// Relaciones entre obras y alineaciones
// ---------------------------------------------------------------------------

export type TipoRelacion =
  | 'adaptacion_de'
  | 'traduccion_de'
  | 'edicion_de'
  | 'version_de'
  | 'cita_a'
  | 'comenta_a'
  | 'responde_a'
  | 'parte_de'
  | 'misma_obra'
  | 'relacionado';

export type FuenteRelacion = 'metadatos' | 'wikidata' | 'modelo' | 'usuario';

/** Dos documentos (o dos entidades, con el prefijo «ent:») unidos. `origen` adapta, traduce, edita o cita a `destino`. */
export interface Relacion {
  id: string;
  origen: string;
  destino: string;
  tipo: TipoRelacion;
  nota?: string;
  evidencias: Evidencia[];
  confianza: number;
  fuente: FuenteRelacion;
  creada: string;
}

export type TipoCorrespondencia =
  | 'equivalente'
  | 'traducido'
  | 'condensado'
  | 'ampliado'
  | 'transformado'
  | 'reordenado'
  | 'anadido'
  | 'suprimido'
  | 'alusion';

/** Un lado de una alineación: un tramo de un documento. */
export interface LadoAlineacion {
  documento: string;
  ancla: AnclaMaterial;
  anclaFin?: AnclaMaterial;
  segmento?: string;
}

/** Una correspondencia fina dentro de una relación. Un lado vacío: algo añadido o suprimido. */
export interface Alineacion {
  id: string;
  relacion: string;
  /** Orden en el lado del origen (o del destino, si el origen está vacío). */
  orden: number;
  tipo: TipoCorrespondencia;
  a?: LadoAlineacion;
  b?: LadoAlineacion;
  /** En qué cambia y con qué efecto. */
  nota: string;
  confianza: number;
}

// ---------------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------------

export type TipoRecuerdo = 'pregunta' | 'respuesta' | 'hallazgo' | 'nota' | 'hipotesis' | 'decision' | 'preferencia';

/** Lo que se ha investigado, para no perderlo. */
export interface Recuerdo {
  id: string;
  tipo: TipoRecuerdo;
  texto: string;
  evidencias: Evidencia[];
  documentos: string[];
  /** La biblioteca (proyecto) en que se hizo, si la hay. */
  proyecto?: string;
  fuente: 'investigar' | 'usuario' | 'sistema';
  creado: string;
  fijado?: boolean;
  /** Recuerdo del que cuelga (una respuesta, de su pregunta). */
  padre?: string;
}

/** Objetivos de un vector además de los de la capa literal. */
export type ObjetivoVectorComprension = 'ficha' | 'entidad' | 'recuerdo';
