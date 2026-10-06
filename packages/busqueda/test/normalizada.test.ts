/** Vía léxica con la capa de ortografía modernizada (SPDF 4.1). */
import type { Documento, Fragmento } from '@scholaris/nucleo';
import { escribirDocumento, escribirFragmentos } from '@scholaris/spdf';
import { describe, expect, it } from 'vitest';
import { Buscador, consultaFts } from '../src/index.js';
import { crearSQL } from './apoyo/sql-node.js';

const pagina = (fisica: number) => ({ tipo: 'pagina' as const, fisica, impresa: String(fisica), romana: false, origen: 'leido' as const, confianza: 1 });
const documento = (id: string, idioma: string, anio?: number): Documento => ({
  id, tipo: 'pdf', metadatos: { titulo: id, autores: [], idioma, ...(anio ? { anio } : {}) },
  estado: 'listo', huella: id, original: '', mime: 'application/pdf', bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [],
});
const fragmentos = (doc: string, textos: string[]): Fragmento[] =>
  textos.map((texto, i) => ({ id: `${doc}-${i}`, documento: doc, unidad: `${doc}-u`, orden: i, texto, contexto: '', seccion: [], ancla: pagina(i + 1) }));

// Textos literales: Argote de Molina, «Discurso sobre el Libro de la Montería» (1582), con su grafía, de
// https://es.wikisource.org/wiki/Libro_de_la_monteria/Discurso ; Cervantes, «Don Quijote» (Project Gutenberg n.º 2000);
// Darwin, «On the Origin of Species» (1859, Project Gutenberg n.º 1228).
async function estanteria() {
  const sql = crearSQL();
  await escribirDocumento(sql, documento('argote', 'es'));
  await escribirDocumento(sql, documento('quijote', 'es', 1605));
  await escribirDocumento(sql, documento('darwin', 'en', 1859));
  await escribirFragmentos(sql, fragmentos('argote', [
    "prenden a los que hallan en palacio, y no pudiendo prenderlos, puedē matarlos, ſi con rieſgo de muerte ſe les defienden",
    "el qual apedimiento del reyno eſtablecio ley del numero dellos que dize aſsi.",
    "Don Sancho Fernandez, hijo del famoſo Conde Fernan Gonçalez, y de la Condeſſa Doña Sancha ſu muger, la qual deſſeando caſar con vn Rey Moro",
  ]));
  await escribirFragmentos(sql, fragmentos('quijote', ["La libertad, Sancho, es uno de los más preciosos dones que a los hombres dieron los cielos; con ella no pueden igualarse los tesoros que encierra la tierra ni el mar encubre; por la libertad, así como por la honra, se puede y debe aventurar la vida, y, por el contrario, el cautiverio es el mayor mal que puede venir a los hombres."]));
  await escribirFragmentos(sql, fragmentos('darwin', ["On the other hand, we may feel sure that any variation in the least degree injurious would be rigidly destroyed. This preservation of favourable variations and the rejection of injurious variations, I call Natural Selection."]));
  return sql;
}

const ids = (r: { resultados: Array<{ fragmento: Fragmento }> }) => r.resultados.map((x) => x.fragmento.id).sort();

describe('vía léxica normalizada', () => {
  it('consultaFts añade las variantes solo en la capa normalizada', () => {
    expect(consultaFts('honra')).toBe('"honra"');
    expect(consultaFts('honra', { normalizada: true })).toBe('("honra" OR texto_busqueda : ("onra" OR "honr"))');
    expect(consultaFts('«así es la vida»', { normalizada: true })).toBe('("asi es la vida" OR texto_busqueda : ("asi es la bida" OR "asi es la uida"))');
    expect(consultaFts('NEAR(a b) OR "x', { normalizada: true })).not.toMatch(/NEAR\(/);
  });

  it('la grafía moderna encuentra el texto antiguo y no rompe lo moderno', async () => {
    const b = new Buscador({ sql: await estanteria() });
    const lex = { vias: ['lexica' as const], limite: 10 };
    expect(ids(await b.buscar('riesgo de muerte', lex))).toEqual(['argote-0']);
    expect(ids(await b.buscar('mujer', lex))).toEqual(['argote-2']);
    expect(ids(await b.buscar('famoso conde', lex))).toEqual(['argote-2']);
    expect(ids(await b.buscar('estableció ley', lex))).toEqual(['argote-1']);
    expect(ids(await b.buscar('aventurar la vida', lex))).toEqual(['quijote-0']);
    expect(ids(await b.buscar('natural selection', lex))).toEqual(['darwin-0']);
  });

  it('las citas literales siguen yendo al texto fiel, y también casan con la capa', async () => {
    const b = new Buscador({ sql: await estanteria() });
    expect(ids(await b.buscar('«Doña Sancha»', { vias: ['lexica'] }))).toEqual(['argote-2']);
    expect(ids(await b.buscar('«riesgo de muerte»', { vias: ['lexica'] }))).toEqual(['argote-0']);
  });

  it('una estantería sin migrar (4.0) busca como antes', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { readFileSync } = await import('node:fs');
    const bd = new DatabaseSync(':memory:');
    bd.exec(readFileSync(new URL('../../spdf/esquema/v4.0.sql', import.meta.url), 'utf8'));
    bd.exec(`INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, creado, actualizado) VALUES ('d', 'pdf', '{"titulo":"t","autores":[]}', 'listo', 'h', '', 'x', 1, 'x', 'x')`);
    bd.exec(`INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla) VALUES ('d-0', 'd', 'u', 0, 'la honra del rey', '', '[]', '{"tipo":"pagina","fisica":1,"impresa":"1","romana":false,"origen":"leido","confianza":1}')`);
    const sql = { async ejecutar<T>(c: string, ...p: unknown[]) { return bd.prepare(c).all(...(p as never[])) as T[]; }, async transaccion<T>(fn: (s: never) => Promise<T>) { return fn(sql as never); } };
    const b = new Buscador({ sql });
    expect(ids(await b.buscar('honra', { vias: ['lexica'] }))).toEqual(['d-0']);
  });
});
