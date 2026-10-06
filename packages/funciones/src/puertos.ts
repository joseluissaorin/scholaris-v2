/**
 * Lo que necesitan las funciones de investigación para trabajar.
 *
 * Todo son puertos de `@scholaris/nucleo` más dos pequeños contratos propios:
 * el `Buscador` (que monta la plataforma con `@scholaris/busqueda`; si no hay,
 * se usa el buscador local léxico + denso sobre la estantería) y el `Emisor`
 * de alertas. Nada de Cloudflare ni de Node: el mismo código corre dentro de
 * un Durable Object y en `apps/local`.
 */

import type { EventoTiempoReal } from '@scholaris/contrato';
import type {
  Emisor,
  Embebedor,
  Filtros,
  IndiceVectorial,
  Inteligencia,
  Juez,
  Redactor,
  Reordenador,
  Resultado,
  SQL,
} from '@scholaris/nucleo';

/** Confianza de una respuesta, en la escala que usa la interfaz. */
export type ConfianzaRespuesta = 'alta' | 'media' | 'baja';

export interface PeticionBusqueda {
  consulta: string;
  filtros?: Filtros;
  /** Número de resultados (fragmentos) que se quieren. */
  k?: number;
  /** Pide además una respuesta redactada, si el buscador sabe darla. */
  respuesta?: boolean;
  idioma?: string;
}

export interface RespuestaBusqueda {
  resultados: Resultado[];
  respuesta?: { texto: string; confianza?: ConfianzaRespuesta } | null;
  /** Vector de la consulta, si se calculó (sirve al historial y a los insights). */
  vectorConsulta?: Float32Array;
  espacio?: string;
}

/** La búsqueda de la plataforma, vista desde aquí. */
export interface Buscador {
  buscar(peticion: PeticionBusqueda): Promise<RespuestaBusqueda>;
}

/** Eventos que las funciones emiten en tiempo real (los del contrato). */
export type EventoFunciones = EventoTiempoReal;

/** Un paso de una tarea larga (mapa de conceptos, extracción, grafo). */
export interface EventoProgreso {
  fase: string;
  estado: 'inicio' | 'avance' | 'hecho' | 'error';
  mensaje: string;
  /** 0-1 global, si se sabe. */
  avance?: number;
  detalle?: Record<string, unknown>;
  /** Milisegundos desde el inicio de la tarea. */
  ms: number;
}

export type AlProgreso = (evento: EventoProgreso) => void | Promise<void>;

/** Lo que reciben los módulos de dominio. Solo `sql` es obligatorio. */
export interface PuertosFunciones {
  /** La estantería del usuario (SQLite del Durable Object o un fichero local). */
  sql: SQL;
  usuario: UsuarioFunciones;
  inteligencia?: Partial<Pick<Inteligencia, 'embebedor' | 'reordenador' | 'juez' | 'redactor'>>;
  indice?: IndiceVectorial;
  buscador?: Buscador;
  emisor?: Emisor<EventoFunciones>;
  /** Canal del emisor para este usuario (por defecto «usuario:<id>»). */
  canal?: string;
  /** Para dejar trabajo en marcha tras responder (waitUntil del Worker). */
  enSegundoPlano?: (promesa: Promise<unknown>) => void;
}

export type { Embebedor, Juez, Redactor, Reordenador };

export interface UsuarioFunciones {
  id: string;
  /** Plan de pago: permite el redactor de calidad alta. */
  pro?: boolean;
}

/** Lo que las rutas esperan encontrar en el contexto de Hono: `c.get('funciones')`. */
export interface EntornoFunciones {
  Variables: { funciones: PuertosFunciones };
}
