/**
 * Tipos de la capa de comprensión (docs/COMPRENSION.md, «Ingesta: el flujo de
 * comprensión»). Como el resto de la ingesta, son pasos puros sobre puertos:
 * el mismo código corre en el Workflow `scholaris-comprension`, en `apps/local`,
 * en las pruebas y en el guion de prueba real sobre una copia local.
 */
import type {
  Embebedor, IndiceVectorial, Lente, PercepcionMedio, SQL, TipoEntidadComprension, TipoSegmento,
} from '@scholaris/nucleo';

// ---------------------------------------------------------------------------
// El modelo de comprensión
// ---------------------------------------------------------------------------

/** Lo que cuesta una llamada (o la suma de varias). */
export interface UsoModelo {
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  usd: number;
  ms: number;
  llamadas: number;
}

export type ParteComprension =
  | { texto: string }
  | { bytes: Uint8Array; mime: string }
  /** Un fichero ya subido a la API de ficheros del proveedor (vídeo, audio largo). */
  | { uri: string; mime: string };

export interface PeticionComprension {
  /** Instrucciones de la lente (estables: van primero para que la caché implícita las aproveche). */
  sistema: string;
  /** Material y tarea, en este orden: lo que se repite entre llamadas va delante. */
  partes: ParteComprension[];
  /** Esquema JSON de la respuesta. */
  esquema: Record<string, unknown>;
  /** «alta»: `MODELOS_GEMINI.comprension`; «rapida»: `MODELOS_GEMINI.comprensionRapida`. */
  calidad: 'alta' | 'rapida';
  maxTokens?: number;
  /** Para la procedencia: qué paso la pide. */
  operacion: string;
}

/**
 * El puerto del modelo de comprensión. La plataforma lo monta sobre Gemini
 * (`modeloComprensionGemini`) y las pruebas con un doble; con un Redactor
 * cualquiera vale `modeloDesdeRedactor` (sin coste medido).
 */
export interface ModeloComprension {
  readonly nombre: string;
  /** El id del modelo que atiende cada calidad (para la procedencia y el coste). */
  modelo(calidad: 'alta' | 'rapida'): string;
  /** Precio en dólares por millón de tokens (entrada, salida), para estimar el gasto antes de empezar. */
  precio?(calidad: 'alta' | 'rapida'): { entrada: number; salida: number } | undefined;
  generar<T>(p: PeticionComprension): Promise<{ json: T; uso: UsoModelo }>;
}

// ---------------------------------------------------------------------------
// Contexto y opciones
// ---------------------------------------------------------------------------

export interface ProgresoComprension {
  documento: string;
  paso: PasoComprension;
  /** 0-1 global. */
  avance: number;
  mensaje: string;
}

export type PasoComprension = 'plan' | 'estructura' | 'fichas' | 'entidades' | 'global' | 'indexado' | 'fin';

export interface ContextoComprension {
  /** La estantería (o una base SPDF con el esquema de las funciones). */
  sql: SQL;
  /** Sin modelo no hay comprensión: el estado queda en «sin_modelo». */
  modelo: ModeloComprension | null;
  /** El embebedor de la capa literal: las fichas van al mismo espacio que los fragmentos. */
  embebedor?: Embebedor;
  indice?: IndiceVectorial | null;
  espacioNombres?: string;
  /** Red para Wikidata (reparto). Sin él, no se consulta. */
  fetch?: typeof fetch;
  /** La percepción completa de un medio (el equipo de percepción la produce). */
  percepcion?(documento: string): Promise<PercepcionMedio | null>;
  alProgreso?(p: ProgresoComprension): Promise<void> | void;
  /** Reloj inyectable (pruebas). */
  ahora?(): Date;
}

export interface OpcionesComprension {
  /** Lentes fijadas a mano (la primera manda en la estructura); sin ellas, se eligen solas. */
  lentes?: Lente[];
  /** Rehacer aunque ya esté hecha con esta versión. */
  forzar?: boolean;
  /** Tope de gasto por documento, en dólares (por defecto 4). */
  presupuestoUsd?: number;
  /** Hasta cuántos caracteres va el documento entero al modelo (por defecto 2 400 000, ~700 000 tokens). */
  maxCaracteresContexto?: number;
  /** Segmentos por llamada al hacer las fichas (por defecto 6). */
  segmentosPorLlamada?: number;
  /** Consultar Wikidata para el reparto (por defecto, sí si hay `fetch`). */
  wikidata?: boolean;
  /** Solo el modelo rápido (modo económico o plan gratuito). */
  economico?: boolean;
  /** Calidad por paso, si se quiere distinta de la de por defecto. */
  calidades?: Partial<PlanComprension['calidades']>;
}

// ---------------------------------------------------------------------------
// Plan y estado
// ---------------------------------------------------------------------------

/** Plazos de cada paso, en segundos, según el tamaño o la duración. */
export interface PlazosComprension {
  estructura: number;
  fichas: number;
  entidades: number;
  global: number;
  indexado: number;
}

/** Lo que decide el primer paso y reciben todos los demás (serializable y pequeño). */
export interface PlanComprension {
  documento: string;
  lentes: Lente[];
  /** «comprension@1 narrativa@1»: si cambia, se rehace. */
  version: string;
  medio: boolean;
  caracteres: number;
  tokensAprox: number;
  /** El documento entero cabe en el contexto del modelo. */
  largo: boolean;
  conPercepcion: boolean;
  plazos: PlazosComprension;
  presupuestoUsd: number;
  estimacionUsd: number;
  economico: boolean;
  /** Calidad del modelo en cada paso (el económico lo pone todo en «rapida»). */
  calidades: Record<'estructura' | 'fichas' | 'entidades' | 'global', 'alta' | 'rapida'>;
  /** Huella del material del que sale. */
  huella: string;
  /** Ya estaba hecha con esta versión: los pasos no hacen nada. */
  hecha: boolean;
  opciones: Pick<OpcionesComprension, 'segmentosPorLlamada' | 'wikidata' | 'maxCaracteresContexto'>;
}

export type EstadoComprensionValor = 'pendiente' | 'en_marcha' | 'hecho' | 'error' | 'sin_modelo';

export interface EstadoComprension {
  documento: string;
  estado: EstadoComprensionValor;
  lentes: Lente[];
  version: string;
  /** Pasos terminados con su coste. */
  pasos: Record<string, { hecho: string; ms: number; usd: number; detalle?: Record<string, number> }>;
  usd: number;
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
  avisos: string[];
  error?: string;
  /** Huella del material (unidades): si la ingesta se rehace, la comprensión también. */
  huella?: string;
  /** Instancia del Workflow que la lleva (para el vigilante). */
  instancia?: string;
  /** Con qué se lanzó (para relanzarla igual). */
  params?: Record<string, unknown>;
  /** Ya se entregó al orquestador (las pendientes sin lanzar esperan su turno en la cola). */
  lanzada?: boolean;
  relanzamientos?: number;
  modelo?: string;
  iniciado: string;
  actualizado: string;
}

// ---------------------------------------------------------------------------
// Lo que devuelve el modelo (antes de anclar)
// ---------------------------------------------------------------------------

/** Una prueba tal como la da el modelo: unidad y cita literal, o un fotograma. */
export interface RefModelo {
  /** Orden de la unidad (el número de «⟦U12 · …⟧»). */
  u?: number;
  /** Cita literal, copiada del material. */
  cita?: string;
  /** Fotograma (el número de «⟦F34 · …⟧»). */
  f?: number;
  /** En medios: el segundo exacto, si lo sabe. */
  t?: number;
  /** Qué afirmación sostiene. */
  apoya?: string;
}

export interface SegmentoModelo {
  id: string;
  padre?: string;
  tipo: TipoSegmento;
  titulo: string;
  resumen?: string;
  desde: { u: number; inicio?: string; t?: number };
  hasta: { u: number; fin?: string; t?: number };
  confianza?: number;
}

export interface EntidadModelo {
  nombre: string;
  tipo: TipoEntidadComprension;
  /** Formas literales con que aparece (nombres, apodos, títulos). */
  formas: string[];
  /** Formas descriptivas que la aluden sin nombrarla («el muchacho», «mi amigo»). */
  alusiones?: string[];
  descripcion?: string;
  ficticia?: boolean;
  importancia?: number;
  /** En el cine: quién la interpreta, si consta en el material. */
  actor?: string;
  /** Análisis breve de su papel en la obra (solo las principales). */
  analisis?: string;
  evidencias?: RefModelo[];
}

/** Una lente: con qué ojos se lee (docs/COMPRENSION.md, «Lentes»). */
export interface DefinicionLente {
  id: Lente;
  /** «narrativa@1»: cambia cuando cambian el prompt o los esquemas. */
  version: string;
  /** Tipos de segmento que busca, de mayor a menor. */
  segmentos: TipoSegmento[];
  /** Tipos de segmento que llevan ficha propia (los demás solo estructuran). */
  conFicha: TipoSegmento[];
  /** Cómo se reconoce cada nivel de la estructura en esta disciplina. */
  guiaEstructura: string;
  /** El especialista: vocabulario, preguntas y cuidado. */
  instrucciones: string;
  /** Esquema JSON de `datos` en la ficha de un segmento. */
  datosSegmento: Record<string, unknown>;
  /** Esquema JSON de `datos` en la ficha global. */
  datosGlobal: Record<string, unknown>;
  /** Qué entidades importan, en orden. */
  entidades: TipoEntidadComprension[];
}
