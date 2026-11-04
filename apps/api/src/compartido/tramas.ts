/**
 * Tramas binarias del conversor: [4 bytes: largo de la cabecera][cabecera JSON]
 * [4 bytes: largo de los datos][datos]. Sirven para devolver un paquete con
 * cientos de imágenes sin base64 y sin tenerlo todo en memoria.
 */
/** `trozo`: un pedazo de una parte grande (el proxy de un vídeo), con su posición `desde` y el `total`. */
export interface CabeceraTrama { tipo: 'parte' | 'trozo' | 'fin' | 'error' | 'progreso'; id?: string; mime?: string; [k: string]: unknown }

export function codificarTrama(cabecera: CabeceraTrama, datos: Uint8Array = new Uint8Array()): Uint8Array {
  const c = new TextEncoder().encode(JSON.stringify(cabecera));
  const out = new Uint8Array(8 + c.length + datos.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, c.length);
  out.set(c, 4);
  v.setUint32(4 + c.length, datos.length);
  out.set(datos, 8 + c.length);
  return out;
}

/** Lee tramas de un flujo según llegan. Al dejar de leer cierra el flujo: sin eso, el Container da la petición por no terminada y no se duerme. */
export async function* leerTramas(flujo: ReadableStream<Uint8Array>): AsyncGenerator<{ cabecera: CabeceraTrama; datos: Uint8Array }> {
  const lector = flujo.getReader();
  let buf: Uint8Array = new Uint8Array(0);
  // Los trozos leídos se juntan una sola vez: copiar el acumulado en cada lectura era
  // cuadrático con tramas de varios MB (los trozos del proxy de un vídeo).
  const pedir = async (n: number): Promise<boolean> => {
    if (buf.length >= n) return true;
    const pendientes: Uint8Array[] = [buf];
    let total = buf.length;
    while (total < n) {
      const { value, done } = await lector.read();
      if (done) { buf = juntar(pendientes, total); return false; }
      pendientes.push(value);
      total += value.length;
    }
    buf = juntar(pendientes, total);
    return true;
  };
  const tomar = (n: number) => { const x = buf.slice(0, n); buf = buf.slice(n); return x; };
  try {
    for (;;) {
      if (!(await pedir(4))) return;
      const lc = new DataView(buf.buffer, buf.byteOffset).getUint32(0); tomar(4);
      if (!(await pedir(lc + 4))) throw new Error('Trama cortada');
      const cabecera = JSON.parse(new TextDecoder().decode(tomar(lc))) as CabeceraTrama;
      const ld = new DataView(buf.buffer, buf.byteOffset).getUint32(0); tomar(4);
      if (!(await pedir(ld))) throw new Error('Trama cortada');
      yield { cabecera, datos: tomar(ld) };
    }
  } finally {
    await lector.cancel().catch(() => undefined);
  }
}

function juntar(trozos: Uint8Array[], total: number): Uint8Array {
  if (trozos.length === 1) return trozos[0]!;
  const out = new Uint8Array(total);
  let o = 0;
  for (const t of trozos) { out.set(t, o); o += t.length; }
  return out;
}
