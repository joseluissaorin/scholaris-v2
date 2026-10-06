/**
 * Los tres errores de enlace que se vieron en producción (octubre de 2026):
 *   1. «Johnny Carter», el saxofonista del cuento, descrito como «cantante
 *      estadounidense» (un homónimo real de Wikidata) y con el alias «Dédée»;
 *   2. «El perseguidor» enlazado con la película de 1965 y no con el cuento
 *      de Cortázar de 1959;
 *   3. «Charlie Parker» con el alias «Johnny».
 * Y la reparación sin volver a extraer de una biblioteca que ya los tiene.
 *
 * Las pruebas de punta a punta reproducen los tres errores con textos reales de
 * dominio público: Joseph Bell (persona real), Sherlock Holmes e Irene Adler
 * (personajes) y «The Adventures of Sherlock Holmes» (y su película de 1939).
 * La entrevista es «A Day with Dr. Conan Doyle» (Harry How, The Strand Magazine,
 * agosto de 1892), literal de
 * https://en.wikisource.org/wiki/The_Strand_Magazine/Volume_4/Issue_20/A_Day_with_Dr._Conan_Doyle;
 * el libro, el título de la primera edición (https://archive.org/details/adventuresofsher001892doyl)
 * y el comienzo de «A Scandal in Bohemia» (Project Gutenberg n.º 1661, sin las marcas de cursiva).
 * Las descripciones de Wikidata son las de cada entidad.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from '@scholaris/nucleo';
import { buscarEntidades, caminoEntidades, elegirCandidato, extraerEntidadesDocumento, fichaEntidad, formaCompatible, rehacerEnlacesEntidades } from '../src/index.js';
import { estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

afterEach(() => { vi.unstubAllGlobals(); });

const FICTICIOS = new Set(['Sherlock Holmes', 'Irene Adler', 'Holmes']);

/** Un redactor que se equivoca como se equivocó Flash-Lite. */
function redactorConErrores() {
  return redactorFalso((texto) => {
    if (texto.includes(' · B = ')) return { r: [] };
    // Clasificación de ficción: «[n] Nombre · «Título» · pasaje».
    if (/^\[\d+\] .+ · «/m.test(texto)) {
      const f = [...texto.matchAll(/^\[(\d+)\] (.+?) · «/gm)].filter((m) => FICTICIOS.has(m[2]!)).map((m) => Number(m[1]));
      return { f };
    }
    if (texto.includes('A Day with')) {
      // En la entrevista: Holmes como persona real con «Irene Adler» de forma, y «Holmes» como forma de Bell.
      return { e: ['p|Arthur Conan Doyle|Doyle', 'p|Joseph Bell|Holmes|Bell', 'p|Sherlock Holmes|Irene Adler', 'o|The Adventures of Sherlock Holmes'] };
    }
    return { e: ['q|Sherlock Holmes|Holmes', 'q|Irene Adler', 'o|The Adventures of Sherlock Holmes|THE ADVENTURES OF SHERLOCK HOLMES', 'l|Baker Street'] };
  });
}

function wikidataFalso() {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    const q = new URL(url).searchParams.get('search') ?? '';
    llamadas.push(q);
    const datos: Record<string, unknown[]> = {
      'Sherlock Holmes': [{ id: 'Q200396', label: 'Sherlock Holmes', description: 'película de 2009 dirigida por Guy Ritchie' }],
      'Joseph Bell': [{ id: 'Q648680', label: 'Joseph Bell', description: 'médico y profesor escocés' }],
      'Arthur Conan Doyle': [{ id: 'Q35610', label: 'Arthur Conan Doyle', description: 'escritor británico (1859-1930)' }],
      'The Adventures of Sherlock Holmes': [
        { id: 'Q1210852', label: 'The Adventures of Sherlock Holmes', description: 'película de 1939 dirigida por Alfred L. Werker' },
        { id: 'Q392147', label: 'The Adventures of Sherlock Holmes', description: 'colección de cuentos de Arthur Conan Doyle' },
      ],
      'Baker Street': [{ id: 'Q804402', label: 'Baker Street', description: 'street in the Marylebone district of the City of Westminster in London' }],
    };
    return new Response(JSON.stringify({ search: datos[q] ?? [] }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

async function biblioteca() {
  const sql = await estanteria();
  await sembrar(sql, {
    id: 'entrevista', titulo: 'A Day with Dr. Conan Doyle', autores: [['Harry', 'How']], anio: 1892, paginas: [
      "I learnt a number of interesting facts regarding \"The Adventures of Sherlock Holmes.\" Dr. Doyle invariably conceives the end of his story first, and writes up to it.",
      "I looked at the portrait. It represented the features of Mr. Joseph Bell, M.D., whose name I had heard mentioned whilst with Professor Blackie a few months ago in the Scotch capital.\n\n\"I was clerk in Mr. Bell's ward,\" continued Dr. Doyle.",
      "Sherlock Holmes was making his problems distinctly agreeable to the public, which soon began to evince an intense interest in them, and expectantly watched and waited for every new mystery which the famous detective undertook to solve. But Holmes—so to speak—was put back for a time.",
    ],
  });
  await sembrar(sql, {
    id: 'aventuras', titulo: 'The Adventures of Sherlock Holmes', autores: [['Arthur Conan', 'Doyle']], anio: 1892, paginas: [
      "THE ADVENTURES OF SHERLOCK HOLMES.\n\nTo Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex. It was not that he felt any emotion akin to love for Irene Adler. All emotions, and that one particularly, were abhorrent to his cold, precise but admirably balanced mind. He was, I take it, the most perfect reasoning and observing machine that the world has seen, but as a lover he would have placed himself in a false position. He never spoke of the softer passions, save with a gibe and a sneer. They were admirable things for the observer—excellent for drawing the veil from men’s motives and actions. But for the trained reasoner to admit such intrusions into his own delicate and finely adjusted temperament was to introduce a distracting factor which might throw a doubt upon all his mental results. Grit in a sensitive instrument, or a crack in one of his own high-power lenses, would not be more disturbing than a strong emotion in a nature such as his. And yet there was but one woman to him, and that woman was the late Irene Adler, of dubious and questionable memory.\n\nI had seen little of Holmes lately. My marriage had drifted us away from each other. My own complete happiness, and the home-centred interests which rise up around the man who first finds himself master of his own establishment, were sufficient to absorb all my attention, while Holmes, who loathed every form of society with his whole Bohemian soul, remained in our lodgings in Baker Street, buried among his old books, and alternating from week to week between cocaine and ambition, the drowsiness of the drug, and the fierce energy of his own keen nature.",
    ],
  });
  return sql;
}

async function entidad(sql: SQL, nombre: string) {
  const [f] = await sql.ejecutar<{ id: string; wikidata: string | null; descripcion: string | null; alias: string; ficticia: number | null; fusionada_en: string | null }>(
    'SELECT id, wikidata, descripcion, alias, ficticia, fusionada_en FROM entidades WHERE nombre = ? AND fusionada_en IS NULL', nombre,
  );
  return f!;
}

describe('enlaces honestos', () => {
  it('formas compatibles: apellido, iniciales y variantes sí; otro nombre no', () => {
    expect(formaCompatible('Cortázar', 'Julio Cortázar', 'persona')).toBe(true);
    expect(formaCompatible('CH.P.', 'Charlie Parker', 'persona')).toBe(true);
    expect(formaCompatible('Plato', 'Platón', 'persona')).toBe(true);
    expect(formaCompatible('Dédée', 'Johnny Carter', 'persona')).toBe(false);
    expect(formaCompatible('Johnny', 'Charlie Parker', 'persona')).toBe(false);
    expect(formaCompatible('Paradise Lost', 'El paraíso perdido', 'obra')).toBe(true);
  });

  it('Wikidata: si hay duda, no se enlaza', () => {
    const pistas = { apellidos: ['Cortázar'], anios: [1959] };
    const pelicula = { id: 'Q1', etiqueta: 'El perseguidor', descripcion: 'película de 1965 dirigida por Osías Wilenski' };
    const cuento = { id: 'Q2', etiqueta: 'El perseguidor', descripcion: 'cuento de Julio Cortázar' };
    const adaptacion = { id: 'Q3', etiqueta: 'El perseguidor', descripcion: 'adaptación cinematográfica del cuento de Julio Cortázar' };
    expect(elegirCandidato('El perseguidor', 'obra', [pelicula], false, pistas)).toBeNull();
    expect(elegirCandidato('El perseguidor', 'obra', [pelicula, adaptacion, cuento], false, pistas)?.id).toBe('Q2');
    expect(elegirCandidato('El perseguidor', 'obra', [adaptacion], false, pistas)).toBeNull();
    // Un personaje solo enlaza con un personaje de su obra; una persona sin clasificar, con nada.
    const personaje = { id: 'Q4', etiqueta: 'Johnny Carter', descripcion: 'personaje de «El perseguidor», de Julio Cortázar' };
    const cantante = { id: 'Q5', etiqueta: 'Johnny Carter', descripcion: 'cantante estadounidense' };
    expect(elegirCandidato('Johnny Carter', 'persona', [cantante, personaje], true, { apellidos: ['Cortázar'], anios: [] })?.id).toBe('Q4');
    expect(elegirCandidato('Johnny Carter', 'persona', [cantante], true, pistas)).toBeNull();
    expect(elegirCandidato('Johnny Carter', 'persona', [cantante], null, pistas)).toBeNull();
    expect(elegirCandidato('Johnny Carter', 'persona', [personaje], false, pistas)).toBeNull();
    // Una persona real no es una obra ni una edición que lleva su nombre.
    const cortazar = [
      { id: 'Q174210', etiqueta: 'Julio Cortázar', descripcion: 'escritor y traductor argentino' },
      { id: 'Q129721892', etiqueta: 'Julio Cortázar', descripcion: 'obra escrita por Julio Cortázar' },
    ];
    expect(elegirCandidato('Julio Cortázar', 'persona', cortazar, false, { apellidos: ['Cortázar'], anios: [1959] })?.id).toBe('Q174210');
  });

  it('extracción: personaje sin homónimo real, obra por autor y año, alias de la misma entidad', async () => {
    const sql = await biblioteca();
    const p = puertos(sql, { inteligencia: { redactor: redactorConErrores() } });
    const w = wikidataFalso();
    for (const d of ['entrevista', 'aventuras']) await extraerEntidadesDocumento(p, d, { wikidata: { fetch: w.f, pausa: 0 } });

    const johnny = await entidad(sql, 'Sherlock Holmes');
    expect(johnny.ficticia).toBe(1);
    expect(johnny.wikidata).toBeNull();
    expect(johnny.descripcion).toBe('personaje de ficción');
    expect(JSON.parse(johnny.alias)).not.toContain('Irene Adler');
    expect((await entidad(sql, 'Irene Adler')).ficticia).toBe(1);

    const parker = await entidad(sql, 'Joseph Bell');
    expect(parker.wikidata).toBe('Q648680');
    expect(JSON.parse(parker.alias)).not.toContain('Holmes');

    const obra = await entidad(sql, 'The Adventures of Sherlock Holmes');
    expect(obra.wikidata).toBe('Q392147');
    expect((await buscarEntidades(sql, { q: 'adventures of sherlock' })).elementos.map((e) => e.id)).toContain(obra.id);

    // Camino honesto: Joseph Bell → … → The Adventures of Sherlock Holmes.
    const camino = await caminoEntidades(sql, parker.id, obra.id);
    expect(camino.pasos.length).toBeGreaterThanOrEqual(2);
    expect(camino.pasos.at(-1)!.entidad.nombre).toBe('The Adventures of Sherlock Holmes');
    expect(camino.pasos.every((x) => !x.entidad.alias.includes('Irene Adler') || x.entidad.nombre === 'Irene Adler')).toBe(true);
  });

  it('reparación sin volver a extraer de una biblioteca con los tres errores', async () => {
    const sql = await biblioteca();
    const redactor = redactorConErrores();
    const p = puertos(sql, { inteligencia: { redactor } });
    const w = wikidataFalso();
    for (const d of ['entrevista', 'aventuras']) await extraerEntidadesDocumento(p, d, { wikidata: false, relaciones: false });
    // El estado de producción: personas sin clasificar, Holmes enlazado con la película y con
    // las menciones de «Irene Adler», Irene Adler fusionada en él, Bell con «Holmes» y la película de 1939.
    const johnny = await entidad(sql, 'Sherlock Holmes');
    const dedee = await entidad(sql, 'Irene Adler');
    const parker = await entidad(sql, 'Joseph Bell');
    const obra = await entidad(sql, 'The Adventures of Sherlock Holmes');
    await sql.ejecutar("UPDATE entidades SET ficticia = NULL, descripcion = NULL WHERE tipo = 'persona'");
    await sql.ejecutar("UPDATE entidades SET wikidata = 'Q200396', descripcion = 'película de 2009 dirigida por Guy Ritchie', alias = '[\"Irene Adler\",\"Holmes\"]' WHERE id = ?", johnny.id);
    await sql.ejecutar("UPDATE menciones SET entidad = ?, normalizado = 'Sherlock Holmes' WHERE entidad = ?", johnny.id, dedee.id);
    await sql.ejecutar('UPDATE entidades SET fusionada_en = ? WHERE id = ?', johnny.id, dedee.id);
    await sql.ejecutar("UPDATE entidades SET alias = '[\"Holmes\"]' WHERE id = ?", parker.id);
    await sql.ejecutar("UPDATE entidades SET wikidata = 'Q1210852', descripcion = 'película de 1939 dirigida por Alfred L. Werker' WHERE id = ?", obra.id);

    const llamadas = redactor.llamadas;
    const r = await rehacerEnlacesEntidades(sql, redactor, { wikidata: { fetch: w.f, pausa: 0 } });
    // Solo la clasificación de ficción: ninguna extracción nueva.
    expect(redactor.llamadas - llamadas).toBe(1);
    expect(r.reasignadas).toBeGreaterThan(0);

    const j = await fichaEntidad(sql, johnny.id);
    expect(j.wikidata).toBeUndefined();
    expect(j.descripcion).toBe('personaje de ficción');
    expect(j.alias).not.toContain('Irene Adler');
    const d = await entidad(sql, 'Irene Adler');
    expect(d.id).toBe(dedee.id);
    expect(d.ficticia).toBe(1);
    expect((await fichaEntidad(sql, dedee.id)).menciones).toBeGreaterThan(0);
    const cp = await fichaEntidad(sql, parker.id);
    expect(cp.alias).not.toContain('Holmes');
    expect(cp.wikidata).toBe('Q648680');
    expect((await fichaEntidad(sql, obra.id)).wikidata).toBe('Q392147');

    // Idempotente: otra pasada no cambia nada ni llama a nadie.
    const antes = await sql.ejecutar('SELECT id, nombre, alias, wikidata, ficticia, fusionada_en, n_menciones FROM entidades ORDER BY id');
    const consultas = w.llamadas.length;
    await rehacerEnlacesEntidades(sql, redactor, { wikidata: { fetch: w.f, pausa: 0 } });
    expect(await sql.ejecutar('SELECT id, nombre, alias, wikidata, ficticia, fusionada_en, n_menciones FROM entidades ORDER BY id')).toEqual(antes);
    expect(w.llamadas.length).toBe(consultas);
  });

  it('una biblioteca anterior se repara sola al mirar el estado, una sola vez', async () => {
    const { Hono } = await import('hono');
    const { rutasFunciones } = await import('../src/index.js');
    const w = wikidataFalso();
    vi.stubGlobal('fetch', w.f);
    const sql = await biblioteca();
    const redactor = redactorConErrores();
    const tareas: Promise<unknown>[] = [];
    const p = puertos(sql, { inteligencia: { redactor }, enSegundoPlano: (x) => { tareas.push(x); } });
    for (const d of ['entrevista', 'aventuras']) await extraerEntidadesDocumento(p, d, { wikidata: false, relaciones: false });
    // Así estaba una biblioteca hecha con las reglas anteriores.
    await sql.ejecutar("UPDATE entidades SET ficticia = NULL, descripcion = NULL WHERE tipo = 'persona'");
    await sql.ejecutar("DELETE FROM funciones_ajustes WHERE clave = 'entidades_enlaces_version'");
    const app = new Hono<{ Variables: { funciones: typeof p } }>();
    app.use('*', async (c, next) => { c.set('funciones', p); await next(); });
    rutasFunciones(app);
    expect((await app.request('/entidades/estado')).status).toBe(200);
    await Promise.all(tareas);
    expect((await entidad(sql, 'Sherlock Holmes')).ficticia).toBe(1);
    expect((await entidad(sql, 'The Adventures of Sherlock Holmes')).wikidata).toBe('Q392147');
    const llamadas = redactor.llamadas;
    tareas.length = 0;
    await app.request('/entidades/estado');
    await Promise.all(tareas);
    expect(redactor.llamadas).toBe(llamadas);
  });
});
