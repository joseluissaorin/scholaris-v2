import { describe, expect, it } from 'vitest';
import { aContenidos, costeGemini, crearModeloGemini, subirArchivoGemini } from '../src/gemini.js';
import type { MensajeAgente } from '../src/modelo.js';

function fetchFalso(respuestas: Array<(cuerpo: Record<string, unknown>, url: string) => Response>) {
  const pedidas: Array<{ url: string; cuerpo: Record<string, unknown> }> = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const cuerpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    pedidas.push({ url: String(url), cuerpo });
    const r = respuestas[Math.min(pedidas.length - 1, respuestas.length - 1)]!;
    return r(cuerpo, String(url));
  }) as typeof fetch;
  return { f, pedidas };
}

const json = (x: unknown, estado = 200) => new Response(JSON.stringify(x), { status: estado, headers: { 'content-type': 'application/json' } });

describe('Gemini para el agente', () => {
  it('traduce los mensajes: texto, llamadas, respuestas, medios recortados y el contenido crudo tal cual', () => {
    const crudo = { role: 'model', parts: [{ functionCall: { name: 'buscar', args: { consulta: 'x' } }, thoughtSignature: 'firma' }] };
    const mensajes: MensajeAgente[] = [
      { rol: 'usuario', partes: [{ tipo: 'texto', texto: 'hola' }, { tipo: 'medio', uri: 'files/v', mime: 'video/mp4', desde: 590.04, hasta: 645, fps: 1 }] },
      { rol: 'modelo', partes: [{ tipo: 'llamada', nombre: 'buscar', args: { consulta: 'x' } }], crudo },
      { rol: 'usuario', partes: [{ tipo: 'respuesta', id: 'c1', nombre: 'buscar', contenido: { resultado: 'r' } }] },
    ];
    const c = aContenidos(mensajes);
    expect(c[0]).toEqual({ role: 'user', parts: [{ text: 'hola' }, { fileData: { fileUri: 'files/v', mimeType: 'video/mp4' }, videoMetadata: { startOffset: '590s', endOffset: '645s', fps: 1 } }] });
    expect(c[1]).toBe(crudo);
    expect(c[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'buscar', response: { resultado: 'r' }, id: 'c1' } }] });
  });

  it('un turno con llamadas a herramientas: las devuelve, guarda las firmas y cuenta el coste', async () => {
    const { f, pedidas } = fetchFalso([() => json({
      candidates: [{ content: { role: 'model', parts: [{ text: 'pensando', thought: true }, { functionCall: { name: 'leer', args: { documento: 'd' } }, thoughtSignature: 'sig' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 50 },
    })]);
    const m = crearModeloGemini({ clave: 'k', fetch: f, intentos: 1 }, 'gemini-4-argon');
    const r = await m.turno({ sistema: 'S', mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'q' }] }], herramientas: [{ nombre: 'leer', descripcion: 'd', parametros: { type: 'object' } }], pensamiento: 'bajo' });
    expect(r.llamadas).toEqual([{ nombre: 'leer', args: { documento: 'd' } }]);
    expect(r.texto).toBe('');
    expect((r.mensaje.crudo as { parts: unknown[] }).parts[1]).toMatchObject({ thoughtSignature: 'sig' });
    expect(r.uso).toMatchObject({ modelo: 'gemini-4-argon', entrada: 1000, salida: 150 });
    expect(r.uso.usd).toBeCloseTo(costeGemini('gemini-4-argon', 1000, 150), 10);
    const cuerpo = pedidas[0]!.cuerpo as { tools: Array<{ functionDeclarations: unknown[] }>; toolConfig: unknown; systemInstruction: unknown; generationConfig: { thinkingConfig: unknown } };
    expect(cuerpo.tools[0]!.functionDeclarations).toEqual([{ name: 'leer', description: 'd', parametersJsonSchema: { type: 'object' } }]);
    expect(cuerpo.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
    expect(cuerpo.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(pedidas[0]!.url).toContain('/v1beta/models/gemini-4-argon:generateContent');
  });

  it('si el modelo no acepta el nivel de pensamiento, prueba el siguiente y lo recuerda', async () => {
    const { f, pedidas } = fetchFalso([
      () => json({ error: { message: 'thinking level minimal is not supported' } }, 400),
      () => json({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: {} }),
    ]);
    const m = crearModeloGemini({ clave: 'k', fetch: f, intentos: 1 }, 'gemini-3.1-pro-preview');
    const r = await m.turno({ mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'q' }] }], esquema: { type: 'object' }, pensamiento: 'minimo' });
    expect(r.json).toEqual({ a: 1 });
    expect((pedidas[1]!.cuerpo.generationConfig as { thinkingConfig: unknown }).thinkingConfig).toEqual({ thinkingLevel: 'low' });
    await m.turno({ mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'q' }] }], esquema: { type: 'object' }, pensamiento: 'minimo' });
    expect(pedidas).toHaveLength(3);
  });

  it('el flujo entrega el texto por trozos y el uso al final', async () => {
    const sse = ['data: {"candidates":[{"content":{"parts":[{"text":"Hola, "}]}}]}', '', 'data: {"candidates":[{"content":{"parts":[{"text":"mundo."}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":3}}', '', ''].join('\n');
    const { f } = fetchFalso([() => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })]);
    const m = crearModeloGemini({ clave: 'k', fetch: f }, 'gemini-3.8-flash');
    const trozos: string[] = [];
    let uso;
    for await (const t of m.flujo!({ mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: 'q' }] }] })) {
      if ('delta' in t) trozos.push(t.delta); else uso = t.uso;
    }
    expect(trozos.join('')).toBe('Hola, mundo.');
    expect(uso).toMatchObject({ entrada: 10, salida: 3 });
  });

  it('sube un fichero en dos pasos y devuelve su nombre y su URI', async () => {
    const { f, pedidas } = fetchFalso([
      () => new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://subida/1' } }),
      () => json({ file: { name: 'files/abc', uri: 'https://g/files/abc', mimeType: 'video/mp4', state: 'PROCESSING', expirationTime: '2026-11-06T10:00:00Z' } }),
    ]);
    const a = await subirArchivoGemini({ clave: 'k', fetch: f }, new Uint8Array([1, 2, 3]), 3, 'video/mp4', 'prueba');
    expect(a).toEqual({ nombre: 'files/abc', uri: 'https://g/files/abc', mime: 'video/mp4', estado: 'PROCESSING', expira: '2026-11-06T10:00:00Z' });
    expect(pedidas[0]!.url).toContain('/upload/v1beta/files');
    expect(pedidas[1]!.url).toBe('https://subida/1');
  });
});
