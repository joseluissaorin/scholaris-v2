/**
 * El proxy de un medio: una copia ligera (360p H.264 a unos 300 kbps y audio
 * mono AAC a 48 kbps; solo audio en los audios) que el conversor deja junto al
 * original. Es lo que ven los modelos: la percepción y la herramienta «ver» de
 * Investigar. Claves en el almacén (prefijo = `u/<usuario>/d/<documento>/`):
 *
 *   proxy.mp4           el proxy (video/mp4, o audio/mp4 si es solo audio)
 *   proxy.cortes.json   cortes de plano detectados por ffmpeg ({ cortes: [s…] })
 *   proxy.gemini.json   el fichero en la API de Gemini: { uri, nombre, mime, bytes, etag, subido, expira }
 */

export const PROXY = {
  video: 'proxy.mp4',
  cortes: 'proxy.cortes.json',
  gemini: 'proxy.gemini.json',
} as const;

export function clavesProxy(prefijo: string): { proxy: string; cortes: string; gemini: string } {
  const p = prefijo.endsWith('/') ? prefijo : `${prefijo}/`;
  return { proxy: `${p}${PROXY.video}`, cortes: `${p}${PROXY.cortes}`, gemini: `${p}${PROXY.gemini}` };
}

export { PARAMETROS_PROXY, interpretarEscenasFfmpeg, cortesDe, type CortesProxy } from '@scholaris/imprenta';
