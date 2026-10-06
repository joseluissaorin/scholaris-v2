/** Errores de la API con código estable y mensaje en español. */
import type { CodigoError, CuerpoError } from '@scholaris/contrato';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const ESTADOS: Record<CodigoError, ContentfulStatusCode> = {
  no_autenticado: 401,
  prohibido: 403,
  no_encontrado: 404,
  peticion_invalida: 400,
  conflicto: 409,
  falta_original: 409,
  duplicado: 409,
  cuota_superada: 402,
  limite_de_ritmo: 429,
  requiere_pro: 402,
  demasiado_grande: 413,
  no_disponible: 503,
  proveedor_fallo: 502,
  interno: 500,
};

export class ErrorScholaris extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string,
    readonly detalles?: Record<string, unknown>,
    readonly estado: ContentfulStatusCode = ESTADOS[codigo],
  ) {
    super(mensaje);
    this.name = 'ErrorScholaris';
  }
}

export function fallo(codigo: CodigoError, mensaje: string, detalles?: Record<string, unknown>): never {
  throw new ErrorScholaris(codigo, mensaje, detalles);
}

export function noEncontrado(que = 'El recurso'): never {
  throw new ErrorScholaris('no_encontrado', `${que} no existe o no es tuyo.`);
}

export function cuerpoError(codigo: CodigoError, mensaje: string, detalles?: Record<string, unknown>): CuerpoError {
  return { error: detalles ? { codigo, mensaje, detalles } : { codigo, mensaje } };
}

export function responderError(c: Context, e: unknown): Response {
  if (e instanceof ErrorScholaris) return c.json(cuerpoError(e.codigo, e.message, e.detalles), e.estado);
  const estado = (e as { status?: number })?.status;
  if (typeof estado === 'number' && estado >= 400 && estado < 500) {
    const codigo: CodigoError = estado === 401 ? 'no_autenticado' : estado === 403 ? 'prohibido' : estado === 404 ? 'no_encontrado' : estado === 413 ? 'demasiado_grande' : 'peticion_invalida';
    return c.json(cuerpoError(codigo, (e as Error).message || 'Petición no válida.'), estado as ContentfulStatusCode);
  }
  console.error(JSON.stringify({ nivel: 'error', ruta: c.req.path, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), pila: e instanceof Error ? e.stack : undefined }));
  return c.json(cuerpoError('interno', 'Algo ha fallado en el servidor. Vuelve a intentarlo en unos segundos.'), 500);
}

/** Lee y valida mínimamente un cuerpo JSON. */
export async function cuerpoJson<T>(c: Context): Promise<T> {
  try {
    const t = await c.req.text();
    return (t ? JSON.parse(t) : {}) as T;
  } catch {
    return fallo('peticion_invalida', 'El cuerpo de la petición no es JSON válido.');
  }
}

export function exigir(condicion: unknown, mensaje: string, detalles?: Record<string, unknown>): asserts condicion {
  if (!condicion) fallo('peticion_invalida', mensaje, detalles);
}
