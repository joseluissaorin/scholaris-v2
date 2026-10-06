/**
 * Cliente del conversor del servidor (Container en Cloudflare, o cualquier
 * servicio con la misma API): manda el original en flujo y va guardando las
 * partes según llegan.
 */
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { ArchivoConvertir } from './motor-ingesta.js';
import { ErrorReserva } from './reserva.js';
import { leerTramas } from './tramas.js';

/** Recortador del conversor: la región (0-1) de una imagen, en JPEG. Lo usan los vectores de las figuras. */
export type Recortador = (imagen: { bytes: Uint8Array; mime: string }, region: { x: number; y: number; w: number; h: number }) => Promise<{ bytes: Uint8Array; mime: string } | null>;

export function recortadorRemoto(llamar: (peticion: Request) => Promise<Response>): Recortador {
  return async (imagen, region) => {
    const q = new URLSearchParams({ x: String(region.x), y: String(region.y), w: String(region.w), h: String(region.h) });
    const r = await llamar(new Request(`http://conversor/recortar?${q}`, { method: 'POST', body: imagen.bytes as unknown as BodyInit, headers: { 'content-type': imagen.mime } }));
    if (!r.ok) return null;
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') ?? 'image/jpeg' };
  };
}

export function conversorRemoto(llamar: (peticion: Request) => Promise<Response>) {
  return async (a: ArchivoConvertir, guardar: (id: string, datos: Uint8Array, mime: string) => Promise<void>): Promise<PaqueteConversion> => {
    const q = new URLSearchParams({ nombre: a.nombre, mime: a.mime, ...(a.tipo ? { tipo: a.tipo } : {}) });
    const r = await llamar(new Request(`http://conversor/convertir?${q}`, { method: 'POST', body: await a.flujo(), duplex: 'half' } as RequestInit));
    if (!r.ok || !r.body) throw new Error(`El conversor respondió ${r.status}`);
    for await (const { cabecera, datos } of leerTramas(r.body)) {
      if (cabecera.tipo === 'parte' && cabecera.id) await guardar(cabecera.id, datos, cabecera.mime ?? 'application/octet-stream');
      else if (cabecera.tipo === 'fin') return cabecera.paquete as PaqueteConversion;
      else if (cabecera.tipo === 'error') throw new ErrorReserva(`No he podido convertir el fichero: ${String(cabecera.mensaje)}`);
    }
    throw new Error('El conversor cortó la respuesta antes de terminar');
  };
}
