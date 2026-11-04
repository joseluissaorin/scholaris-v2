/**
 * El modelo del agente con Gemini por API (directo o por AI Gateway): llamadas a
 * herramientas con las firmas de pensamiento de Gemini 3, salida JSON por
 * esquema, medios recortados por tramo (`videoMetadata`) y texto por trozos
 * (`streamGenerateContent`). Más la subida a la API de ficheros, que necesitan
 * los vídeos (hasta 2 GB, viven 48 h).
 */
import { aBase64, ErrorProveedor, pedir, precioDe } from '@scholaris/proveedores';
import type { MensajeAgente, ModeloAgente, NivelPensamiento, ParteMensaje, PeticionModelo, RespuestaModelo, TrozoModelo, UsoModelo } from './modelo.js';

export interface ConfigGeminiAgente {
  clave: string;
  /** Base de la API (por defecto la de Google; con AI Gateway, la del gateway). */
  baseUrl?: string;
  cabeceras?: Record<string, string>;
  fetch?: typeof fetch;
  /** Tiempo por intento (180 s: mirar un tramo largo de vídeo tarda). */
  timeoutMs?: number;
  intentos?: number;
}

/**
 * Precios en dólares por millón de tokens (página de precios de la Gemini API,
 * 4-11-2026). Gemini 4 Argon sube el 1-12-2026 a 4/20; 3.8 Flash, el 1-1-2027 a 1,5/7,5.
 */
export const PRECIOS_AGENTE: Record<string, { entrada: number; salida: number; cache: number; entradaLarga?: number; salidaLarga?: number }> = {
  'gemini-4-argon': { entrada: 2, salida: 10, cache: 0.1 },
  'gemini-3.1-pro-preview': { entrada: 2, salida: 12, cache: 0.2, entradaLarga: 4, salidaLarga: 18 },
  'gemini-3.1-pro-preview-customtools': { entrada: 2, salida: 12, cache: 0.2, entradaLarga: 4, salidaLarga: 18 },
  'gemini-pro-latest': { entrada: 2, salida: 12, cache: 0.2, entradaLarga: 4, salidaLarga: 18 },
  'gemini-3.8-flash': { entrada: 0.75, salida: 3.75, cache: 0.075 },
  'gemini-flash-latest': { entrada: 0.75, salida: 3.75, cache: 0.075 },
  'gemini-3.5-flash-lite': { entrada: 0.3, salida: 2.5, cache: 0.03 },
};

/** Coste estimado de una llamada. */
export function costeGemini(modelo: string, entrada: number, salida: number, cache = 0): number {
  const id = modelo.replace(/^models\//, '');
  const p = PRECIOS_AGENTE[id];
  if (p) {
    const largo = entrada > 200_000;
    const e = largo && p.entradaLarga ? p.entradaLarga : p.entrada;
    const s = largo && p.salidaLarga ? p.salidaLarga : p.salida;
    return (Math.max(0, entrada - cache) * e + cache * p.cache + salida * s) / 1e6;
  }
  const q = precioDe(id);
  if (!q) return 0;
  return (Math.max(0, entrada - cache) * q.entrada + cache * (q.cache ?? q.entrada) + salida * q.salida) / 1e6;
}

const SEGURIDAD = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));

const NIVEL: Record<NivelPensamiento, string> = { minimo: 'minimal', bajo: 'low', medio: 'medium', alto: 'high' };
const RESOLUCION = { baja: 'MEDIA_RESOLUTION_LOW', media: 'MEDIA_RESOLUTION_MEDIUM', alta: 'MEDIA_RESOLUTION_HIGH' } as const;

type ParteGemini = Record<string, unknown>;
interface ContenidoGemini { role: 'user' | 'model'; parts: ParteGemini[] }
interface RespuestaGemini {
  candidates?: Array<{ content?: { role?: string; parts?: Array<ParteGemini & { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

const segundos = (s: number) => `${Math.max(0, Math.round(s * 10) / 10)}s`;

function aParte(p: ParteMensaje): ParteGemini {
  switch (p.tipo) {
    case 'texto': return { text: p.texto };
    case 'llamada': return { functionCall: { name: p.nombre, args: p.args, ...(p.id ? { id: p.id } : {}) } };
    case 'respuesta': return { functionResponse: { name: p.nombre, response: p.contenido, ...(p.id ? { id: p.id } : {}) } };
    case 'medio': {
      const parte: ParteGemini = { fileData: { fileUri: p.uri, mimeType: p.mime } };
      const meta: Record<string, unknown> = {};
      if (p.desde !== undefined) meta.startOffset = segundos(p.desde);
      if (p.hasta !== undefined) meta.endOffset = segundos(p.hasta);
      if (p.fps !== undefined) meta.fps = p.fps;
      if (Object.keys(meta).length) parte.videoMetadata = meta;
      return parte;
    }
    case 'bytes': return { inlineData: { mimeType: p.mime, data: aBase64(p.bytes) } };
  }
}

export function aContenidos(mensajes: MensajeAgente[]): ContenidoGemini[] {
  return mensajes.map((m) => (m.crudo as ContenidoGemini | undefined) ?? { role: m.rol === 'modelo' ? 'model' : 'user', parts: m.partes.map(aParte) });
}

function cuerpoDe(p: PeticionModelo, nivel: string | null): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {};
  if (p.temperatura !== undefined) generationConfig.temperature = p.temperatura;
  if (p.maxTokens !== undefined) generationConfig.maxOutputTokens = p.maxTokens;
  if (nivel) generationConfig.thinkingConfig = { thinkingLevel: nivel };
  if (p.resolucion) generationConfig.mediaResolution = RESOLUCION[p.resolucion];
  if (p.esquema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseJsonSchema = p.esquema; }
  const cuerpo: Record<string, unknown> = { contents: aContenidos(p.mensajes), generationConfig, safetySettings: SEGURIDAD };
  if (p.sistema) cuerpo.systemInstruction = { parts: [{ text: p.sistema }] };
  if (p.herramientas?.length) {
    cuerpo.tools = [{ functionDeclarations: p.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, parametersJsonSchema: h.parametros })) }];
    cuerpo.toolConfig = { functionCallingConfig: { mode: p.obligarHerramienta ? 'ANY' : 'AUTO' } };
  }
  return cuerpo;
}

function usoDe(modelo: string, r: RespuestaGemini, ms: number): UsoModelo {
  const um = r.usageMetadata ?? {};
  const entrada = um.promptTokenCount ?? 0;
  const salida = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
  const cache = um.cachedContentTokenCount ?? 0;
  return { modelo, entrada, salida, cache, usd: costeGemini(modelo, entrada, salida, cache), ms };
}

function extraerJSON(texto: string): unknown {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(limpio); } catch {
    const i = limpio.search(/[[{]/);
    if (i < 0) throw new Error('no hay JSON en la respuesta');
    const cierra = limpio[i] === '{' ? '}' : ']';
    return JSON.parse(limpio.slice(i, limpio.lastIndexOf(cierra) + 1));
  }
}

/** Crea el modelo del agente sobre un modelo concreto de Gemini. */
export function crearModeloGemini(cfg: ConfigGeminiAgente, modelo: string): ModeloAgente {
  const base = (cfg.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const cabeceras = { 'x-goog-api-key': cfg.clave, ...(cfg.cabeceras ?? {}) };
  /** Nivel de pensamiento que el modelo no acepta → el siguiente que se prueba (null: sin configurarlo). */
  const rechazados = new Map<string, string | null>();
  const nivelPara = (p: PeticionModelo): string | null => {
    let n: string | null = p.pensamiento ? NIVEL[p.pensamiento] : null;
    while (n && rechazados.has(n)) n = rechazados.get(n) ?? null;
    return n;
  };
  const rebajar = (n: string): string | null => (n === 'minimal' ? 'low' : n === 'medium' ? 'high' : null);

  async function generar(p: PeticionModelo): Promise<{ r: RespuestaGemini; ms: number }> {
    for (let intento = 0; intento < 4; intento++) {
      const nivel = nivelPara(p);
      const t0 = Date.now();
      try {
        const r = await pedir<RespuestaGemini>({ proveedor: 'gemini', url: `${base}/v1beta/models/${modelo}:generateContent`, cabeceras, cuerpo: cuerpoDe(p, nivel) }, {
          timeoutMs: cfg.timeoutMs ?? 180_000, intentos: cfg.intentos ?? 3, ...(cfg.fetch ? { fetch: cfg.fetch } : {}), ...(p.signal ? { signal: p.signal } : {}),
        });
        return { r, ms: Date.now() - t0 };
      } catch (e) {
        if (nivel && e instanceof ErrorProveedor && e.estado === 400 && /thinking/i.test(e.cuerpo ?? '')) { rechazados.set(nivel, rebajar(nivel)); continue; }
        throw e;
      }
    }
    throw new ErrorProveedor('gemini', `${modelo} no acepta ninguna configuración de pensamiento`);
  }

  return {
    nombre: modelo,
    async turno(p: PeticionModelo): Promise<RespuestaModelo> {
      const { r, ms } = await generar(p);
      if (r.promptFeedback?.blockReason) throw new ErrorProveedor('gemini', `petición bloqueada: ${r.promptFeedback.blockReason}`, { reintentable: false });
      const cand = r.candidates?.[0];
      const partes = cand?.content?.parts ?? [];
      const texto = partes.filter((x) => typeof x.text === 'string' && !x.thought).map((x) => x.text).join('');
      const llamadas = partes.filter((x) => x.functionCall).map((x) => ({ ...(x.functionCall!.id ? { id: x.functionCall!.id } : {}), nombre: x.functionCall!.name, args: x.functionCall!.args ?? {} }));
      const mensaje: MensajeAgente = {
        rol: 'modelo',
        partes: [...(texto ? [{ tipo: 'texto' as const, texto }] : []), ...llamadas.map((l) => ({ tipo: 'llamada' as const, ...l }))],
        // Gemini 3 exige que vuelvan las firmas de pensamiento: el contenido va tal cual.
        crudo: { role: 'model', parts: partes },
      };
      const salida: RespuestaModelo = { mensaje, texto, llamadas, uso: usoDe(modelo, r, ms), ...(cand?.finishReason ? { fin: cand.finishReason } : {}) };
      if (p.esquema) {
        try { salida.json = extraerJSON(texto); } catch (e) {
          throw new ErrorProveedor('gemini', `JSON ilegible (${cand?.finishReason ?? '¿?'}): ${texto.slice(0, 200)}`, { causa: e });
        }
      }
      return salida;
    },

    async *flujo(p: PeticionModelo): AsyncGenerator<TrozoModelo> {
      const f = cfg.fetch ?? globalThis.fetch.bind(globalThis);
      const t0 = Date.now();
      let res: Response | null = null;
      let ultimo = '';
      for (let intento = 0; intento < (cfg.intentos ?? 3) && !res; intento++) {
        const nivel = nivelPara(p);
        const r = await f(`${base}/v1beta/models/${modelo}:streamGenerateContent?alt=sse`, {
          method: 'POST', headers: { ...cabeceras, 'content-type': 'application/json' }, body: JSON.stringify(cuerpoDe(p, nivel)), ...(p.signal ? { signal: p.signal } : {}),
        });
        if (r.ok && r.body) { res = r; break; }
        ultimo = await r.text().catch(() => '');
        if (nivel && r.status === 400 && /thinking/i.test(ultimo)) { rechazados.set(nivel, rebajar(nivel)); continue; }
        if (r.status !== 429 && r.status < 500) break;
        await new Promise((s) => setTimeout(s, 1500 * (intento + 1)));
      }
      if (!res?.body) throw new ErrorProveedor('gemini', `flujo fallido: ${ultimo.slice(0, 300)}`);
      const lector = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let resto = '';
      let final: RespuestaGemini = {};
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += value;
        let corte: number;
        while ((corte = resto.indexOf('\n')) >= 0) {
          const linea = resto.slice(0, corte).replace(/\r$/, '');
          resto = resto.slice(corte + 1);
          if (!linea.startsWith('data:')) continue;
          let j: RespuestaGemini;
          try { j = JSON.parse(linea.slice(5).trim()) as RespuestaGemini; } catch { continue; }
          if (j.usageMetadata) final = j;
          for (const parte of j.candidates?.[0]?.content?.parts ?? []) {
            if (typeof parte.text === 'string' && !parte.thought && parte.text) yield { delta: parte.text };
          }
        }
      }
      yield { uso: usoDe(modelo, final, Date.now() - t0) };
    },
  };
}

// ---------------------------------------------------------------------------
// API de ficheros
// ---------------------------------------------------------------------------

export interface ArchivoGemini {
  /** «files/abc123». */
  nombre: string;
  uri: string;
  mime: string;
  estado: 'PROCESSING' | 'ACTIVE' | 'FAILED' | string;
  /** ISO. */
  expira?: string;
}

/**
 * Sube un fichero a la API de ficheros (subida reanudable en un solo envío). El
 * cuerpo puede ser un flujo: un vídeo de cientos de megas no cabe en la memoria
 * de un Worker. En Workers, el flujo tiene que ser de longitud fija (`FixedLengthStream`).
 */
export async function subirArchivoGemini(cfg: ConfigGeminiAgente, cuerpo: ReadableStream<Uint8Array> | Uint8Array, bytes: number, mime: string, nombreVisible: string): Promise<ArchivoGemini> {
  const f = cfg.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (cfg.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const inicio = await f(`${base}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': cfg.clave, ...(cfg.cabeceras ?? {}), 'content-type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': mime,
    },
    body: JSON.stringify({ file: { display_name: nombreVisible.slice(0, 120) } }),
  });
  const url = inicio.headers.get('x-goog-upload-url');
  if (!inicio.ok || !url) throw new ErrorProveedor('gemini', `no se pudo abrir la subida (${inicio.status}): ${(await inicio.text().catch(() => '')).slice(0, 200)}`);
  const r = await f(url, {
    method: 'POST',
    headers: { 'content-length': String(bytes), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: cuerpo as BodyInit,
    // Node exige «duplex» para enviar un flujo.
    ...(cuerpo instanceof Uint8Array ? {} : { duplex: 'half' }),
  } as RequestInit);
  if (!r.ok) throw new ErrorProveedor('gemini', `la subida falló (${r.status}): ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const j = (await r.json()) as { file?: { name: string; uri: string; mimeType?: string; state?: string; expirationTime?: string } };
  if (!j.file) throw new ErrorProveedor('gemini', 'la subida no devolvió el fichero');
  return { nombre: j.file.name, uri: j.file.uri, mime: j.file.mimeType ?? mime, estado: j.file.state ?? 'PROCESSING', ...(j.file.expirationTime ? { expira: j.file.expirationTime } : {}) };
}

/** Estado de un fichero subido; null si ya no existe. */
export async function estadoArchivoGemini(cfg: ConfigGeminiAgente, nombre: string): Promise<ArchivoGemini | null> {
  const f = cfg.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (cfg.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const r = await f(`${base}/v1beta/${nombre}`, { headers: { 'x-goog-api-key': cfg.clave, ...(cfg.cabeceras ?? {}) } });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new ErrorProveedor('gemini', `estado del fichero (${r.status})`);
  const j = (await r.json()) as { name: string; uri: string; mimeType: string; state?: string; expirationTime?: string };
  return { nombre: j.name, uri: j.uri, mime: j.mimeType, estado: j.state ?? 'ACTIVE', ...(j.expirationTime ? { expira: j.expirationTime } : {}) };
}

/** Espera a que un vídeo subido termine de procesarse (ACTIVE). */
export async function esperarArchivoActivo(cfg: ConfigGeminiAgente, nombre: string, plazoMs = 600_000, cadaMs = 4000): Promise<ArchivoGemini> {
  const fin = Date.now() + plazoMs;
  for (;;) {
    const a = await estadoArchivoGemini(cfg, nombre);
    if (!a) throw new ErrorProveedor('gemini', `el fichero ${nombre} ya no existe`);
    if (a.estado === 'ACTIVE') return a;
    if (a.estado === 'FAILED') throw new ErrorProveedor('gemini', `Gemini no pudo procesar ${nombre}`);
    if (Date.now() > fin) throw new ErrorProveedor('gemini', `el fichero ${nombre} sigue procesándose`);
    await new Promise((s) => setTimeout(s, cadaMs));
  }
}
