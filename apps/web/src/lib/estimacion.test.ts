import { describe, expect, it } from 'vitest';
import { caracteresAproximados, dolaresAproximados, estimarComprension, PRESUPUESTO_COMPRENSION, preciosComprension } from './estimacion';

const NOV = Date.UTC(2026, 10, 4), DIC = Date.UTC(2026, 11, 2);

describe('estimación de la comprensión', () => {
  it('el material por el tipo: páginas, minutos (con la percepción en el vídeo)', () => {
    expect(caracteresAproximados({ tipo: 'pdf', unidades: 10 })).toBe(22_000);
    expect(caracteresAproximados({ tipo: 'video', unidades: 30, duracion: 600 })).toBe(15_300);
    expect(caracteresAproximados({ tipo: 'audio', unidades: 30, duracion: 600 })).toBe(9900);
  });

  it('crece con el tamaño, el modelo rápido cuesta menos y Argon dobla en diciembre', () => {
    const cuento = estimarComprension({ tipo: 'pdf_escaneado', unidades: 20 }, { ahora: NOV });
    const libro = estimarComprension({ tipo: 'pdf', unidades: 250 }, { ahora: NOV });
    expect(cuento).toBeGreaterThan(0.2);
    expect(cuento).toBeLessThan(2);
    expect(libro).toBeGreaterThan(cuento);
    expect(estimarComprension({ tipo: 'pdf', unidades: 20 }, { economico: true, ahora: NOV })).toBeLessThan(estimarComprension({ tipo: 'pdf', unidades: 20 }, { ahora: NOV }));
    expect(preciosComprension(DIC).alta).toEqual([4, 20]);
    expect(estimarComprension({ tipo: 'pdf', unidades: 20 }, { ahora: DIC })).toBeGreaterThan(estimarComprension({ tipo: 'pdf', unidades: 20 }, { ahora: NOV }));
  });

  it('pasado el presupuesto sigue con el modelo rápido: el tope es el presupuesto y poco más', () => {
    const enorme = estimarComprension({ tipo: 'pdf', unidades: 600 }, { ahora: NOV });
    expect(enorme).toBeGreaterThan(PRESUPUESTO_COMPRENSION);
    // Sin el tope, con Argon todo el rato, pasaría de 30 USD.
    expect(enorme).toBeLessThan(PRESUPUESTO_COMPRENSION * 4);
  });

  it('se dice con «unos» y coma decimal', () => {
    expect(dolaresAproximados(0.851)).toBe('unos 0,85 USD');
    expect(dolaresAproximados(0.01)).toBe('menos de 0,05 USD');
    expect(dolaresAproximados(0)).toBe('0 USD');
  });
});
