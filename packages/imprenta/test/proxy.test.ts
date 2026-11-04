import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { argumentosProxy, cortesDe, interpretarEscenasFfmpeg } from '../src/index.js';
import { crearProxy } from '../src/node/index.js';

const hayFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();
const sondear = (ruta: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,height,channels', '-of', 'json', ruta]).toString()) as { streams: Array<{ codec_type: string; height?: number; channels?: number }> };

describe('proxy de un medio', () => {
  it('los argumentos llevan las dos ramas en vídeo y solo audio en audio', () => {
    const v = argumentosProxy('in.mp4', 'out.mp4', 'esc.txt', 'video');
    expect(v.join(' ')).toContain("select='gt(scene,0.08)',metadata=print:file=esc.txt");
    expect(v).toContain('-movflags');
    expect(argumentosProxy('in.m4a', 'out.mp4', 'esc.txt', 'audio')).toContain('-vn');
  });

  it('lee las puntuaciones de escena', () => {
    const r = interpretarEscenasFfmpeg('frame:0 pts:1 pts_time:2.0\nlavfi.scene_score=0.9\nframe:1 pts:2 pts_time:5.5\nlavfi.scene_score=0.1\n');
    expect(r.cortes).toEqual([2]);
    expect(cortesDe(r.candidatos!, 0.05)).toEqual([2, 5.5]);
  });

  it.skipIf(!hayFfmpeg)('hace un proxy de 360p con audio mono y encuentra el corte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxy-prueba-'));
    try {
      const entrada = join(dir, 'clip.mp4');
      // Dos planos de 2 s (rojo y azul) con un tono: un corte en el segundo 2.
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x480:d=2:r=24', '-f', 'lavfi', '-i', 'color=c=blue:s=640x480:d=2:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-c:a', 'aac', '-ac', '2', '-shortest', entrada]);
      const p = await crearProxy(entrada, 'video');
      try {
        expect(p.mime).toBe('video/mp4');
        expect(p.bytes).toBeGreaterThan(1000);
        const s = sondear(p.ruta).streams;
        expect(s.find((x) => x.codec_type === 'video')?.height).toBe(360);
        expect(s.find((x) => x.codec_type === 'audio')?.channels).toBe(1);
        expect(p.cortes?.cortes.length).toBe(1);
        expect(p.cortes!.cortes[0]).toBeCloseTo(2, 0);
      } finally {
        await p.borrar();
      }
      const a = await crearProxy(entrada, 'audio');
      try {
        expect(a.mime).toBe('audio/mp4');
        expect(sondear(a.ruta).streams.map((x) => x.codec_type)).toEqual(['audio']);
        expect(a.cortes).toBeNull();
      } finally {
        await a.borrar();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
