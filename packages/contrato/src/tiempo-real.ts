/**
 * Tareas en segundo plano y tiempo real.
 *
 *   GET    /tareas?activas=1                 → Tarea[]
 *   GET    /tareas/:id                       → Tarea
 *   POST   /tareas/:id/reintentar            → Tarea
 *   DELETE /tareas/:id                       → Ok   (cancela)
 *
 *   POST   /tiempo-real/billete  { tarea? }  → Billete
 *   GET    /tiempo-real?billete=…            → WebSocket (Upgrade)
 *
 * El navegador no puede poner cabeceras en un WebSocket: primero pide un
 * billete (firmado, caduca en 60 s, atado al usuario y, si se da, a la tarea)
 * y abre el socket con él. Sin `tarea`, el socket recibe los eventos del
 * usuario (todas sus tareas y alertas).
 *
 * Cliente → servidor: MensajeCliente. Servidor → cliente: EventoTiempoReal.
 *
 * Latido: el cliente manda el texto «ping» cada 25 s y recibe «pong» (sin
 * JSON). Al conectar (o reconectar) el servidor reenvía el último progreso o
 * el `fin` de la tarea, así que nadie se pierde el final por llegar tarde.
 */

import type { FaseIngesta, Progreso } from '@scholaris/nucleo';
import type { Alerta } from './funciones.js';
import type { EstadoTarea } from './citas.js';

export type TipoTarea = 'ingesta' | 'autocita' | 'informe_concepto' | 'mapa' | 'importacion' | 'reproceso' | 'exportacion';

export interface Tarea {
  id: string;
  tipo: TipoTarea;
  estado: EstadoTarea;
  documento?: string;
  /** Último progreso conocido. */
  progreso?: Progreso;
  error?: string;
  creada: string;
  actualizada: string;
  terminada?: string;
}

export interface PedirBillete {
  tarea?: string;
}

export interface Billete {
  billete: string;
  /** URL completa del WebSocket (wss://…/api/v2/tiempo-real?billete=…). */
  url: string;
  caduca: string;
}

export type EventoTiempoReal =
  | { tipo: 'hola'; usuario: string; tarea?: string }
  | { tipo: 'progreso'; progreso: Progreso }
  /** Unidades nuevas ya legibles (la interfaz enseña páginas mientras se procesa). */
  /** Unidades [desde, hasta] (orden base 0) ya legibles; con `buscables`, su texto ya está en el índice. */
  | { tipo: 'unidades'; tarea: string; documento: string; desde: number; hasta: number; buscables?: boolean }
  | { tipo: 'fase'; tarea: string; documento: string; fase: FaseIngesta; ms?: number }
  | { tipo: 'fin'; tarea: string; documento?: string; estado: EstadoTarea; error?: string }
  | { tipo: 'alerta'; alerta: Alerta }
  | { tipo: 'pong'; t: number };

export type MensajeCliente =
  | { tipo: 'ping'; t: number }
  /** Suscribirse a otra tarea por el mismo socket de usuario. */
  | { tipo: 'seguir'; tarea: string };
