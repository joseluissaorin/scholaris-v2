/**
 * Tiempo real en un solo proceso: canales en memoria («usuario:<id>» y
 * «tarea:<id>:<tarea>») a los que se suscriben los WebSocket. Guarda el último
 * progreso de cada canal para quien llegue tarde.
 */
import type { Emisor } from '@scholaris/nucleo';
import type { EventoTiempoReal } from '@scholaris/contrato';

type Oyente = (e: EventoTiempoReal) => void;

export class CentralTiempoReal {
  private canales = new Map<string, Set<Oyente>>();
  private ultimos = new Map<string, EventoTiempoReal>();

  suscribir(canal: string, oyente: Oyente): () => void {
    let s = this.canales.get(canal);
    if (!s) this.canales.set(canal, (s = new Set()));
    s.add(oyente);
    const u = this.ultimos.get(canal);
    if (u) oyente(u);
    return () => { s!.delete(oyente); if (!s!.size) this.canales.delete(canal); };
  }

  publicar(canal: string, e: EventoTiempoReal): void {
    if (e.tipo === 'progreso' || e.tipo === 'fin') {
      this.ultimos.set(canal, e);
      if (this.ultimos.size > 2000) this.ultimos.delete(this.ultimos.keys().next().value as string);
    }
    for (const o of this.canales.get(canal) ?? []) {
      try { o(e); } catch { /* oyente roto */ }
    }
  }

  emisorDe(usuario: string): Emisor<EventoTiempoReal> {
    return {
      emitir: async (_canal, e) => {
        this.publicar(`usuario:${usuario}`, e);
        const tarea = e.tipo === 'progreso' ? e.progreso.tarea : 'tarea' in e ? (e as { tarea?: string }).tarea : undefined;
        if (tarea) this.publicar(`tarea:${usuario}:${tarea}`, e);
      },
    };
  }
}
