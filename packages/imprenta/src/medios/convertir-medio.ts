/**
 * Audio y vídeo → tramos de audio mono 16 kHz (Ogg/Opus o WAV) con solape, y
 * fotogramas clave con su instante. El audio y los fotogramas van en paralelo
 * y cada pieza sale en cuanto está lista.
 */

import type { TipoEntrada } from '@scholaris/nucleo';
import type { Contexto } from '../contexto.js';
import { num4 } from '../contexto.js';
import type { Deteccion } from '../detectar.js';
import type { ImagenDecodificada } from '../plataforma.js';
import type { ArchivoEntrada, ContenidoMedio, Fotograma, OrigenArchivo, PaqueteConversion, ReservaServidor, TramoAudio } from '../tipos.js';
import { VERSION_PAQUETE } from '../tipos.js';

export const MUESTREO = 16000;

/**
 * Trocea un flujo de PCM en tramos de `tramo` segundos con `solape` segundos
 * de solape AL PRINCIPIO de cada tramo (salvo el primero). Llama a `emitir`
 * con cada tramo en cuanto se completa.
 */
export async function trocearPcm(
  bloques: AsyncIterable<Float32Array>,
  tramo: number,
  solape: number,
  emitir: (pcm: Float32Array, t0: number, t1: number, propioDesde: number, propioHasta: number) => Promise<void>,
): Promise<number> {
  const L = Math.round(tramo * MUESTREO);
  const S = Math.round(solape * MUESTREO);
  let buffer = new Float32Array(L + S + MUESTREO * 10);
  let inicioBuffer = 0; // índice absoluto de la muestra buffer[0]
  let lleno = 0;
  let k = 0;
  let total = 0;
  const sacar = async (hasta: number) => {
    const desde = Math.max(0, k * L - S);
    const pcm = buffer.slice(desde - inicioBuffer, hasta - inicioBuffer);
    await emitir(pcm, desde / MUESTREO, hasta / MUESTREO, (k * L) / MUESTREO, hasta / MUESTREO);
    k++;
  };
  for await (const b of bloques) {
    let o = 0;
    while (o < b.length) {
      if (lleno === buffer.length) {
        const mayor = new Float32Array(buffer.length * 2);
        mayor.set(buffer);
        buffer = mayor;
      }
      const n = Math.min(b.length - o, buffer.length - lleno);
      buffer.set(b.subarray(o, o + n), lleno);
      lleno += n; o += n; total += n;
      while (inicioBuffer + lleno >= (k + 1) * L) {
        const fin = (k + 1) * L;
        await sacar(fin);
        // Conserva desde (fin − solape) en adelante.
        const conservar = fin - S - inicioBuffer;
        buffer.copyWithin(0, conservar, lleno);
        lleno -= conservar;
        inicioBuffer += conservar;
      }
    }
  }
  if (total > k * L) await sacar(total);
  return total / MUESTREO;
}

/** Firma de un fotograma: luminancia a 64 × 36. */
function firma(ctx: Contexto, img: ImagenDecodificada): Float32Array {
  const W = 64, H = 36;
  const l = ctx.plataforma.crearLienzo(W, H);
  l.ctx.imageSmoothingEnabled = true;
  l.ctx.drawImage(img.fuente, 0, 0, img.ancho, img.alto, 0, 0, W, H);
  const d = l.ctx.getImageData(0, 0, W, H).data;
  const f = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) f[i] = (0.299 * (d[i * 4] as number) + 0.587 * (d[i * 4 + 1] as number) + 0.114 * (d[i * 4 + 2] as number)) / 255;
  return f;
}

export function diferencia(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] as number) - (b[i] as number));
  return s / a.length;
}

export async function convertirMedio(ctx: Contexto, archivo: ArchivoEntrada, d: Deteccion, origen: OrigenArchivo, tipo: TipoEntrada): Promise<PaqueteConversion> {
  const { plataforma, op } = ctx;
  const esVideo = tipo === 'video';
  const tareasReserva: string[] = [];

  const [fuentePcm, fuenteVideo] = await Promise.all([
    ctx.medir('abrir', () => plataforma.pcm(archivo.bytes, d.mime, archivo.nombre)),
    esVideo ? ctx.medir('abrir', () => plataforma.fotogramas(archivo.bytes, d.mime, archivo.nombre)) : Promise.resolve(null),
  ]);
  const duracionPrevista = fuentePcm?.duracion ?? fuenteVideo?.duracion ?? null;
  await ctx.emitir({ tipo: 'inicio', entrada: tipo, origen, unidades: null, ...(duracionPrevista ? { duracion: duracionPrevista } : {}), metadatos: {} });

  // --- Audio ---
  const tramos: TramoAudio[] = [];
  let formato: 'opus' | 'wav' = op.formatoAudio;
  let mime = formato === 'opus' ? 'audio/ogg' : 'audio/wav';
  let duracionAudio = 0;
  const audio = (async () => {
    if (!fuentePcm) { tareasReserva.push('decodificar_audio'); return; }
    const t = performance.now();
    // Se codifica un tramo mientras se decodifica el siguiente (hasta 3 a la vez).
    const enVuelo = new Set<Promise<void>>();
    let contador = 0;
    const codificar = async (n: number, pcm: Float32Array, t0: number, t1: number, propioDesde: number, propioHasta: number) => {
      ctx.comprobar();
      let cod = await plataforma.codificarAudio(pcm, formato);
      if (!cod && formato === 'opus') {
        formato = 'wav';
        await ctx.aviso('Opus no disponible: los tramos van en WAV');
        cod = await plataforma.codificarAudio(pcm, 'wav');
      }
      if (!cod) throw new Error('No se pudo codificar el audio');
      mime = cod.mime;
      const ext = cod.mime === 'audio/wav' ? 'wav' : 'ogg';
      const parte = await ctx.parte(`audio/${num4(n)}.${ext}`, 'audio', cod.mime, cod.bytes, { unidad: n, t0: r3(t0), t1: r3(t1) });
      const tramo: TramoAudio = { n, t0: r3(t0), t1: r3(t1), propioDesde: r3(propioDesde), propioHasta: r3(propioHasta), parte };
      tramos.push(tramo);
      await ctx.emitir({ tipo: 'tramo_audio', tramo });
      await ctx.emitir({ tipo: 'progreso', fase: 'audio', hechas: Math.round(t1), total: duracionPrevista ? Math.round(duracionPrevista) : null });
    };
    let fallo: unknown = null;
    duracionAudio = await trocearPcm(fuentePcm.bloques, op.tramo, op.solape, async (pcm, t0, t1, propioDesde, propioHasta) => {
      if (fallo) throw fallo;
      while (enVuelo.size >= 3) await Promise.race(enVuelo);
      const p: Promise<void> = codificar(++contador, pcm, t0, t1, propioDesde, propioHasta).catch((e) => { fallo = e; }).finally(() => enVuelo.delete(p));
      enVuelo.add(p);
    });
    await Promise.all(enVuelo);
    if (fallo) throw fallo;
    tramos.sort((a, b) => a.n - b.n);
    ctx.tiempos.audio = Math.round(performance.now() - t);
  })();

  // --- Fotogramas ---
  const fotogramas: Fotograma[] = [];
  let ultimoT = 0;
  const video = (async () => {
    if (!esVideo) return;
    if (!fuenteVideo) { tareasReserva.push('fotogramas'); return; }
    const t = performance.now();
    let elegida: Float32Array | null = null;
    let tElegida = -Infinity;
    let vistos = 0;
    for await (const { t: instante, imagen } of fuenteVideo.fotogramas) {
      ctx.comprobar();
      vistos++;
      ultimoT = Math.max(ultimoT, instante);
      const f = firma(ctx, imagen);
      const dif = elegida ? diferencia(f, elegida) : 1;
      let motivo: Fotograma['motivo'] | null = null;
      if (!elegida) motivo = 'inicio';
      else if (dif >= op.umbralEscena && instante - tElegida >= 3) motivo = 'escena';
      else if (instante - tElegida >= op.intervaloFotogramas && dif >= 0.01) motivo = 'periodico';
      if (motivo) {
        const e = Math.min(1, op.ladoFotograma / Math.max(imagen.ancho, imagen.alto));
        const w = Math.max(1, Math.round(imagen.ancho * e)), h = Math.max(1, Math.round(imagen.alto * e));
        const l = plataforma.crearLienzo(w, h);
        l.ctx.imageSmoothingEnabled = true;
        l.ctx.imageSmoothingQuality = 'high';
        l.ctx.drawImage(imagen.fuente, 0, 0, imagen.ancho, imagen.alto, 0, 0, w, h);
        const n = fotogramas.length + 1;
        const parte = await ctx.parte(`fotogramas/${num4(n)}.jpg`, 'fotograma', 'image/jpeg', await plataforma.aJpeg(l, op.calidadJpeg), { t0: r3(instante), ancho: w, alto: h });
        const fot: Fotograma = { t: r3(instante), motivo, diferencia: r3(dif), parte };
        fotogramas.push(fot);
        await ctx.emitir({ tipo: 'fotograma', fotograma: fot });
        elegida = f;
        tElegida = instante;
      }
      imagen.cerrar();
      if (vistos % 25 === 0) await ctx.emitir({ tipo: 'progreso', fase: 'fotogramas', hechas: Math.round(instante), total: duracionPrevista ? Math.round(duracionPrevista) : null });
    }
    ctx.tiempos.fotogramas = Math.round(performance.now() - t);
    ctx.tiempos['fotogramas.vistos'] = vistos;
  })();

  await Promise.all([audio, video]);
  const duracion = r3(duracionPrevista ?? Math.max(duracionAudio, ultimoT));
  const contenido: ContenidoMedio = {
    clase: 'medio',
    duracion,
    audio: fuentePcm ? { muestreo: MUESTREO, canales: 1, formato, mime, tramos } : null,
    video: esVideo && fuenteVideo ? { ancho: fuenteVideo.ancho, alto: fuenteVideo.alto, ...(fuenteVideo.codec ? { codec: fuenteVideo.codec } : {}), fotogramas } : null,
  };
  const reserva: ReservaServidor | null = tareasReserva.length
    ? { motivo: `${plataforma.nombre} no sabe decodificar ${d.formato} (${d.mime})`, tareas: tareasReserva }
    : null;
  return {
    version: VERSION_PAQUETE,
    tipo,
    origen,
    metadatos: {},
    unidades: tramos.length,
    duracion,
    contenido,
    partes: ctx.partes,
    reserva,
    avisos: ctx.avisos,
    entorno: plataforma.nombre,
    tiempos: ctx.cerrarTiempos(),
  };
}

function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
