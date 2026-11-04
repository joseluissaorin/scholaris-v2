import { describe, expect, it } from 'vitest';
import { crearGemini, MODELOS_GEMINI, parteMedio, videnteGemini } from '../src/index.js';
import { fetchFalso, respuestaGemini } from './falso.js';

describe('Files API por trozos', () => {
  it('abre la subida, manda los trozos con su desplazamiento y cierra con finalize', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://subida/1' } });
      if (ll.cabeceras['x-goog-upload-command'] === 'upload, finalize') return { file: { name: 'files/abc', uri: 'https://g/files/abc', mimeType: 'video/mp4', state: 'PROCESSING', sizeBytes: '600000' } };
      return {};
    });
    const g = crearGemini({ clave: 'k', fetch });
    const datos = new Uint8Array(600_000).map((_, i) => i % 7);
    const leidos: Array<[number, number]> = [];
    const a = await g.subirArchivoPorTrozos({ bytes: datos.length, mime: 'video/mp4', trozo: 256 * 1024, leer: async (d, h) => { leidos.push([d, h]); return datos.slice(d, h); } });
    expect(a).toEqual({ nombre: 'files/abc', uri: 'https://g/files/abc', mime: 'video/mp4', estado: 'PROCESSING', bytes: 600000 });
    expect(leidos).toEqual([[0, 262144], [262144, 524288], [524288, 600000]]);
    expect(llamadas[0]!.cabeceras['x-goog-upload-header-content-length']).toBe('600000');
    expect(llamadas.slice(1).map((l) => [l.cabeceras['x-goog-upload-offset'], l.cabeceras['x-goog-upload-command']])).toEqual([['0', 'upload'], ['262144', 'upload'], ['524288', 'upload, finalize']]);
  });

  it('si un trozo falla, pregunta cuánto llegó y sigue desde ahí', async () => {
    let fallado = false;
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://subida/1' } });
      const cmd = ll.cabeceras['x-goog-upload-command'];
      if (cmd === 'query') return new Response('', { headers: { 'x-goog-upload-size-received': '262144' } });
      if (cmd === 'upload' && ll.cabeceras['x-goog-upload-offset'] === '262144' && !fallado) { fallado = true; return { estado: 503, cuerpo: 'ocupado' }; }
      if (cmd === 'upload, finalize') return { file: { name: 'files/x', uri: 'u', state: 'ACTIVE' } };
      return {};
    });
    const g = crearGemini({ clave: 'k', fetch });
    const a = await g.subirArchivoPorTrozos({ bytes: 600_000, mime: 'video/mp4', trozo: 256 * 1024, leer: async (d, h) => new Uint8Array(h - d) });
    expect(a.estado).toBe('ACTIVE');
    expect(llamadas.map((l) => l.cabeceras['x-goog-upload-command'] ?? 'start')).toEqual(['start', 'upload', 'upload', 'query', 'upload', 'upload, finalize']);
  }, 15_000);

  it('consulta un fichero; null si ya no existe', async () => {
    const { fetch } = fetchFalso((ll) => (ll.url.endsWith('files/viejo') ? { estado: 404, cuerpo: { error: { message: 'no' } } } : { name: 'files/abc', uri: 'https://g/files/abc', mimeType: 'video/mp4', state: 'ACTIVE', expirationTime: '2026-11-06T12:00:00Z' }));
    const g = crearGemini({ clave: 'k', fetch, intentos: 1 });
    expect(await g.archivo('files/abc')).toMatchObject({ estado: 'ACTIVE', expira: '2026-11-06T12:00:00Z' });
    expect(await g.archivo('files/viejo')).toBeNull();
  });
});

describe('vidente de Gemini', () => {
  it('manda el fichero con su tramo y su muestreo, el esquema y la resolución, y cuenta el coste como percepción', async () => {
    const { fetch, llamadas } = fetchFalso(() => respuestaGemini('{"escenas":[]}', { entrada: 56_000, salida: 20_000 }));
    const g = crearGemini({ clave: 'k', fetch });
    const v = videnteGemini(g);
    expect(v.nombre).toBe(`gemini:${MODELOS_GEMINI.percepcion}`);
    const m = await v.mirar({ fuente: { uri: 'https://g/files/abc', mime: 'video/quicktime' }, desde: 450.4, hasta: 930.2, fps: 2, resolucion: 'baja', sistema: 'S', texto: 'T', esquema: { type: 'object' } });
    const cuerpo = llamadas[0]!.cuerpo as { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: Record<string, unknown>; systemInstruction: unknown };
    expect(llamadas[0]!.url).toContain(`/models/${MODELOS_GEMINI.percepcion}:generateContent`);
    expect(cuerpo.contents[0]!.parts[0]).toEqual({ fileData: { fileUri: 'https://g/files/abc', mimeType: 'video/mov' }, videoMetadata: { startOffset: '450s', endOffset: '931s', fps: 2 } });
    expect(cuerpo.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, mediaResolution: 'MEDIA_RESOLUTION_LOW', maxOutputTokens: 32_768 });
    expect(m).toMatchObject({ json: { escenas: [] }, modelo: 'gemini-4-argon', fin: 'STOP', tokensEntrada: 56_000, tokensSalida: 20_000 });
    expect(m.usd).toBeCloseTo((56_000 * 2 + 20_000 * 10) / 1e6);
    expect(Object.keys(g.contador.detalle())).toEqual(['gemini/gemini-4-argon/percibir']);
  });

  it('una salida cortada vuelve sin JSON y con su motivo', async () => {
    const { fetch } = fetchFalso(() => respuestaGemini('{"escenas": [', { fin: 'MAX_TOKENS' }));
    const m = await videnteGemini(crearGemini({ clave: 'k', fetch }), { modelo: 'gemini-3.8-flash' }).mirar({ fuente: { uri: 'u', mime: 'video/mp4' }, sistema: '', texto: '', esquema: {} });
    expect(m.json).toBeUndefined();
    expect(m.fin).toBe('MAX_TOKENS');
  });

  it('sin tramo, el medio entero', () => {
    expect(parteMedio({ fuente: { uri: 'u', mime: 'audio/mp4' } })).toEqual({ fileData: { fileUri: 'u', mimeType: 'audio/mp4' } });
  });
});
