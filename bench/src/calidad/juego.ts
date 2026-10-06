/** Los ficheros del juego de pruebas (bench/calidad/*.json) y sus tipos. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_CALIDAD } from './estanteria.js';

export interface Consulta {
  id: string;
  consulta: string;
  /** Idioma de la consulta y clases: conceptual, factual, literal, grafia, interlingue, cruzada, filtro, temporal, autor, pagina, medio. */
  clases: string[];
  idioma: string;
  /** Documentos (nombre corto) donde se espera la respuesta. */
  documentos: string[];
  /** Fragmentos que propuso quien escribió la consulta (entran siempre en el pool). */
  semilla: string[];
  origen: string;
  /** Consultas de navegación: la página física que hay que abrir. */
  pagina?: { documento: string; fisica: number };
}

/** Juicio de un par consulta-pasaje. `nota` es la que cuenta (0-3, puede ser media). */
export interface Juicio {
  nota: number;
  /** Primer juez (Gemini), segundo (otro modelo) y adjudicación si hizo falta. */
  j1?: number;
  j2?: number;
  j3?: number;
  motivo?: string;
  /** «plata» (modelos) u «oro» (confirmado por una persona). */
  fuente: 'plata' | 'oro' | 'regla';
  /** Primeros 80 caracteres del pasaje, para detectar si la estantería cambió. */
  huella?: string;
}

export type Juicios = Record<string, Record<string, Juicio>>;

export const RUTA_CONSULTAS = join(DIR_CALIDAD, 'consultas.json');
export const RUTA_JUICIOS = join(DIR_CALIDAD, 'juicios.json');
export const RUTA_CITAS = join(DIR_CALIDAD, 'citas.json');
export const RUTA_FOLIOS = join(DIR_CALIDAD, 'folios.json');

export function cargarConsultas(): Consulta[] {
  return JSON.parse(readFileSync(RUTA_CONSULTAS, 'utf8')) as Consulta[];
}

export function cargarJuicios(): Juicios {
  return existsSync(RUTA_JUICIOS) ? (JSON.parse(readFileSync(RUTA_JUICIOS, 'utf8')) as Juicios) : {};
}

/** Guarda con claves ordenadas: los diffs de git quedan legibles. */
export function guardarJuicios(j: Juicios): void {
  const ordenado: Juicios = {};
  for (const q of Object.keys(j).sort()) {
    ordenado[q] = {};
    for (const f of Object.keys(j[q]!).sort()) ordenado[q]![f] = j[q]![f]!;
  }
  writeFileSync(RUTA_JUICIOS, JSON.stringify(ordenado, null, 0).replace(/\},"q/g, '},\n"q') + '\n');
}
