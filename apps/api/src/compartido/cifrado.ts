/**
 * Cifrado de las claves propias (BYOK) con AES-256-GCM. La clave maestra es un
 * secreto de la instancia (CLAVE_MAESTRA, 32 bytes en base64 o hex, o una frase
 * de la que se deriva con HKDF). Cada valor lleva su IV y el usuario como datos
 * asociados: una clave copiada a otro usuario no se descifra.
 */
import { aBase64Url, deBase64Url } from './firmas.js';

const enc = new TextEncoder();
const cache = new Map<string, Promise<CryptoKey>>();

function claveMaestra(secreto: string): Promise<CryptoKey> {
  let k = cache.get(secreto);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', enc.encode(secreto), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('scholaris-byok-v1'), info: enc.encode('aes-gcm') },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    cache.set(secreto, k);
  }
  return k;
}

export async function cifrar(secreto: string, usuario: string, texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(usuario) }, await claveMaestra(secreto), enc.encode(texto));
  return `v1.${aBase64Url(iv)}.${aBase64Url(new Uint8Array(c))}`;
}

export async function descifrar(secreto: string, usuario: string, cifrado: string): Promise<string> {
  const [v, iv, datos] = cifrado.split('.');
  if (v !== 'v1' || !iv || !datos) throw new Error('Formato de clave cifrada desconocido');
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64Url(iv), additionalData: enc.encode(usuario) }, await claveMaestra(secreto), deBase64Url(datos));
  return new TextDecoder().decode(p);
}

export async function sha256Hex(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(texto));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
