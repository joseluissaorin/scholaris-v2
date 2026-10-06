import { describe, expect, it } from 'vitest';
import { contarTokens, partirFrases, partirParrafos, similitud } from '../src/texto.js';

describe('texto', () => {
  it('parte frases respetando iniciales y abreviaturas', () => {
    expect(partirFrases('C. S. Lewis wrote this. See e.g. the preface. It is good!')).toEqual(['C. S. Lewis wrote this.', 'See e.g. the preface.', 'It is good!']);
    expect(partirFrases('Dijo el Sr. Pérez: «¿Vienes?». ¡Claro que sí! Fin.')).toEqual(['Dijo el Sr. Pérez: «¿Vienes?».', '¡Claro que sí!', 'Fin.']);
    expect(partirFrases('Véase la sec. 3.2 del cap. 4. Luego.')).toEqual(['Véase la sec. 3.2 del cap. 4.', 'Luego.']);
  });
  it('une guiones de fin de línea y conserva el verso', () => {
    expect(partirParrafos('una pala-\nbra larga\n\notro')).toEqual(['una palabra larga', 'otro']);
    const verso = 'BERNARDO. ¿Qué es esto?\nREY. Mi sangre,\nque vuelve a mí.';
    expect(partirParrafos(verso)).toEqual([verso]);
  });
  it('tokens y similitud', () => {
    expect(contarTokens('hola mundo')).toBeGreaterThan(1);
    expect(similitud('The Discarded Image', 'the discarded image.')).toBe(1);
    expect(similitud('Attention Is All You Need', 'Attention is all you need')).toBe(1);
    expect(similitud('Attention', 'Rayuela')).toBeLessThan(0.3);
  });
});
