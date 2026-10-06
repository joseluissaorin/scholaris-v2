/**
 * El segundo error de producción (7-10-2026), tras la primera reparación: una
 * persona real pasó a «personaje de ficción» (el clasificador vio a su trasunto
 * en un cuento) y perdió sus menciones, y apareció una entidad suelta con el
 * nombre corto del personaje que lo partía. VERSION_ENLACES = 3 lo repara.
 *
 * Aquí, con textos reales de dominio público: Joseph Bell, el maestro de Conan
 * Doyle, y Sherlock Holmes, el personaje que le inspiró. La entrevista es «A Day
 * with Dr. Conan Doyle» (Harry How, The Strand Magazine, agosto de 1892), literal de
 * https://en.wikisource.org/wiki/The_Strand_Magazine/Volume_4/Issue_20/A_Day_with_Dr._Conan_Doyle;
 * el libro, «The Adventures of Sherlock Holmes» (1892): la dedicatoria y el título de la
 * primera edición (https://archive.org/details/adventuresofsher001892doyl) y el comienzo de
 * «A Scandal in Bohemia» (Project Gutenberg n.º 1661, sin las marcas de cursiva).
 * Las descripciones de Wikidata son las de cada entidad.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from '@scholaris/nucleo';
import { caminoEntidades, extraerEntidadesDocumento, fichaEntidad, ponerAlDiaEnlaces, VERSION_ENLACES } from '../src/index.js';
import { estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

afterEach(() => { vi.unstubAllGlobals(); });

/** Un redactor que repite los errores: Bell como trasunto en el libro y un clasificador que lo toma por personaje. */
function redactorConfundido() {
  return redactorFalso((texto) => {
    if (texto.includes(' · B = ')) return { r: [] };
    if (/^\[\d+\] .+ · «/m.test(texto)) {
      const f = [...texto.matchAll(/^\[(\d+)\] (.+?) · «/gm)].filter((m) => ['Joseph Bell', 'Sherlock Holmes', 'Irene Adler', 'Holmes'].includes(m[2]!)).map((m) => Number(m[1]));
      return { f };
    }
    if (texto.includes('A Day with')) return { e: ['p|Arthur Conan Doyle|Doyle', 'p|Joseph Bell|Bell', 'p|Sherlock Holmes', 'o|The Adventures of Sherlock Holmes'] };
    return { e: ['q|Joseph Bell|JOSEPH BELL', 'q|Sherlock Holmes|Holmes', 'q|Irene Adler', 'o|The Adventures of Sherlock Holmes|THE ADVENTURES OF SHERLOCK HOLMES'] };
  });
}

function wikidata() {
  const f = (async (url: string) => {
    const q = new URL(url).searchParams.get('search') ?? '';
    const datos: Record<string, unknown[]> = {
      'Joseph Bell': [{ id: 'Q648680', label: 'Joseph Bell', description: 'médico y profesor escocés' }],
      'Sherlock Holmes': [{ id: 'Q200396', label: 'Sherlock Holmes', description: 'película de 2009 dirigida por Guy Ritchie' }],
      'The Adventures of Sherlock Holmes': [
        { id: 'Q1210852', label: 'The Adventures of Sherlock Holmes', description: 'película de 1939 dirigida por Alfred L. Werker' },
        { id: 'Q392147', label: 'The Adventures of Sherlock Holmes', description: 'colección de cuentos de Arthur Conan Doyle' },
      ],
      'Arthur Conan Doyle': [{ id: 'Q35610', label: 'Arthur Conan Doyle', description: 'escritor británico (1859-1930)' }],
    };
    return new Response(JSON.stringify({ search: datos[q] ?? [] }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return f;
}

async function biblioteca() {
  const sql = await estanteria();
  await sembrar(sql, {
    id: 'entrevista', titulo: 'A Day with Dr. Conan Doyle', autores: [['Harry', 'How']], anio: 1892, paginas: [
      "I learnt a number of interesting facts regarding \"The Adventures of Sherlock Holmes.\" Dr. Doyle invariably conceives the end of his story first, and writes up to it.",
      "I looked at the portrait. It represented the features of Mr. Joseph Bell, M.D., whose name I had heard mentioned whilst with Professor Blackie a few months ago in the Scotch capital.\n\n\"I was clerk in Mr. Bell's ward,\" continued Dr. Doyle.",
    ],
  });
  await sembrar(sql, {
    id: 'aventuras', titulo: 'The Adventures of Sherlock Holmes', autores: [['Arthur Conan', 'Doyle']], anio: 1892, paginas: [
      "MY OLD TEACHER, JOSEPH BELL, M.D., &c. OF 2, MELVILLE CRESCENT, EDINBURGH.\n\nTHE ADVENTURES OF SHERLOCK HOLMES.\n\nTo Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex. It was not that he felt any emotion akin to love for Irene Adler.",
      "I had seen little of Holmes lately. My marriage had drifted us away from each other. My own complete happiness, and the home-centred interests which rise up around the man who first finds himself master of his own establishment, were sufficient to absorb all my attention, while Holmes, who loathed every form of society with his whole Bohemian soul, remained in our lodgings in Baker Street, buried among his old books, and alternating from week to week between cocaine and ambition, the drowsiness of the drug, and the fierce energy of his own keen nature.\n\nOne night—it was on the twentieth of March, 1888—I was returning from a journey to a patient (for I had now returned to civil practice), when my way led me through Baker Street. As I passed the well-remembered door, which must always be associated in my mind with my wooing, and with the dark incidents of the Study in Scarlet, I was seized with a keen desire to see Holmes again, and to know how he was employing his extraordinary powers.",
    ],
  });
  return sql;
}

const una = async (sql: SQL, nombre: string) => (await sql.ejecutar<{ id: string; ficticia: number | null; wikidata: string | null; n_menciones: number; n_documentos: number; fusionada_en: string | null }>(
  'SELECT id, ficticia, wikidata, n_menciones, n_documentos, fusionada_en FROM entidades WHERE nombre = ?', nombre))[0]!;

describe('trasuntos: la persona real y su personaje', () => {
  it('repara el estado que dejó la versión 2 en producción', async () => {
    vi.stubGlobal('fetch', wikidata());
    const sql = await biblioteca();
    const redactor = redactorConfundido();
    const p = puertos(sql, { inteligencia: { redactor } });
    for (const d of ['entrevista', 'aventuras']) await extraerEntidadesDocumento(p, d, { wikidata: false, relaciones: false });

    // El estado de producción tras la versión 2: «Holmes» del libro atribuido a Bell y
    // luego separado en una entidad propia; Bell como personaje, sin Wikidata.
    const parker = await una(sql, 'Joseph Bell');
    const johnnyCarter = await una(sql, 'Sherlock Holmes');
    await sql.ejecutar("UPDATE menciones SET normalizado = 'Joseph Bell' WHERE documento = 'aventuras' AND texto = 'Holmes'");
    await sql.ejecutar("INSERT INTO entidades (id, tipo, clave, nombre, alias, busqueda, ficticia, descripcion, creada, actualizada) VALUES ('holmes-suelto', 'persona', 'holmes', 'Holmes', '[]', '|holmes|', 1, 'personaje de ficción', '', '')");
    await sql.ejecutar("UPDATE menciones SET entidad = 'holmes-suelto' WHERE documento = 'aventuras' AND texto = 'Holmes'");
    await sql.ejecutar("UPDATE entidades SET ficticia = 1, descripcion = 'personaje de ficción', wikidata = NULL WHERE id = ?", parker.id);
    await sql.ejecutar("INSERT OR REPLACE INTO funciones_ajustes (clave, valor) VALUES ('entidades_enlaces_version', '2')");

    const r = await ponerAlDiaEnlaces(sql, redactor);
    expect(r).not.toBeNull();
    expect(VERSION_ENLACES).toBe(3);

    // Joseph Bell: persona real (Wikidata y los textos lo confirman), con sus menciones en los dos documentos.
    const cp = await fichaEntidad(sql, parker.id);
    expect((await una(sql, 'Joseph Bell')).ficticia).toBe(0);
    expect(cp.wikidata).toBe('Q648680');
    expect(cp.descripcion).toBe('médico y profesor escocés');
    expect(cp.porDocumento.map((d) => d.documento).sort()).toEqual(['aventuras', 'entrevista']);
    expect(cp.porDocumento.find((d) => d.documento === 'aventuras')!.menciones.map((m) => m.texto)).toEqual(['JOSEPH BELL']);
    expect(cp.alias).not.toContain('Holmes');

    // «Holmes» vuelve a Sherlock Holmes; la entidad suelta se queda sin menciones.
    const jc = await fichaEntidad(sql, johnnyCarter.id);
    expect(jc.descripcion).toBe('personaje de ficción');
    expect(jc.wikidata).toBeUndefined();
    expect(jc.porDocumento.find((d) => d.documento === 'aventuras')!.total).toBeGreaterThanOrEqual(4);
    const suelto = await una(sql, 'Holmes');
    expect(suelto.n_menciones === 0 || suelto.fusionada_en === johnnyCarter.id).toBe(true);

    // The Adventures of Sherlock Holmes, el libro de cuentos.
    const ep = await una(sql, 'The Adventures of Sherlock Holmes');
    expect(ep.wikidata).toBe('Q392147');

    // El camino honesto.
    const camino = await caminoEntidades(sql, parker.id, ep.id);
    expect(camino.pasos[0]!.entidad.nombre).toBe('Joseph Bell');
    expect(camino.pasos.at(-1)!.entidad.nombre).toBe('The Adventures of Sherlock Holmes');
    const porJohnny = await caminoEntidades(sql, parker.id, johnnyCarter.id);
    expect(porJohnny.pasos.map((x) => x.entidad.nombre)).toEqual(['Joseph Bell', 'Sherlock Holmes']);

    // Una vez al día: la segunda llamada no hace nada.
    expect(await ponerAlDiaEnlaces(sql, redactor)).toBeNull();
  });

  it('una extracción nueva tampoco convierte a Bell en personaje por el voto de un libro', async () => {
    const sql = await biblioteca();
    const p = puertos(sql, { inteligencia: { redactor: redactorConfundido() } });
    const w = wikidata();
    for (const d of ['entrevista', 'aventuras']) await extraerEntidadesDocumento(p, d, { wikidata: { fetch: w, pausa: 0 }, relaciones: false });
    const cp = await una(sql, 'Joseph Bell');
    expect(cp.ficticia).toBe(0);
    expect(cp.wikidata).toBe('Q648680');
    expect(cp.n_documentos).toBe(2);
    const jc = await una(sql, 'Sherlock Holmes');
    expect(jc.ficticia).toBe(1);
    expect(jc.wikidata).toBeNull();
  });
});
