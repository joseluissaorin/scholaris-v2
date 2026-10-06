/**
 * La imprenta en Node: `import { convertir, convertirRuta } from '@scholaris/imprenta/node'`.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { crearConvertidor, recolectar } from '../convertir.js';
import type { ArchivoEntrada, EventoConversion, OpcionesConversion, PaqueteEnMemoria } from '../tipos.js';
import { plataformaNode } from './plataforma-node.js';

export { plataformaNode } from './plataforma-node.js';
export * from '../index.js';

export const convertir = crearConvertidor(plataformaNode);

/** Convierte un archivo del disco (o varios, si son las fotos de un libro). */
export async function* convertirRuta(ruta: string | string[], opciones: OpcionesConversion = {}): AsyncGenerator<EventoConversion> {
  const rutas = Array.isArray(ruta) ? ruta : [ruta];
  const archivos: ArchivoEntrada[] = await Promise.all(rutas.map(async (r) => ({ nombre: basename(r), bytes: new Uint8Array(await readFile(r)) })));
  const primero = archivos[0];
  if (!primero) throw new Error('Sin archivos');
  yield* convertir(primero, archivos.length > 1 ? { ...opciones, fotos: archivos } : opciones);
}

/** Atajo: convierte y devuelve el paquete con sus bytes. */
export function convertirEnMemoria(ruta: string | string[], opciones: OpcionesConversion = {}, alEvento?: (e: EventoConversion) => void): Promise<PaqueteEnMemoria> {
  return recolectar(convertirRuta(ruta, opciones), alEvento);
}
