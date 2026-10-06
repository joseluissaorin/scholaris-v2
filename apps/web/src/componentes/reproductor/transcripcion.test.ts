import { describe, expect, it } from 'vitest';
import type { UnidadVista } from '@scholaris/contrato';
import { aVtt, buscarEnTranscripcion, buscarIndice, construirTranscripcion, densidad, lineaEn, palabraEn, parrafoEn, pasaje, silabas } from './transcripcion';
import { instanteLinea } from './teclado';

const unidad = (orden: number, t0: number, t1: number, texto: string, hablante?: string): UnidadVista => ({
  id: `u${orden}`, orden, etiqueta: '', lector: 'transcripcion', confianza: 0.9, texto,
  ancla: { tipo: 'tiempo', t0, t1, ...(hablante ? { hablante } : {}) },
});

const UNIDADES = [
  unidad(1, 52.4, 105.9, 'Nos sentimos especialmente felices esta noche porque hemos culminado una larga tarea, una pesquisa.', 'Joaquín Soler Serrano'),
  unidad(2, 106.2, 159.5, '**Joaquín Soler Serrano:** Lo agradecemos mucho, querido Julio Cortázar.\n\n**Julio Cortázar:** Bueno, pues aquí me tienes.\n\n**Joaquín Soler Serrano:** Vamos a ver, Julio.', 'Joaquín Soler Serrano'),
  unidad(3, 159.5, 208.6, '**Julio Cortázar:** Es verdad. Las circunstancias de mi nacimiento fueron nada extraordinarias.', 'Julio Cortázar'),
];

describe('transcripción', () => {
  const tr = construirTranscripcion(UNIDADES);

  it('las marcas de turno se convierten en hablantes, no en texto', () => {
    expect(tr.hablantes).toEqual(['Joaquín Soler Serrano', 'Julio Cortázar']);
    expect(tr.palabras.some((w) => w.texto.includes('**'))).toBe(false);
    expect(tr.palabras.find((w) => w.texto === 'Bueno,')?.h).toBe(1);
    expect(tr.palabras.find((w) => w.texto === 'agradecemos')?.h).toBe(0);
  });

  it('los instantes de las palabras crecen y no se salen de su tramo', () => {
    for (let i = 1; i < tr.palabras.length; i++) expect(tr.palabras[i]!.t0).toBeGreaterThanOrEqual(tr.palabras[i - 1]!.t0);
    for (const w of tr.palabras) { expect(w.t1).toBeGreaterThan(w.t0); expect(w.t0).toBeGreaterThanOrEqual(52.4); expect(w.t1).toBeLessThanOrEqual(208.6 + 1e-9); }
    const primera = tr.palabras[0]!, ultimaTramo1 = tr.palabras.filter((w) => tr.parrafos[w.p]!.orden === 1).at(-1)!;
    expect(primera.t0).toBeCloseTo(52.4);
    expect(ultimaTramo1.t1).toBeCloseTo(105.9);
  });

  it('los turnos dentro de un tramo abren párrafos con su hablante', () => {
    const delTramo2 = tr.parrafos.filter((p) => p.orden === 2);
    expect(delTramo2.map((p) => p.h)).toEqual([0, 1, 0]);
    // El primero del tramo 2 sigue al mismo hablante del tramo 1, pero va marcado: es un turno.
    expect(delTramo2[0]!.turno).toBe(true);
    expect(tr.turnos.map((t) => t.h)).toEqual([0, 1, 0, 1]);
  });

  it('la palabra que suena se encuentra por búsqueda binaria', () => {
    expect(palabraEn(tr, 0)).toBe(-1);
    expect(palabraEn(tr, 52.4)).toBe(0);
    for (const i of [3, 10, 20, tr.palabras.length - 1]) {
      const w = tr.palabras[i]!;
      expect(palabraEn(tr, (w.t0 + w.t1) / 2)).toBe(i);
    }
    // Un hueco largo sin voz no deja una palabra encendida.
    expect(palabraEn(tr, 250)).toBe(-1);
    expect(parrafoEn(tr, 250)).toBe(tr.parrafos.length - 1);
    expect(buscarIndice([1, 2, 3], 0.5)).toBe(-1);
    expect(buscarIndice([1, 2, 3], 2)).toBe(1);
    expect(buscarIndice([1, 2, 3], 9)).toBe(2);
  });

  it('busca sin tildes ni mayúsculas, por frases y con prefijo en la última palabra', () => {
    expect(buscarEnTranscripcion(tr.palabras, 'cortazar').length).toBe(1);
    expect(buscarEnTranscripcion(tr.palabras, 'JULIO cortáz').length).toBe(1);
    expect(buscarEnTranscripcion(tr.palabras, 'una').length).toBe(2);
    expect(buscarEnTranscripcion(tr.palabras, 'nada extra')[0]?.largo).toBe(2);
    expect(buscarEnTranscripcion(tr.palabras, '  ')).toEqual([]);
  });

  it('un pasaje seleccionado da su texto y su intervalo exacto', () => {
    const a = tr.palabras.findIndex((w) => w.texto === 'Bueno,');
    const b = tr.palabras.findIndex((w) => w.texto === 'tienes.');
    const x = pasaje(tr, b, a);
    expect(x.texto).toBe('Bueno, pues aquí me tienes.');
    expect(x.t0).toBe(tr.palabras[a]!.t0);
    expect(x.t1).toBe(tr.palabras[b]!.t1);
    expect(x.h).toBe(1);
  });

  it('las líneas de subtítulo no mezclan hablantes y el WebVTT es válido', () => {
    for (const l of tr.lineas) {
      const hs = new Set(tr.palabras.slice(l.desde, l.hasta).map((w) => w.h));
      expect(hs.size).toBe(1);
      expect(l.texto.length).toBeLessThanOrEqual(100);
    }
    const vtt = aVtt(tr);
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    expect(vtt).toMatch(/00:00:52\.400 --> 00:00:\d\d\.\d{3}/);
    expect(vtt).toContain('<v Julio Cortázar>');
    // Las marcas no se solapan.
    const marcas = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d{3}) --> (\d\d):(\d\d):(\d\d)\.(\d{3})/g)].map((m) => [Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000, Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000]);
    for (let i = 1; i < marcas.length; i++) expect(marcas[i]![0]!).toBeGreaterThanOrEqual(marcas[i - 1]![1]! - 1e-6);
  });

  it('Mayús ← / → saltan de línea en línea', () => {
    const l = tr.lineas;
    expect(instanteLinea(tr, l[0]!.t0 + 0.2, 1)).toBe(l[1]!.t0);
    expect(instanteLinea(tr, l[1]!.t0 + 0.2, -1)).toBe(l[0]!.t0);
    expect(instanteLinea(tr, l[1]!.t0 + 3, -1)).toBe(l[1]!.t0);
    expect(lineaEn(tr, l[2]!.t0)).toBe(2);
  });

  it('sílabas y densidad del habla', () => {
    expect(silabas('Cortázar')).toBe(3);
    expect(silabas('y')).toBe(1);
    const d = densidad(tr, 220, 22);
    expect(d.length).toBe(22);
    expect(Math.max(...d)).toBeCloseTo(1);
    expect(d[0]).toBe(0);
  });

  it('una transcripción de dos horas se construye y se consulta deprisa', () => {
    const muchas: UnidadVista[] = [];
    const frase = 'Pues yo creo que la literatura, como el jazz, es una forma de improvisación sobre un tema que uno conoce muy bien.';
    for (let i = 0; i < 150; i++) {
      const t0 = i * 48;
      muchas.push(unidad(i + 1, t0, t0 + 47, `**${i % 2 ? 'Julio Cortázar' : 'Joaquín Soler Serrano'}:** ${Array.from({ length: 6 }, () => frase).join(' ')}`));
    }
    const inicio = performance.now();
    const grande = construirTranscripcion(muchas);
    const construir = performance.now() - inicio;
    expect(grande.palabras.length).toBeGreaterThan(18_000);
    const t1 = performance.now();
    let n = 0;
    for (let k = 0; k < 10_000; k++) n += palabraEn(grande, (k * 0.72) % 7200) >= 0 ? 1 : 0;
    const consultas = performance.now() - t1;
    expect(n).toBeGreaterThan(9000);
    expect(construir).toBeLessThan(400);
    expect(consultas).toBeLessThan(50); // 10 000 fotogramas en menos de 50 ms
  });
});
