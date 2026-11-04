/**
 * Tipos del banco de comprensión (docs/COMPRENSION.md, «Banco»): preguntas con
 * rúbrica anclada, respuestas normalizadas de cualquier modo (responder,
 * investigar) y juicios.
 */
import type { Ancla } from '@scholaris/nucleo';

// ---------------------------------------------------------------------------
// Preguntas y rúbricas
// ---------------------------------------------------------------------------

export type Categoria =
  | 'transmedia'
  | 'cine'
  | 'sonido'
  | 'estructura'
  | 'personajes'
  | 'intertextualidad'
  | 'ideologia'
  | 'pragmatica'
  | 'localizacion'
  | 'trampa'
  | 'translingue'
  | 'biblioteca';

export const CATEGORIAS: readonly Categoria[] = [
  'transmedia', 'cine', 'sonido', 'estructura', 'personajes', 'intertextualidad',
  'ideologia', 'pragmatica', 'localizacion', 'trampa', 'translingue', 'biblioteca',
];

/** Cómo se comprobó un punto contra las fuentes. */
export type Verificacion = 'texto' | 'transcripcion' | 'visual-gemini' | 'visual-doble';

/**
 * Dónde está la prueba de un punto. En un libro: la unidad física de Scholaris
 * (`fisica`, cada unidad del cuento es un pliego de dos páginas) y la página impresa
 * donde está de verdad la cita (`impresa`). En vídeo: el tramo en segundos.
 */
export interface AnclaRubrica {
  documento: string;
  fisica?: number;
  impresa?: string;
  t0?: number;
  t1?: number;
  /** Cita literal tal como está en la fuente (OCR o transcripción, con sus erratas). */
  cita?: string;
  /** Lo que se ve u oye, si no es texto. */
  que?: string;
}

export interface PuntoRubrica {
  id: string;
  afirmacion: string;
  obligatorio: boolean;
  anclas: AnclaRubrica[];
  verificacion: Verificacion;
  /** Registro de la comprobación: modelos, recortes y veredictos (ver verificaciones.json del banco privado). */
  comprobacion?: string[];
  nota?: string;
}

export interface Pregunta {
  id: string;
  pregunta: string;
  idioma: string;
  categorias: Categoria[];
  dificultad: 1 | 2 | 3 | 4 | 5;
  documentos: string[];
  rubrica: { puntos: PuntoRubrica[]; trampas: string[] };
}

export interface Banco {
  version: string;
  descripcion: string;
  documentos: Record<string, { titulo: string; tipo: string; nota?: string }>;
  preguntas: Pregunta[];
}

// ---------------------------------------------------------------------------
// Respuestas normalizadas
// ---------------------------------------------------------------------------

export type ModoRespuesta = 'responder' | 'investigar';

/** Una cita de la respuesta: la nota [^n] del modo rápido o la evidencia [E1] de Investigar. */
export interface CitaRespuesta {
  /** «1», «2» (notas) o «E1», «E2» (evidencias). */
  id: string;
  documento: string;
  ancla?: Ancla;
  anclaFin?: Ancla;
  /** «p. 22», «1:31:09-1:31:56». */
  etiqueta?: string;
  /** El pasaje literal que la sostiene o, en una evidencia visual, lo que dice que se ve. */
  texto?: string;
  fragmento?: string;
  modo?: string;
}

export interface RespuestaNormalizada {
  modo: ModoRespuesta;
  preguntaId: string;
  markdown: string;
  citas: CitaRespuesta[];
  ms: number;
  /** Coste declarado por el servidor (Investigar lo da en `fin.coste`). */
  usd?: number;
  error?: string;
  avisos?: string[];
  fecha: string;
}

// ---------------------------------------------------------------------------
// Juicios
// ---------------------------------------------------------------------------

export type VeredictoPunto = 'cubierto' | 'parcial' | 'ausente' | 'contradicho';

export interface JuicioPunto {
  id: string;
  veredicto: VeredictoPunto;
  motivo: string;
}

export interface JuicioTrampa {
  trampa: string;
  activada: boolean;
  motivo: string;
}

/** `sin_comprobar`: afirmación visual sin recorte que mirar (no cuenta en la precisión). */
export type VeredictoCita = 'sostiene' | 'parcial' | 'no_sostiene' | 'inventada' | 'sin_comprobar';

/** Una frase de la respuesta frente a una de sus citas (o un ancla escrita en la prosa). */
export interface JuicioCita {
  cita: string;
  frase: string;
  documento: string;
  etiqueta: string;
  veredicto: VeredictoCita;
  motivo: string;
  /** De dónde salió: nota o evidencia del sistema, o ancla escrita en el texto («p. 14», «1:02:03»). */
  origen: 'cita' | 'prosa';
  /** El veredicto se tomó mirando el recorte de vídeo. */
  visual?: boolean;
}

export interface JuicioPregunta {
  preguntaId: string;
  modo: ModoRespuesta;
  juez: string;
  puntos: JuicioPunto[];
  trampas: JuicioTrampa[];
  citas: JuicioCita[];
  puntuacion: Puntuacion;
  usdJuez: number;
}

export interface Puntuacion {
  /** Media de los puntos obligatorios (cubierto 1, parcial 0,5). */
  acierto: number;
  /** Media de todos los puntos. */
  exhaustividad: number;
  contradichos: number;
  trampas: number;
  citas: number;
  citasSostienen: number;
  citasParciales: number;
  citasNoSostienen: number;
  citasInventadas: number;
  citasSinComprobar: number;
  /** (sostienen + 0,5 · parciales) / citas comprobadas; 0 si no hay ninguna. */
  precisionCitas: number;
  /** Nota global 0-100. */
  nota: number;
}
