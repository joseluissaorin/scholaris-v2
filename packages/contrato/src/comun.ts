/**
 * Piezas comunes del contrato: errores, paginación, prefijo de rutas.
 *
 * Todo viaja como JSON. Las fechas son cadenas ISO 8601. Los vectores nunca
 * cruzan el contrato en JSON (solo dentro de un .spdf).
 */

export const PREFIJO_API = '/api/v2' as const;

/** Códigos de error estables. El mensaje es para personas; el código, para el código. */
export type CodigoError =
  | 'no_autenticado'
  | 'prohibido'
  | 'no_encontrado'
  | 'peticion_invalida'
  | 'conflicto'
  | 'duplicado'
  | 'cuota_superada'
  | 'limite_de_ritmo'
  | 'requiere_pro'
  | 'demasiado_grande'
  | 'no_disponible'
  | 'proveedor_fallo'
  | 'interno';

export interface CuerpoError {
  error: {
    codigo: CodigoError;
    /** Mensaje en español correcto, listo para enseñar. */
    mensaje: string;
    /** Detalles para depurar (campos inválidos, límite, reintento en segundos…). */
    detalles?: Record<string, unknown>;
  };
}

/** Error que lanza el cliente con el cuerpo de error ya leído. */
export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: CodigoError,
    mensaje: string,
    public readonly detalles?: Record<string, unknown>,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

/** Paginación por cursor opaco. */
export interface Pagina<T> {
  elementos: T[];
  /** Total de elementos que cumplen el filtro (si es barato calcularlo). */
  total?: number;
  /** Cursor para pedir la página siguiente; ausente si no hay más. */
  siguiente?: string;
}

export interface ParamsPagina {
  limite?: number;
  cursor?: string;
}

export interface Ok {
  ok: true;
}

/** Referencia a una tarea en segundo plano (ingesta, autocita, informe…). */
export interface RefTarea {
  tarea: string;
}
