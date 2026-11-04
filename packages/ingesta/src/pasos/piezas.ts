/**
 * Piezas cortas de audio para el transcriptor (packages/ingesta/src/percepcion/NOTAS.md,
 * «La transcripción: por qué tiene huecos»).
 *
 * `gemini-3.5-transcribe` se salta a veces tramos largos de un trozo de 10 min, y no
 * siempre los mismos: en la película faltaron 71 de 128 segmentos de Whisper en un
 * tramo de 10 min y 23 en trozos de 2 min (casi todo letra de canciones). Por eso
 * cada tramo del conversor se parte aquí en piezas de unos 150 s con unos segundos
 * de solape, sin decodificar nada:
 *
 * - Ogg/Opus (lo que hacen el navegador y el contenedor): se leen los paquetes, la
 *   duración de cada uno sale de su byte TOC y se vuelven a empaquetar los de cada
 *   pieza con la misma cabecera `OpusHead`. Se corta en límites de paquete (20 ms).
 * - WAV PCM: se cortan las muestras y se reescribe la cabecera.
 * - YouTube (la parte es un JSON con la URL y el tramo): otro JSON con el subtramo.
 *
 * Lo demás (MP3 por rangos de bytes…) no se parte: va entero, como antes.
 */
import { escribirOggOpus, leerOgg } from '@scholaris/imprenta';

export const MIME_YOUTUBE = 'application/x-youtube';

/** Segundos por pieza y de solape entre piezas (medido: 2-3 min no pierden los tramos largos). */
export const PIEZA_ASR = 150;
export const SOLAPE_PIEZA = 5;

export interface AudioBinario {
  bytes: Uint8Array;
  mime: string;
}

export interface PiezaAudio extends AudioBinario {
  /** Instante absoluto donde empieza y acaba el audio de la pieza (solape incluido). */
  t0: number;
  t1: number;
  /** Lo que le es propio a la pieza (sin la mitad de cada solape): para no repetir palabras al unir. */
  propioDesde: number;
  propioHasta: number;
}

// ---------------------------------------------------------------------------
// Opus
// ---------------------------------------------------------------------------

/** Muestras (a 48 kHz) de un paquete Opus según su byte TOC (RFC 6716, §3.1). 0 si no se entiende. */
export function muestrasPaqueteOpus(p: Uint8Array): number {
  if (!p.length) return 0;
  const toc = p[0]!;
  const config = toc >> 3;
  const trama = config < 12 ? [480, 960, 1920, 2880][config % 4]! : config < 16 ? [480, 960][config % 2]! : [120, 240, 480, 960][config % 4]!;
  const codigo = toc & 3;
  const tramas = codigo === 0 ? 1 : codigo < 3 ? 2 : p.length > 1 ? (p[1]! & 0x3f) : 0;
  return trama * tramas;
}

interface OpusLeido {
  cabecera: Uint8Array;
  paquetes: Uint8Array[];
  /** Muestra (48 kHz) donde empieza cada paquete, contada desde el principio del flujo. */
  inicios: number[];
  duraciones: number[];
  preskip: number;
}

function leerOpus(bytes: Uint8Array): OpusLeido | null {
  if (bytes.length < 47 || bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) return null;
  let todos: Uint8Array[];
  try { todos = leerOgg(bytes); } catch { return null; }
  const cabecera = todos[0];
  if (!cabecera || cabecera.length < 19 || new TextDecoder().decode(cabecera.subarray(0, 8)) !== 'OpusHead') return null;
  const preskip = new DataView(cabecera.buffer, cabecera.byteOffset, cabecera.byteLength).getUint16(10, true);
  // El segundo paquete son las etiquetas (OpusTags); el audio empieza en el tercero.
  const inicioAudio = todos[1] && new TextDecoder().decode(todos[1].subarray(0, 8)) === 'OpusTags' ? 2 : 1;
  const paquetes = todos.slice(inicioAudio);
  const duraciones = paquetes.map(muestrasPaqueteOpus);
  if (!paquetes.length || duraciones.some((d) => d <= 0)) return null;
  const inicios: number[] = [];
  let s = 0;
  for (const d of duraciones) { inicios.push(s); s += d; }
  return { cabecera, paquetes, inicios, duraciones, preskip };
}

/**
 * Recorta un Ogg/Opus a [desde, hasta) segundos contados desde su principio, en
 * límites de paquete. Devuelve el Ogg nuevo y dónde empieza de verdad (en segundos
 * desde el principio del original).
 */
export function recortarOggOpus(bytes: Uint8Array, desde: number, hasta: number, leido?: OpusLeido | null): { bytes: Uint8Array; inicio: number; fin: number } | null {
  const o = leido ?? leerOpus(bytes);
  if (!o) return null;
  // Un paquete que empieza en la muestra S suena (tras el preskip del original) en S / 48000.
  const a = Math.max(0, Math.round(desde * 48000)), b = Math.round(hasta * 48000);
  let i = o.inicios.findIndex((s, k) => s + o.duraciones[k]! > a);
  if (i < 0) return null;
  let j = i;
  while (j < o.paquetes.length && o.inicios[j]! < b) j++;
  if (j <= i) j = i + 1;
  // Opus necesita unos paquetes para asentarse: se empieza uno antes si se puede (el solape lo absorbe).
  if (i > 0 && desde > 0) i--;
  const ogg = escribirOggOpus(o.paquetes.slice(i, j), o.duraciones.slice(i, j), { cabecera: o.cabecera });
  const fin = o.inicios[j - 1]! + o.duraciones[j - 1]!;
  return { bytes: ogg, inicio: o.inicios[i]! / 48000, fin: fin / 48000 };
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

/** Recorta un WAV PCM a [desde, hasta) segundos sin decodificarlo. */
export function recortarWav(bytes: Uint8Array, desde: number, hasta: number): { bytes: Uint8Array; inicio: number; fin: number } | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const txt = (o: number) => String.fromCharCode(bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0);
  if (bytes.length < 44 || txt(0) !== 'RIFF' || txt(8) !== 'WAVE') return null;
  let o = 12, fmt: Uint8Array | null = null, bloque = 0, muestreo = 0, datos = -1, largo = 0;
  while (o + 8 <= bytes.length) {
    const id = txt(o), tam = v.getUint32(o + 4, true);
    if (id === 'fmt ') { fmt = bytes.subarray(o + 8, o + 8 + tam); muestreo = v.getUint32(o + 12, true); bloque = v.getUint16(o + 20, true); }
    else if (id === 'data') { datos = o + 8; largo = Math.min(tam, bytes.length - datos); break; }
    o += 8 + tam + (tam % 2);
  }
  if (!fmt || datos < 0 || !bloque || !muestreo) return null;
  const n = Math.floor(largo / bloque);
  const a = Math.max(0, Math.min(n, Math.floor(desde * muestreo))), b = Math.max(a, Math.min(n, Math.ceil(hasta * muestreo)));
  if (b <= a) return null;
  const cuerpo = bytes.subarray(datos + a * bloque, datos + b * bloque);
  const out = new Uint8Array(12 + 8 + fmt.length + 8 + cuerpo.length);
  const w = new DataView(out.buffer);
  const poner = (p: number, s: string) => { for (let k = 0; k < 4; k++) out[p + k] = s.charCodeAt(k); };
  poner(0, 'RIFF'); w.setUint32(4, out.length - 8, true); poner(8, 'WAVE');
  poner(12, 'fmt '); w.setUint32(16, fmt.length, true); out.set(fmt, 20);
  const d = 20 + fmt.length;
  poner(d, 'data'); w.setUint32(d + 4, cuerpo.length, true); out.set(cuerpo, d + 8);
  return { bytes: out, inicio: a / muestreo, fin: b / muestreo };
}

// ---------------------------------------------------------------------------
// Cualquier audio del paquete
// ---------------------------------------------------------------------------

const esOgg = (mime: string) => /ogg|opus/i.test(mime);
const esWav = (mime: string) => /wav|wave/i.test(mime);

/**
 * Recorta el audio de un tramo (que empieza en `t0Tramo`) a [desde, hasta)
 * segundos ABSOLUTOS. Devuelve el audio y su desplazamiento (dónde empieza de
 * verdad, en absoluto), o null si el formato no se puede recortar.
 */
export function recortarAudio(audio: AudioBinario, t0Tramo: number, desde: number, hasta: number): (AudioBinario & { desplazamiento: number; fin: number }) | null {
  if (audio.mime === MIME_YOUTUBE) {
    try {
      const j = JSON.parse(new TextDecoder().decode(audio.bytes)) as { url: string; t0: number; t1: number };
      const a = Math.max(j.t0, desde), b = j.t1 > j.t0 ? Math.min(j.t1, hasta) : hasta;
      if (b <= a) return null;
      return { bytes: new TextEncoder().encode(JSON.stringify({ ...j, t0: a, t1: b })), mime: audio.mime, desplazamiento: a, fin: b };
    } catch { return null; }
  }
  const r = esOgg(audio.mime) ? recortarOggOpus(audio.bytes, desde - t0Tramo, hasta - t0Tramo) : esWav(audio.mime) ? recortarWav(audio.bytes, desde - t0Tramo, hasta - t0Tramo) : null;
  return r ? { bytes: r.bytes, mime: audio.mime, desplazamiento: t0Tramo + r.inicio, fin: t0Tramo + r.fin } : null;
}

/**
 * Parte el audio de un tramo [t0, t1] en piezas de unos `pieza` s con `solape` s
 * de solape. null si no hace falta (el tramo ya es corto) o si el formato no se
 * puede partir: entonces se transcribe entero.
 */
export function partirAudio(audio: AudioBinario, tramo: { t0: number; t1: number }, o: { pieza?: number; solape?: number } = {}): PiezaAudio[] | null {
  const pieza = o.pieza ?? PIEZA_ASR, solape = o.solape ?? SOLAPE_PIEZA;
  const dur = tramo.t1 - tramo.t0;
  if (!(pieza > 0) || !(dur > pieza * 1.25)) return null;
  let n = Math.max(2, Math.round(dur / pieza));
  if (dur / n > pieza * 1.25) n++;
  const limites = Array.from({ length: n + 1 }, (_, k) => tramo.t0 + (dur * k) / n);
  const leido = esOgg(audio.mime) && audio.mime !== MIME_YOUTUBE ? leerOpus(audio.bytes) : null;
  if (esOgg(audio.mime) && audio.mime !== MIME_YOUTUBE && !leido) return null;
  const piezas: PiezaAudio[] = [];
  for (let k = 0; k < n; k++) {
    const desde = k ? limites[k]! - solape : tramo.t0, hasta = limites[k + 1]!;
    let r: (AudioBinario & { desplazamiento: number; fin: number }) | null;
    if (leido) {
      const c = recortarOggOpus(audio.bytes, desde - tramo.t0, hasta - tramo.t0, leido);
      r = c ? { bytes: c.bytes, mime: audio.mime, desplazamiento: tramo.t0 + c.inicio, fin: tramo.t0 + c.fin } : null;
    } else r = recortarAudio(audio, tramo.t0, desde, hasta);
    if (!r) return null;
    piezas.push({
      bytes: r.bytes, mime: r.mime, t0: r.desplazamiento, t1: r.fin,
      propioDesde: k ? limites[k]! - solape / 2 : -Infinity, propioHasta: k < n - 1 ? limites[k + 1]! - solape / 2 : Infinity,
    });
  }
  return piezas;
}
