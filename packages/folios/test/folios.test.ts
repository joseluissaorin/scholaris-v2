import { describe, expect, it } from 'vitest';
import { aAncla, deducirFolios } from '../src/folios.js';
import { elegirSecuencia, enlace, estimarPaso } from '../src/secuencia.js';
import { extraerCandidatos } from '../src/candidatos.js';
import type { PaginaFolio } from '../src/tipos.js';
import { acierto, libroSintetico, type OpcionesLibro } from './libro-sintetico.js';

function probar(o: OpcionesLibro, semillas = 12) {
  let peor = 1;
  let peorErrores: unknown = null;
  for (let s = 1; s <= semillas; s++) {
    const l = libroSintetico({ semilla: s, ...o });
    const r = deducirFolios(l.paginas);
    const a = acierto(r.paginas.map((p) => p.impresa), l.verdad);
    if (a.acierto < peor) { peor = a.acierto; peorErrores = { semilla: s, errores: a.errores.slice(0, 8) }; }
  }
  return { peor, peorErrores };
}

describe('libros sintéticos (sin juez)', () => {
  it('preliminares en romanos y cuerpo en arábigos', () => {
    const l = libroSintetico({ semilla: 1, romanos: 12, cuerpo: 200, lectura: 0.7 });
    const r = deducirFolios(l.paginas);
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBe(1);
    expect(r.paginas[0]).toMatchObject({ impresa: null, origen: 'ninguno', tipoPagina: 'portada' });
    const xii = r.paginas.find((p) => p.impresa === 'xii');
    expect(xii).toMatchObject({ romana: true, tipoPagina: 'preliminar' });
    expect(r.paginas.find((p) => p.impresa === '1')?.fisica).toBe(15);
    expect(r.transicion).toBe(15);
    expect(r.estrategia).toBe('leido');
  });

  it('muchas semillas, lecturas al 50 %', () => {
    expect(probar({ romanos: 10, cuerpo: 180, lectura: 0.5 }).peor).toBe(1);
  });

  it('pocas lecturas (una de cada quince páginas)', () => {
    const { peor, peorErrores } = probar({ romanos: 10, cuerpo: 200, lectura: 0.07 });
    expect(peor, JSON.stringify(peorErrores)).toBe(1);
  });

  it('láminas sin numerar ni contar', () => {
    const l = libroSintetico({ semilla: 4, romanos: 8, cuerpo: 150, lectura: 0.6, laminasTras: [40, 41, 90] });
    const r = deducirFolios(l.paginas);
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBe(1);
    for (const i of l.laminas) {
      expect(r.paginas[i]).toMatchObject({ impresa: null, origen: 'ninguno', tipoPagina: 'lamina' });
    }
    expect(r.avisos.some((a) => a.includes('láminas'))).toBe(true);
    expect(probar({ romanos: 8, cuerpo: 150, lectura: 0.4, laminasTras: [30, 75, 76, 120] }).peor).toBe(1);
  });

  it('errores de OCR («l23», cifras cambiadas) y notas al pie', () => {
    const { peor, peorErrores } = probar({ romanos: 6, cuerpo: 150, lectura: 0.7, errorOcr: 0.1, notas: 0.4 });
    expect(peor, JSON.stringify(peorErrores)).toBeGreaterThanOrEqual(0.98);
  });

  it('número en la cabecera corrida, capítulos sin número y años en la cabecera', () => {
    const { peor, peorErrores } = probar({ romanos: 6, cuerpo: 150, lectura: 0.6, posicion: 'cabecera', capituloCada: 15, notas: 0.3 });
    expect(peor, JSON.stringify(peorErrores)).toBe(1);
  });

  it('el lector da el folio directamente', () => {
    expect(probar({ romanos: 6, cuerpo: 120, lectura: 0.8, posicion: 'lector' }).peor).toBe(1);
  });

  it('el número solo aparece al final del texto (lector que no separa el pie)', () => {
    const { peor, peorErrores } = probar({ romanos: 6, cuerpo: 120, lectura: 0.7, posicion: 'texto', notas: 0.2 });
    expect(peor, JSON.stringify(peorErrores)).toBeGreaterThanOrEqual(0.97);
  });

  it('romanos en mayúsculas se devuelven en mayúsculas', () => {
    const l = libroSintetico({ semilla: 2, romanos: 14, romanosMayusculas: true, cuerpo: 40, lectura: 0.8 });
    const r = deducirFolios(l.paginas);
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBe(1);
    expect(r.paginas.some((p) => p.impresa === 'XIV')).toBe(true);
  });

  it('doble página: dos folios por imagen', () => {
    const l = libroSintetico({ semilla: 3, cuerpo: 120, lectura: 0.6, doble: true });
    const r = deducirFolios(l.paginas);
    expect(r.disposicion).toBe('doble');
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBe(1);
    const p = r.paginas.find((x) => x.impresa === '11');
    expect(p?.impresas).toEqual(['11', '12']);
    expect(probar({ cuerpo: 120, lectura: 0.4, doble: true }).peor).toBe(1);
  });

  it('doble página declarada de derecha a izquierda', () => {
    const l = libroSintetico({ semilla: 3, cuerpo: 40, lectura: 0.8, doble: true });
    const r = deducirFolios(l.paginas, { disposicion: 'doble_rtl' });
    const p = r.paginas.find((x) => x.impresas?.[1] === '11');
    expect(p?.impresas).toEqual(['12', '11']);
  });

  it('libro del siglo XVII foliado: número solo en el recto', () => {
    const l = libroSintetico({ semilla: 5, cubierta: 3, cuerpo: 120, lectura: 0.6, foliacion: true });
    const r = deducirFolios(l.paginas);
    expect(r.foliacion).toBe(true);
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBe(1);
    expect(r.paginas.map((p) => p.impresa).slice(3, 7)).toEqual(['1r', '1v', '2r', '2v']);
    expect(probar({ cubierta: 2, cuerpo: 120, lectura: 0.5, foliacion: true }).peor).toBe(1);
  });

  it('artículo que empieza en la página 434', () => {
    const l = libroSintetico({ semilla: 1, cubierta: 0, cuerpo: 12, primerFolio: 434, lectura: 0.6 });
    const r = deducirFolios(l.paginas);
    expect(r.paginas.map((p) => p.impresa)).toEqual(l.verdad);
    expect(r.transicion).toBeNull();
  });

  it('sin ninguna lectura no se inventa la numeración', () => {
    const l = libroSintetico({ semilla: 1, romanos: 4, cuerpo: 30, lectura: 0 });
    const r = deducirFolios(l.paginas);
    expect(r.estrategia).toBe('ninguno');
    expect(r.paginas.every((p) => p.impresa === null && p.origen === 'ninguno')).toBe(true);
    // …salvo que se pida el comportamiento de v3
    const v3 = deducirFolios(l.paginas, { numerarSinLecturas: true });
    expect(v3.paginas.some((p) => p.impresa !== null)).toBe(true);
    expect(v3.paginas.every((p) => p.confianza <= 0.3)).toBe(true);
  });

  it('una única lectura débil no basta; una fuerte sí', () => {
    const paginas: PaginaFolio[] = Array.from({ length: 10 }, (_, i) => ({ fisica: i + 1, texto: 'texto '.repeat(40) }));
    (paginas[4] as PaginaFolio).texto += '\n17';
    expect(deducirFolios(paginas).estrategia).toBe('ninguno');
    (paginas[4] as PaginaFolio).pie = '— 17 —';
    const r = deducirFolios(paginas);
    expect(r.paginas[4]).toMatchObject({ impresa: '17', origen: 'leido' });
    expect(r.paginas[5]).toMatchObject({ impresa: '18', origen: 'deducido' });
  });

  it('la confianza refleja el origen', () => {
    const l = libroSintetico({ semilla: 1, romanos: 6, cuerpo: 60, lectura: 0.5 });
    const r = deducirFolios(l.paginas);
    for (const p of r.paginas) {
      if (p.origen === 'leido') expect(p.confianza).toBeGreaterThanOrEqual(0.85);
      if (p.origen === 'deducido') expect(p.confianza).toBeLessThanOrEqual(0.95);
      if (p.impresa === null && p.tipoPagina !== 'portada') expect(p.origen).toBe('ninguno');
    }
  });

  it('aAncla devuelve un AnclaPagina limpio', () => {
    const l = libroSintetico({ semilla: 1, romanos: 2, cuerpo: 10, lectura: 0.9 });
    const r = deducirFolios(l.paginas);
    const a = aAncla(r.paginas[5]!);
    expect(Object.keys(a).sort()).toEqual(['confianza', 'fisica', 'impresa', 'origen', 'romana', 'tipo']);
    expect(a.tipo).toBe('pagina');
  });

  it('las páginas pueden llegar desordenadas', () => {
    const l = libroSintetico({ semilla: 9, romanos: 4, cuerpo: 40, lectura: 0.6 });
    const r = deducirFolios([...l.paginas].reverse());
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBe(1);
  });

  it('un libro de 1200 páginas se resuelve en poco tiempo', () => {
    const l = libroSintetico({ semilla: 5, romanos: 24, cuerpo: 1200, lectura: 0.6, errorOcr: 0.05, notas: 0.4, laminasTras: [100, 300, 301, 700] });
    const t = performance.now();
    const r = deducirFolios(l.paginas);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto).toBeGreaterThan(0.995);
  });
});

describe('secuencia', () => {
  const c = (valor: number, romana = false, peso = 0.9) => ({ valor, romana, mayusculas: false, texto: String(valor), fuente: 'pie' as const, peso, corregido: false });

  it('enlaces: cuadra, lámina, hoja que falta, transición, ruptura', () => {
    expect(enlace(c(10), c(12), 2, 1)).toBe(1);
    expect(enlace(c(10), c(11), 2, 1)).toBeLessThan(0);
    expect(enlace(c(10), c(11), 2, 1)).toBeGreaterThan(-3);
    expect(enlace(c(10), c(13), 2, 1)).toBeLessThan(0);
    expect(enlace(c(9, true), c(1), 3, 1)).toBeGreaterThan(0);
    expect(enlace(c(9), c(2, true), 3, 1)).toBe(-3);
    expect(enlace(c(10), c(50), 2, 1)).toBe(-3);
  });

  it('deja fuera el número que no cuadra aunque pese más', () => {
    const cands = [[c(5)], [c(6)], [c(99, false, 1)], [c(8)], [c(9)]];
    const r = elegirSecuencia(cands, { paso: 1 });
    expect(r.elegidos).toEqual([0, 0, null, 0, 0]);
    expect(r.apoyos[0]).toBe(1);
    expect(r.apoyos[1]).toBe(2);
  });

  it('estima el paso: simple, doble, foliación', () => {
    const simple = Array.from({ length: 10 }, (_, i) => [c(i + 1)]);
    expect(estimarPaso(simple).paso).toBe(1);
    const doble = Array.from({ length: 10 }, (_, i) => [c(2 * i + 1)]);
    expect(estimarPaso(doble).paso).toBe(2);
    const folio = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? [c(i / 2 + 1)] : []));
    expect(estimarPaso(folio).paso).toBe(0.5);
  });

  it('extraerCandidatos + secuencia en un caso real de OCR: «8I» es la 81', () => {
    const pags: PaginaFolio[] = [
      { fisica: 92, pie: '79' }, { fisica: 93, pie: '80' }, { fisica: 94, pie: '6 8I LDI' }, { fisica: 95, pie: '82' },
    ];
    const r = deducirFolios(pags);
    expect(r.paginas.map((p) => p.impresa)).toEqual(['79', '80', '81', '82']);
    expect(r.paginas[2]?.elegido?.corregido).toBe(true);
  });

  it('extraerCandidatos no se fía de un 5 aislado en una página de la 65', () => {
    const pags: PaginaFolio[] = [
      { fisica: 76, folio: '63' }, { fisica: 77, folio: '64' }, { fisica: 78, folio: '5', pie: '65 | LDI' }, { fisica: 79, folio: '66' },
    ];
    expect(extraerCandidatos(pags[2]!).map((x) => x.valor)).toEqual(expect.arrayContaining([5, 65]));
    expect(deducirFolios(pags).paginas[2]?.impresa).toBe('65');
  });
});
