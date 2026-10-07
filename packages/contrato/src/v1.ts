/**
 * API pública v1: la API sencilla de Scholaris, para personas y agentes.
 *
 *   «Subo cualquier cosa, busco, pregunto, cito.»
 *
 * Una sola cabecera (`Authorization: Bearer sch_…`, las claves personales de
 * Ajustes → Claves de API), JSON de ida y vuelta (o Markdown con
 * `?formato=markdown` o `Accept: text/markdown`), errores que se explican en
 * español y en inglés, y referencias exactas (página impresa o segundo) que
 * salen siempre del ancla guardada, nunca de un modelo.
 *
 *   POST   /api/v1/documentos               subir un fichero (cuerpo crudo o multipart) o { url }
 *   GET    /api/v1/documentos               listar
 *   GET    /api/v1/documentos/{id}          ficha, estado y progreso
 *   DELETE /api/v1/documentos/{id}          borrar
 *   GET    /api/v1/documentos/{id}/texto    leer páginas o un tramo de tiempo
 *   GET    /api/v1/documentos/{id}/spdf     el documento como fichero SPDF 5.0 (?version=4 da el 4.1)
 *   POST   /api/v1/documentos/importar      importar un .spdf (5.0, 4.x o 3.x)
 *   GET    /api/v1/buscar?q=…               pasajes con su cita
 *   POST   /api/v1/preguntar                respuesta con notas [^n] verificadas
 *   POST   /api/v1/citar                    un texto con sus citas y la bibliografía
 *   POST   /api/v1/verificar                ¿respalda la biblioteca esta afirmación?
 *
 * Es una fachada sobre la API v2 (`/api/v2/*`): no hay lógica de dominio
 * nueva, solo nombres cortos, valores por defecto y espera opcional.
 * Todas las claves de los cuerpos van en minúsculas y con guion bajo.
 */
import type { Ancla, TipoEntrada } from '@scholaris/nucleo';

export const PREFIJO_V1 = '/api/v1' as const;

/** Estado de un documento o de un trabajo largo. */
export type EstadoV1 = 'en_cola' | 'procesando' | 'listo' | 'error';

/** Un documento de la biblioteca, tal como lo ve la v1. */
export interface DocumentoV1 {
  /** Id estable y corto («dmuwtm9kmsanlrbm5»). */
  id: string;
  titulo: string;
  /** «Apellidos, Nombre», en orden. */
  autores: string[];
  anio?: number;
  tipo: TipoEntrada;
  estado: EstadoV1;
  /** Avance global 0-1 mientras se procesa. */
  progreso?: number;
  /** Fase en curso («lectura», «vectores»…). */
  fase?: string;
  /** Páginas, diapositivas o tramos. */
  unidades: number;
  /** Segundos (audio y vídeo). */
  duracion?: number;
  idioma?: string;
  /** Dirección de origen, si entró por URL. */
  url?: string;
  /** Referencia bibliográfica completa (APA) cuando ya está listo. */
  referencia?: string;
  /** Ya estaba en la biblioteca (misma huella): no se ha vuelto a procesar. */
  duplicado?: boolean;
  error?: string;
  creado: string;
  /** El documento en el lector de Scholaris. */
  enlace: string;
  /** Dónde leer su texto (`GET`). */
  texto_url: string;
  /** Dónde preguntar por su estado mientras se procesa (`GET`). */
  progreso_url?: string;
}

export interface ListaDocumentosV1 {
  documentos: DocumentoV1[];
  total: number;
  /** Pásalo como `cursor` para la página siguiente. */
  siguiente?: string;
}

/** Cuerpo JSON de `POST /documentos` (la otra forma es mandar el fichero). */
export interface SubirUrlV1 {
  url: string;
  titulo?: string;
  autores?: string[];
  anio?: number;
  /** web | pdf | audio | video: si no se da, se deduce. */
  tipo?: TipoEntrada;
  /** 'economico' cuesta la mitad y tarda más. */
  modo?: 'rapido' | 'economico';
}

/** Un pasaje encontrado, con todo lo necesario para citarlo. */
export interface PasajeV1 {
  /** Id del fragmento: el del documento, «:» y su posición. */
  id: string;
  documento: { id: string; titulo: string; autores: string[]; anio?: number };
  /** Texto literal del fragmento entero (el contexto). */
  texto: string;
  /**
   * El pasaje relevante: las oraciones completas del fragmento que responden a la
   * consulta (de 1 a 3, literales). Es lo que se cita.
   */
  pasaje: string;
  /** Dónde está `pasaje` dentro de `texto`: [desde, hasta) en caracteres (UTF-16). */
  pasaje_rango?: [number, number];
  /** Cita corta del pasaje lista para pegar, con su página o su segundo: «(Cortázar, 1977, 1:06:56)», «(Darwin, 1859, p. 81)». */
  cita: string;
  /** Solo el localizador: «p. 23», «pp. 23-24», «1:06:56», «diap. 7». */
  localizador: string;
  /** El ancla exacta de la que salen la cita y el enlace (la del pasaje). */
  ancla: Ancla;
  /** El lector abierto en esa página o en ese segundo, con el pasaje subrayado. */
  enlace: string;
  puntuacion: number;
}

export interface BuscarV1 {
  q: string;
  /** Número de pasajes (por defecto 10, máximo 50). */
  k?: number;
  /** Restringir a estos documentos. */
  documentos?: string[];
  biblioteca?: string;
}

export interface RespuestaBuscarV1 {
  consulta: string;
  pasajes: PasajeV1[];
  ms: number;
}

export interface PreguntarV1 {
  pregunta: string;
  /** Pasajes que se dan al redactor (por defecto 8, máximo 12). */
  k?: number;
  documentos?: string[];
  biblioteca?: string;
  /** Eventos SSE: `pasajes`, `texto` (delta), `fuente`, `fin`. */
  stream?: boolean;
}

export interface FuenteV1 extends PasajeV1 {
  /** Número de la nota en la respuesta: [^n]. */
  n: number;
}

export interface RespuestaPreguntarV1 {
  pregunta: string;
  /** Markdown con notas al pie [^n]; las definiciones van al final. */
  respuesta: string;
  fuentes: FuenteV1[];
  confianza: 'alta' | 'media' | 'baja';
  ms: number;
}

export interface CitarV1 {
  /** El texto que hay que citar (Markdown o texto plano, hasta 200 000 caracteres). */
  texto: string;
  /** Cualquier estilo CSL: apa, chicago-author-date, mla, iso690-author-date-es… */
  estilo?: string;
  idioma?: string;
  /** Respaldo mínimo para proponer una cita (0-1, por defecto 0,7). */
  umbral?: number;
  documentos?: string[];
  biblioteca?: string;
}

export interface CitaV1 {
  /** La afirmación del texto que respalda. */
  afirmacion: string;
  /** La cita en el estilo pedido, tal como se ha insertado. */
  cita: string;
  localizador: string;
  documento: string;
  fragmento: string;
  /** Pasaje literal que la respalda. */
  pasaje: string;
  /** Probabilidad 0-1 de que el pasaje respalde la afirmación. */
  respaldo: number;
  enlace: string;
}

export interface RespuestaCitarV1 {
  id: string;
  estado: EstadoV1;
  /** El texto con las citas insertadas (Markdown). */
  texto?: string;
  citas?: CitaV1[];
  bibliografia?: string[];
  estilo: string;
  progreso_url?: string;
  error?: string;
}

export interface VerificarV1 {
  afirmacion: string;
  /** Año del texto que hace la afirmación (descarta fuentes posteriores). */
  anio?: number;
  k?: number;
  documentos?: string[];
}

export type VeredictoV1 = 'respaldada' | 'parcial' | 'sin_respaldo' | 'contradicha';

export interface RespuestaVerificarV1 {
  afirmacion: string;
  veredicto: VeredictoV1;
  /** true solo si el veredicto es «respaldada». */
  respaldada: boolean;
  /** Respaldo del mejor pasaje (0-1). */
  probabilidad: number;
  pasajes: Array<PasajeV1 & { relacion: string; respaldo: number }>;
  ms: number;
}

export interface UnidadTextoV1 {
  /** Posición física (página del PDF, tramo, diapositiva), desde 1: «[12]» en `desde` y `hasta`. */
  posicion: number;
  localizador: string;
  cita: string;
  enlace: string;
  /** Segundos de inicio y fin (audio y vídeo). */
  t0?: number;
  t1?: number;
  texto: string;
}

export interface TextoV1 {
  documento: { id: string; titulo: string; autores: string[]; anio?: number; tipo: TipoEntrada };
  unidades: UnidadTextoV1[];
  /** Si hay más: pásalo como `desde` para seguir leyendo. */
  siguiente?: string;
}

/** Cuerpo de error de la v1: el código para el programa, el mensaje para la persona (en dos lenguas). */
export interface ErrorV1 {
  error: {
    codigo: string;
    mensaje: string;
    message: string;
    estado: number;
    /** Dónde se explica. */
    documentacion: string;
    detalles?: Record<string, unknown>;
  };
}
