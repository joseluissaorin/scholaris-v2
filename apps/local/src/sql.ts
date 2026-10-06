/**
 * El puerto SQL sobre una base SQLite síncrona: better-sqlite3 (Node) o
 * bun:sqlite (escritorio). Ambas exponen `prepare().all()/run()` y `exec()`.
 * Las transacciones de primer nivel se encolan (SAVEPOINT anidables), para
 * que dos peticiones concurrentes no mezclen sus escrituras.
 */
import type { SQL, ValorSQL } from '@scholaris/nucleo';

export interface SentenciaSqlite {
  all(...p: unknown[]): unknown[];
  run(...p: unknown[]): unknown;
  /** better-sqlite3: false si la sentencia no devuelve filas. */
  reader?: boolean;
}

export interface BaseSqlite {
  prepare(sql: string): SentenciaSqlite;
  exec(sql: string): unknown;
  close(): unknown;
}

const LECTURA = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b|\bRETURNING\b/i;

function aParametro(v: ValorSQL | boolean | undefined): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
}

function deFila(f: Record<string, unknown>): Record<string, ValorSQL> {
  const s: Record<string, ValorSQL> = {};
  for (const [k, v] of Object.entries(f)) {
    s[k] = typeof v === 'bigint' ? Number(v) : v instanceof Uint8Array && !(v.constructor === Uint8Array) ? new Uint8Array(v) : (v as ValorSQL);
  }
  return s;
}

export class SqlLocal implements SQL {
  private cache = new Map<string, SentenciaSqlite>();
  private profundidad = 0;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(readonly db: BaseSqlite) {}

  private preparar(consulta: string): SentenciaSqlite {
    let st = this.cache.get(consulta);
    if (!st) {
      st = this.db.prepare(consulta);
      this.cache.set(consulta, st);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value as string);
    }
    return st;
  }

  ejecutarSync<T = Record<string, ValorSQL>>(consulta: string, parametros: readonly ValorSQL[] = []): T[] {
    const st = this.preparar(consulta);
    const ps = parametros.map(aParametro);
    const lee = st.reader ?? LECTURA.test(consulta);
    if (lee) return (st.all(...ps) as Record<string, unknown>[]).map(deFila) as T[];
    st.run(...ps);
    return [];
  }

  async ejecutar<T = Record<string, ValorSQL>>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
    return this.ejecutarSync<T>(consulta, parametros);
  }

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

  cerrar(): void {
    this.cache.clear();
    this.db.close();
  }
}
