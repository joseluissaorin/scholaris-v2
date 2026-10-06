import type { Juez, PreguntaJuez, RespuestaJuez } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { calcularFolios, casiIgual, deducirFolios, elegirConJuez } from '../src/folios.js';
import { acierto, libroSintetico } from './libro-sintetico.js';

/** Un juez de pega que conoce la verdad (o se equivoca a propósito). */
function juezDePega(verdad: Array<string | null>, opciones: { falla?: boolean; aleatorio?: boolean } = {}) {
  const llamadas: Array<{ estado: unknown; preguntas: Record<string, PreguntaJuez> }> = [];
  const juez: Juez = {
    nombre: 'pega',
    async juzgar(estado, preguntas) {
      llamadas.push({ estado, preguntas });
      if (opciones.falla) throw new Error('sin conexión');
      const r: Record<string, RespuestaJuez> = {};
      for (const [k, p] of Object.entries(preguntas)) {
        if (p.tipo !== 'eleccion') continue;
        const fisica = Number(k.slice(1));
        const v = verdad[fisica - 1];
        const claves = Object.keys(p.opciones);
        const eleccion = opciones.aleatorio ? (claves[0] as string) : v && claves.includes(v) ? v : 'ninguno';
        r[k] = { tipo: 'eleccion', eleccion, probabilidades: { [eleccion]: 0.95 } };
      }
      return r;
    },
  };
  return { juez, llamadas };
}

describe('elegirConJuez', () => {
  it('pregunta las páginas dudosas en una sola llamada con muchas preguntas', async () => {
    const l = libroSintetico({ semilla: 3, romanos: 6, cuerpo: 150, lectura: 0.5, posicion: 'texto', notas: 0.8 });
    const { juez, llamadas } = juezDePega(l.verdad);
    const r = await elegirConJuez(juez, l.paginas);
    expect(llamadas).toHaveLength(1);
    const n = Object.keys(llamadas[0]!.preguntas).length;
    expect(n).toBeGreaterThan(5);
    expect(r.juez).toEqual({ llamadas: 1, preguntas: n });
    // Cada pregunta es una elección con los candidatos y «ninguno», y el estado lleva su página.
    const [clave, pregunta] = Object.entries(llamadas[0]!.preguntas)[0]!;
    expect(pregunta.tipo).toBe('eleccion');
    if (pregunta.tipo === 'eleccion') expect(Object.keys(pregunta.opciones)).toContain('ninguno');
    expect((llamadas[0]!.estado as { paginas: Record<string, unknown> }).paginas[clave]).toBeDefined();
  });

  it('el juez mejora los casos que la secuencia sola no resuelve', async () => {
    let sinJuez = 0, conJuez = 0;
    for (let s = 1; s <= 10; s++) {
      const l = libroSintetico({ semilla: s, romanos: 6, cuerpo: 120, lectura: 0.4, posicion: 'texto', notas: 0.9, errorOcr: 0.1 });
      sinJuez += acierto(deducirFolios(l.paginas).paginas.map((p) => p.impresa), l.verdad).acierto;
      const r = await elegirConJuez(juezDePega(l.verdad).juez, l.paginas);
      conJuez += acierto(r.paginas.map((p) => p.impresa), l.verdad).acierto;
    }
    expect(conJuez).toBeGreaterThanOrEqual(sinJuez);
    expect(conJuez / 10).toBeGreaterThan(0.97);
  });

  it('un número mal leído se ofrece corregido según la secuencia', async () => {
    const paginas = [
      { fisica: 1, pie: '120' }, { fisica: 2, pie: '121' }, { fisica: 3, pie: '122' },
      { fisica: 4, pie: '128' }, // debería ser 123
      { fisica: 5, pie: '124' }, { fisica: 6, pie: '125' },
    ];
    const verdad = ['120', '121', '122', '123', '124', '125'];
    const { juez, llamadas } = juezDePega(verdad);
    const r = await elegirConJuez(juez, paginas);
    const p = llamadas[0]?.preguntas.p4;
    expect(p?.tipo === 'eleccion' && Object.keys(p.opciones)).toEqual(expect.arrayContaining(['128', '123', 'ninguno']));
    expect(r.paginas[3]).toMatchObject({ impresa: '123' });
  });

  it('parte en lotes si hay demasiadas preguntas', async () => {
    const l = libroSintetico({ semilla: 3, romanos: 6, cuerpo: 150, lectura: 0.5, posicion: 'texto', notas: 0.8 });
    const { juez, llamadas } = juezDePega(l.verdad);
    const r = await elegirConJuez(juez, l.paginas, { preguntasPorLlamada: 3 });
    expect(llamadas.length).toBeGreaterThan(1);
    expect(r.juez.llamadas).toBe(llamadas.length);
    for (const ll of llamadas) expect(Object.keys(ll.preguntas).length).toBeLessThanOrEqual(3);
  });

  it('si el juez falla, se resuelve con la secuencia y se avisa', async () => {
    const l = libroSintetico({ semilla: 3, romanos: 6, cuerpo: 80, lectura: 0.5, posicion: 'texto', notas: 0.8 });
    const r = await elegirConJuez(juezDePega(l.verdad, { falla: true }).juez, l.paginas);
    const sin = deducirFolios(l.paginas);
    expect(r.paginas.map((p) => p.impresa)).toEqual(sin.paginas.map((p) => p.impresa));
    expect(r.avisos.some((a) => a.includes('juez'))).toBe(true);
  });

  it('no llama al juez si no hay dudas', async () => {
    const l = libroSintetico({ semilla: 1, romanos: 4, cuerpo: 40, lectura: 1, posicion: 'pie' });
    const { juez, llamadas } = juezDePega(l.verdad);
    const r = await calcularFolios(l.paginas, { juez });
    expect(llamadas.length).toBe(0);
    expect(r.juez.llamadas).toBe(0);
  });

  it('casiIgual: una cifra de diferencia', () => {
    expect(casiIgual(123, 128)).toBe(true);
    expect(casiIgual(123, 23)).toBe(true);
    expect(casiIgual(123, 1234)).toBe(true);
    expect(casiIgual(123, 321)).toBe(false);
    expect(casiIgual(5, 5)).toBe(false);
  });
});
