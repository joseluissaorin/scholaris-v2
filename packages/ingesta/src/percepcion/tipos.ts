/**
 * Puertos y opciones de la percepción (docs/COMPRENSION.md, «Ingesta», paso 1).
 * La percepción mira y escucha un medio entero por ventanas con un modelo
 * multimodal y devuelve un `PercepcionMedio` (packages/nucleo/src/comprension.ts).
 * La ingesta no conoce a Gemini: recibe estos puertos, y @scholaris/proveedores
 * da implementaciones con la misma forma (`videnteGemini`, `ficherosGemini`).
 */
import type { Lente, PercepcionMedio, PersonaPercibida } from '@scholaris/nucleo';
import type { PalabrasTiempo } from '@scholaris/spdf';

/** Un fichero que el modelo ya puede ver (Gemini Files: `uri` y MIME). */
export interface FicheroModelo {
  uri: string;
  mime: string;
  /** Nombre en la API de ficheros (`files/abc123`), si lo hay. */
  nombre?: string;
  /** ISO 8601: cuándo deja de existir. */
  expira?: string;
}

export type ResolucionMedio = 'baja' | 'media' | 'alta';

/** Mirar un tramo de un medio con una pregunta y un esquema de salida. */
export interface PeticionMirar {
  fuente: FicheroModelo;
  /** Tramo en segundos desde el inicio del medio; sin él, el medio entero. */
  desde?: number;
  hasta?: number;
  /** Fotogramas por segundo que muestrea el modelo (Gemini: 1 por defecto). */
  fps?: number;
  resolucion?: ResolucionMedio;
  sistema: string;
  texto: string;
  esquema: Record<string, unknown>;
  modelo?: string;
  maxTokens?: number;
  temperatura?: number;
  pensamiento?: 'minimal' | 'low' | 'medium' | 'high';
}

/** Lo que devuelve el modelo, con su coste. */
export interface Mirada {
  texto: string;
  /** El JSON ya interpretado; ausente si la salida no se pudo leer (p. ej. cortada). */
  json?: unknown;
  modelo: string;
  /** Motivo de fin del modelo (`STOP`, `MAX_TOKENS`…). */
  fin?: string;
  usd?: number;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
}

/** Un modelo multimodal que mira un tramo de un fichero (Gemini con `fileData` y `videoMetadata`). */
export interface Vidente {
  readonly nombre: string;
  mirar(p: PeticionMirar): Promise<Mirada>;
}

/** Almacén de trabajo: lo ya pagado (cada ventana) se graba y no se vuelve a pedir. */
export interface AlmacenTrabajo {
  leer(clave: string): Promise<string | null>;
  escribir(clave: string, texto: string): Promise<void>;
}

/** Una unidad de tiempo del documento (lo que hay en `unidades`): texto con «**Nombre:**» y palabras con su instante. */
export interface UnidadMedio {
  /** Orden de la unidad en el documento (por defecto, su posición en la lista). */
  orden?: number;
  texto: string;
  t0: number;
  t1: number;
  hablante?: string;
  palabras?: PalabrasTiempo;
}

export interface ProgresoPercepcion {
  hechas: number;
  total: number;
  /** Gasto nuevo de esta ejecución (lo grabado no cuenta). */
  usd: number;
  ventana?: { t0: number; t1: number; grabada: boolean };
}

export interface CostePercepcion {
  usd: number;
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
  /** Ventanas que se aprovecharon de una ejecución anterior. */
  grabadas: number;
}

export interface PuertosPercepcion {
  vidente: Vidente;
  /** El fichero del proxy en la API del modelo; con `renovar`, se vuelve a subir. */
  fuente(opciones?: { renovar?: boolean }): Promise<FicheroModelo>;
  trabajo: AlmacenTrabajo;
  alProgreso?(p: ProgresoPercepcion): void | Promise<void>;
  reloj?: () => number;
}

export interface OpcionesPercepcion {
  documento: string;
  duracion: number;
  medio: 'video' | 'audio';
  lente: Lente;
  /** Unidades del documento con su transcripción (en orden). */
  unidades: UnidadMedio[];
  /** Reparto conocido de antemano (metadatos, Wikidata P161 con P453). */
  reparto?: PersonaPercibida[];
  /** Cortes de plano detectados por el conversor (segundos), si los hay. */
  cortes?: number[];
  /** «Fresa y chocolate (1993), de Tomás Gutiérrez Alea y Juan Carlos Tabío». */
  ficha?: string;
  /** Idioma de las descripciones (por defecto, el del documento o «es»). */
  idioma?: string;
  modelo?: string;
  /** Segundos por ventana (480) y de solape (30). */
  largo?: number;
  solape?: number;
  fps?: number;
  resolucion?: ResolucionMedio;
  pensamiento?: PeticionMirar['pensamiento'];
  concurrencia?: number;
  /** Corta la ejecución si el gasto nuevo pasa de aquí (lo hecho queda grabado). */
  presupuestoUsd?: number;
  /** Prefijo de las claves de trabajo (por defecto `percepcion/`). */
  prefijoTrabajo?: string;
  /** Ajustar los límites de plano a los cortes detectados (por defecto, sí si hay cortes). */
  ajustarCortes?: boolean;
}

/** `PercepcionMedio` con lo que costó (campo adicional: el contrato no cambia). */
export interface PercepcionConCoste extends PercepcionMedio {
  coste: CostePercepcion;
  ventanas: Array<{ t0: number; t1: number; modelo: string; usd: number; ms: number }>;
}
