/**
 * Un documento grande (1000 páginas, miles de fragmentos) de punta a punta con
 * el límite de D1 y de los Durable Objects: ninguna sentencia puede pasar de
 * 100 parámetros. Antes, `consolidar` borraba los provisionales sobrantes con
 * `IN (?, ?, …)` de 200 y fallaba en producción con «too many SQL variables».
 */
import { describe, expect, it } from 'vitest';
import { MAX_PARAMETROS_SQL, type SQL, type ValorSQL } from '@scholaris/nucleo';
import { buscarTexto, leerVectores } from '@scholaris/spdf';
import { Buscador, Estanteria, IndiceVectorialSQL } from '../../busqueda/src/index.js';
import { JuezFalso, RedactorFalso, ReordenadorFalso } from '../../busqueda/test/apoyo/falsos.js';
import { ejecutarIngesta } from '../src/orquestador.js';
import { baseReal, embebedorFalso, fuenteFalsa, inteligenciaFalsa, lectorFalso, paginaLeida, paginaPdf, paquetePdf } from './fakes.js';

// En la CI, 300: con 1000 el hilo de la prueba pasa más de un minuto sin respirar y vitest la da por perdida.
const PAGINAS = process.env.CI ? 300 : 1000;
const temas = ['moon', 'sun', 'stars', 'planets', 'heavens', 'earth', 'sea', 'air', 'angels', 'spheres'];
const texto = (n: number) => Array.from({ length: 16 }, (_, i) =>
  `Paragraph ${i} of page ${n} on the ${temas[(n + i) % temas.length]} in the medieval model, ${'with a long gloss on the authorities and their readers '.repeat(4)}until the end`).join('\n\n');
/** La visión deja el titulillo dentro del texto: las tandas lo conservan y la consolidación lo quita, así que sus fragmentos provisionales sobran. */
const leida = (n: number) => paginaLeida(n, `THE DISCARDED IMAGE\n\n${texto(n)}`, { idioma: 'en', cabecera: 'THE DISCARDED IMAGE' });

/** Cuenta las sentencias y el máximo de parámetros que llegan al puerto. */
function medir(sql: SQL, consultas: string[] = []): { sql: SQL; max: () => number; consultas: string[] } {
  let max = 0;
  const medido: SQL = {
    async ejecutar<T>(consulta: string, ...p: ValorSQL[]) { consultas.push(consulta); max = Math.max(max, p.length); return sql.ejecutar<T>(consulta, ...p); },
    async transaccion<T>(fn: (s: SQL) => Promise<T>) { return sql.transaccion((tx) => fn(tx === sql ? medido : medir(tx, consultas).sql)); },
  };
  return { sql: medido, max: () => max, consultas };
}

describe('documento grande bajo el límite de 100 parámetros', () => {
  it('sqlConLimite falla como un Durable Object', async () => {
    const { sql } = await baseReal();
    const ids = Array.from({ length: MAX_PARAMETROS_SQL + 1 }, (_, i) => `x${i}`);
    await expect(sql.ejecutar(`SELECT id FROM fragmentos WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids)).rejects.toThrow(/too many SQL variables/);
    await expect(sql.transaccion((tx) => tx.ejecutar(`SELECT id FROM fragmentos WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids))).rejects.toThrow(/too many SQL variables/);
  });

  it(`ingesta, consolidación, hidratación y búsqueda de ${PAGINAS} páginas`, async () => {
    const base = await baseReal();
    const m = medir(base.sql);
    const paginas = Array.from({ length: PAGINAS }, (_, i) => paginaPdf(i + 1, '', { clase: 'pdf_escaneado' }));
    const paquete = paquetePdf(paginas, { metadatos: { titulo: 'The Discarded Image' } });
    // Un escaneado: lo lee la visión, por tandas, y la consolidación lo rehace entero.
    const lector = lectorFalso('vision', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => leida(d + i)));
    const r = await ejecutarIngesta(paquete, { inteligencia: inteligenciaFalsa({ lector }), fuente: fuenteFalsa, sql: m.sql }, { sinVerificacion: true, documentoId: 'grande' });

    expect(r.unidades).toHaveLength(PAGINAS);
    expect(r.fragmentos.length).toBeGreaterThanOrEqual(PAGINAS * 2);
    expect(m.max()).toBeLessThanOrEqual(MAX_PARAMETROS_SQL);
    // La consolidación borró los provisionales sobrantes (los del titulillo), cientos de una vez.
    expect(m.consultas.filter((c) => /DELETE FROM fragmentos WHERE id IN/.test(c)).length).toBeGreaterThan(0);
    const n = async (q: string, ...p: ValorSQL[]) => Number((await base.filas<{ n: number }>(q, ...(p as string[])))[0]?.n);
    expect(await n('SELECT count(*) AS n FROM fragmentos WHERE documento = ?', 'grande')).toBe(r.fragmentos.length);
    expect(await n('SELECT count(*) AS n FROM unidades WHERE documento = ?', 'grande')).toBe(PAGINAS);

    // Hidratación de la búsqueda con listas de miles de ids.
    const sql = base.sql;
    const est = new Estanteria(sql);
    const ids = r.fragmentos.map((f) => f.id);
    expect((await est.fragmentos(ids)).size).toBe(ids.length);
    const unidades = (await sql.ejecutar<{ id: string }>('SELECT id FROM unidades WHERE documento = ?', 'grande')).map((u) => u.id);
    expect((await est.unidadesExisten(unidades)).size).toBe(PAGINAS);
    expect((await est.fragmentosDeUnidades(unidades)).length).toBe(ids.length);
    expect(await est.figuras(ids)).toEqual([]);
    const muchosDocs = new Set(['grande', ...Array.from({ length: 600 }, (_, i) => `otro${i}`)]);
    expect((await est.lexica('"medieval"', 20, new Set([...muchosDocs].slice(0, 400)))).length).toBe(20);
    expect((await buscarTexto(sql, 'medieval', { documentos: [...muchosDocs] })).length).toBeGreaterThan(0);
    expect((await leerVectores(sql, { espacio: embebedorFalso.espacio.id, objetivo: 'fragmento', ids })).length).toBe(ids.length);

    // El buscador entero, con muchos resultados que hidratar.
    const buscador = new Buscador({
      sql, embebedor: embebedorFalso, indice: new IndiceVectorialSQL(sql, embebedorFalso.espacio),
      redactor: new RedactorFalso(0), reordenador: new ReordenadorFalso(0), juez: new JuezFalso(0), espacioNombres: 'pruebas',
    });
    const b = await buscador.buscar('medieval model heavens', { limite: 150, filtros: { documentos: [...muchosDocs] } });
    expect(b.resultados.length).toBeGreaterThan(0);
  }, 180_000);
});
