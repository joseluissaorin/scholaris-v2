/**
 * Durable Object `Limitador`: ventana deslizante de un minuto por usuario.
 * Vive en memoria: si el objeto se desaloja, la ventana empieza de cero, que
 * es lo razonable para un límite de ritmo (las cuotas van en D1).
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env.js';

export class Limitador extends DurableObject<Env> {
  private marcas: number[] = [];
  // Cupo de escritura vectorial de la cuenta (cubo de fichas, en memoria del objeto «cupo:vectorize»).
  private fichas = 4000;
  private ultimaRecarga = Date.now();
  private frenadoHasta = 0;

  /** Milisegundos que hay que esperar antes de escribir `n` vectores (ya descontados). */
  async turnoVectorial(n: number): Promise<number> {
    const ahora = Date.now();
    const ritmo = ahora < this.frenadoHasta ? 250 : 2000; // vectores por segundo
    this.fichas = Math.min(4000, this.fichas + ((ahora - this.ultimaRecarga) / 1000) * ritmo);
    this.ultimaRecarga = ahora;
    this.fichas -= n;
    return this.fichas >= 0 ? 0 : Math.ceil((-this.fichas / ritmo) * 1000);
  }

  /** Vectorize ha devuelto un límite: todos más despacio durante un minuto. */
  async frenarVectorial(): Promise<void> {
    this.frenadoHasta = Date.now() + 60_000;
    this.fichas = Math.min(this.fichas, 0);
  }

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
