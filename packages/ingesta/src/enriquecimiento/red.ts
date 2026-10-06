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

  async function pedir(url: string, modo: 'json' | 'texto', cabeceras: Record<string, string> = {}): Promise<string | null> {
    const clave = `${modo}:${url}`;
    const enMemoria = memoria.get(clave);
    if (enMemoria !== undefined) return enMemoria;
    if (o.cache) {
      try {
        const v = await o.cache.leer(clave);
        if (v !== null && v !== undefined) { memoria.set(clave, v); return v; }
      } catch { /* la caché nunca rompe una ingesta */ }
    }
    consultas.push(url);
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
