import { describe, expect, it } from 'vitest';
import { busquedaDePrueba, cadenaACaracteres, cadenaARegion, caracteresACadena, materialDeBusqueda, regionACadena, textoDeCaracteres, validarBusquedaLector } from './anclas';

const pagina = { tipo: 'pagina' as const, fisica: 14, impresa: '12', romana: false, origen: 'leido' as const, confianza: 1 };

describe('el ancla material en la URL', () => {
  it('caracteres: ida y vuelta, y lo que no vale se cae', () => {
    expect(caracteresACadena([120, 188])).toBe('120-188');
    expect(cadenaACaracteres('120-188')).toEqual([120, 188]);
    expect(cadenaACaracteres('188-120')).toBeUndefined();
    expect(cadenaACaracteres('a-b')).toBeUndefined();
    expect(cadenaACaracteres(42)).toBeUndefined();
  });

  it('región: cuatro decimales, recortada a la imagen y con superficie', () => {
    expect(regionACadena({ x: 0.123456, y: 0.5, w: 0.25, h: 0.1 })).toBe('0.1235,0.5,0.25,0.1');
    expect(cadenaARegion('0.1235,0.5,0.25,0.1')).toEqual({ x: 0.1235, y: 0.5, w: 0.25, h: 0.1 });
    expect(cadenaARegion('0.9,0.9,0.5,0.5')).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    expect(cadenaARegion('0.1,0.1,0,0.2')).toBeUndefined();
    expect(cadenaARegion('0.1,0.1,0.2')).toBeUndefined();
  });

  it('el lector valida sus parámetros y los enlaces de antes siguen igual', () => {
    expect(validarBusquedaLector({ u: '14', cr: '10-40', rg: '0.1,0.2,0.3,0.4', it: '64.5' })).toEqual({ u: 14, cr: '10-40', rg: '0.1,0.2,0.3,0.4', it: 64.5 });
    expect(validarBusquedaLector({ u: '14', cr: 'basura', rg: '1,2' })).toEqual({ u: 14 });
    expect(validarBusquedaLector({ t: '12.5', f: 'f-1', pd: '3', ph: '9' })).toEqual({ t: 12.5, f: 'f-1', pd: 3, ph: 9 });
  });

  it('el material de llegada: el instante solo cuenta con región', () => {
    expect(materialDeBusqueda({})).toBeNull();
    expect(materialDeBusqueda({ it: 4 })).toBeNull();
    expect(materialDeBusqueda({ cr: '1-5', it: 4 })).toEqual({ caracteres: [1, 5] });
    expect(materialDeBusqueda({ rg: '0.1,0.2,0.3,0.4', it: 4 })).toEqual({ region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, instante: 4 });
  });
});

describe('de una prueba al lector', () => {
  it('una página con caracteres y región', () => {
    expect(busquedaDePrueba({ ancla: { ...pagina, caracteres: [100, 160], region: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 } } })).toEqual({ u: 14, cr: '100-160', rg: '0.1,0.2,0.5,0.1' });
  });

  it('un vídeo con región abre en el fotograma; sin ella, al principio del tramo', () => {
    expect(busquedaDePrueba({ ancla: { tipo: 'tiempo', t0: 3723.4, t1: 3790, region: { x: 0.3, y: 0.1, w: 0.4, h: 0.6 }, instante: 3741.27 } })).toEqual({ t: 3741.2, rg: '0.3,0.1,0.4,0.6', it: 3741.27 });
    expect(busquedaDePrueba({ ancla: { tipo: 'tiempo', t0: 3723.46, t1: 3790 } })).toEqual({ t: 3723.4 });
  });

  it('sin página ni tiempo, el orden de la unidad (de 0 en la API a 1 en la web)', () => {
    expect(busquedaDePrueba({ ancla: { tipo: 'imagen', region: { x: 0, y: 0, w: 0.5, h: 0.5 } }, orden: 0 })).toEqual({ u: 1, rg: '0,0,0.5,0.5' });
  });
});

describe('el texto de unos caracteres', () => {
  it('cuenta puntos de código NFC, no unidades UTF-16', () => {
    // «𝔄» ocupa dos unidades UTF-16 y es un solo punto de código.
    const t = '𝔄 dijo: la muñeca baila.';
    expect(textoDeCaracteres(t, [8, 17])).toBe('la muñeca');
  });

  it('normaliza a NFC (una «ñ» descompuesta cuenta como una)', () => {
    const t = 'la muñeca baila';
    expect(textoDeCaracteres(t, [3, 9])).toBe('muñeca');
  });

  it('sin el marcado de la unidad y con los versos separados', () => {
    const t = '**Rosaura:** Con asombro de mirarte.\nCon admiracion de oirte';
    expect(textoDeCaracteres(t, [13, t.length])).toBe('Con asombro de mirarte. / Con admiracion de oirte');
    expect(textoDeCaracteres(t, [50, 40])).toBe('');
    expect(textoDeCaracteres('corto', [2, 99])).toBe('rto');
  });
});
