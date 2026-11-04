/**
 * El modelo de comprensión sobre Gemini (puerto `ModeloComprension` de
 * @scholaris/ingesta, aquí por su forma para no depender de la ingesta).
 *
 * «alta» va con `MODELOS_GEMINI.comprension` y «rapida» con
 * `MODELOS_GEMINI.comprensionRapida`. Cada llamada devuelve su uso medido
 * (tokens de entrada, de salida y de pensamiento, y dólares por la tabla de
 * precios), que la comprensión apunta en la procedencia del documento.
 *
 * Elección (4-11-2026, banco sobre «El lobo, el bosque y el hombre nuevo» y
 * «Fresa y chocolate»): ver el informe de la comprensión y docs/COMPRENSION.md.
 */
import { extraerJSON, ErrorProveedor } from './comun.js';
import { configPensamiento, MODELOS_GEMINI, SEGURIDAD_ACADEMICA, type ClienteGemini } from './gemini.js';
import { precioDe } from './precios.js';

type Parte = { texto: string } | { bytes: Uint8Array; mime: string } | { uri: string; mime: string };

export interface PeticionComprensionGemini {
  sistema: string;
  partes: Parte[];
  esquema: Record<string, unknown>;
  calidad: 'alta' | 'rapida';
  maxTokens?: number;
  operacion: string;
}

export interface OpcionesComprensor {
  modeloAlto?: string;
  modeloRapido?: string;
  /** Pensamiento del modelo alto (por defecto «medium») y del rápido («low»). */
  pensamientoAlto?: 'low' | 'medium' | 'high';
  pensamientoRapido?: 'minimal' | 'low' | 'medium';
  /** Tope de salida que admite cada modelo (gemini-4-argon: 32 768). */
  maxSalida?: Record<string, number>;
}

const SALIDA_POR_DEFECTO: Record<string, number> = { 'gemini-4-argon': 32_768 };

function aBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Estructuralmente, un `ModeloComprension` de @scholaris/ingesta. */
export function crearComprensorGemini(cliente: ClienteGemini, o: OpcionesComprensor = {}) {
  const alto = o.modeloAlto ?? MODELOS_GEMINI.comprension;
  const rapido = o.modeloRapido ?? MODELOS_GEMINI.comprensionRapida;
  const modelo = (c: 'alta' | 'rapida') => (c === 'alta' ? alto : rapido);
  return {
    nombre: `gemini:${alto}+${rapido}`,
    modelo,
    precio(c: 'alta' | 'rapida') {
      const p = precioDe(modelo(c));
      return p ? { entrada: p.entrada, salida: p.salida } : undefined;
    },
    async generar<T>(p: PeticionComprensionGemini): Promise<{ json: T; uso: { modelo: string; tokensEntrada: number; tokensSalida: number; usd: number; ms: number; llamadas: number } }> {
      const id = modelo(p.calidad);
      const tope = o.maxSalida?.[id] ?? SALIDA_POR_DEFECTO[id] ?? 65_536;
      const partes = p.partes.map((x) => ('texto' in x ? { text: x.texto } : 'bytes' in x ? { inline_data: { mime_type: x.mime, data: aBase64(x.bytes) } } : { file_data: { mime_type: x.mime, file_uri: x.uri } }));
      const cuerpo = {
        systemInstruction: { parts: [{ text: p.sistema }] },
        contents: [{ role: 'user', parts: partes }],
        safetySettings: SEGURIDAD_ACADEMICA,
        generationConfig: {
          responseMimeType: 'application/json', responseJsonSchema: p.esquema,
          maxOutputTokens: Math.min(tope, p.maxTokens ?? tope),
          thinkingConfig: configPensamiento(p.calidad === 'alta' ? o.pensamientoAlto ?? 'medium' : o.pensamientoRapido ?? 'low'),
        },
      };
      const r = await cliente.generar(id, cuerpo, 'generar', {});
      if (r.fin === 'MAX_TOKENS') throw new ErrorProveedor('gemini', `${id}: salida cortada en ${p.operacion} (MAX_TOKENS)`);
      let json: T;
      try { json = extraerJSON<T>(r.texto); } catch (e) {
        throw new ErrorProveedor('gemini', `${id}: JSON ilegible en ${p.operacion} (${r.fin ?? '¿?'}): ${r.texto.slice(0, 160)}`, { causa: e, reintentable: true });
      }
      return {
        json,
        uso: { modelo: id, tokensEntrada: r.uso.tokensEntrada ?? 0, tokensSalida: r.uso.tokensSalida ?? 0, usd: r.uso.usd ?? 0, ms: r.uso.ms ?? 0, llamadas: 1 },
      };
    },
  };
}
