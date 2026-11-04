/**
 * El proxy de un medio con ffmpeg (ver `medios/proxy.ts`): de un fichero del
 * disco a `proxy.mp4` y sus cortes de plano, en una sola pasada.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argumentosProxy, interpretarEscenasFfmpeg, PARAMETROS_PROXY, type CortesProxy } from '../medios/proxy.js';

export interface ResultadoProxy {
  /** Ruta del proxy en un directorio temporal: hay que llamar a `borrar` al acabar. */
  ruta: string;
  bytes: number;
  mime: 'video/mp4' | 'audio/mp4';
  cortes: CortesProxy | null;
  ms: number;
  borrar(): Promise<void>;
}

function ffmpeg(args: string[], senal?: AbortSignal): Promise<void> {
  return new Promise((ok, mal) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], ...(senal ? { signal: senal } : {}) });
    let error = '';
    p.stderr.on('data', (d: Buffer) => { error += d.toString(); if (error.length > 8000) error = error.slice(-4000); });
    p.on('error', mal);
    p.on('close', (c) => (c === 0 ? ok() : mal(new Error(`ffmpeg salió con ${c}: ${error.slice(-500)}`))));
  });
}

/** Hace el proxy de `entrada` (ruta en disco). En un vídeo sin pista de vídeo, sale solo audio. */
export async function crearProxy(entrada: string, tipo: 'video' | 'audio', opciones: { senal?: AbortSignal; parametros?: typeof PARAMETROS_PROXY } = {}): Promise<ResultadoProxy> {
  const t0 = performance.now();
  const dir = await mkdtemp(join(tmpdir(), 'proxy-'));
  const borrar = () => rm(dir, { recursive: true, force: true });
  try {
    const ruta = join(dir, 'proxy.mp4');
    const escenas = join(dir, 'escenas.txt');
    const p = opciones.parametros ?? PARAMETROS_PROXY;
    try {
      await ffmpeg(argumentosProxy(entrada, ruta, escenas, tipo, p), opciones.senal);
    } catch (e) {
      // «Vídeo» sin imagen (un MP4 de solo audio): se repite como audio.
      if (tipo === 'video' && /matches no streams|Stream specifier|does not contain any stream/i.test(String((e as Error).message))) return crearProxy(entrada, 'audio', opciones).finally(borrar);
      throw e;
    }
    const cortes = tipo === 'video' ? interpretarEscenasFfmpeg(await readFile(escenas, 'utf8').catch(() => ''), p.umbralCorte) : null;
    return { ruta, bytes: (await stat(ruta)).size, mime: tipo === 'video' ? 'video/mp4' : 'audio/mp4', cortes, ms: Math.round(performance.now() - t0), borrar };
  } catch (e) {
    await borrar();
    throw e;
  }
}
