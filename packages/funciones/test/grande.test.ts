/**
 * Un documento grande (miles de fragmentos, cientos de entidades) y una
 * biblioteca de cientos de documentos con el límite de D1 y de los Durable
 * Objects: ninguna sentencia puede pasar de 100 parámetros (la estantería de
 * las pruebas falla como ellos). Entidades, grafo de entidades, grafo de
 * citas, hidratación y búsqueda local con listas largas.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PARAMETROS_SQL, sqlConLimite, type TipoEntrada } from '@scholaris/nucleo';
import {
  alBorrarDocumento, buscadorLocal, buscarEntidades, caminoEntidades, detalleNodo, documentosFiltrados, entidadesDocumento, entidadesLector,
  extraerEntidadesDocumento, fichaEntidad, lineaTemporalEntidad, obtenerGrafo, reconstruirGrafo, referenciasHuerfanas, vecindarioEntidad,
} from '../src/index.js';
import { leerDocumentos, leerFragmentos } from '../src/estanteria.js';
import { embebedorFalso, estanteria, puertos, redactorFalso, sembrar } from './ayudas.js';

const SILABAS = ['ba', 'ce', 'di', 'fo', 'gu', 'la', 'me', 'ni', 'po', 'ru', 'sa', 'te', 'vi', 'zo', 'ma', 'lo'];
const palabra = (n: number) => { const s = SILABAS[n % 16]! + SILABAS[Math.floor(n / 16) % 16]! + SILABAS[Math.floor(n / 256) % 16]!; return s[0]!.toUpperCase() + s.slice(1); };
/** 400 personas y 60 lugares, todos distintos. */
const persona = (i: number) => `${palabra(i)} ${palabra(i + 1000)}`;
const lugar = (i: number) => `Villa${palabra(i + 2000).toLowerCase()}`;
const PAGINAS = 2400;
const pagina = (i: number) =>
  `${persona(i % 400)} escribe a ${persona((i * 7 + 3) % 400)} desde ${lugar(i % 60)} en ${1800 + (i % 150)}. ` +
  `${persona((i * 13 + 5) % 400)} lo cuenta después, y ${persona(i % 400)} vuelve a ${lugar((i + 1) % 60)}.`;

describe('biblioteca grande bajo el límite de 100 parámetros', () => {
  it('la estantería de las pruebas falla como un Durable Object', async () => {
    const sql = await estanteria();
    const ids = Array.from({ length: MAX_PARAMETROS_SQL + 1 }, (_, i) => `x${i}`);
    await expect(sql.ejecutar(`SELECT id FROM documentos WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids)).rejects.toThrow(/too many SQL variables/);
    await expect(sqlConLimite(sql).transaccion((tx) => tx.ejecutar(`SELECT 1 WHERE 1 IN (${ids.map(() => '?').join(', ')})`, ...ids))).rejects.toThrow(/too many/);
  });

  it('entidades, grafos, hidratación y búsqueda sobre miles de fragmentos y cientos de documentos', async () => {
    const sql = await estanteria();
    await sembrar(sql, { id: 'grande', titulo: 'Cartas de toda una vida', autores: [['Ana', 'López']], anio: 2001, idioma: 'es', paginas: Array.from({ length: PAGINAS }, (_, i) => pagina(i)), conVectores: true });
    // 180 obras citadas por la bibliografía del libro grande: el grafo de citas tiene cientos de aristas.
    const obras = Array.from({ length: 180 }, (_, i) => ({ id: `obra${i}`, titulo: `Tratado ${palabra(i + 3000)} de ${palabra(i + 3500)}`, autor: palabra(i + 4000), anio: 1900 + (i % 100) }));
    for (const o of obras) await sembrar(sql, { id: o.id, titulo: o.titulo, autores: [['J.', o.autor]], anio: o.anio, bibliotecas: ['b1'], paginas: [`${o.titulo}, por ${o.autor}.`], conVectores: false });
    const bibliografia = ['Bibliografía', '', ...obras.map((o) => `${o.autor}, J. (${o.anio}). ${o.titulo}. Madrid: Cátedra.`)].join('\n');
    await sql.ejecutar("UPDATE fragmentos SET texto = ? WHERE id = 'grande-f2400'", bibliografia);

    // Entidades: el «redactor» reconoce las personas, los lugares y las fechas de cada lote.
    const redactor = redactorFalso((texto) => {
      if (texto.includes(' · B = ')) return { r: [] };
      const e = new Set<string>();
      for (const m of texto.matchAll(/([A-Z][a-z]{5} [A-Z][a-z]{5})\b/g)) if (!/^(Villa|Tratado)/.test(m[1]!)) e.add(`p|${m[1]}`);
      for (const m of texto.matchAll(/\b(Villa[a-z]{6})\b/g)) e.add(`l|${m[1]}`);
      for (const m of texto.matchAll(/\b(1[89]\d\d)\b/g)) e.add(`f|${m[1]}`);
      return { e: [...e] };
    });
    const p = puertos(sql, { inteligencia: { redactor, embebedor: embebedorFalso() } });
    const r = await extraerEntidadesDocumento(p, 'grande', { wikidata: false, concurrencia: 4 });
    expect(r.estado).toBe('hecho');
    const [{ n: menciones } = { n: 0 }] = await sql.ejecutar<{ n: number }>("SELECT COUNT(*) AS n FROM menciones WHERE documento = 'grande'");
    expect(menciones).toBeGreaterThan(PAGINAS * 3);
    const personas = await buscarEntidades(sql, { tipo: 'persona,lugar,obra,fecha,organizacion,concepto', limite: 200 });
    expect(personas.total).toBeGreaterThan(400);

    // Grafo de entidades: ficha, vecindario a dos saltos, camino y línea temporal.
    const id = async (nombre: string) => (await buscarEntidades(sql, { q: nombre })).elementos.find((x) => x.nombre === nombre)!.id;
    const a = await id(persona(0)), b = await id(persona(399));
    const ficha = await fichaEntidad(sql, a, { porDocumento: 200 });
    expect(ficha.porDocumento[0]!.menciones.length).toBeGreaterThan(0);
    expect(ficha.vecinos.length).toBeGreaterThan(0);
    const vec = await vecindarioEntidad(sql, a, { saltos: 2, limite: 30 });
    expect(vec.nodos.length).toBeGreaterThan(30);
    expect((await caminoEntidades(sql, a, b)).pasos.length).toBeGreaterThan(1);
    expect((await lineaTemporalEntidad(sql, a)).elementos.length).toBeGreaterThan(0);
    expect((await entidadesDocumento(sql, 'grande')).entidades.length).toBeGreaterThanOrEqual(50);
    expect(Object.keys((await entidadesLector(sql, 'grande')).entidades).length).toBeGreaterThan(400);

    // Grafo de citas: cientos de referencias resueltas.
    const g0 = await reconstruirGrafo(sql);
    expect(g0.aristas).toBeGreaterThan(100);
    const g = await obtenerGrafo(sql);
    expect(g.nodos.find((x) => x.documento === 'grande')!.citas).toBe(g0.aristas);
    expect((await detalleNodo(sql, 'grande')).cita.length).toBe(g0.aristas);
    expect(await referenciasHuerfanas(sql)).toBeDefined();

    // Hidratación y filtros con listas largas.
    const ids = Array.from({ length: PAGINAS }, (_, i) => `grande-f${i + 1}`);
    expect((await leerFragmentos(sql, ids)).size).toBe(PAGINAS);
    const docs = ['grande', ...obras.map((o) => o.id)];
    expect((await leerDocumentos(sql, docs)).size).toBe(docs.length);
    expect((await documentosFiltrados(sql, { documentos: docs, tipos: Array.from({ length: 150 }, (_, i) => (i ? `t${i}` : 'pdf')) as TipoEntrada[], idiomas: Array.from({ length: 150 }, (_, i) => `i${i}`).concat('es'), autores: Array.from({ length: 150 }, (_, i) => (i ? `Nadie${i}` : 'López')) }))!.size).toBe(1);
    const res = await buscadorLocal(sql, embebedorFalso()).buscar({ consulta: `${persona(0)} escribe`, k: 300, filtros: { documentos: docs } });
    expect(res.resultados.length).toBeGreaterThan(100);

    // Y al borrar el libro, todo se limpia.
    await sql.ejecutar("DELETE FROM documentos WHERE id = 'grande'");
    await alBorrarDocumento(p, 'grande');
    const [{ n: quedan } = { n: -1 }] = await sql.ejecutar<{ n: number }>("SELECT COUNT(*) AS n FROM menciones WHERE documento = 'grande'");
    expect(quedan).toBe(0);
  }, 180_000);
});
