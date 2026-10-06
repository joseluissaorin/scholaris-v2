import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { describe, expect, it } from 'vitest';
import { aplicarEsquema, ESQUEMA_V4, partirSentencias, VERSION_SPDF } from '../src/esquema.js';
import { buscarTexto, escribirDocumento, escribirFragmentos, leerClave, leerDocumento } from '../src/repositorio.js';

/** Un puerto SQL sobre node:sqlite: hace de better-sqlite3 / Durable Object en las pruebas. */
function puertoNode(db: DatabaseSync, opciones: { sinPragma?: boolean } = {}): SQL & { sentencias: string[] } {
  const sentencias: string[] = [];
  const puerto = {
    sentencias,
    async ejecutar<T>(consulta: string, ...p: ValorSQL[]): Promise<T[]> {
      sentencias.push(consulta);
      if (opciones.sinPragma && /^\s*PRAGMA/i.test(consulta)) throw new Error('not authorized');
      const st = db.prepare(consulta);
      const params = p.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v)) as Array<string | number | null | Uint8Array>;
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(consulta) || /RETURNING/i.test(consulta)) return st.all(...params) as T[];
      st.run(...params);
      return [];
    },
    async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
      db.exec('BEGIN');
      try { const r = await fn(puerto); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return puerto;
}

describe('esquema v4.1', () => {
  it('la constante coincide con esquema/v4.1.sql', () => {
    const sql = readFileSync(join(import.meta.dirname, '../esquema/v4.1.sql'), 'utf8');
    expect(ESQUEMA_V4).toBe(sql);
  });

  it('partirSentencias respeta los disparadores, los comentarios y las cadenas', () => {
    const s = partirSentencias(ESQUEMA_V4);
    const disparadores = s.filter((x) => /^CREATE TRIGGER/i.test(x));
    expect(disparadores).toHaveLength(3);
    for (const d of disparadores) expect(d.trimEnd().endsWith('END')).toBe(true);
    expect(s.some((x) => x.startsWith('--'))).toBe(false);
    expect(partirSentencias("INSERT INTO t VALUES ('a;b'); -- c;d\nSELECT \"x;y\" FROM t;")).toEqual(["INSERT INTO t VALUES ('a;b')", 'SELECT "x;y" FROM t']);
    expect(partirSentencias('/* a; b */ SELECT 1;')).toEqual(['SELECT 1']);
  });

  it('se aplica sobre otro puerto SQL (node:sqlite como better-sqlite3), dos veces, sin PRAGMA', async () => {
    const db = new DatabaseSync(':memory:');
    const sql = puertoNode(db, { sinPragma: true });
    await aplicarEsquema(sql, { generador: 'prueba' });
    await aplicarEsquema(sql); // idempotente
    expect(await leerClave(sql, 'spdf_version')).toBe(VERSION_SPDF);
    expect(await leerClave(sql, 'generador')).toBe('prueba');
    const tablas = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ['spdf', 'documentos', 'unidades', 'secciones', 'fragmentos', 'fragmentos_fts', 'figuras', 'espacios', 'vectores', 'blobs', 'procedencia']) {
      expect(tablas).toContain(t);
    }
    // Y los ayudantes tipados funcionan sobre ese puerto, FTS5 incluido.
    await escribirDocumento(sql, {
      id: 'd1', tipo: 'pdf', metadatos: { titulo: 'Vigilar y castigar', autores: [{ nombre: 'Michel', apellidos: 'Foucault' }], anio: 1975 },
      estado: 'listo', huella: 'h', original: '', mime: 'application/pdf', bytes: 1, unidades: 1, creado: 'x', actualizado: 'x', bibliotecas: [],
    });
    await escribirFragmentos(sql, [{
      id: 'f1', documento: 'd1', unidad: 'u1', orden: 1, texto: 'El panóptico es una máquina de disociar la pareja ver-ser visto.',
      contexto: '', seccion: ['III. Disciplina'], ancla: { tipo: 'pagina', fisica: 10, impresa: '205', romana: false, origen: 'leido', confianza: 1 },
    }]);
    expect((await leerDocumento(sql, 'd1'))?.metadatos.anio).toBe(1975);
    const r = await buscarTexto(sql, 'panoptico');
    expect(r[0]?.fragmento.id).toBe('f1');
    db.close();
  });
});
