import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anclaDePaginaImpresa, anclasEnProsa, esFraseSobreLaFalta, frasesConCitas, juzgarCitas, paresDeCitas, type Mirador } from './citas.js';
import { preguntarInvestigar, preguntarResponder } from './clientes.js';
import { completarFuentes, contenidoDe, contieneCita, crearFuentes, type DocumentoFuente } from './fuentes.js';
import { juzgarPregunta, juzgarRubrica } from './juez.js';
import { juezConCache, type ModeloJuez, type PeticionJuez } from './modelo.js';
import { erroresDeForma } from './preguntas.js';
import { acuerdo, agregar, puntuar } from './puntuar.js';
import type { Banco, Pregunta, RespuestaNormalizada } from './tipos.js';

// ---------------------------------------------------------------------------
// Fuentes de juguete: un cuento en pliegos de dos páginas y una película.
// ---------------------------------------------------------------------------

const pag = (fisica: number, impresa: string | null) => ({ tipo: 'pagina' as const, fisica, impresa, romana: false, origen: 'leido' as const, confianza: 1 });
const CUENTO: DocumentoFuente = {
  id: 'cuento', titulo: 'El cuento', tipo: 'pdf_escaneado',
  unidades: [
    { orden: 0, etiqueta: 'p. [1]', ancla: pag(1, null), texto: 'EL LOBO, EL BOSQUE' },
    { orden: 1, etiqueta: 'p. 4', ancla: pag(2, '4'), texto: 'Nos conocimos en Coppelia, y habiendo chocolate, había pedido fresa.' },
    { orden: 2, etiqueta: 'p. 6', ancla: pag(3, '6'), texto: 'Tropezó y me derramó encima un poco de leche. La tendió en el balcón junto a un mantón de Manila.' },
  ],
};
const tiempo = (t0: number, t1: number) => ({ tipo: 'tiempo' as const, t0, t1 });
const PELI: DocumentoFuente = {
  id: 'peli', titulo: 'La película', tipo: 'video', duracion: 600,
  unidades: [
    { orden: 0, etiqueta: '1:00-1:30', ancla: tiempo(60, 90), texto: '**Diego:** Me encanta la fresa. Es lo único bueno que hacen en este país.' },
    { orden: 1, etiqueta: '5:00-5:20', ancla: tiempo(300, 320), texto: '**Diego:** Primero el café, que se enfría.' },
  ],
};
const fuentes = crearFuentes([CUENTO, PELI]);

const PREGUNTA: Pregunta = {
  id: 'q01', pregunta: '¿Qué pide Diego?', idioma: 'es', categorias: ['transmedia'], dificultad: 3, documentos: ['cuento', 'peli'],
  rubrica: {
    puntos: [
      { id: 'q01.1', afirmacion: 'Pide fresa habiendo chocolate.', obligatorio: true, anclas: [{ documento: 'cuento', fisica: 2, impresa: '5', cita: 'habiendo chocolate, había pedido fresa' }], verificacion: 'texto' },
      { id: 'q01.2', afirmacion: 'En la película dice que le encanta la fresa.', obligatorio: true, anclas: [{ documento: 'peli', t0: 60, t1: 90, cita: 'Me encanta la fresa.' }], verificacion: 'transcripcion' },
      { id: 'q01.3', afirmacion: 'Detalle opcional.', obligatorio: false, anclas: [{ documento: 'peli', t0: 300, t1: 320, que: 'café' }], verificacion: 'visual-doble', comprobacion: ['a (gemini-4-argon)', 'b (gemini-3.1-pro-preview)'] },
    ],
    trampas: ['Diego pide chocolate.'],
  },
};

function respuesta(markdown: string, citas: RespuestaNormalizada['citas'] = []): RespuestaNormalizada {
  return { modo: 'responder', preguntaId: 'q01', markdown, citas, ms: 1000, fecha: '2026-11-04T00:00:00Z' };
}

/** Un juez falso: responde con lo que diga la función y cuenta las llamadas. */
function juezFalso(f: (p: PeticionJuez) => unknown, usd = 0.01): ModeloJuez & { llamadas: number } {
  const j = {
    nombre: 'falso', llamadas: 0,
    async json<T>(p: PeticionJuez) { j.llamadas++; return { json: f(p) as T, usd }; },
  };
  return j;
}

// ---------------------------------------------------------------------------

describe('frases y anclas', () => {
  it('lleva las marcas que van tras el punto a su frase y omite la lista de notas', () => {
    const fs = frasesConCitas('Diego pide fresa.[^1] En la película le encanta[^2][^1]. Investigar cita así [E1, E3].\n\n[^1]: Paz, p. 5.\n[E2]: otra');
    expect(fs.map((f) => f.citas)).toEqual([['1'], ['2', '1'], ['E1', 'E3']]);
    expect(fs[0]!.texto).toBe('Diego pide fresa.');
    expect(fs.some((f) => f.texto.includes('Paz, p. 5'))).toBe(false);
  });

  it('reconoce páginas, tramos de tiempo y minutos escritos en la prosa', () => {
    const a = anclasEnProsa('Está en la p. 14, en las pp. 22-23, hacia 1:02:03-1:03:10, a los 9:54 y en el minuto 40.');
    expect(a.map((x) => [x.tipo, x.desde, x.hasta])).toEqual([
      ['pagina', 14, 14], ['pagina', 22, 23], ['tiempo', 3723, 3790], ['tiempo', 594, 614], ['tiempo', 2400, 2459],
    ]);
    // «minuto 1:42:44» es un tramo de tiempo, no el minuto 1.
    expect(anclasEnProsa('en el minuto 1:42:44 al 1:43:30').map((x) => [x.tipo, x.desde, x.hasta])).toEqual([['tiempo', 6164, 6210]]);
  });

  it('resuelve una página impresa al pliego que la contiene y rechaza las que no existen', () => {
    expect(anclaDePaginaImpresa(fuentes, 'cuento', 5)).toMatchObject({ fisica: 2 });
    expect(anclaDePaginaImpresa(fuentes, 'cuento', 6)).toMatchObject({ fisica: 3 });
    expect(anclaDePaginaImpresa(fuentes, 'cuento', 7)).toMatchObject({ fisica: 3 });
    expect(anclaDePaginaImpresa(fuentes, 'cuento', 40)).toBeNull();
  });
});

describe('fuentes', () => {
  it('encuentra citas con erratas de OCR, repeticiones y etiquetas intercaladas', () => {
    expect(contieneCita('Tropezó y me derramó encma un poco de leche.', 'tropezó y me derramó encima un poco de leche')).toBe(true);
    expect(contieneCita('[1:46] Por eso por eso te he pedido un abrazo. [1:47] Porque pensaba', 'Por eso te he pedido un abrazo. Porque pensaba')).toBe(true);
    expect(contieneCita('Nada que ver con el asunto.', 'habiendo chocolate, había pedido fresa')).toBe(false);
  });

  it('junta la transcripción que toca un tramo y marca los tramos sin texto', () => {
    expect(contenidoDe(PELI, tiempo(70, 75)).texto).toContain('Me encanta la fresa');
    const hueco = contenidoDe(PELI, tiempo(150, 200));
    expect(hueco).toMatchObject({ existe: true, sinTexto: true });
    expect(contenidoDe(PELI, tiempo(5000, 5010)).existe).toBe(false);
  });
});

describe('citas', () => {
  it('declara inventadas las anclas fuera del documento y las marcas sin cita', async () => {
    const r = respuesta('En la p. 40 del cuento pide fresa.[^1] Y otra cosa.[^9]', [
      { id: '1', documento: 'cuento', ancla: pag(2, '4'), etiqueta: 'p. 4' },
    ]);
    const j = juezFalso((p) => ({ juicios: p.usuario.includes('FRASES') ? [{ n: 1, veredicto: 'sostiene', visual: false, motivo: 'ok' }] : [] }));
    const { juicios } = await juzgarCitas(r, PREGUNTA, fuentes, j);
    const porCita = Object.fromEntries(juicios.map((x) => [x.cita, x.veredicto]));
    expect(porCita['1']).toBe('sostiene');
    expect(porCita['9']).toBe('inventada');
    expect(porCita['«p. 40»']).toBe('inventada');
  });

  it('agrupa las frases de una misma cita en una sola llamada', async () => {
    const r = respuesta('Pide fresa.[^1] Había chocolate.[^1]', [{ id: '1', documento: 'cuento', ancla: pag(2, '4'), etiqueta: 'p. 4' }]);
    const j = juezFalso(() => ({ juicios: [{ n: 1, veredicto: 'sostiene', visual: false, motivo: '' }, { n: 2, veredicto: 'parcial', visual: false, motivo: '' }] }));
    const { juicios } = await juzgarCitas(r, PREGUNTA, fuentes, j);
    expect(j.llamadas).toBe(1);
    expect(juicios.map((x) => x.veredicto)).toEqual(['sostiene', 'parcial']);
  });

  it('manda lo visual al mirador y, sin mirador, lo deja sin comprobar', async () => {
    const r = respuesta('El café es oscuro en el plano.[^1]', [{ id: '1', documento: 'peli', ancla: tiempo(300, 320), etiqueta: '5:00-5:20' }]);
    const j = juezFalso(() => ({ juicios: [{ n: 1, veredicto: 'no_sostiene', visual: true, motivo: 'la transcripción no lo dice' }] }));
    const sin = await juzgarCitas(r, PREGUNTA, fuentes, j);
    expect(sin.juicios[0]!.veredicto).toBe('sin_comprobar');
    const mirador: Mirador = { puedeVer: () => true, ver: async () => ({ veredicto: 'sostiene', motivo: 'se ve', usd: 0.02 }) };
    const con = await juzgarCitas(r, PREGUNTA, fuentes, j, mirador);
    expect(con.juicios[0]).toMatchObject({ veredicto: 'sostiene', visual: true });
  });

  it('no duplica un ancla de la prosa que repite la etiqueta de su cita', () => {
    const r = respuesta('Lo dice en la p. 4.[^1]', [{ id: '1', documento: 'cuento', ancla: pag(2, '4'), etiqueta: 'p. 4' }]);
    expect(paresDeCitas(r, PREGUNTA, fuentes).pares).toHaveLength(1);
  });
});

describe('puntuación', () => {
  it('pondera acierto, exhaustividad y citas y resta errores', () => {
    const x = puntuar(PREGUNTA,
      [{ id: 'q01.1', veredicto: 'cubierto', motivo: '' }, { id: 'q01.2', veredicto: 'parcial', motivo: '' }],
      [{ trampa: 'Diego pide chocolate.', activada: false, motivo: '' }],
      [{ cita: '1', frase: '', documento: 'cuento', etiqueta: '', veredicto: 'sostiene', motivo: '', origen: 'cita' },
        { cita: '2', frase: '', documento: 'peli', etiqueta: '', veredicto: 'sin_comprobar', motivo: '', origen: 'cita' }]);
    expect(x.acierto).toBeCloseTo(0.75);
    expect(x.exhaustividad).toBeCloseTo(0.5);
    expect(x.precisionCitas).toBe(1);
    expect(x.nota).toBeCloseTo(100 * (0.5 * 0.75 + 0.3 * 0.5 + 0.2), 5);
  });

  it('castiga contradicciones, trampas y citas inventadas sin bajar de 0', () => {
    const x = puntuar(PREGUNTA, [{ id: 'q01.1', veredicto: 'contradicho', motivo: '' }],
      [{ trampa: 't', activada: true, motivo: '' }],
      [{ cita: '9', frase: '', documento: '', etiqueta: '', veredicto: 'inventada', motivo: '', origen: 'cita' }]);
    expect(x).toMatchObject({ contradichos: 1, trampas: 1, citasInventadas: 1, nota: 0 });
  });

  it('agrega la precisión sobre el total de citas y mide el acuerdo entre jueces', () => {
    const base = puntuar(PREGUNTA, [], [], []);
    const j = (sost: number, citas: number) => ({ preguntaId: 'q', modo: 'responder' as const, juez: 'x', puntos: [], trampas: [], citas: [], usdJuez: 0, puntuacion: { ...base, citas, citasSostienen: sost } });
    expect(agregar([j(1, 1), j(0, 3)]).precisionCitas).toBeCloseTo(0.25);
    expect(acuerdo({ a: 'cubierto', b: 'ausente', c: 'parcial' }, { a: 'cubierto', b: 'parcial', c: 'cubierto' })).toMatchObject({ n: 3, exacto: 1 / 3, binario: 2 / 3 });
  });
});

describe('juez de la rúbrica', () => {
  it('da por ausentes los puntos que el juez no devuelve y lee las trampas por número', async () => {
    const j = juezFalso(() => ({ puntos: [{ id: 'q01.1', veredicto: 'cubierto', motivo: 'lo dice' }, { id: 'q99.9', veredicto: 'cubierto', motivo: 'ajeno' }], trampas: [{ n: 1, activada: true, motivo: 'dice chocolate' }] }));
    const r = await juzgarRubrica(PREGUNTA, respuesta('Diego pide chocolate.'), j, {});
    expect(r.puntos).toEqual([{ id: 'q01.1', veredicto: 'cubierto', motivo: 'lo dice' }]);
    expect(r.trampas[0]!.activada).toBe(true);
    const x = await juzgarPregunta(PREGUNTA, respuesta('Diego pide chocolate.'), { juez: j, fuentes, titulos: {}, sinCitas: true });
    expect(x.puntuacion.exhaustividad).toBeCloseTo(1 / 3);
  });

  it('no llama al juez con una respuesta vacía', async () => {
    const j = juezFalso(() => ({}));
    const r = await juzgarRubrica(PREGUNTA, respuesta('  '), j, {});
    expect(j.llamadas).toBe(0);
    expect(r.puntos.every((x) => x.veredicto === 'ausente')).toBe(true);
  });

  it('la caché devuelve lo mismo sin volver a pagar', async () => {
    const j = juezFalso(() => ({ v: Math.random() }));
    const c = juezConCache(j, mkdtempSync(join(tmpdir(), 'juez-')));
    const p = { sistema: 's', usuario: 'u', esquema: {} };
    const a = await c.json<{ v: number }>(p), b = await c.json<{ v: number }>(p);
    expect(b.json.v).toBe(a.json.v);
    expect([a.usd, b.usd, j.llamadas]).toEqual([0.01, 0, 1]);
  });
});

describe('clientes', () => {
  const sse = (eventos: unknown[]) => new Response(new ReadableStream({
    start(c) {
      const e = new TextEncoder();
      for (const x of eventos) c.enqueue(e.encode(`event: ${(x as { tipo: string }).tipo}\ndata: ${JSON.stringify(x)}\n\n`));
      c.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });

  it('responder: junta los deltas y las citas con su pasaje', async () => {
    let cuerpo: unknown;
    const f = (async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return sse([
        { tipo: 'resultados', resultados: [] },
        { tipo: 'texto', delta: 'Pide fresa' }, { tipo: 'texto', delta: '[^1].' },
        { tipo: 'cita', n: 1, fragmento: 'f1', documento: 'cuento', etiqueta: 'p. 4', citaCorta: '(Paz, 1994, p. 4)', pasaje: { texto: 'había pedido fresa', desde: 0, hasta: 10, ancla: pag(2, '4') } },
        { tipo: 'fin', ms: 10 },
      ]);
    }) as unknown as typeof fetch;
    const r = await preguntarResponder({ base: 'https://x', clave: 'k', fetch: f }, PREGUNTA);
    expect(cuerpo).toEqual({ consulta: PREGUNTA.pregunta });
    expect(r.markdown).toBe('Pide fresa[^1].');
    expect(r.citas[0]).toMatchObject({ id: '1', documento: 'cuento', etiqueta: 'p. 4', texto: 'había pedido fresa', ancla: { fisica: 2 } });
  });

  it('investigar: toma el Markdown y las evidencias del evento final, y el coste', async () => {
    const f = (async () => sse([
      { tipo: 'inicio', id: 'i', modelo: 'm', presupuesto: {} },
      { tipo: 'plan', plan: {} },
      { tipo: 'evidencia', evidencia: { id: 'E1', documento: 'peli', ancla: tiempo(60, 90), cita: 'Me encanta la fresa', modo: 'video', etiqueta: '1:00-1:30' } },
      { tipo: 'texto', delta: 'borrador' },
      { tipo: 'fin', markdown: 'Le encanta la fresa [E1].', evidencias: [{ id: 'E1', documento: 'peli', ancla: tiempo(60, 90), cita: 'Me encanta la fresa', modo: 'video', etiqueta: '1:00-1:30' }], fuentes: [], coste: { usd: 0.42 }, avisos: [], ms: 5 },
    ])) as unknown as typeof fetch;
    const r = await preguntarInvestigar({ base: 'https://x', clave: 'k', fetch: f }, PREGUNTA);
    expect(r).toMatchObject({ modo: 'investigar', markdown: 'Le encanta la fresa [E1].', usd: 0.42 });
    expect(r.citas[0]).toMatchObject({ id: 'E1', etiqueta: '1:00-1:30', texto: 'Me encanta la fresa' });
    expect(frasesConCitas(r.markdown)[0]!.citas).toEqual(['E1']);
  });

  it('un error HTTP queda en la respuesta, no tumba el banco', async () => {
    const f = (async () => new Response('no existe', { status: 404 })) as unknown as typeof fetch;
    const r = await preguntarInvestigar({ base: 'https://x', clave: 'k', fetch: f }, PREGUNTA);
    expect(r.error).toMatch(/404/);
  });
});

describe('banco', () => {
  it('detecta errores de forma', () => {
    const malo: Banco = {
      version: '1', descripcion: '', documentos: {},
      preguntas: [{ ...PREGUNTA, categorias: ['inventada' as never], rubrica: { trampas: [], puntos: [{ ...PREGUNTA.rubrica.puntos[2]!, obligatorio: false, comprobacion: ['solo (gemini-4-argon)'] }] } }],
    };
    const e = erroresDeForma(malo);
    expect(e.some((x) => x.includes('categoría desconocida'))).toBe(true);
    expect(e.some((x) => x.includes('ningún punto obligatorio'))).toBe(true);
    expect(e.some((x) => x.includes('menos de dos modelos'))).toBe(true);
  });
});

describe('anclas que faltan', () => {
  it('deduce el ancla de la etiqueta cuando la nota no la trae', () => {
    const r = respuesta('Pide fresa.[^1] Le encanta.[^2] Portada.[^3]', [
      { id: '1', documento: 'cuento', etiqueta: 'p. 4' },
      { id: '2', documento: 'peli', etiqueta: '1:00-1:30' },
      { id: '3', documento: 'cuento', etiqueta: 'p. [1]' },
    ]);
    const { pares } = paresDeCitas(r, PREGUNTA, fuentes);
    expect(pares.map((x) => x.ancla)).toMatchObject([{ fisica: 2 }, { tipo: 'tiempo', t0: 60, t1: 90 }, { fisica: 1 }]);
  });
});

describe('formato de Investigar', () => {
  it('corta la sección de pruebas, quita «[sin prueba]» y lee marcas contiguas', () => {
    const fs = frasesConCitas('Diego pide fresa [E1][E3]. Algo sin respaldo. [sin prueba]\n\n## Pruebas\n- [E1] Paz, 1994, p. 4, *El lobo*: «cita»\n- [E3] Gutiérrez Alea, 1993, 9:54');
    expect(fs.map((f) => [f.texto, f.citas])).toEqual([['Diego pide fresa.', ['E1', 'E3']], ['Algo sin respaldo.', []]]);
  });
});

describe('documentos citados fuera del banco', () => {
  it('se descargan para comprobar sus citas; los que no existen se quedan fuera', async () => {
    const f = crearFuentes([CUENTO]);
    const api = {
      documento: async (id: string) => { if (id !== 'otro') throw new Error('404'); return { id, titulo: 'Otro', tipo: 'pdf', unidades: 1 }; },
      unidades: async () => [{ orden: 0, etiqueta: 'p. 1', ancla: pag(1, '1'), texto: 'jazz' }],
    };
    await completarFuentes(f, api, ['cuento', 'otro', 'fantasma'], mkdtempSync(join(tmpdir(), 'fuentes-')));
    expect(f.documento('otro')?.unidades[0]?.texto).toBe('jazz');
    expect(f.documento('fantasma')).toBeUndefined();
  });
});

describe('frases sobre la falta de información', () => {
  it('no se juzgan como citas', async () => {
    expect(esFraseSobreLaFalta('Los pasajes facilitados no contienen información sobre el cuento original.')).toBe(true);
    expect(esFraseSobreLaFalta('Por lo tanto, no es posible elaborar la tabla solicitada.')).toBe(true);
    expect(esFraseSobreLaFalta('En el cuento Diego derrama leche sobre David.')).toBe(false);
    const r = respuesta('Los pasajes no contienen información sobre la película.[^1]', [{ id: '1', documento: 'cuento', ancla: pag(2, '4'), etiqueta: 'p. 4' }]);
    const j = juezFalso(() => ({ juicios: [] }));
    const { juicios } = await juzgarCitas(r, PREGUNTA, fuentes, j);
    expect(juicios[0]!.veredicto).toBe('sin_comprobar');
    expect(j.llamadas).toBe(0);
  });
});
