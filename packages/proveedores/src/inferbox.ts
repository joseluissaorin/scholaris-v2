/**
 * InferBox (opcional, sin conexión): el servidor de inferencia de casa.
 *
 * Implementado a partir de su README (repos/joseluissaorin/InferBox) y del
 * cliente de ScholarisWeb (`inferbox_client.py`). Está apagado mientras se
 * escribe esto: probado solo con fetch simulado.
 *
 * - Embebedor: Qwen3-VL-Embedding-2B, 2048 dims, espacio «qwen3-vl-embedding-2b@2048».
 *   Usa las MISMAS instrucciones que la tubería antigua para que los vectores
 *   casen con los de los SPDF v3 ya calculados.
 * - Reordenador: /v1/rerank (bge-reranker-v2-m3).
 * - Transcriptor: /v1/transcribe (multipart, estilo Whisper).
 * - Redactor: /v1/chat/completions (compatible con OpenAI, con json_schema).
 */

import type { Embebedor, EspacioVectorial, Redactor, Reordenador, Transcripcion, Transcriptor } from '@scholaris/nucleo';
import { enParalelo, normalizarVector } from '@scholaris/nucleo';
import { aBase64, ahora, apuntador, ErrorProveedor, extraerJSON, limitador, pedir, type ContadorUso, type OpcionesComunes } from './comun.js';
import { normalizarMime } from './gemini.js';

export interface ConfigInferBox extends OpcionesComunes {
  url: string;
  clave: string;
}

/** Instrucciones de la tubería antigua (embedding_service.py), para no romper el espacio. */
export const INSTRUCCIONES_QWEN3VL = {
  documento: 'Represent this document passage for retrieval.',
  consulta: 'Represent this search query for finding relevant passages.',
  imagen: 'Represent this image for visual similarity search.',
} as const;

export interface ClienteInferBox {
  readonly contador: ContadorUso;
  salud(): Promise<boolean>;
  embebedor(o?: { modelo?: string; lote?: number }): Embebedor;
  reordenador(o?: { modelo?: string }): Reordenador;
  transcriptor(o?: { modelo?: string }): Transcriptor;
  redactor(o?: { modelo?: string }): Redactor;
}

export function crearInferBox(config: ConfigInferBox): ClienteInferBox {
  const base = config.url.replace(/\/+$/, '');
  const { contador, apuntar } = apuntador(config);
  // Una GPU, un inquilino: pocas peticiones a la vez.
  const limitar = limitador(config.concurrencia ?? 4);
  const cabeceras = { 'x-api-key': config.clave };
  const op = { ...config, timeoutMs: config.timeoutMs ?? 300_000, intentos: config.intentos ?? 3 };
  const post = <T>(ruta: string, cuerpo: unknown) => limitar(() => pedir<T>({ proveedor: 'inferbox', url: `${base}${ruta}`, cabeceras, cuerpo }, op));

  async function salud(): Promise<boolean> {
    try {
      const r = await pedir<{ status?: string }>({ proveedor: 'inferbox', url: `${base}/v1/health`, cabeceras }, { ...config, timeoutMs: 5_000, intentos: 1 });
      return r.status === 'ok';
    } catch { return false; }
  }

  function embebedor(o: { modelo?: string; lote?: number } = {}): Embebedor {
    const espacio: EspacioVectorial = {
      id: 'qwen3-vl-embedding-2b@2048', proveedor: 'inferbox', modelo: 'qwen3-vl-embedding-2b', dims: 2048, normalizado: true, modalidades: ['texto', 'imagen'],
    };
    const lote = o.lote ?? 16;
    return {
      espacio,
      admite: (m) => m === 'texto' || m === 'imagen',
      async vectorizar(piezas, tarea) {
        const salida = new Array<Float32Array>(piezas.length);
        const textos = piezas.map((p, i) => ({ p, i })).filter((x) => x.p.modalidad === 'texto');
        const imagenes = piezas.map((p, i) => ({ p, i })).filter((x) => x.p.modalidad === 'imagen');
        const otras = piezas.filter((p) => p.modalidad !== 'texto' && p.modalidad !== 'imagen');
        if (otras.length) throw new ErrorProveedor('inferbox', `Qwen3-VL no vectoriza ${otras[0]?.modalidad}`);
        const grupos: Array<{ items: typeof textos; imagen: boolean }> = [];
        for (let i = 0; i < textos.length; i += lote) grupos.push({ items: textos.slice(i, i + lote), imagen: false });
        for (let i = 0; i < imagenes.length; i += lote) grupos.push({ items: imagenes.slice(i, i + lote), imagen: true });
        await enParalelo(grupos, 2, async (g) => {
          const t0 = ahora();
          const cuerpo: Record<string, unknown> = g.imagen
            ? {
                // El servidor empareja input[i] ↔ images[i]; una imagen sola va con texto vacío.
                input: g.items.map(() => ''),
                images: g.items.map((x) => aBase64((x.p as { bytes: Uint8Array }).bytes)),
                instruction: tarea === 'consulta' ? INSTRUCCIONES_QWEN3VL.consulta : INSTRUCCIONES_QWEN3VL.imagen,
              }
            : {
                input: g.items.map((x) => (x.p as { texto: string }).texto),
                instruction: tarea === 'consulta' ? INSTRUCCIONES_QWEN3VL.consulta : INSTRUCCIONES_QWEN3VL.documento,
              };
          if (o.modelo) cuerpo.model = o.modelo;
          const r = await post<{ embeddings?: number[][] }>('/v1/embed', cuerpo);
          const emb = r.embeddings ?? [];
          if (emb.length !== g.items.length) throw new ErrorProveedor('inferbox', `/v1/embed devolvió ${emb.length} vectores para ${g.items.length} piezas`);
          g.items.forEach((x, k) => { salida[x.i] = normalizarVector(Float32Array.from(emb[k] as number[])); });
          apuntar({ proveedor: 'inferbox', modelo: espacio.modelo, operacion: 'vectorizar', tokensEntrada: 0, tokensSalida: 0, imagenes: g.imagen ? g.items.length : 0, usd: 0, ms: ahora() - t0 });
        });
        return salida;
      },
    };
  }

  function reordenador(o: { modelo?: string } = {}): Reordenador {
    return {
      nombre: 'inferbox:rerank',
      async reordenar(consulta, textos) {
        if (!textos.length) return [];
        const salida = new Array<number>(textos.length).fill(0);
        // El README recomienda no pasar de ~50 documentos por llamada.
        const grupos: number[][] = [];
        for (let i = 0; i < textos.length; i += 48) grupos.push(Array.from({ length: Math.min(48, textos.length - i) }, (_, k) => i + k));
        await enParalelo(grupos, 2, async (idx) => {
          const t0 = ahora();
          const r = await post<{ results?: Array<{ index: number; score: number }> }>('/v1/rerank', {
            query: consulta, documents: idx.map((i) => textos[i]), top_k: idx.length, ...(o.modelo ? { model: o.modelo } : {}),
          });
          for (const { index, score } of r.results ?? []) if (idx[index] !== undefined) salida[idx[index] as number] = score;
          apuntar({ proveedor: 'inferbox', modelo: o.modelo ?? 'bge-reranker', operacion: 'reordenar', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: ahora() - t0 });
        });
        return salida;
      },
    };
  }

  function transcriptor(o: { modelo?: string } = {}): Transcriptor {
    return {
      nombre: 'inferbox:transcribe',
      async transcribir(audio, opciones = {}) {
        const t0 = ahora();
        const fd = new FormData();
        const mime = normalizarMime(audio.mime);
        const ext = mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'wav';
        fd.append('file', new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: mime }), `audio.${ext}`);
        if (opciones.idioma) fd.append('language', opciones.idioma.split('-')[0] as string);
        if (o.modelo) fd.append('model', o.modelo);
        const r = await limitar(() => pedir<RespuestaTranscripcionIB>({ proveedor: 'inferbox', url: `${base}/v1/transcribe`, cabeceras, cuerpo: fd }, op));
        const t = interpretarTranscripcionIB(r, audio.desplazamiento ?? 0);
        apuntar({ proveedor: 'inferbox', modelo: o.modelo ?? 'transcribe', operacion: 'transcribir', tokensEntrada: 0, tokensSalida: 0, segundosAudio: t.palabras.at(-1)?.t1 ?? 0, usd: 0, ms: ahora() - t0 });
        return t;
      },
    };
  }

  function redactor(o: { modelo?: string } = {}): Redactor {
    return {
      nombre: 'inferbox:chat',
      async generar<T>(pet: Parameters<Redactor['generar']>[0]): Promise<{ texto: string; json?: T }> {
        const t0 = ahora();
        const messages: Array<{ role: string; content: string }> = [];
        if (pet.sistema) messages.push({ role: 'system', content: pet.sistema });
        for (const m of pet.mensajes) {
          messages.push({ role: m.rol === 'modelo' ? 'assistant' : 'user', content: m.partes.map((p) => ('texto' in p ? p.texto : '')).join('\n') });
        }
        const cuerpo: Record<string, unknown> = { messages, max_tokens: pet.maxTokens ?? 1024, temperature: pet.temperatura ?? 0.2 };
        if (o.modelo) cuerpo.model = o.modelo;
        if (pet.esquema) cuerpo.response_format = { type: 'json_schema', json_schema: { name: 'respuesta', schema: pet.esquema } };
        const r = await post<{ choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }>('/v1/chat/completions', cuerpo);
        const texto = r.choices?.[0]?.message?.content ?? '';
        apuntar({ proveedor: 'inferbox', modelo: o.modelo ?? 'chat', operacion: 'generar', tokensEntrada: r.usage?.prompt_tokens ?? 0, tokensSalida: r.usage?.completion_tokens ?? 0, usd: 0, ms: ahora() - t0 });
        if (!pet.esquema) return { texto };
        return { texto, json: extraerJSON<T>(texto) };
      },
    };
  }

  return { contador, salud, embebedor, reordenador, transcriptor, redactor };
}

interface RespuestaTranscripcionIB {
  text?: string;
  language?: string;
  segments?: Array<{ start?: number; end?: number; text?: string; speaker?: string; words?: Array<{ word?: string; text?: string; start?: number; end?: number }> }>;
}

export function interpretarTranscripcionIB(r: RespuestaTranscripcionIB, desplazamiento: number): Transcripcion {
  const palabras: Transcripcion['palabras'] = [];
  for (const s of r.segments ?? []) {
    const hablante = s.speaker ? { hablante: s.speaker } : {};
    if (s.words?.length) {
      for (const w of s.words) {
        const texto = (w.word ?? w.text ?? '').trim();
        if (texto) palabras.push({ texto, t0: desplazamiento + (w.start ?? 0), t1: desplazamiento + (w.end ?? 0), ...hablante });
      }
    } else {
      const ws = (s.text ?? '').trim().split(/\s+/).filter(Boolean);
      const ini = s.start ?? 0, fin = s.end ?? ini;
      const paso = (fin - ini) / Math.max(1, ws.length);
      ws.forEach((texto, i) => palabras.push({ texto, t0: desplazamiento + ini + i * paso, t1: desplazamiento + ini + (i + 1) * paso, ...hablante }));
    }
  }
  return { ...(r.language ? { idioma: r.language } : {}), palabras, texto: (r.text ?? palabras.map((p) => p.texto).join(' ')).trim() };
}
