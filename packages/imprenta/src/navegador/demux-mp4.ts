/**
 * Desmultiplexado de MP4/MOV/M4A con mp4box: pistas, muestras (sin copiar los
 * datos) y la configuración que piden AudioDecoder y VideoDecoder.
 * Es independiente de la plataforma: se prueba en Node.
 */

import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';

export interface MuestraMp4 { datos: Uint8Array; t: number; dur: number; clave: boolean }

export interface PistaMp4 {
  id: number;
  codec: string;
  descripcion?: Uint8Array;
  muestras: MuestraMp4[];
}

export interface Mp4 {
  duracion: number;
  audio: (PistaMp4 & { muestreo: number; canales: number }) | null;
  video: (PistaMp4 & { ancho: number; alto: number }) | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function descripcionVideo(entrada: any): Uint8Array | undefined {
  const caja = entrada?.avcC ?? entrada?.hvcC ?? entrada?.vpcC ?? entrada?.av1C;
  if (!caja) return undefined;
  const ds = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  caja.write(ds);
  return new Uint8Array(ds.buffer, 8); // sin la cabecera de la caja
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function descripcionAudio(entrada: any): Uint8Array | undefined {
  // AAC: DecoderSpecificInfo dentro de esds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const descs: any[] | undefined = entrada?.esds?.esd?.descs;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dcd = descs?.find((d: any) => d?.tag === 0x04) ?? descs?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dsi = dcd?.descs?.find((d: any) => d?.tag === 0x05) ?? dcd?.descs?.[0];
  if (dsi?.data) {
    // mp4box a veces deja relleno de ceros tras el AudioSpecificConfig.
    const d = new Uint8Array(dsi.data);
    let n = d.length;
    while (n > 2 && d[n - 1] === 0) n--;
    return d.slice(0, n);
  }
  // Opus en MP4: dOps → OpusHead, FLAC: dfLa. No hace falta para AAC/MP3.
  return undefined;
}

export function demuxMp4(bytes: Uint8Array): Mp4 | null {
  const archivo = createFile();
  let listo = false;
  archivo.onReady = () => { listo = true; };
  archivo.onError = () => {};
  const copia = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  archivo.appendBuffer(MP4BoxBuffer.fromArrayBuffer(copia, 0));
  archivo.flush();
  if (!listo) return null;
  const info = archivo.getInfo();
  const pista = (id: number): PistaMp4 & { entrada: unknown } => {
    const muestras = archivo.getTrackSamplesInfo(id);
    const trak = archivo.getTrackById(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entrada = (trak as any)?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const t = info.tracks.find((x) => x.id === id);
    return {
      id,
      codec: t?.codec ?? '',
      entrada,
      muestras: muestras.map((s) => ({ datos: bytes.subarray(s.offset, s.offset + s.size), t: s.cts / s.timescale, dur: s.duration / s.timescale, clave: s.is_sync })),
    };
  };
  const a = info.audioTracks[0];
  const v = info.videoTracks[0];
  let audio: Mp4['audio'] = null, video: Mp4['video'] = null;
  if (a) {
    const p = pista(a.id);
    const descripcion = descripcionAudio(p.entrada);
    audio = { id: p.id, codec: p.codec, muestras: p.muestras, muestreo: a.audio?.sample_rate ?? 44100, canales: a.audio?.channel_count ?? 2, ...(descripcion ? { descripcion } : {}) };
  }
  if (v) {
    const p = pista(v.id);
    const descripcion = descripcionVideo(p.entrada);
    video = { id: p.id, codec: p.codec, muestras: p.muestras, ancho: v.video?.width ?? v.track_width, alto: v.video?.height ?? v.track_height, ...(descripcion ? { descripcion } : {}) };
  }
  return { duracion: info.duration / info.timescale, audio, video };
}
