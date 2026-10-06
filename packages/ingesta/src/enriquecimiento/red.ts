/**
 * Consultas a catálogos abiertos (OpenAlex, Crossref, Open Library, Wikidata,
 * Wikipedia, Google Books, arXiv, DataCite): gratis, sin claves, con un
 * User-Agent educado y una dirección de contacto, plazo máximo por petición y
 * caché (en memoria por defecto; un puerto opcional la hace persistente).
 */

import type { Http } from '../tipos.js';

export const CONTACTO = 'jl@joseluissaorin.com';

/** Una respuesta que, además de JSON, puede dar texto (arXiv responde en Atom). */
type RespuestaTexto = Awaited<ReturnType<Http>> & { text?(): Promise<string> };

/** Caché persistente opcional (KV, disco…). Los valores son JSON o texto. */
export interface CacheConsultas {
  leer(clave: string): Promise<string | null | undefined>;
  guardar(clave: string, valor: string): Promise<void>;
}

export interface OpcionesConsultor {
  http?: Http;
  correo?: string;
  /** Milisegundos por petición. */
  plazo?: number;
  cache?: CacheConsultas;
  /** Clave opcional de OpenAlex (OPENALEX_API_KEY). Sin ella, «polite pool» con mailto. */
  claveOpenAlex?: string;
}

/** Catálogos: clave opcional y caché persistente, tal como llegan en los puertos de la ingesta. */
export interface PuertoCatalogos {
  claveOpenAlex?: string;
  cache?: CacheConsultas;
}

/** Caché sobre un KV de Cloudflare (o cualquier cosa con get/put), con caducidad. */
export function cacheEnKv(kv: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }, prefijo = 'catalogos:', segundos = 30 * 24 * 3600): CacheConsultas {
  return {
    leer: (k) => kv.get(prefijo + huella(k)),
    guardar: (k, v) => kv.put(prefijo + huella(k), v, { expirationTtl: segundos }),
  };
}

/** Caché sobre el almacén de objetos (R2 en la nube, disco en local) cuando no hay KV. */
export function cacheEnAlmacen(almacen: { bytes(k: string): Promise<Uint8Array | null>; poner(k: string, cuerpo: string, tipo?: string): Promise<void> }, prefijo = 'cache/catalogos/'): CacheConsultas {
  return {
    async leer(k) { const b = await almacen.bytes(prefijo + huella(k)); return b ? new TextDecoder().decode(b) : null; },
    guardar: (k, v) => almacen.poner(prefijo + huella(k), v, 'application/json'),
  };
}

/** Clave corta y estable para una URL (FNV-1a de 64 bits en dos mitades). */
export function huella(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${s.length.toString(16)}`;
}

/** OpenAlex: siempre con mailto («polite pool») y, si la hay, con la clave. La clave no entra en la caché ni en el registro. */
function conOpenAlex(url: string, correo: string, clave?: string): { pedir: string; registrar: string } {
  if (!/^https:\/\/api\.openalex\.org\//.test(url)) return { pedir: url, registrar: url };
  const u = new URL(url);
  if (!u.searchParams.has('mailto')) u.searchParams.set('mailto', correo);
  const registrar = u.toString();
  if (clave) u.searchParams.set('api_key', clave);
  return { pedir: u.toString(), registrar };
}

const memoria = new Map<string, string>();
const MAX_MEMORIA = 2000;

export interface Consultor {
  json<T = unknown>(url: string, cabeceras?: Record<string, string>): Promise<T | null>;
  texto(url: string, cabeceras?: Record<string, string>): Promise<string | null>;
  /** URLs pedidas (para la procedencia). */
  consultas: string[];
  correo: string;
}

export function crearConsultor(o: OpcionesConsultor = {}): Consultor {
  const http: Http = o.http ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<Http>);
  const correo = o.correo ?? CONTACTO;
  const plazo = o.plazo ?? 8000;
  const consultas: string[] = [];
  const ua = { 'User-Agent': `Scholaris/2 (https://scholaris.joseluissaorin.com; mailto:${correo})` };

  async function pedir(urlPedida: string, modo: 'json' | 'texto', cabeceras: Record<string, string> = {}): Promise<string | null> {
    const { pedir: url, registrar } = conOpenAlex(urlPedida, correo, o.claveOpenAlex);
    const clave = `${modo}:${registrar}`;
    const enMemoria = memoria.get(clave);
    if (enMemoria !== undefined) return enMemoria;
    if (o.cache) {
      try {
        const v = await o.cache.leer(clave);
        if (v !== null && v !== undefined) { memoria.set(clave, v); return v; }
      } catch { /* la caché nunca rompe una ingesta */ }
    }
    consultas.push(registrar);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), plazo);
    try {
      const r = (await http(url, { headers: { ...ua, ...cabeceras }, signal: ctrl.signal })) as RespuestaTexto;
      // 404 es una respuesta (no existe): se recuerda. 429 y 5xx no.
      if (!r.ok) {
        if (r.status === 404) guardar(clave, '');
        return null;
      }
      let v: string;
      if (modo === 'texto') {
        if (!r.text) return null;
        v = await r.text();
      } else v = JSON.stringify(await r.json());
      guardar(clave, v);
      return v;
    } catch { return null; } finally { clearTimeout(t); }
  }

  function guardar(clave: string, v: string) {
    if (memoria.size >= MAX_MEMORIA) memoria.delete(memoria.keys().next().value as string);
    memoria.set(clave, v);
    if (o.cache) o.cache.guardar(clave, v).catch(() => {});
  }

  return {
    consultas,
    correo,
    async json<T>(url: string, cabeceras?: Record<string, string>) {
      const v = await pedir(url, 'json', cabeceras);
      if (!v) return null;
      try { return JSON.parse(v) as T; } catch { return null; }
    },
    texto: (url, cabeceras) => pedir(url, 'texto', cabeceras),
  };
}

/** Vacía la caché en memoria (pruebas). */
export function vaciarCacheConsultas(): void { memoria.clear(); }
