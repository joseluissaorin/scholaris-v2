/**
 * El proxy de un medio: una copia ligera para los modelos (360p H.264 a unos
 * 300 kbps con audio mono AAC a 48 kbps; solo audio en los audios), y los
 * cortes de plano que detecta ffmpeg al hacerla. Lo hace el conversor de Node
 * (`crearProxy` en `@scholaris/imprenta/node`); aquí, lo que no depende de la
 * plataforma.
 */

export const PARAMETROS_PROXY = {
  alto: 360,
  kbpsVideo: 300,
  kbpsAudio: 48,
  fpsMax: 15,
  /** Umbral de cambio de escena de ffmpeg para dar un corte por bueno (medido en «Fresa y chocolate»: todos los ≥ 0,3 eran cortes). */
  umbralCorte: 0.3,
  /** Puntuaciones que se guardan (para poder cambiar el umbral sin recalcular). */
  umbralGuardado: 0.08,
  /**
   * Actividad sonora en la banda de la voz (150-4000 Hz): silencio por debajo de -35 dB
   * durante al menos 0,5 s. Medido en «Fresa y chocolate» contra Whisper: cubre el 97-99 %
   * de lo hablado (también marca la música y el ruido, que la revisión descarta al escuchar).
   */
  dbSilencio: -35,
  segundosSilencio: 0.5,
} as const;

/** Tramos con sonido en la banda de la voz: [inicio, fin] en segundos. */
export interface ActividadAudio {
  tramos: Array<[number, number]>;
  db: number;
  duracion: number;
}

/** Filtro de ffmpeg que marca los silencios de la banda de la voz (los escribe `ametadata` en `fichero`). */
export function filtroSilencios(fichero: string, p: { dbSilencio: number; segundosSilencio: number } = PARAMETROS_PROXY): string {
  return `highpass=f=150,lowpass=f=4000,silencedetect=noise=${p.dbSilencio}dB:d=${p.segundosSilencio},ametadata=mode=print:file=${fichero}`;
}

/** Lee los silencios de `silencedetect` (vía `ametadata`) y devuelve lo contrario: los tramos con sonido. */
export function interpretarSilencios(salida: string, duracion: number, db: number = PARAMETROS_PROXY.dbSilencio): ActividadAudio {
  const silencios: Array<[number, number]> = [];
  let inicio: number | null = null;
  for (const l of salida.split('\n')) {
    const a = /silence_start=(-?[\d.]+)/.exec(l);
    if (a) { inicio = Math.max(0, Number(a[1])); continue; }
    const b = /silence_end=([\d.]+)/.exec(l);
    if (b && inicio !== null) { silencios.push([inicio, Number(b[1])]); inicio = null; }
  }
  if (inicio !== null) silencios.push([inicio, duracion]);
  const tramos: Array<[number, number]> = [];
  let t = 0;
  for (const [a, b] of silencios.sort((x, y) => x[0] - y[0])) {
    if (a > t + 0.05) tramos.push([r3(t), r3(a)]);
    t = Math.max(t, b);
  }
  if (duracion > t + 0.05) tramos.push([r3(t), r3(duracion)]);
  return { tramos, db, duracion };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface CortesProxy {
  /** Segundos de los cortes con puntuación ≥ umbral. */
  cortes: number[];
  umbral: number;
  /** Todos los candidatos guardados: [segundo, puntuación]. */
  candidatos?: Array<[number, number]>;
}

/**
 * Lee la salida de `metadata=print` de ffmpeg tras `select='gt(scene,u)'`:
 * líneas «frame:… pts_time:12.345» seguidas de «lavfi.scene_score=0.42».
 */
export function interpretarEscenasFfmpeg(salida: string, umbral: number = PARAMETROS_PROXY.umbralCorte): CortesProxy {
  const candidatos: Array<[number, number]> = [];
  let t: number | null = null;
  for (const l of salida.split('\n')) {
    const m = /pts_time:\s*([\d.]+)/.exec(l);
    if (m) { t = Number(m[1]); continue; }
    const s = /lavfi\.scene_score=([\d.]+)/.exec(l);
    if (s && t !== null) { candidatos.push([Math.round(t * 1000) / 1000, Math.round(Number(s[1]) * 1000) / 1000]); t = null; }
  }
  return { cortes: cortesDe(candidatos, umbral), umbral, candidatos };
}

/** Cortes con puntuación ≥ umbral, sin dos a menos de 0,4 s (un destello no son dos planos). */
export function cortesDe(candidatos: Array<[number, number]>, umbral: number): number[] {
  const out: Array<[number, number]> = [];
  for (const [t, s] of [...candidatos].sort((a, b) => a[0] - b[0])) {
    if (s < umbral) continue;
    const ult = out.at(-1);
    if (ult && t - ult[0] < 0.4) { if (s > ult[1]) out[out.length - 1] = [t, s]; continue; }
    out.push([t, s]);
  }
  return out.map(([t]) => t);
}

/** Los argumentos de ffmpeg para el proxy (y, en vídeo, los cortes en `escenas`). */
/**
 * Los argumentos de ffmpeg para el proxy, en una sola pasada: el proxy, los
 * cortes de plano en `escenas` (vídeo) y los silencios de la voz en `silencios`
 * (si se pide y hay audio).
 */
export function argumentosProxy(entrada: string, salida: string, escenas: string, tipo: 'video' | 'audio', p = PARAMETROS_PROXY, silencios?: string): string[] {
  const audio = ['-c:a', 'aac', '-ac', '1', '-b:a', `${p.kbpsAudio}k`];
  const voz = silencios ? ['-map', '0:a:0', '-af', filtroSilencios(silencios, p), '-f', 'null', '-'] : [];
  if (tipo === 'audio') return ['-v', 'error', '-y', '-i', entrada, '-vn', '-map', '0:a:0', ...audio, '-movflags', '+faststart', salida, ...voz];
  return [
    '-v', 'error', '-y', '-i', entrada,
    '-filter_complex', `[0:v:0]split=2[p][s];[p]scale=-2:${p.alto}:flags=bicubic[v];[s]scale=192:-2,select='gt(scene,${p.umbralGuardado})',metadata=print:file=${escenas}[e]`,
    '-map', '[v]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${p.kbpsVideo}k`, '-maxrate', `${Math.round(p.kbpsVideo * 1.5)}k`, '-bufsize', `${p.kbpsVideo * 3}k`,
    '-fpsmax', String(p.fpsMax), '-g', String(p.fpsMax * 2), '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart', salida,
    '-map', '[e]', '-f', 'null', '-',
    ...voz,
  ];
}
