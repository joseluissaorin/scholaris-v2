/**
 * El contexto de una conversión: opciones resueltas, canal de eventos con
 * contrapresión y el registro de partes, avisos y tiempos.
 */

import type { Plataforma } from './plataforma.js';
import type { ClaseParte, EventoConversion, OpcionesConversion, ParteBinaria } from './tipos.js';

/** Cola asíncrona acotada: el productor espera si el consumidor no da abasto. */
export class Canal<T> {
  private cola: T[] = [];
  private esperandoDato: Array<(v: IteratorResult<T>) => void> = [];
  private esperandoHueco: Array<() => void> = [];
  private cerrado = false;
  private fallo: unknown = null;

  constructor(private capacidad = 64) {}

  async poner(v: T): Promise<void> {
    if (this.cerrado) return;
    const consumidor = this.esperandoDato.shift();
    if (consumidor) { consumidor({ value: v, done: false }); return; }
    this.cola.push(v);
    if (this.cola.length >= this.capacidad) await new Promise<void>((r) => this.esperandoHueco.push(r));
  }

  get estaCerrado(): boolean {
    return this.cerrado;
  }

  cerrar(error?: unknown): void {
    if (this.cerrado) return;
    this.cerrado = true;
    if (error !== undefined) this.fallo = error;
    for (const r of this.esperandoHueco.splice(0)) r();
    if (!this.cola.length) for (const c of this.esperandoDato.splice(0)) c({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.cola.length) {
        const v = this.cola.shift() as T;
        this.esperandoHueco.shift()?.();
        yield v;
        continue;
      }
      if (this.cerrado) {
        if (this.fallo) throw this.fallo;
        return;
      }
      const r = await new Promise<IteratorResult<T>>((res) => this.esperandoDato.push(res));
      if (r.done) {
        if (this.fallo) throw this.fallo;
        return;
      }
      yield r.value;
    }
  }
}

export interface OpcionesResueltas {
  ladoEscaneada: number;
  ladoDigital: number;
  calidadJpeg: number;
  ladoMiniatura: number;
  hilos: number;
  recortarFiguras: boolean;
  paginas: number[] | null;
  tramo: number;
  solape: number;
  formatoAudio: 'opus' | 'wav';
  intervaloFotogramas: number;
  umbralEscena: number;
  ladoFotograma: number;
  filasPorTramo: number;
  senal: AbortSignal | null;
}

export function resolverOpciones(o: OpcionesConversion, plataforma: Plataforma): OpcionesResueltas {
  return {
    ladoEscaneada: o.ladoEscaneada ?? 1600,
    ladoDigital: o.ladoDigital ?? 1200,
    calidadJpeg: o.calidadJpeg ?? 0.8,
    ladoMiniatura: o.ladoMiniatura ?? 240,
    hilos: o.hilos ?? plataforma.hilosPorDefecto(),
    recortarFiguras: o.recortarFiguras ?? false,
    paginas: o.paginas ?? null,
    tramo: o.tramo ?? 600,
    solape: o.solape ?? 2,
    formatoAudio: o.formatoAudio ?? 'opus',
    intervaloFotogramas: Math.max(10, o.intervaloFotogramas ?? 20),
    umbralEscena: o.umbralEscena ?? 0.18,
    ladoFotograma: o.ladoFotograma ?? 960,
    filasPorTramo: o.filasPorTramo ?? 50,
    senal: o.senal ?? null,
  };
}

export class Contexto {
  readonly partes: ParteBinaria[] = [];
  readonly avisos: string[] = [];
  readonly tiempos: Record<string, number> = {};
  private readonly inicio = performance.now();

  constructor(
    readonly plataforma: Plataforma,
    readonly op: OpcionesResueltas,
    private readonly canal: Canal<EventoConversion>,
  ) {}

  emitir(e: EventoConversion): Promise<void> {
    return this.canal.poner(e);
  }

  comprobar(): void {
    if (this.op.senal?.aborted) throw this.op.senal.reason ?? new Error('Conversión cancelada');
    if (this.canal.estaCerrado) throw new Error('Conversión abandonada por el consumidor');
  }

  async parte(id: string, clase: ClaseParte, mime: string, datos: Uint8Array, extra: Partial<ParteBinaria> = {}): Promise<string> {
    const parte: ParteBinaria = { id, clase, mime, bytes: datos.byteLength, ...extra };
    this.partes.push(parte);
    await this.emitir({ tipo: 'parte', parte, datos });
    return id;
  }

  async aviso(mensaje: string): Promise<void> {
    this.avisos.push(mensaje);
    await this.emitir({ tipo: 'aviso', mensaje });
  }

  /** Mide una fase y la acumula en `tiempos`. */
  async medir<T>(fase: string, fn: () => Promise<T>): Promise<T> {
    const t = performance.now();
    try {
      return await fn();
    } finally {
      this.tiempos[fase] = (this.tiempos[fase] ?? 0) + Math.round(performance.now() - t);
    }
  }

  cerrarTiempos(): Record<string, number> {
    this.tiempos.total = Math.round(performance.now() - this.inicio);
    return this.tiempos;
  }
}

export const num4 = (n: number) => String(n).padStart(4, '0');
