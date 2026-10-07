/**
 * El esquema de las cuentas se comprueba una vez por base, no en cada petición:
 * en Cloudflare cada petición crea su `Cuentas`, y repetirlo eran ~30 viajes a D1
 * (unos 700 ms en /auth/yo, /ajustes, /bibliotecas o en la cuota de cada búsqueda).
 */
import { describe, expect, it } from 'vitest';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { Cuentas, ESQUEMA_CUENTAS, type EstadoEsquemaCuentas } from '../src/compartido/cuentas.js';

function baseQueCuenta(conLote: boolean) {
  const registro = { sentencias: 0, viajes: 0 };
  const sql: SQL & { ejecutarVarias?: (s: string[]) => Promise<void> } = {
    async ejecutar<T>(_consulta: string, ..._p: ValorSQL[]): Promise<T[]> { registro.sentencias++; registro.viajes++; return [] as T[]; },
    async transaccion<T>(fn: (s: SQL) => Promise<T>) { return fn(sql); },
  };
  if (conLote) sql.ejecutarVarias = async (s) => { registro.sentencias += s.length; registro.viajes++; };
  return { sql, registro };
}

describe('esquema de las cuentas', () => {
  it('con el estado compartido, la segunda petición no repite el esquema', async () => {
    const { sql, registro } = baseQueCuenta(false);
    const estado: EstadoEsquemaCuentas = { listo: null };
    await new Cuentas(sql, 'clave', estado).ajustes('u1');
    const tras1 = registro.sentencias;
    expect(tras1).toBeGreaterThan(ESQUEMA_CUENTAS.length);
    await new Cuentas(sql, 'clave', estado).ajustes('u1');
    expect(registro.sentencias - tras1).toBe(1); // solo el SELECT de los ajustes
  });

  it('sin estado compartido, cada instancia lo comprueba (comportamiento de siempre)', async () => {
    const { sql, registro } = baseQueCuenta(false);
    await new Cuentas(sql, 'clave').ajustes('u1');
    const tras1 = registro.sentencias;
    await new Cuentas(sql, 'clave').ajustes('u1');
    expect(registro.sentencias - tras1).toBe(tras1);
  });

  it('con lote (D1), el esquema entero va en un solo viaje', async () => {
    const { sql, registro } = baseQueCuenta(true);
    await new Cuentas(sql, 'clave').preparar();
    // Las CREATE del esquema van en un viaje; lo demás (PRAGMA, columnas nuevas, índices), una a una.
    expect(registro.sentencias).toBeGreaterThan(ESQUEMA_CUENTAS.length);
    expect(registro.viajes).toBe(registro.sentencias - ESQUEMA_CUENTAS.length + 1);
  });

  it('si el esquema falla, la siguiente petición lo reintenta', async () => {
    let fallar = true;
    const sql: SQL = {
      async ejecutar<T>(): Promise<T[]> { if (fallar) throw new Error('D1 caída'); return [] as T[]; },
      async transaccion<T>(fn: (s: SQL) => Promise<T>) { return fn(sql); },
    };
    const estado: EstadoEsquemaCuentas = { listo: null };
    await expect(new Cuentas(sql, 'clave', estado).preparar()).rejects.toThrow('D1 caída');
    await Promise.resolve();
    fallar = false;
    await expect(new Cuentas(sql, 'clave', estado).preparar()).resolves.toBeUndefined();
  });
});
