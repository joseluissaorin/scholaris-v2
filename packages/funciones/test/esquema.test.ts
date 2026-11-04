import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aplicarEsquema } from '../../spdf/src/esquema.js';
import { fileURLToPath } from 'node:url';
import { aplicarEsquemaFunciones, objetoDeSentencia, SENTENCIAS_FUNCIONES, TABLAS_FUNCIONES } from '../src/esquema.js';
import { sqlMemoria } from './ayudas.js';

/**
 * Todo cambio de esquema en packages/funciones pasa por aquí: el esquema se
 * aplica dos veces sobre la misma base y sobre una base a medio crear.
 */

const RUTA_SPDF = fileURLToPath(new URL('../../spdf/esquema/v4.0.sql', import.meta.url));
const DIR_SPDF = fileURLToPath(new URL('../../spdf/esquema/', import.meta.url));
const ESQUEMAS_SPDF = readdirSync(DIR_SPDF).filter((f) => f.endsWith('.sql')).map((f) => join(DIR_SPDF, f));

function base() {
  const sql = sqlMemoria(new Database(':memory:'));
  sql.db.exec(readFileSync(RUTA_SPDF, 'utf8'));
  return sql;
}

const objetos = (sql: ReturnType<typeof base>) =>
  sql.db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string }>;

describe('esquema de funciones', () => {
  it('cada sentencia es idempotente y no hay dos objetos con el mismo nombre', () => {
    const nombres = new Map<string, string>();
    for (const s of SENTENCIAS_FUNCIONES) {
      const o = objetoDeSentencia(s);
      expect(o, `sin IF NOT EXISTS: ${s.slice(0, 80)}`).not.toBeNull();
      expect(nombres.has(o!.nombre), `nombre repetido: ${o!.nombre}`).toBe(false);
      nombres.set(o!.nombre, o!.tipo);
    }
    // Las tablas del esquema SPDF tampoco pueden chocar con las nuestras, en ninguna versión
    // (la 4.2 salió un rato con sus propias «entidades» y «menciones» y rompió la estantería).
    for (const v of ESQUEMAS_SPDF) {
      const spdf = new Set([...readFileSync(v, 'utf8').matchAll(/CREATE\s+(?:VIRTUAL\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]));
      for (const n of nombres.keys()) expect(spdf.has(n), `choca con SPDF (${v}): ${n}`).toBe(false);
    }
    for (const t of TABLAS_FUNCIONES) expect(nombres.get(t)).toBe('table');
  });

  it('aplicado dos veces sobre la misma base deja lo mismo', async () => {
    const sql = base();
    await aplicarEsquemaFunciones(sql);
    const antes = objetos(sql);
    await aplicarEsquemaFunciones(sql);
    expect(objetos(sql)).toEqual(antes);
  });

  it('repara una base a medio crear (índice con nombre de tabla, columnas que faltan, tablas sin crear)', async () => {
    const limpia = base();
    await aplicarEsquemaFunciones(limpia);
    const esperado = objetos(limpia);

    const sql = base();
    // El estado que dejó el despliegue roto: «entidades» sin columnas nuevas y un
    // índice que ocupa el nombre de la tabla «entidades_wikidata», que no existe.
    sql.db.exec(`CREATE TABLE entidades (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, clave TEXT NOT NULL, nombre TEXT NOT NULL,
      creada TEXT NOT NULL, actualizada TEXT NOT NULL, UNIQUE (tipo, clave))`);
    sql.db.exec('CREATE INDEX entidades_wikidata ON entidades(nombre)');
    sql.db.exec("INSERT INTO entidades (id, tipo, clave, nombre, creada, actualizada) VALUES ('e1', 'persona', 'x', 'X', '', '')");
    await aplicarEsquemaFunciones(sql);
    expect(objetos(sql)).toEqual(esperado);
    const fila = sql.db.prepare("SELECT * FROM entidades WHERE id = 'e1'").get() as Record<string, unknown>;
    expect(fila).toMatchObject({ alias: '[]', busqueda: '', wikidata_visto: 0, n_menciones: 0, fusionada_en: null });
    // Y la tabla de la caché de Wikidata ya se puede usar.
    await sql.ejecutar("INSERT INTO entidades_wikidata (consulta, idioma, respuesta, creada) VALUES ('a', 'es', '[]', '')");
    // Una segunda pasada sobre la base reparada tampoco cambia nada.
    await aplicarEsquemaFunciones(sql);
    expect(objetos(sql)).toEqual(esperado);
  });

  it('el esquema SPDF actual y el de funciones conviven, en los dos órdenes', async () => {
    for (const orden of ['spdf-primero', 'funciones-primero'] as const) {
      const sql = sqlMemoria(new Database(':memory:'));
      if (orden === 'spdf-primero') { await aplicarEsquema(sql); await aplicarEsquemaFunciones(sql); }
      else { await aplicarEsquemaFunciones(sql); await aplicarEsquema(sql); }
      await aplicarEsquema(sql);
      await aplicarEsquemaFunciones(sql);
      // Las entidades son las de funciones, con sus columnas, y se escriben y se cuentan.
      sql.db.exec("INSERT INTO entidades (id, tipo, clave, nombre, creada, actualizada) VALUES ('e1', 'persona', 'diego', 'Diego', 'x', 'x')");
      sql.db.exec("UPDATE entidades SET n_menciones = 3 WHERE id = 'e1'");
      expect(sql.db.prepare("SELECT n_menciones FROM entidades WHERE id = 'e1'").get()).toEqual({ n_menciones: 3 });
      const tablas = (sql.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
      for (const t of ['segmentos', 'fichas', 'apariciones', 'relaciones', 'alineaciones', 'entidades', 'menciones', 'cuadernos']) expect(tablas, t).toContain(t);
    }
  });

  it('aplicar el esquema SPDF repara los restos del primer 4.2 (disparadores sobre «entidades»)', async () => {
    const sql = sqlMemoria(new Database(':memory:'));
    await aplicarEsquemaFunciones(sql);
    // Lo que dejó en producción, el 4-11-2026, la versión que chocaba.
    sql.db.exec(`CREATE VIRTUAL TABLE entidades_fts USING fts5(nombre, alias, descripcion, content='entidades', content_rowid='n', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER entidades_ai AFTER INSERT ON entidades BEGIN INSERT INTO entidades_fts(rowid, nombre, alias, descripcion) VALUES (new.n, new.nombre, new.alias, new.descripcion); END;
      CREATE TRIGGER entidades_au AFTER UPDATE ON entidades BEGIN INSERT INTO entidades_fts(entidades_fts, rowid, nombre, alias, descripcion) VALUES ('delete', old.n, old.nombre, old.alias, old.descripcion); END;
      CREATE INDEX entidades_tipo ON entidades(tipo, nombre);`);
    expect(() => sql.db.exec("INSERT INTO entidades (id, tipo, clave, nombre, creada, actualizada) VALUES ('e0', 'persona', 'x', 'X', 'x', 'x')")).toThrow(/no such column/);
    await aplicarEsquema(sql);
    sql.db.exec("INSERT INTO entidades (id, tipo, clave, nombre, creada, actualizada) VALUES ('e1', 'persona', 'diego', 'Diego', 'x', 'x')");
    sql.db.exec("UPDATE entidades SET n_menciones = 1 WHERE id = 'e1'");
    const restos = sql.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('entidades_fts', 'entidades_ai', 'entidades_au', 'entidades_tipo')").all();
    expect(restos).toEqual([]);
  });
});
