import { describe, expect, it } from 'vitest';
import { idYoutube, palabrasDeSegmento, tramosDe } from '../src/compartido/medios-url.js';

describe('medios por URL', () => {
  it('reconoce los ids de YouTube', () => {
    expect(idYoutube('https://www.youtube.com/watch?v=rWd0lrxJit4')).toBe('rWd0lrxJit4');
    expect(idYoutube('https://youtu.be/rWd0lrxJit4?t=10')).toBe('rWd0lrxJit4');
    expect(idYoutube('https://www.youtube.com/shorts/abcdef123')).toBe('abcdef123');
    expect(idYoutube('https://vimeo.com/123')).toBeNull();
  });
  it('reparte el segmento entre sus palabras, en orden y dentro del segmento', () => {
    const ps = palabrasDeSegmento({ t0: 10, t1: 14, texto: 'The manicule is a pointing hand', hablante: 'Rótulo' });
    expect(ps.map((p) => p.texto)).toEqual(['The', 'manicule', 'is', 'a', 'pointing', 'hand']);
    expect(ps[0]!.t0).toBe(10);
    expect(ps.at(-1)!.t1).toBeCloseTo(14, 1);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!.t0).toBeGreaterThanOrEqual(ps[i - 1]!.t0);
    expect(ps.every((p) => p.hablante === 'Rótulo')).toBe(true);
    // Las palabras largas duran más que las cortas.
    expect(ps[1]!.t1 - ps[1]!.t0).toBeGreaterThan(ps[3]!.t1 - ps[3]!.t0);
  });
  it('trocea en tramos de diez minutos cuando se sabe la duración', () => {
    expect(tramosDe(127)).toEqual([{ t0: 0, t1: 127 }]);
    expect(tramosDe(1300)).toHaveLength(3);
  });
});
