/**
 * Lo que la imprenta necesita de la plataforma. Dos implementaciones:
 * `navegador/` (OffscreenCanvas, WebCodecs, Web Workers) y `node/`
 * (@napi-rs/canvas, ffmpeg, worker_threads). El resto del código es común.
 */

import type { PaginaCruda, OpcionesPaginaCruda } from './pdf/pagina-cruda.js';

/** El subconjunto de CanvasRenderingContext2D que usamos (lo cumplen OffscreenCanvas y @napi-rs/canvas). */
export interface Contexto2D {
  drawImage(imagen: unknown, ...args: number[]): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(datos: unknown, x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angulo: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillStyle: unknown;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: unknown;
}

export interface Lienzo {
  readonly ancho: number;
  readonly alto: number;
  readonly ctx: Contexto2D;
  /** El objeto nativo (OffscreenCanvas o Canvas de napi), para drawImage o pdf.js. */
  readonly nativo: unknown;
}

/** Una imagen decodificada que se puede dibujar en un lienzo. */
export interface ImagenDecodificada {
  ancho: number;
  alto: number;
  fuente: unknown;
  /** La plataforma ya aplicó la orientación EXIF al decodificar. */
  orientada?: boolean;
  cerrar(): void;
}

/** PCM mono a 16 kHz, en bloques, según se decodifica. */
export interface FuentePcm {
  /** Duración si se conoce de antemano. */
  duracion: number | null;
  bloques: AsyncIterable<Float32Array>;
}

/** Fotogramas muestreados de un vídeo (en Node y en el navegador: los fotogramas clave del códec). */
export interface FuenteFotogramas {
  ancho: number;
  alto: number;
  codec?: string;
  duracion: number | null;
  fotogramas: AsyncIterable<{ t: number; imagen: ImagenDecodificada }>;
}

/** Un motor de páginas PDF: un hilo o un grupo de trabajadores con su copia del documento. */
export interface MotorPdf {
  readonly hilos: number;
  procesar(fisica: number, opciones: OpcionesPaginaCruda): Promise<PaginaCruda>;
  cerrar(): Promise<void>;
}

export interface Plataforma {
  readonly nombre: 'navegador' | 'node';
  crearLienzo(ancho: number, alto: number): Lienzo;
  aJpeg(lienzo: Lienzo, calidad: number): Promise<Uint8Array>;
  decodificarImagen(bytes: Uint8Array, mime?: string): Promise<ImagenDecodificada>;

  /** pdf.js cargado y listo, con los parámetros de `getDocument` propios de la plataforma. */
  pdfjs(): Promise<{ lib: typeof import('pdfjs-dist'); parametros: Record<string, unknown> }>;
  /** Abre un motor de rasterizado con `hilos` trabajadores (0 = en este hilo). */
  motorPdf(bytes: Uint8Array, hilos: number): Promise<MotorPdf>;
  /** Hilos por defecto. */
  hilosPorDefecto(): number;

  /** Decodifica el audio (de un audio o de la pista de un vídeo) a PCM 16 kHz mono. null si no sabe. */
  pcm(bytes: Uint8Array, mime: string, nombre: string): Promise<FuentePcm | null>;
  /** Codifica PCM 16 kHz mono. Devuelve null si el formato no está disponible. */
  codificarAudio(pcm: Float32Array, formato: 'opus' | 'wav'): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** Fotogramas clave de un vídeo. null si no sabe. */
  fotogramas(bytes: Uint8Array, mime: string, nombre: string): Promise<FuenteFotogramas | null>;
}
