/**
 * Gemini por API (directo o a través de Cloudflare AI Gateway con `baseUrl`).
 *
 * - Lector: lee un pliego entero (PDF o imágenes) en una llamada con salida JSON por esquema.
 * - Embebedor: Gemini Embedding 2, multimodal, recortado a 1536 dimensiones.
 * - Redactor: JSON por esquema; «rapida» → Flash-Lite, «alta» → Flash; caché explícita del sistema largo.
 * - Transcriptor: gemini-3.5-transcribe (Interactions API) con marcas por palabra y hablantes.
 *
 * Identificadores comprobados contra `GET /v1beta/models` el 6-10-2026.
 */

import type {
  Embebedor, EspacioVectorial, Lector, Modalidad, PaginaLeida, PiezaEmbebible, Redactor, Transcripcion, Transcriptor,
} from '@scholaris/nucleo';
import { enParalelo, normalizarVector, reintentar, sha256 } from '@scholaris/nucleo';
import {
  aBase64, ahora, apuntador, ErrorProveedor, estadoReintentable, estimarTokens, extraerJSON, limitador, pedir,
  type ContadorUso, type OpcionesComunes, type UsoProveedor,
} from './comun.js';
import { costeTokens, precioDe } from './precios.js';
import { ESQUEMA_PAGINAS, hayBucle, instruccionesLector, normalizarPaginas, type OpcionesTranscripcion } from './lectura.js';
import { ErrorPliego, leerPartiendo, paginasDe, type EntradaPliego } from './pliego.js';

/** La petición o la respuesta se bloqueó por seguridad. No se reintenta con el mismo modelo. */
export class ErrorBloqueo extends ErrorProveedor {
  constructor(mensaje: string) {
    super('gemini', mensaje, { reintentable: false });
    this.name = 'ErrorBloqueo';
  }
}

/**
 * Filtros ajustables al mínimo: una biblioteca académica lee novela, historia y medicina
 * (drogas, violencia, sexo). PROHIBITED_CONTENT no se puede relajar; ese caso va a la reserva.
 */
export const SEGURIDAD_ACADEMICA = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));

export const MODELOS_GEMINI = {
  /** Lector por defecto: el de menos errores (CER 0,007 en el Casamiento, frente a 0,021 de Flash-Lite y 0,073 de la tubería antigua). */
  lector: 'gemini-3.8-flash',
  /** Lector rápido y barato: casi 3 veces más rápido en un libro entero; perfecto para PDF digitales (F1 0,98 igual que Flash). */
  lectorRapido: 'gemini-3.5-flash-lite',
  lectorAlto: 'gemini-3.8-flash',
  redactorRapido: 'gemini-3.5-flash-lite',
  redactorAlto: 'gemini-3.8-flash',
  embebedor: 'gemini-embedding-2',
  transcriptor: 'gemini-3.5-transcribe',
} as const;

export interface ConfigGemini extends OpcionesComunes {
  clave: string;
  /**
   * Base de la API. Por defecto `https://generativelanguage.googleapis.com`.
   * Con AI Gateway: `https://gateway.ai.cloudflare.com/v1/<cuenta>/<gateway>/google-ai-studio`.
   */
  baseUrl?: string;
  /** Cabeceras extra (p. ej. `cf-aig-authorization` para un gateway autenticado). */
  cabeceras?: Record<string, string>;
}

/** «ninguno» = `thinkingBudget: 0` (lo admite gemini-3.8-flash; ~25 % menos de latencia en lectura). */
type NivelPensamiento = 'ninguno' | 'minimal' | 'low' | 'medium' | 'high';

const SIGUIENTE_NIVEL: Record<string, NivelPensamiento | null> = { ninguno: 'minimal', minimal: 'low', low: null, medium: null, high: null };

export function configPensamiento(nivel: NivelPensamiento): Record<string, unknown> {
  return nivel === 'ninguno' ? { thinkingBudget: 0 } : { thinkingLevel: nivel };
}

function nivelDe(tc: unknown): NivelPensamiento | undefined {
  const t = tc as { thinkingLevel?: NivelPensamiento; thinkingBudget?: number } | undefined;
  if (!t) return undefined;
  if (t.thinkingBudget === 0) return 'ninguno';
  return t.thinkingLevel;
}
type Resolucion = 'baja' | 'media' | 'alta';

const RESOLUCION: Record<Resolucion, string> = {
  baja: 'MEDIA_RESOLUTION_LOW',
  media: 'MEDIA_RESOLUTION_MEDIUM',
  alta: 'MEDIA_RESOLUTION_HIGH',
};

interface RespuestaGenerar {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number; promptTokensDetails?: Array<{ modality: string; tokenCount: number }> };
  promptFeedback?: { blockReason?: string };
}

export interface ClienteGemini {
  readonly contador: ContadorUso;
  lector(o?: OpcionesLectorGemini): Lector & { readonly modelo: string };
  embebedor(o?: OpcionesEmbebedorGemini): Embebedor;
  redactor(o?: OpcionesRedactorGemini): Redactor;
  transcriptor(o?: OpcionesTranscriptorGemini): Transcriptor;
  /** Modo económico: lectura por la Batch API (50 % del precio, hasta 24 h). */
  lotes(o?: OpcionesLotesGemini): LotesLectura;
  /** Sube un fichero a la Files API (subida reanudable) y devuelve `{ nombre, uri }`. */
  subirArchivo(bytes: Uint8Array, mime: string, nombreVisible?: string): Promise<{ nombre: string; uri: string }>;
  /** Llamada cruda a generateContent (para el banco y para usos especiales). */
  generar(modelo: string, cuerpo: Record<string, unknown>, operacion: UsoProveedor['operacion'], extra?: Partial<UsoProveedor>): Promise<{ texto: string; fin?: string; uso: UsoProveedor }>;
}

export interface OpcionesLectorGemini extends OpcionesTranscripcion {
  modelo?: string;
  /** Resolución con la que el modelo ve cada página. «media» (560 tokens/página) satura la calidad de OCR según Google. */
  resolucion?: Resolucion;
  pensamiento?: NivelPensamiento;
  /**
   * Páginas máximas por llamada; si llega un pliego mayor, se parte y las partes van en paralelo.
   * Por defecto 1: la salida se genera en serie (~100-200 tokens/s), así que una página por llamada
   * con muchas llamadas a la vez es lo más rápido, y con Flash-Lite además lo más fiel (ver RESULTADOS.md).
   */
  maxPaginas?: number;
  /**
   * Tokens de salida por página (por defecto 3.000: una página densa da 700-1.100). Corta pronto
   * los bucles de repetición de Flash-Lite (antes llegaban a 60-88 s); si una página se corta sin
   * bucle, se repite una vez con 16.000.
   */
  maxTokensSalida?: number;
}

export interface OpcionesEmbebedorGemini {
  modelo?: string;
  dims?: number;
  /** Piezas por llamada a batchEmbedContents. */
  lote?: number;
}

export interface OpcionesRedactorGemini {
  modeloRapido?: string;
  modeloAlto?: string;
  /** A partir de cuántos caracteres de `sistema` se crea una caché explícita (0 = nunca). */
  umbralCache?: number;
  /** Vida de la caché explícita en segundos. */
  ttlCache?: number;
}

/** Puerto de lectura por lotes (estructuralmente igual a `LotesLectura` de @scholaris/ingesta). */
export interface LotesLectura {
  readonly nombre: string;
  enviar(peticiones: Array<{ clave: string; entrada: EntradaPliego }>): Promise<string>;
  consultar(id: string): Promise<{ estado: 'pendiente' | 'listo' | 'error'; resultados?: Record<string, PaginaLeida[]>; error?: string; usd?: number; fallidas?: Record<string, string> }>;
}

export interface OpcionesLotesGemini extends OpcionesLectorGemini {
  /**
   * Por encima de este tamaño (bytes de JSON) el lote va como JSONL por la Files API. Por defecto 0:
   * SIEMPRE por fichero. Probado el 6-10-2026: el mismo cuerpo del lector que funciona en
   * generateContent y en JSONL devuelve «Request contains an invalid argument» en lote en línea
   * (las peticiones pequeñas en línea sí pasan). Subir el umbral solo para peticiones sencillas.
   */
  maxEnLinea?: number;
}

export interface OpcionesTranscriptorGemini {
  modelo?: string;
  /** Tamaño máximo del audio en línea; por encima se sube con la Files API. */
  maxEnLinea?: number;
}

export function crearGemini(config: ConfigGemini): ClienteGemini {
  const base = (config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const { contador, apuntar } = apuntador(config);
  const limitar = limitador(config.concurrencia ?? 48);
  const cabeceras = { 'x-goog-api-key': config.clave, ...(config.cabeceras ?? {}) };
  /** Modelos que han rechazado un nivel de pensamiento → el que aceptan. */
  /** «modelo:nivel pedido» → nivel que el modelo acepta de verdad. */
  const pensamientoAceptado = new Map<string, NivelPensamiento | null>();

  const opcionesPeticion = (timeoutMs?: number): OpcionesComunes => ({ ...config, ...(timeoutMs ? { timeoutMs } : {}) });

  /** Lectura y redacción rápida: sin pensar. Flash-Lite usa «minimal»; Flash, presupuesto 0. */
  function nivelPorDefecto(modelo: string): NivelPensamiento {
    return /lite/.test(modelo) ? 'minimal' : 'ninguno';
  }

  async function generar(modelo: string, cuerpo: Record<string, unknown>, operacion: UsoProveedor['operacion'], extra: Partial<UsoProveedor> = {}, timeoutMs?: number) {
    const t0 = ahora();
    const gc = { ...((cuerpo.generationConfig as Record<string, unknown>) ?? {}) };
    const nivelPedido = nivelDe(gc.thinkingConfig);
    if (nivelPedido && pensamientoAceptado.has(`${modelo}:${nivelPedido}`)) {
      const aceptado = pensamientoAceptado.get(`${modelo}:${nivelPedido}`);
      if (aceptado) gc.thinkingConfig = configPensamiento(aceptado); else delete gc.thinkingConfig;
    }
    const llamar = (c: Record<string, unknown>) => limitar(() => pedir<RespuestaGenerar>({
      proveedor: 'gemini', url: `${base}/v1beta/models/${modelo}:generateContent`, cabeceras, cuerpo: c,
    }, opcionesPeticion(timeoutMs)));
    let r: RespuestaGenerar | undefined;
    // Algunos modelos no admiten ciertos niveles de pensamiento («minimal» en Flash, presupuesto 0 en otros):
    // se baja por la escalera ninguno → minimal → low → sin configuración, y se recuerda.
    for (let intento = 0; intento < 4 && !r; intento++) {
      try {
        r = await llamar({ ...cuerpo, generationConfig: gc });
      } catch (e) {
        const nivel = nivelDe(gc.thinkingConfig);
        if (!(e instanceof ErrorProveedor && e.estado === 400 && nivel && /thinking/i.test(e.cuerpo ?? ''))) throw e;
        const siguiente = SIGUIENTE_NIVEL[nivel] ?? null;
        if (nivelPedido) pensamientoAceptado.set(`${modelo}:${nivelPedido}`, siguiente);
        if (siguiente) gc.thinkingConfig = configPensamiento(siguiente); else delete gc.thinkingConfig;
      }
    }
    if (!r) throw new ErrorProveedor('gemini', `${modelo} no acepta ninguna configuración de pensamiento`);
    const cand = r.candidates?.[0];
    const texto = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const um = r.usageMetadata ?? {};
    const entrada = um.promptTokenCount ?? 0;
    const pensamiento = um.thoughtsTokenCount ?? 0;
    const salida = (um.candidatesTokenCount ?? 0) + pensamiento;
    const cache = um.cachedContentTokenCount ?? 0;
    const audio = (um.promptTokensDetails ?? []).filter((d) => d.modality === 'AUDIO').reduce((s, d) => s + d.tokenCount, 0);
    const uso: UsoProveedor = {
      proveedor: 'gemini', modelo, operacion, tokensEntrada: entrada, tokensSalida: salida, tokensCache: cache, tokensPensamiento: pensamiento,
      usd: costeTokens(modelo, entrada, salida, cache, audio), ms: ahora() - t0, ...extra,
    };
    apuntar(uso);
    if (r.promptFeedback?.blockReason) throw new ErrorBloqueo(`petición bloqueada: ${r.promptFeedback.blockReason}`);
    if (!texto && cand?.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(cand.finishReason)) throw new ErrorBloqueo(`respuesta bloqueada: ${cand.finishReason}`);
    return { texto, fin: cand?.finishReason, uso };
  }

  // -------------------------------------------------------------------------
  // Lector
  // -------------------------------------------------------------------------

  /** Cuerpo de generateContent para leer un pliego: lo comparten el lector y los lotes. */
  function cuerpoLectura(e: EntradaPliego, n: number, modelo: string, o: OpcionesLectorGemini) {
    const partes: Array<Record<string, unknown>> = [];
    if (e.pdf) partes.push({ inline_data: { mime_type: 'application/pdf', data: aBase64(e.pdf) } });
    else for (const [i, img] of (e.imagenes ?? []).entries()) {
      partes.push({ text: `[Página física ${e.primeraFisica + i}]` });
      partes.push({ inline_data: { mime_type: normalizarMime(img.mime), data: aBase64(img.bytes) } });
    }
    partes.push({ text: instruccionesLector(n, e.primeraFisica, e.pista, o, e.pdf ? 'pdf' : 'imagenes') });
    return {
      contents: [{ role: 'user', parts: partes }],
      safetySettings: SEGURIDAD_ACADEMICA,
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: ESQUEMA_PAGINAS,
        mediaResolution: RESOLUCION[o.resolucion ?? 'media'],
        maxOutputTokens: Math.min(65_536, (o.maxTokensSalida ?? 3_000) * n + 500),
        thinkingConfig: configPensamiento(o.pensamiento ?? nivelPorDefecto(modelo)),
      },
    };
  }

  function lector(o: OpcionesLectorGemini = {}): Lector & { readonly modelo: string } {
    const modelo = o.modelo ?? MODELOS_GEMINI.lector;
    const nombre = `gemini:${modelo}`;
    const leerUno = async (e: EntradaPliego, n: number): Promise<PaginaLeida[]> => {
      const cuerpo = cuerpoLectura(e, n, modelo, o);
      // Un pliego de 16 páginas densas puede tardar; el tiempo límite crece con las páginas.
      const plazo = Math.max(config.timeoutMs ?? 0, 60_000 + n * 20_000);
      let { texto, fin } = await generar(modelo, cuerpo, 'leer', { paginas: n, imagenes: e.imagenes?.length ?? 0 }, plazo);
      if (fin === 'MAX_TOKENS' && n === 1 && !hayBucle(texto)) {
        // Página de verdad larga (notas, tablas): una segunda oportunidad con más margen.
        cuerpo.generationConfig.maxOutputTokens = 16_000;
        ({ texto, fin } = await generar(modelo, cuerpo, 'leer', { paginas: n, imagenes: e.imagenes?.length ?? 0 }, plazo));
      }
      if (fin === 'MAX_TOKENS') {
        throw new ErrorPliego('gemini', hayBucle(texto) ? `bucle de repetición (${n} página(s))` : `salida cortada (${n} páginas)`);
      }
      // Gemini corta la salida que reproduce texto protegido (pasa con libros con derechos):
      // la cascada pasa la página al siguiente lector.
      if (fin === 'RECITATION') throw new ErrorPliego('gemini', `bloqueo por recitación (texto con derechos) en ${n} página(s)`);
      let json: unknown;
      try { json = extraerJSON(texto); } catch (err) { throw new ErrorPliego('gemini', `JSON ilegible (${fin ?? '¿?'})`, err); }
      const paginas = normalizarPaginas(json, n, e.primeraFisica, o);
      const faltan = paginas.filter((p) => p.confianza === 0 && !p.texto).length;
      if (n > 1 && faltan > n / 2) throw new ErrorPliego('gemini', `faltan ${faltan} de ${n} páginas en la respuesta`);
      return paginas;
    };
    return {
      nombre,
      modelo,
      leerPliego: (entrada) => leerPartiendo(entrada, leerUno, { maxPaginas: o.maxPaginas ?? 1 }),
    };
  }

  // -------------------------------------------------------------------------
  // Embebedor
  // -------------------------------------------------------------------------

  function embebedor(o: OpcionesEmbebedorGemini = {}): Embebedor {
    const modelo = o.modelo ?? MODELOS_GEMINI.embebedor;
    const dims = o.dims ?? 1536;
    const lote = Math.min(100, o.lote ?? 100);
    const espacio: EspacioVectorial = {
      id: `${modelo}@${dims}`, proveedor: 'google', modelo, dims, normalizado: true,
      modalidades: ['texto', 'imagen', 'audio', 'video', 'pdf'],
    };
    const MAX_CARACTERES = 24_000; // ~8192 tokens con margen

    const parte = (p: PiezaEmbebible, tarea: 'documento' | 'consulta'): Record<string, unknown> => {
      switch (p.modalidad) {
        case 'texto': {
          const t = p.texto.length > MAX_CARACTERES ? p.texto.slice(0, MAX_CARACTERES) : p.texto;
          // Embedding 2 no admite task_type: la tarea va en el propio texto (documentación de Google).
          return { text: tarea === 'consulta' ? `task: search result | query: ${t}` : `title: none | text: ${t}` };
        }
        case 'pdf': return { inline_data: { mime_type: 'application/pdf', data: aBase64(p.bytes) } };
        default: return { inline_data: { mime_type: normalizarMime(p.mime), data: aBase64(p.bytes) } };
      }
    };

    return {
      espacio,
      admite: (m: Modalidad) => espacio.modalidades.includes(m),
      async vectorizar(piezas, tarea) {
        if (piezas.length === 0) return [];
        // Lotes por número y por tamaño (las peticiones en línea no deben pasar de ~18 MB).
        const lotes: number[][] = [];
        let actual: number[] = [];
        let bytes = 0;
        piezas.forEach((p, i) => {
          const b = p.modalidad === 'texto' ? p.texto.length : Math.ceil(p.bytes.length * 1.37);
          if (actual.length && (actual.length >= lote || bytes + b > 18_000_000)) { lotes.push(actual); actual = []; bytes = 0; }
          actual.push(i); bytes += b;
        });
        if (actual.length) lotes.push(actual);
        const salida = new Array<Float32Array>(piezas.length);
        await enParalelo(lotes, config.concurrencia ?? 8, async (indices) => {
          const t0 = ahora();
          const r = await limitar(() => pedir<{ embeddings?: Array<{ values: number[] }>; usageMetadata?: { promptTokenCount?: number; promptTokenDetails?: Array<{ modality: string; tokenCount: number }> } }>({
            proveedor: 'gemini', url: `${base}/v1beta/models/${modelo}:batchEmbedContents`, cabeceras,
            cuerpo: { requests: indices.map((i) => ({ model: `models/${modelo}`, content: { parts: [parte(piezas[i] as PiezaEmbebible, tarea)] }, outputDimensionality: dims })) },
          }, config));
          const emb = r.embeddings ?? [];
          if (emb.length !== indices.length) throw new ErrorProveedor('gemini', `batchEmbedContents devolvió ${emb.length} vectores para ${indices.length} piezas`);
          indices.forEach((i, k) => { salida[i] = normalizarVector(Float32Array.from((emb[k] as { values: number[] }).values)); });
          const detalles = r.usageMetadata?.promptTokenDetails ?? [];
          const total = r.usageMetadata?.promptTokenCount ?? indices.reduce((s, i) => { const pz = piezas[i] as PiezaEmbebible; return s + (pz.modalidad === 'texto' ? estimarTokens(pz.texto) : 0); }, 0);
          const tokTexto = detalles.length ? detalles.filter((d) => d.modality === 'TEXT').reduce((s, d) => s + d.tokenCount, 0) : total;
          const p = precioDe(modelo);
          const imagenes = indices.filter((i) => (piezas[i] as PiezaEmbebible).modalidad === 'imagen').length;
          const usd = p ? (tokTexto * p.entrada + Math.max(0, total - tokTexto) * (p.entradaAudio ?? p.entrada)) / 1e6 : undefined;
          apuntar({ proveedor: 'gemini', modelo, operacion: 'vectorizar', tokensEntrada: total, tokensSalida: 0, imagenes, usd, ms: ahora() - t0, estimado: !r.usageMetadata });
        });
        return salida;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Redactor
  // -------------------------------------------------------------------------

  function redactor(o: OpcionesRedactorGemini = {}): Redactor {
    const umbral = o.umbralCache ?? 16_000;
    const ttl = o.ttlCache ?? 900;
    const caches = new Map<string, Promise<string | null>>();

    async function cacheDe(modelo: string, sistema: string): Promise<string | null> {
      const clave = `${modelo}:${await sha256(sistema)}`;
      let p = caches.get(clave);
      if (!p) {
        p = pedir<{ name?: string }>({
          proveedor: 'gemini', url: `${base}/v1beta/cachedContents`, cabeceras,
          cuerpo: { model: `models/${modelo}`, systemInstruction: { parts: [{ text: sistema }] }, ttl: `${ttl}s` },
        }, { ...config, intentos: 2 }).then((r) => r.name ?? null).catch(() => null); // si falla, queda la caché implícita
        caches.set(clave, p);
        // Se olvida un poco antes de que caduque en el servidor.
        setTimeout(() => caches.delete(clave), Math.max(1, ttl - 60) * 1000);
      }
      return p;
    }

    return {
      nombre: 'gemini',
      async generar<T>(pet: Parameters<Redactor['generar']>[0]): Promise<{ texto: string; json?: T }> {
        const modelo = pet.calidad === 'alta' ? (o.modeloAlto ?? MODELOS_GEMINI.redactorAlto) : (o.modeloRapido ?? MODELOS_GEMINI.redactorRapido);
        const contents = pet.mensajes.map((m) => ({
          role: m.rol === 'modelo' ? 'model' : 'user',
          parts: m.partes.map((p) => ('texto' in p ? { text: p.texto } : { inline_data: { mime_type: normalizarMime(p.mime), data: aBase64(p.bytes) } })),
        }));
        const generationConfig: Record<string, unknown> = { thinkingConfig: configPensamiento(pet.calidad === 'alta' ? 'low' : nivelPorDefecto(modelo)) };
        if (pet.temperatura !== undefined) generationConfig.temperature = pet.temperatura;
        if (pet.maxTokens !== undefined) generationConfig.maxOutputTokens = pet.maxTokens;
        if (pet.esquema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = pet.esquema; }
        const cuerpo: Record<string, unknown> = { contents, generationConfig, safetySettings: SEGURIDAD_ACADEMICA };
        if (pet.sistema) {
          const cache = umbral > 0 && pet.sistema.length >= umbral ? await cacheDe(modelo, pet.sistema) : null;
          if (cache) cuerpo.cachedContent = cache;
          else cuerpo.systemInstruction = { parts: [{ text: pet.sistema }] };
        }
        let res: { texto: string; fin?: string };
        try {
          res = await generar(modelo, cuerpo, 'generar');
        } catch (e) {
          // Bloqueo en «rapida»: el modelo alto a veces sí lo acepta; si no, sube el error a la reserva.
          const alto = o.modeloAlto ?? MODELOS_GEMINI.redactorAlto;
          if (!(e instanceof ErrorBloqueo) || modelo === alto) throw e;
          res = await generar(alto, { ...cuerpo, cachedContent: undefined, systemInstruction: pet.sistema ? { parts: [{ text: pet.sistema }] } : undefined, generationConfig: { ...generationConfig, thinkingConfig: configPensamiento('ninguno') } }, 'generar');
        }
        const { texto, fin } = res;
        if (!pet.esquema) return { texto };
        try {
          return { texto, json: extraerJSON<T>(texto) };
        } catch (e) {
          throw new ErrorProveedor('gemini', `JSON ilegible del redactor (${fin ?? '¿?'}): ${texto.slice(0, 200)}`, { causa: e });
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Transcriptor
  // -------------------------------------------------------------------------

  /** Subida reanudable a la Files API (dos pasos: abrir sesión y subir con «finalize»). Vive 48 h. */
  async function subirArchivo(bytes: Uint8Array, mime: string, nombreVisible = 'scholaris'): Promise<{ nombre: string; uri: string }> {
    const f = config.fetch ?? globalThis.fetch.bind(globalThis);
    return reintentar(async () => {
      const inicio = await f(`${base}/upload/v1beta/files`, {
        method: 'POST',
        headers: {
          ...cabeceras, 'content-type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(bytes.length), 'X-Goog-Upload-Header-Content-Type': mime,
        },
        body: JSON.stringify({ file: { display_name: nombreVisible } }),
        ...(config.signal ? { signal: config.signal } : {}),
      });
      const url = inicio.headers.get('x-goog-upload-url');
      if (!inicio.ok || !url) throw new ErrorProveedor('gemini', `Files API: no se pudo abrir la subida (HTTP ${inicio.status}) ${(await inicio.text()).slice(0, 200)}`, { estado: inicio.status, reintentable: estadoReintentable(inicio.status) });
      const r = await pedir<{ file?: { name?: string; uri?: string } }>({
        proveedor: 'gemini', url, cabeceras: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'content-type': mime }, cuerpo: bytes,
      }, { ...config, intentos: 1, timeoutMs: Math.max(config.timeoutMs ?? 0, 600_000) });
      if (!r.file?.uri || !r.file.name) throw new ErrorProveedor('gemini', 'la Files API no devolvió el fichero');
      return { nombre: r.file.name, uri: r.file.uri };
    }, { intentos: 3, base: 1000, esReintentable: (e) => e instanceof ErrorProveedor && e.reintentable });
  }

  // -------------------------------------------------------------------------
  // Lotes (Batch API)
  // -------------------------------------------------------------------------

  function lotes(o: OpcionesLotesGemini = {}): LotesLectura {
    const modelo = o.modelo ?? MODELOS_GEMINI.lector;
    const maxEnLinea = o.maxEnLinea ?? 0;
    const contados = new Set<string>();
    // La clave de cada petición lleva la primera página física y el número de páginas,
    // para poder interpretar la respuesta sin guardar estado (un Workflow puede consultar desde otro proceso).
    const SEP = '\u241f';
    const codificar = (clave: string, primera: number, n: number) => `${clave}${SEP}${primera}${SEP}${n}`;
    const decodificar = (k: string) => {
      const partes = k.split(SEP);
      const n = Number(partes.pop()); const primera = Number(partes.pop());
      return { clave: partes.join(SEP), primera, n };
    };
    return {
      nombre: `gemini-lotes:${modelo}`,
      async enviar(peticiones) {
        if (!peticiones.length) throw new Error('lotes.enviar: no hay peticiones');
        const lineas: Array<{ key: string; request: Record<string, unknown> }> = [];
        for (const p of peticiones) {
          const n = await paginasDe(p.entrada);
          lineas.push({ key: codificar(p.clave, p.entrada.primeraFisica, n), request: cuerpoLectura(p.entrada, n, modelo, o) });
        }
        const tam = lineas.reduce((t, l) => t + JSON.stringify(l.request).length, 0);
        let input_config: Record<string, unknown>;
        if (tam <= maxEnLinea) {
          input_config = { requests: { requests: lineas.map((l) => ({ request: l.request, metadata: { key: l.key } })) } };
        } else {
          const jsonl = new TextEncoder().encode(lineas.map((l) => JSON.stringify(l)).join('\n'));
          const fichero = await subirArchivo(jsonl, 'application/jsonl', `scholaris-lote-${Date.now()}`);
          input_config = { file_name: fichero.nombre };
        }
        const r = await pedir<{ name?: string }>({
          proveedor: 'gemini', url: `${base}/v1beta/models/${modelo}:batchGenerateContent`, cabeceras,
          cuerpo: { batch: { display_name: `scholaris-${Date.now()}`, input_config } },
        }, { ...config, timeoutMs: Math.max(config.timeoutMs ?? 0, 300_000) });
        if (!r.name) throw new ErrorProveedor('gemini', 'batchGenerateContent no devolvió nombre de lote');
        return r.name;
      },
      async consultar(id) {
        const r = await pedir<Record<string, unknown>>({ proveedor: 'gemini', url: `${base}/v1beta/${id}`, cabeceras }, config);
        const lote = interpretarLote(r);
        if (lote.estado === 'pendiente') return { estado: 'pendiente' };
        if (lote.estado === 'error') return { estado: 'error', error: lote.error ?? 'el lote falló' };
        let respuestas = lote.respuestas;
        if (!respuestas && lote.fichero) {
          const texto = await pedir<string>({ proveedor: 'gemini', url: `${base}/download/v1beta/${lote.fichero}:download?alt=media`, cabeceras, respuesta: 'texto' }, { ...config, timeoutMs: Math.max(config.timeoutMs ?? 0, 300_000) });
          respuestas = texto.split('\n').filter((l) => l.trim()).map((l) => {
            const j = JSON.parse(l) as { key?: string; response?: RespuestaGenerar; error?: { message?: string } };
            return { key: j.key ?? '', ...(j.response ? { response: j.response } : {}), ...(j.error ? { error: j.error.message ?? 'error' } : {}) };
          });
        }
        const resultados: Record<string, PaginaLeida[]> = {};
        const fallidas: Record<string, string> = {};
        let usd = 0;
        for (const x of respuestas ?? []) {
          const { clave, primera, n } = decodificar(x.key);
          if (!x.response) { fallidas[clave] = x.error ?? 'sin respuesta'; continue; }
          const um = x.response.usageMetadata ?? {};
          const salida = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
          usd += (costeTokens(modelo, um.promptTokenCount ?? 0, salida, um.cachedContentTokenCount ?? 0) ?? 0) / 2; // lotes: 50 %
          const cand = x.response.candidates?.[0];
          const texto = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
          if (cand?.finishReason && cand.finishReason !== 'STOP') { fallidas[clave] = `finishReason ${cand.finishReason}`; if (!texto) continue; }
          try { resultados[clave] = normalizarPaginas(extraerJSON(texto), n, primera, o); } catch { fallidas[clave] = 'JSON ilegible'; }
        }
        if (!contados.has(id)) {
          contados.add(id);
          const tokens = (respuestas ?? []).reduce((t, x) => t + (x.response?.usageMetadata?.promptTokenCount ?? 0), 0);
          const salida = (respuestas ?? []).reduce((t, x) => t + (x.response?.usageMetadata?.candidatesTokenCount ?? 0) + (x.response?.usageMetadata?.thoughtsTokenCount ?? 0), 0);
          apuntar({ proveedor: 'gemini', modelo: `${modelo}:lote`, operacion: 'leer', tokensEntrada: tokens, tokensSalida: salida, paginas: Object.values(resultados).reduce((t, p) => t + p.length, 0), usd, ms: 0 });
        }
        return { estado: 'listo', resultados, usd, ...(Object.keys(fallidas).length ? { fallidas } : {}) };
      },
    };
  }

  function transcriptor(o: OpcionesTranscriptorGemini = {}): Transcriptor {
    const modelo = o.modelo ?? MODELOS_GEMINI.transcriptor;
    const maxEnLinea = o.maxEnLinea ?? 18_000_000;
    return {
      nombre: `gemini:${modelo}`,
      async transcribir(audio, opciones = {}) {
        const t0 = ahora();
        const mime = normalizarMime(audio.mime);
        const fuente = audio.bytes.length > maxEnLinea
          ? { type: 'audio', uri: (await subirArchivo(audio.bytes, mime, 'scholaris-audio')).uri, mime_type: mime }
          : { type: 'audio', data: aBase64(audio.bytes), mime_type: mime };
        const modo: Record<string, unknown> = { type: 'verbatim', timestamp_granularities: ['word'] };
        if (opciones.hablantes !== false) modo.diarization_mode = 'speaker';
        const tc: Record<string, unknown> = { mode: modo };
        if (opciones.idioma) tc.language_codes = [opciones.idioma];
        const vocabulario = vocabularioDePista(opciones.pista);
        if (vocabulario.length) tc.custom_vocabulary = vocabulario;
        const r = await limitar(() => pedir<RespuestaInteraccion>({
          proveedor: 'gemini', url: `${base}/v1beta/interactions`, cabeceras,
          cuerpo: { model: modelo, store: false, input: [fuente], generation_config: { transcription_config: tc } },
        }, { ...config, timeoutMs: Math.max(config.timeoutMs ?? 0, 600_000) }));
        const t = interpretarInteraccion(r, audio.desplazamiento ?? 0);
        const segundos = t.palabras.length ? (t.palabras[t.palabras.length - 1] as { t1: number }).t1 - (audio.desplazamiento ?? 0) : 0;
        const p = precioDe(modelo);
        apuntar({
          proveedor: 'gemini', modelo, operacion: 'transcribir',
          tokensEntrada: r.usage?.total_input_tokens ?? 0, tokensSalida: r.usage?.total_output_tokens ?? 0,
          segundosAudio: segundos, usd: p?.porMinuto ? (segundos / 60) * p.porMinuto : undefined, ms: ahora() - t0,
        });
        return t;
      },
    };
  }

  return {
    contador, lector, embebedor, redactor, transcriptor, lotes, subirArchivo,
    generar: (modelo, cuerpo, operacion, extra) => generar(modelo, cuerpo, operacion, extra),
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export interface RespuestaInteraccion {
  status?: string;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; text?: string; start_offset?: string; end_offset?: string; speaker?: string }> }> }>;
  outputs?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; text?: string; start_offset?: string; end_offset?: string; speaker?: string }> }>;
  usage?: { total_input_tokens?: number; total_output_tokens?: number };
}

/** «11.300s» → 11.3 */
function segundosDe(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/s$/, ''));
  return Number.isFinite(n) ? n : 0;
}

export function interpretarInteraccion(r: RespuestaInteraccion, desplazamiento: number): Transcripcion {
  const contenidos = [
    ...(r.steps ?? []).filter((s) => !s.type || s.type === 'model_output').flatMap((s) => s.content ?? []),
    ...(r.outputs ?? []),
  ].filter((c) => !c.type || c.type === 'text');
  const texto = contenidos.map((c) => c.text ?? '').join('\n').trim();
  const palabras = contenidos.flatMap((c) => c.annotations ?? [])
    .filter((a) => a.type === 'word_info' && a.text)
    .map((a) => ({
      texto: a.text as string,
      t0: desplazamiento + segundosDe(a.start_offset),
      t1: desplazamiento + segundosDe(a.end_offset),
      ...(a.speaker ? { hablante: a.speaker.replace(/^spk[:_]?/, 'H') } : {}),
    }));
  return { texto, palabras };
}

/** Saca términos de la pista («Anchieta, auto sacramental; Pepe») para sesgar el vocabulario. */
function vocabularioDePista(pista: string | undefined): string[] {
  if (!pista) return [];
  return pista.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s && s.split(/\s+/).length <= 4 && s.length <= 60).slice(0, 50);
}

export function normalizarMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'audio/mp3') return 'audio/mpeg';
  if (m === 'image/jpg') return 'image/jpeg';
  if (m === 'audio/x-wav' || m === 'audio/wave') return 'audio/wav';
  if (m === 'video/quicktime') return 'video/mov';
  return m;
}

/** Estado de un lote: el REST devuelve una operación con `metadata` (y `response` al terminar); se aceptan también las formas del SDK. */
export function interpretarLote(r: Record<string, unknown>): { estado: 'pendiente' | 'listo' | 'error'; error?: string; respuestas?: Array<{ key: string; response?: RespuestaGenerar; error?: string }>; fichero?: string } {
  const meta = (r.metadata ?? r.batch ?? r) as Record<string, unknown>;
  const estadoCrudo = String(meta.state ?? r.state ?? '');
  const error = (r.error as { message?: string } | undefined)?.message;
  if (/FAILED|CANCELLED|EXPIRED/.test(estadoCrudo) || (r.done === true && error)) return { estado: 'error', error: error ?? estadoCrudo };
  if (!/SUCCEEDED/.test(estadoCrudo) && r.done !== true) return { estado: 'pendiente' };
  const salida = ((r.response as Record<string, unknown> | undefined) ?? (meta.output as Record<string, unknown> | undefined) ?? (r.dest as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const enLinea = (salida.inlinedResponses as { inlinedResponses?: unknown[] } | unknown[] | undefined);
  const lista = (Array.isArray(enLinea) ? enLinea : enLinea?.inlinedResponses) as Array<{ response?: RespuestaGenerar; error?: { message?: string }; metadata?: { key?: string } }> | undefined;
  const fichero = (salida.responsesFile ?? salida.fileName ?? salida.file_name) as string | undefined;
  return {
    estado: 'listo',
    ...(lista ? { respuestas: lista.map((x) => ({ key: x.metadata?.key ?? '', ...(x.response ? { response: x.response } : {}), ...(x.error ? { error: x.error.message ?? 'error' } : {}) })) } : {}),
    ...(fichero ? { fichero } : {}),
  };
}
