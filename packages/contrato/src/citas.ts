/**
 * Citas.
 *
 *   POST   /citas/autocita              Autocita → AutocitaIniciada  (el resultado llega por /tiempo-real y GET)
 *   GET    /citas/autocita?…ParamsPagina          → Pagina<ResumenAutocita>
 *   GET    /citas/autocita/:id                    → DetalleAutocita
 *   PATCH  /citas/autocita/:id  { decisiones }    → DetalleAutocita   (aceptar/rechazar citas propuestas)
 *   DELETE /citas/autocita/:id                    → Ok
 *   GET    /citas/autocita/:id/exportar?formato=docx|md|txt|latex → fichero
 *   POST   /citas/extraer-texto  cuerpo binario (DOCX, PDF, TXT, MD) → { texto, parrafos }
 *
 *   POST   /citas/verificar     Verificar   → Verificacion
 *   POST   /citas/exportar      ExportarReferencias → text/plain (BibTeX, RIS) o application/json (CSL-JSON)
 *   POST   /citas/bibliografia  PedirBibliografia   → Bibliografia
 *   POST   /citas/docx          InsertarEnDocx      → { url }    (DOCX con las citas, conservando el formato)
 *   POST   /citas/importar-bibtex  { bibtex, biblioteca? } → ImportacionBibtex
 *   GET    /citas/estilos?q=                       → EstiloCsl[]
 *   GET    /documentos/:id/cita?estilo=&idioma=    → { texto, html }
 */

import type { CitaVerificada, Filtros, RelacionCita } from '@scholaris/nucleo';
import type { RefTarea } from './comun.js';

export interface Autocita {
  /** Texto a citar. O bien `subida`: clave de un DOCX ya subido (se conserva el formato). */
  texto?: string;
  subida?: string;
  filtros?: Filtros;
  estilo?: string;
  idioma?: string;
  /** Solo proponer citas con respaldo ≥ umbral (0-1, por defecto 0,7). */
  umbral?: number;
  /** Máximo de citas por párrafo. */
  maxPorParrafo?: number;
  titulo?: string;
}

export type EstadoTarea = 'en_cola' | 'procesando' | 'listo' | 'error' | 'cancelada';

export interface ResumenAutocita {
  id: string;
  titulo: string;
  estado: EstadoTarea;
  citas: number;
  creada: string;
}

export interface PropuestaCita {
  id: string;
  /** Párrafo y desplazamiento en el texto donde va la cita. */
  parrafo: number;
  desde: number;
  hasta: number;
  afirmacion: string;
  cita: CitaVerificada;
  /** Texto de la cita en el estilo pedido: «(Foucault, 1975, p. 23)». */
  textoCita: string;
  decision?: 'aceptada' | 'rechazada';
  /** Alternativas por si la primera no convence. */
  alternativas?: CitaVerificada[];
}

export interface DetalleAutocita extends ResumenAutocita {
  texto: string;
  parrafos: string[];
  propuestas: PropuestaCita[];
  bibliografia: string[];
  estilo: string;
  error?: string;
}

export interface DecisionesAutocita {
  decisiones: Array<{ propuesta: string; decision: 'aceptada' | 'rechazada' }>;
}

export interface TextoExtraido {
  texto: string;
  parrafos: string[];
}

export interface Verificar {
  afirmacion: string;
  /** Pasajes candidatos concretos; si no se dan, se buscan con `filtros`. */
  fragmentos?: string[];
  filtros?: Filtros;
  /** Año de la afirmación o del texto que cita (lógica temporal). */
  anioTexto?: number;
  k?: number;
}

export interface Verificacion {
  veredicto: 'respaldada' | 'parcial' | 'sin_respaldo' | 'contradicha';
  citas: Array<CitaVerificada & { etiqueta: string; citaCorta: string }>;
  /** Probabilidades de cada relación para el mejor pasaje. */
  relaciones?: Partial<Record<RelacionCita, number>>;
  ms: number;
}

export type FormatoReferencias = 'bibtex' | 'ris' | 'csl-json';

export interface ExportarReferencias {
  documentos?: string[];
  biblioteca?: string;
  formato: FormatoReferencias;
}

export interface PedirBibliografia {
  documentos?: string[];
  biblioteca?: string;
  estilo?: string;
  idioma?: string;
  formato?: 'texto' | 'html';
}

export interface Bibliografia {
  estilo: string;
  entradas: string[];
  html?: string;
}

export interface InsertarEnDocx {
  /** Clave del DOCX subido o id de autocita. */
  subida?: string;
  autocita?: string;
  estilo?: string;
  /** Añadir la bibliografía al final. */
  bibliografia?: boolean;
}

export interface ImportarBibtex {
  bibtex: string;
  biblioteca?: string;
}

export interface ImportacionBibtex {
  creados: number;
  actualizados: number;
  /** Entradas que coinciden con documentos existentes (por DOI, ISBN o título). */
  coincidencias: Array<{ clave: string; documento: string }>;
  errores: Array<{ clave?: string; mensaje: string }>;
}

export interface EstiloCsl {
  id: string;
  titulo: string;
  /** «autor-fecha», «numérico», «nota». */
  formato?: string;
}

export interface CitaDocumento {
  texto: string;
  html: string;
}

export type { RefTarea };

export interface AutocitaIniciada extends RefTarea {
  autocita: string;
}
