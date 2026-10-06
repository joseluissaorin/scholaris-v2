/**
 * Durable Object `Tarea`: reparte por WebSocket (hibernable) los eventos de
 * una tarea o de un usuario. Hay uno por tarea («tarea:<usuario>:<tarea>») y
 * uno por usuario («usuario:<usuario>»). Guarda el último progreso para que
 * quien se conecte tarde vea el estado al instante.
 */
import { DurableObject } from 'cloudflare:workers';
import type { EventoTiempoReal, MensajeCliente } from '@scholaris/contrato';
import type { Env } from './env.js';

export class Tarea extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // El latido del cliente («ping») se contesta sin despertar al objeto hibernado.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(peticion: Request): Promise<Response> {
    if (peticion.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Solo WebSocket', { status: 426 });
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(servidor);
    const usuario = peticion.headers.get('x-scholaris-usuario') ?? '';
    const tarea = peticion.headers.get('x-scholaris-tarea') ?? undefined;
    servidor.send(JSON.stringify({ tipo: 'hola', usuario, ...(tarea ? { tarea } : {}) } satisfies EventoTiempoReal));
    const ultimo = await this.ctx.storage.get<EventoTiempoReal>('ultimo');
    if (ultimo) servidor.send(JSON.stringify(ultimo));
    return new Response(null, { status: 101, webSocket: cliente });
  }

  /** RPC: reparte un evento a todos los conectados. */
  async emitir(evento: EventoTiempoReal): Promise<number> {
    if (evento.tipo === 'progreso' || evento.tipo === 'fin') await this.ctx.storage.put('ultimo', evento);
    const texto = JSON.stringify(evento);
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(texto); n++; } catch { /* socket cerrado */ }
    }
    // Las tareas terminadas se olvidan al cabo de un día.
    if (evento.tipo === 'fin') await this.ctx.storage.setAlarm(Date.now() + 86400_000);
    return n;
  }

  /** RPC: contador atómico (pliegos leídos, tramos transcritos). */
  async sumar(clave: string, n = 1): Promise<number> {
    const v = ((await this.ctx.storage.get<number>(`c:${clave}`)) ?? 0) + n;
    await this.ctx.storage.put(`c:${clave}`, v);
    return v;
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async webSocketMessage(ws: WebSocket, mensaje: string | ArrayBuffer): Promise<void> {
    try {
      const m = JSON.parse(typeof mensaje === 'string' ? mensaje : new TextDecoder().decode(mensaje)) as MensajeCliente;
      if (m.tipo === 'ping') ws.send(JSON.stringify({ tipo: 'pong', t: m.t } satisfies EventoTiempoReal));
    } catch { /* mensaje no válido: se ignora */ }
  }

  async webSocketClose(ws: WebSocket, codigo: number, motivo: string): Promise<void> {
    try { ws.close(codigo, motivo); } catch { /* ya cerrado */ }
  }
}

/** Nombre del DO de reparto para un canal y un evento. */
export function nombresCanal(usuario: string, evento: EventoTiempoReal): string[] {
  const nombres = [`usuario:${usuario}`];
  const tarea = evento.tipo === 'progreso' ? evento.progreso.tarea : 'tarea' in evento ? (evento as { tarea?: string }).tarea : undefined;
  if (tarea) nombres.push(`tarea:${usuario}:${tarea}`);
  return nombres;
}
