/**
 * El modelo que juzga: una interfaz mínima (JSON con esquema, temperatura 0) y su
 * versión con Gemini por REST, con caché en disco por huella de la petición para
 * que repetir un juicio no cueste ni cambie el resultado.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PeticionJuez {
  sistema: string;
  usuario: string;
  esquema: Record<string, unknown>;
  /** Vídeo o imagen en línea (para mirar un recorte). */
  adjunto?: { mime: string; datos: Uint8Array; fps?: number };
}

export interface ModeloJuez {
  nombre: string;
  json<T>(p: PeticionJuez): Promise<{ json: T; usd: number }>;
}

/** Precio por millón de tokens (entrada, salida). gemini-4-argon no tiene precio publicado: se estima como Pro. */
export const PRECIOS_JUEZ: Record<string, [number, number]> = {
  'gemini-4-argon': [2, 12],
  'gemini-3.1-pro-preview': [2, 12],
  'gemini-pro-latest': [2, 12],
  'gemini-3.8-flash': [0.75, 3.75],
};

export function huella(x: unknown): string {
  return createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 24);
}

function extraerJSON<T>(texto: string): T {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(limpio) as T; } catch { /* sigue */ }
  const i = limpio.indexOf('{'), j = limpio.lastIndexOf('}');
  if (i >= 0 && j > i) return JSON.parse(limpio.slice(i, j + 1)) as T;
  throw new Error(`JSON ilegible: ${texto.slice(0, 200)}`);
}

export function juezGemini(o: { clave: string; modelo: string; fetch?: typeof fetch; plazoMs?: number }): ModeloJuez {
  const f = o.fetch ?? fetch;
  return {
    nombre: o.modelo,
    async json<T>(p: PeticionJuez) {
      const partes: Array<Record<string, unknown>> = [];
      if (p.adjunto) {
        partes.push({ inlineData: { mimeType: p.adjunto.mime, data: Buffer.from(p.adjunto.datos).toString('base64') }, ...(p.adjunto.fps ? { videoMetadata: { fps: p.adjunto.fps } } : {}) });
      }
      partes.push({ text: p.usuario });
      const cuerpo = {
        systemInstruction: { parts: [{ text: p.sistema }] },
        contents: [{ role: 'user', parts: partes }],
        generationConfig: { temperature: 0, maxOutputTokens: 32_768, responseMimeType: 'application/json', responseJsonSchema: p.esquema, ...(p.adjunto ? { mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' } : {}) },
        // Material académico (sexo, violencia, insultos citados): sin bloqueos.
        safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_NONE' })),
      };
      let ultimo: unknown;
      for (let intento = 0; intento < 4; intento++) {
        try {
          const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${o.modelo}:generateContent`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.clave }, body: JSON.stringify(cuerpo),
            signal: AbortSignal.timeout(o.plazoMs ?? 300_000),
          });
          if (!r.ok) {
            const t = await r.text();
            if ([429, 500, 502, 503, 504].includes(r.status)) throw new Error(`Gemini ${r.status}: ${t.slice(0, 200)}`);
            throw Object.assign(new Error(`Gemini ${r.status}: ${t.slice(0, 300)}`), { definitivo: true });
          }
          const d = await r.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string }; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
          const texto = (d.candidates?.[0]?.content?.parts ?? []).filter((x) => !x.thought).map((x) => x.text ?? '').join('');
          // Una respuesta vacía o cortada se repite (pasa con el pensamiento largo o un bloqueo).
          if (!texto.trim()) throw new Error(`Gemini sin texto (${d.candidates?.[0]?.finishReason ?? d.promptFeedback?.blockReason ?? '¿?'})`);
          const u = d.usageMetadata ?? {};
          const [pe, ps] = PRECIOS_JUEZ[o.modelo] ?? [2, 12];
          const usd = ((u.promptTokenCount ?? 0) * pe + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * ps) / 1e6;
          return { json: extraerJSON<T>(texto), usd };
        } catch (e) {
          ultimo = e;
          if ((e as { definitivo?: boolean }).definitivo) break;
          await new Promise((res) => setTimeout(res, 2000 * 2 ** intento));
        }
      }
      throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
    },
  };
}

/** Caché en disco: la misma petición al mismo modelo devuelve lo mismo y cuesta 0 la segunda vez. */
export function juezConCache(j: ModeloJuez, dir: string): ModeloJuez {
  mkdirSync(dir, { recursive: true });
  return {
    nombre: j.nombre,
    async json<T>(p: PeticionJuez) {
      const clave = huella({ modelo: j.nombre, sistema: p.sistema, usuario: p.usuario, esquema: p.esquema, adjunto: p.adjunto ? huella(Buffer.from(p.adjunto.datos).toString('base64')) : null });
      const ruta = join(dir, `${clave}.json`);
      if (existsSync(ruta)) {
        try { return { json: JSON.parse(readFileSync(ruta, 'utf8')) as T, usd: 0 }; } catch { /* se rehace */ }
      }
      const r = await j.json<T>(p);
      writeFileSync(ruta, JSON.stringify(r.json));
      return r;
    },
  };
}
