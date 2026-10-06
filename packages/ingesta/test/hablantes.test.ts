import { describe, expect, it } from 'vitest';
import type { PalabraTranscrita } from '@scholaris/nucleo';
import { atribuirHablantes, frasesIndexadas } from '../src/pasos/hablantes.js';
import { segmentarTranscripcion } from '../src/pasos/medios.js';
import { redactorFalso } from './fakes.js';

const decir = (t0: number, texto: string, h: string): PalabraTranscrita[] => texto.split(' ').map((w, i) => ({ texto: w, t0: t0 + i * 0.4, t1: t0 + i * 0.4 + 0.35, hablante: h }));

describe('atribuirHablantes', () => {
  it('corrige la pregunta pegada a la respuesta y une el turno', async () => {
    // La diarización pegó la pregunta del entrevistador (H0) a la respuesta del invitado (H0).
    const palabras = [...decir(0, 'Buenas noches, hoy viene Luis Ferrer.', 'H1'), ...decir(5, '¿Eres un místico?', 'H0'), ...decir(7, 'Es inevitable. Uno nace así.', 'H0')];
    const frases = frasesIndexadas(palabras);
    expect(frases.map((f) => f.texto)).toEqual(['Buenas noches, hoy viene Luis Ferrer.', '¿Eres un místico?', 'Es inevitable.', 'Uno nace así.']);
    const redactor = redactorFalso((t) => (t.includes('Muestras')
      ? { reparto: [{ nombre: 'Ana Prieto', papel: 'entrevistador', etiquetas: ['H1'] }, { nombre: 'Luis Ferrer', papel: 'entrevistado', etiquetas: ['H0'] }] }
      : { turnos: [{ desde: 0, hasta: 1, hablante: 'Ana Prieto' }, { desde: 2, hasta: 3, hablante: 'Luis Ferrer' }] }));
    const r = await atribuirHablantes(palabras, { titulo: 'Entrevista de prueba', autores: [] }, redactor);
    const us = segmentarTranscripcion(r.palabras);
    expect(us[0]?.texto).toBe('**Ana Prieto:** Buenas noches, hoy viene Luis Ferrer. ¿Eres un místico?\n\n**Luis Ferrer:** Es inevitable. Uno nace así.');
  });
  it('con una sola persona, solo pone el nombre', async () => {
    const palabras = decir(0, 'Hola. Esto es una clase.', 'H0');
    const redactor = redactorFalso(() => ({ reparto: [{ nombre: 'Marta Gil', papel: 'ponente' }] }));
    const r = await atribuirHablantes(palabras, { titulo: 'x', autores: [] }, redactor);
    expect(new Set(r.palabras.map((p) => p.hablante))).toEqual(new Set(['Marta Gil']));
  });
});
