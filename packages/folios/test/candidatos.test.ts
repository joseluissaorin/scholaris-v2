import { describe, expect, it } from 'vitest';
import {
  candidatosDeLinea,
  enteroARomano,
  extraerCandidatos,
  leerFicha,
  romanoAEntero,
  textoDeCandidato,
} from '../src/candidatos.js';

const valores = (cs: Array<{ valor: number; romana: boolean }>) => cs.map((c) => (c.romana ? `r${c.valor}` : c.valor));

describe('romanos', () => {
  it('convierte en los dos sentidos', () => {
    expect(romanoAEntero('xiv')).toBe(14);
    expect(romanoAEntero('MCMLXII')).toBe(1962);
    expect(enteroARomano(14)).toBe('xiv');
    expect(enteroARomano(9, true)).toBe('IX');
  });
  it('rechaza romanos mal formados', () => {
    expect(romanoAEntero('LDI')).toBe(0);
    expect(romanoAEntero('iiii')).toBe(0);
    expect(romanoAEntero('MIM')).toBe(0);
    expect(romanoAEntero('')).toBe(0);
  });
});

describe('leerFicha', () => {
  it('lee arábigos, romanos y foliación', () => {
    expect(leerFicha('23')).toMatchObject({ valor: 23, romana: false });
    expect(leerFicha('xiv')).toMatchObject({ valor: 14, romana: true, mayusculas: false });
    expect(leerFicha('XIV')).toMatchObject({ valor: 14, romana: true, mayusculas: true });
    expect(leerFicha('12v')).toMatchObject({ valor: 12, lado: 'v' });
    expect(leerFicha('[23]')).toMatchObject({ valor: 23 });
  });
  it('corrige errores típicos de OCR', () => {
    expect(leerFicha('l23')).toMatchObject({ valor: 123, corregido: true });
    expect(leerFicha('8I')).toMatchObject({ valor: 81, corregido: true });
    expect(leerFicha('1O')).toMatchObject({ valor: 10, corregido: true });
  });
  it('no confunde palabras con números', () => {
    expect(leerFicha('Mix')).toBeNull();
    expect(leerFicha('LDI')).toBeNull();
    expect(leerFicha('casa')).toBeNull();
  });
});

describe('candidatosDeLinea', () => {
  it('número suelto con decoraciones', () => {
    for (const l of ['23', '— 23 —', '- 23 -', '·23·', '[23]', '(23)', '* 23 *', '~ 23 ~']) {
      expect(valores(candidatosDeLinea(l, 'pie')), l).toEqual([23]);
    }
  });
  it('marcadores explícitos', () => {
    expect(valores(candidatosDeLinea('p. 23', 'pie'))).toContain(23);
    expect(valores(candidatosDeLinea('Pág. 145', 'pie'))).toContain(145);
    expect(valores(candidatosDeLinea('Seite 12', 'cabecera'))).toContain(12);
    expect(candidatosDeLinea('fol. 12v', 'cabecera').some((c) => c.valor === 12 && c.lado === 'v')).toBe(true);
  });
  it('cabeceras corridas', () => {
    expect(valores(candidatosDeLinea('23 THE DISCARDED IMAGE', 'cabecera'))).toEqual([23]);
    expect(valores(candidatosDeLinea('Reservations 17', 'cabecera'))).toEqual([17]);
    expect(valores(candidatosDeLinea('xiv PREFACIO', 'cabecera'))).toEqual(['r14']);
  });
  it('marcas del impresor y llamadas de nota en el pie', () => {
    const c = valores(candidatosDeLinea('2 17 LDI', 'pie'));
    expect(c).toContain(17);
    expect(c).toContain(2);
    expect(valores(candidatosDeLinea('6 8I LDI', 'pie'))).toContain(81);
  });
  it('dígitos separados por el OCR', () => {
    expect(valores(candidatosDeLinea('1 3', 'pie'))).toContain(13);
  });
  it('doble página', () => {
    const c = candidatosDeLinea('12                    13', 'pie');
    expect(c.some((x) => x.valor === 12 && x.derecha === 13)).toBe(true);
  });
  it('descarta capítulos, números de obra y notas', () => {
    expect(candidatosDeLinea('CAPÍTULO IV', 'cabecera')).toEqual([]);
    expect(candidatosDeLinea('Num. 184.', 'texto-inicio')).toEqual([]);
    expect(candidatosDeLinea('¹ Boethius, I Met. v, pp. 154 sq.', 'texto-fin')).toEqual([]);
    expect(candidatosDeLinea('Lámina 3', 'pie')).toEqual([]);
  });
  it('en el cuerpo no toma referencias «p. 154»', () => {
    expect(valores(candidatosDeLinea('Véase la p. 154 y siguientes del libro', 'texto-fin'))).toEqual([]);
  });
  it('rebaja los años', () => {
    const [anio] = candidatosDeLinea('1962', 'pie');
    expect(anio?.peso).toBeLessThan(0.5);
  });
  it('una letra mayúscula romana dentro de una línea es una palabra', () => {
    expect(valores(candidatosDeLinea('C. S. LEWIS', 'texto-inicio'))).toEqual([]);
    expect(valores(candidatosDeLinea('I do not exercise myself', 'texto-inicio'))).toEqual([]);
  });
});

describe('extraerCandidatos', () => {
  it('reúne lector, cabecera, pie y bordes del texto, y refuerza los repetidos', () => {
    const cs = extraerCandidatos({
      fisica: 30,
      folio: '17',
      cabecera: 'Reservations',
      pie: '2 17 LDI',
      texto: 'In our age I think it would be fair to say\nque sigue\n\n17',
    });
    expect(cs[0]?.valor).toBe(17);
    expect(cs[0]?.peso).toBeGreaterThan(0.9);
    expect(valores(cs)).toContain(2);
  });
  it('una página vacía no tiene candidatos', () => {
    expect(extraerCandidatos({ fisica: 1 })).toEqual([]);
  });
  it('quita HTML y Markdown del texto', () => {
    const cs = extraerCandidatos({ fisica: 5, texto: '<div align="center">\n\n# PRÓLOGO\n\ntexto largo de la página\n\n</div>\n\n**xi**' });
    expect(valores(cs)).toContain('r11');
  });
  it('textoDeCandidato respeta mayúsculas y foliación', () => {
    expect(textoDeCandidato({ valor: 14, romana: true, mayusculas: true })).toBe('XIV');
    expect(textoDeCandidato({ valor: 12, romana: false, mayusculas: false, lado: 'v' })).toBe('12v');
  });
});
