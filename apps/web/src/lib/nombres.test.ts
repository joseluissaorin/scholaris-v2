import { describe, expect, it } from 'vitest';
import { nombreIdioma, nombreTipoCsl } from './nombres';

describe('nombres legibles de la ficha', () => {
  it('idiomas por su nombre en el idioma de la interfaz, con mayúscula', () => {
    expect(nombreIdioma('es', 'es')).toBe('Español');
    expect(nombreIdioma('en', 'es')).toBe('Inglés');
    expect(nombreIdioma('la', 'es')).toBe('Latín');
    expect(nombreIdioma('es', 'en')).toBe('Spanish');
  });
  it('lo que no es un código se queda como está', () => {
    expect(nombreIdioma('', 'es')).toBe('');
    expect(nombreIdioma('inglés', 'es')).toBe('inglés');
    expect(nombreIdioma('zzz', 'es')).toBe('zzz');
  });
  it('tipos CSL en español', () => {
    expect(nombreTipoCsl('chapter')).toBe('Capítulo');
    expect(nombreTipoCsl('article-journal')).toBe('Artículo de revista');
    expect(nombreTipoCsl('algo-nuevo')).toBe('algo-nuevo');
  });
});
