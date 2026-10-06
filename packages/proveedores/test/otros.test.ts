import { describe, expect, it } from 'vitest';
import type { Lector, PaginaLeida } from '@scholaris/nucleo';
import { crearWorkersAI, trocearWav, unirWhisper, interpretarChat } from '../src/workersai.js';
import { crearOpenRouter } from '../src/openrouter.js';
import { crearJev } from '../src/jev.js';
import { crearInferBox } from '../src/inferbox.js';
import { cascadaLectores, type PaginaConLector } from '../src/cascada.js';
import { crearInteligencia } from '../src/inteligencia.js';
import { paginaFaltante } from '../src/lectura.js';
import { fetchFalso, IMG, paginasJSON, pdfDePaginas, respuestaGemini } from './falso.js';

function wav(segundos: number, tasa = 16000): Uint8Array {
  const n = segundos * tasa * 2;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  b.set([82, 73, 70, 70], 0); v.setUint32(4, 36 + n, true); b.set([87, 65, 86, 69], 8);
  b.set([102, 109, 116, 32], 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, tasa, true); v.setUint32(28, tasa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  b.set([100, 97, 116, 97], 36); v.setUint32(40, n, true);
  return b;
}

describe('Workers AI', () => {
  it('REST: lector con imágenes, esquema JSON y respuesta en formato OpenAI', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({ success: true, result: { choices: [{ message: { content: paginasJSON(3, 1) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 300 } } }));
    const w = crearWorkersAI({ cuenta: 'C', token: 'T', fetch });
    const [p] = await w.lector().leerPliego({ imagenes: IMG(1), primeraFisica: 3 });
    expect(p?.fisica).toBe(3);
    expect(llamadas[0]?.url).toBe('https://api.cloudflare.com/client/v4/accounts/C/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct');
    expect(llamadas[0]?.cabeceras.authorization).toBe('Bearer T');
    const c = llamadas[0]?.cuerpo as { response_format: { type: string }; messages: Array<{ content: Array<{ type: string }> }> };
    expect(c.response_format.type).toBe('json_schema');
    expect(c.messages[0]?.content.map((x) => x.type)).toEqual(['text', 'text', 'image_url']);
    expect(w.contador.total().usd).toBeCloseTo((900 * 0.27 + 300 * 0.85) / 1e6);
  });

  it('el lector rechaza un PDF si el modelo no lo admite (la cascada pasa al siguiente)', async () => {
    const { fetch } = fetchFalso(() => ({ success: true, result: {} }));
    await expect(crearWorkersAI({ cuenta: 'C', token: 'T', fetch }).lector().leerPliego({ pdf: await pdfDePaginas(1), primeraFisica: 1 })).rejects.toThrow(/necesita imágenes/);
  });

  it('binding: usa env.AI.run y entiende la respuesta antigua con objeto JSON', async () => {
    const vistos: string[] = [];
    const AI = { run: async (modelo: string) => { vistos.push(modelo); return { response: JSON.parse(paginasJSON(1, 1)), usage: { prompt_tokens: 1, completion_tokens: 1 } }; } };
    const [p] = await crearWorkersAI({ binding: AI }).lector({ modelo: '@cf/meta/llama-4-scout-17b-16e-instruct' }).leerPliego({ imagenes: IMG(1), primeraFisica: 1 });
    expect(p?.texto).toMatch(/Texto de la página 1/);
    expect(vistos).toEqual(['@cf/meta/llama-4-scout-17b-16e-instruct']);
    expect(interpretarChat({ response: 'hola' }).texto).toBe('hola');
  });

  it('binding: reintenta errores de capacidad', async () => {
    let n = 0;
    const AI = { run: async () => { if (++n < 3) throw new Error('3040: Capacity temporarily exceeded'); return { response: [{ id: 0, score: 0.9 }] }; } };
    const s = await crearWorkersAI({ binding: AI, esperaBase: 1 }).reordenador().reordenar('q', ['a']);
    expect(s).toEqual([0.9]);
    expect(n).toBe(3);
  });

  it('transcriptor: trocea un WAV largo y une palabras con su desfase', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({ success: true, result: { text: 'hola', transcription_info: { duration: 5, language: 'es' }, segments: [{ start: 1, end: 2, text: 'hola', words: [{ word: ' hola', start: 1, end: 1.5 }] }] } }));
    const t = await crearWorkersAI({ cuenta: 'C', token: 'T', fetch }).transcriptor({ segundosTrozo: 5 }).transcribir({ bytes: wav(12), mime: 'audio/wav', desplazamiento: 100 }, { idioma: 'es-ES' });
    expect(llamadas).toHaveLength(3);
    expect((llamadas[0]?.cuerpo as { language: string }).language).toBe('es');
    expect(t.palabras.map((p) => p.t0)).toEqual([101, 106, 111]);
    expect(t.idioma).toBe('es');
  });

  it('trocearWav devuelve null si no es WAV y conserva el total de muestras', () => {
    expect(trocearWav(new Uint8Array(100), 5)).toBeNull();
    const tr = trocearWav(wav(12), 5) ?? [];
    expect(tr.map((t) => t.inicio)).toEqual([0, 5, 10]);
    expect(tr.reduce((s, t) => s + t.bytes.length - 44, 0)).toBe(12 * 16000 * 2);
  });

  it('whisper sin palabras reparte el segmento', () => {
    const t = unirWhisper([{ r: { text: 'a b', segments: [{ start: 0, end: 2, text: 'a b' }] }, inicio: 0 }], 0);
    expect(t.palabras).toEqual([{ texto: 'a', t0: 0, t1: 1 }, { texto: 'b', t0: 1, t1: 2 }]);
  });

  it('reordenador y embebedor qwen3 (consultas vs documentos)', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('bge-reranker-base')) return { success: true, result: { response: [{ id: 1, score: 0.8 }, { id: 0, score: 0.1 }] } };
      const c = ll.cuerpo as { queries?: string[]; documents?: string[] };
      const n = (c.queries ?? c.documents ?? []).length;
      return { success: true, result: { data: Array.from({ length: n }, () => [3, 4]), shape: [n, 2] } };
    });
    const w = crearWorkersAI({ cuenta: 'C', token: 'T', fetch });
    expect(await w.reordenador().reordenar('q', ['a', 'b'])).toEqual([0.1, 0.8]);
    const e = w.embebedor({ dims: 2 });
    expect(e.espacio.id).toBe('qwen3-embedding-0.6b@2');
    const [v] = await e.vectorizar([{ modalidad: 'texto', texto: 'x' }], 'consulta');
    expect(Array.from(v as Float32Array)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    await e.vectorizar([{ modalidad: 'texto', texto: 'x' }], 'documento');
    expect(Object.keys(llamadas[1]?.cuerpo as object)).toEqual(['queries']);
    expect(Object.keys(llamadas[2]?.cuerpo as object)).toEqual(['documents']);
  });
});

describe('OpenRouter', () => {
  it('lector: PDF por el plugin file-parser con mistral-ocr, coste real de usage.cost', async () => {
    const pdf = await pdfDePaginas(2);
    const { fetch, llamadas } = fetchFalso(() => ({ model: 'google/gemini-3.5-flash-lite', choices: [{ message: { content: paginasJSON(1, 2) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0042 } }));
    const o = crearOpenRouter({ clave: 'K', fetch });
    const l = o.lector();
    expect(l.nombre).toBe('openrouter:mistral-ocr+google/gemini-3.5-flash-lite');
    const pags = await l.leerPliego({ pdf, primeraFisica: 1 });
    expect(pags).toHaveLength(2);
    const c = llamadas[0]?.cuerpo as { plugins: unknown; usage: unknown; messages: Array<{ content: Array<{ type: string }> }> };
    expect(c.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]);
    expect(c.usage).toEqual({ include: true });
    expect(c.messages[0]?.content[0]?.type).toBe('file');
    expect(llamadas[0]?.cabeceras.authorization).toBe('Bearer K');
    expect(o.contador.total().usd).toBe(0.0042);
  });

  it('redactor con json_schema estricto y sistema', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({ choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }));
    const r = await crearOpenRouter({ clave: 'K', fetch }).redactor().generar<{ a: number }>({ sistema: 'S', mensajes: [{ rol: 'usuario', partes: [{ texto: 'x' }] }], esquema: { type: 'object' }, calidad: 'alta' });
    expect(r.json?.a).toBe(1);
    const c = llamadas[0]?.cuerpo as { model: string; messages: Array<{ role: string }>; response_format: { json_schema: { strict: boolean } } };
    expect(c.model).toBe('google/gemini-3.8-flash');
    expect(c.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(c.response_format.json_schema.strict).toBe(true);
  });
});

describe('Jev', () => {
  it('juez: traduce los tres tipos y manda todas las preguntas en una petición', async () => {
    const { fetch, llamadas } = fetchFalso(() => ({
      model: 'jev-1.13.0',
      answers: {
        q0: { type: 'noul', noul: 0.9 },
        q1: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 }, confidence: 0.6 },
        q2: { type: 'score', score: 1.7, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 }, legend: {} },
      },
      usage: { input_tokens: 400, output_tokens: 20 },
    }));
    const j = crearJev({ clave: 'K', fetch });
    const r = await j.juez().juzgar({ claim: 'x' }, {
      respalda: { tipo: 'si_no', instrucciones: '¿Respalda?', criterios: { si: 'sí', no: 'no' } },
      cual: { tipo: 'eleccion', instrucciones: '¿Cuál?', opciones: { a: null, b: 'la b' } },
      grado: { tipo: 'escala', instrucciones: '¿Cuánto?', niveles: ['nada', 'algo', 'mucho'] },
    });
    expect(r).toEqual({
      respalda: { tipo: 'si_no', probabilidad: 0.9 },
      cual: { tipo: 'eleccion', probabilidades: { a: 0.2, b: 0.8 }, eleccion: 'b' },
      grado: { tipo: 'escala', valor: 1.7, probabilidades: [0.1, 0.1, 0.8] },
    });
    expect(llamadas).toHaveLength(1);
    const c = llamadas[0]?.cuerpo as { model: string; questions: Record<string, { type: string; criteria: unknown }> };
    expect(llamadas[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(c.model).toBe('jev-latest');
    expect(c.questions.q0).toEqual({ type: 'noul', instructions: '¿Respalda?', criteria: { true: 'sí', false: 'no' } });
    expect(c.questions.q2?.criteria).toEqual(['nada', 'algo', 'mucho']);
    expect(j.contador.total().usd).toBeCloseTo((400 * 0.042) / 1e6);
  });

  it('reordenador: una pregunta Noul por pasaje, en lotes', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      const qs = (ll.cuerpo as { questions: Record<string, unknown> }).questions;
      return { answers: Object.fromEntries(Object.keys(qs).map((k) => [k, { type: 'noul', noul: Number(k.slice(1)) / 10 }])), usage: { input_tokens: 10 } };
    });
    const s = await crearJev({ clave: 'K', fetch }).reordenador({ pasajesPorPeticion: 3 }).reordenar('q', ['a', 'b', 'c', 'd', 'e']);
    expect(s).toEqual([0, 0.1, 0.2, 0, 0.1]);
    expect(llamadas).toHaveLength(2);
    const c = llamadas[0]?.cuerpo as { state: { query: string; passages: Record<string, string> }; questions: Record<string, { instructions: string }> };
    expect(c.state).toEqual({ query: 'q', passages: { p0: 'a', p1: 'b', p2: 'c' } });
    expect(c.questions.p1?.instructions).toContain('`passages.p1`');
  });
});

describe('InferBox', () => {
  it('embed (texto e imagen por separado), rerank, transcribe multipart y chat', async () => {
    const { fetch, llamadas } = fetchFalso((ll) => {
      if (ll.url.endsWith('/v1/embed')) return { embeddings: (ll.cuerpo as { input: string[] }).input.map(() => Array.from({ length: 2048 }, () => 1)) };
      if (ll.url.endsWith('/v1/rerank')) return { results: [{ index: 1, score: 0.7 }, { index: 0, score: 0.2 }] };
      if (ll.url.endsWith('/v1/transcribe')) return { text: 'hola', language: 'es', segments: [{ start: 0, end: 1, text: 'hola' }] };
      if (ll.url.endsWith('/v1/health')) return { status: 'ok' };
      return { choices: [{ message: { content: '{"x":2}' } }] };
    });
    const ib = crearInferBox({ url: 'http://caja:8811/', clave: 'K', fetch });
    expect(await ib.salud()).toBe(true);
    const e = ib.embebedor();
    expect(e.espacio.id).toBe('qwen3-vl-embedding-2b@2048');
    const v = await e.vectorizar([{ modalidad: 'texto', texto: 'a' }, { modalidad: 'imagen', bytes: new Uint8Array([1]), mime: 'image/png' }], 'documento');
    expect(v.map((x) => x.length)).toEqual([2048, 2048]);
    const cuerpos = llamadas.filter((l) => l.url.endsWith('/v1/embed')).map((l) => l.cuerpo as { instruction: string; images?: string[] });
    expect(cuerpos.map((c) => c.instruction)).toEqual(['Represent this document passage for retrieval.', 'Represent this image for visual similarity search.']);
    expect(llamadas[1]?.cabeceras['x-api-key']).toBe('K');
    expect(await ib.reordenador().reordenar('q', ['a', 'b'])).toEqual([0.2, 0.7]);
    const t = await ib.transcriptor().transcribir({ bytes: new Uint8Array([1]), mime: 'audio/wav' });
    expect(t.palabras).toEqual([{ texto: 'hola', t0: 0, t1: 1 }]);
    expect(llamadas.find((l) => l.url.endsWith('/v1/transcribe'))?.crudo).toBeInstanceOf(FormData);
    const r = await ib.redactor().generar<{ x: number }>({ mensajes: [{ rol: 'usuario', partes: [{ texto: 'h' }] }], esquema: { type: 'object' } });
    expect(r.json?.x).toBe(2);
    await expect(e.vectorizar([{ modalidad: 'audio', bytes: new Uint8Array(), mime: 'audio/wav' }], 'documento')).rejects.toThrow(/no vectoriza/);
  });
});

describe('cascada de lectores', () => {
  const lectorFijo = (nombre: string, fn: (fisica: number) => Partial<PaginaLeida> | 'error'): Lector & { vistos: number[][] } => {
    const vistos: number[][] = [];
    return {
      nombre, vistos,
      async leerPliego(e) {
        const n = e.imagenes?.length ?? 0;
        const fisicas = Array.from({ length: n }, (_, i) => e.primeraFisica + i);
        vistos.push(fisicas);
        if (fisicas.some((f) => fn(f) === 'error')) throw new Error('caído');
        return fisicas.map((f) => ({ ...paginaFaltante(f), confianza: 0.9, ...(fn(f) as Partial<PaginaLeida>) }));
      },
    };
  };

  it('solo pasa al siguiente las páginas que no superan la calidad, y anota quién leyó cada una', async () => {
    const a = lectorFijo('a', (f) => (f === 3 ? { texto: '', confianza: 0.5 } : { texto: `Página ${f} leída con buen texto.` }));
    const b = lectorFijo('b', (f) => ({ texto: `Página ${f} releída por b.` }));
    const avisos: string[] = [];
    const pags = (await cascadaLectores([a, b], { alPasar: (i) => avisos.push(`${i.lector}:${i.paginas.join(',')}`) }).leerPliego({ imagenes: IMG(4), primeraFisica: 1 })) as PaginaConLector[];
    expect(pags.map((p) => p.lector)).toEqual(['a', 'a', 'b', 'a']);
    expect(pags[2]?.intentos).toEqual(['a', 'b']);
    expect(b.vistos).toEqual([[3]]);
    expect(avisos).toEqual(['a:3']);
  });

  it('si un lector falla, el pliego entero pasa al siguiente; si todos fallan, se queda el mejor intento', async () => {
    const a = lectorFijo('a', () => 'error');
    const b = lectorFijo('b', (f) => ({ texto: f === 2 ? '' : 'Texto suficiente aquí.', confianza: 0.9 }));
    const pags = (await cascadaLectores([a, b]).leerPliego({ imagenes: IMG(2), primeraFisica: 1 })) as PaginaConLector[];
    expect(b.vistos).toEqual([[1, 2]]);
    expect(pags.map((p) => p.lector)).toEqual(['b', 'b']);
  });

  it('con PDF, recorta solo las páginas que hay que repetir', async () => {
    const pdf = await pdfDePaginas(3);
    const vistos: number[] = [];
    const a: Lector = { nombre: 'a', leerPliego: async (e) => [1, 2, 3].map((f) => ({ ...paginaFaltante(f), confianza: 0.9, texto: f === 2 ? '▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓' : 'Texto correcto de sobra.' })) };
    const b: Lector = { nombre: 'b', leerPliego: async (e) => { const { contarPaginasPdf } = await import('../src/pdf.js'); vistos.push(e.primeraFisica, await contarPaginasPdf(e.pdf as Uint8Array)); return [{ ...paginaFaltante(2), confianza: 0.9, texto: 'Ahora sí, texto bueno.' }]; } };
    const pags = (await cascadaLectores([a, b]).leerPliego({ pdf, primeraFisica: 1 })) as PaginaConLector[];
    expect(vistos).toEqual([2, 1]);
    expect(pags[1]?.texto).toBe('Ahora sí, texto bueno.');
  });
});

describe('crearInteligencia', () => {
  it('monta todo con las claves del entorno y avisa del uso', async () => {
    const { fetch } = fetchFalso((ll) => {
      if (ll.url.includes('batchEmbedContents')) return { embeddings: [{ values: [1, 0, 0] }], usageMetadata: { promptTokenCount: 3 } };
      if (ll.url.includes('typesafe')) return { answers: { p0: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 5 } };
      return respuestaGemini('{}');
    });
    const usos: string[] = [];
    const intel = crearInteligencia({ GEMINI_API_KEY: 'G', TYPESAFE_API_KEY: 'T', OPENROUTER_API_KEY: 'O', CLOUDFLARE_ACCOUNT_ID: 'C', CLOUDFLARE_API_TOKEN: 'X' }, { fetch, onUso: (u) => usos.push(u.proveedor) });
    expect(intel.lector.nombre).toContain('cascada(gemini:gemini-3.8-flash → gemini:gemini-3.5-flash-lite → openrouter:mistral-ocr+');
    expect(intel.embebedor.espacio.id).toBe('gemini-embedding-2@1536');
    expect(intel.transcriptor.nombre).toBe('workers-ai:@cf/openai/whisper-large-v3-turbo | gemini:gemini-3.5-transcribe');
    expect(intel.juez.nombre).toBe('jev:jev-latest');
    await intel.embebedor.vectorizar([{ modalidad: 'texto', texto: 'a' }], 'consulta');
    expect(await intel.reordenador.reordenar('q', ['a'])).toEqual([0.8]);
    expect(usos).toEqual(['gemini', 'jev']);
    expect(intel.contador.total().llamadas).toBe(2);
  });

  it('sin Jev, el juez avisa al usarlo; sin ningún lector, falla al crear', async () => {
    const intel = crearInteligencia({ GEMINI_API_KEY: 'G', INFERBOX_URL: 'http://caja', INFERBOX_API_KEY: 'K' });
    expect(intel.embebedoresExtra?.[0]?.espacio.id).toBe('qwen3-vl-embedding-2b@2048');
    expect(() => intel.juez.juzgar({}, {})).toThrow(/falta TYPESAFE_API_KEY/);
    expect(() => crearInteligencia({})).toThrow(/ningún lector/);
    const eco = crearInteligencia({ GEMINI_API_KEY: 'G', CLOUDFLARE_ACCOUNT_ID: 'C', CLOUDFLARE_API_TOKEN: 'X' }, { lotes: true });
    expect(eco.lotes?.nombre).toBe('gemini-lotes:gemini-3.8-flash');
    expect(eco.lectorEconomico?.nombre).toBe('workers-ai:@cf/meta/llama-4-scout-17b-16e-instruct');
  });
});
