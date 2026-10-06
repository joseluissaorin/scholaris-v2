/**
 * Durable Object `Limitador`: ventana deslizante de un minuto por usuario.
 * Vive en memoria: si el objeto se desaloja, la ventana empieza de cero, que
 * es lo razonable para un límite de ritmo (las cuotas van en D1).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';

export class Limitador extends DurableObject<Env> {
  private marcas: number[] = [];

  async admitir(porMinuto: number): Promise<{ ok: boolean; reintentar?: number }> {
    const ahora = Date.now();
    const desde = ahora - 60_000;
    while (this.marcas.length && (this.marcas[0] as number) < desde) this.marcas.shift();
    if (this.marcas.length >= porMinuto) {
      return { ok: false, reintentar: Math.max(1, Math.ceil(((this.marcas[0] as number) + 60_000 - ahora) / 1000)) };
    }
    this.marcas.push(ahora);
    return { ok: true };
  }
}
