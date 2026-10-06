/** Adaptador del puerto SQL sobre node:sqlite (SQLite con FTS5), en memoria, con el esquema SPDF 4.1. */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { SQL, ValorSQL } from '@scholaris/nucleo';

const ESQUEMA = fileURLToPath(new URL('../../../spdf/esquema/v4.1.sql', import.meta.url));

export interface SQLMedido extends SQL {
  consultas: number;
  bd: DatabaseSync;
}

export function crearSQL(): SQLMedido {
  const bd = new DatabaseSync(':memory:');
  bd.exec(readFileSync(ESQUEMA, 'utf8'));
  const sql: SQLMedido = {
    consultas: 0,
    bd,
    async ejecutar<T>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
      sql.consultas++;
      const ps = parametros.map((p) => (p instanceof ArrayBuffer ? new Uint8Array(p) : p));
      return bd.prepare(consulta).all(...(ps as Array<string | number | null | Uint8Array>)) as T[];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> {
      bd.exec('BEGIN');
      try { const r = await fn(sql); bd.exec('COMMIT'); return r; } catch (e) { bd.exec('ROLLBACK'); throw e; }
    },
  };
  return sql;
}
