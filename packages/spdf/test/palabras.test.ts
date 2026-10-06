import { DatabaseSync } from 'node:sqlite';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { aplicarEsquema } from '../src/esquema.js';
import { escribirDocumento, escribirUnidades, instantesDePalabras, leerUnidades } from '../src/repositorio.js';

function puerto(db: DatabaseSync): SQL {
  const p: SQL = {
    async ejecutar<T>(q: string, ...a: ValorSQL[]): Promise<T[]> {
      const st = db.prepare(q);
      const args = a as Array<string | number | null | Uint8Array>;
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(q)) return st.all(...args) as T[];
      st.run(...args);
      return [];
    },
    async transaccion(fn) { db.exec('BEGIN'); try { const r = await fn(p); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
  return p;
}

const doc = { id: 'd', tipo: 'video' as const, metadatos: { titulo: 'Grabación de prueba', autores: [] }, estado: 'listo' as const, huella: 'h', original: '', mime: 'video/mp4', bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [] };

describe('unidades.palabras', () => {
  it('una base sin la columna la gana al aplicar el esquema, y aplicarlo dos veces no hace nada', async () => {
    const db = new DatabaseSync(':memory:');
    // Una base 4.1 anterior: la tabla de unidades sin «palabras».
    db.exec("CREATE TABLE unidades (id TEXT PRIMARY KEY, documento TEXT NOT NULL, orden INTEGER NOT NULL, ancla TEXT NOT NULL, texto TEXT NOT NULL DEFAULT '', notas TEXT, cabecera TEXT, pie TEXT, imagen TEXT, miniatura TEXT, lector TEXT NOT NULL, confianza REAL NOT NULL DEFAULT 1, impresa TEXT, t0 REAL, t1 REAL)");
    db.exec("INSERT INTO unidades (id, documento, orden, ancla, texto, lector) VALUES ('viejo', 'd', 0, '{\"tipo\":\"tiempo\",\"t0\":0,\"t1\":1}', 'hola', 'x')");
    const sql = puerto(db);
    await aplicarEsquema(sql);
    await aplicarEsquema(sql);
    const columnas = (db.prepare('PRAGMA table_info(unidades)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(columnas.filter((c) => c === 'palabras')).toHaveLength(1);
    // Lo que había sigue ahí, sin palabras.
    const [viejo] = await leerUnidades(sql, 'd');
    expect(viejo?.texto).toBe('hola');
    expect(viejo?.palabras).toBeUndefined();
  });

  it('ida y vuelta: las palabras se guardan y se leen con su instante', async () => {
    const sql = puerto(new DatabaseSync(':memory:'));
    await aplicarEsquema(sql);
    await escribirDocumento(sql, doc);
    const palabras = { v: 1 as const, t0: 612.5, cs: [0, 40, 45, 30, 80, 55] };
    await escribirUnidades(sql, [{ id: 'u', documento: 'd', orden: 0, ancla: { tipo: 'tiempo', t0: 612.5, t1: 614 }, texto: '¿Qué hora es?', lector: 't', confianza: 1, palabras }]);
    const [u] = await leerUnidades(sql, 'd');
    expect(u?.palabras).toEqual(palabras);
    expect(instantesDePalabras(u!.palabras!)).toEqual([[612.5, 612.9], [612.95, 613.25], [613.3, 613.85]]);
  });
});
