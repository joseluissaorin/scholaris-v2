import type { Documento } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { capaDeBusqueda } from '../src/pasos/indexado.js';

const doc = (idioma: string, anio?: number): Documento => ({
  id: 'd', tipo: 'pdf', metadatos: { titulo: 't', autores: [], idioma, ...(anio ? { anio } : {}) },
  estado: 'listo', huella: 'h', original: '', mime: 'application/pdf', bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [],
});

describe('capa de ortografía modernizada en la ingesta', () => {
  it('la época se decide por documento: también los fragmentos sin señales reciben la capa', () => {
    // Quijote de 1608 con su grafía (caps. XI y XIV), literal de Wikisource:
    // https://es.wikisource.org/wiki/El_ingenioso_hidalgo_Don_Quijote_de_la_Mancha_(1608)
    const fr = [
      { texto: 'Y assi dixo a su amo: Bien puede vuestra merced acomodarse desde luego, á donde ha de posar esta noche' },
      { texto: 'porque siendo infinitos los sujetos hermosos:' },
    ];
    const capa = capaDeBusqueda(doc('es'), fr);
    expect(capa[0]).toContain('asi dijo');
    expect(capa[1]).toBe('porque siendo infinitos los sujetos ermosos');
  });
  it('documentos modernos y en inglés no llevan capa', () => {
    expect(capaDeBusqueda(doc('es', 1959), [{ texto: 'El músico toca el saxo en París.' }])).toEqual(['']);
    expect(capaDeBusqueda(doc('en'), [{ texto: 'Attention is all you need.' }])).toEqual(['']);
  });
  it('el latín siempre', () => {
    expect(capaDeBusqueda(doc('la'), [{ texto: 'Arma virumque cano' }])[0]).toContain('uirum que');
  });
});
