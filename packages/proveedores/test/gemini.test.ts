import { describe, expect, it } from 'vitest';
import { crearGemini, interpretarInteraccion } from '../src/gemini.js';
import { fetchFalso, IMG, paginasJSON, pdfDePaginas, respuestaGemini } from './falso.js';

type Cuerpo = { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: Record<string, unknown>; cachedContent?: string; systemInstruction?: unknown };

describe('Gemini · lector', () => {
  it('lee un pliego de imágenes en una llamada con esquema, resolución y pensamiento mínimo', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const c = ll.cuerpo as Cuerpo;
      const n = c.contents[0]?.parts.filter((p) => 'inline_data' in p).length ?? 0;
      return respuestaGemini(paginasJSON(5, n), { entrada: 2000, salida: 800 });
    });
    const usos: number[] = [];
    const g = crearGemini({ clave: 'K', fetch, onUso: (u) => usos.push(u.usd ?? -1) });
    const pags = await g.lector({ modelo: 'gemini-3.5-flash-lite' }).leerPliego({ imagenes: IMG(3), primeraFisica: 5, pista: 'comedia' });
    expect(pags.map((p) => p.fisica)).toEqual([5, 6, 7]);
    expect(pags[0]?.folio).toBe('-1');
    expect(llamadas).toHaveLength(1);
    const ll = llamadas[0];
    expect(ll?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(ll?.cabeceras['x-goog-api-key']).toBe('K');
    const c = ll?.cuerpo as Cuerpo;
    expect(c.generationConfig.responseMimeType).toBe('application/json');
    expect(c.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_MEDIUM');
    expect(c.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    expect(JSON.stringify(c.contents)).toContain('[Página física 6]');
    expect(JSON.stringify(c.contents)).toContain('NO modernices');
    expect(usos).toHaveLength(1);
    expect(usos[0]).toBeCloseTo((2000 * 0.3 + 800 * 2.5) / 1e6);
    expect(g.contador.total().paginas).toBe(3);
  });

  it('manda el PDF en línea y pasa por AI Gateway con baseUrl', async () => {
    const pdf = await pdfDePaginas(2);
    const { fetch, llamadas } = fetchFalso(() => respuestaGemini(paginasJSON(1, 2)));
    const g = crearGemini({ clave: 'K', fetch, baseUrl: 'https://gateway.ai.cloudflare.com/v1/C/G/google-ai-studio/' });
    const pags = await g.lector().leerPliego({ pdf, primeraFisica: 1 });
    expect(pags).toHaveLength(2);
    expect(llamadas[0]?.url).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/C\/G\/google-ai-studio\/v1beta\/models\//);
    const parte = (llamadas[0]?.cuerpo as Cuerpo).contents[0]?.parts[0] as { inline_data: { mime_type: string } };
    expect(parte.inline_data.mime_type).toBe('application/pdf');
  });

  it('si la salida se corta, parte el pliego en dos (también si es PDF)', async () => {
    const pdf = await pdfDePaginas(4);
    const { fetch, llamadas } = fetchFalso((ll, n) => {
      if (n === 1) return respuestaGemini('{"paginas":[{"fisica":1,"texto":"a', { fin: 'MAX_TOKENS' });
      const texto = JSON.stringify((ll.cuerpo as Cuerpo).contents);
      const desde = texto.includes('físicas 3 a 4') ? 3 : 1;
      return respuestaGemini(paginasJSON(desde, 2));
    });
    const pags = await crearGemini({ clave: 'K', fetch }).lector().leerPliego({ pdf, primeraFisica: 1 });
    expect(llamadas).toHaveLength(3);
    expect(pags.map((p) => p.fisica)).toEqual([1, 2, 3, 4]);
    expect(pags.every((p) => p.confianza > 0.5)).toBe(true);
  });

  it('si el modelo no admite el nivel de pensamiento, sube a «low» y lo recuerda', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const nivel = ((ll.cuerpo as Cuerpo).generationConfig.thinkingConfig as { thinkingLevel?: string } | undefined)?.thinkingLevel;
      if (nivel === 'minimal') return { estado: 400, cuerpo: { error: { message: 'Thinking level MINIMAL is not supported for this model.' } } };
      return respuestaGemini(paginasJSON(1, 1));
    });
    const l = crearGemini({ clave: 'K', fetch, esperaBase: 1 }).lector({ modelo: 'gemini-3.8-flash', pensamiento: 'minimal' });
    await l.leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    await l.leerPliego({ imagenes: IMG(1), primeraFisica: 2 });
    expect(llamadas.map((x) => ((x.cuerpo as Cuerpo).generationConfig.thinkingConfig as { thinkingLevel: string }).thinkingLevel)).toEqual(['minimal', 'low', 'low']);
  });
});

describe('Gemini · embebedor', () => {
  it('agrupa en batchEmbedContents, pone el prefijo de tarea, pide 1536 y renormaliza', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const reqs = (ll.cuerpo as { requests: unknown[] }).requests;
      return { embeddings: reqs.map(() => ({ values: Array.from({ length: 1536 }, () => 2) })), usageMetadata: { promptTokenCount: 30 } };
    });
    const e = crearGemini({ clave: 'K', fetch }).embebedor();
    expect(e.espacio.id).toBe('gemini-embedding-2@1536');
    expect(e.admite('audio')).toBe(true);
    const v = await e.vectorizar([
      { modalidad: 'texto', texto: 'hola' },
      { modalidad: 'imagen', bytes: new Uint8Array([1, 2]), mime: 'image/jpg' },
      { modalidad: 'pdf', bytes: new Uint8Array([3]) },
    ], 'documento');
    expect(v).toHaveLength(3);
    expect(v[0]?.length).toBe(1536);
    expect(Math.hypot(...(v[0] as Float32Array))).toBeCloseTo(1, 5);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toContain('gemini-embedding-2:batchEmbedContents');
    const reqs = (llamadas[0]?.cuerpo as { requests: Array<{ model: string; outputDimensionality: number; content: { parts: Array<Record<string, unknown>> } }> }).requests;
    expect(reqs[0]?.content.parts[0]).toEqual({ text: 'title: none | text: hola' });
    expect(reqs[0]?.outputDimensionality).toBe(1536);
    expect(reqs[0]?.model).toBe('models/gemini-embedding-2');
    expect((reqs[1]?.content.parts[0] as { inline_data: { mime_type: string } }).inline_data.mime_type).toBe('image/jpeg');
    await e.vectorizar([{ modalidad: 'texto', texto: 'pregunta' }], 'consulta');
    expect(((llamadas[1]?.cuerpo as typeof llamadas[0]['cuerpo'] & { requests: Array<{ content: { parts: Array<{ text: string }> } }> }).requests[0]?.content.parts[0]?.text)).toBe('task: search result | query: pregunta');
  });

  it('parte en lotes de 100', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => ({ embeddings: (ll.cuerpo as { requests: unknown[] }).requests.map(() => ({ values: [1, 0] })) }));
    const v = await crearGemini({ clave: 'K', fetch }).embebedor({ dims: 2 }).vectorizar(Array.from({ length: 250 }, (_, i) => ({ modalidad: 'texto' as const, texto: `t${i}` })), 'documento');
    expect(v).toHaveLength(250);
    expect(llamadas.map((l) => (l.cuerpo as { requests: unknown[] }).requests.length).sort()).toEqual([100, 100, 50]);
  });
});

describe('Gemini · redactor', () => {
  it('«rapida» va a Flash-Lite, «alta» a Flash; el sistema largo se cachea una vez', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/cachedContents')) return { name: 'cachedContents/abc' };
      return respuestaGemini('{"contexto":"ok"}');
    });
    const r = crearGemini({ clave: 'K', fetch }).redactor({ umbralCache: 100 });
    const sistema = 'x'.repeat(200);
    const pet = { sistema, mensajes: [{ rol: 'usuario' as const, partes: [{ texto: 'hola' }] }], esquema: { type: 'object' } };
    const a = await r.generar<{ contexto: string }>({ ...pet, calidad: 'rapida' });
    await r.generar({ ...pet, calidad: 'rapida' });
    await r.generar({ ...pet, calidad: 'alta' });
    expect(a.json?.contexto).toBe('ok');
    const urls = llamadas.map((l) => l.url.replace('https://generativelanguage.googleapis.com/v1beta/', ''));
    expect(urls).toEqual(['cachedContents', 'models/gemini-3.5-flash-lite:generateContent', 'models/gemini-3.5-flash-lite:generateContent', 'cachedContents', 'models/gemini-3.8-flash:generateContent']);
    expect((llamadas[1]?.cuerpo as Cuerpo).cachedContent).toBe('cachedContents/abc');
    expect((llamadas[1]?.cuerpo as Cuerpo).systemInstruction).toBeUndefined();
  });

  it('sin caché posible, manda systemInstruction', async () => {
    const { fetch, llamadas } = fetchFalso(() => respuestaGemini('texto libre'));
    const r = await crearGemini({ clave: 'K', fetch }).redactor().generar({ sistema: 'breve', mensajes: [{ rol: 'usuario', partes: [{ texto: 'hola' }] }] });
    expect(r.texto).toBe('texto libre');
    expect((llamadas[0]?.cuerpo as Cuerpo).systemInstruction).toEqual({ parts: [{ text: 'breve' }] });
  });
});

describe('Gemini · transcriptor', () => {
  it('llama a Interactions con marcas por palabra y hablantes, y desplaza los tiempos', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Hola mundo', annotations: [
        { type: 'word_info', text: 'Hola', speaker: 'spk:0', start_offset: '0.100s', end_offset: '0.450s' },
        { type: 'word_info', text: 'mundo', speaker: 'spk:1', start_offset: '0.5s', end_offset: '1s' },
      ] }] }],
      usage: { total_input_tokens: 50, total_output_tokens: 0 },
    }));
    const t = await crearGemini({ clave: 'K', fetch }).transcriptor().transcribir({ bytes: new Uint8Array([1]), mime: 'audio/mp3', desplazamiento: 60 }, { idioma: 'es-ES', pista: 'Anchieta, auto sacramental' });
    expect(t.texto).toBe('Hola mundo');
    expect(t.palabras).toEqual([{ texto: 'Hola', t0: 60.1, t1: 60.45, hablante: 'H0' }, { texto: 'mundo', t0: 60.5, t1: 61, hablante: 'H1' }]);
    const c = llamadas[0]?.cuerpo as { model: string; store: boolean; input: Array<{ mime_type: string }>; generation_config: { transcription_config: Record<string, unknown> } };
    expect(llamadas[0]?.url).toMatch(/\/v1beta\/interactions$/);
    expect(c.model).toBe('gemini-3.5-transcribe');
    expect(c.store).toBe(false);
    expect(c.input[0]?.mime_type).toBe('audio/mpeg');
    expect(c.generation_config.transcription_config).toEqual({
      mode: { type: 'verbatim', timestamp_granularities: ['word'], diarization_mode: 'speaker' },
      language_codes: ['es-ES'], custom_vocabulary: ['Anchieta', 'auto sacramental'],
    });
  });

  it('interpreta también el formato `outputs`', () => {
    expect(interpretarInteraccion({ outputs: [{ type: 'text', text: 'x', annotations: [{ type: 'word_info', text: 'x', start_offset: '1s', end_offset: '2s' }] }] }, 0).palabras).toHaveLength(1);
  });
});
