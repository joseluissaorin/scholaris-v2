import { describe, expect, it } from 'vitest';
import type { PalabraTranscrita } from '@scholaris/nucleo';
import { segmentarTranscripcion, transcribirTramo } from '../src/pasos/medios.js';

function hablar(desde: number, frases: number, hablante?: string): PalabraTranscrita[] {
  const ps: PalabraTranscrita[] = [];
  let t = desde;
  for (let f = 0; f < frases; f++) {
    for (let w = 0; w < 12; w++) {
      ps.push({ texto: w === 11 ? `fin${f}.` : `palabra${w}`, t0: t, t1: t + 0.4, ...(hablante ? { hablante } : {}) });
      t += 0.42;
    }
  }
  return ps;
}

describe('segmentarTranscripcion', () => {
  it('corta en tramos de 30-60 s en fin de frase', () => {
    const us = segmentarTranscripcion(hablar(0, 120));
    expect(us.length).toBeGreaterThan(5);
    for (const u of us.slice(0, -1)) {
      const d = (u.t1 as number) - (u.t0 as number);
      expect(d).toBeGreaterThanOrEqual(29);
      expect(d).toBeLessThanOrEqual(61);
      expect(u.texto.trim().endsWith('.')).toBe(true);
    }
    expect(us[0]?.ancla).toMatchObject({ tipo: 'tiempo', t0: 0 });
  });
  it('etiqueta hablantes y prefiere cortar en el cambio de turno', () => {
    const us = segmentarTranscripcion([...hablar(0, 7, 'A'), ...hablar(36, 12, 'B')]);
    expect(us[0]?.hablante).toBe('A');
    expect(us[1]?.hablante).toBe('B');
  });
});

describe('transcribirTramo', () => {
  it('desplaza tiempos relativos y descarta el solape', async () => {
    const r = await transcribirTramo(
      { n: 1, t0: 598, t1: 1200, propioDesde: 600, propioHasta: 1200, parte: 'audio/1.ogg' },
      { async parte() { return { bytes: new Uint8Array(1), mime: 'audio/ogg' }; } },
      { nombre: 'asr', async transcribir() { return { texto: '', palabras: [{ texto: 'solape', t0: 0.5, t1: 1 }, { texto: 'propia', t0: 10, t1: 10.5 }] }; } },
    );
    expect(r.palabras.map((p) => p.texto)).toEqual(['propia']);
    expect(r.palabras[0]?.t0).toBe(608);
  });
});

describe('casarHablantes', () => {
  it('casa las etiquetas por el solape y renombra las que chocan', async () => {
    const { casarHablantes } = await import('../src/pasos/medios.js');
    const t1 = { n: 0, palabras: [{ texto: 'hola', t0: 598, t1: 598.4, hablante: 'A' }, { texto: 'amigo', t0: 599, t1: 599.4, hablante: 'A' }] };
    const t2 = { n: 1, solape: [{ texto: 'hola', t0: 598.1, t1: 598.5, hablante: 'B' }, { texto: 'amigo', t0: 599.1, t1: 599.5, hablante: 'B' }], palabras: [{ texto: 'sigo', t0: 601, t1: 601.4, hablante: 'B' }, { texto: 'yo', t0: 602, t1: 602.3, hablante: 'A' }] };
    casarHablantes([t1, t2]);
    expect(t2.palabras.map((p) => p.hablante)).toEqual(['A', 'A·1']);
  });
});

describe('instantes por palabra', () => {
  const palabrasDelTexto = (t: string) => t.replace(/\*\*[^*\n]+?:\*\*/g, ' ').split(/\s+/).filter(Boolean);
  it('cada palabra del texto (sin marcas de turno) tiene su instante exacto, puntuación suelta incluida', async () => {
    const { segmentarTranscripcion } = await import('../src/pasos/medios.js');
    const ws = [
      { texto: 'Buenas', t0: 10, t1: 10.4, hablante: 'A' }, { texto: 'noches', t0: 10.5, t1: 11, hablante: 'A' }, { texto: ',', t0: 11, t1: 11.05, hablante: 'A' },
      { texto: '¿', t0: 11.2, t1: 11.25, hablante: 'A' }, { texto: 'Eres', t0: 11.3, t1: 11.6, hablante: 'A' }, { texto: 'un místico?', t0: 11.7, t1: 12.5, hablante: 'A' },
      { texto: 'Es', t0: 13, t1: 13.2, hablante: 'B' }, { texto: 'inevitable.', t0: 13.3, t1: 14, hablante: 'B' },
    ];
    const [u] = segmentarTranscripcion(ws);
    expect(u?.texto).toBe('**A:** Buenas noches, ¿Eres un místico?\n\n**B:** Es inevitable.');
    const fichas = palabrasDelTexto(u!.texto);
    expect(u?.palabras?.cs.length).toBe(fichas.length * 2);
    const { instantesDePalabras } = await import('@scholaris/spdf');
    const ts = instantesDePalabras(u!.palabras!);
    expect(fichas[2]).toBe('¿Eres');
    expect(ts[2]).toEqual([11.2, 11.6]);
    // «un místico?» llegó como una sola «palabra»: su intervalo se reparte.
    expect(ts[3]).toEqual([11.7, 12.1]);
    expect(ts[6]).toEqual([13.3, 14]);
  });
});
