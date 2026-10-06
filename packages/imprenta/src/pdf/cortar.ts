/**
 * Pliegos: trozos de varias páginas de un PDF, para mandarlos a un lector de
 * visión como PDF en vez de como imágenes cuando sale más barato.
 */

import { PDFDocument } from 'pdf-lib';

/** Un cortador abre el PDF una vez y saca tantos pliegos como haga falta. */
export interface CortadorPdf {
  readonly paginas: number;
  /** Páginas físicas `desde`..`hasta`, ambas incluidas, desde 1. */
  cortar(desde: number, hasta: number): Promise<Uint8Array>;
}

export async function abrirCortador(bytes: Uint8Array): Promise<CortadorPdf> {
  const origen = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const total = origen.getPageCount();
  return {
    paginas: total,
    async cortar(desde, hasta) {
      const a = Math.max(1, Math.floor(desde));
      const b = Math.min(total, Math.floor(hasta));
      if (a > b) throw new RangeError(`Pliego vacío: ${desde}-${hasta} de ${total}`);
      const destino = await PDFDocument.create({ updateMetadata: false });
      const indices = Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
      const copiadas = await destino.copyPages(origen, indices);
      for (const p of copiadas) destino.addPage(p);
      return destino.save({ useObjectStreams: true });
    },
  };
}

/** Atajo para un solo pliego. Si vas a cortar muchos, usa `abrirCortador`. */
export async function cortarPdf(bytes: Uint8Array, desde: number, hasta: number): Promise<Uint8Array> {
  return (await abrirCortador(bytes)).cortar(desde, hasta);
}

/** Reparte `total` páginas en pliegos de como mucho `tam` páginas: [[1,10],[11,20]…]. */
export function planPliegos(total: number, tam = 10): Array<[number, number]> {
  const salida: Array<[number, number]> = [];
  for (let a = 1; a <= total; a += tam) salida.push([a, Math.min(total, a + tam - 1)]);
  return salida;
}
