/**
 * Los tres errores de enlace que se vieron en producción (octubre de 2026):
 *   1. «Johnny Carter», el saxofonista del cuento, descrito como «cantante
 *      estadounidense» (un homónimo real de Wikidata) y con el alias «Dédée»;
 *   2. «El perseguidor» enlazado con la película de 1965 y no con el cuento
 *      de Cortázar de 1959;
 *   3. «Charlie Parker» con el alias «Johnny».
 * Y la reparación sin volver a extraer de una biblioteca que ya los tiene.
 */
import { describe, expect, it } from 'vitest';
import type { SQL } from '@scholaris/nucleo';
import { caminoEntidades, elegirCandidato, extraerEntidadesDocumento, fichaEntidad, formaCompatible, rehacerEnlacesEntidades } from '../src/index.js';
import { estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

const FICTICIOS = new Set(['Johnny Carter', 'Dédée', 'Johnny']);

/** Un redactor que se equivoca como se equivocó Flash-Lite. */
function redactorConErrores() {
  return redactorFalso((texto) => {
    if (texto.includes(' · B = ')) return { r: [] };
    // Clasificación de ficción: «[n] Nombre · «Título» · pasaje».
    if (/^\[\d+\] .+ · «/m.test(texto)) {
      const f = [...texto.matchAll(/^\[(\d+)\] (.+?) · «/gm)].filter((m) => FICTICIOS.has(m[2]!)).map((m) => Number(m[1]));
      return { f };
    }
    if (texto.includes('A fondo')) {
      // En la entrevista: Johnny como persona real con «Dédée» de forma, y «Johnny» como forma de Parker.
      return { e: ['p|Julio Cortázar|Cortázar', 'p|Charlie Parker|Johnny', 'p|Johnny Carter|Dédée', 'o|El perseguidor'] };
    }
    return { e: ['q|Johnny Carter|Johnny', 'q|Dédée', 'o|El perseguidor', 'l|París'] };
  });
}

function wikidataFalso() {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    const q = new URL(url).searchParams.get('search') ?? '';
    llamadas.push(q);
    const datos: Record<string, unknown[]> = {
      'Johnny Carter': [{ id: 'Q4330560', label: 'Johnny Carter', description: 'cantante estadounidense' }],
      'Charlie Parker': [{ id: 'Q103767', label: 'Charlie Parker', description: 'saxofonista estadounidense (1920-1955)' }],
      'Julio Cortázar': [{ id: 'Q93959', label: 'Julio Cortázar', description: 'escritor argentino (1914-1984)' }],
      'El perseguidor': [
        { id: 'Q5999001', label: 'El perseguidor', description: 'película de 1965 dirigida por Osías Wilenski' },
        { id: 'Q5999002', label: 'El perseguidor', description: 'cuento de Julio Cortázar de 1959' },
      ],
      'París': [{ id: 'Q90', label: 'París', description: 'capital de Francia' }],
    };
    return new Response(JSON.stringify({ search: datos[q] ?? [] }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

async function biblioteca() {
  const sql = await estanteria();
  await sembrar(sql, {
    id: 'entrevista', titulo: 'A fondo', anio: 1977, paginas: [
      'Cortázar habla de El perseguidor: el saxofonista se llama Johnny Carter, pero en la realidad se llamó Charlie Parker. Johnny es Charlie Parker. Dédée también.',
    ],
  });
  await sembrar(sql, {
    id: 'perseguidor', titulo: 'El perseguidor', autores: [['Julio', 'Cortázar']], anio: 1959, paginas: [
      'El perseguidor. Dédée me ha llamado: Johnny no estaba bien. Johnny Carter y Dédée viven en un hotel de París.',
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
  });

  it('extracción: personaje sin homónimo real, obra por autor y año, alias de la misma entidad', async () => {
    const sql = await biblioteca();
    const p = puertos(sql, { inteligencia: { redactor: redactorConErrores() } });
    const w = wikidataFalso();
    for (const d of ['entrevista', 'perseguidor']) await extraerEntidadesDocumento(p, d, { wikidata: { fetch: w.f, pausa: 0 } });

    const johnny = await entidad(sql, 'Johnny Carter');
    expect(johnny.ficticia).toBe(1);
    expect(johnny.wikidata).toBeNull();
    expect(johnny.descripcion).toBe('personaje de ficción');
    expect(JSON.parse(johnny.alias)).not.toContain('Dédée');
    expect((await entidad(sql, 'Dédée')).ficticia).toBe(1);

    const parker = await entidad(sql, 'Charlie Parker');
    expect(parker.wikidata).toBe('Q103767');
    expect(JSON.parse(parker.alias)).not.toContain('Johnny');

    const obra = await entidad(sql, 'El perseguidor');
    expect(obra.wikidata).toBe('Q5999002');

    // Camino honesto: Charlie Parker → Johnny Carter (la entrevista) → El perseguidor.
    const camino = await caminoEntidades(sql, parker.id, obra.id);
    expect(camino.pasos.length).toBeGreaterThanOrEqual(2);
    expect(camino.pasos.at(-1)!.entidad.nombre).toBe('El perseguidor');
    expect(camino.pasos.every((x) => !x.entidad.alias.includes('Dédée') || x.entidad.nombre === 'Dédée')).toBe(true);
  });

  it('reparación sin volver a extraer de una biblioteca con los tres errores', async () => {
    const sql = await biblioteca();
    const redactor = redactorConErrores();
    const p = puertos(sql, { inteligencia: { redactor } });
    const w = wikidataFalso();
    for (const d of ['entrevista', 'perseguidor']) await extraerEntidadesDocumento(p, d, { wikidata: false, relaciones: false });
    // El estado de producción: personas sin clasificar, Johnny enlazado con el cantante y con
    // las menciones de «Dédée», Dédée fusionada en él, Parker con «Johnny» y la película.
    const johnny = await entidad(sql, 'Johnny Carter');
    const dedee = await entidad(sql, 'Dédée');
    const parker = await entidad(sql, 'Charlie Parker');
    const obra = await entidad(sql, 'El perseguidor');
    await sql.ejecutar("UPDATE entidades SET ficticia = NULL, descripcion = NULL WHERE tipo = 'persona'");
    await sql.ejecutar("UPDATE entidades SET wikidata = 'Q4330560', descripcion = 'cantante estadounidense', alias = '[\"Dédée\",\"Johnny\"]' WHERE id = ?", johnny.id);
    await sql.ejecutar("UPDATE menciones SET entidad = ?, normalizado = 'Johnny Carter' WHERE entidad = ?", johnny.id, dedee.id);
    await sql.ejecutar('UPDATE entidades SET fusionada_en = ? WHERE id = ?', johnny.id, dedee.id);
    await sql.ejecutar("UPDATE entidades SET alias = '[\"Johnny\"]' WHERE id = ?", parker.id);
    await sql.ejecutar("UPDATE entidades SET wikidata = 'Q5999001', descripcion = 'película de 1965 dirigida por Osías Wilenski' WHERE id = ?", obra.id);

    const llamadas = redactor.llamadas;
    const r = await rehacerEnlacesEntidades(sql, redactor, { wikidata: { fetch: w.f, pausa: 0 } });
    // Solo la clasificación de ficción: ninguna extracción nueva.
    expect(redactor.llamadas - llamadas).toBe(1);
    expect(r.reasignadas).toBeGreaterThan(0);

    const j = await fichaEntidad(sql, johnny.id);
    expect(j.wikidata).toBeUndefined();
    expect(j.descripcion).toBe('personaje de ficción');
    expect(j.alias).not.toContain('Dédée');
    const d = await entidad(sql, 'Dédée');
    expect(d.id).toBe(dedee.id);
    expect(d.ficticia).toBe(1);
    expect((await fichaEntidad(sql, dedee.id)).menciones).toBeGreaterThan(0);
    const cp = await fichaEntidad(sql, parker.id);
    expect(cp.alias).not.toContain('Johnny');
    expect(cp.wikidata).toBe('Q103767');
    expect((await fichaEntidad(sql, obra.id)).wikidata).toBe('Q5999002');

    // Idempotente: otra pasada no cambia nada ni llama a nadie.
    const antes = await sql.ejecutar('SELECT id, nombre, alias, wikidata, ficticia, fusionada_en, n_menciones FROM entidades ORDER BY id');
    const consultas = w.llamadas.length;
    await rehacerEnlacesEntidades(sql, redactor, { wikidata: { fetch: w.f, pausa: 0 } });
    expect(await sql.ejecutar('SELECT id, nombre, alias, wikidata, ficticia, fusionada_en, n_menciones FROM entidades ORDER BY id')).toEqual(antes);
    expect(w.llamadas.length).toBe(consultas);
  });
});
