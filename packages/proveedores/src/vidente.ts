/**
 * Gemini mirando un tramo de un fichero de la Files API (`fileData` con
 * `videoMetadata`: desde, hasta y fps). Tiene la forma del puerto `Vidente` de
 * @scholaris/ingesta (percepción por ventanas); la usa también la herramienta
 * «ver» de Investigar.
 */
import { extraerJSON, type ContadorUso } from './comun.js';
import { crearGemini, MODELOS_GEMINI, normalizarMime, SEGURIDAD_ACADEMICA, type ClienteGemini, type ConfigGemini } from './gemini.js';

export interface PeticionMirarGemini {
  fuente: { uri: string; mime: string };
  desde?: number;
  hasta?: number;
  fps?: number;
  resolucion?: 'baja' | 'media' | 'alta';
  sistema: string;
  texto: string;
  esquema: Record<string, unknown>;
  modelo?: string;
  maxTokens?: number;
  temperatura?: number;
  pensamiento?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface MiradaGemini {
  texto: string;
  json?: unknown;
  modelo: string;
  fin?: string;
  usd?: number;
  tokensEntrada: number;
  tokensSalida: number;
  ms: number;
}

export interface VidenteGemini {
  readonly nombre: string;
  mirar(p: PeticionMirarGemini): Promise<MiradaGemini>;
}

const RESOLUCION = { baja: 'MEDIA_RESOLUTION_LOW', media: 'MEDIA_RESOLUTION_MEDIUM', alta: 'MEDIA_RESOLUTION_HIGH' } as const;

/** Salida máxima de cada modelo (Argon admite 32 768). */
function maxSalida(modelo: string): number {
  return /argon/.test(modelo) ? 32_768 : 65_536;
}

/** La parte del medio: el fichero con el tramo y el muestreo. */
export function parteMedio(p: Pick<PeticionMirarGemini, 'fuente' | 'desde' | 'hasta' | 'fps'>): Record<string, unknown> {
  const parte: Record<string, unknown> = { fileData: { fileUri: p.fuente.uri, mimeType: normalizarMime(p.fuente.mime) } };
  const vm: Record<string, string | number> = {};
  if (p.desde !== undefined && p.desde > 0) vm.startOffset = `${Math.floor(p.desde)}s`;
  if (p.hasta !== undefined && p.hasta > 0) vm.endOffset = `${Math.ceil(p.hasta)}s`;
  if (p.fps) vm.fps = p.fps;
  if (Object.keys(vm).length) parte.videoMetadata = vm;
  return parte;
}

/**
 * El vidente de Gemini. Las ventanas tardan (una de 8 minutos con 3.1 Pro, de 2 a
 * 4 minutos): el tiempo límite por intento es de 15 minutos.
 */
export function videnteGemini(config: ConfigGemini | ClienteGemini, o: { modelo?: string; timeoutMs?: number; contador?: ContadorUso } = {}): VidenteGemini {
  const g: ClienteGemini = 'generar' in config ? config : crearGemini({ ...config, timeoutMs: Math.max(config.timeoutMs ?? 0, o.timeoutMs ?? 900_000), intentos: config.intentos ?? 3, ...(o.contador ? { contador: o.contador } : {}) });
  const porDefecto = o.modelo ?? MODELOS_GEMINI.percepcion;
  return {
    nombre: `gemini:${porDefecto}`,
    async mirar(p) {
      const modelo = p.modelo ?? porDefecto;
      const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseJsonSchema: p.esquema,
        maxOutputTokens: Math.min(maxSalida(modelo), p.maxTokens ?? 65_536),
        temperature: p.temperatura ?? 0.2,
        mediaResolution: RESOLUCION[p.resolucion ?? 'media'],
      };
      if (p.pensamiento) generationConfig.thinkingConfig = { thinkingLevel: p.pensamiento };
      const r = await g.generar(modelo, {
        contents: [{ role: 'user', parts: [parteMedio(p), { text: p.texto }] }],
        systemInstruction: { parts: [{ text: p.sistema }] },
        safetySettings: SEGURIDAD_ACADEMICA,
        generationConfig,
      }, 'percibir');
      let json: unknown;
      try { json = extraerJSON(r.texto); } catch { json = undefined; }
      return {
        texto: r.texto, ...(json !== undefined ? { json } : {}), modelo, ...(r.fin ? { fin: r.fin } : {}),
        ...(r.uso.usd !== undefined ? { usd: r.uso.usd } : {}), tokensEntrada: r.uso.tokensEntrada, tokensSalida: r.uso.tokensSalida, ms: r.uso.ms,
      };
    },
  };
}
