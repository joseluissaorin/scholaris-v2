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

/**
 * Recorta una región (0-1 sobre el ancho y el alto) de una imagen y la devuelve
 * en JPEG, como mucho de `maximo` px de lado: el recorte de una figura para su
 * vector. Las regiones que se salen de la imagen se ajustan a ella.
 */
export async function recortarImagen(bytes: Uint8Array, region: { x: number; y: number; w: number; h: number }, maximo = 1024): Promise<{ bytes: Uint8Array; mime: string }> {
  const img = await plataformaNode.decodificarImagen(bytes);
  const x0 = Math.max(0, Math.min(1, region.x)), y0 = Math.max(0, Math.min(1, region.y));
  const x1 = Math.max(x0, Math.min(1, region.x + region.w)), y1 = Math.max(y0, Math.min(1, region.y + region.h));
  const sx = Math.round(x0 * img.ancho), sy = Math.round(y0 * img.alto);
  const sw = Math.max(1, Math.round((x1 - x0) * img.ancho)), sh = Math.max(1, Math.round((y1 - y0) * img.alto));
  const escala = Math.min(1, maximo / Math.max(sw, sh));
  const lienzo = plataformaNode.crearLienzo(Math.max(1, Math.round(sw * escala)), Math.max(1, Math.round(sh * escala)));
  (lienzo.ctx as unknown as { drawImage: (...a: unknown[]) => void }).drawImage(img.fuente, sx, sy, sw, sh, 0, 0, lienzo.ancho, lienzo.alto);
  img.cerrar();
  return { bytes: await plataformaNode.aJpeg(lienzo, 0.85), mime: 'image/jpeg' };
}
