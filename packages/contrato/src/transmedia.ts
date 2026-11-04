/**
 * Relaciones entre obras y alineaciones (docs/COMPRENSION.md, «Relaciones y
 * alineaciones» y «Transidioma»): qué obra de la biblioteca adapta, traduce,
 * edita o cita a cuál, y qué tramo de una corresponde a qué tramo de la otra.
 *
 *   GET    /documentos/:id/relaciones          → RelacionVista[]
 *   POST   /documentos/:id/alinear             PedirAlineacion → TransmediaLanzada (202)
 *   GET    /relaciones/:id                     → RelacionVista (con su ficha)
 *   GET    /relaciones/:id/alineaciones?tipo=&desde=&limite= → Pagina<Alineacion>
 *   POST   /relaciones                         PedirRelacion → RelacionVista (201)
 *   POST   /relaciones/:id/confirmar           → RelacionVista
 *   DELETE /relaciones/:id                     → { borrada: true }
 *   POST   /transmedia/biblioteca              PedirTransmediaBiblioteca → TransmediaLanzada (202)
 *
 * En una relación, `origen` adapta, traduce, edita o cita a `destino`. En sus
 * alineaciones, el lado `a` es siempre el del origen y el `b`, el del destino.
 */
import type { Ficha, Relacion, TipoEntrada, TipoRelacion } from '@scholaris/nucleo';

/** La otra obra de una relación, lo justo para mostrarla. */
export interface ObraRelacionada {
  id: string;
  titulo: string;
  /** Nombres para mostrar («Tomás Gutiérrez Alea»). */
  autores: string[];
  anio?: number;
  tipo: TipoEntrada;
}

export interface EstadoAlineacionVista {
  estado: 'en_marcha' | 'hecho' | 'error';
  alineaciones: number;
  usd: number;
  avisos: string[];
  error?: string;
  actualizado: string;
  /** Avance: grupos (o ventanas de párrafos) guardados de cuántos. */
  hechos?: number;
  total?: number;
}

export interface RelacionVista extends Relacion {
  /** La otra obra (vista desde el documento que se pide; en GET /relaciones/:id, el destino). */
  otro: ObraRelacionada;
  /** Qué lado ocupa el documento que se pide: «origen» (adapta, traduce…) o «destino». */
  sentido: 'origen' | 'destino';
  /** Cuántas alineaciones tiene. */
  alineaciones: number;
  /** La ficha de la relación (objetivo «relacion»), si ya está escrita. */
  ficha?: Ficha;
  /** La puso o la confirmó el usuario (`fuente: 'usuario'`). */
  confirmada: boolean;
  estadoAlineacion?: EstadoAlineacionVista;
}

export interface PedirRelacion {
  origen: string;
  destino: string;
  tipo: TipoRelacion;
  nota?: string;
}

export interface PedirAlineacion {
  /** Solo esta relación del documento (por defecto, todas las que se alinean). */
  relacion?: string;
  /** Rehacer aunque esté al día. */
  forzar?: boolean;
}

export interface PedirTransmediaBiblioteca {
  /** Solo los pares en que intervienen estos documentos (por defecto, toda la biblioteca). */
  documentos?: string[];
  /** Alinear lo que quede por alinear (por defecto, sí). */
  alinear?: boolean;
  forzar?: boolean;
}

export interface TransmediaLanzada {
  /** Instancia del Workflow (o de la cola local) que detecta y alinea; null si no hay quien la lleve. */
  instancia: string | null;
  /** Relaciones que hay ahora (antes de esta pasada) en el ámbito pedido. */
  relaciones: number;
}
