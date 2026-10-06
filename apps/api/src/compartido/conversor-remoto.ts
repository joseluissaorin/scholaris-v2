/**
 * Cliente del conversor del servidor (Container en Cloudflare, o cualquier
 * servicio con la misma API): manda el original en flujo y va guardando las
 * partes según llegan.
 */
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { ArchivoConvertir } from './motor-ingesta.js';
import { ErrorReserva } from './reserva.js';
import { leerTramas } from './tramas.js';

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
