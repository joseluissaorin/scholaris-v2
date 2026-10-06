import { describe, expect, it } from 'vitest';
import { buscarTexto, crearSpdf, leerVectores } from '../src/index.js';

describe('límite de 100 parámetros (D1, Durable Objects)', () => {
  it('las pruebas fallan como en Cloudflare y las listas largas van en un solo parámetro', async () => {
    const a = await crearSpdf();
    const ids = Array.from({ length: 1000 }, (_, i) => `x${i}`);
    await expect(a.sql.ejecutar(`SELECT 1 WHERE 'a' IN (${ids.slice(0, 101).map(() => '?').join(',')})`, ...ids.slice(0, 101))).rejects.toThrow(/too many SQL variables/);
    expect(await buscarTexto(a.sql, 'nada', { documentos: ids })).toEqual([]);
    expect(await leerVectores(a.sql, { espacio: 'e', ids })).toEqual([]);
  });
});
