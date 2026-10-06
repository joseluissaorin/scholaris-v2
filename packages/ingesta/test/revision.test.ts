import { describe, expect, it } from 'vitest';
import type { PalabraTranscrita } from '@scholaris/nucleo';
import { alinear, revisarTranscripcion, sustituir } from '../src/pasos/revision.js';
import { redactorFalso } from './fakes.js';

const decir = (t0: number, texto: string, h = 'A'): PalabraTranscrita[] => texto.split(' ').map((w, i) => ({ texto: w, t0: t0 + i, t1: t0 + i + 0.8, hablante: h }));

describe('revisión de la transcripción', () => {
  it('alinea y sustituye conservando los instantes de las palabras que casan', () => {
    const viejas = decir(100, 'Y ha sido una de las cosas. Está no es. De esta obra forma parte El perseguidor.');
    const nuevas = 'Y ha sido una de las cosas. Esta no, es esta. De esta obra forma parte El perseguidor.'.split(' ');
    const casa = alinear(viejas.map((w) => w.texto), nuevas);
    // «Está no es.» son las palabras 7-9.
    const r = sustituir(viejas, 7, 10, nuevas, casa, 0)!;
    expect(r.map((w) => w.texto).join(' ')).toBe('Esta no, es esta.');
    expect(r[0]!.t0).toBe(107); // «Esta» hereda el instante de «Está»
    expect(r.every((w) => w.t0 >= 107 && w.t1 <= 110)).toBe(true);
  });

  it('solo toca las frases señaladas y deja lo demás tal cual', async () => {
    const palabras = [...decir(0, 'Buenas noches a todos. Está no es.'), ...decir(10, 'Hablamos de Rayuela.')];
    const redactor = redactorFalso((t) => (t.includes('Frases (n') ? { sospechosas: [{ n: 1, motivo: 'concordancia' }] } : { texto: 'Buenas noches a todos. Esta no es. Hablamos de Rayuela.' }));
    const r = await revisarTranscripcion(palabras, [{ n: 0, t0: 0, t1: 20, propioDesde: 0, propioHasta: 20, parte: 'a.ogg' }], { async parte() { return { bytes: new Uint8Array(1), mime: 'audio/ogg' }; } }, { titulo: 'A fondo', autores: [] }, redactor);
    expect(r.palabras.map((w) => w.texto).join(' ')).toBe('Buenas noches a todos. Esta no es. Hablamos de Rayuela.');
    expect(r.cambios).toEqual([expect.objectContaining({ antes: 'Está no es.', despues: 'Esta no es.' })]);
    expect(r.palabras[4]!.t0).toBe(4);
  });
});

describe('revisión: guardas', () => {
  it('no se pierde texto: si la escucha nueva se come media frase, no se sustituye', () => {
    const viejas = decir(0, 'yo lo cuento en Tres en todo el mundo que es uno de los libros. Entonces desde el punto de vista del autor la satisfacción tiene que ser importante.');
    const nuevas = 'yo me cuento entre ese todo el mundo que es uno de los libros.'.split(' ');
    const casa = alinear(viejas.map((w) => w.texto), nuevas);
    expect(sustituir(viejas, 0, viejas.length, nuevas, casa, 0)).toBeNull();
  });
  it('dos frases seguidas no se reparten la misma palabra nueva', () => {
    const viejas = decir(0, 'hablo simbólenmente de cantar. firmemente cada día más.');
    const nuevas = 'hablo simbólicamente de cantar. Creo firmemente cada día más.'.split(' ');
    const casa = alinear(viejas.map((w) => w.texto), nuevas);
    const usadas = new Set<number>();
    const a = sustituir(viejas, 0, 4, nuevas, casa, 0, usadas)!;
    const b = sustituir(viejas, 4, 8, nuevas, casa, 0, usadas)!;
    expect([...a, ...b].map((w) => w.texto).join(' ')).toBe('hablo simbólicamente de cantar. Creo firmemente cada día más.');
  });
});
