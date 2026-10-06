/**
 * OpenRouter: una sola clave para cientos de modelos.
 *
 * - Lector: el PDF pasa por el plugin `file-parser` (motor `mistral-ocr`, 2 $
 *   por 1000 páginas; o `cloudflare-ai`, gratis; o `native`, el PDF entero al
 *   modelo) y un modelo barato reparte el texto en páginas con nuestro esquema.
 *   Con imágenes, van directas a un modelo de visión.
 * - Redactor: chat genérico con `response_format: json_schema`.
 *
 * Motores y formato comprobados en https://openrouter.ai/docs (6-10-2026); el
 * coste real llega en `usage.cost`.
 */

import type { Lector, PaginaLeida, Redactor } from '@scholaris/nucleo';
import {
  aBase64, ahora, apuntador, ErrorProveedor, extraerJSON, limitador, pedir,
  type ContadorUso, type OpcionesComunes, type UsoProveedor,
} from './comun.js';
import { ESQUEMA_PAGINAS, instruccionesLector, normalizarPaginas, type OpcionesTranscripcion } from './lectura.js';
import { ErrorPliego, leerPartiendo, type EntradaPliego } from './pliego.js';
import { normalizarMime } from './gemini.js';

export interface ConfigOpenRouter extends OpcionesComunes {
  clave: string;
  /** Por defecto `https://openrouter.ai/api/v1` (o la ruta `openrouter` de AI Gateway). */
  baseUrl?: string;
  /** Cabeceras de atribución de OpenRouter. */
  titulo?: string;
  referer?: string;
}

export const MODELOS_OPENROUTER = {
  /** Modelo que estructura el texto del OCR en páginas. */
  lector: 'google/gemini-3.5-flash-lite',
  /** GLM 5.3 Flash razona siempre (25-41 s por línea de contexto, medido por la ingesta): Qwen 3.8 Flash, sin razonamiento. */
  redactorRapido: 'qwen/qwen3.8-flash',
  redactorAlto: 'google/gemini-3.8-flash',
} as const;

export interface OpcionesLectorOpenRouter extends OpcionesTranscripcion {
  /** `mistral-ocr` (por defecto), `cloudflare-ai` o `native`. */
  motor?: 'mistral-ocr' | 'cloudflare-ai' | 'native';
  modelo?: string;
  maxPaginas?: number;
}

interface RespuestaOR {
  choices?: Array<{ message?: { content?: string | null; annotations?: unknown[] }; finish_reason?: string; native_finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  model?: string;
  error?: { message?: string; code?: number };
}

export interface ClienteOpenRouter {
  readonly contador: ContadorUso;
  chat(cuerpo: Record<string, unknown>, operacion: UsoProveedor['operacion'], extra?: Partial<UsoProveedor>, timeoutMs?: number): Promise<{ texto: string; fin?: string; uso: UsoProveedor }>;
  lector(o?: OpcionesLectorOpenRouter): Lector & { readonly modelo: string };
  redactor(o?: { modeloRapido?: string; modeloAlto?: string }): Redactor;
}

export function crearOpenRouter(config: ConfigOpenRouter): ClienteOpenRouter {
  const base = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const { contador, apuntar } = apuntador(config);
  const limitar = limitador(config.concurrencia ?? 16);
  const cabeceras: Record<string, string> = {
    authorization: `Bearer ${config.clave}`,
    'x-title': config.titulo ?? 'Scholaris',
    ...(config.referer ? { 'http-referer': config.referer } : {}),
  };

  async function chat(cuerpo: Record<string, unknown>, operacion: UsoProveedor['operacion'], extra: Partial<UsoProveedor> = {}, timeoutMs?: number) {
    const t0 = ahora();
    const r = await limitar(() => pedir<RespuestaOR>({ proveedor: 'openrouter', url: `${base}/chat/completions`, cabeceras, cuerpo: { usage: { include: true }, ...cuerpo } }, { ...config, ...(timeoutMs ? { timeoutMs } : {}) }));
    if (r.error) throw new ErrorProveedor('openrouter', r.error.message ?? 'error', { estado: r.error.code, reintentable: (r.error.code ?? 0) >= 500 || r.error.code === 429 });
    const c = r.choices?.[0];
    const uso: UsoProveedor = {
      proveedor: 'openrouter', modelo: r.model ?? String(cuerpo.model), operacion,
      tokensEntrada: r.usage?.prompt_tokens ?? 0, tokensSalida: r.usage?.completion_tokens ?? 0,
      tokensCache: r.usage?.prompt_tokens_details?.cached_tokens ?? 0, tokensPensamiento: r.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      usd: r.usage?.cost, ms: ahora() - t0, ...extra,
    };
    apuntar(uso);
    return { texto: c?.message?.content ?? '', fin: c?.finish_reason, uso };
  }

  function lector(o: OpcionesLectorOpenRouter = {}): Lector & { readonly modelo: string } {
    const motor = o.motor ?? 'mistral-ocr';
    const modelo = o.modelo ?? MODELOS_OPENROUTER.lector;
    const leerUno = async (e: EntradaPliego, n: number): Promise<PaginaLeida[]> => {
      const contenido: Array<Record<string, unknown>> = [];
      if (e.pdf) {
        contenido.push({ type: 'file', file: { filename: `paginas-${e.primeraFisica}-${e.primeraFisica + n - 1}.pdf`, file_data: `data:application/pdf;base64,${aBase64(e.pdf)}` } });
      } else {
        for (const [i, img] of (e.imagenes ?? []).entries()) {
          contenido.push({ type: 'text', text: `[Página física ${e.primeraFisica + i}]` });
          contenido.push({ type: 'image_url', image_url: { url: `data:${normalizarMime(img.mime)};base64,${aBase64(img.bytes)}` } });
        }
      }
      const extraOcr = e.pdf && motor !== 'native'
        ? '\nEl PDF te llega ya pasado por OCR: respeta su texto letra a letra (incluidas grafías antiguas) y limítate a repartirlo en páginas y campos. Los saltos de página del OCR marcan el cambio de página física.'
        : '';
      contenido.push({ type: 'text', text: instruccionesLector(n, e.primeraFisica, e.pista, o, e.pdf ? 'pdf' : 'imagenes') + extraOcr });
      const cuerpo: Record<string, unknown> = {
        model: modelo,
        messages: [{ role: 'user', content: contenido }],
        response_format: { type: 'json_schema', json_schema: { name: 'paginas', strict: true, schema: ESQUEMA_PAGINAS } },
        max_tokens: Math.min(65_000, 5_000 * n + 2_000),
        reasoning: { effort: 'low', exclude: true },
      };
      if (e.pdf) cuerpo.plugins = [{ id: 'file-parser', pdf: { engine: motor } }];
      const { texto, fin } = await chat(cuerpo, 'leer', { paginas: n, imagenes: e.imagenes?.length ?? 0 }, 90_000 + n * 30_000);
      if (fin === 'length') throw new ErrorPliego('openrouter', `salida cortada (${n} páginas)`);
      let json: unknown;
      try { json = extraerJSON(texto); } catch (err) { throw new ErrorPliego('openrouter', 'JSON ilegible', err); }
      return normalizarPaginas(json, n, e.primeraFisica, o);
    };
    return {
      nombre: `openrouter:${motor === 'native' || !motor ? '' : `${motor}+`}${modelo}`,
      modelo,
      leerPliego: (entrada) => leerPartiendo(entrada, leerUno, { maxPaginas: o.maxPaginas ?? 8 }),
    };
  }

  function redactor(o: { modeloRapido?: string; modeloAlto?: string } = {}): Redactor {
    return {
      nombre: 'openrouter',
      async generar<T>(pet: Parameters<Redactor['generar']>[0]): Promise<{ texto: string; json?: T }> {
        const modelo = pet.calidad === 'alta' ? (o.modeloAlto ?? MODELOS_OPENROUTER.redactorAlto) : (o.modeloRapido ?? MODELOS_OPENROUTER.redactorRapido);
        const messages: Array<Record<string, unknown>> = [];
        if (pet.sistema) messages.push({ role: 'system', content: pet.sistema });
        for (const m of pet.mensajes) {
          messages.push({
            role: m.rol === 'modelo' ? 'assistant' : 'user',
            content: m.partes.map((p) => {
              if ('texto' in p) return { type: 'text', text: p.texto };
              const mime = normalizarMime(p.mime);
              if (mime === 'application/pdf') return { type: 'file', file: { filename: 'documento.pdf', file_data: `data:${mime};base64,${aBase64(p.bytes)}` } };
              if (mime.startsWith('audio/')) return { type: 'input_audio', input_audio: { data: aBase64(p.bytes), format: mime.split('/')[1]?.replace('mpeg', 'mp3') } };
              return { type: 'image_url', image_url: { url: `data:${mime};base64,${aBase64(p.bytes)}` } };
            }),
          });
        }
        const cuerpo: Record<string, unknown> = { model: modelo, messages, reasoning: pet.calidad === 'alta' ? { effort: 'medium', exclude: true } : { enabled: false } };
        if (pet.temperatura !== undefined) cuerpo.temperature = pet.temperatura;
        if (pet.maxTokens !== undefined) cuerpo.max_tokens = pet.maxTokens;
        if (pet.esquema) cuerpo.response_format = { type: 'json_schema', json_schema: { name: 'respuesta', strict: true, schema: pet.esquema } };
        const { texto } = await chat(cuerpo, 'generar');
        if (!pet.esquema) return { texto };
        try { return { texto, json: extraerJSON<T>(texto) }; } catch (e) {
          throw new ErrorProveedor('openrouter', `JSON ilegible del redactor: ${texto.slice(0, 200)}`, { causa: e });
        }
      },
    };
  }

  return { contador, chat, lector, redactor };
}
