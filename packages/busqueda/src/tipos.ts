import type { Ancla, Filtros, Resultado } from '@scholaris/nucleo';

export type Intencion = 'conceptual' | 'visual' | 'cita' | 'temporal';
export type Via = 'lexica' | 'densa' | 'visual';

export interface Expansion {
  texto: string;
  tipo: 'original' | 'parafrasis' | 'enunciado' | 'hyde' | 'traduccion';
  /** Peso en la fusión (0-1). */
  peso: number;
  idioma?: string;
}

/** Lo que se entiende de una consulta antes de buscar. */
export interface Comprension {
  consulta: string;
  /** Clave de caché: minúsculas, sin acentos, espacios colapsados. */
  normalizada: string;
  intencion: Intencion;
  /** La original va siempre la primera. */
  expansiones: Expansion[];
  /** Traducciones por idioma («en», «la»…), para la búsqueda entre lenguas. */
  traducciones: Record<string, string>;
  /** Filtros extraídos del lenguaje natural («en Foucault antes de 1980»). */
  filtros: Filtros;
  /** Frases entre comillas: la consulta es una cita literal. */
  literales: string[];
  /** «Ir a la página 145 (de X)». */
  irA?: { folio: string; pista?: string };
  origen: 'modelo' | 'heuristica' | 'cache';
}

export interface DestinoPagina {
  documento: string;
  unidad: string;
  ancla: Ancla;
  /** Fragmento que abre la página, si lo hay. */
  fragmento?: string;
}

export interface OpcionesBusqueda {
  /** Filtros explícitos: mandan sobre los extraídos de la consulta. */
  filtros?: Filtros;
  /** Resultados que se devuelven (10). */
  limite?: number;
  /** Candidatos por vía antes de fusionar (40). */
  candidatos?: number;
  /** Cuántos candidatos fusionados pasan por el reordenador (30). */
  reordenarTop?: number;
  /** Llamar al redactor para entender la consulta (sí). */
  comprender?: boolean;
  reordenar?: boolean;
  /** Pasar el juez por los resultados (no: cuesta una llamada más). */
  juez?: boolean;
  /** Probabilidad mínima del juez para conservar un resultado (0,15). */
  umbralJuez?: number;
  vias?: Via[];
  /** Fundir fragmentos contiguos del mismo documento (sí). */
  fundirContiguos?: boolean;
}

export interface RespuestaBusqueda {
  resultados: Resultado[];
  comprension: Comprension;
  irA?: DestinoPagina;
  /** Milisegundos por fase: comprension, lexica, densa, visual, fusion, hidratacion, reordenacion, juez, total. */
  tiempos: Record<string, number>;
  candidatos: number;
  /** Avisos no fatales (una vía que falló, un plazo agotado…). */
  avisos: string[];
}
