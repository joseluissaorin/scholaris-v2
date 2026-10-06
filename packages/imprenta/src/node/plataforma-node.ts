/**
 * La imprenta en Node: pdf.js (build legacy) + @napi-rs/canvas, ffmpeg para el
 * audio y los fotogramas, y worker_threads para rasterizar en paralelo.
 * Sirve para el banco de pruebas, la versión local y la reserva del servidor.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { FuenteFotogramas, FuentePcm, ImagenDecodificada, Lienzo, MotorPdf, Plataforma } from '../plataforma.js';
import type { OpcionesPaginaCruda, PaginaCruda } from '../pdf/pagina-cruda.js';
import { codificarWav } from '../medios/wav.js';

const requerir = createRequire(import.meta.url);
type Napi = typeof import('@napi-rs/canvas');
let napi: Napi | null = null;
function canvas(): Napi {
  napi ??= requerir('@napi-rs/canvas') as Napi;
  return napi;
}

const raizPdfjs = dirname(requerir.resolve('pdfjs-dist/package.json')) + '/';

export function parametrosPdfjsNode(): Record<string, unknown> {
  return {
    standardFontDataUrl: raizPdfjs + 'standard_fonts/',
    cMapUrl: raizPdfjs + 'cmaps/',
    cMapPacked: true,
    wasmUrl: raizPdfjs + 'wasm/',
    isEvalSupported: false,
    verbosity: 0,
  };
}

export async function pdfjsNode(): Promise<typeof import('pdfjs-dist')> {
  return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

/** Ejecuta un proceso y devuelve stdout entero. */
function ejecutar(cmd: string, args: string[], entrada?: Uint8Array): Promise<Buffer> {
  return new Promise((ok, mal) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const salida: Buffer[] = [];
    let error = '';
    p.stdout.on('data', (d: Buffer) => salida.push(d));
    p.stderr.on('data', (d: Buffer) => { error += d.toString(); if (error.length > 8000) error = error.slice(-4000); });
    p.on('error', mal);
    p.on('close', (c) => (c === 0 ? ok(Buffer.concat(salida)) : mal(new Error(`${cmd} salió con ${c}: ${error.slice(-500)}`))));
    if (entrada) p.stdin.end(entrada);
    else p.stdin.end();
  });
}

let hayFfmpeg: boolean | null = null;
async function ffmpegDisponible(): Promise<boolean> {
  if (hayFfmpeg === null) hayFfmpeg = await ejecutar('ffmpeg', ['-version']).then(() => true, () => false);
  return hayFfmpeg;
}

/** Escribe los bytes en un temporal (ffmpeg necesita poder saltar en mp4 con el moov al final). */
async function temporal(bytes: Uint8Array, nombre: string): Promise<{ ruta: string; borrar: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'imprenta-'));
  const ruta = join(dir, nombre.replace(/[^\w.-]/g, '_') || 'entrada');
  await writeFile(ruta, bytes);
  return { ruta, borrar: () => rm(dir, { recursive: true, force: true }) };
}

async function sondear(ruta: string): Promise<{ duracion: number | null; video: { ancho: number; alto: number; codec: string } | null; audio: boolean }> {
  const out = await ejecutar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', ruta]);
  const j = JSON.parse(out.toString()) as { format?: { duration?: string }; streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number }> };
  const v = j.streams?.find((s) => s.codec_type === 'video' && s.codec_name !== 'mjpeg' && s.codec_name !== 'png');
  const d = Number(j.format?.duration);
  return {
    duracion: Number.isFinite(d) ? d : null,
    video: v && v.width && v.height ? { ancho: v.width, alto: v.height, codec: v.codec_name } : null,
    audio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')),
  };
}

// ---------------------------------------------------------------------------
// Grupo de rasterizadores (worker_threads)
// ---------------------------------------------------------------------------

class GrupoNode implements MotorPdf {
  private pendientes = new Map<number, { ok: (c: PaginaCruda) => void; mal: (e: Error) => void }>();
  private siguiente = 0;
  private libres: Worker[] = [];
  private cola: Array<(w: Worker) => void> = [];

  private constructor(private trabajadores: Worker[]) {
    this.libres = [...trabajadores];
    for (const w of trabajadores) {
      w.on('message', (m: { id: number; cruda?: PaginaCruda; error?: string }) => {
        const p = this.pendientes.get(m.id);
        if (!p) return;
        this.pendientes.delete(m.id);
        if (m.error || !m.cruda) p.mal(new Error(m.error ?? 'Sin respuesta'));
        else p.ok(m.cruda);
        this.soltar(w);
      });
      w.on('error', (e) => { for (const p of this.pendientes.values()) p.mal(e); this.pendientes.clear(); });
    }
  }

  get hilos() { return this.trabajadores.length; }

  static async crear(bytes: Uint8Array, hilos: number): Promise<GrupoNode> {
    const url = new URL('./trabajador-pdf.mjs', import.meta.url);
    const trabajadores = await Promise.all(
      Array.from({ length: hilos }, async () => {
        const w = new Worker(url, { workerData: { bytes } });
        await new Promise<void>((ok, mal) => {
          w.once('message', (m: { listo?: boolean; error?: string }) => (m.listo ? ok() : mal(new Error(m.error))));
          w.once('error', mal);
        });
        return w;
      }),
    );
    return new GrupoNode(trabajadores);
  }

  private soltar(w: Worker) {
    const espera = this.cola.shift();
    if (espera) espera(w);
    else this.libres.push(w);
  }

  private tomar(): Promise<Worker> {
    const w = this.libres.shift();
    if (w) return Promise.resolve(w);
    return new Promise((r) => this.cola.push(r));
  }

  async procesar(fisica: number, op: OpcionesPaginaCruda): Promise<PaginaCruda> {
    const w = await this.tomar();
    const id = this.siguiente++;
    return new Promise((ok, mal) => {
      this.pendientes.set(id, { ok, mal });
      w.postMessage({ id, fisica, op });
    });
  }

  async cerrar() {
    await Promise.all(this.trabajadores.map((w) => w.terminate()));
  }
}

// ---------------------------------------------------------------------------
// La plataforma
// ---------------------------------------------------------------------------

export const plataformaNode: Plataforma = {
  nombre: 'node',

  crearLienzo(ancho, alto): Lienzo {
    const c = canvas().createCanvas(ancho, alto);
    return { ancho, alto, ctx: c.getContext('2d') as unknown as Lienzo['ctx'], nativo: c };
  },

  async aJpeg(lienzo, calidad) {
    const c = lienzo.nativo as import('@napi-rs/canvas').Canvas;
    const b = await c.encode('jpeg', Math.round(calidad * 100));
    // Copia a memoria propia: los Buffer de napi son externos y no se pueden transferir entre hilos.
    return new Uint8Array(b);
  },

  async decodificarImagen(bytes): Promise<ImagenDecodificada> {
    const img = await canvas().loadImage(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { ancho: img.width, alto: img.height, fuente: img, orientada: true, cerrar: () => {} };
  },

  async pdfjs() {
    return { lib: await pdfjsNode(), parametros: parametrosPdfjsNode() };
  },

  motorPdf(bytes, hilos) {
    return GrupoNode.crear(bytes, hilos);
  },

  hilosPorDefecto() {
    return Math.max(1, Math.min(8, availableParallelism() - 1));
  },

  async pcm(bytes, _mime, nombre): Promise<FuentePcm | null> {
    if (!(await ffmpegDisponible())) return null;
    const tmp = await temporal(bytes, nombre);
    let info;
    try {
      info = await sondear(tmp.ruta);
    } catch {
      await tmp.borrar();
      return null;
    }
    if (!info.audio) { await tmp.borrar(); return null; }
    async function* bloques(): AsyncGenerator<Float32Array> {
      const p = spawn('ffmpeg', ['-v', 'error', '-i', tmp.ruta, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let resto: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      try {
        for await (const trozo of p.stdout as AsyncIterable<Buffer>) {
          const b = resto.length ? Buffer.concat([resto, trozo]) : trozo;
          const util = b.length - (b.length % 4);
          resto = b.subarray(util);
          if (util) {
            const copia = new Uint8Array(util);
            copia.set(b.subarray(0, util));
            yield new Float32Array(copia.buffer);
          }
        }
      } finally {
        p.kill();
        await tmp.borrar();
      }
    }
    return { duracion: info.duracion, bloques: bloques() };
  },

  async codificarAudio(pcm, formato) {
    if (formato === 'wav') return { bytes: codificarWav(pcm), mime: 'audio/wav' };
    if (!(await ffmpegDisponible())) return null;
    const entrada = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const out = await ejecutar('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', '16000', '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', '-f', 'ogg', 'pipe:1'], entrada);
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), mime: 'audio/ogg' };
  },

  async fotogramas(bytes, _mime, nombre): Promise<FuenteFotogramas | null> {
    if (!(await ffmpegDisponible())) return null;
    const tmp = await temporal(bytes, nombre);
    const info = await sondear(tmp.ruta).catch(() => null);
    if (!info?.video) { await tmp.borrar(); return null; }
    // Fotogramas clave del códec (I-frames): se decodifican solos, rapidísimo.
    const lado = 1280;
    const e = Math.min(1, lado / Math.max(info.video.ancho, info.video.alto));
    const W = Math.max(2, Math.round((info.video.ancho * e) / 2) * 2), H = Math.max(2, Math.round((info.video.alto * e) / 2) * 2);
    const napiC = canvas();
    async function* fotogramas(): AsyncGenerator<{ t: number; imagen: ImagenDecodificada }> {
      const p = spawn('ffmpeg', ['-v', 'info', '-hide_banner', '-skip_frame', 'nokey', '-i', tmp.ruta, '-an', '-fps_mode', 'passthrough',
        '-vf', `scale=${W}:${H},showinfo`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const tiempos: number[] = [];
      let linea = '';
      p.stderr.on('data', (d: Buffer) => {
        linea += d.toString();
        let i;
        while ((i = linea.indexOf('\n')) >= 0) {
          const l = linea.slice(0, i);
          linea = linea.slice(i + 1);
          const m = /showinfo.*pts_time:\s*([\d.]+)/.exec(l);
          if (m) tiempos.push(Number(m[1]));
        }
      });
      const tam = W * H * 4;
      let acumulado: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let n = 0;
      try {
        for await (const trozo of p.stdout as AsyncIterable<Buffer>) {
          acumulado = acumulado.length ? Buffer.concat([acumulado, trozo]) : trozo;
          while (acumulado.length >= tam) {
            const marco = acumulado.subarray(0, tam);
            acumulado = acumulado.subarray(tam);
            // Espera a que showinfo haya contado este fotograma.
            for (let k = 0; tiempos.length <= n && k < 200; k++) await new Promise((r) => setTimeout(r, 5));
            const t = tiempos[n] ?? n;
            n++;
            const c = napiC.createCanvas(W, H);
            const datos = new napiC.ImageData(new Uint8ClampedArray(marco.buffer.slice(marco.byteOffset, marco.byteOffset + tam)), W, H);
            c.getContext('2d').putImageData(datos, 0, 0);
            yield { t, imagen: { ancho: W, alto: H, fuente: c, cerrar: () => {} } };
          }
        }
      } finally {
        p.kill();
        await tmp.borrar();
      }
    }
    return { ancho: info.video.ancho, alto: info.video.alto, codec: info.video.codec, duracion: info.duracion, fotogramas: fotogramas() };
  },
};
