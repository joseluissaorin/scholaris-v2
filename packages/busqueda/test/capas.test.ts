import { describe, expect, it } from 'vitest';
import type { Ficha, Segmento } from '@scholaris/nucleo';
import { vectorABytes } from '@scholaris/nucleo';
import { escribirFichas, escribirSegmentos } from '@scholaris/spdf';
import { anclaEnTramo, Buscador, buscarEnCapas, evidenciaDeResultado, IndiceVectorialSQL } from '../src/index.js';
import { EmbebedorFalso } from './apoyo/falsos.js';
import { cargarFixtura, pag } from './apoyo/fixtura.js';
import { crearSQL } from './apoyo/sql-node.js';

async function montar(version: '4.1' | '4.2') {
  const sql = crearSQL(version);
  const embebedor = new EmbebedorFalso(0);
  await cargarFixtura(sql, embebedor);
  const indice = new IndiceVectorialSQL(sql, embebedor.espacio);
  const buscador = new Buscador({ sql, embebedor, indice, espacioNombres: 'pruebas' });
  return { sql, embebedor, indice, buscador };
}

const ficha = (x: Partial<Ficha> & Pick<Ficha, 'id' | 'texto'>): Ficha => ({
  documento: 'doc-quijote', objetivo: 'segmento', objetivoId: 'seg-molinos', lente: 'narrativa', clase: 'capitulo', idioma: 'es',
  datos: {}, evidencias: [], modelo: 'prueba', version: '1', creada: '2026-11-04T10:00:00Z', ...x,
});

describe('búsqueda por capas', () => {
  it('sin tablas de comprensión (estantería 4.1) solo hay capa literal, sin avisos de error', async () => {
    const { buscador } = await montar('4.1');
    const r = await buscarEnCapas(buscador, 'molinos de viento gigantes', { limite: 5 });
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.every((x) => x.capa === 'literal')).toBe(true);
    expect(r.fichas).toBe(0);
    expect(r.avisos.filter((a) => /Fichas/.test(a))).toEqual([]);
    const primero = r.resultados[0]!;
    expect(primero.evidencias[0]).toMatchObject({ documento: primero.capa === 'literal' ? primero.documento.id : '', modo: 'texto' });
    expect(primero.evidencias[0]!.cita!.length).toBeGreaterThan(10);
  });

  it('con las tablas vacías también funciona', async () => {
    const { buscador } = await montar('4.2');
    const r = await buscarEnCapas(buscador, 'libertad', { limite: 5 });
    expect(r.resultados.length).toBeGreaterThan(0);
    expect(r.resultados.every((x) => x.capa === 'literal')).toBe(true);
  });

  it('funde fichas (FTS y vectores) con la capa literal; cada ficha arrastra sus evidencias', async () => {
    const { sql, buscador, embebedor } = await montar('4.2');
    const seg: Segmento = {
      id: 'seg-molinos', documento: 'doc-quijote', padre: null, nivel: 1, orden: 3, tipo: 'capitulo', titulo: 'Capítulo VIII',
      ancla: pag(153, '139'), unidadDesde: 'un-q-139', unidadHasta: 'un-q-139', origen: 'leido', confianza: 1,
    };
    await escribirSegmentos(sql, [seg]);
    const f1 = ficha({
      id: 'fi-molinos', texto: 'El episodio de los molinos convierte la locura del hidalgo en método: donde Sancho ve molinos, don Quijote ve gigantes.',
      evidencias: [{ documento: 'doc-quijote', ancla: { ...pag(153, '139'), caracteres: [0, 40] }, cita: 'En esto, descubrieron treinta o cuarenta molinos', modo: 'texto', fragmento: 'fr-q-04', unidad: 'un-q-139' }],
    });
    const f2 = ficha({ id: 'fi-otra', objetivo: 'documento', objetivoId: 'doc-quijote', clase: 'global', texto: 'Novela de caballerías paródica.' });
    await escribirFichas(sql, [f1, f2]);
    const [v] = await embebedor.vectorizar([{ modalidad: 'texto', texto: f1.texto }], 'documento');
    await sql.ejecutar(`INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('ficha', ?, ?, ?, ?)`, f1.id, embebedor.espacio.id, 'doc-quijote', vectorABytes(v!));
    const r = await buscarEnCapas(buscador, 'molinos gigantes', { limite: 8 });
    const c = r.resultados.find((x) => x.capa === 'comprension');
    expect(c).toBeDefined();
    if (c?.capa !== 'comprension') throw new Error('sin ficha');
    expect(c.ficha.id).toBe('fi-molinos');
    expect(c.segmento?.tipo).toBe('capitulo');
    expect(c.evidencias[0]?.ancla).toMatchObject({ fisica: 153, caracteres: [0, 40] });
    expect(c.resaltado).toContain('<mark>');
    expect(r.resultados.some((x) => x.capa === 'literal')).toBe(true);

    // Solo la capa de comprensión, y filtrada por tipo de segmento.
    const solo = await buscarEnCapas(buscador, 'molinos gigantes', { capas: ['comprension'], filtros: { tipoSegmento: 'escena' } });
    expect(solo.resultados).toEqual([]);
    const capitulos = await buscarEnCapas(buscador, 'molinos gigantes', { capas: ['comprension'], filtros: { tipoSegmento: 'capitulo' } });
    expect(capitulos.resultados.map((x) => x.id)).toEqual(['fi-molinos']);
    // Por tramo de páginas: fuera del tramo no hay ficha.
    const fuera = await buscarEnCapas(buscador, 'molinos gigantes', { capas: ['comprension'], filtros: { paginas: [1, 10] } });
    expect(fuera.resultados).toEqual([]);
    // Por documento: otro documento, nada.
    const otro = await buscarEnCapas(buscador, 'molinos gigantes', { capas: ['comprension'], filtros: { documentos: ['doc-darwin'] } });
    expect(otro.resultados).toEqual([]);
  });

  it('filtra la capa literal por tramo de páginas', async () => {
    const { buscador } = await montar('4.1');
    const r = await buscarEnCapas(buscador, 'molinos gigantes libertad', { capas: ['literal'], filtros: { paginas: [247, 247] }, limite: 10 });
    expect(r.resultados.length).toBeGreaterThan(0);
    for (const x of r.resultados) if (x.capa === 'literal') expect(x.resultado.fragmento.ancla).toMatchObject({ fisica: 247 });
  });

  it('anclaEnTramo y evidenciaDeResultado', () => {
    expect(anclaEnTramo({ tipo: 'tiempo', t0: 10, t1: 20 }, undefined, { tiempo: [15, 30] })).toBe(true);
    expect(anclaEnTramo({ tipo: 'tiempo', t0: 10, t1: 20 }, undefined, { tiempo: [21, 30] })).toBe(false);
    expect(anclaEnTramo(pag(5, '3'), pag(7, '5'), { paginas: [6, 9] })).toBe(true);
    expect(anclaEnTramo(pag(5, '3'), undefined, { tiempo: [0, 9] })).toBe(false);
    const e = evidenciaDeResultado({
      fragmento: { id: 'f', documento: 'd', unidad: 'u', orden: 0, texto: 'Hola, mundo.', contexto: '', seccion: [], ancla: { tipo: 'tiempo', t0: 1, t1: 4 } },
      documento: { id: 'd', tipo: 'video', metadatos: { titulo: 'T', autores: [] } }, puntuacion: 1, vias: ['lexica'],
      pasaje: { texto: 'Hola, mundo.', desde: 0, hasta: 12, ancla: { tipo: 'tiempo', t0: 1.5, t1: 2.5 } },
    });
    expect(e).toMatchObject({ documento: 'd', modo: 'audio', ancla: { t0: 1.5 }, fragmento: 'f', unidad: 'u', cita: 'Hola, mundo.' });
  });
});
