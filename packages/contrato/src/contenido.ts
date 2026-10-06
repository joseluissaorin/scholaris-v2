/**
 * Todo lo que contiene un .spdf, para verlo y recorrerlo (el inspector de la
 * web y quien quiera auditar una ingesta).
 *
 *   GET /documentos/:id/contenido                         → ContenidoDocumento  (el resumen de todo, una sola petición)
 *   GET /documentos/:id/contenido/unidades?desde=&hasta=   → UnidadInspeccion[]  (orden base 0, ambos incluidos; máx. 50)
 *   GET /documentos/:id/contenido/fragmentos?cursor=&limite=&unidad= → Pagina<FragmentoInspeccion>  (en orden; máx. 200)
 *   GET /documentos/:id/contenido/mapa?espacio=&max=      → MapaVectores  (proyección 2D de una muestra de vectores)
 *
 * Figuras e imágenes de toda la biblioteca (no dentro de una biblioteca compartida):
 *
 *   GET /figuras?q=&documento=&tipo=&limite=              → FiguraEncontrada[]  (por la descripción, el pie y el vector de la imagen)
 *   GET /figuras/:id/parecidas?k=                        → FiguraEncontrada[]  (las que más se le parecen, por su vector)
 *
 * Las figuras de un documento siguen en `GET /documentos/:id/figuras`
 * (FiguraVista, que ahora lleva `region`, `t` y `escena` cuando la ingesta los
 * guardó). Numeración: `orden` y `unidad` son BASE 0, como en documentos.ts.
 */

import type { Ancla, EspacioVectorial, TipoEntrada } from '@scholaris/nucleo';

/** Región normalizada 0-1 de una figura dentro de su página. */
export interface RegionFigura { x: number; y: number; w: number; h: number }

export interface ContenidoDocumento {
  documento: string;
  /** El fichero: versión del SPDF, generador, huella, tamaño y tipo del original. */
  archivo: {
    spdfVersion: string;
    /** La tabla clave/valor `spdf` (en la estantería es la de toda la estantería). */
    claves: Record<string, string>;
    huella: string;
    bytes: number;
    mime: string;
    /** Clave del original en el almacén ('' si iba incrustado). */
    original: string;
    creado: string;
    actualizado: string;
  };
  cuentas: {
    unidades: number;
    /** Unidades con imagen de página, fotograma o diapositiva. */
    conImagen: number;
    conNotas: number;
    conCabecera: number;
    /** Unidades con pie de página (texto del pie impreso). */
    conPiePagina: number;
    fragmentos: number;
    /** Fragmentos con capa de búsqueda modernizada (texto_busqueda no vacío). */
    conBusqueda: number;
    secciones: number;
    figuras: number;
    /** De ellas, fotogramas clave (ancla de tiempo). */
    fotogramas: number;
    descritas: number;
    /** Figuras con pie impreso. */
    figurasConPie: number;
    vectores: number;
    caracteres: number;
  };
  /** Qué lector leyó cuántas unidades y con qué confianza. */
  lectores: Array<{ lector: string; unidades: number; confianzaMedia: number; confianzaMin: number }>;
  /** De dónde salen los folios impresos (solo documentos paginados). */
  folios: { leido: number; deducido: number; epub: number; ninguno: number; romanas: number; dudosos: number } | null;
  espacios: Array<EspacioVectorial & { vectores: number; porObjetivo: Record<string, number> }>;
  /** Audio y vídeo: quién habla, cuántos turnos y cuánto tiempo. */
  hablantes: Array<{ nombre: string; turnos: number; segundos: number }>;
  procedencia: Array<{ fase: string; proveedor?: string; detalle?: unknown; ms?: number; cuando: string }>;
  /** Lo que gastó la ingesta en el plan: páginas de lectura o minutos de transcripción. */
  coste: { unidades: number; medida: 'paginas' | 'minutos'; llamadas: number; msTotal: number };
}

export interface UnidadInspeccion {
  id: string;
  orden: number;
  ancla: Ancla;
  etiqueta: string;
  texto: string;
  notas?: string[];
  cabecera?: string;
  pie?: string;
  imagenUrl?: string;
  miniaturaUrl?: string;
  lector: string;
  confianza: number;
  impresa?: string;
  t0?: number;
  t1?: number;
  /** Palabras con instante exacto (audio y vídeo). */
  palabras?: number;
  fragmentos: number;
  figuras: number;
}

export interface FragmentoInspeccion {
  id: string;
  /** Orden de la unidad (base 0). */
  unidad: number;
  orden: number;
  texto: string;
  contexto: string;
  seccion: string[];
  ancla: Ancla;
  anclaFin?: Ancla;
  etiqueta: string;
  /** Capa de búsqueda en grafía moderna: null si aún no se calculó, '' si no aporta nada. */
  textoBusqueda: string | null;
  /** Espacios en los que tiene vector. */
  vectores: string[];
}

export interface MapaVectores {
  espacio: string;
  dims: number;
  /** Vectores que hay en el espacio para este documento. */
  total: number;
  /** Proyección a 2D (componentes principales) de una muestra; x e y en [-1, 1]. */
  puntos: Array<{ objetivo: 'fragmento' | 'unidad' | 'figura'; id: string; x: number; y: number; etiqueta: string; texto: string; unidad?: number }>;
  /** Varianza que explican los dos ejes (0-1). */
  varianza: [number, number];
}

export interface FiguraEncontrada {
  id: string;
  documento: string;
  titulo: string;
  tipo: TipoEntrada;
  unidad: number;
  imagenUrl: string;
  pie?: string;
  descripcion?: string;
  ancla: Ancla;
  etiqueta: string;
  region?: RegionFigura;
  t?: number;
  /** Cómo de bien encaja (0-1). */
  puntuacion: number;
  /** Por dónde salió: el texto (descripción, pie), el vector de la imagen, o ambos. */
  vias: Array<'texto' | 'imagen'>;
}

/** La figura que respalda un resultado de búsqueda (lámina, diagrama, fotograma). */
export interface FiguraResultado {
  id: string;
  imagenUrl: string;
  pie?: string;
  descripcion?: string;
  region?: RegionFigura;
  t?: number;
}
