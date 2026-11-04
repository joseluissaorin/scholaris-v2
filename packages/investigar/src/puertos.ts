/**
 * Lo que necesita el agente para investigar. Todo son puertos: el mismo código
 * corre en el Durable Object de cada usuario, en la versión local y en el banco
 * (contra una copia local de la biblioteca).
 */
import type { Buscador } from '@scholaris/busqueda';
import type { PresupuestoInvestigacion, ProfundidadInvestigacion } from '@scholaris/contrato';
import type { Filtros, Region, SQL } from '@scholaris/nucleo';
import type { ModeloAgente } from './modelo.js';

/** Los medios que el agente puede mirar y escuchar. */
export interface MediosInvestigar {
  /**
   * El vídeo o el audio de un documento listo para el modelo (en Gemini Files): el
   * proxy ligero si existe (`<prefijo>proxy.mp4`), si no el original. Null si no hay.
   */
  fuente(documento: string): Promise<{ uri: string; mime: string } | null>;
  /** La imagen de una unidad o de una figura (clave del almacén relativa al documento). */
  imagen(documento: string, clave: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** URL para enseñar esa imagen en la interfaz. */
  url?(documento: string, clave: string): Promise<string | undefined>;
}

/**
 * El anclaje material de las citas de un documento de páginas (docs/COMPRENSION.md,
 * principio 1): su región en la imagen de la página. En un PDF digital sale de la
 * capa de texto (gratis); en un escaneo, de la visión (con caché en el almacén).
 */
export interface AnclajeInvestigar {
  /** La región (fracciones 0-1 de la imagen) de unos caracteres o de una cita de la unidad `orden`; undefined si no se encuentra. */
  region(orden: number, o: { caracteres?: [number, number]; cita?: string; vision?: boolean }): Promise<Region | undefined>;
  /** Lo que lleva gastado (solo cuestan las localizaciones por visión). */
  uso(): { modelo: string; tokensEntrada: number; tokensSalida: number; usd: number; llamadas: number };
}

export interface ModelosInvestigar {
  /** El que planifica y llama a las herramientas. */
  agente: ModeloAgente;
  /** El que escribe la respuesta (por defecto, el agente). */
  redactor?: ModeloAgente;
  /** El que mira y escucha (por defecto, el agente). */
  vision?: ModeloAgente;
  /** El que verifica frase a frase (barato; por defecto, el agente). */
  verificador?: ModeloAgente;
  /** El que corrige las frases que no están del todo sostenidas (por defecto, el redactor). */
  corrector?: ModeloAgente;
}

export interface PuertosInvestigar {
  /** La estantería: esquema SPDF 4.2 (con la comprensión) y el de las funciones. */
  sql: SQL;
  buscador: Buscador;
  modelos: ModelosInvestigar;
  medios?: MediosInvestigar;
  /**
   * El anclaje material de un documento (uno por documento y por investigación). Las
   * citas de la respuesta en una página reciben así su región al terminar.
   */
  anclajeMaterial?(documento: string): AnclajeInvestigar;
  usuario?: { id: string; pro?: boolean };
  /** Reloj (para las pruebas). */
  ahora?: () => number;
}

export interface OpcionesInvestigar {
  filtros?: Filtros;
  profundidad?: ProfundidadInvestigacion;
  /** Tope del presupuesto (el del plan del usuario); la petición solo puede bajarlo. */
  tope?: Partial<PresupuestoInvestigacion>;
  presupuesto?: Partial<PresupuestoInvestigacion>;
  idioma?: string;
  /** Un cuaderno para seguir, `false` para no guardar nada en cuadernos. */
  cuaderno?: string | false;
  sinHistorial?: boolean;
  /** Identificador de la investigación (por defecto, uno nuevo). */
  id?: string;
  signal?: AbortSignal;
}

/** Perfiles de cada profundidad. El plan del usuario los recorta (`tope`). */
export const PERFILES: Record<ProfundidadInvestigacion, PresupuestoInvestigacion & { revisiones: number; resultadosPorBusqueda: number; segundosVer: number }> = {
  rapida: { pasos: 6, segundos: 75, usd: 0.15, revisiones: 2, resultadosPorBusqueda: 5, segundosVer: 180 },
  normal: { pasos: 16, segundos: 210, usd: 0.75, revisiones: 8, resultadosPorBusqueda: 6, segundosVer: 360 },
  exhaustiva: { pasos: 32, segundos: 480, usd: 2.5, revisiones: 16, resultadosPorBusqueda: 8, segundosVer: 600 },
};

export function presupuestoDe(o: OpcionesInvestigar): PresupuestoInvestigacion & { revisiones: number; resultadosPorBusqueda: number; segundosVer: number } {
  const base = { ...PERFILES[o.profundidad ?? 'normal'] };
  for (const k of ['pasos', 'segundos', 'usd'] as const) {
    const pedido = o.presupuesto?.[k];
    const tope = o.tope?.[k];
    if (typeof pedido === 'number' && pedido > 0) base[k] = Math.min(base[k], pedido);
    if (typeof tope === 'number' && tope > 0) base[k] = Math.min(base[k], tope);
  }
  base.pasos = Math.max(1, Math.round(base.pasos));
  return base;
}
