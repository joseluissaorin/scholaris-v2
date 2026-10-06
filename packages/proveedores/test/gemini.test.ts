import { describe, expect, it } from 'vitest';
import { crearGemini, interpretarInteraccion, interpretarLote } from '../src/gemini.js';
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
    const pags = await g.lector({ modelo: 'gemini-3.5-flash-lite', maxPaginas: 8 }).leerPliego({ imagenes: IMG(3), primeraFisica: 5, pista: 'comedia' });
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

  it('por defecto lee una página por llamada, todas en paralelo, con Gemini 3.8 Flash', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const m = JSON.stringify(ll.cuerpo).match(/páginas físicas (\d+)/);
      return respuestaGemini(paginasJSON(Number(m?.[1]), 1));
    });
    const pags = await crearGemini({ clave: 'K', fetch }).lector().leerPliego({ imagenes: IMG(4), primeraFisica: 11 });
    expect(pags.map((p) => p.fisica)).toEqual([11, 12, 13, 14]);
    expect(llamadas).toHaveLength(4);
    expect(llamadas.every((l) => l.url.includes('gemini-3.8-flash:generateContent'))).toBe(true);
  });

  it('corta los bucles pronto (3.000 tokens por página) y da una segunda oportunidad a las páginas largas', async () => {
    const bucle = fetchFalso(() => respuestaGemini('{"paginas":[{"fisica":1,"texto":"' + 'y la la la '.repeat(200), { fin: 'MAX_TOKENS' }));
    await expect(crearGemini({ clave: 'K', fetch: bucle.fetch }).lector().leerPliego({ imagenes: IMG(1), primeraFisica: 1 })).rejects.toThrow(/bucle de repetición/);
    expect(bucle.llamadas).toHaveLength(1);
    expect((bucle.llamadas[0]?.cuerpo as Cuerpo).generationConfig.maxOutputTokens).toBe(3500);
    const larga = fetchFalso((_, n) => (n === 1 ? respuestaGemini('{"paginas":[{"fisica":1,"texto":"Una nota muy larga', { fin: 'MAX_TOKENS' }) : respuestaGemini(paginasJSON(1, 1))));
    const [p] = await crearGemini({ clave: 'K', fetch: larga.fetch }).lector().leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    expect(p?.confianza).toBeGreaterThan(0.5);
    expect((larga.llamadas[1]?.cuerpo as Cuerpo).generationConfig.maxOutputTokens).toBe(16000);
  });

  it('manda el PDF en línea y pasa por AI Gateway con baseUrl', async () => {
    const pdf = await pdfDePaginas(2);
    const { fetch, llamadas } = fetchFalso(() => respuestaGemini(paginasJSON(1, 2)));
    const g = crearGemini({ clave: 'K', fetch, baseUrl: 'https://gateway.ai.cloudflare.com/v1/C/G/google-ai-studio/' });
    const pags = await g.lector({ maxPaginas: 2 }).leerPliego({ pdf, primeraFisica: 1 });
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
    const pags = await crearGemini({ clave: 'K', fetch }).lector({ maxPaginas: 4 }).leerPliego({ pdf, primeraFisica: 1 });
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

  it('Flash lee sin pensar (presupuesto 0) y, si el modelo no lo admite, baja a minimal y luego a low', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const tc = (ll.cuerpo as Cuerpo).generationConfig.thinkingConfig as Record<string, unknown>;
      if (ll.url.includes('raro') && (tc.thinkingBudget === 0 || tc.thinkingLevel === 'minimal')) return { estado: 400, cuerpo: 'thinking not supported' };
      return respuestaGemini(paginasJSON(1, 1));
    });
    const g = crearGemini({ clave: 'K', fetch });
    await g.lector({ modelo: 'gemini-3.8-flash' }).leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    expect((llamadas[0]?.cuerpo as Cuerpo).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    await g.lector({ modelo: 'gemini-raro' }).leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    expect(llamadas.slice(1).map((l) => (l.cuerpo as Cuerpo).generationConfig.thinkingConfig)).toEqual([{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }]);
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

  it('si Flash-Lite bloquea (PROHIBITED_CONTENT), prueba una vez con Flash y si no, sube el error sin reintentar', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => (ll.url.includes('lite') ? { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } : respuestaGemini('ok')));
    const r = await crearGemini({ clave: 'K', fetch }).redactor().generar({ sistema: 'S', mensajes: [{ rol: 'usuario', partes: [{ texto: 'heroína' }] }] });
    expect(r.texto).toBe('ok');
    expect(llamadas.map((l) => l.url.includes('lite'))).toEqual([true, false]);
    expect((llamadas[0]?.cuerpo as { safetySettings: Array<{ threshold: string }> }).safetySettings[0]?.threshold).toBe('BLOCK_NONE');
    const todo = fetchFalso(() => ({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }));
    await expect(crearGemini({ clave: 'K', fetch: todo.fetch }).redactor().generar({ mensajes: [{ rol: 'usuario', partes: [{ texto: 'x' }] }] })).rejects.toThrow(/bloqueada/);
    expect(todo.llamadas).toHaveLength(2);
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

describe('Gemini · lotes (Batch API)', () => {
  it('envía en línea con la clave codificada y lee las respuestas en línea, al 50 % del precio', async () => {
    const { fetch, llamadas } = fetchFalso((ll, n) => {
      if (ll.url.endsWith(':batchGenerateContent')) return { name: 'batches/abc' };
      if (n === 2) return { name: 'batches/abc', metadata: { state: 'BATCH_STATE_RUNNING' } };
      const reqs = (llamadas[0]?.cuerpo as { batch: { input_config: { requests: { requests: Array<{ metadata: { key: string } }> } } } }).batch.input_config.requests.requests;
      return {
        name: 'batches/abc', done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED' },
        response: { inlinedResponses: { inlinedResponses: [
          { metadata: { key: reqs[0]?.metadata.key }, response: respuestaGemini(paginasJSON(9, 1), { entrada: 1000, salida: 1000 }) },
          { metadata: { key: reqs[1]?.metadata.key }, error: { message: 'interno' } },
        ] } },
      };
    });
    const usos: number[] = [];
    const l = crearGemini({ clave: 'K', fetch, onUso: (u) => usos.push(u.usd ?? 0) }).lotes({ modelo: 'gemini-3.8-flash', maxEnLinea: Infinity });
    const id = await l.enviar([{ clave: 'a|b', entrada: { imagenes: IMG(1), primeraFisica: 9 } }, { clave: 'c', entrada: { imagenes: IMG(1), primeraFisica: 10 } }]);
    expect(id).toBe('batches/abc');
    expect(llamadas[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:batchGenerateContent');
    expect((await l.consultar(id)).estado).toBe('pendiente');
    const r = await l.consultar(id);
    expect(llamadas[2]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/batches/abc');
    expect(r.estado).toBe('listo');
    expect(r.resultados?.['a|b']?.[0]?.fisica).toBe(9);
    expect(r.fallidas).toEqual({ c: 'interno' });
    expect(r.usd).toBeCloseTo((1000 * 0.75 + 1000 * 3.75) / 1e6 / 2);
    await l.consultar(id);
    expect(usos).toHaveLength(1);
  });

  it('por defecto sube un JSONL con la subida reanudable y descarga el fichero de respuestas', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://subida/sesion' } });
      if (ll.url === 'https://subida/sesion') return { file: { name: 'files/entrada', uri: 'https://x/files/entrada' } };
      if (ll.url.endsWith(':batchGenerateContent')) return { name: 'batches/f' };
      if (ll.url.includes('/download/')) {
        const key = (new TextDecoder().decode(llamadas[1]?.crudo as Uint8Array).split('\n')[0] as string);
        return new Response(JSON.stringify({ key: JSON.parse(key).key, response: respuestaGemini(paginasJSON(5, 1)) }) + '\n');
      }
      return { name: 'batches/f', metadata: { state: 'JOB_STATE_SUCCEEDED' }, response: { responsesFile: 'files/salida' } };
    });
    const l = crearGemini({ clave: 'K', fetch }).lotes();
    const id = await l.enviar([{ clave: 'x', entrada: { imagenes: IMG(1), primeraFisica: 5 } }]);
    expect(llamadas[0]?.cabeceras['x-goog-upload-protocol']).toBe('resumable');
    expect((llamadas[2]?.cuerpo as { batch: { input_config: unknown } }).batch.input_config).toEqual({ file_name: 'files/entrada' });
    const r = await l.consultar(id);
    expect(llamadas.at(-1)?.url).toBe('https://generativelanguage.googleapis.com/download/v1beta/files/salida:download?alt=media');
    expect(r.resultados?.x?.[0]?.fisica).toBe(5);
  });

  it('un lote fallido o caducado es «error»', () => {
    expect(interpretarLote({ metadata: { state: 'BATCH_STATE_EXPIRED' } }).estado).toBe('error');
    expect(interpretarLote({ state: 'JOB_STATE_PENDING' }).estado).toBe('pendiente');
  });
});
