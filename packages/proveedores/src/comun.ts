/**
 * Infraestructura común a todos los proveedores: peticiones con tiempo límite,
 * reintentos con espera exponencial, límite de concurrencia, contabilidad de uso
 * y utilidades de codificación.
 *
 * Solo usa `fetch`, `AbortController`, `btoa`/`atob` y `TextEncoder`: funciona
 * igual en Workers, en Node sin navegador y en Bun. Nada de `Buffer` ni de
 * módulos de Node.
 */

import { reintentar } from '@scholaris/nucleo';

// ---------------------------------------------------------------------------
// Contabilidad
// ---------------------------------------------------------------------------

export type OperacionProveedor = 'leer' | 'vectorizar' | 'generar' | 'transcribir' | 'reordenar' | 'juzgar';

/** Lo que cuesta una llamada. Se emite una vez por petición HTTP que llega a buen puerto. */
export interface UsoProveedor {
  proveedor: string;
  modelo: string;
  operacion: OperacionProveedor;
  tokensEntrada: number;
  tokensSalida: number;
  /** Tokens de entrada servidos desde caché (se cobran más baratos). */
  tokensCache?: number;
  /** Tokens de razonamiento (se cobran como salida; ya incluidos en tokensSalida). */
  tokensPensamiento?: number;
  imagenes?: number;
  paginas?: number;
  segundosAudio?: number;
  /** Coste estimado en dólares según la tabla de `precios.ts`. */
  usd?: number;
  /** Duración de la llamada en milisegundos. */
  ms: number;
  /** El uso es una estimación (el proveedor no devolvió recuento). */
  estimado?: boolean;
}

export interface ResumenUso {
  llamadas: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCache: number;
  imagenes: number;
  paginas: number;
  segundosAudio: number;
  usd: number;
  ms: number;
}

const resumenVacio = (): ResumenUso => ({ llamadas: 0, tokensEntrada: 0, tokensSalida: 0, tokensCache: 0, imagenes: 0, paginas: 0, segundosAudio: 0, usd: 0, ms: 0 });

/** Acumula el uso de una o varias instancias de proveedor. */
export class ContadorUso {
  private readonly porClave = new Map<string, ResumenUso>();
  private readonly oyentes: Array<(u: UsoProveedor) => void> = [];

  constructor(oyente?: (u: UsoProveedor) => void) {
    if (oyente) this.oyentes.push(oyente);
  }

  escuchar(oyente: (u: UsoProveedor) => void): () => void {
    this.oyentes.push(oyente);
    return () => {
      const i = this.oyentes.indexOf(oyente);
      if (i >= 0) this.oyentes.splice(i, 1);
    };
  }

  registrar(u: UsoProveedor): void {
    const clave = `${u.proveedor}/${u.modelo}/${u.operacion}`;
    const r = this.porClave.get(clave) ?? resumenVacio();
    r.llamadas++;
    r.tokensEntrada += u.tokensEntrada;
    r.tokensSalida += u.tokensSalida;
    r.tokensCache += u.tokensCache ?? 0;
    r.imagenes += u.imagenes ?? 0;
    r.paginas += u.paginas ?? 0;
    r.segundosAudio += u.segundosAudio ?? 0;
    r.usd += u.usd ?? 0;
    r.ms += u.ms;
    this.porClave.set(clave, r);
    for (const o of this.oyentes) {
      try { o(u); } catch { /* un oyente roto no tumba la llamada */ }
    }
  }

  /** Resumen por «proveedor/modelo/operación». */
  detalle(): Record<string, ResumenUso> {
    return Object.fromEntries([...this.porClave].map(([k, v]) => [k, { ...v }]));
  }

  total(): ResumenUso {
    const t = resumenVacio();
    for (const r of this.porClave.values()) {
      t.llamadas += r.llamadas; t.tokensEntrada += r.tokensEntrada; t.tokensSalida += r.tokensSalida;
      t.tokensCache += r.tokensCache; t.imagenes += r.imagenes; t.paginas += r.paginas;
      t.segundosAudio += r.segundosAudio; t.usd += r.usd; t.ms += r.ms;
    }
    return t;
  }

  reiniciar(): void { this.porClave.clear(); }
}

// ---------------------------------------------------------------------------
// Opciones comunes
// ---------------------------------------------------------------------------

export interface OpcionesComunes {
  /** `fetch` a usar (pruebas, o un `fetch` con AI Gateway). Por defecto, el global. */
  fetch?: typeof fetch;
  /** Tiempo límite por intento, en milisegundos. */
  timeoutMs?: number;
  /** Intentos totales (1 = sin reintentos). */
  intentos?: number;
  /** Espera base de los reintentos, en milisegundos. */
  esperaBase?: number;
  /** Peticiones simultáneas como máximo por instancia. */
  concurrencia?: number;
  /** Señal para cancelar todo lo que esté en curso. */
  signal?: AbortSignal;
  /** Se llama tras cada petición con lo que ha costado. */
  onUso?: (u: UsoProveedor) => void;
  /** Contador compartido (si no se da, cada fábrica crea el suyo). */
  contador?: ContadorUso;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class ErrorProveedor extends Error {
  readonly proveedor: string;
  readonly estado: number | undefined;
  readonly reintentable: boolean;
  readonly cuerpo: string | undefined;

  constructor(proveedor: string, mensaje: string, opciones: { estado?: number; reintentable?: boolean; cuerpo?: string; causa?: unknown } = {}) {
    super(`[${proveedor}] ${mensaje}`);
    this.name = 'ErrorProveedor';
    this.proveedor = proveedor;
    this.estado = opciones.estado;
    this.reintentable = opciones.reintentable ?? false;
    this.cuerpo = opciones.cuerpo;
    if (opciones.causa !== undefined) (this as { cause?: unknown }).cause = opciones.causa;
  }
}

export function esAbortoExterno(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof Error && e.name === 'AbortError' && !(e as { tiempoAgotado?: boolean }).tiempoAgotado);
}

/** Estados HTTP que merece la pena reintentar. */
export function estadoReintentable(estado: number): boolean {
  return estado === 408 || estado === 409 || estado === 425 || estado === 429 || estado >= 500;
}

// ---------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------

export interface PeticionHTTP {
  proveedor: string;
  url: string;
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  cabeceras?: Record<string, string>;
  /** Objeto → JSON; string, Uint8Array o FormData → tal cual. */
  cuerpo?: unknown;
  respuesta?: 'json' | 'texto';
}

/**
 * Hace una petición con tiempo límite por intento, reintentos con espera
 * exponencial (429, 5xx, red, tiempo agotado) y cancelación externa.
 */
export async function pedir<T = unknown>(p: PeticionHTTP, o: OpcionesComunes = {}): Promise<T> {
  const f = o.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = o.timeoutMs ?? 120_000;
  const signal = o.signal;
  return reintentar(async () => {
    if (signal?.aborted) throw abortado(p.proveedor, signal);
    const control = new AbortController();
    let tiempoAgotado = false;
    const reloj = setTimeout(() => { tiempoAgotado = true; control.abort(); }, timeoutMs);
    const alAbortar = () => control.abort();
    signal?.addEventListener('abort', alAbortar, { once: true });
    try {
      let cuerpo: BodyInit | undefined;
      const cabeceras: Record<string, string> = { ...(p.cabeceras ?? {}) };
      if (p.cuerpo === undefined) cuerpo = undefined;
      else if (typeof p.cuerpo === 'string' || p.cuerpo instanceof Uint8Array || (typeof FormData !== 'undefined' && p.cuerpo instanceof FormData)) {
        cuerpo = p.cuerpo as BodyInit;
      } else {
        cuerpo = JSON.stringify(p.cuerpo);
        cabeceras['content-type'] ??= 'application/json';
      }
      let r: Response;
      try {
        r = await f(p.url, { method: p.metodo ?? (cuerpo === undefined ? 'GET' : 'POST'), headers: cabeceras, body: cuerpo, signal: control.signal });
      } catch (e) {
        if (signal?.aborted) throw abortado(p.proveedor, signal);
        if (tiempoAgotado) throw new ErrorProveedor(p.proveedor, `tiempo agotado (${timeoutMs} ms) en ${limpiarUrl(p.url)}`, { reintentable: true, causa: e });
        throw new ErrorProveedor(p.proveedor, `fallo de red en ${limpiarUrl(p.url)}: ${(e as Error)?.message ?? e}`, { reintentable: true, causa: e });
      }
      const texto = await r.text().catch(() => '');
      if (!r.ok) {
        throw new ErrorProveedor(p.proveedor, `HTTP ${r.status} en ${limpiarUrl(p.url)}: ${texto.slice(0, 500)}`, {
          estado: r.status, reintentable: estadoReintentable(r.status), cuerpo: texto,
        });
      }
      if (p.respuesta === 'texto') return texto as T;
      try {
        return (texto ? JSON.parse(texto) : {}) as T;
      } catch (e) {
        throw new ErrorProveedor(p.proveedor, `respuesta no es JSON: ${texto.slice(0, 200)}`, { reintentable: true, causa: e });
      }
    } finally {
      clearTimeout(reloj);
      signal?.removeEventListener('abort', alAbortar);
    }
  }, {
    intentos: o.intentos ?? 4,
    base: o.esperaBase ?? 800,
    esReintentable: (e) => !signal?.aborted && e instanceof ErrorProveedor && e.reintentable,
  });
}

function abortado(proveedor: string, signal: AbortSignal): Error {
  const e = new ErrorProveedor(proveedor, `cancelado: ${String(signal.reason ?? 'abort')}`);
  e.name = 'AbortError';
  return e;
}

/** Quita claves de la URL antes de ponerla en un mensaje de error. */
export function limpiarUrl(url: string): string {
  return url.replace(/([?&](key|api_key|token)=)[^&]+/gi, '$1***');
}

// ---------------------------------------------------------------------------
// Concurrencia
// ---------------------------------------------------------------------------

/** Devuelve una función que ejecuta tareas con un máximo de `n` a la vez. */
export function limitador(n: number): <T>(tarea: () => Promise<T>) => Promise<T> {
  let activas = 0;
  const cola: Array<() => void> = [];
  const max = Math.max(1, n);
  return async <T>(tarea: () => Promise<T>): Promise<T> => {
    if (activas >= max) await new Promise<void>((r) => cola.push(r));
    activas++;
    try {
      return await tarea();
    } finally {
      activas--;
      cola.shift()?.();
    }
  };
}

// ---------------------------------------------------------------------------
// Codificación
// ---------------------------------------------------------------------------

export function aBase64(bytes: Uint8Array): string {
  let s = '';
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo) as unknown as number[]);
  }
  return btoa(s);
}

export function deBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Saca el primer objeto o lista JSON de un texto (quita ```json … ``` y prosa alrededor). */
export function extraerJSON<T = unknown>(texto: string): T {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(limpio) as T;
  } catch {
    const i = limpio.search(/[[{]/);
    if (i < 0) throw new Error('no hay JSON en la respuesta');
    const abre = limpio[i] as string;
    const cierra = abre === '{' ? '}' : ']';
    const j = limpio.lastIndexOf(cierra);
    if (j <= i) throw new Error('JSON incompleto en la respuesta');
    return JSON.parse(limpio.slice(i, j + 1)) as T;
  }
}

/** Estimación grosera de tokens cuando el proveedor no la da (≈ 4 caracteres por token). */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 4);
}

export function ahora(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Contador y emisor en uno: lo que cada fábrica usa para apuntar el uso. */
export function apuntador(o: OpcionesComunes): { contador: ContadorUso; apuntar: (u: UsoProveedor) => void } {
  const contador = o.contador ?? new ContadorUso();
  const apuntar = (u: UsoProveedor) => {
    contador.registrar(u);
    if (o.onUso && !o.contador) {
      try { o.onUso(u); } catch { /* nada */ }
    }
  };
  if (o.onUso && o.contador) {
    // Con contador compartido, el oyente se cuelga del contador una sola vez.
    const marcado = o.contador as ContadorUso & { __oyentes?: Set<unknown> };
    marcado.__oyentes ??= new Set();
    if (!marcado.__oyentes.has(o.onUso)) { marcado.__oyentes.add(o.onUso); o.contador.escuchar(o.onUso); }
  }
  return { contador, apuntar };
}
