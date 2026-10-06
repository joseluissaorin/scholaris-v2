/**
 * Piezas comunes de las rutas: acceso a los puertos, errores con el formato
 * del contrato, lectura de cuerpos y consultas, y SSE.
 *
 * Las rutas se registran relativas (p. ej. `/historial`); la plataforma las
 * monta bajo `/api/v2`. Solo usan tipos de Hono: ninguna dependencia en tiempo
 * de ejecución.
 */

import type { Context, Hono } from 'hono';
import type { CodigoError, CuerpoError } from '@scholaris/contrato';
import type { EntornoFunciones, PuertosFunciones } from '../puertos.js';
import { ErrorFunciones } from '../util.js';

/** Cualquier aplicación Hono cuyo contexto tenga `funciones`. */
export type AppFunciones<E extends EntornoFunciones = EntornoFunciones> = Hono<E>;

export function puertosDe(c: Context): PuertosFunciones {
  const p = (c as unknown as { get(k: string): unknown }).get('funciones') as PuertosFunciones | undefined;
  if (!p?.sql) throw new ErrorFunciones('interno', 'La plataforma no ha montado los puertos de las funciones.', 500);
  return p;
}

const CODIGOS: ReadonlySet<string> = new Set<CodigoError>([
  'no_autenticado', 'prohibido', 'no_encontrado', 'peticion_invalida', 'conflicto', 'duplicado', 'cuota_superada',
  'limite_de_ritmo', 'requiere_pro', 'demasiado_grande', 'no_disponible', 'proveedor_fallo', 'interno',
]);

export function respuestaError(c: Context, e: unknown): Response {
  if (e instanceof ErrorFunciones) {
    const codigo = (CODIGOS.has(e.codigo) ? e.codigo : 'interno') as CodigoError;
    const cuerpo: CuerpoError = { error: { codigo, mensaje: e.message } };
    return c.json(cuerpo, e.estado as 400);
  }
  const cuerpo: CuerpoError = { error: { codigo: 'interno', mensaje: 'Ha fallado algo inesperado. Vuelve a intentarlo en un momento.', detalles: { causa: String((e as Error)?.message ?? e) } } };
  return c.json(cuerpo, 500);
}

/** Envuelve un manejador: errores con el formato del contrato. */
export function manejar(fn: (c: Context, p: PuertosFunciones) => Promise<Response> | Response) {
  return async (c: Context): Promise<Response> => {
    try {
      return await fn(c, puertosDe(c));
    } catch (e) {
      return respuestaError(c, e);
    }
  };
}

export async function cuerpo<T = Record<string, unknown>>(c: Context): Promise<T> {
  const t = c.req.header('content-type') ?? '';
  if (!t.includes('json')) {
    const s = await c.req.text().catch(() => '');
    if (!s.trim()) return {} as T;
    try { return JSON.parse(s) as T; } catch { throw new ErrorFunciones('peticion_invalida', 'El cuerpo de la petición no es JSON válido.'); }
  }
  try {
    const j = await c.req.json();
    if (j === null || typeof j !== 'object' || Array.isArray(j)) throw new Error();
    return j as T;
  } catch {
    throw new ErrorFunciones('peticion_invalida', 'El cuerpo de la petición no es JSON válido.');
  }
}

export function qTexto(c: Context, k: string): string | undefined {
  const v = c.req.query(k);
  return v === undefined || v === '' ? undefined : v;
}

export function qNumero(c: Context, k: string): number | undefined {
  const v = qTexto(c, k);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ErrorFunciones('peticion_invalida', `El parámetro «${k}» debe ser un número.`);
  return n;
}

export function qBool(c: Context, k: string): boolean | undefined {
  const v = qTexto(c, k);
  if (v === undefined) return undefined;
  return v === '1' || v === 'true' || v === 'si' || v === 'sí';
}

export const ok = (c: Context) => c.json({ ok: true as const });

/** Respuesta SSE: `producir` recibe una función para enviar eventos. */
export function sse(producir: (enviar: (evento: string, datos: unknown) => Promise<void>) => Promise<void>): Response {
  const codificador = new TextEncoder();
  let control!: ReadableStreamDefaultController<Uint8Array>;
  let cerrado = false;
  const flujo = new ReadableStream<Uint8Array>({
    start(ctrl) { control = ctrl; },
    cancel() { cerrado = true; },
  });
  const enviar = async (evento: string, datos: unknown) => {
    if (cerrado) return;
    try {
      control.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`));
    } catch {
      cerrado = true;
    }
  };
  void (async () => {
    try {
      control.enqueue(codificador.encode(': abierto\n\n'));
      await producir(enviar);
    } catch (e) {
      await enviar('error', { error: e instanceof ErrorFunciones ? e.message : 'Ha fallado algo inesperado.' });
    } finally {
      if (!cerrado) { cerrado = true; try { control.close(); } catch { /* ya cerrado */ } }
    }
  })();
  return new Response(flujo, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}

export function quiereSSE(c: Context): boolean {
  return (c.req.header('accept') ?? '').includes('text/event-stream');
}
