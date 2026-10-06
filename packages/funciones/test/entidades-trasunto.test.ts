/**
 * El segundo error de producción (7-10-2026), tras la primera reparación:
 * Charlie Parker pasó a «personaje de ficción» (el clasificador vio a Johnny,
 * su trasunto en «El perseguidor») y perdió sus menciones, y apareció una
 * entidad «Johnny» que partía a Johnny Carter. VERSION_ENLACES = 3 lo repara.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from '@scholaris/nucleo';
import { caminoEntidades, extraerEntidadesDocumento, fichaEntidad, ponerAlDiaEnlaces, VERSION_ENLACES } from '../src/index.js';
import { estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

afterEach(() => { vi.unstubAllGlobals(); });

/** Un redactor que repite los errores: Parker como trasunto en el cuento y un clasificador que lo toma por personaje. */
function redactorConfundido() {
  return redactorFalso((texto) => {
    if (texto.includes(' · B = ')) return { r: [] };
    if (/^\[\d+\] .+ · «/m.test(texto)) {
      const f = [...texto.matchAll(/^\[(\d+)\] (.+?) · «/gm)].filter((m) => ['Charlie Parker', 'Johnny Carter', 'Dédée', 'Johnny'].includes(m[2]!)).map((m) => Number(m[1]));
      return { f };
    }
    if (texto.includes('A fondo')) return { e: ['p|Julio Cortázar|Cortázar', 'p|Charlie Parker', 'p|Johnny Carter', 'o|El perseguidor'] };
    return { e: ['q|Charlie Parker|CH.P.', 'q|Johnny Carter|Johnny', 'q|Dédée', 'o|El perseguidor'] };
  });
}

function wikidata() {
  const f = (async (url: string) => {
    const q = new URL(url).searchParams.get('search') ?? '';
    const datos: Record<string, unknown[]> = {
      'Charlie Parker': [{ id: 'Q103767', label: 'Charlie Parker', description: 'saxofonista estadounidense (1920-1955)' }],
      'Johnny Carter': [{ id: 'Q4330560', label: 'Johnny Carter', description: 'cantante estadounidense' }],
      'El perseguidor': [
        { id: 'Q5351830', label: 'El perseguidor', description: 'película de 1965 dirigida por Osías Wilenski' },
        { id: 'Q5826138', label: 'El perseguidor', description: 'relato de Julio Cortázar' },
      ],
      'Julio Cortázar': [{ id: 'Q174210', label: 'Julio Cortázar', description: 'escritor y traductor argentino' }],
    };
    return new Response(JSON.stringify({ search: datos[q] ?? [] }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return f;
}

async function biblioteca() {
  const sql = await estanteria();
  await sembrar(sql, {
    id: 'entrevista', titulo: 'A fondo', anio: 1977, paginas: [
      'Cortázar, escritor, habla de El perseguidor: un famoso saxofonista se llama Johnny Carter, pero en la realidad se llamó Charlie Parker.',
      'Y cuando leí la biografía de Charlie Parker, a quien admiraba como saxofonista, vi a Johnny Carter. El perseguidor nació así.',
    ],
  });
  await sembrar(sql, {
    id: 'perseguidor', titulo: 'El perseguidor', autores: [['Julio', 'Cortázar']], anio: 1959, paginas: [
      'In memoriam CH.P. Dédée me ha llamado: Johnny no estaba bien. Johnny vive en un hotel con Dédée.',
      'Johnny Carter toca el saxo. Johnny y Dédée. El perseguidor.',
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
    for (const d of ['entrevista', 'perseguidor']) await extraerEntidadesDocumento(p, d, { wikidata: false, relaciones: false });

    // El estado de producción tras la versión 2: «Johnny» del cuento atribuido a Parker y
    // luego separado en una entidad propia; Parker como personaje, sin Wikidata.
    const parker = await una(sql, 'Charlie Parker');
    const johnnyCarter = await una(sql, 'Johnny Carter');
    await sql.ejecutar("UPDATE menciones SET normalizado = 'Charlie Parker' WHERE documento = 'perseguidor' AND texto = 'Johnny'");
    await sql.ejecutar("INSERT INTO entidades (id, tipo, clave, nombre, alias, busqueda, ficticia, descripcion, creada, actualizada) VALUES ('johnny-suelto', 'persona', 'johnny', 'Johnny', '[]', '|johnny|', 1, 'personaje de ficción', '', '')");
    await sql.ejecutar("UPDATE menciones SET entidad = 'johnny-suelto' WHERE documento = 'perseguidor' AND texto = 'Johnny'");
    await sql.ejecutar("UPDATE entidades SET ficticia = 1, descripcion = 'personaje de ficción', wikidata = NULL WHERE id = ?", parker.id);
    await sql.ejecutar("INSERT OR REPLACE INTO funciones_ajustes (clave, valor) VALUES ('entidades_enlaces_version', '2')");

    const r = await ponerAlDiaEnlaces(sql, redactor);
    expect(r).not.toBeNull();
    expect(VERSION_ENLACES).toBe(3);

    // Charlie Parker: persona real (Wikidata y los textos lo confirman), con sus menciones en los dos documentos.
    const cp = await fichaEntidad(sql, parker.id);
    expect((await una(sql, 'Charlie Parker')).ficticia).toBe(0);
    expect(cp.wikidata).toBe('Q103767');
    expect(cp.descripcion).toBe('saxofonista estadounidense (1920-1955)');
    expect(cp.porDocumento.map((d) => d.documento).sort()).toEqual(['entrevista', 'perseguidor']);
    expect(cp.porDocumento.find((d) => d.documento === 'perseguidor')!.menciones.map((m) => m.texto)).toEqual(['CH.P.']);
    expect(cp.alias).not.toContain('Johnny');

    // «Johnny» vuelve a Johnny Carter; la entidad suelta se queda sin menciones.
    const jc = await fichaEntidad(sql, johnnyCarter.id);
    expect(jc.descripcion).toBe('personaje de ficción');
    expect(jc.wikidata).toBeUndefined();
    expect(jc.porDocumento.find((d) => d.documento === 'perseguidor')!.total).toBeGreaterThanOrEqual(4);
    const suelto = await una(sql, 'Johnny');
    expect(suelto.n_menciones === 0 || suelto.fusionada_en === johnnyCarter.id).toBe(true);

    // El perseguidor, el relato.
    const ep = await una(sql, 'El perseguidor');
    expect(ep.wikidata).toBe('Q5826138');

    // El camino honesto.
    const camino = await caminoEntidades(sql, parker.id, ep.id);
    expect(camino.pasos[0]!.entidad.nombre).toBe('Charlie Parker');
    expect(camino.pasos.at(-1)!.entidad.nombre).toBe('El perseguidor');
    const porJohnny = await caminoEntidades(sql, parker.id, johnnyCarter.id);
    expect(porJohnny.pasos.map((x) => x.entidad.nombre)).toEqual(['Charlie Parker', 'Johnny Carter']);

    // Una vez al día: la segunda llamada no hace nada.
    expect(await ponerAlDiaEnlaces(sql, redactor)).toBeNull();
  });

  it('una extracción nueva tampoco convierte a Parker en personaje por el voto de un cuento', async () => {
    const sql = await biblioteca();
    const p = puertos(sql, { inteligencia: { redactor: redactorConfundido() } });
    const w = wikidata();
    for (const d of ['entrevista', 'perseguidor']) await extraerEntidadesDocumento(p, d, { wikidata: { fetch: w, pausa: 0 }, relaciones: false });
    const cp = await una(sql, 'Charlie Parker');
    expect(cp.ficticia).toBe(0);
    expect(cp.wikidata).toBe('Q103767');
    expect(cp.n_documentos).toBe(2);
    const jc = await una(sql, 'Johnny Carter');
    expect(jc.ficticia).toBe(1);
    expect(jc.wikidata).toBeNull();
  });
});
