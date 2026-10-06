import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturarCuponDeLaUrl, cuponPendiente, normalizarCupon, olvidarCuponPendiente } from './cupon-pendiente';

/** Un navegador mínimo: URL, historial y almacenamiento. */
function navegador(href: string) {
  const datos = new Map<string, string>();
  const ventana = {
    location: { href },
    history: { state: null, replaceState: vi.fn((_: unknown, __: string, a: string) => { ventana.location.href = new URL(a, href).href; }) },
  };
  vi.stubGlobal('window', ventana);
  vi.stubGlobal('localStorage', { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => datos.set(k, v), removeItem: (k: string) => datos.delete(k) });
  return ventana;
}

afterEach(() => vi.unstubAllGlobals());

describe('cupón pendiente', () => {
  it('normaliza lo tecleado y rechaza lo que no puede ser un cupón', () => {
    expect(normalizarCupon('scho-ac3d-4fgh')).toBe('SCHO-AC3D-4FGH');
    expect(normalizarCupon('AC3D 4FGH')).toBe('SCHO-AC3D-4FGH');
    expect(normalizarCupon('SCHO-0OI1-AAAA')).toBeNull();
    expect(normalizarCupon('hola')).toBeNull();
  });

  it('«/?cupon=» se guarda y desaparece de la dirección', () => {
    const v = navegador('https://scholaris.prueba/?cupon=scho-ac3d-4fgh&otra=1#x');
    capturarCuponDeLaUrl();
    expect(cuponPendiente()).toBe('SCHO-AC3D-4FGH');
    expect(v.location.href).toBe('https://scholaris.prueba/?otra=1#x');
    olvidarCuponPendiente();
    expect(cuponPendiente()).toBeNull();
  });

  it('un código malformado no se guarda, pero se limpia de la URL', () => {
    const v = navegador('https://scholaris.prueba/?cupon=nada');
    capturarCuponDeLaUrl();
    expect(cuponPendiente()).toBeNull();
    expect(v.location.href).toBe('https://scholaris.prueba/');
  });
});
