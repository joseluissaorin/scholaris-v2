/**
 * Guardia de red del modo sin conexión: ninguna petición sale de la red local.
 *
 * Cierra las tres puertas por las que Node habla con fuera:
 *  - `globalThis.fetch` (lo que usan los proveedores, los catálogos, Wikidata…);
 *  - el despachador global de undici (fetch de Node y `undici.request`), con un
 *    `connect` que mira el anfitrión antes de abrir el socket;
 *  - `http.request`/`https.request` (y sus `get`).
 *
 * Lo bloqueado lanza un error («bloqueado por el modo sin conexión») que los
 * llamadores ya tratan como «sin red», y queda anotado: una línea en la consola
 * la primera vez por anfitrión y la lista entera en `bloqueadas`.
 */
import http from 'node:http';
import https from 'node:https';
import { Agent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici';
import { esAnfitrionLocal } from '@scholaris/proveedores';

export interface PeticionBloqueada { url: string; anfitrion: string; via: 'fetch' | 'undici' | 'http'; t: number }

export interface GuardiaDeRed {
  readonly bloqueadas: PeticionBloqueada[];
  /** Anfitriones permitidos además de los locales. */
  readonly permitidos: string[];
  quitar(): void;
}

export class ErrorSinConexion extends Error {
  constructor(public readonly url: string) {
    super(`Bloqueado por el modo sin conexión: ${url} no es una dirección local`);
    this.name = 'ErrorSinConexion';
  }
}

let activa: GuardiaDeRed | null = null;

export function guardiaActiva(): GuardiaDeRed | null { return activa; }

export function instalarGuardiaDeRed(o: { permitidos?: string[]; avisar?: (p: PeticionBloqueada) => void; silenciosa?: boolean } = {}): GuardiaDeRed {
  if (activa) return activa;
  const permitidos = (o.permitidos ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const bloqueadas: PeticionBloqueada[] = [];
  const avisados = new Set<string>();
  const anotar = (url: string, anfitrion: string, via: PeticionBloqueada['via']) => {
    const p = { url: url.replace(/([?&](key|api_key|token|mailto)=)[^&]+/gi, '$1***'), anfitrion, via, t: Date.now() };
    bloqueadas.push(p);
    if (bloqueadas.length > 5000) bloqueadas.splice(0, 1000);
    o.avisar?.(p);
    if (!o.silenciosa && !avisados.has(anfitrion)) {
      avisados.add(anfitrion);
      console.warn(`[sin conexión] bloqueada una petición a ${anfitrion} (${via}: ${p.url.slice(0, 160)}); las siguientes a ese anfitrión se bloquean sin aviso`);
    }
  };
  const local = (anfitrion: string) => esAnfitrionLocal(anfitrion, permitidos);

  // 1. fetch
  const fetchOriginal = globalThis.fetch;
  const fetchGuardado: typeof fetch = async (entrada, init) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : (entrada as Request).url;
    let anfitrion = '';
    try { anfitrion = new URL(url).hostname; } catch { /* relativa: no sale */ }
    if (anfitrion && !local(anfitrion)) { anotar(url, anfitrion, 'fetch'); throw new ErrorSinConexion(url); }
    return fetchOriginal(entrada as Parameters<typeof fetch>[0], init);
  };
  globalThis.fetch = fetchGuardado;

  // 2. undici (el fetch de Node y quien use undici directamente)
  const despachadorOriginal = getGlobalDispatcher();
  const guardado = new Agent({
    connections: 256, pipelining: 1, keepAliveTimeout: 30_000,
    connect: (opciones, cb) => {
      const anfitrion = String(opciones.hostname ?? '');
      if (!local(anfitrion)) {
        anotar(`${opciones.protocol ?? 'https:'}//${anfitrion}`, anfitrion, 'undici');
        cb(new ErrorSinConexion(`${opciones.protocol ?? 'https:'}//${anfitrion}`), null);
        return;
      }
      // El conector por defecto de undici.
      void import('undici').then(({ buildConnector }) => buildConnector({})(opciones, cb)).catch((e: Error) => cb(e, null));
    },
  }) as Dispatcher;
  setGlobalDispatcher(guardado);

  // 3. http / https
  type Pedir = typeof http.request;
  const originales: Array<[typeof http | typeof https, 'request' | 'get', Pedir]> = [];
  for (const mod of [http, https]) {
    for (const nombre of ['request', 'get'] as const) {
      const original = mod[nombre] as Pedir;
      originales.push([mod, nombre, original]);
      const envuelto = function (this: unknown, ...args: unknown[]) {
        const a = args[0];
        let anfitrion = '';
        let url = '';
        if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); anfitrion = u.hostname; url = u.href; }
        else if (a && typeof a === 'object') {
          const op = a as { hostname?: string; host?: string; protocol?: string; path?: string };
          anfitrion = op.hostname ?? (op.host ?? 'localhost').replace(/:\d+$/, '');
          url = `${op.protocol ?? 'http:'}//${anfitrion}${op.path ?? ''}`;
        }
        if (anfitrion && !local(anfitrion)) {
          anotar(url, anfitrion, 'http');
          throw new ErrorSinConexion(url);
        }
        return (original as (...x: unknown[]) => unknown).apply(this, args);
      };
      (mod as unknown as Record<string, unknown>)[nombre] = envuelto;
    }
  }

  activa = {
    bloqueadas, permitidos,
    quitar() {
      globalThis.fetch = fetchOriginal;
      setGlobalDispatcher(despachadorOriginal);
      for (const [mod, nombre, original] of originales) (mod as unknown as Record<string, unknown>)[nombre] = original;
      activa = null;
    },
  };
  return activa;
}
