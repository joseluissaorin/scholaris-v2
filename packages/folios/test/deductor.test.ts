/**
 * El port de page_deducer.py debe comportarse como el original. Los casos
 * reproducen a mano lo que hace el Python con las mismas entradas.
 */
import { describe, expect, it } from 'vitest';
import { DeductorPaginas, detectarMarcadores } from '../src/deductor.js';

const anclas = (o: Record<number, number>) => new Map(Object.entries(o).map(([p, f]) => [Number(p), { folio: f, confianza: 0.95 }]));
const folios = (r: ReturnType<DeductorPaginas['deducir']>) => r.correspondencias.map((c) => c.folio);

describe('marcadores', () => {
  it('detecta capítulos, índices y prólogos en varias lenguas', () => {
    const m = detectarMarcadores(new Map([
      [1, 'ÍNDICE\nPrólogo ..... 7'],
      [2, 'PRÓLOGO\nEste libro'],
      [3, 'CAPÍTULO IV\nLa casa'],
      [4, '第三章 序'],
      [5, 'Bibliografía\nAutor'],
      [6, 'C H APTER 2 The beginning'],
      [7, 'Inhaltsverzeichnis'],
      [8, 'APPENDIX A'],
      [9, '<h1>Introduction</h1>'],
    ]));
    expect(Object.fromEntries(m)).toEqual({
      1: 'contents', 2: 'preface', 3: 'chapter_start', 4: 'chapter_start', 5: 'bibliography',
      6: 'chapter_start', 7: 'contents', 8: 'appendix', 9: 'introduction',
    });
  });
  it('el original toma «Del mismo modo» por un capítulo; el modo estricto no', () => {
    const t = new Map([[1, 'Del mismo modo que el anterior']]);
    expect(detectarMarcadores(t).get(1)).toBe('chapter_start');
    expect(detectarMarcadores(t, { estricto: true }).get(1)).toBeUndefined();
    expect(detectarMarcadores(new Map([[1, 'Parte II. La ciudad']]), { estricto: true }).get(1)).toBe('chapter_start');
  });
});

describe('DeductorPaginas (port fiel)', () => {
  const d = new DeductorPaginas();

  it('sin páginas: estrategia ninguno', () => {
    expect(d.deducir({ totalPaginas: 0 }).estrategia).toBe('ninguno');
  });

  it('sin anclas ni marcadores numera 1..N y declara «ninguno» (como v3)', () => {
    const r = d.deducir({ totalPaginas: 5 });
    expect(r.estrategia).toBe('ninguno');
    expect(folios(r)).toEqual([1, 2, 3, 4, 5]);
  });

  it('romanos y arábigos: frontera entre anclas, portada sin número', () => {
    const r = d.deducir({ totalPaginas: 20, anclas: anclas({ 3: -3, 10: 1, 15: 6 }) });
    expect(r.transicion).toBe(10);
    expect(folios(r)).toEqual([null, null, -3, -4, -5, -6, -7, -8, -9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(r.correspondencias[0]?.tipo).toBe('portada');
    expect(r.correspondencias[2]).toMatchObject({ origen: 'detectado', confianza: 0.9 });
    expect(r.correspondencias[3]).toMatchObject({ origen: 'deducido', confianza: 0.7 });
  });

  it('las páginas con texto antes del primer romano también cuentan', () => {
    const textos = new Map([[1, 'x'.repeat(10)], [2, 'y'.repeat(80)], [3, 'z'.repeat(80)]]);
    const r = d.deducir({ totalPaginas: 12, anclas: anclas({ 4: -4, 8: 1 }), textos });
    expect(r.primeraNumerada).toBe(2);
  });

  it('sin anclas romanas sintetiza los preliminares desde la primera página con texto', () => {
    const textos = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, i === 0 ? 'Cubierta' : 'texto '.repeat(20)] as [number, string]));
    const r = d.deducir({ totalPaginas: 12, anclas: anclas({ 6: 1, 9: 4 }), textos });
    expect(r.transicion).toBe(6);
    expect(folios(r)).toEqual([null, -1, -2, -3, -4, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('un romano en una página de «CHAPTER I» se reclasifica como arábigo', () => {
    const textos = new Map([[8, 'CHAPTER I\nThe Medieval Situation']]);
    const r = d.deducir({ totalPaginas: 12, anclas: anclas({ 8: -1 }), textos });
    expect(r.anclasArabigas.get(8)).toBe(1);
    expect(r.anclasRomanas.size).toBe(0);
  });

  it('filtra anclas imposibles (años) e inconsistentes', () => {
    const r = d.deducir({ totalPaginas: 50, anclas: anclas({ 10: 1962, 20: 15, 21: 16, 22: 17, 23: 90, 30: 25 }) });
    expect(r.anclasArabigas.has(10)).toBe(false);
    expect(r.anclasArabigas.has(23)).toBe(false);
    expect(r.anclasArabigas.get(20)).toBe(15);
  });

  it('doble página: dos folios por página física', () => {
    const r = d.deducir({ totalPaginas: 6, disposicion: 'TWO_UP', anclas: anclas({ 3: 4 }) });
    expect(r.correspondencias[2]?.folios).toEqual([4, 5]);
    expect(r.correspondencias[3]?.folios).toEqual([6, 7]);
    const rtl = d.deducir({ totalPaginas: 6, disposicion: 'TWO_UP_RTL', anclas: anclas({ 3: 4 }) });
    expect(rtl.correspondencias[3]?.folios).toEqual([7, 6]);
  });

  it('las zonas del VLM generan anclas', () => {
    const r = d.deducir({
      totalPaginas: 30,
      zonas: [
        { tipo: 'roman', desde: 3, hasta: 9, desplazamiento: -2, confianza: 0.9 },
        { tipo: 'arabic', desde: 10, hasta: 30, desplazamiento: -9, confianza: 0.9 },
      ],
      transiciones: [10],
    });
    expect(r.transicion).toBe(10);
    expect(r.correspondencias[9]?.folio).toBe(1);
    expect(r.correspondencias[2]?.folio).toBe(-1);
  });

  it('la transición del VLM pesa más que los marcadores', () => {
    const textos = new Map([[12, 'CHAPTER 1']]);
    expect(d.buscarTransicion(30, new Map(), new Map(), new Map([[12, 'chapter_start']]), [9], 1)).toBe(9);
    expect(d.deducir({ totalPaginas: 30, textos }).transicion).toBe(12);
  });

  it('el ancla manda sobre el cálculo (validación)', () => {
    const r = d.deducir({ totalPaginas: 10, anclas: anclas({ 2: 1, 3: 2, 4: 3 }) });
    expect(r.estrategia).toBe('deducido');
    expect(folios(r).slice(1, 4)).toEqual([1, 2, 3]);
  });
});
