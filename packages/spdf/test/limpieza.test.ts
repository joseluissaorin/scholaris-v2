import { describe, expect, it } from 'vitest';
import { detectarIdioma, esVacio, limpiarTitulo, normalizarIdioma, parsearAutor, parsearAutores } from '../src/limpieza.js';
import { colaDeTexto, mimeImagen, pareceEscaneado } from '../src/migrar-v3.js';

describe('autores', () => {
  it.each([
    ['Julio Cortázar', 'Julio', 'Cortázar'],
    ['C. S. Lewis', 'C. S.', 'Lewis'],
    ['Lope de Vega Carpio', 'Lope', 'de Vega Carpio'],
    ['Joaquín Soler Serrano', 'Joaquín', 'Soler Serrano'],
    ['José Luis Saorín Ferrer', 'José Luis', 'Saorín Ferrer'],
    ['Foucault, Michel', 'Michel', 'Foucault'],
    ['Vaswani', '', 'Vaswani'],
    ['  Shazeer ', '', 'Shazeer'],
    ['J.R.R. Tolkien', 'J.R.R.', 'Tolkien'],
  ])('%s', (entrada, nombre, apellidos) => {
    expect(parsearAutor(entrada)).toEqual({ nombre, apellidos });
  });

  it('listas JSON, cadenas con separadores y vacíos', () => {
    expect(parsearAutores('["Vaswani", " Shazeer", " Parmar"]').map((a) => a.apellidos)).toEqual(['Vaswani', 'Shazeer', 'Parmar']);
    expect(parsearAutores('["Julio Cort\\u00e1zar"]')).toEqual([{ nombre: 'Julio', apellidos: 'Cortázar' }]);
    expect(parsearAutores('Deleuze; Guattari')).toHaveLength(2);
    expect(parsearAutores('Gilles Deleuze y Félix Guattari')).toHaveLength(2);
    expect(parsearAutores('[]')).toEqual([]);
    expect(parsearAutores('["[NOT_FOUND]"]')).toEqual([]);
    expect(parsearAutores([{ given: 'Ada', family: 'Lovelace' }])).toEqual([{ nombre: 'Ada', apellidos: 'Lovelace' }]);
  });
});

describe('títulos e idioma', () => {
  it('limpia títulos de nombre de fichero', () => {
    expect(limpiarTitulo('The_Discarded_Image_An_Introduction_t_z_library_sk,_1lib_sk,')).toBe('The Discarded Image An Introduction');
    expect(limpiarTitulo('El casamiento en la muerte - Viuda de Francisco Leefdael ')).toBe('El casamiento en la muerte - Viuda de Francisco Leefdael');
    expect(limpiarTitulo('Rayuela.pdf')).toBe('Rayuela');
    expect(limpiarTitulo('Attention Is All You Need')).toBe('Attention Is All You Need');
  });

  it('detecta el idioma por palabras vacías', () => {
    expect(detectarIdioma('Nunca me preocupo demasiado por las cosas que dice Johnny pero ahora, con su manera de hablar de la música y de lo que le pasa cuando toca, me quedo pensando en el tiempo y en la gente que se va')?.idioma).toBe('es');
    expect(detectarIdioma('The fundamental root of it all building block for linear algebra is the vector, so it is worth making sure that we are all on the same page about what exactly a vector is and what it means for the rest')?.idioma).toBe('en');
    expect(detectarIdioma('corto')).toBeNull();
  });

  it('normaliza códigos de idioma', () => {
    expect(normalizarIdioma('EN')).toBe('en');
    expect(normalizarIdioma('es_ES')).toBe('es-es');
    expect(normalizarIdioma('Spanish')).toBe('es');
    expect(normalizarIdioma('[NOT_FOUND]')).toBeNull();
    expect(normalizarIdioma('???')).toBeNull();
    expect(esVacio(' n/a ')).toBe(true);
  });
});

describe('utilidades de migración', () => {
  it('mime de imágenes por la firma', () => {
    expect(mimeImagen(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(mimeImagen(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(mimeImagen(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
  });

  it('PDF escaneado: sin fuentes y con imágenes', () => {
    const t = (s: string) => new TextEncoder().encode(s);
    expect(pareceEscaneado(t('<< /Type /XObject /Subtype /Image >>'), 1)).toBe(true);
    expect(pareceEscaneado(t('<< /Font /F1 >> << /Font /F2 >> << /Font /F3 >> << /Font /F4 >> << /Subtype /Image >>'), 1)).toBe(false);
  });

  it('cola de texto cortada por palabra', () => {
    expect(colaDeTexto('uno dos tres', 240)).toBe('uno dos tres');
    const c = colaDeTexto('palabra '.repeat(100), 30);
    expect(c.startsWith('…')).toBe(true);
    expect(c.length).toBeLessThanOrEqual(31);
  });
});
