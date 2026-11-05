/**
 * La capa de comprensión de un documento (docs/COMPRENSION.md).
 *
 *   GET  /documentos/:id/comprension            → MapaComprension
 *   GET  /documentos/:id/segmentos?tipo=&nivel= → Segmento[]
 *   GET  /documentos/:id/fichas?clase=&objetivo=&lente=&segmento=&desde=&limite= → Pagina<Ficha>
 *   GET  /documentos/:id/apariciones?entidad=&segmento=&rol=&desde=&limite=      → Pagina<AparicionVista>
 *   POST /documentos/:id/comprender  PedirComprension → ComprensionLanzada (202)
 *   POST /comprension/biblioteca     PedirComprensionBiblioteca → ComprensionBiblioteca (202)
 *   GET  /comprension                → EstadoComprensionVista[] (las de la biblioteca)
 */
import type { Aparicion, Ficha, Lente, Segmento } from '@scholaris/nucleo';

export type EstadoComprensionValorVista = 'pendiente' | 'en_marcha' | 'hecho' | 'error' | 'sin_modelo';

export interface EstadoComprensionVista {
  documento: string;
  estado: EstadoComprensionValorVista;
  lentes: Lente[];
  version: string;
  /** Pasos terminados («estructura», «fichas:0»…) con su coste. */
  pasos: Record<string, { hecho: string; ms: number; usd: number; detalle?: Record<string, number> }>;
  usd: number;
  tokensEntrada: number;
  tokensSalida: number;
  llamadas: number;
  avisos: string[];
  error?: string;
  /** La paró quien la pidió: al pedirla otra vez sigue donde quedó, sin repetir lo pagado. */
  cancelada?: boolean;
  modelo?: string;
  iniciado: string;
  actualizado: string;
}

/** Respuesta de parar una comprensión (`POST /documentos/:id/comprension/cancelar`). */
export interface ComprensionCancelada {
  documento: string;
  estado: EstadoComprensionValorVista | null;
  error?: string;
  /** Lo gastado hasta ahí. */
  usd: number;
}

/** El mapa de un documento: su estructura (sin los planos), su ficha global y cuánto hay. */
export interface MapaComprension {
  documento: string;
  estado: EstadoComprensionVista | null;
  lentes: Lente[];
  segmentos: Segmento[];
  /** Una ficha global por lente. */
  global: Ficha[];
  totales: { segmentos: number; planos: number; fichas: number; apariciones: number; entidades: number };
}

/** Una aparición con el nombre y el tipo de su entidad del grafo. */
export interface AparicionVista extends Aparicion {
  nombre: string;
  tipo: string;
}

export interface PedirComprension {
  /** Rehacer aunque ya esté hecha con esta versión. */
  forzar?: boolean;
  /** Fijar las lentes (la primera manda en la estructura). */
  lentes?: Lente[];
  /** Solo el modelo rápido. */
  economico?: boolean;
  /**
   * Tope estricto de gasto de esta comprensión, en dólares. Antes de cada paso se suma lo que costará y
   * se guarda lo de la ficha global: lo que no cabe no se hace (con aviso). Si ni la estructura ni la
   * global caben, no empieza ni gasta nada. Sin él rige un tope blando de 4 USD.
   */
  presupuestoUsd?: number;
  /** Rehacer solo estos pasos de una comprensión ya hecha (p. ej. «global»), sin repetir ni pagar los demás. */
  rehacer?: Array<'estructura' | 'entidades' | 'personajes' | 'global'>;
}

export interface PedirComprensionBiblioteca extends PedirComprension {
  /** Solo estos documentos (por defecto, todos los listos). */
  documentos?: string[];
}

export interface ComprensionLanzada {
  documento: string;
  /** Instancia del Workflow (o de la cola local); null si ya estaba hecha y no se pidió rehacer. */
  instancia: string | null;
  estado: EstadoComprensionValorVista;
}

export interface ComprensionBiblioteca {
  encolados: number;
  lanzados: number;
}
