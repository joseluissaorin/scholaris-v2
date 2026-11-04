/** El modelo de comprensión sobre Gemini: el cuerpo que manda, el coste que mide y los cortes. */
import { describe, expect, it } from 'vitest';
import { crearComprensorGemini, crearGemini, MODELOS_GEMINI } from '../src/index.js';
import { fetchFalso, respuestaGemini } from './falso.js';

describe('comprensor de Gemini', () => {
  it('manda sistema, esquema y pensamiento; mide tokens y dólares; respeta el tope de salida de cada modelo', async () => {
    const { fetch, llamadas } = fetchFalso(() => respuestaGemini(JSON.stringify({ fichas: [{ segmento: 's1' }] }), { entrada: 20_000, salida: 3000, pensamiento: 1000 }));
    const c = crearComprensorGemini(crearGemini({ clave: 'k', fetch, esperaBase: 1 }));
    expect(c.modelo('alta')).toBe(MODELOS_GEMINI.comprension);
    expect(c.modelo('rapida')).toBe(MODELOS_GEMINI.comprensionRapida);
    const r = await c.generar<{ fichas: Array<{ segmento: string }> }>({
      sistema: 'Eres un especialista.', partes: [{ texto: 'Material' }, { texto: 'Tarea' }], esquema: { type: 'object' }, calidad: 'alta', maxTokens: 60_000, operacion: 'fichas',
    });
    expect(r.json.fichas[0]!.segmento).toBe('s1');
    const cuerpo = llamadas[0]!.cuerpo as Record<string, any>;
    expect(llamadas[0]!.url).toContain(`/models/${MODELOS_GEMINI.comprension}:generateContent`);
    expect(cuerpo.systemInstruction.parts[0].text).toBe('Eres un especialista.');
    expect(cuerpo.contents[0].parts.map((p: { text: string }) => p.text)).toEqual(['Material', 'Tarea']);
    expect(cuerpo.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, thinkingConfig: { thinkingLevel: 'medium' } });
    // gemini-4-argon admite 32 768 tokens de salida: no se le piden más.
    expect(cuerpo.generationConfig.maxOutputTokens).toBe(32_768);
    expect(r.uso).toMatchObject({ modelo: MODELOS_GEMINI.comprension, tokensEntrada: 20_000, tokensSalida: 4000, llamadas: 1 });
    // Precio de lanzamiento de gemini-4-argon (2 y 10 $ por millón hasta el 30-11-2026).
    expect(r.uso.usd).toBeCloseTo((20_000 * 2 + 4000 * 10) / 1e6, 6);
    expect(c.precio('rapida')).toEqual({ entrada: 0.75, salida: 3.75 });
  });

  it('una salida cortada o un JSON roto se dicen claro', async () => {
    const { fetch } = fetchFalso((_, n) => (n === 1 ? respuestaGemini('{"fichas": [', { fin: 'MAX_TOKENS' }) : respuestaGemini('esto no es JSON')));
    const c = crearComprensorGemini(crearGemini({ clave: 'k', fetch, esperaBase: 1 }), { modeloRapido: 'gemini-3.8-flash' });
    const p = { sistema: 's', partes: [{ texto: 't' }], esquema: {}, calidad: 'rapida' as const, operacion: 'global' };
    await expect(c.generar(p)).rejects.toThrow(/salida cortada en global \(MAX_TOKENS\)/);
    await expect(c.generar(p)).rejects.toThrow(/JSON ilegible en global/);
  });
});

describe('comprensor de Gemini con límite', () => {
  it('una llamada que no contesta se corta en su límite, reintentos incluidos, con un error de plazo', async () => {
    let peticiones = 0;
    const colgada = ((_u: string, init?: RequestInit) => {
      peticiones++;
      return new Promise<Response>((_, no) => init?.signal?.addEventListener('abort', () => no(Object.assign(new Error('abortada'), { name: 'AbortError' }))));
    }) as unknown as typeof fetch;
    const c = crearComprensorGemini(crearGemini({ clave: 'k', fetch: colgada, esperaBase: 1, timeoutMs: 600_000 }));
    const t0 = Date.now();
    await expect(c.generar({ sistema: 's', partes: [{ texto: 't' }], esquema: {}, calidad: 'alta', operacion: 'entidades', limiteMs: 300 }))
      .rejects.toThrow(/sin respuesta dentro del plazo \(0 s\) en entidades/);
    // Sin el límite, el cliente esperaba 600 s por intento y hasta cuatro intentos.
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(peticiones).toBeLessThanOrEqual(3);
  });
});
