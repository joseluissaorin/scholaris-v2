/**
 * Tramas binarias del conversor: [4 bytes: largo de la cabecera][cabecera JSON]
 * [4 bytes: largo de los datos][datos]. Sirven para devolver un paquete con
 * cientos de imágenes sin base64 y sin tenerlo todo en memoria.
 */
export interface CabeceraTrama { tipo: 'parte' | 'fin' | 'error' | 'progreso'; id?: string; mime?: string; [k: string]: unknown }

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

/** Lee tramas de un flujo según llegan. */
export async function* leerTramas(flujo: ReadableStream<Uint8Array>): AsyncGenerator<{ cabecera: CabeceraTrama; datos: Uint8Array }> {
  const lector = flujo.getReader();
  let buf = new Uint8Array(0);
  const pedir = async (n: number): Promise<boolean> => {
    while (buf.length < n) {
      const { value, done } = await lector.read();
      if (done) return false;
      const nuevo = new Uint8Array(buf.length + value.length);
      nuevo.set(buf); nuevo.set(value, buf.length);
      buf = nuevo;
    }
    return true;
  };
  const tomar = (n: number) => { const x = buf.slice(0, n); buf = buf.slice(n); return x; };
  for (;;) {
    if (!(await pedir(4))) return;
    const lc = new DataView(buf.buffer, buf.byteOffset).getUint32(0); tomar(4);
    if (!(await pedir(lc + 4))) throw new Error('Trama cortada');
    const cabecera = JSON.parse(new TextDecoder().decode(tomar(lc))) as CabeceraTrama;
    const ld = new DataView(buf.buffer, buf.byteOffset).getUint32(0); tomar(4);
    if (!(await pedir(ld))) throw new Error('Trama cortada');
    yield { cabecera, datos: tomar(ld) };
  }
}
