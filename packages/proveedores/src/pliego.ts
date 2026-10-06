/**
 * Lógica de pliego común a los lectores: cuántas páginas trae la entrada y
 * cómo partirla en dos cuando la respuesta no cabe o llega rota.
 */

import type { PaginaLeida } from '@scholaris/nucleo';
import { contarPaginasPdf, cortarPdf } from './pdf.js';
import { ErrorProveedor } from './comun.js';

export interface EntradaPliego {
  pdf?: Uint8Array;
  imagenes?: Array<{ bytes: Uint8Array; mime: string }>;
  primeraFisica: number;
  pista?: string;
}

/** Error que indica que la respuesta no cabía o no se pudo interpretar: partir el pliego puede arreglarlo. */
export class ErrorPliego extends ErrorProveedor {
  constructor(proveedor: string, mensaje: string, causa?: unknown) {
    super(proveedor, mensaje, { reintentable: false, causa });
    this.name = 'ErrorPliego';
  }
}

export async function paginasDe(entrada: EntradaPliego): Promise<number> {
  if (entrada.imagenes?.length) return entrada.imagenes.length;
  if (entrada.pdf) return contarPaginasPdf(entrada.pdf);
  throw new Error('leerPliego: hace falta `pdf` o `imagenes`');
}

async function mitades(entrada: EntradaPliego, n: number): Promise<[EntradaPliego, EntradaPliego]> {
  const m = Math.ceil(n / 2);
  if (entrada.imagenes?.length) {
    return [
      { ...entrada, imagenes: entrada.imagenes.slice(0, m) },
      { ...entrada, imagenes: entrada.imagenes.slice(m), primeraFisica: entrada.primeraFisica + m },
    ];
  }
  const pdf = entrada.pdf as Uint8Array;
  return [
    { ...entrada, pdf: await cortarPdf(pdf, 0, m) },
    { ...entrada, pdf: await cortarPdf(pdf, m, n), primeraFisica: entrada.primeraFisica + m },
  ];
}

/**
 * Lee un pliego con `leer`; si falla con `ErrorPliego` (salida cortada, JSON
 * roto, páginas que faltan), lo parte en dos y lee cada mitad. Así un pliego
 * de 16 páginas densas nunca se pierde entero.
 */
export async function leerPartiendo(
  entrada: EntradaPliego,
  leer: (e: EntradaPliego, n: number) => Promise<PaginaLeida[]>,
  opciones: { maxPaginas?: number } = {},
): Promise<PaginaLeida[]> {
  const n = await paginasDe(entrada);
  const max = opciones.maxPaginas ?? Infinity;
  if (n > max) {
    const [a, b] = await mitades(entrada, n);
    const [ra, rb] = await Promise.all([leerPartiendo(a, leer, opciones), leerPartiendo(b, leer, opciones)]);
    return [...ra, ...rb];
  }
  try {
    return await leer(entrada, n);
  } catch (e) {
    if (!(e instanceof ErrorPliego) || n <= 1) throw e;
    const [a, b] = await mitades(entrada, n);
    const [ra, rb] = await Promise.all([leerPartiendo(a, leer, opciones), leerPartiendo(b, leer, opciones)]);
    return [...ra, ...rb];
  }
}
