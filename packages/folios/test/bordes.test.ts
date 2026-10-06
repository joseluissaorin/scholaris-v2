/**
 * Lo que queda fuera del cuerpo numerado no lleva folio: sobrecubiertas,
 * tapas, guardas y contratapas en blanco. Casos del banco de calidad
 * (bench/calidad/folios.json): la sobrecubierta de *The Discarded Image*
 * («dj A/B/C» en las etiquetas del PDF) y las guardas finales de *El
 * casamiento en la muerte* (físicas 39-43, tras la última página impresa, 32).
 */
import { describe, expect, it } from 'vitest';
import { calcularFolios, deducirFolios, esCubierta, sinContenido } from '../src/folios.js';
import { enteroARomano } from '../src/candidatos.js';
import type { PaginaFolio } from '../src/tipos.js';
import { acierto, libroSintetico } from './libro-sintetico.js';

const texto = (n = 40) => 'palabra '.repeat(n).trim();

/** El casamiento: tapa y guardas (1-6), portada sin número (7), 8-38 = 2-32 con lectura, 39-43 en blanco. */
function casamiento(): { paginas: PaginaFolio[]; verdad: Array<string | null> } {
  const paginas: PaginaFolio[] = [];
  const verdad: Array<string | null> = [];
  paginas.push({ fisica: 1, texto: 'VEGA. EL CASAMIENTO EN LA MUERTE', vacia: false }); verdad.push(null);
  paginas.push({ fisica: 2, texto: 'T.\n1089', vacia: false }); verdad.push(null);
  for (let f = 3; f <= 6; f++) { paginas.push({ fisica: f, texto: '', vacia: true }); verdad.push(null); }
  paginas.push({ fisica: 7, texto: `Num. 184.\nEL CASAMIENTO EN LA MVERTE\n${texto()}`, vacia: false }); verdad.push('1');
  for (let f = 8; f <= 38; f++) {
    paginas.push({ fisica: f, cabecera: 'DE LOPE DE VEGA CARPIO.', folio: f % 5 === 0 ? null : String(f - 6), texto: texto(), vacia: false });
    verdad.push(String(f - 6));
  }
  for (let f = 39; f <= 43; f++) { paginas.push({ fisica: f, texto: '', vacia: true }); verdad.push(null); }
  return { paginas, verdad };
}

describe('guardas y contratapas en blanco', () => {
  it('El casamiento: las guardas finales (39-43) quedan sin folio', () => {
    const { paginas, verdad } = casamiento();
    const r = deducirFolios(paginas);
    const impresas = r.paginas.map((p) => p.impresa);
    for (let f = 39; f <= 43; f++) {
      expect(r.paginas[f - 1], `física ${f}`).toMatchObject({ impresa: null, origen: 'ninguno', tipoPagina: 'guarda' });
    }
    expect(impresas[37]).toBe('32');
    expect(impresas.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(acierto(impresas, verdad).errores.filter(([f]) => f !== 7)).toEqual([]);
    expect(r.avisos.some((a) => a.includes('guardas'))).toBe(true);
  });

  it('también con el juez', async () => {
    const { paginas } = casamiento();
    const juez = { nombre: 'nadie', juzgar: async () => ({}) };
    const r = await calcularFolios(paginas, { juez });
    expect(r.paginas.slice(38).every((p) => p.impresa === null)).toBe(true);
  });

  it('sin `vacia`, una página sin nada escrito cuenta como vacía', () => {
    expect(sinContenido({ fisica: 1 })).toBe(true);
    expect(sinContenido({ fisica: 1, texto: '  \n ' })).toBe(true);
    expect(sinContenido({ fisica: 1, texto: '', vacia: false })).toBe(false);
    expect(sinContenido({ fisica: 1, figuras: [{ descripcion: 'grabado' }] })).toBe(false);
    const { paginas } = casamiento();
    const sinMarca = paginas.map(({ vacia: _v, ...p }) => p);
    expect(deducirFolios(sinMarca).paginas.slice(38).every((p) => p.impresa === null)).toBe(true);
  });

  it('las páginas en blanco DENTRO del cuerpo conservan su folio', () => {
    const paginas: PaginaFolio[] = Array.from({ length: 20 }, (_, i) => ({ fisica: i + 1, pie: String(i + 1), texto: texto() }));
    for (const i of [5, 6, 12]) paginas[i] = { fisica: i + 1, texto: '', vacia: true };
    const r = deducirFolios(paginas);
    expect(r.paginas.map((p) => p.impresa)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
  });

  it('libros sintéticos con guardas al final', () => {
    for (let s = 1; s <= 8; s++) {
      const l = libroSintetico({ semilla: s, romanos: 6, cuerpo: 80, lectura: 0.6 });
      const extra = 4;
      const paginas = [...l.paginas, ...Array.from({ length: extra }, (_, k) => ({ fisica: l.paginas.length + k + 1, texto: '', vacia: true }))];
      const verdad = [...l.verdad, ...new Array<null>(extra).fill(null)];
      const r = deducirFolios(paginas);
      expect(acierto(r.paginas.map((p) => p.impresa), verdad).acierto, `semilla ${s}`).toBe(1);
      expect(r.paginas.slice(-extra).every((p) => p.impresa === null && p.tipoPagina === 'guarda')).toBe(true);
    }
  });
});

/** The Discarded Image: sobrecubierta (1-3) con etiquetas «dj A/B/C», preliminares i-x, cuerpo 1-232. */
function lewis(): { paginas: PaginaFolio[]; verdad: Array<string | null> } {
  const paginas: PaginaFolio[] = [];
  const verdad: Array<string | null> = [];
  paginas.push({ fisica: 1, etiqueta: 'dj A', texto: 'Cambridge University Press' }); verdad.push(null);
  paginas.push({ fisica: 2, etiqueta: 'dj B', texto: `When reading old literature we tend to turn to commentaries… ${texto(150)}` }); verdad.push(null);
  paginas.push({ fisica: 3, etiqueta: 'dj C', texto: `continued on back flap ${texto(60)}` }); verdad.push(null);
  for (let k = 1; k <= 10; k++) {
    const f = k + 3;
    const vacia = k === 2 || k === 6;
    paginas.push({ fisica: f, etiqueta: enteroARomano(k), texto: vacia ? '' : texto(), vacia, pie: k >= 7 && k !== 10 ? enteroARomano(k) : '' });
    verdad.push(enteroARomano(k));
  }
  for (let v = 1; v <= 232; v++) {
    const f = v + 13;
    paginas.push({ fisica: f, etiqueta: String(v), cabecera: v % 2 ? `Capítulo ${v}` : `${v} The Discarded Image`, texto: texto(), pie: v % 3 === 0 ? String(v) : '' });
    verdad.push(String(v));
  }
  return { paginas, verdad };
}

describe('cubiertas y sobrecubiertas', () => {
  it('The Discarded Image: las etiquetas «dj A/B/C» de la sobrecubierta no son folios', () => {
    const { paginas, verdad } = lewis();
    const r = deducirFolios(paginas);
    expect(r.fuente).toBe('etiquetas');
    expect(r.paginas.slice(0, 3).map((p) => [p.impresa, p.tipoPagina])).toEqual([[null, 'cubierta'], [null, 'cubierta'], [null, 'cubierta']]);
    expect(acierto(r.paginas.map((p) => p.impresa), verdad).acierto).toBe(1);
    expect(r.paginas[9]).toMatchObject({ impresa: 'vii', romana: true, origen: 'leido' });
    expect(r.paginas[26]).toMatchObject({ impresa: '14' });
  });

  it('las mismas páginas sin etiquetas: la secuencia tampoco les da folio', () => {
    const { paginas, verdad } = lewis();
    const r = deducirFolios(paginas.map(({ etiqueta: _e, ...p }) => p));
    expect(r.fuente).toBe('secuencia');
    expect(r.paginas.slice(0, 3).every((p) => p.impresa === null)).toBe(true);
    const a = acierto(r.paginas.map((p) => p.impresa), verdad);
    expect(a.errores.filter(([f]) => f <= 3)).toEqual([]);
  });

  it('una sobrecubierta sin etiquetas, pegada al cuerpo, se reconoce por su texto', () => {
    const paginas: PaginaFolio[] = [
      { fisica: 1, texto: `THE BOOK\nJacket designed by Will Carter\n${texto(80)}` },
      ...Array.from({ length: 12 }, (_, i) => ({ fisica: i + 2, pie: String(i + 1), texto: texto() })),
      { fisica: 14, texto: `continued from front flap ${texto(80)}` },
    ];
    (paginas[1] as PaginaFolio).pie = '';
    const r = deducirFolios(paginas);
    expect(r.paginas[0]).toMatchObject({ impresa: null, tipoPagina: 'cubierta' });
    expect(r.paginas[13]).toMatchObject({ impresa: null });
    expect(r.paginas[1]?.impresa).toBe('1');
  });

  it('esCubierta: etiquetas y frases de tapas en varias lenguas', () => {
    for (const etiqueta of ['dj A', 'Cover', 'Front Cover', 'C1', 'IFC', 'Cubierta']) expect(esCubierta({ fisica: 1, etiqueta }), etiqueta).toBe(true);
    for (const t of ['Diseño de cubierta: Juan Pérez', 'Jacket design by X', 'Ilustración de la portada: Goya', 'sobrecubierta']) expect(esCubierta({ fisica: 1, texto: t }), t).toBe(true);
    expect(esCubierta({ fisica: 1, etiqueta: 'xiv', texto: texto() })).toBe(false);
    expect(esCubierta({ fisica: 1, texto: 'La portada del templo era de mármol.' })).toBe(false);
  });

  it('etiquetas que no cuadran con lo que se ve se ignoran', () => {
    const paginas: PaginaFolio[] = Array.from({ length: 20 }, (_, i) => ({ fisica: i + 1, etiqueta: String(i + 101), pie: String(i + 1), texto: texto() }));
    const r = deducirFolios(paginas);
    expect(r.fuente).toBe('secuencia');
    expect(r.paginas[4]?.impresa).toBe('5');
  });

  it('etiquetas que solo repiten la física no se usan', () => {
    const paginas: PaginaFolio[] = Array.from({ length: 10 }, (_, i) => ({ fisica: i + 1, etiqueta: String(i + 1), pie: String(i + 3), texto: texto() }));
    const r = deducirFolios(paginas);
    expect(r.fuente).toBe('secuencia');
    expect(r.paginas[0]?.impresa).toBe('3');
  });
});
