/** Tramas de un MP3 (para dárselas a un AudioDecoder de WebCodecs). */

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MUESTREOS: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export interface TramaMp3 { datos: Uint8Array; t: number; dur: number }

export function tramasMp3(b: Uint8Array): { muestreo: number; canales: number; tramas: TramaMp3[] } | null {
  let o = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const tam = (((b[6] as number) & 0x7f) << 21) | (((b[7] as number) & 0x7f) << 14) | (((b[8] as number) & 0x7f) << 7) | ((b[9] as number) & 0x7f);
    o = 10 + tam + (((b[5] as number) & 0x10) ? 10 : 0);
  }
  const tramas: TramaMp3[] = [];
  let muestreo = 0, canales = 0, t = 0;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff || ((b[o + 1] as number) & 0xe0) !== 0xe0) { o++; continue; }
    const v = ((b[o + 1] as number) >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const capa = 4 - (((b[o + 1] as number) >> 1) & 3);
    const iBr = (b[o + 2] as number) >> 4;
    const iSr = ((b[o + 2] as number) >> 2) & 3;
    const relleno = ((b[o + 2] as number) >> 1) & 1;
    const modo = (b[o + 3] as number) >> 6;
    if (v === 1 || capa === 4 || iBr === 0 || iBr === 15 || iSr === 3) { o++; continue; }
    const br = (BITRATES[`${v === 3 ? 1 : 2}-${v === 3 ? capa : capa === 1 ? 1 : 2}`] ?? [])[iBr] ?? 0;
    const sr = (MUESTREOS[v] ?? [])[iSr] ?? 0;
    if (!br || !sr) { o++; continue; }
    const muestras = capa === 1 ? 384 : capa === 3 && v !== 3 ? 576 : 1152;
    const largo = capa === 1 ? Math.floor((12 * br * 1000) / sr + relleno) * 4 : Math.floor((muestras / 8) * br * 1000 / sr) + relleno;
    if (largo < 4 || o + largo > b.length) break;
    muestreo ||= sr;
    canales ||= modo === 3 ? 1 : 2;
    tramas.push({ datos: b.subarray(o, o + largo), t, dur: muestras / sr });
    t += muestras / sr;
    o += largo;
  }
  return tramas.length ? { muestreo, canales, tramas } : null;
}
