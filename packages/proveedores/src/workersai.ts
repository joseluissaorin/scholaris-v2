/**
 * Workers AI: dentro de un Worker con el binding `env.AI`, o desde fuera por
 * REST (`/accounts/<cuenta>/ai/run/<modelo>`) con un token que tenga `ai:write`.
 *
 * Reservas baratas de Scholaris:
 * - Lector: modelo de visión (por defecto Gemma 4 26B A4B, ver RESULTADOS.md), una o pocas páginas por llamada.
 * - Transcriptor: whisper-large-v3-turbo con marcas por palabra; los WAV largos se trocean aquí.
 * - Reordenador: bge-reranker-base o bge-m3 (multilingüe) en modo consulta + contextos.
 * - Embebedor: qwen3-embedding-0.6b (texto, 1024 dims).
 *
 * Modelos comprobados con `GET /ai/models/search` y `/ai/models/schema` el 6-10-2026.
 */

import type { Embebedor, EspacioVectorial, Lector, PaginaLeida, Reordenador, Transcripcion, Transcriptor } from '@scholaris/nucleo';
import { enParalelo, normalizarVector } from '@scholaris/nucleo';
import {
  aBase64, ahora, apuntador, ErrorProveedor, estadoReintentable, estimarTokens, extraerJSON, limitador, pedir,
  type ContadorUso, type OpcionesComunes, type UsoProveedor,
} from './comun.js';
import { reintentar } from '@scholaris/nucleo';
import { costeTokens, precioDe } from './precios.js';
import { ESQUEMA_PAGINAS, instruccionesLector, normalizarPaginas, type OpcionesTranscripcion } from './lectura.js';
import { ErrorPliego, leerPartiendo, type EntradaPliego } from './pliego.js';
import { normalizarMime } from './gemini.js';

/** Lo mínimo del binding `Ai` de Workers que usamos. */
export interface BindingAI {
  run(modelo: string, entrada: unknown, opciones?: Record<string, unknown>): Promise<unknown>;
}

export interface ConfigWorkersAI extends OpcionesComunes {
  /** `env.AI` dentro de un Worker. Si está, no hace falta cuenta ni token. */
  binding?: BindingAI;
  cuenta?: string;
  token?: string;
  /** Base REST alternativa (p. ej. AI Gateway: `https://gateway.ai.cloudflare.com/v1/<cuenta>/<gateway>/workers-ai`). */
  baseUrl?: string;
  /** Opciones para `env.AI.run` (p. ej. `{ gateway: { id: 'scholaris' } }`). */
  opcionesRun?: Record<string, unknown>;
}

export const MODELOS_WORKERS_AI = {
  lector: '@cf/google/gemma-4-26b-a4b-it',
  transcriptor: '@cf/openai/whisper-large-v3-turbo',
  reordenador: '@cf/baai/bge-reranker-base',
  reordenadorMultilingue: '@cf/baai/bge-m3',
  embebedor: '@cf/qwen/qwen3-embedding-0.6b',
  redactor: '@cf/openai/gpt-oss-120b',
} as const;

export interface ClienteWorkersAI {
  readonly contador: ContadorUso;
  ejecutar<T = unknown>(modelo: string, entrada: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  lector(o?: OpcionesLectorWorkersAI): Lector & { readonly modelo: string };
  transcriptor(o?: { modelo?: string; segundosTrozo?: number; vad?: boolean }): Transcriptor;
  reordenador(o?: { modelo?: string; lote?: number }): Reordenador;
  embebedor(o?: { modelo?: string; dims?: number; instruccion?: string }): Embebedor;
}

export interface OpcionesLectorWorkersAI extends OpcionesTranscripcion {
  modelo?: string;
  /** Páginas por llamada (los modelos abiertos pierden calidad con muchas imágenes). */
  maxPaginas?: number;
  maxTokensSalida?: number;
  /** Mandar el PDF como `file` (solo algunos modelos lo aceptan); si no, el lector exige imágenes. */
  pdfDirecto?: boolean;
}

export function crearWorkersAI(config: ConfigWorkersAI): ClienteWorkersAI {
  const { contador, apuntar } = apuntador(config);
  const limitar = limitador(config.concurrencia ?? 8);
  if (!config.binding && !(config.cuenta && config.token)) throw new Error('crearWorkersAI: hace falta `binding` o `cuenta` + `token`');
  const base = (config.baseUrl ?? `https://api.cloudflare.com/client/v4/accounts/${config.cuenta}/ai/run`).replace(/\/+$/, '');

  async function ejecutar<T = unknown>(modelo: string, entrada: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (config.binding) {
      const binding = config.binding;
      const limite = timeoutMs ?? config.timeoutMs ?? 120_000;
      return limitar(() => reintentar(async () => {
        if (config.signal?.aborted) throw new ErrorProveedor('workers-ai', 'cancelado');
        let reloj: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            binding.run(modelo, entrada, { ...(config.opcionesRun ?? {}), ...(config.signal ? { signal: config.signal } : {}) }) as Promise<T>,
            new Promise<never>((_, rechazar) => { reloj = setTimeout(() => rechazar(new ErrorProveedor('workers-ai', `tiempo agotado (${limite} ms)`, { reintentable: true })), limite); }),
          ]);
        } catch (e) {
          if (e instanceof ErrorProveedor) throw e;
          const m = (e as Error)?.message ?? String(e);
          // El binding lanza errores sin estado: se reintentan los de capacidad y los internos.
          const reintentable = /capacity|overloaded|rate|429|5\d\d|internal|timeout|network/i.test(m);
          throw new ErrorProveedor('workers-ai', m, { reintentable, causa: e });
        } finally { clearTimeout(reloj); }
      }, { intentos: config.intentos ?? 4, base: config.esperaBase ?? 800, esReintentable: (e) => e instanceof ErrorProveedor && e.reintentable && !config.signal?.aborted }));
    }
    const r = await limitar(() => pedir<{ success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }> }>({
      proveedor: 'workers-ai', url: `${base}/${modelo}`, cabeceras: { authorization: `Bearer ${config.token}` }, cuerpo: entrada,
    }, { ...config, ...(timeoutMs ? { timeoutMs } : {}) }));
    if (r.success === false) {
      const msg = (r.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ');
      throw new ErrorProveedor('workers-ai', msg || 'fallo sin mensaje', { reintentable: (r.errors ?? []).some((e) => estadoReintentable(e.code ?? 0)) });
    }
    return (r.result ?? r) as T;
  }

  // -------------------------------------------------------------------------
  // Lector
  // -------------------------------------------------------------------------

  function lector(o: OpcionesLectorWorkersAI = {}): Lector & { readonly modelo: string } {
    const modelo = o.modelo ?? MODELOS_WORKERS_AI.lector;
    const leerUno = async (e: EntradaPliego, n: number): Promise<PaginaLeida[]> => {
      const t0 = ahora();
      const contenido: Array<Record<string, unknown>> = [{ type: 'text', text: instruccionesLector(n, e.primeraFisica, e.pista, o, e.pdf ? 'pdf' : 'imagenes') }];
      if (e.pdf) {
        if (!o.pdfDirecto) throw new ErrorProveedor('workers-ai', `el lector ${modelo} necesita imágenes de página, no un PDF`);
        contenido.push({ type: 'file', file: { filename: 'pliego.pdf', file_data: `data:application/pdf;base64,${aBase64(e.pdf)}` } });
      } else {
        for (const [i, img] of (e.imagenes ?? []).entries()) {
          contenido.push({ type: 'text', text: `[Página física ${e.primeraFisica + i}]` });
          contenido.push({ type: 'image_url', image_url: { url: `data:${normalizarMime(img.mime)};base64,${aBase64(img.bytes)}` } });
        }
      }
      const r = await ejecutar<RespuestaChat>(modelo, {
        messages: [{ role: 'user', content: contenido }],
        response_format: { type: 'json_schema', json_schema: { name: 'paginas', schema: ESQUEMA_PAGINAS, strict: true } },
        max_tokens: o.maxTokensSalida ?? Math.min(32_000, 4_000 * n + 2_000),
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      }, 60_000 + n * 30_000);
      const { texto, json, fin, uso } = interpretarChat(r);
      apuntar(usoChat('leer', modelo, uso, ahora() - t0, { paginas: n, imagenes: e.imagenes?.length ?? 0 }));
      if (fin === 'length') throw new ErrorPliego('workers-ai', `salida cortada (${n} páginas)`);
      let datos: unknown = json;
      if (datos === undefined) {
        try { datos = extraerJSON(texto); } catch (err) { throw new ErrorPliego('workers-ai', 'JSON ilegible', err); }
      }
      return normalizarPaginas(datos, n, e.primeraFisica, o);
    };
    return { nombre: `workers-ai:${modelo}`, modelo, leerPliego: (entrada) => leerPartiendo(entrada, leerUno, { maxPaginas: o.maxPaginas ?? 2 }) };
  }

  // -------------------------------------------------------------------------
  // Transcriptor
  // -------------------------------------------------------------------------

  function transcriptor(o: { modelo?: string; segundosTrozo?: number; vad?: boolean } = {}): Transcriptor {
    const modelo = o.modelo ?? MODELOS_WORKERS_AI.transcriptor;
    const segundosTrozo = o.segundosTrozo ?? 600;
    return {
      nombre: `workers-ai:${modelo}`,
      async transcribir(audio, opciones = {}) {
        const desplazamiento = audio.desplazamiento ?? 0;
        // Los WAV PCM se trocean aquí (sin ffmpeg); el resto debe llegar ya troceado (el navegador lo hace con Web Audio).
        const trozos = trocearWav(audio.bytes, segundosTrozo) ?? [{ bytes: audio.bytes, inicio: 0 }];
        if (trozos.length === 1 && audio.bytes.length > 25_000_000) {
          throw new ErrorProveedor('workers-ai', `audio de ${(audio.bytes.length / 1e6).toFixed(1)} MB: trocéalo en tramos de ≤ 10 min antes de transcribir (o mándalo como WAV PCM)`);
        }
        const partes = await enParalelo(trozos, 4, async (t) => {
          const t0 = ahora();
          const entrada: Record<string, unknown> = { audio: aBase64(t.bytes), vad_filter: o.vad ?? true, condition_on_previous_text: false };
          if (opciones.idioma) entrada.language = opciones.idioma.split('-')[0];
          if (opciones.pista) entrada.initial_prompt = opciones.pista.slice(0, 800);
          const r = await ejecutar<RespuestaWhisper>(modelo, entrada, 300_000);
          const seg = r.transcription_info?.duration ?? (r.segments?.at(-1)?.end ?? 0);
          const p = precioDe(modelo);
          apuntar({ proveedor: 'workers-ai', modelo, operacion: 'transcribir', tokensEntrada: 0, tokensSalida: 0, segundosAudio: seg, usd: p?.porMinuto ? (seg / 60) * p.porMinuto : undefined, ms: ahora() - t0 });
          return { r, inicio: t.inicio };
        });
        return unirWhisper(partes, desplazamiento);
      },
    };
  }

  // -------------------------------------------------------------------------
  // Reordenador
  // -------------------------------------------------------------------------

  function reordenador(o: { modelo?: string; lote?: number } = {}): Reordenador {
    const modelo = o.modelo ?? MODELOS_WORKERS_AI.reordenador;
    const lote = o.lote ?? 64;
    return {
      nombre: `workers-ai:${modelo}`,
      async reordenar(consulta, textos) {
        if (!textos.length) return [];
        const salida = new Array<number>(textos.length).fill(0);
        const grupos: number[][] = [];
        for (let i = 0; i < textos.length; i += lote) grupos.push(Array.from({ length: Math.min(lote, textos.length - i) }, (_, k) => i + k));
        await enParalelo(grupos, 4, async (idx) => {
          const t0 = ahora();
          const r = await ejecutar<{ response?: Array<{ id: number; score: number }>; usage?: { prompt_tokens?: number }; meta?: { cost_metric_value_1?: number } }>(modelo, {
            query: consulta, contexts: idx.map((i) => ({ text: (textos[i] as string).slice(0, 4000) || ' ' })),
          });
          for (const { id, score } of r.response ?? []) if (idx[id] !== undefined) salida[idx[id] as number] = score;
          const tok = r.usage?.prompt_tokens ?? r.meta?.cost_metric_value_1 ?? idx.reduce((s, i) => s + estimarTokens(textos[i] as string), estimarTokens(consulta));
          apuntar({ proveedor: 'workers-ai', modelo, operacion: 'reordenar', tokensEntrada: tok, tokensSalida: 0, usd: costeTokens(modelo, tok, 0), ms: ahora() - t0 });
        });
        return salida;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Embebedor
  // -------------------------------------------------------------------------

  function embebedor(o: { modelo?: string; dims?: number; instruccion?: string } = {}): Embebedor {
    const modelo = o.modelo ?? MODELOS_WORKERS_AI.embebedor;
    const dims = o.dims ?? 1024;
    const nombreCorto = modelo.split('/').pop() as string;
    const espacio: EspacioVectorial = { id: `${nombreCorto}@${dims}`, proveedor: 'cloudflare', modelo: nombreCorto, dims, normalizado: true, modalidades: ['texto'] };
    const esQwen = /qwen3-embedding/.test(modelo);
    return {
      espacio,
      admite: (m) => m === 'texto',
      async vectorizar(piezas, tarea) {
        const textos = piezas.map((p) => {
          if (p.modalidad !== 'texto') throw new ErrorProveedor('workers-ai', `${modelo} solo vectoriza texto`);
          return p.texto.slice(0, 24_000) || ' ';
        });
        const grupos: number[][] = [];
        for (let i = 0; i < textos.length; i += 32) grupos.push(Array.from({ length: Math.min(32, textos.length - i) }, (_, k) => i + k));
        const salida = new Array<Float32Array>(textos.length);
        await enParalelo(grupos, 4, async (idx) => {
          const t0 = ahora();
          const lote = idx.map((i) => textos[i] as string);
          const entrada: Record<string, unknown> = esQwen
            ? (tarea === 'consulta' ? { queries: lote, ...(o.instruccion ? { instruction: o.instruccion } : {}) } : { documents: lote })
            : { text: lote };
          const r = await ejecutar<{ data?: number[][]; usage?: { prompt_tokens?: number } }>(modelo, entrada);
          const datos = r.data ?? [];
          if (datos.length !== idx.length) throw new ErrorProveedor('workers-ai', `${modelo} devolvió ${datos.length} vectores para ${idx.length} textos`);
          idx.forEach((i, k) => { salida[i] = normalizarVector(Float32Array.from((datos[k] as number[]).slice(0, dims))); });
          const tok = r.usage?.prompt_tokens ?? lote.reduce((s, t) => s + estimarTokens(t), 0);
          apuntar({ proveedor: 'workers-ai', modelo, operacion: 'vectorizar', tokensEntrada: tok, tokensSalida: 0, usd: costeTokens(modelo, tok, 0), ms: ahora() - t0, estimado: !r.usage });
        });
        return salida;
      },
    };
  }

  return { contador, ejecutar, lector, transcriptor, reordenador, embebedor };

  function usoChat(operacion: UsoProveedor['operacion'], modelo: string, u: { entrada: number; salida: number; cache: number }, ms: number, extra: Partial<UsoProveedor> = {}): UsoProveedor {
    return { proveedor: 'workers-ai', modelo, operacion, tokensEntrada: u.entrada, tokensSalida: u.salida, tokensCache: u.cache, usd: costeTokens(modelo, u.entrada, u.salida, u.cache), ms, ...extra };
  }
}

// ---------------------------------------------------------------------------
// Formatos de respuesta
// ---------------------------------------------------------------------------

export interface RespuestaChat {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string }; finish_reason?: string }>;
  response?: string | Record<string, unknown>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}

/** Chat de Workers AI: formato OpenAI (`choices`) o el antiguo (`response`, que en modo JSON ya llega como objeto). */
export function interpretarChat(r: RespuestaChat): { texto: string; json?: unknown; fin?: string; uso: { entrada: number; salida: number; cache: number } } {
  const uso = { entrada: r.usage?.prompt_tokens ?? 0, salida: r.usage?.completion_tokens ?? 0, cache: r.usage?.prompt_tokens_details?.cached_tokens ?? 0 };
  if (r.choices?.length) {
    const c = r.choices[0];
    return { texto: c?.message?.content ?? '', fin: c?.finish_reason, uso };
  }
  if (r.response !== undefined && typeof r.response === 'object' && r.response !== null) return { texto: JSON.stringify(r.response), json: r.response, uso };
  return { texto: typeof r.response === 'string' ? r.response : '', uso };
}

interface RespuestaWhisper {
  text?: string;
  transcription_info?: { language?: string; duration?: number };
  segments?: Array<{ start: number; end: number; text: string; words?: Array<{ word: string; start: number; end: number }> }>;
}

export function unirWhisper(partes: Array<{ r: RespuestaWhisper; inicio: number }>, desplazamiento: number): Transcripcion {
  const palabras: Transcripcion['palabras'] = [];
  const textos: string[] = [];
  let idioma: string | undefined;
  for (const { r, inicio } of partes) {
    idioma ??= r.transcription_info?.language;
    textos.push((r.text ?? '').trim());
    for (const s of r.segments ?? []) {
      if (s.words?.length) {
        for (const w of s.words) {
          const texto = w.word.trim();
          if (texto) palabras.push({ texto, t0: desplazamiento + inicio + w.start, t1: desplazamiento + inicio + w.end });
        }
      } else {
        // Sin palabras: se reparte el segmento por igual (mejor que perder el ancla).
        const ws = s.text.trim().split(/\s+/).filter(Boolean);
        const paso = (s.end - s.start) / Math.max(1, ws.length);
        ws.forEach((texto, i) => palabras.push({ texto, t0: desplazamiento + inicio + s.start + i * paso, t1: desplazamiento + inicio + s.start + (i + 1) * paso }));
      }
    }
  }
  return { ...(idioma ? { idioma } : {}), palabras, texto: textos.filter(Boolean).join(' ') };
}

/**
 * Trocea un WAV PCM en tramos de `segundos` reescribiendo la cabecera. Devuelve
 * null si no es un WAV PCM que sepamos leer.
 */
export function trocearWav(bytes: Uint8Array, segundos: number): Array<{ bytes: Uint8Array; inicio: number }> | null {
  if (bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o] as number, bytes[o + 1] as number, bytes[o + 2] as number, bytes[o + 3] as number);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  let fmt: { canales: number; tasa: number; bloque: number; bits: number; formato: number } | null = null;
  let datos: { inicio: number; largo: number } | null = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const largo = dv.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { formato: dv.getUint16(o + 8, true), canales: dv.getUint16(o + 10, true), tasa: dv.getUint32(o + 12, true), bloque: dv.getUint16(o + 20, true), bits: dv.getUint16(o + 22, true) };
    if (id === 'data') { datos = { inicio: o + 8, largo: Math.min(largo, bytes.length - o - 8) }; break; }
    o += 8 + largo + (largo % 2);
  }
  if (!fmt || !datos || (fmt.formato !== 1 && fmt.formato !== 3) || !fmt.bloque) return null;
  const bytesTrozo = Math.max(fmt.bloque, Math.floor((segundos * fmt.tasa)) * fmt.bloque);
  const trozos: Array<{ bytes: Uint8Array; inicio: number }> = [];
  for (let p = 0; p < datos.largo; p += bytesTrozo) {
    const n = Math.min(bytesTrozo, datos.largo - p);
    const out = new Uint8Array(44 + n);
    const w = new DataView(out.buffer);
    out.set([0x52, 0x49, 0x46, 0x46], 0); w.setUint32(4, 36 + n, true); out.set([0x57, 0x41, 0x56, 0x45], 8);
    out.set([0x66, 0x6d, 0x74, 0x20], 12); w.setUint32(16, 16, true); w.setUint16(20, fmt.formato, true); w.setUint16(22, fmt.canales, true);
    w.setUint32(24, fmt.tasa, true); w.setUint32(28, fmt.tasa * fmt.bloque, true); w.setUint16(32, fmt.bloque, true); w.setUint16(34, fmt.bits, true);
    out.set([0x64, 0x61, 0x74, 0x61], 36); w.setUint32(40, n, true);
    out.set(bytes.subarray(datos.inicio + p, datos.inicio + p + n), 44);
    trozos.push({ bytes: out, inicio: p / fmt.bloque / fmt.tasa });
  }
  return trozos;
}
