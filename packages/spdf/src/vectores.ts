/**
 * Vectores en el SPDF: float32 little-endian, dims × 4 bytes, sin cabecera.
 * Es el mismo formato que v3 (numpy `astype(np.float32).tobytes()` en x86/ARM).
 */

const ES_LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Float32Array → bytes LE (copia). */
export function float32ABytes(v: Float32Array | readonly number[]): Uint8Array {
  const f = v instanceof Float32Array ? v : Float32Array.from(v);
  if (ES_LE) return new Uint8Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
  const out = new Uint8Array(f.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < f.length; i++) dv.setFloat32(i * 4, f[i] as number, true);
  return out;
}

/** Bytes LE → Float32Array (copia alineada). Ignora un resto que no sea múltiplo de 4. */
export function bytesAFloat32(b: Uint8Array | ArrayBuffer): Float32Array {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  const n = Math.floor(u.byteLength / 4);
  if (ES_LE) return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + n * 4));
  const out = new Float32Array(n);
  const dv = new DataView(u.buffer, u.byteOffset, n * 4);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

export function norma(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] as number) ** 2;
  return Math.sqrt(s);
}
