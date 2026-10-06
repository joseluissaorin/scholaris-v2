/**
 * Documentos de la estantería.
 *
 *   GET    /documentos?…FiltrosDocumentos         → Pagina<ResumenDocumento>
 *   GET    /documentos/:id                        → DetalleDocumento
 *   PATCH  /documentos/:id/metadatos  Partial<MetadatosDocumento> → DetalleDocumento
 *   DELETE /documentos/:id                        → Ok
 *   POST   /documentos/:id/reprocesar  { fases? } → IngestaIniciada
 *
 *   GET    /documentos/:id/unidades?desde=&hasta=  → UnidadVista[]   (orden, ambos incluidos; máx. 100)
 *   GET    /documentos/:id/unidades/:orden          → UnidadVista
 *   GET    /documentos/:id/unidades/:orden/imagen?miniatura=1 → 302 a la URL firmada
 *   GET    /documentos/:id/folios                  → MapaFolios     («ir a la página 145»)
 *   GET    /documentos/:id/secciones               → SeccionVista[]
 *   GET    /documentos/:id/fragmentos?unidad=&desde=&hasta= → FragmentoVista[]
 *   GET    /documentos/:id/figuras                 → FiguraVista[]
 *   GET    /documentos/:id/medio                   → el original (audio/vídeo/PDF) con Range
 *   GET    /documentos/:id/original                → { url }       (URL firmada de descarga)
 *
 *   GET    /documentos/:id/volcado                 → VolcadoDocumento  (para armar el .spdf en el navegador)
 *   GET    /documentos/:id/spdf                    → application/x-spdf (reserva: lo arma el servidor)
 *   POST   /documentos/importar   cuerpo binario .spdf (v3 o v4) → ImportacionSpdf
 *
 *   GET    /binarios?clave=&exp=&sig=              → binario firmado (con Range). Lo generan las URLs `…Url`.
 *
 * Numeración: `orden` de las unidades es BASE 0 (la página física 1 es el orden 0),
 * y lo mismo `MapaFolios.folios[].orden`, `SeccionVista.unidadDesde/unidadHasta`,
 * `FragmentoVista.unidad`, `FiguraVista.unidad` y los parámetros `desde`/`hasta`
 * (también los del evento de tiempo real «unidades»). Lo que se enseña a la
 * persona es la `etiqueta` del ancla («p. 23»), nunca el orden.
 *
 * Mientras se procesa, las unidades ya leídas aparecen con id «prov:…» y se
 * sustituyen por las definitivas al terminar (llega «unidades» con todo el rango).
 */

import type {
  Ancla,
  Documento,
  EspacioVectorial,
  EstadoDocumento,
  MetadatosDocumento,
  TipoEntrada,
} from '@scholaris/nucleo';
import type { ParamsPagina } from './comun.js';

export type OrdenDocumentos = 'creado' | 'actualizado' | 'titulo' | 'anio' | 'autor';

export interface FiltrosDocumentos extends ParamsPagina {
  /** Texto libre sobre título y autores. */
  q?: string;
  biblioteca?: string;
  tipo?: TipoEntrada | TipoEntrada[];
  estado?: EstadoDocumento;
  autor?: string;
  anioDesde?: number;
  anioHasta?: number;
  idioma?: string;
  orden?: OrdenDocumentos;
  dir?: 'asc' | 'desc';
}

export interface ResumenDocumento {
  id: string;
  tipo: TipoEntrada;
  estado: EstadoDocumento;
  titulo: string;
  autores: string;
  anio?: number;
  idioma?: string;
  unidades: number;
  duracion?: number;
  bytes: number;
  creado: string;
  actualizado: string;
  bibliotecas: string[];
  /** URL firmada de la miniatura de la portada, si la hay. */
  portadaUrl?: string;
  /** Tarea en curso, si se está procesando. */
  tarea?: string;
}

export interface DetalleDocumento extends Documento {
  portadaUrl?: string;
  /** Espacios vectoriales calculados para este documento. */
  espacios: EspacioVectorial[];
  cuentas: { fragmentos: number; secciones: number; figuras: number };
  tarea?: string;
  /** Último error de ingesta, si lo hubo. */
  error?: string;
}

export type ParcheMetadatos = Partial<MetadatosDocumento>;

export interface Reprocesar {
  /** Fases a rehacer; por defecto, todas las derivadas (contexto, vectores, indexado). */
  fases?: Array<'lectura' | 'folios' | 'metadatos' | 'estructura' | 'contexto' | 'vectores' | 'figuras'>;
}

export interface UnidadVista {
  id: string;
  orden: number;
  ancla: Ancla;
  /** «p. 23», «12:04», «diap. 7»: cómo se cita esta unidad. */
  etiqueta: string;
  texto: string;
  notas?: string[];
  imagenUrl?: string;
  miniaturaUrl?: string;
  lector: string;
  confianza: number;
}

export interface MapaFolios {
  /** Una entrada por unidad: física → impresa. */
  folios: Array<{ orden: number; fisica?: number; impresa: string | null; t0?: number; origen?: string; confianza?: number }>;
}

export interface SeccionVista {
  id: string;
  padre?: string;
  nivel: number;
  titulo: string;
  unidadDesde: number;
  unidadHasta?: number;
  resumen?: string;
}

export interface FragmentoVista {
  id: string;
  unidad: number;
  orden: number;
  texto: string;
  contexto: string;
  seccion: string[];
  ancla: Ancla;
  anclaFin?: Ancla;
  etiqueta: string;
}

export interface FiguraVista {
  id: string;
  unidad: number;
  imagenUrl: string;
  pie?: string;
  descripcion?: string;
  ancla: Ancla;
  etiqueta: string;
}

/**
 * Todo lo que hace falta para armar un .spdf v4 en el navegador con
 * `@scholaris/spdf`. Los vectores van en base64 (float32 little-endian) y los
 * binarios como URLs firmadas que el navegador descarga e incrusta.
 */
export interface VolcadoDocumento {
  version: 400;
  documento: Documento;
  unidades: Array<{
    id: string; orden: number; ancla: Ancla; texto: string; notas?: string[]; cabecera?: string; pie?: string;
    imagen?: string; miniatura?: string; lector: string; confianza: number;
  }>;
  secciones: Array<{ id: string; padre?: string; nivel: number; titulo: string; unidadDesde: string; unidadHasta?: string; resumen?: string }>;
  fragmentos: Array<{ id: string; unidad: string; orden: number; texto: string; contexto: string; seccion: string[]; ancla: Ancla; anclaFin?: Ancla }>;
  figuras: Array<{ id: string; unidad: string; imagen: string; pie?: string; descripcion?: string; ancla: Ancla }>;
  espacios: EspacioVectorial[];
  vectores: Array<{ objetivo: 'fragmento' | 'unidad' | 'figura'; id: string; espacio: string; base64: string }>;
  procedencia: Array<{ fase: string; proveedor?: string; detalle?: unknown; ms?: number; cuando: string }>;
  /** Clave del almacén → URL firmada, para incrustar original e imágenes. */
  binarios: Record<string, { url: string; mime: string }>;
}

export interface ImportacionSpdf {
  documento: string;
  /** Versión del fichero de origen (300 o 400). */
  versionOrigen: number;
  /** Si faltaban vectores del espacio base, se lanza una tarea para calcularlos. */
  tarea?: string;
  avisos: string[];
}
