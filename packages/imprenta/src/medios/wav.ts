/** WAV PCM 16 bits mono: el formato que todo el mundo acepta. */
export function codificarWav(pcm: Float32Array, muestreo = 16000): Uint8Array {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const escribir = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  escribir(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); escribir(8, 'WAVE');
  escribir(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, muestreo, true); v.setUint32(28, muestreo * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  escribir(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] as number));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** Lee un WAV PCM (8/16/24/32 bits enteros o 32 flotante) → canales en Float32. */
export function leerWav(b: Uint8Array): { muestreo: number; canales: Float32Array[] } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const txt = (o: number) => String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
  if (txt(0) !== 'RIFF' || txt(8) !== 'WAVE') return null;
  let o = 12, formato = 1, nc = 1, muestreo = 44100, bits = 16;
  let datos: Uint8Array | null = null;
  while (o + 8 <= b.length) {
    const id = txt(o), tam = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      formato = v.getUint16(o + 8, true); nc = v.getUint16(o + 10, true);
      muestreo = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true);
      if (formato === 0xfffe) formato = v.getUint16(o + 32, true);
    } else if (id === 'data') datos = b.subarray(o + 8, Math.min(b.length, o + 8 + tam));
    o += 8 + tam + (tam % 2);
  }
  if (!datos) return null;
  const bpm = bits / 8;
  const n = Math.floor(datos.length / (bpm * nc));
  const canales = Array.from({ length: nc }, () => new Float32Array(n));
  const d = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const p = (i * nc + c) * bpm;
      let x = 0;
      if (formato === 3 && bits === 32) x = d.getFloat32(p, true);
      else if (bits === 16) x = d.getInt16(p, true) / 32768;
      else if (bits === 8) x = (d.getUint8(p) - 128) / 128;
      else if (bits === 24) x = ((d.getUint8(p) | (d.getUint8(p + 1) << 8) | (d.getInt8(p + 2) << 16))) / 8388608;
      else if (bits === 32) x = d.getInt32(p, true) / 2147483648;
      (canales[c] as Float32Array)[i] = x;
    }
  }
  return { muestreo, canales };
}
