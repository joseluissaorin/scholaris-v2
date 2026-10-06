/**
 * Documentos de la estantería.
 *
 *   GET    /documentos?…FiltrosDocumentos         → Pagina<ResumenDocumento>
 *   GET    /documentos/:id                        → DetalleDocumento
 *   PATCH  /documentos/:id/metadatos  Partial<MetadatosDocumento> → DetalleDocumento
 *   POST   /documentos/:id/metadatos/rehacer  { simular? } → DetalleDocumento  (solo la ficha, sin releer; respeta lo que editó el usuario; con simular, la que saldría sin escribirla)
 *   POST   /documentos/:id/folios/rehacer  { juez?, simular? } → FoliosRehechos  (solo los folios, sin releer: desde las unidades guardadas)
 *   POST   /documentos/:id/paginas/rehacer { simular?, soloSinImagen? } → PaginasRehechas (rasteriza el PDF original otra vez: imágenes y miniaturas, sin releer el texto)
 *   DELETE /documentos/:id                        → Ok
 *   POST   /documentos/:id/reprocesar  { fases? } → IngestaIniciada
 *   POST   /documentos/:id/reintentar             → IngestaIniciada  (tras un error: reaprovecha original, paquete y lecturas ya hechas)
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
 *   GET    /documentos/:id/medio/diagnostico       → DiagnosticoMedio (¿índice delante? ¿qué códecs?)
 *   POST   /documentos/:id/medio/preparar          → MedioPreparado   (pone el índice del MP4 delante: suena al instante)
 *
 *   GET    /documentos/:id/volcado                 → VolcadoDocumento  (para armar el .spdf en el navegador)
 *   GET    /documentos/:id/spdf                    → application/x-spdf (reserva: lo arma el servidor)
 *   POST   /documentos/importar?biblioteca=&deduplicar=1   cuerpo binario .spdf (v3 o v4) → ImportacionSpdf
 *   GET    /documentos/:id/spdf?incrustar=0&originales=0&vectores=0&referencias=1   (referencias: claves completas, sin copiar binarios)
 *
 * Importación por el almacén (.spdf grandes, sin límite de memoria del servidor):
 *   1. POST /documentos/importar/recursos  ImportarRecursos → RecursosFirmados
 *      firma la subida de los binarios (original, páginas…) bajo el prefijo del
 *      documento; los de más de 64 MB van por partes:
 *        POST /documentos/importar/partes     PedirPartesImportacion → UrlsPartes
 *        POST /documentos/importar/completar  CompletarPartesImportacion → { ok }
 *   2. POST /documentos/importar con un .spdf ligero (sin blobs) cuyas
 *      referencias son las claves completas ya subidas («u/<usuario>/d/<id>/…»).
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
  /** Avisos de un documento listo; p. ej. «vectores_pendientes» (busca por texto; la semántica llega después). */
  avisos?: Array<{ codigo: string; mensaje: string }>;
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
  /**
   * Audio y vídeo: el instante de cada palabra de `texto` (separadas por
   * espacios, sin las marcas «**Nombre:**»). `cs` alterna inicio y duración en
   * centésimas desde `t0` (segundos). Solo si la ingesta los tiene.
   */
  palabras?: PalabrasTiempo;
}

/** Instantes por palabra, en forma compacta (igual que en el .spdf). */
export interface PalabrasTiempo {
  v: 1;
  t0: number;
  cs: number[];
}

/** Cuerpo de `POST /documentos/:id/folios/rehacer`. */
export interface RehacerFolios {
  /** Preguntar al juez las páginas dudosas (por defecto, sí). */
  juez?: boolean;
  /** Calcular y contar los cambios sin escribirlos. */
  simular?: boolean;
}

/** Petición para rehacer las imágenes de página de un PDF. */
export interface RehacerPaginas {
  /** Solo cuenta lo que haría (páginas, cuáles no tienen imagen completa), sin convertir nada. */
  simular?: boolean;
}

/** Resultado de rehacer las imágenes de página (rasterizar otra vez el original). */
export interface PaginasRehechas {
  documento: string;
  simulado: boolean;
  /** Unidades de página del documento. */
  paginas: number;
  /** Las que no tenían imagen completa (solo la vista previa de la v1, o nada). */
  sinImagen: number;
  /** Las que ahora tienen imagen y miniatura nuevas. */
  actualizadas: number;
  /** Si el servidor tiene conversor para hacerlo de verdad. */
  conversor: boolean;
  ms: number;
  avisos: string[];
}

/** Resultado de rehacer los folios de un documento. */
export interface FoliosRehechos {
  documento: string;
  /** Unidades de página (0 en audio, vídeo o documentos por secciones: no hay folios que rehacer). */
  unidades: number;
  /** Páginas cuyo folio impreso cambió. */
  cambiadas: number;
  /** Anclas reescritas (folio, origen o confianza). */
  actualizadas: number;
  fragmentos: number;
  figuras: number;
  /** De dónde salió la numeración: lecturas en secuencia o etiquetas del PDF. */
  fuente: 'secuencia' | 'etiquetas' | null;
  estrategia: 'leido' | 'deducido' | 'ninguno' | null;
  /** «física: antes → después» (los 50 primeros). */
  cambios: string[];
  avisos: string[];
  simulado: boolean;
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
  /** Dónde está dentro de la página (0-1), si la ingesta lo guardó; `imagenUrl` es entonces la página entera. */
  region?: { x: number; y: number; w: number; h: number };
  /** Fotogramas de vídeo: el segundo. */
  t?: number;
  /** Fotogramas: es un cambio de escena (no un muestreo periódico). */
  escena?: boolean;
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

export interface ImportarRecursos {
  /** Id del documento tal y como viene en el .spdf (no debe existir aún en la estantería). */
  documento: string;
  /** Rutas relativas al prefijo del documento: «original.pdf», «paginas/0001.jpg». */
  recursos: Array<{ ruta: string; mime: string; bytes?: number }>;
}

export interface PedirPartesImportacion {
  clave: string;
  idSubida: string;
  numeros: number[];
}

export interface CompletarPartesImportacion {
  clave: string;
  idSubida: string;
  partes: Array<{ numero: number; etag: string }>;
}

export interface ImportacionSpdf {
  documento: string;
  /** Versión del fichero de origen (300 o 400). */
  versionOrigen: number;
  /** Si faltaban vectores del espacio base, se lanza una tarea para calcularlos. */
  tarea?: string;
  avisos: string[];
  /** Con `?deduplicar=1`: ya estaba en la estantería (misma huella) y no se ha copiado nada. */
  repetido?: boolean;
}

/** Cómo está un audio o vídeo para reproducirse en el navegador. */
export interface DiagnosticoMedio {
  /** Es un MP4/MOV (los demás formatos no tienen índice que mover). */
  mp4: boolean;
  /** El índice («moov») va delante de los datos: empieza a sonar sin descargar el final. */
  rapido: boolean;
  /** Formatos de las pistas: avc1, hvc1, av01, vp09, mp4a, Opus… */
  codecs: string[];
  /** Los que algún navegador común no reproduce (AV1, VP9 o HEVC dentro de MP4). */
  dudosos: string[];
}

export interface MedioPreparado {
  /** «ya»: no hacía falta; «hecho»: índice movido; «no_mp4»; «no_se_puede» (índice enorme o desplazamientos de 64 bits). */
  estado: 'ya' | 'hecho' | 'no_mp4' | 'no_se_puede';
  diagnostico?: DiagnosticoMedio;
  ms?: number;
}
