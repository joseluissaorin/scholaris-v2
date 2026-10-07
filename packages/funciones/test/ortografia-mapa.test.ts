import { describe, expect, it } from 'vitest';
import { tildarRotulo } from '../src/mapa/ortografia.js';

describe('tildes de los rótulos del mapa', () => {
  it('pone las tildes que el modelo se come', () => {
    expect(tildarRotulo('Teatro aureo y epopeya carolingia')).toBe('Teatro áureo y epopeya carolingia');
    expect(tildarRotulo('Teoria critica de la traduccion')).toBe('Teoría crítica de la traducción');
    expect(tildarRotulo('EPICA y lirica')).toBe('ÉPICA y lírica');
  });
  it('no toca lo que ya está bien, los plurales en -ciones ni los rótulos ingleses', () => {
    expect(tildarRotulo('Teatro clásico y épica hispánica')).toBe('Teatro clásico y épica hispánica');
    expect(tildarRotulo('Traducciones y adaptaciones')).toBe('Traducciones y adaptaciones');
    expect(tildarRotulo('Vision Transformers')).toBe('Vision Transformers');
    expect(tildarRotulo('Arquitectura y Modelos Transformer')).toBe('Arquitectura y Modelos Transformer');
  });
});
