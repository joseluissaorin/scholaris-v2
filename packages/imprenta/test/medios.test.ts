import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trocearPcm, diferencia } from '../src/medios/convertir-medio.js';
import { escribirOggOpus, leerOgg, crcOgg } from '../src/medios/ogg.js';
import { Remuestreador } from '../src/medios/remuestreo.js';
import { codificarWav, leerWav } from '../src/medios/wav.js';
import { demuxMp4 } from '../src/navegador/demux-mp4.js';
import { tramasMp3 } from '../src/navegador/mp3.js';

const DATOS = new URL('../../../bench/datos/originales/', import.meta.url).pathname;
const hay = (f: string) => existsSync(DATOS + f);
const hayFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();

async function* bloques(total: number, tam: number) {
  for (let i = 0; i < total; i += tam) {
    const b = new Float32Array(Math.min(tam, total - i));
    for (let j = 0; j < b.length; j++) b[j] = (i + j) / 1e7; // rampa: deja comprobar el solape
    yield b;
  }
}

describe('troceo de PCM', () => {
  it('tramos con solape al principio y el último corto', async () => {
    const tramos: Array<{ n: number; t0: number; t1: number; d: number; primera: number }> = [];
    const dur = await trocearPcm(bloques(16000 * 25, 7777), 10, 2, async (pcm, t0, t1, pd, ph) => {
      tramos.push({ n: tramos.length, t0, t1, d: pcm.length / 16000, primera: pcm[0] as number });
      expect(ph).toBe(t1);
      expect(pd).toBe(tramos.length === 1 ? 0 : t0 + 2);
    });
    expect(dur).toBe(25);
    expect(tramos.map((t) => [t.t0, t.t1])).toEqual([[0, 10], [8, 20], [18, 25]]);
    expect(tramos[1]?.d).toBe(12);
    // La primera muestra del tramo 2 es la muestra absoluta 8·16000.
    expect(tramos[1]?.primera).toBeCloseTo((8 * 16000) / 1e7, 6);
  });
  it('bloques enormes (mayores que un tramo)', async () => {
    const n: number[] = [];
    await trocearPcm(bloques(16000 * 35, 16000 * 30), 10, 1, async (_p, t0) => { n.push(t0); });
    expect(n).toEqual([0, 9, 19, 29]);
  });
});

describe('audio', () => {
  it('WAV ida y vuelta', () => {
    const pcm = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
    const r = leerWav(codificarWav(pcm));
    expect(r?.muestreo).toBe(16000);
    expect(r?.canales[0]?.[100]).toBeCloseTo(pcm[100] as number, 3);
  });
  it('remuestreo 44,1 kHz → 16 kHz conserva un tono de 440 Hz', () => {
    const r = new Remuestreador(44100);
    const entrada = Float32Array.from({ length: 44100 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100));
    const salida = new Float32Array([...r.procesar(entrada.subarray(0, 20000)), ...r.procesar(entrada.subarray(20000))]);
    expect(Math.abs(salida.length - 16000)).toBeLessThan(3);
    let cruces = 0;
    for (let i = 1000; i < 15000; i++) if ((salida[i - 1] as number) < 0 && (salida[i] as number) >= 0) cruces++;
    expect(cruces / (14000 / 16000)).toBeCloseTo(440, -1);
  });
  it('CRC de Ogg', () => {
    expect(crcOgg(new TextEncoder().encode('OggS'))).toBe(0x5fb0a94f);
  });
  it.skipIf(!hayFfmpeg)('Ogg/Opus reempaquetado lo lee ffmpeg', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogg-'));
    const pcm = Float32Array.from({ length: 16000 * 3 }, (_, i) => Math.sin(i / 7) * 0.3);
    writeFileSync(join(dir, 'a.f32'), new Uint8Array(pcm.buffer));
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', '16000', '-ac', '1', '-i', join(dir, 'a.f32'), '-c:a', 'libopus', '-b:a', '24k', join(dir, 'a.ogg')]);
    const paquetes = leerOgg(new Uint8Array(readFileSync(join(dir, 'a.ogg'))));
    const [head, , ...datos] = paquetes;
    const ogg = escribirOggOpus(datos, datos.map(() => 960), { cabecera: head });
    writeFileSync(join(dir, 'b.ogg'), ogg);
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'b.ogg')]).toString());
    expect(dur).toBeGreaterThan(2.9);
    expect(dur).toBeLessThan(3.1);
    execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'b.ogg'), '-f', 'null', '-']);
  });
  it('diferencia entre firmas', () => {
    expect(diferencia(new Float32Array([0, 1]), new Float32Array([1, 1]))).toBe(0.5);
  });
});

describe('desmultiplexado (lo que usa WebCodecs en el navegador)', () => {
  it.skipIf(!hay('3b1b_1min_real.mp4'))('MP4: pistas, muestras clave y configuración AAC/AVC', () => {
    const m = demuxMp4(new Uint8Array(readFileSync(DATOS + '3b1b_1min_real.mp4')));
    expect(m?.duracion).toBeCloseTo(60, 0);
    expect(m?.audio?.codec).toBe('mp4a.40.2');
    expect([...(m?.audio?.descripcion ?? [])]).toEqual([0x12, 0x10]);
    expect(m?.video?.codec).toMatch(/^avc1\./);
    expect(m?.video?.descripcion?.[0]).toBe(1); // avcC configurationVersion
    expect(m?.video?.muestras.filter((s) => s.clave).length).toBe(11);
  });
  it.skipIf(!hay('audio_conference.mp3'))('MP3: tramas y duración', () => {
    const r = tramasMp3(new Uint8Array(readFileSync(DATOS + 'audio_conference.mp3')));
    expect(r?.muestreo).toBe(44100);
    const ultima = r?.tramas[r.tramas.length - 1];
    expect((ultima?.t ?? 0) + (ultima?.dur ?? 0)).toBeCloseTo(60, 0);
  });
});
