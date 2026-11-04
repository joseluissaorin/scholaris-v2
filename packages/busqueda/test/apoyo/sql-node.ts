/** Adaptador del puerto SQL sobre node:sqlite (SQLite con FTS5), en memoria, con el esquema SPDF 4.1. */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { sqlConLimite, type SQL, type ValorSQL } from '@scholaris/nucleo';

const esquema = (version: string) => fileURLToPath(new URL(`../../../spdf/esquema/v${version}.sql`, import.meta.url));

export interface SQLMedido extends SQL {
  consultas: number;
  bd: DatabaseSync;
}

/** Por defecto con el esquema 4.1 (sin la capa de comprensión); `'4.2'` la trae. */
export function crearSQL(version: '4.1' | '4.2' = '4.1'): SQLMedido {
  const bd = new DatabaseSync(':memory:');
  bd.exec(readFileSync(esquema(version), 'utf8'));
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
  // Como D1 y los Durable Objects: más de 100 parámetros en una sentencia es un error.
  return sqlConLimite(sql);
}
