/**
 * Firmas HMAC-SHA256 (WebCrypto: Workers, Node y Bun) para:
 *   - URLs de lectura de binarios del almacén (/api/v2/binarios),
 *   - URLs de subida directa a través de la API (/api/v2/subidas/directa),
 *   - billetes del WebSocket de tiempo real.
 * Mismo enfoque que Andarama: parámetros canónicos + firma en hex.
 */

const codificador = new TextEncoder();
const cacheClaves = new Map<string, Promise<CryptoKey>>();

function clave(secreto: string): Promise<CryptoKey> {
  let k = cacheClaves.get(secreto);
  if (!k) {
    k = crypto.subtle.importKey('raw', codificador.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    cacheClaves.set(secreto, k);
  }
  return k;
}

export async function firmar(secreto: string, carga: string): Promise<string> {
  const f = await crypto.subtle.sign('HMAC', await clave(secreto), codificador.encode(carga));
  return aBase64Url(new Uint8Array(f));
}

export async function verificar(secreto: string, carga: string, firma: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', await clave(secreto), deBase64Url(firma), codificador.encode(carga));
  } catch {
    return false;
  }
}

export function aBase64Url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

/** Firma un conjunto de parámetros (orden alfabético) con caducidad. */
export async function firmarParametros(secreto: string, params: Record<string, string>, segundos: number): Promise<URLSearchParams> {
  const p = new URLSearchParams({ ...params, exp: String(Math.floor(Date.now() / 1000) + segundos) });
  p.sort();
  p.set('sig', await firmar(secreto, p.toString()));
  return p;
}

/** Verifica parámetros firmados con `firmarParametros`; devuelve los parámetros sin la firma o null. */
export async function verificarParametros(secreto: string, entrada: URLSearchParams): Promise<Record<string, string> | null> {
  const sig = entrada.get('sig');
  if (!sig) return null;
  const p = new URLSearchParams(entrada);
  p.delete('sig');
  p.sort();
  const exp = Number(p.get('exp'));
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
  if (!(await verificar(secreto, p.toString(), sig))) return null;
  return Object.fromEntries(p.entries());
}

/** Billete compacto: base64url(JSON).firma — para el WebSocket. */
export async function firmarBillete<T extends object>(secreto: string, datos: T, segundos: number): Promise<string> {
  const cuerpo = aBase64Url(codificador.encode(JSON.stringify({ ...datos, exp: Math.floor(Date.now() / 1000) + segundos })));
  return `${cuerpo}.${await firmar(secreto, `billete:${cuerpo}`)}`;
}

export async function verificarBillete<T>(secreto: string, billete: string): Promise<T | null> {
  const [cuerpo, firma] = billete.split('.');
  if (!cuerpo || !firma || !(await verificar(secreto, `billete:${cuerpo}`, firma))) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(deBase64Url(cuerpo))) as T & { exp: number };
    return d.exp >= Math.floor(Date.now() / 1000) ? d : null;
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante de dos cadenas. */
export function igualesSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
