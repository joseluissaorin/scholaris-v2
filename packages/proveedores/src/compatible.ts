/**
 * Un servidor de inferencia propio, compatible con OpenAI: InferBox, Ollama,
 * llama.cpp (`llama-server`), vLLM, LM Studio… Implementa TODOS los puertos de
 * inteligencia sin salir de la red de casa, para el modo sin conexión.
 *
 * - Lector: un modelo de visión y lenguaje (Qwen2.5-VL, Qwen3-VL, MiniCPM-V,
 *   olmOCR…) por `/v1/chat/completions` con la imagen de la página. Una página
 *   por llamada, varias a la vez; el mismo esquema JSON que el lector de Gemini
 *   (folio, cabecera, pie, notas, títulos, figuras), restringido por gramática
 *   (`response_format: json_schema`) cuando el servidor lo admite. Los modelos
 *   de visión no leen PDF: si llega un PDF, `rasterizar` lo pasa a imágenes.
 * - Embebedor: `/v1/embeddings` (texto) o, con InferBox, `/v1/embed`
 *   (Qwen3-VL-Embedding-2B @2048, texto e imagen).
 * - Reordenador: `/v1/rerank` (InferBox, llama.cpp con `--reranking`, vLLM,
 *   Infinity). Si el servidor no lo tiene (Ollama), coseno con el embebedor.
 * - Transcriptor: `/v1/transcribe` (InferBox) u `/v1/audio/transcriptions`
 *   (faster-whisper-server, speaches, LocalAI, vLLM) con marcas por palabra.
 * - Juez: el LLM local contesta cada pregunta tipada eligiendo una letra; la
 *   probabilidad sale de `logprobs` si el servidor los da, y si no, la elección
 *   restringida vale 1 (y se dice en el nombre: `…+sin-logprobs`).
 * - Redactor: chat con `response_format: json_schema`.
 *
 * Coste: 0 $ (se apunta el tiempo y los tokens que devuelva el servidor).
 */

import type {
  Embebedor, EspacioVectorial, Juez, Lector, PaginaLeida, PiezaEmbebible, PreguntaJuez, Redactor, Reordenador, RespuestaJuez, Transcripcion, Transcriptor,
} from '@scholaris/nucleo';
import { enParalelo, normalizarVector } from '@scholaris/nucleo';
import { aBase64, ahora, apuntador, ErrorProveedor, extraerJSON, limitador, pedir, type ContadorUso, type OpcionesComunes, type UsoProveedor } from './comun.js';
import { ESQUEMA_PAGINAS, instruccionesLector, normalizarPaginas, type OpcionesTranscripcion } from './lectura.js';
import { ErrorPliego, paginasDe, type EntradaPliego } from './pliego.js';
import { normalizarMime } from './gemini.js';
import { crearInferBox, interpretarTranscripcionIB } from './inferbox.js';

/** Dialecto del servidor: cambia rutas y detalles, no la interfaz. */
export type SaborServidor = 'inferbox' | 'ollama' | 'llamacpp' | 'vllm' | 'lmstudio' | 'generico';

export interface ModelosCompatibles {
  /** Modelo de visión para leer páginas (Qwen2.5-VL, Qwen3-VL, MiniCPM-V…). */
  lector?: string;
  /** LLM para el redactor (por defecto, el del lector). */
  redactor?: string;
  /** LLM para el juez (por defecto, el del redactor). */
  juez?: string;
  embebedor?: string;
  reordenador?: string;
  transcriptor?: string;
}

export interface ConfigCompatible extends OpcionesComunes {
  /** Base del servidor, con o sin `/v1` («http://localhost:11434», «http://inferbox:8811/v1»). */
  url: string;
  clave?: string;
  sabor?: SaborServidor;
  modelos?: ModelosCompatibles;
  /** Dimensiones del embebedor de texto si no están en la tabla (`DIMENSIONES_CONOCIDAS`). */
  dims?: number;
  /** Servidor de transcripción aparte (whisper), si no es el mismo. */
  urlTranscripcion?: string;
  /** Servidor de reordenación aparte (llama.cpp con --reranking, Infinity…). */
  urlReordenador?: string;
  /** PDF → imágenes de página (los modelos de visión no leen PDF). La versión local da uno con pdf.js. */
  rasterizar?: (pdf: Uint8Array) => Promise<Array<{ bytes: Uint8Array; mime: string }>>;
  /** Contexto máximo del estado del juez, en caracteres. */
  maxEstadoJuez?: number;
}

/** Dimensiones de los embebedores habituales (por nombre, sin etiqueta de cuantización). */
export const DIMENSIONES_CONOCIDAS: Record<string, number> = {
  'bge-m3': 1024, 'nomic-embed-text': 768, 'mxbai-embed-large': 1024, 'snowflake-arctic-embed': 1024, 'snowflake-arctic-embed2': 1024,
  'all-minilm': 384, 'granite-embedding': 384, 'embeddinggemma': 768, 'qwen3-embedding': 4096, 'qwen3-embedding:0.6b': 1024, 'qwen3-embedding:4b': 2560,
  'qwen3-embedding:8b': 4096, 'multilingual-e5-large': 1024, 'paraphrase-multilingual': 768, 'jina-embeddings-v3': 1024,
};

/** Prefijos de tarea que esperan algunos embebedores (documento, consulta). */
const PREFIJOS: Array<{ re: RegExp; documento: string; consulta: string }> = [
  { re: /nomic-embed/i, documento: 'search_document: ', consulta: 'search_query: ' },
  { re: /e5/i, documento: 'passage: ', consulta: 'query: ' },
  { re: /qwen3-embedding/i, documento: '', consulta: 'Instruct: Given a search query, retrieve relevant passages that answer the query\nQuery: ' },
  { re: /embeddinggemma/i, documento: 'title: none | text: ', consulta: 'task: search result | query: ' },
  { re: /snowflake-arctic/i, documento: '', consulta: 'Represent this sentence for searching relevant passages: ' },
  { re: /mxbai-embed/i, documento: '', consulta: 'Represent this sentence for searching relevant passages: ' },
];

/** Modelos por defecto de cada sabor (los que se han probado; ver SIN-CONEXION.md). */
export const MODELOS_POR_DEFECTO: Record<SaborServidor, Required<Omit<ModelosCompatibles, 'redactor' | 'juez'>>> = {
  inferbox: { lector: 'qwen2.5-vl-7b', embebedor: 'qwen3-vl-embed', reordenador: 'bge-reranker', transcriptor: '' },
  ollama: { lector: 'qwen2.5vl:7b', embebedor: 'bge-m3', reordenador: '', transcriptor: 'whisper-1' },
  llamacpp: { lector: '', embebedor: '', reordenador: '', transcriptor: 'whisper-1' },
  vllm: { lector: 'Qwen/Qwen2.5-VL-7B-Instruct', embebedor: 'BAAI/bge-m3', reordenador: 'BAAI/bge-reranker-v2-m3', transcriptor: 'openai/whisper-large-v3-turbo' },
  lmstudio: { lector: 'qwen2.5-vl-7b-instruct', embebedor: 'text-embedding-bge-m3', reordenador: '', transcriptor: 'whisper-1' },
  generico: { lector: '', embebedor: '', reordenador: '', transcriptor: 'whisper-1' },
};

export interface ClienteCompatible {
  readonly contador: ContadorUso;
  readonly sabor: SaborServidor;
  salud(): Promise<boolean>;
  /** Una llamada de chat cruda (lo usan el lector, el redactor y el juez). */
  chat(p: PeticionChat): Promise<RespuestaChatLocal>;
  lector(o?: OpcionesTranscripcion & { modelo?: string; concurrencia?: number }): Lector;
  embebedor(o?: { modelo?: string; dims?: number }): Embebedor;
  reordenador(o?: { modelo?: string; embebedor?: Embebedor }): Reordenador;
  transcriptor(o?: { modelo?: string }): Transcriptor;
  juez(o?: { modelo?: string }): Juez;
  redactor(o?: { modelo?: string }): Redactor;
}

export interface PeticionChat {
  modelo: string;
  mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }>;
  esquema?: Record<string, unknown>;
  maxTokens?: number;
  temperatura?: number;
  /** Pide las `n` alternativas más probables del primer token. */
  logprobs?: number;
  operacion: UsoProveedor['operacion'];
  extraUso?: Partial<UsoProveedor>;
  timeoutMs?: number;
}

export interface RespuestaChatLocal {
  texto: string;
  fin?: string;
  /** Alternativas del primer token generado (token → logprob). */
  primerToken?: Array<{ token: string; logprob: number }>;
}

interface RespuestaOpenAI {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string };
    finish_reason?: string;
    logprobs?: { content?: Array<{ token: string; logprob: number; top_logprobs?: Array<{ token: string; logprob: number }> }> } | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string } | string;
}

/** La base con `/v1`, venga como venga. */
export function baseV1(url: string): string {
  const b = url.replace(/\/+$/, '');
  return /\/v1$/.test(b) ? b : `${b}/v1`;
}

/** Quita el razonamiento que algunos modelos dejan en el contenido (`<think>…</think>`). */
export function sinRazonamiento(texto: string): string {
  return texto.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/^[\s\S]*?<\/think>\s*/, '').trim();
}

export function crearOpenAICompatible(config: ConfigCompatible): ClienteCompatible {
  const sabor: SaborServidor = config.sabor ?? 'generico';
  const base = baseV1(config.url);
  const { contador, apuntar } = apuntador(config);
  // Una GPU (o una CPU) no gana nada con muchas peticiones a la vez.
  const limitar = limitador(config.concurrencia ?? 4);
  const cabeceras: Record<string, string> = config.clave ? { authorization: `Bearer ${config.clave}`, 'x-api-key': config.clave } : {};
  const op = { ...config, timeoutMs: config.timeoutMs ?? 600_000, intentos: config.intentos ?? 3 };
  const prov = sabor === 'generico' ? 'local' : sabor;
  const defecto = MODELOS_POR_DEFECTO[sabor];
  const modelos = {
    lector: config.modelos?.lector || defecto.lector,
    embebedor: config.modelos?.embebedor || defecto.embebedor,
    reordenador: config.modelos?.reordenador || defecto.reordenador,
    transcriptor: config.modelos?.transcriptor || defecto.transcriptor,
  };
  const modeloRedactor = config.modelos?.redactor || modelos.lector;
  const modeloJuez = config.modelos?.juez || modeloRedactor;
  // InferBox trae su embebedor multimodal, su reordenador y su transcriptor con rutas propias.
  const ib = sabor === 'inferbox' ? crearInferBox({ ...config, url: config.url.replace(/\/v1\/?$/, ''), clave: config.clave ?? '' }) : null;

  /** Lo que el servidor no admite, aprendido en la primera llamada (para no repetir el 400). */
  const sinSoporte = { esquema: false, logprobs: false, rerank: false };

  async function chat(p: PeticionChat): Promise<RespuestaChatLocal> {
    if (!p.modelo) throw new ErrorProveedor(prov, `falta el modelo para «${p.operacion}» (INFERENCIA_MODELO_…)`);
    const cuerpo: Record<string, unknown> = {
      model: p.modelo, messages: p.mensajes, temperature: p.temperatura ?? 0, max_tokens: p.maxTokens ?? 2048, stream: false,
    };
    if (p.esquema && !sinSoporte.esquema) cuerpo.response_format = { type: 'json_schema', json_schema: { name: 'respuesta', strict: true, schema: p.esquema } };
    else if (p.esquema) cuerpo.response_format = { type: 'json_object' };
    if (p.logprobs && !sinSoporte.logprobs) { cuerpo.logprobs = true; cuerpo.top_logprobs = p.logprobs; }
    // Sin razonamiento: lo que se pide aquí es transcribir o elegir, y los tokens de pensar cuestan minutos en local.
    if (sabor === 'ollama') { cuerpo.think = false; cuerpo.reasoning_effort = 'none'; }
    if (sabor === 'llamacpp' || sabor === 'vllm') cuerpo.chat_template_kwargs = { enable_thinking: false };
    const t0 = ahora();
    let r: RespuestaOpenAI;
    try {
      r = await limitar(() => pedir<RespuestaOpenAI>({ proveedor: prov, url: `${base}/chat/completions`, cabeceras, cuerpo }, p.timeoutMs ? { ...op, timeoutMs: p.timeoutMs } : op));
    } catch (e) {
      // Un 400 por `response_format` o `logprobs`: se recuerda y se repite sin ello.
      const msg = e instanceof ErrorProveedor && e.estado && e.estado >= 400 && e.estado < 500 && e.estado !== 401 && e.estado !== 403 && e.estado !== 404 ? `${e.cuerpo ?? e.message}` : '';
      if (msg && cuerpo.logprobs && /logprob/i.test(msg)) { sinSoporte.logprobs = true; return chat(p); }
      if (msg && cuerpo.response_format && !sinSoporte.esquema && /response_format|json_schema|schema|grammar/i.test(msg)) { sinSoporte.esquema = true; return chat(p); }
      throw e;
    }
    if (r.error) throw new ErrorProveedor(prov, typeof r.error === 'string' ? r.error : r.error.message ?? 'error');
    const c = r.choices?.[0];
    const texto = sinRazonamiento(c?.message?.content ?? '');
    apuntar({
      proveedor: prov, modelo: r.model ?? p.modelo, operacion: p.operacion, tokensEntrada: r.usage?.prompt_tokens ?? 0, tokensSalida: r.usage?.completion_tokens ?? 0,
      usd: 0, ms: ahora() - t0, ...(r.usage ? {} : { estimado: true }), ...(p.extraUso ?? {}),
    });
    const lp = c?.logprobs?.content;
    if (p.logprobs && !lp?.length) sinSoporte.logprobs = true;
    return {
      texto, ...(c?.finish_reason ? { fin: c.finish_reason } : {}),
      ...(lp?.length ? { primerToken: primerTokenUtil(lp) } : {}),
    };
  }

  async function salud(): Promise<boolean> {
    try {
      await pedir({ proveedor: prov, url: sabor === 'inferbox' ? `${config.url.replace(/\/v1\/?$/, '').replace(/\/+$/, '')}/v1/health` : `${base}/models`, cabeceras }, { ...config, timeoutMs: 5_000, intentos: 1 });
      return true;
    } catch { return false; }
  }

  // -------------------------------------------------------------------------
  // Lector
  // -------------------------------------------------------------------------

  function lector(o: OpcionesTranscripcion & { modelo?: string; concurrencia?: number } = {}): Lector {
    const modelo = o.modelo ?? modelos.lector;
    const porPagina = limitador(o.concurrencia ?? config.concurrencia ?? 4);
    const leerUna = async (img: { bytes: Uint8Array; mime: string }, fisica: number, pista: string | undefined): Promise<PaginaLeida> => {
      const instrucciones = instruccionesLector(1, fisica, pista, o, 'imagenes')
        + '\nResponde SOLO con el objeto JSON, sin texto alrededor.';
      const r = await porPagina(() => chat({
        modelo, operacion: 'leer', extraUso: { paginas: 1, imagenes: 1 }, maxTokens: 6_000, temperatura: 0,
        esquema: ESQUEMA_PAGINAS as unknown as Record<string, unknown>,
        mensajes: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${normalizarMime(img.mime)};base64,${aBase64(img.bytes)}` } },
          { type: 'text', text: instrucciones },
        ] }],
      }));
      if (r.fin === 'length') throw new ErrorPliego(prov, `salida cortada en la página ${fisica}`);
      let json: unknown;
      try { json = extraerJSON(r.texto); } catch (e) { throw new ErrorPliego(prov, `JSON ilegible en la página ${fisica}: ${r.texto.slice(0, 120)}`, e); }
      // Un objeto de página suelto (sin «paginas») también vale.
      const lista = json && typeof json === 'object' && !Array.isArray(json) && !('paginas' in json) ? { paginas: [json] } : json;
      return normalizarPaginas(lista, 1, fisica, o)[0] as PaginaLeida;
    };
    return {
      nombre: `${prov}:${modelo}`,
      async leerPliego(entrada: EntradaPliego) {
        let imagenes = entrada.imagenes;
        if (!imagenes?.length && entrada.pdf) {
          if (!config.rasterizar) throw new ErrorProveedor(prov, `el lector ${modelo} necesita imágenes de página, no un PDF (falta «rasterizar»)`);
          imagenes = await config.rasterizar(entrada.pdf);
        }
        const n = imagenes?.length ?? (await paginasDe(entrada));
        if (!imagenes?.length) throw new ErrorProveedor(prov, 'leerPliego: no hay imágenes');
        const lista = imagenes;
        // Una página por llamada: los modelos pequeños se pierden con varias, y así van en paralelo.
        return Promise.all(Array.from({ length: n }, (_, i) => leerUna(lista[i] as { bytes: Uint8Array; mime: string }, entrada.primeraFisica + i, entrada.pista)));
      },
    };
  }

  // -------------------------------------------------------------------------
  // Embebedor
  // -------------------------------------------------------------------------

  function embebedor(o: { modelo?: string; dims?: number } = {}): Embebedor {
    if (ib && !o.modelo) return ib.embebedor();
    const modelo = o.modelo ?? modelos.embebedor;
    if (!modelo) throw new ErrorProveedor(prov, 'falta el modelo del embebedor (INFERENCIA_MODELO_EMBEBEDOR)');
    const dims = o.dims ?? config.dims ?? dimensionesDe(modelo);
    if (!dims) throw new ErrorProveedor(prov, `no sé cuántas dimensiones tiene «${modelo}»: pon INFERENCIA_DIMS`);
    const espacio: EspacioVectorial = { id: `local:${modelo}@${dims}`, proveedor: prov, modelo, dims, normalizado: true, modalidades: ['texto'] };
    const prefijo = PREFIJOS.find((x) => x.re.test(modelo));
    return {
      espacio,
      admite: (m) => m === 'texto',
      async vectorizar(piezas: PiezaEmbebible[], tarea) {
        const textos = piezas.map((p) => {
          if (p.modalidad !== 'texto') throw new ErrorProveedor(prov, `${modelo} solo vectoriza texto (llegó ${p.modalidad})`);
          return (prefijo ? (tarea === 'consulta' ? prefijo.consulta : prefijo.documento) : '') + p.texto;
        });
        const lotes: number[][] = [];
        for (let i = 0; i < textos.length; i += 32) lotes.push(Array.from({ length: Math.min(32, textos.length - i) }, (_, k) => i + k));
        const salida = new Array<Float32Array>(textos.length);
        await enParalelo(lotes, 2, async (idx) => {
          const t0 = ahora();
          const r = await limitar(() => pedir<{ data?: Array<{ embedding: number[]; index?: number }>; usage?: { prompt_tokens?: number } }>(
            { proveedor: prov, url: `${base}/embeddings`, cabeceras, cuerpo: { model: modelo, input: idx.map((i) => textos[i]) } }, op));
          const datos = r.data ?? [];
          if (datos.length !== idx.length) throw new ErrorProveedor(prov, `/embeddings devolvió ${datos.length} vectores para ${idx.length} textos`);
          datos.forEach((d, k) => {
            const v = Float32Array.from(d.embedding);
            if (v.length !== dims) throw new ErrorProveedor(prov, `«${modelo}» devolvió ${v.length} dimensiones y se esperaban ${dims} (INFERENCIA_DIMS)`);
            salida[idx[d.index ?? k] as number] = normalizarVector(v);
          });
          apuntar({ proveedor: prov, modelo, operacion: 'vectorizar', tokensEntrada: r.usage?.prompt_tokens ?? 0, tokensSalida: 0, usd: 0, ms: ahora() - t0 });
        });
        return salida;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Reordenador
  // -------------------------------------------------------------------------

  function reordenador(o: { modelo?: string; embebedor?: Embebedor } = {}): Reordenador {
    const modelo = o.modelo ?? modelos.reordenador;
    const baseR = config.urlReordenador ? baseV1(config.urlReordenador) : base;
    // Ollama y LM Studio no tienen /rerank: coseno con el embebedor, sin preguntar.
    const tieneRerank = !!config.urlReordenador || (sabor !== 'ollama' && sabor !== 'lmstudio');
    const porVectores = async (consulta: string, textos: string[]): Promise<number[]> => {
      const e = o.embebedor ?? embebedor();
      const [q, ...docs] = await e.vectorizar([{ modalidad: 'texto', texto: consulta }, ...textos.map((t) => ({ modalidad: 'texto' as const, texto: t }))], 'consulta');
      return docs.map((d) => coseno(q as Float32Array, d));
    };
    if (ib && !config.urlReordenador) return ib.reordenador(o.modelo ? { modelo: o.modelo } : {});
    return {
      nombre: tieneRerank ? `${prov}:rerank${modelo ? `:${modelo}` : ''}` : `${prov}:coseno`,
      async reordenar(consulta, textos) {
        if (!textos.length) return [];
        if (!tieneRerank || sinSoporte.rerank) return porVectores(consulta, textos);
        const t0 = ahora();
        try {
          const r = await limitar(() => pedir<{ results?: Array<{ index: number; relevance_score?: number; score?: number }> }>({
            proveedor: prov, url: `${baseR}/rerank`, cabeceras,
            cuerpo: { ...(modelo ? { model: modelo } : {}), query: consulta, documents: textos, top_n: textos.length },
          }, { ...op, intentos: 2 }));
          const salida = new Array<number>(textos.length).fill(0);
          for (const x of r.results ?? []) if (x.index >= 0 && x.index < textos.length) salida[x.index] = x.relevance_score ?? x.score ?? 0;
          apuntar({ proveedor: prov, modelo: modelo || 'rerank', operacion: 'reordenar', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: ahora() - t0 });
          return salida;
        } catch (e) {
          if (e instanceof ErrorProveedor && (e.estado === 404 || e.estado === 405 || e.estado === 501)) { sinSoporte.rerank = true; return porVectores(consulta, textos); }
          throw e;
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Transcriptor
  // -------------------------------------------------------------------------

  function transcriptor(o: { modelo?: string } = {}): Transcriptor {
    if (ib && !config.urlTranscripcion) return ib.transcriptor(o.modelo ? { modelo: o.modelo } : {});
    const baseT = config.urlTranscripcion ? baseV1(config.urlTranscripcion) : base;
    const modelo = o.modelo ?? modelos.transcriptor;
    return {
      nombre: `${prov}:whisper${modelo ? `:${modelo}` : ''}`,
      async transcribir(audio, opciones = {}): Promise<Transcripcion> {
        const t0 = ahora();
        const fd = new FormData();
        const mime = normalizarMime(audio.mime);
        const ext = mime.split('/')[1]?.replace('mpeg', 'mp3').replace('x-wav', 'wav') ?? 'wav';
        fd.append('file', new Blob([audio.bytes as Uint8Array<ArrayBuffer>], { type: mime }), `audio.${ext}`);
        if (modelo) fd.append('model', modelo);
        fd.append('response_format', 'verbose_json');
        fd.append('timestamp_granularities[]', 'word');
        fd.append('timestamp_granularities[]', 'segment');
        if (opciones.idioma) fd.append('language', opciones.idioma.split('-')[0] as string);
        if (opciones.pista) fd.append('prompt', opciones.pista.slice(0, 800));
        const r = await limitar(() => pedir<RespuestaWhisperOpenAI>({ proveedor: prov, url: `${baseT}/audio/transcriptions`, cabeceras, cuerpo: fd }, op));
        const t = interpretarWhisperOpenAI(r, audio.desplazamiento ?? 0);
        apuntar({ proveedor: prov, modelo: modelo || 'whisper', operacion: 'transcribir', tokensEntrada: 0, tokensSalida: 0, segundosAudio: r.duration ?? t.palabras.at(-1)?.t1 ?? 0, usd: 0, ms: ahora() - t0 });
        return t;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Juez
  // -------------------------------------------------------------------------

  function juez(o: { modelo?: string } = {}): Juez {
    const modelo = o.modelo ?? modeloJuez;
    const maxEstado = config.maxEstadoJuez ?? 24_000;
    const nombre = () => `${prov}:juez:${modelo}${sinSoporte.logprobs ? '+sin-logprobs' : ''}`;
    return {
      get nombre() { return nombre(); },
      async juzgar(estado, preguntas) {
        let textoEstado = typeof estado === 'string' ? estado : JSON.stringify(estado, null, 1);
        if (textoEstado.length > maxEstado) textoEstado = `${textoEstado.slice(0, maxEstado)}\n[…estado recortado…]`;
        // El estado va primero y siempre igual: los servidores con caché de prefijo (llama.cpp, Ollama, vLLM) lo reaprovechan.
        const sistema = 'Eres un evaluador cuidadoso. Lee el ESTADO y contesta a la PREGUNTA eligiendo UNA de las opciones. Responde solo con la letra de la opción, sin nada más.';
        const entradas = Object.entries(preguntas);
        const respuestas = await enParalelo(entradas, 4, async ([clave, p]) => {
          const opciones = opcionesDe(p);
          const letras = opciones.map((_, i) => String.fromCharCode(65 + i));
          const pregunta = `ESTADO:\n${textoEstado}\n\nPREGUNTA (${clave}): ${p.instrucciones}\n\nOPCIONES:\n${opciones.map((x, i) => `${letras[i]}) ${x.texto}`).join('\n')}\n\nRespuesta (solo la letra):`;
          const r = await chat({
            modelo, operacion: 'juzgar', maxTokens: 12, temperatura: 0, logprobs: 20,
            esquema: { type: 'object', properties: { respuesta: { type: 'string', enum: letras } }, required: ['respuesta'], additionalProperties: false },
            mensajes: [{ role: 'system', content: sistema }, { role: 'user', content: `${pregunta}\nDevuelve {"respuesta": "<letra>"}.` }],
          });
          const probs = probabilidadesLetras(r, letras);
          return [clave, aRespuesta(p, opciones, probs)] as const;
        });
        return Object.fromEntries(respuestas) as Record<string, RespuestaJuez>;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Redactor
  // -------------------------------------------------------------------------

  function redactor(o: { modelo?: string } = {}): Redactor {
    const modelo = o.modelo ?? modeloRedactor;
    return {
      nombre: `${prov}:${modelo}`,
      async generar<T>(pet: Parameters<Redactor['generar']>[0]): Promise<{ texto: string; json?: T }> {
        const mensajes: PeticionChat['mensajes'] = [];
        if (pet.sistema) mensajes.push({ role: 'system', content: pet.sistema });
        for (const m of pet.mensajes) {
          const partes = m.partes.map((p) => {
            if ('texto' in p) return { type: 'text', text: p.texto };
            const mime = normalizarMime(p.mime);
            if (!mime.startsWith('image/')) return { type: 'text', text: `[adjunto ${mime} omitido: el modelo local solo ve imágenes]` };
            return { type: 'image_url', image_url: { url: `data:${mime};base64,${aBase64(p.bytes)}` } };
          });
          const soloTexto = partes.every((x) => x.type === 'text');
          mensajes.push({ role: m.rol === 'modelo' ? 'assistant' : 'user', content: soloTexto ? partes.map((x) => (x as { text: string }).text).join('\n') : partes });
        }
        if (pet.esquema && mensajes.length) {
          // Aunque el servidor no restrinja la salida, el modelo sabe qué forma devolver.
          const pista = `\n\nResponde SOLO con JSON que cumpla este esquema:\n${JSON.stringify(pet.esquema)}`;
          const ultimo = mensajes[mensajes.length - 1] as PeticionChat['mensajes'][number];
          if (typeof ultimo.content === 'string') ultimo.content += pista; else ultimo.content.push({ type: 'text', text: pista });
        }
        const r = await chat({
          modelo, operacion: 'generar', mensajes, temperatura: pet.temperatura ?? 0.2, maxTokens: pet.maxTokens ?? 2048,
          ...(pet.esquema ? { esquema: pet.esquema } : {}),
        });
        if (!pet.esquema) return { texto: r.texto };
        try { return { texto: r.texto, json: extraerJSON<T>(r.texto) }; } catch (e) {
          throw new ErrorProveedor(prov, `JSON ilegible del redactor: ${r.texto.slice(0, 200)}`, { causa: e });
        }
      },
    };
  }

  return { contador, sabor, salud, chat, lector, embebedor, reordenador, transcriptor, juez, redactor };
}

// ---------------------------------------------------------------------------
// Utilidades (exportadas para las pruebas)
// ---------------------------------------------------------------------------

export function dimensionesDe(modelo: string): number | undefined {
  const m = modelo.toLowerCase().replace(/^.*\//, '');
  if (DIMENSIONES_CONOCIDAS[m]) return DIMENSIONES_CONOCIDAS[m];
  const sinEtiqueta = m.replace(/:(latest|[\w.-]*q\d[\w.-]*|f16|fp16|bf16)$/, '');
  if (DIMENSIONES_CONOCIDAS[sinEtiqueta]) return DIMENSIONES_CONOCIDAS[sinEtiqueta];
  const raiz = sinEtiqueta.split(':')[0] as string;
  return DIMENSIONES_CONOCIDAS[raiz];
}

function coseno(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

/** El primer token «útil» (salta `{"respuesta":"` si la salida es JSON). */
function primerTokenUtil(lp: Array<{ token: string; logprob: number; top_logprobs?: Array<{ token: string; logprob: number }> }>): Array<{ token: string; logprob: number }> {
  for (const t of lp) {
    const alternativas = t.top_logprobs?.length ? t.top_logprobs : [{ token: t.token, logprob: t.logprob }];
    if (alternativas.some((a) => /^\s*"?[A-Z]"?\s*$/.test(a.token))) return alternativas;
  }
  const t = lp[0];
  return t ? (t.top_logprobs?.length ? t.top_logprobs : [{ token: t.token, logprob: t.logprob }]) : [];
}

interface OpcionJuez { clave: string; texto: string }

function opcionesDe(p: PreguntaJuez): OpcionJuez[] {
  switch (p.tipo) {
    case 'si_no': return [{ clave: 'si', texto: `Sí. ${p.criterios.si}` }, { clave: 'no', texto: `No. ${p.criterios.no}` }];
    case 'eleccion': return Object.entries(p.opciones).map(([clave, d]) => ({ clave, texto: d ? `${clave}: ${d}` : clave }));
    case 'escala': return p.niveles.map((texto, i) => ({ clave: String(i), texto }));
  }
}

/** Probabilidades por letra: de los logprobs si los hay; si no, 1 para la letra elegida. */
export function probabilidadesLetras(r: RespuestaChatLocal, letras: string[]): number[] {
  const probs = new Array<number>(letras.length).fill(0);
  if (r.primerToken?.length) {
    for (const a of r.primerToken) {
      const l = a.token.replace(/[\s"'{}:]/g, '').toUpperCase();
      const i = letras.indexOf(l);
      if (i >= 0) probs[i] = (probs[i] as number) + Math.exp(a.logprob);
    }
    const s = probs.reduce((x, y) => x + y, 0);
    if (s > 0) return probs.map((p) => p / s);
  }
  let elegida = '';
  try { elegida = String((extraerJSON<{ respuesta?: string }>(r.texto)).respuesta ?? ''); } catch { /* texto plano */ }
  if (!elegida) elegida = /\b([A-Z])\b/.exec(r.texto.toUpperCase())?.[1] ?? '';
  const i = letras.indexOf(elegida.trim().toUpperCase().slice(0, 1));
  if (i < 0) return letras.map(() => 1 / letras.length);
  probs[i] = 1;
  return probs;
}

function aRespuesta(p: PreguntaJuez, opciones: OpcionJuez[], probs: number[]): RespuestaJuez {
  switch (p.tipo) {
    case 'si_no': return { tipo: 'si_no', probabilidad: probs[0] ?? 0 };
    case 'eleccion': {
      const probabilidades = Object.fromEntries(opciones.map((o, i) => [o.clave, probs[i] ?? 0]));
      let mejor = 0;
      probs.forEach((x, i) => { if (x > (probs[mejor] ?? 0)) mejor = i; });
      return { tipo: 'eleccion', probabilidades, eleccion: opciones[mejor]?.clave ?? '' };
    }
    case 'escala': return { tipo: 'escala', valor: probs.reduce((s, x, i) => s + x * i, 0), probabilidades: probs };
  }
}

interface RespuestaWhisperOpenAI {
  text?: string;
  language?: string;
  duration?: number;
  words?: Array<{ word?: string; start?: number; end?: number }>;
  segments?: Array<{ start?: number; end?: number; text?: string; words?: Array<{ word?: string; text?: string; start?: number; end?: number }> }>;
}

/** verbose_json de OpenAI (palabras arriba) o de whisper.cpp / InferBox (palabras dentro de los segmentos). */
export function interpretarWhisperOpenAI(r: RespuestaWhisperOpenAI, desplazamiento: number): Transcripcion {
  if (r.words?.length) {
    const palabras = r.words.map((w) => ({ texto: (w.word ?? '').trim(), t0: desplazamiento + (w.start ?? 0), t1: desplazamiento + (w.end ?? 0) })).filter((w) => w.texto);
    return { ...(r.language ? { idioma: codigoIdioma(r.language) } : {}), palabras, texto: (r.text ?? palabras.map((p) => p.texto).join(' ')).trim() };
  }
  const t = interpretarTranscripcionIB(r, desplazamiento);
  return r.language ? { ...t, idioma: codigoIdioma(r.language) } : t;
}

const IDIOMAS: Record<string, string> = { spanish: 'es', english: 'en', french: 'fr', italian: 'it', german: 'de', portuguese: 'pt', latin: 'la', catalan: 'ca' };
function codigoIdioma(l: string): string { return IDIOMAS[l.toLowerCase()] ?? l; }
