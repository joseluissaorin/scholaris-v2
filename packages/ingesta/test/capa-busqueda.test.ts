import type { Documento } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { capaDeBusqueda } from '../src/pasos/indexado.js';

const doc = (idioma: string, anio?: number): Documento => ({
  id: 'd', tipo: 'pdf', metadatos: { titulo: 't', autores: [], idioma, ...(anio ? { anio } : {}) },
  estado: 'listo', huella: 'h', original: '', mime: 'application/pdf', bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [],
});

describe('capa de ortografía modernizada en la ingesta', () => {
  it('la época se decide por documento: también los fragmentos sin señales reciben la capa', () => {
    const fr = [
      { texto: '*Al.* Què Roldan como tu, sobrino mio, y el bravo Aragonès Brabonèl fuerte? Y assi, dice Brabonèl.' },
      { texto: 'Hazme obligado.' },
    ];
    const capa = capaDeBusqueda(doc('es'), fr);
    expect(capa[0]).toContain('asi dize');
    expect(capa[1]).toBe('azme obligado');
  });
  it('documentos modernos y en inglés no llevan capa', () => {
    expect(capaDeBusqueda(doc('es', 1959), [{ texto: 'Johnny toca el saxo en París.' }])).toEqual(['']);
    expect(capaDeBusqueda(doc('en'), [{ texto: 'Attention is all you need.' }])).toEqual(['']);
  });
  it('el latín siempre', () => {
    expect(capaDeBusqueda(doc('la'), [{ texto: 'Arma virumque cano' }])[0]).toContain('uirum que');
  });
});
