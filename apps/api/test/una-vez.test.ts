/**
 * El trabajador hace cada trabajo largo una sola vez: el reintento de un paso
 * que caducó se suma al trabajo en marcha, el resultado se recuerda y dos
 * consolidaciones del mismo objeto nunca corren a la vez.
 */
import { describe, expect, it } from 'vitest';
import { UnaVez, type AlmacenUnaVez } from '../src/compartido/una-vez';
import { plazoConsolidacion } from '../src/compartido/tuberia-plataforma';

function almacenEnMemoria(): AlmacenUnaVez & { datos: Map<string, unknown> } {
  const datos = new Map<string, unknown>();
  return {
    datos,
    async get<T>(k: string) { return datos.get(k) as T | undefined; },
    async put<T>(k: string, v: T) { datos.set(k, structuredClone(v)); },
  };
}

function diferido<T>() {
  let resolver!: (v: T) => void, rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((a, b) => { resolver = a; rechazar = b; });
  return { promesa, resolver, rechazar };
}

describe('UnaVez', () => {
  it('el reintento se suma al trabajo en marcha', async () => {
    const u = new UnaVez(almacenEnMemoria());
    const d = diferido<{ fragmentos: number }>();
    let veces = 0;
    const fn = () => { veces++; return d.promesa; };
    const primero = u.hacer('consolidar:t1', fn, { recordar: true });
    const reintento = u.hacer('consolidar:t1', fn, { recordar: true });
    d.resolver({ fragmentos: 179 });
    expect(await primero).toEqual({ fragmentos: 179 });
    expect(await reintento).toEqual({ fragmentos: 179 });
    expect(veces).toBe(1);
  });

  it('lo terminado se recuerda (también en otra instancia del objeto)', async () => {
    const almacen = almacenEnMemoria();
    let veces = 0;
    const fn = async () => { veces++; return { unidades: 125 }; };
    await new UnaVez(almacen).hacer('consolidar:t1', fn, { recordar: true });
    // El objeto se reinicia: la memoria se pierde, el almacenamiento no.
    expect(await new UnaVez(almacen).hacer('consolidar:t1', fn, { recordar: true })).toEqual({ unidades: 125 });
    expect(veces).toBe(1);
  });

  it('un fallo no se recuerda y el siguiente intento empieza de cero', async () => {
    const almacen = almacenEnMemoria();
    const u = new UnaVez(almacen);
    let veces = 0;
    const fn = async () => { veces++; if (veces === 1) throw new Error('Gemini 503'); return 'hecho'; };
    await expect(u.hacer('k', fn, { recordar: true })).rejects.toThrow('Gemini 503');
    expect(almacen.datos.size).toBe(0);
    expect(await u.hacer('k', fn, { recordar: true })).toBe('hecho');
    expect(veces).toBe(2);
  });

  it('sin recordar, al terminar se puede volver a hacer', async () => {
    const u = new UnaVez(almacenEnMemoria());
    let veces = 0;
    const fn = async () => ++veces;
    expect(await u.hacer('tanda:3', fn)).toBe(1);
    expect(await u.hacer('tanda:3', fn)).toBe(2);
  });

  it('los exclusivos van en fila aunque cambie la clave', async () => {
    const u = new UnaVez(almacenEnMemoria());
    const orden: string[] = [];
    const d = diferido<void>();
    const viejo = u.hacer('consolidar:t1:preparado-1', async () => { orden.push('viejo empieza'); await d.promesa; orden.push('viejo acaba'); }, { exclusivo: true });
    const nuevo = u.hacer('consolidar:t1:preparado-2', async () => { orden.push('nuevo empieza'); }, { exclusivo: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(orden).toEqual(['viejo empieza']);
    d.resolver();
    await Promise.all([viejo, nuevo]);
    expect(orden).toEqual(['viejo empieza', 'viejo acaba', 'nuevo empieza']);
  });

  it('un exclusivo que falla no bloquea la fila', async () => {
    const u = new UnaVez();
    await expect(u.hacer('a', async () => { throw new Error('x'); }, { exclusivo: true })).rejects.toThrow('x');
    expect(await u.hacer('b', async () => 'sigue', { exclusivo: true })).toBe('sigue');
  });
});

describe('plazo del paso «consolidar»', () => {
  it('en audio y vídeo manda la duración, no los tramos', () => {
    // Fresa y chocolate: 6638 s, 12 tramos de diez minutos. Antes: 120 + 2 × 12 = 144 s.
    expect(plazoConsolidacion({ modo: 'medio', unidades: 12, coste: 111 })).toBe(1188);
    expect(plazoConsolidacion({ modo: 'medio', unidades: 1, coste: 3 })).toBe(324);
    expect(plazoConsolidacion({ modo: 'medio', unidades: 60, coste: 600 })).toBe(3600);
  });

  it('en los libros sigue mandando el número de páginas', () => {
    expect(plazoConsolidacion({ modo: 'paginas', unidades: 15, coste: 15 })).toBe(150);
    expect(plazoConsolidacion({ modo: 'paginas', unidades: 1000, coste: 1000 })).toBe(2120);
  });
});
