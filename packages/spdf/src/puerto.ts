/**
 * El puerto `SQL` de nucleo sobre una base sqlite-wasm en memoria.
 *
 * Todas las operaciones son síncronas por debajo (la base vive en la memoria
 * del WebAssembly); la interfaz es asíncrona para casar con D1 y los Durable
 * Objects. Las sentencias preparadas se guardan en una caché pequeña.
 */

import type { SQL, ValorSQL } from '@scholaris/nucleo';
import type { Database, PreparedStatement, SqlValue } from '@sqlite.org/sqlite-wasm';

const MAX_CACHE = 128;

export class SqlWasm implements SQL {
  private readonly cache = new Map<string, PreparedStatement>();
  private profundidad = 0;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(readonly db: Database) {}

  async ejecutar<T = Record<string, ValorSQL>>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
    return this.ejecutarSync<T>(consulta, parametros);
  }

  /** Versión síncrona de `ejecutar`, para los caminos calientes (migración, inserciones masivas). */
  ejecutarSync<T = Record<string, ValorSQL>>(consulta: string, parametros: readonly ValorSQL[] = []): T[] {
    const st = this.preparar(consulta);
    try {
      if (parametros.length) st.bind(parametros.map(aValorSqlite));
      const filas: T[] = [];
      while (st.step()) filas.push(normalizarFila(st.get({}) as Record<string, unknown>) as T);
      return filas;
    } finally {
      try { st.reset(true); } catch { /* sentencia ya finalizada */ }
    }
  }

  /** Ejecuta un guion con varias sentencias y sin parámetros. */
  guion(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Transacción con SAVEPOINT: admite anidamiento. Las transacciones de primer
   * nivel se encolan para que dos llamadas concurrentes no se mezclen.
   */
  async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    if (this.profundidad > 0) return this.punto(fn);
    const turno = this.cola.then(() => this.punto(fn));
    this.cola = turno.catch(() => undefined);
    return turno;
  }

  private async punto<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    const nombre = `sp${this.profundidad}`;
    this.profundidad++;
    this.db.exec(`SAVEPOINT ${nombre}`);
    try {
      const r = await fn(this);
      this.db.exec(`RELEASE ${nombre}`);
      return r;
    } catch (e) {
      this.db.exec(`ROLLBACK TO ${nombre}`);
      this.db.exec(`RELEASE ${nombre}`);
      throw e;
    } finally {
      this.profundidad--;
    }
  }

  private preparar(consulta: string): PreparedStatement {
    let st = this.cache.get(consulta);
    if (st) {
      // Refresca su posición en la caché (LRU).
      this.cache.delete(consulta);
      this.cache.set(consulta, st);
      return st;
    }
    st = this.db.prepare(consulta);
    this.cache.set(consulta, st);
    if (this.cache.size > MAX_CACHE) {
      const [clave, viejo] = this.cache.entries().next().value as [string, PreparedStatement];
      this.cache.delete(clave);
      try { viejo.finalize(); } catch { /* ya finalizada */ }
    }
    return st;
  }

  /** Libera las sentencias preparadas (antes de exportar o cerrar). */
  liberar(): void {
    for (const st of this.cache.values()) {
      try { st.finalize(); } catch { /* ya finalizada */ }
    }
    this.cache.clear();
  }
}

function aValorSqlite(v: ValorSQL | undefined): SqlValue {
  if (v === undefined) return null;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function normalizarFila(fila: Record<string, unknown>): Record<string, ValorSQL> {
  const salida: Record<string, ValorSQL> = {};
  for (const [k, v] of Object.entries(fila)) {
    salida[k] = typeof v === 'bigint' ? Number(v) : (v as ValorSQL);
  }
  return salida;
}
