/** Ogg/Opus mínimo: empaqueta paquetes Opus (de WebCodecs) en un archivo .ogg. */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

export function crcOgg(b: Uint8Array): number {
  let crc = 0;
  for (const x of b) crc = ((crc << 8) ^ (TABLA_CRC[((crc >>> 24) ^ x) & 0xff] as number)) >>> 0;
  return crc >>> 0;
}

function pagina(paquetes: Uint8Array[], granulo: bigint, serie: number, secuencia: number, tipo: number): Uint8Array {
  const segmentos: number[] = [];
  for (const p of paquetes) {
    let n = p.length;
    while (n >= 255) { segmentos.push(255); n -= 255; }
    segmentos.push(n);
  }
  const cuerpo = paquetes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(27 + segmentos.length + cuerpo);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0);
  out[4] = 0; out[5] = tipo;
  v.setBigInt64(6, granulo, true);
  v.setUint32(14, serie, true);
  v.setUint32(18, secuencia, true);
  v.setUint32(22, 0, true);
  out[26] = segmentos.length;
  out.set(segmentos, 27);
  let o = 27 + segmentos.length;
  for (const p of paquetes) { out.set(p, o); o += p.length; }
  v.setUint32(22, crcOgg(out), true);
  return out;
}

export function cabeceraOpus(canales: number, muestreoOriginal: number, preskip = 312): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set(new TextEncoder().encode('OpusHead'), 0);
  h[8] = 1; h[9] = canales;
  v.setUint16(10, preskip, true);
  v.setUint32(12, muestreoOriginal, true);
  v.setInt16(16, 0, true);
  h[18] = 0;
  return h;
}

/**
 * Paquetes Opus → Ogg. `duraciones` en muestras a 48 kHz (20 ms = 960).
 * `cabecera`: OpusHead del codificador si lo da (description de WebCodecs).
 */
export function escribirOggOpus(paquetes: Uint8Array[], duraciones: number[], opciones: { canales?: number; muestreo?: number; cabecera?: Uint8Array; serie?: number } = {}): Uint8Array {
  const serie = opciones.serie ?? 0x5c401a55;
  const head = opciones.cabecera && opciones.cabecera.length >= 19 ? opciones.cabecera : cabeceraOpus(opciones.canales ?? 1, opciones.muestreo ?? 16000);
  const preskip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
  const vendedor = new TextEncoder().encode('scholaris-imprenta');
  const tags = new Uint8Array(8 + 4 + vendedor.length + 4);
  tags.set(new TextEncoder().encode('OpusTags'), 0);
  new DataView(tags.buffer).setUint32(8, vendedor.length, true);
  tags.set(vendedor, 12);
  const trozos: Uint8Array[] = [pagina([head], 0n, serie, 0, 0x02), pagina([tags], 0n, serie, 1, 0)];
  let seq = 2;
  let granulo = BigInt(preskip);
  let grupo: Uint8Array[] = [];
  let segs = 0;
  for (let i = 0; i < paquetes.length; i++) {
    const p = paquetes[i] as Uint8Array;
    const s = Math.floor(p.length / 255) + 1;
    if (grupo.length && (segs + s > 255 || grupo.length >= 50)) {
      trozos.push(pagina(grupo, granulo, serie, seq++, 0));
      grupo = []; segs = 0;
    }
    grupo.push(p); segs += s;
    granulo += BigInt(duraciones[i] ?? 960);
  }
  trozos.push(pagina(grupo, granulo, serie, seq++, 0x04));
  const total = trozos.reduce((s, t) => s + t.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const t of trozos) { out.set(t, o); o += t.length; }
  return out;
}

/** Lee los paquetes de un Ogg (para pruebas y para reempaquetar). */
export function leerOgg(b: Uint8Array): Uint8Array[] {
  const paquetes: Uint8Array[] = [];
  let o = 0;
  let actual: number[] = [];
  while (o + 27 <= b.length) {
    const n = b[o + 26] as number;
    const tabla = b.subarray(o + 27, o + 27 + n);
    let p = o + 27 + n;
    for (const s of tabla) {
      for (let i = 0; i < s; i++) actual.push(b[p + i] as number);
      p += s;
      if (s < 255) { paquetes.push(Uint8Array.from(actual)); actual = []; }
    }
    o = p;
  }
  return paquetes;
}
