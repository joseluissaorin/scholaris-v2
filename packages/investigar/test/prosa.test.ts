import { describe, expect, it } from 'vitest';
import type { Ancla } from '@scholaris/nucleo';
import { localizadoresEn, quitarLocalizadores, renumerar, tablasSinMarcas } from '../src/prosa.js';

const pagina = (fisica: number, impresa: string): Ancla => ({ tipo: 'pagina', fisica, impresa, romana: false, origen: 'leido', confianza: 1 });
const ev = (id: string, ancla: Ancla) => ({ id, ancla });

// Texto inventado para las pruebas (no es de ninguna obra).
describe('localizadores en la prosa', () => {
  it('los reconoce: páginas, tramos, minutos', () => {
    const ls = localizadoresEn('El cierre (pp. 35-37) y la escena del minuto 40; luego, de 1:45:03 a 1:45:50, y en 9:36.');
    expect(ls.map((l) => [l.tipo, l.desde, l.hasta])).toEqual([['pagina', 35, 37], ['tiempo', 6303, 6350], ['tiempo', 576, 576], ['tiempo', 2400, 2459]]);
  });

  it('quita los que inventa la prosa (también en los títulos) y no toca la lista de pruebas', () => {
    const md = '- **Cierre (pp. 35-37):** El narrador vuelve al café [E1].\n\n## Pruebas\n\n- [E1] Autor, 2000, p. 12, *Obra*: «cita»';
    const r = quitarLocalizadores(md, [ev('E1', pagina(6, '12'))]);
    expect(r.markdown).toBe('- **Cierre:** El narrador vuelve al café [E1].\n\n## Pruebas\n\n- [E1] Autor, 2000, p. 12, *Obra*: «cita»');
    expect(r.quitados).toBe(1);
  });

  it('una frase sin marcas cuyo localizador es el de una prueba real recibe su marca', () => {
    const r = quitarLocalizadores('En la página 12 el narrador vuelve al café. Al final (1:45:03-1:45:50) se reconcilian.', [
      ev('E1', pagina(6, '12')), ev('E2', { tipo: 'tiempo', t0: 6300, t1: 6352 }),
    ]);
    expect(r.markdown).toBe('El narrador vuelve al café [E1]. Al final se reconcilian [E2].');
    expect(r.convertidos).toBe(2);
  });

  it('un localizador que no es de ninguna prueba solo se quita', () => {
    const r = quitarLocalizadores('Hacia el minuto 70, se oye una canción [E1].', [ev('E1', { tipo: 'tiempo', t0: 100, t1: 120 })]);
    expect(r.markdown).toBe('Se oye una canción [E1].');
  });
});

describe('tablas y renumeración', () => {
  it('las filas de las tablas pierden sus marcas', () => {
    const r = tablasSinMarcas('| Obra | Lugar |\n|---|---|\n| Cuento | El café [E1][E3] |\n\nTexto [E2].');
    expect(r.markdown).toBe('| Obra | Lugar |\n|---|---|\n| Cuento | El café |\n\nTexto [E2].');
    expect(r.quitadas).toBe(2);
  });

  it('renumera por orden de aparición y descarta lo que nadie cita', () => {
    const r = renumerar('Uno [E3]. Dos [E1][E3]. Tres [E9].', [{ id: 'E1', x: 1 }, { id: 'E2', x: 2 }, { id: 'E3', x: 3 }]);
    expect(r.markdown).toBe('Uno [E1]. Dos [E2][E1]. Tres .');
    expect(r.evidencias).toEqual([{ id: 'E1', x: 3 }, { id: 'E2', x: 1 }]);
  });
});
