/**
 * Precios públicos en dólares, comprobados el 6 de octubre de 2026 en las
 * páginas de precios de cada proveedor (Gemini API, catálogo de Workers AI,
 * OpenRouter, TypeSafe). Sirven para estimar el coste; la factura manda.
 *
 * Unidades: dólares por millón de tokens, salvo que se diga otra cosa.
 */

export interface PrecioModelo {
  entrada: number;
  salida: number;
  /** Entrada servida desde caché. */
  cache?: number;
  /** Entrada de audio, si difiere. */
  entradaAudio?: number;
  /** Por minuto de audio (transcriptores). */
  porMinuto?: number;
  /** Por página (OCR). */
  porPagina?: number;
}

export const PRECIOS: Record<string, PrecioModelo> = {
  // Gemini (precio de la API con clave; hasta el 31-12-2026 la familia 3.6-3.8 Flash está a mitad de precio)
  'gemini-3.8-flash': { entrada: 0.75, salida: 3.75, cache: 0.075 },
  'gemini-3.7-flash': { entrada: 0.75, salida: 3.75, cache: 0.075 },
  'gemini-3.6-flash': { entrada: 0.75, salida: 3.75, cache: 0.075 },
  'gemini-3.5-flash': { entrada: 1.5, salida: 9, cache: 0.15 },
  'gemini-3.5-flash-lite': { entrada: 0.3, salida: 2.5, cache: 0.03 },
  'gemini-3.1-flash-lite': { entrada: 0.25, salida: 1.5, cache: 0.025, entradaAudio: 0.5 },
  'gemini-3.1-pro-preview': { entrada: 2, salida: 12, cache: 0.2 },
  'gemini-pro-latest': { entrada: 2, salida: 12, cache: 0.2 },
  'gemini-3.5-transcribe': { entrada: 2, salida: 12, porMinuto: 0.005 },
  'gemini-embedding-2': { entrada: 0.2, salida: 0, entradaAudio: 0.45 },

  // Workers AI (catálogo de la cuenta, 6-10-2026)
  '@cf/google/gemma-4-26b-a4b-it': { entrada: 0.1, salida: 0.3, cache: 0.05 },
  '@cf/zai-org/glm-5.3-flash': { entrada: 0.15, salida: 0.5, cache: 0.03 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { entrada: 0.27, salida: 0.85 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { entrada: 0.351, salida: 0.555 },
  '@cf/qwen/qwen3.8-27b': { entrada: 0.45, salida: 3.2, cache: 0.05 },
  '@cf/openai/gpt-oss-120b': { entrada: 0.35, salida: 0.75 },
  '@cf/openai/whisper-large-v3-turbo': { entrada: 0, salida: 0, porMinuto: 0.000513 },
  '@cf/deepgram/nova-3': { entrada: 0, salida: 0, porMinuto: 0.0052 },
  '@cf/baai/bge-reranker-base': { entrada: 0.00311, salida: 0 },
  '@cf/baai/bge-m3': { entrada: 0.0118, salida: 0 },
  '@cf/qwen/qwen3-embedding-0.6b': { entrada: 0.0118, salida: 0 },

  // OpenRouter: el coste real llega en `usage.cost`; esto solo se usa si falta.
  'mistral-ocr': { entrada: 0, salida: 0, porPagina: 0.002 },

  // TypeSafe
  'jev-latest': { entrada: 0.042, salida: 0 },
};

/** Busca el precio por id exacto o por prefijo (p. ej. «models/gemini-3.8-flash»). */
export function precioDe(modelo: string): PrecioModelo | undefined {
  const id = modelo.replace(/^models\//, '');
  if (PRECIOS[id]) return PRECIOS[id];
  if (id.startsWith('jev')) return PRECIOS['jev-latest'];
  const google = id.replace(/^google\//, '');
  return PRECIOS[google];
}

/** Coste estimado de una llamada por tokens. */
export function costeTokens(modelo: string, entrada: number, salida: number, cache = 0, audioEntrada = 0): number | undefined {
  const p = precioDe(modelo);
  if (!p) return undefined;
  const normal = Math.max(0, entrada - cache - audioEntrada);
  return (normal * p.entrada + cache * (p.cache ?? p.entrada) + audioEntrada * (p.entradaAudio ?? p.entrada) + salida * p.salida) / 1e6;
}
