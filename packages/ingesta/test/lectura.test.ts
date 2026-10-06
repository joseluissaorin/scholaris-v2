import { describe, expect, it } from 'vitest';
import { leerPliego, enBucle } from '../src/pasos/lectura.js';
import { lectorFalso, paginaLeida, paginaPdf, paquetePdf, fuenteFalsa } from './fakes.js';

const paquete = paquetePdf([1, 2, 3, 4].map((f) => paginaPdf(f, '', { clase: 'pdf_escaneado' })));
const pliego = { id: 0, desde: 1, hasta: 4, envio: 'imagenes' as const, motivo: 'sin_capa' as const };

describe('leerPliego', () => {
  it('lee todo con el primer lector si va bien', async () => {
    const l = lectorFalso('a', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `p${d + i}`)));
    const r = await leerPliego(pliego, paquete, fuenteFalsa, [l]);
    expect(r.paginas.map((p) => p.texto)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(l.llamadas).toEqual([[1, 4]]);
  });

  it('si faltan páginas, parte el pliego; si una falla sola, baja al siguiente lector', async () => {
    const a = lectorFalso('a', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `a${d + i}`)).filter((p) => p.fisica !== 3));
    const b = lectorFalso('b', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `b${d + i}`)));
    const r = await leerPliego(pliego, paquete, fuenteFalsa, [a, b]);
    expect(r.paginas.map((p) => p.texto)).toEqual(['a1', 'a2', 'b3', 'a4']);
    expect(r.paginas[2]?.lector).toBe('b');
    expect(b.llamadas).toEqual([[3, 3]]);
  });

  it('si la llamada entera falla, baja en la cascada con el pliego completo', async () => {
    const a = lectorFalso('a', () => { throw new Error('429'); });
    const b = lectorFalso('b', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(d + i, `b${d + i}`)));
    const r = await leerPliego(pliego, paquete, fuenteFalsa, [a, b]);
    expect(r.paginas.every((p) => p.lector === 'b')).toBe(true);
    expect(b.llamadas).toEqual([[1, 4]]);
  });

  it('detecta bucles del modelo', () => {
    expect(enBucle('la la la la\n'.repeat(1) + 'Hola mundo repetido aquí\n'.repeat(30))).toBe(true);
    expect(enBucle('Un texto normal.\n\nCon dos párrafos.')).toBe(false);
  });

  it('numeración relativa al pliego se pasa a absoluta', async () => {
    const l = lectorFalso('a', (d, h) => Array.from({ length: h - d + 1 }, (_, i) => paginaLeida(i + 1, `x${i + 1}`)));
    const r = await leerPliego({ ...pliego, desde: 3, hasta: 4 }, paquete, fuenteFalsa, [l]);
    expect(r.paginas.map((p) => [p.fisica, p.texto])).toEqual([[3, 'x1'], [4, 'x2']]);
  });
});
