import { describe, expect, it } from 'vitest';
import { crearOpenAICompatible, dimensionesDe, interpretarWhisperOpenAI, probabilidadesLetras } from '../src/compatible.js';
import { configuracionSinConexion, crearInteligenciaSinConexion, deducirSabor, esAnfitrionLocal, esUrlLocal } from '../src/sin-conexion.js';
import { crearInteligencia } from '../src/inteligencia.js';
import { fetchFalso, IMG, paginasJSON, pdfDePaginas } from './falso.js';

const chatOk = (contenido: string, extra: Record<string, unknown> = {}) => ({ choices: [{ message: { content: contenido }, finish_reason: 'stop', ...extra }], usage: { prompt_tokens: 1200, completion_tokens: 300 }, model: 'qwen2.5vl:7b' });

describe('servidor compatible con OpenAI', () => {
  it('lector: una página por llamada, imagen + esquema JSON, folio y notas como el de Gemini', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const c = ll.cuerpo as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
      const fisica = Number(/páginas físicas (\d+)/.exec(c.messages[0]!.content[1]!.text!)?.[1]);
      return chatOk(paginasJSON(fisica, 1, () => ({ notas: ['1 Nota al pie.'], folio: String(fisica + 10) })));
    });
    const c = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', fetch });
    const paginas = await c.lector().leerPliego({ imagenes: IMG(3), primeraFisica: 5 });
    expect(paginas.map((p) => p.fisica)).toEqual([5, 6, 7]);
    expect(paginas.map((p) => p.folio)).toEqual(['15', '16', '17']);
    expect(paginas[0]?.notas).toEqual(['1 Nota al pie.']);
    expect(llamadas).toHaveLength(3);
    const cuerpo = llamadas[0]!.cuerpo as Record<string, unknown> & { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> };
    expect(llamadas[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(cuerpo.model).toBe('qwen3-vl:8b-instruct');
    expect((cuerpo.response_format as { type: string }).type).toBe('json_schema');
    expect(cuerpo.think).toBe(false);
    expect(cuerpo.messages[0]!.content[0]!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(c.contador.total().usd).toBe(0);
  });

  it('lector: un PDF pasa por «rasterizar»; sin él, error claro', async () => {
    const { fetch } = fetchFalso(() => chatOk(JSON.stringify({ fisica: 1, vacia: false, cabecera: '', folio: '3', titulos: [], texto: 'Texto suelto de una página leída por el modelo local.', notas: [], pie: '', figuras: [], idioma: 'es', confianza: 0.9 })));
    const pdf = await pdfDePaginas(2);
    const sin = crearOpenAICompatible({ url: 'http://127.0.0.1:8080', sabor: 'llamacpp', modelos: { lector: 'qwen' }, fetch });
    await expect(sin.lector().leerPliego({ pdf, primeraFisica: 1 })).rejects.toThrow(/necesita imágenes/);
    let rasterizadas = 0;
    const con = crearOpenAICompatible({ url: 'http://127.0.0.1:8080', sabor: 'llamacpp', modelos: { lector: 'qwen' }, fetch, rasterizar: async () => { rasterizadas++; return IMG(2); } });
    const p = await con.lector().leerPliego({ pdf, primeraFisica: 1 });
    expect(rasterizadas).toBe(1);
    // Un objeto de página suelto (sin «paginas») también vale.
    expect(p.map((x) => [x.fisica, x.folio])).toEqual([[1, '3'], [2, '3']]);
  });

  it('lector: corta en streaming una página que entra en bucle (sin esperar a max_tokens)', async () => {
    let enviados = 0;
    const fetch = (async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const enc = new TextEncoder();
      const cuerpo = new ReadableStream<Uint8Array>({
        async pull(c) {
          if (signal.aborted || enviados > 2000) { c.close(); return; }
          enviados++;
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: enviados === 1 ? '{"fisica": 1, "texto": "' : 'Cel. Voi a llevar la respuesta,\\n' } }] })}\n\n`));
        },
      });
      return new Response(cuerpo, { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof globalThis.fetch;
    const c = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', fetch });
    // Se corta, se repite una vez con aviso y, si sigue en bucle, queda como página faltante (confianza 0).
    const [p] = await c.lector().leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    expect(p).toMatchObject({ fisica: 1, texto: '', confianza: 0 });
    expect(enviados).toBeLessThan(400);
  });

  it('si el servidor rechaza json_schema, repite con json_object y lo recuerda', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const rf = (ll.cuerpo as { response_format?: { type: string } }).response_format;
      if (rf?.type === 'json_schema') return { estado: 400, cuerpo: { error: { message: 'response_format json_schema not supported' } } };
      return chatOk('```json\n{"titulo": "Rimas"}\n```');
    });
    const r = crearOpenAICompatible({ url: 'http://192.168.1.20:8000/v1', sabor: 'generico', modelos: { redactor: 'm' }, fetch }).redactor();
    expect((await r.generar<{ titulo: string }>({ mensajes: [{ rol: 'usuario', partes: [{ texto: 'x' }] }], esquema: { type: 'object' } })).json?.titulo).toBe('Rimas');
    await r.generar({ mensajes: [{ rol: 'usuario', partes: [{ texto: 'y' }] }], esquema: { type: 'object' } });
    expect(llamadas.map((l) => (l.cuerpo as { response_format: { type: string } }).response_format.type)).toEqual(['json_schema', 'json_object', 'json_object']);
  });

  it('embebedor de texto: /v1/embeddings, prefijos de tarea, dimensiones comprobadas', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const input = (ll.cuerpo as { input: string[] }).input;
      return { data: input.map((_, i) => ({ index: i, embedding: Array.from({ length: 768 }, (_, k) => (k === i ? 1 : 0.01)) })) };
    });
    const e = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', modelos: { embebedor: 'nomic-embed-text' }, fetch }).embebedor();
    expect(e.espacio).toMatchObject({ id: 'local:nomic-embed-text@768', dims: 768 });
    const v = await e.vectorizar([{ modalidad: 'texto', texto: 'hola' }, { modalidad: 'texto', texto: 'adiós' }], 'consulta');
    expect(v).toHaveLength(2);
    expect(v[0]!.length).toBe(768);
    expect((llamadas[0]!.cuerpo as { input: string[] }).input[0]).toBe('search_query: hola');
    await expect(e.vectorizar([{ modalidad: 'imagen', bytes: new Uint8Array(1), mime: 'image/png' }], 'documento')).rejects.toThrow(/solo vectoriza texto/);
    expect(dimensionesDe('bge-m3:latest')).toBe(1024);
    expect(dimensionesDe('qwen3-embedding:0.6b')).toBe(1024);
  });

  it('EmbeddingGemma 2: espacio canónico, prefijos de tarea y Matryoshka (768 → 256 renormalizado)', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => ({ data: (ll.cuerpo as { input: string[] }).input.map((_, i) => ({ index: i, embedding: Array.from({ length: 768 }, (_, k) => (k < 256 ? 0.1 : 0.5)) })) }));
    const c = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', fetch });
    const e768 = c.embebedor();
    expect(e768.espacio).toMatchObject({ id: 'embeddinggemma-2@768', modelo: 'embeddinggemma-2', dims: 768 });
    await e768.vectorizar([{ modalidad: 'texto', texto: 'rimas' }], 'consulta');
    await e768.vectorizar([{ modalidad: 'texto', texto: 'Volverán las oscuras golondrinas' }], 'documento');
    expect((llamadas[0]!.cuerpo as { input: string[] }).input[0]).toBe('task: search result | query: rimas');
    expect((llamadas[1]!.cuerpo as { input: string[] }).input[0]).toBe('title: none | text: Volverán las oscuras golondrinas');
    const e256 = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', fetch, dims: 256 }).embebedor();
    expect(e256.espacio.id).toBe('embeddinggemma-2@256');
    const [v] = await e256.vectorizar([{ modalidad: 'texto', texto: 'x' }], 'documento');
    expect(v!.length).toBe(256);
    expect(Math.hypot(...v!)).toBeCloseTo(1);
    expect((llamadas.at(-1)!.cuerpo as { dimensions?: number }).dimensions).toBe(256);
    expect(() => crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', fetch, dims: 1536 }).embebedor()).toThrow(/768, 512, 256, 128/);
  });

  it('reordenador: /v1/rerank con relevance_score; si da 404, coseno con el embebedor', async () => {
    const { fetch: f1, llamadas: l1 } = fetchFalso(() => ({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] }));
    const r1 = crearOpenAICompatible({ url: 'http://localhost:8080', sabor: 'llamacpp', fetch: f1 }).reordenador();
    expect(await r1.reordenar('q', ['a', 'b'])).toEqual([0.1, 0.9]);
    expect(l1[0]!.url).toBe('http://localhost:8080/v1/rerank');

    const { fetch: f2, llamadas: l2 } = fetchFalso((ll) => {
      if (ll.url.endsWith('/rerank')) return { estado: 404, cuerpo: 'Not Found' };
      const input = (ll.cuerpo as { input: string[] }).input;
      return { data: input.map((t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, (_, k) => (k === 0 ? 1 : t.includes('Bécquer') && k === 1 ? 1 : 0)) })) };
    });
    const c2 = crearOpenAICompatible({ url: 'http://localhost:8000', sabor: 'vllm', modelos: { embebedor: 'bge-m3' }, fetch: f2 });
    const p = await c2.reordenador().reordenar('Bécquer rimas', ['Lope de Vega', 'Bécquer, Rimas']);
    expect(p[1]).toBeGreaterThan(p[0]!);
    await c2.reordenador().reordenar('x', ['y']);
    expect(l2.filter((l) => l.url.endsWith('/rerank'))).toHaveLength(1);

    // Ollama no tiene rerank: ni lo intenta.
    const { fetch: f3, llamadas: l3 } = fetchFalso((ll) => ({ data: (ll.cuerpo as { input: string[] }).input.map((_, i) => ({ index: i, embedding: Array.from({ length: 768 }, () => 1) })) }));
    const r3 = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', fetch: f3 }).reordenador();
    expect(r3.nombre).toBe('ollama:coseno');
    await r3.reordenar('q', ['a']);
    expect(l3.every((l) => l.url.endsWith('/embeddings'))).toBe(true);
  });

  it('transcriptor: /v1/audio/transcriptions verbose_json con palabras', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({ text: 'Volverán las oscuras golondrinas', language: 'spanish', duration: 2.5, words: [{ word: 'Volverán', start: 0, end: 0.6 }, { word: 'las', start: 0.6, end: 0.8 }] }));
    const t = crearOpenAICompatible({ url: 'http://localhost:11434', sabor: 'ollama', urlTranscripcion: 'http://localhost:8000', fetch }).transcriptor();
    const r = await t.transcribir({ bytes: new Uint8Array([1, 2]), mime: 'audio/mpeg', desplazamiento: 10 }, { idioma: 'es-ES' });
    expect(llamadas[0]!.url).toBe('http://localhost:8000/v1/audio/transcriptions');
    const fd = llamadas[0]!.crudo as FormData;
    expect(fd.get('response_format')).toBe('verbose_json');
    expect(fd.getAll('timestamp_granularities[]')).toContain('word');
    expect(fd.get('language')).toBe('es');
    expect(r.idioma).toBe('es');
    expect(r.palabras[0]).toEqual({ texto: 'Volverán', t0: 10, t1: 10.6 });
    // whisper.cpp / InferBox: palabras dentro de los segmentos.
    const s = interpretarWhisperOpenAI({ segments: [{ start: 1, end: 2, text: 'hola mundo' }] }, 0);
    expect(s.palabras.map((p) => p.texto)).toEqual(['hola', 'mundo']);
    // whisper.cpp: piezas de palabra que se unen.
    const w = interpretarWhisperOpenAI({ language: 'es', segments: [{ start: 0, end: 2, text: ' de las ánimas', words: [{ word: ' de', start: 0, end: 0.2 }, { word: ' las', start: 0.2, end: 0.4 }, { word: ' á', start: 0.4, end: 0.6 }, { word: 'nimas,', start: 0.6, end: 1 }] }] }, 5);
    expect(w.palabras.map((p) => p.texto)).toEqual(['de', 'las', 'ánimas,']);
    expect(w.palabras[2]).toMatchObject({ t0: 5.4, t1: 6 });
  });

  it('juez: probabilidades de los logprobs de la letra; sin logprobs, la elección restringida', async () => {
    const { fetch } = fetchFalso(() => chatOk('{"respuesta":"A"}', {
      logprobs: { content: [
        { token: '{"', logprob: 0, top_logprobs: [{ token: '{"', logprob: 0 }] },
        { token: 'A', logprob: Math.log(0.75), top_logprobs: [{ token: 'A', logprob: Math.log(0.75) }, { token: 'B', logprob: Math.log(0.25) }] },
      ] },
    }));
    const j = crearOpenAICompatible({ url: 'http://localhost:8080', sabor: 'llamacpp', modelos: { juez: 'qwen3' }, fetch }).juez();
    const r = await j.juzgar({ pasaje: 'x' }, {
      a: { tipo: 'si_no', instrucciones: '¿Sirve?', criterios: { si: 'sí', no: 'no' } },
      b: { tipo: 'eleccion', instrucciones: '¿Cuál?', opciones: { apoya: null, contradice: null } },
      c: { tipo: 'escala', instrucciones: '¿Cuánto?', niveles: ['nada', 'mucho'] },
    });
    expect((r.a as { probabilidad: number }).probabilidad).toBeCloseTo(0.75);
    expect(r.b).toMatchObject({ tipo: 'eleccion', eleccion: 'apoya' });
    expect((r.c as { valor: number }).valor).toBeCloseTo(0.25);
    expect(probabilidadesLetras({ texto: '{"respuesta":"B"}' }, ['A', 'B'])).toEqual([0, 1]);
    expect(probabilidadesLetras({ texto: 'nada' }, ['A', 'B'])).toEqual([0.5, 0.5]);
  });
});

describe('modo sin conexión', () => {
  it('direcciones locales', () => {
    for (const h of ['localhost', '127.0.0.1', '::1', '10.0.0.5', '172.20.1.1', '192.168.1.102', '100.64.0.1', 'ollama', 'inferbox', 'nas.local', 'host.docker.internal', 'fd12:3456::1']) expect(esAnfitrionLocal(h), h).toBe(true);
    for (const h of ['api.openalex.org', '8.8.8.8', '172.32.0.1', 'generativelanguage.googleapis.com', 'example.com', '2001:4860::8888']) expect(esAnfitrionLocal(h), h).toBe(false);
    expect(esUrlLocal('https://gpu.mi-casa.es', ['gpu.mi-casa.es'])).toBe(true);
    expect(deducirSabor('http://localhost:11434')).toBe('ollama');
    expect(deducirSabor('http://192.168.1.102:8811')).toBe('inferbox');
  });

  it('se niega a arrancar con una URL de internet', () => {
    expect(() => configuracionSinConexion({ INFERENCIA_URL: 'https://api.openai.com/v1' })).toThrow(/no es una dirección local/);
    expect(() => configuracionSinConexion({})).toThrow(/falta INFERENCIA_URL/);
    expect(configuracionSinConexion({ INFERBOX_URL: 'http://192.168.1.102:8811', INFERBOX_API_KEY: 'k' })).toMatchObject({ sabor: 'inferbox', clave: 'k' });
  });

  it('crearInteligencia con SCHOLARIS_SIN_CONEXION=1 ignora las claves de nube y solo llama al servidor local', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/embeddings')) return { data: (ll.cuerpo as { input: string[] }).input.map((_, i) => ({ index: i, embedding: Array.from({ length: 768 }, () => 0.5) })) };
      return chatOk(paginasJSON(1, 1));
    });
    const ia = crearInteligencia({
      SCHOLARIS_SIN_CONEXION: '1', INFERENCIA_URL: 'http://localhost:11434',
      GEMINI_API_KEY: 'no-se-usa', OPENROUTER_API_KEY: 'no-se-usa', TYPESAFE_API_KEY: 'no-se-usa', CLOUDFLARE_ACCOUNT_ID: 'x', CLOUDFLARE_API_TOKEN: 'y',
    }, { fetch });
    expect(ia.lector.nombre).toBe('ollama:qwen3-vl:8b-instruct');
    expect(ia.embebedor.espacio.id).toBe('embeddinggemma-2@768');
    expect(ia.reordenador.nombre).toBe('ollama:coseno');
    await ia.lector.leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    await ia.embebedor.vectorizar([{ modalidad: 'texto', texto: 'x' }], 'documento');
    await ia.reordenador.reordenar('q', ['a']);
    await ia.redactor.generar({ mensajes: [{ rol: 'usuario', partes: [{ texto: 'x' }] }] });
    expect(llamadas.length).toBeGreaterThan(3);
    expect(llamadas.every((l) => l.url.startsWith('http://localhost:11434/'))).toBe(true);
    expect(llamadas.every((l) => !l.cabeceras.authorization)).toBe(true);
  });

  it('InferBox: embebedor Qwen3-VL @2048, rerank y transcribe propios', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/v1/embed')) return { embeddings: [Array.from({ length: 2048 }, () => 1)] };
      if (ll.url.endsWith('/v1/rerank')) return { results: [{ index: 0, score: 0.7 }] };
      return {};
    });
    const ia = crearInteligenciaSinConexion({ SCHOLARIS_SIN_CONEXION: '1', INFERBOX_URL: 'http://192.168.1.102:8811', INFERBOX_API_KEY: 'k', INFERENCIA_MODELO_EMBEBEDOR: 'qwen3-vl-embed' }, { fetch });
    expect(ia.embebedor.espacio.id).toBe('qwen3-vl-embedding-2b@2048');
    await ia.embebedor.vectorizar([{ modalidad: 'texto', texto: 'x' }], 'consulta');
    expect(await ia.reordenador.reordenar('q', ['a'])).toEqual([0.7]);
    expect(llamadas.map((l) => l.url)).toEqual(['http://192.168.1.102:8811/v1/embed', 'http://192.168.1.102:8811/v1/rerank']);
    expect(llamadas[0]!.cabeceras['x-api-key']).toBe('k');
  });

  it('EmbeddingGemma 2 multimodal por /v1/embed: texto, imagen, audio y vídeo en un espacio, tarea solo en el texto', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => ({ embeddings: (ll.cuerpo as { input: string[] }).input.map(() => Array.from({ length: 768 }, () => 1)) }));
    const ia = crearInteligenciaSinConexion({ SCHOLARIS_SIN_CONEXION: '1', INFERENCIA_URL: 'http://localhost:11434', INFERENCIA_EMBEBEDOR_URL: 'http://localhost:8812' }, { fetch });
    expect(ia.embebedor.espacio).toMatchObject({ id: 'embeddinggemma-2@768', modalidades: ['texto', 'imagen', 'audio', 'video'] });
    const v = await ia.embebedor.vectorizar([
      { modalidad: 'texto', texto: 'golondrinas' },
      { modalidad: 'imagen', bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg' },
      { modalidad: 'audio', bytes: new Uint8Array([1]), mime: 'audio/mpeg' },
      { modalidad: 'video', bytes: new Uint8Array([2]), mime: 'video/mp4' },
    ], 'consulta');
    expect(v).toHaveLength(4);
    expect(llamadas[0]!.url).toBe('http://localhost:8812/v1/embed');
    const c = llamadas[0]!.cuerpo as { input: string[]; images: Array<string | null>; audio: Array<string | null>; video: Array<string | null>; task: string };
    expect(c.task).toBe('consulta');
    expect(c.input).toEqual(['golondrinas', '', '', '']);
    expect(c.images[1]).toMatch(/^data:image\/jpeg;base64,/);
    expect(c.audio[2]).toMatch(/^data:audio\/mpeg;base64,/);
    expect(c.video[3]).toMatch(/^data:video\/mp4;base64,/);
    expect(() => configuracionSinConexion({ INFERENCIA_URL: 'http://localhost:11434', INFERENCIA_EMBEBEDOR_URL: 'https://embed.example.com' })).toThrow(/no es una dirección local/);
  });
});
