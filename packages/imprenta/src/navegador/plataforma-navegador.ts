/// <reference path="../modulos.d.ts" />
/**
 * La imprenta en el navegador: corre dentro de un Web Worker dedicado.
 * OffscreenCanvas para rasterizar y codificar JPEG, WebCodecs para el audio y
 * los fotogramas (con mp4box para desmultiplexar), y un grupo de Web Workers
 * anidados con su propia copia de pdf.js para las páginas.
 */

import type { FuenteFotogramas, FuentePcm, ImagenDecodificada, Lienzo, MotorPdf, Plataforma } from '../plataforma.js';
import type { OpcionesPaginaCruda, PaginaCruda } from '../pdf/pagina-cruda.js';
import { codificarWav, leerWav } from '../medios/wav.js';
import { escribirOggOpus } from '../medios/ogg.js';
import { Remuestreador } from '../medios/remuestreo.js';
import { demuxMp4 } from './demux-mp4.js';
import { tramasMp3 } from './mp3.js';

export interface ConfiguracionImprenta {
  /** URL (con / final) donde están copiados standard_fonts/, cmaps/ y wasm/ de pdfjs-dist. Por defecto '/pdfjs/'. */
  recursosPdfjs: string;
  /** Fabrica los trabajadores de páginas. Por defecto, un módulo hermano resuelto por el empaquetador. */
  crearTrabajador?: () => Worker;
}

const configuracion: ConfiguracionImprenta = { recursosPdfjs: '/pdfjs/' };

export function configurarImprenta(c: Partial<ConfiguracionImprenta>): void {
  Object.assign(configuracion, c);
}

// ---------------------------------------------------------------------------
// pdf.js sin DOM
// ---------------------------------------------------------------------------

/** Fábrica de lienzos para pdf.js con OffscreenCanvas (en un worker no hay document). */
export class FabricaLienzoOffscreen {
  constructor(_: unknown = {}) {}
  create(ancho: number, alto: number) {
    if (ancho <= 0 || alto <= 0) throw new Error('Tamaño de lienzo no válido');
    const canvas = new OffscreenCanvas(ancho, alto);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }
  reset(c: { canvas: OffscreenCanvas | null }, ancho: number, alto: number) {
    if (!c.canvas) throw new Error('Lienzo sin canvas');
    c.canvas.width = ancho;
    c.canvas.height = alto;
  }
  destroy(c: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (c.canvas) { c.canvas.width = 0; c.canvas.height = 0; }
    c.canvas = null;
    c.context = null;
  }
}

/** Filtros SVG: no hay DOM, así que ninguno (pdf.js los usa solo para mapas de transferencia raros). */
export class FiltrosNulos {
  addFilter() { return 'none'; }
  addHCMFilter() { return 'none'; }
  addAlphaFilter() { return 'none'; }
  addLuminosityFilter() { return 'none'; }
  addKnockoutFilter() { return 'none'; }
  addHighlightHCMFilter() { return 'none'; }
  addSelectionHCMFilter() { return 'none'; }
  addSelectionFilter() { return 'none'; }
  createSelectionStyle() { return null; }
  destroy() {}
}

let pdfjsCargado: Promise<typeof import('pdfjs-dist')> | null = null;

export function pdfjsNavegador(): Promise<typeof import('pdfjs-dist')> {
  pdfjsCargado ??= (async () => {
    // Importar el worker de pdf.js define globalThis.pdfjsWorker: pdf.js analiza
    // en este mismo hilo (que ya es un Web Worker) en vez de crear otro.
    // Truco: el módulo del worker de pdf.js se engancha a `self` si cree estar
    // en un Web Worker propio (y manda un «ready» que ensucia nuestro canal).
    // Con `window` definido mientras se evalúa, no lo hace.
    const g = globalThis as { window?: unknown };
    const habia = 'window' in g;
    if (!habia) g.window = globalThis;
    try {
      await import('pdfjs-dist/build/pdf.worker.mjs');
    } finally {
      if (!habia) delete g.window;
    }
    return import('pdfjs-dist');
  })();
  return pdfjsCargado;
}

export function parametrosPdfjsNavegador(): Record<string, unknown> {
  const r = configuracion.recursosPdfjs;
  return {
    standardFontDataUrl: `${r}standard_fonts/`,
    cMapUrl: `${r}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${r}wasm/`,
    CanvasFactory: FabricaLienzoOffscreen,
    FilterFactory: FiltrosNulos,
    // pdf.js lo calcula mirando document.baseURI, que en un worker no existe.
    useWorkerFetch: true,
    isEvalSupported: false,
    // Sin document no hay FontFace en el DOM: los glifos se dibujan como trazos.
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  };
}

// ---------------------------------------------------------------------------
// Grupo de trabajadores de páginas
// ---------------------------------------------------------------------------

class GrupoNavegador implements MotorPdf {
  private pendientes = new Map<number, { ok: (c: PaginaCruda) => void; mal: (e: Error) => void; w: Worker }>();
  private siguiente = 0;
  private libres: Worker[];
  private cola: Array<(w: Worker) => void> = [];

  private constructor(private trabajadores: Worker[]) {
    this.libres = [...trabajadores];
    for (const w of trabajadores) {
      w.addEventListener('message', (e: MessageEvent<{ id: number; cruda?: PaginaCruda; error?: string }>) => {
        const p = this.pendientes.get(e.data.id);
        if (!p) return;
        this.pendientes.delete(e.data.id);
        if (e.data.error || !e.data.cruda) p.mal(new Error(e.data.error ?? 'Sin respuesta'));
        else p.ok(e.data.cruda);
        this.soltar(w);
      });
      w.addEventListener('error', (e) => {
        for (const [id, p] of this.pendientes) if (p.w === w) { p.mal(new Error(e.message)); this.pendientes.delete(id); }
      });
    }
  }

  get hilos() { return this.trabajadores.length; }

  static async crear(bytes: Uint8Array, hilos: number): Promise<GrupoNavegador> {
    const crear = configuracion.crearTrabajador ?? (() => new Worker(new URL('./trabajador-pdf.ts', import.meta.url), { type: 'module', name: 'imprenta-paginas' }));
    const trabajadores = await Promise.all(Array.from({ length: hilos }, async () => {
      const w = crear();
      await new Promise<void>((ok, mal) => {
        const alMensaje = (e: MessageEvent<{ listo?: boolean; error?: string }>) => {
          w.removeEventListener('message', alMensaje);
          if (e.data.listo) ok(); else mal(new Error(e.data.error ?? 'El trabajador no arrancó'));
        };
        w.addEventListener('message', alMensaje);
        w.addEventListener('error', (e) => mal(new Error(e.message)), { once: true });
        // Cada trabajador recibe su copia (pdf.js se queda con el buffer).
        const copia = bytes.slice();
        w.postMessage({ tipo: 'abrir', bytes: copia, recursosPdfjs: configuracion.recursosPdfjs }, [copia.buffer]);
      });
      return w;
    }));
    return new GrupoNavegador(trabajadores);
  }

  private soltar(w: Worker) {
    const espera = this.cola.shift();
    if (espera) espera(w); else this.libres.push(w);
  }

  private tomar(): Promise<Worker> {
    const w = this.libres.shift();
    return w ? Promise.resolve(w) : new Promise((r) => this.cola.push(r));
  }

  async procesar(fisica: number, op: OpcionesPaginaCruda): Promise<PaginaCruda> {
    const w = await this.tomar();
    const id = this.siguiente++;
    return new Promise((ok, mal) => {
      this.pendientes.set(id, { ok, mal, w });
      w.postMessage({ tipo: 'pagina', id, fisica, op });
    });
  }

  async cerrar() {
    for (const w of this.trabajadores) w.terminate();
  }
}

// ---------------------------------------------------------------------------
// Audio con WebCodecs
// ---------------------------------------------------------------------------

function planos(datos: AudioData): Float32Array[] {
  const n = datos.numberOfFrames;
  const salida: Float32Array[] = [];
  const planar = datos.format?.endsWith('-planar') ?? true;
  if (planar) {
    for (let c = 0; c < datos.numberOfChannels; c++) {
      const buf = new Float32Array(n);
      datos.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
      salida.push(buf);
    }
  } else {
    const inter = new Float32Array(n * datos.numberOfChannels);
    datos.copyTo(inter, { planeIndex: 0, format: 'f32' });
    for (let c = 0; c < datos.numberOfChannels; c++) {
      const buf = new Float32Array(n);
      for (let i = 0; i < n; i++) buf[i] = inter[i * datos.numberOfChannels + c] as number;
      salida.push(buf);
    }
  }
  return salida;
}

/** Decodifica trozos codificados con un AudioDecoder y entrega PCM 16 kHz mono en flujo. */
async function* decodificarConWebCodecs(config: AudioDecoderConfig, trozos: Iterable<{ datos: Uint8Array; t: number; dur: number }>): AsyncGenerator<Float32Array> {
  const salida: Float32Array[] = [];
  let error: unknown = null;
  let remuestreador: Remuestreador | null = null;
  const decodificador = new AudioDecoder({
    output: (d) => {
      try {
        remuestreador ??= new Remuestreador(d.sampleRate);
        salida.push(remuestreador.procesar(Remuestreador.mono(planos(d))));
      } finally {
        d.close();
      }
    },
    error: (e) => { error = e; },
  });
  decodificador.configure(config);
  let n = 0;
  for (const t of trozos) {
    if (error) throw error;
    decodificador.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(t.t * 1e6), duration: Math.round(t.dur * 1e6), data: t.datos }));
    // Contrapresión: no acumular miles de trozos en la cola del decodificador.
    if (++n % 200 === 0 || decodificador.decodeQueueSize > 400) {
      while (decodificador.decodeQueueSize > 50) await new Promise((r) => setTimeout(r, 0));
      while (salida.length) yield salida.shift() as Float32Array;
    }
  }
  await decodificador.flush();
  decodificador.close();
  if (error) throw error;
  while (salida.length) yield salida.shift() as Float32Array;
}

async function* desdePcmCompleto(canales: Float32Array[], muestreo: number): AsyncGenerator<Float32Array> {
  const mono = Remuestreador.mono(canales);
  const r = new Remuestreador(muestreo);
  const paso = muestreo * 30;
  for (let i = 0; i < mono.length; i += paso) yield r.procesar(mono.subarray(i, i + paso));
}

async function codificarOpus(pcm: Float32Array): Promise<Uint8Array | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const config: AudioEncoderConfig = { codec: 'opus', sampleRate: 16000, numberOfChannels: 1, bitrate: 24000 };
  const soporte = await AudioEncoder.isConfigSupported(config).catch(() => null);
  if (!soporte?.supported) return null;
  const paquetes: Uint8Array[] = [];
  const duraciones: number[] = [];
  let cabecera: Uint8Array | undefined;
  let error: unknown = null;
  const cod = new AudioEncoder({
    output: (chunk, meta) => {
      const b = new Uint8Array(chunk.byteLength);
      chunk.copyTo(b);
      paquetes.push(b);
      duraciones.push(Math.round(((chunk.duration ?? 20000) * 48000) / 1e6));
      const desc = meta?.decoderConfig?.description;
      if (desc && !cabecera) cabecera = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array((desc as ArrayBufferView).buffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength);
    },
    error: (e) => { error = e; },
  });
  cod.configure(config);
  const paso = 16000; // 1 s por AudioData
  for (let i = 0; i < pcm.length; i += paso) {
    const trozo = pcm.slice(i, i + paso);
    const datos = new AudioData({ format: 'f32-planar', sampleRate: 16000, numberOfChannels: 1, numberOfFrames: trozo.length, timestamp: Math.round((i / 16000) * 1e6), data: trozo });
    cod.encode(datos);
    datos.close();
  }
  await cod.flush();
  cod.close();
  if (error) throw error;
  return escribirOggOpus(paquetes, duraciones, { canales: 1, muestreo: 16000, ...(cabecera && cabecera.length >= 19 ? { cabecera } : {}) });
}

// ---------------------------------------------------------------------------
// La plataforma
// ---------------------------------------------------------------------------

export const plataformaNavegador: Plataforma = {
  nombre: 'navegador',

  crearLienzo(ancho, alto): Lienzo {
    const c = new OffscreenCanvas(ancho, alto);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas sin contexto 2D');
    return { ancho, alto, ctx: ctx as unknown as Lienzo['ctx'], nativo: c };
  },

  async aJpeg(lienzo, calidad) {
    const blob = await (lienzo.nativo as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: calidad });
    return new Uint8Array(await blob.arrayBuffer());
  },

  async decodificarImagen(bytes, mime): Promise<ImagenDecodificada> {
    // createImageBitmap aplica la orientación EXIF por defecto (imageOrientation: 'from-image').
    const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], mime ? { type: mime } : {}));
    return { ancho: bmp.width, alto: bmp.height, fuente: bmp, orientada: true, cerrar: () => bmp.close() };
  },

  async pdfjs() {
    return { lib: await pdfjsNavegador(), parametros: parametrosPdfjsNavegador() };
  },

  motorPdf(bytes, hilos) {
    return GrupoNavegador.crear(bytes, hilos);
  },

  hilosPorDefecto() {
    const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    return Math.max(1, Math.min(8, n - 1));
  },

  async pcm(bytes, mime, nombre): Promise<FuentePcm | null> {
    // WAV: directo.
    const wav = leerWav(bytes);
    if (wav) {
      const duracion = (wav.canales[0]?.length ?? 0) / wav.muestreo;
      return { duracion, bloques: desdePcmCompleto(wav.canales, wav.muestreo) };
    }
    const hayWebCodecs = typeof AudioDecoder !== 'undefined';
    // MP4 / M4A / MOV: mp4box + AudioDecoder.
    if (hayWebCodecs && (/mp4|quicktime|m4a|aac/.test(mime) || /\.(mp4|m4a|m4v|mov)$/i.test(nombre))) {
      const mp4 = demuxMp4(bytes);
      if (mp4?.audio) {
        const a = mp4.audio;
        const config: AudioDecoderConfig = { codec: a.codec, sampleRate: a.muestreo, numberOfChannels: a.canales, ...(a.descripcion ? { description: a.descripcion } : {}) };
        const soporte = await AudioDecoder.isConfigSupported(config).catch(() => null);
        if (soporte?.supported) return { duracion: mp4.duracion, bloques: decodificarConWebCodecs(config, a.muestras) };
      } else if (mp4) return null;
    }
    // MP3: tramas + AudioDecoder.
    if (hayWebCodecs && (/mpeg|mp3/.test(mime) || /\.mp3$/i.test(nombre))) {
      const mp3 = tramasMp3(bytes);
      if (mp3) {
        const config: AudioDecoderConfig = { codec: 'mp3', sampleRate: mp3.muestreo, numberOfChannels: mp3.canales };
        const soporte = await AudioDecoder.isConfigSupported(config).catch(() => null);
        if (soporte?.supported) {
          const ultima = mp3.tramas[mp3.tramas.length - 1];
          return { duracion: ultima ? ultima.t + ultima.dur : null, bloques: decodificarConWebCodecs(config, mp3.tramas) };
        }
      }
    }
    // Último recurso (solo en el hilo principal): Web Audio decodifica casi todo.
    if (typeof OfflineAudioContext !== 'undefined') {
      const ctx = new OfflineAudioContext(1, 1, 16000);
      const buf = await ctx.decodeAudioData(bytes.slice().buffer);
      const canales = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
      return { duracion: buf.duration, bloques: desdePcmCompleto(canales, buf.sampleRate) };
    }
    return null;
  },

  async codificarAudio(pcm, formato) {
    if (formato === 'wav') return { bytes: codificarWav(pcm), mime: 'audio/wav' };
    const ogg = await codificarOpus(pcm).catch(() => null);
    return ogg ? { bytes: ogg, mime: 'audio/ogg' } : null;
  },

  async fotogramas(bytes, mime, nombre): Promise<FuenteFotogramas | null> {
    if (typeof VideoDecoder === 'undefined') return null;
    if (!(/mp4|quicktime/.test(mime) || /\.(mp4|m4v|mov)$/i.test(nombre))) return null;
    const mp4 = demuxMp4(bytes);
    const v = mp4?.video;
    if (!mp4 || !v) return null;
    const config: VideoDecoderConfig = { codec: v.codec, codedWidth: v.ancho, codedHeight: v.alto, ...(v.descripcion ? { description: v.descripcion } : {}), optimizeForLatency: true };
    const soporte = await VideoDecoder.isConfigSupported(config).catch(() => null);
    if (!soporte?.supported) return null;
    // Solo las muestras clave: cada una se decodifica sola (como -skip_frame nokey).
    const claves = v.muestras.filter((m) => m.clave);
    async function* fotogramas(): AsyncGenerator<{ t: number; imagen: ImagenDecodificada }> {
      const listos: VideoFrame[] = [];
      let error: unknown = null;
      const dec = new VideoDecoder({ output: (f) => listos.push(f), error: (e) => { error = e; } });
      for (const m of claves) {
        if (error) throw error;
        // Cada clave es un comienzo de GOP: se reconfigura para no arrastrar referencias.
        if (dec.state !== 'configured') dec.configure(config);
        dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: Math.round(m.t * 1e6), duration: Math.round(m.dur * 1e6), data: m.datos }));
        await dec.flush();
        while (listos.length) {
          const f = listos.shift() as VideoFrame;
          yield { t: f.timestamp / 1e6, imagen: { ancho: f.displayWidth, alto: f.displayHeight, fuente: f, cerrar: () => f.close() } };
        }
      }
      dec.close();
    }
    return { ancho: v.ancho, alto: v.alto, codec: v.codec, duracion: mp4.duracion, fotogramas: fotogramas() };
  },
};
