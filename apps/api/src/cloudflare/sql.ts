/**
 * El puerto SQL sobre la SQLite de un Durable Object (`ctx.storage.sql`) y
 * sobre D1.
 *
 * Transacciones en el Durable Object: `ctx.storage.sql` no admite BEGIN ni
 * SAVEPOINT. Las escrituras que se hacen sin esperar a E/S externa se
 * confirman juntas (coalescencia de escrituras del DO), y las promesas de este
 * puerto se resuelven sin E/S, así que `transaccion` basta con ejecutar la
 * función. Si hace falta atomicidad estricta con reversión, usar
 * `transaccionSincrona`, que envuelve `ctx.storage.transactionSync`.
 */
import type { SQL, ValorSQL } from '@scholaris/nucleo';

function aParametro(v: ValorSQL | boolean | undefined): string | number | null | ArrayBuffer {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  return v as string | number | ArrayBuffer;
}

function deFila(f: Record<string, unknown>): Record<string, ValorSQL> {
  const s: Record<string, ValorSQL> = {};
  for (const [k, v] of Object.entries(f)) s[k] = v instanceof ArrayBuffer ? new Uint8Array(v) : typeof v === 'bigint' ? Number(v) : (v as ValorSQL);
  return s;
}

export class SqlDO implements SQL {
  constructor(private readonly almacen: DurableObjectStorage) {}

  async ejecutar<T = Record<string, ValorSQL>>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
    return this.ejecutarSync<T>(consulta, parametros);
  }

  ejecutarSync<T = Record<string, ValorSQL>>(consulta: string, parametros: readonly ValorSQL[] = []): T[] {
    const cursor = this.almacen.sql.exec(consulta, ...parametros.map(aParametro));
    return cursor.toArray().map((f) => deFila(f as Record<string, unknown>)) as T[];
  }

  async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    return fn(this);
  }

  transaccionSincrona<T>(fn: () => T): T {
    return this.almacen.transactionSync(fn);
  }

  /** Lote de sentencias atómico (lo usa el Workflow por RPC). */
  lote(sentencias: Array<{ consulta: string; parametros: ValorSQL[] }>): number {
    return this.almacen.transactionSync(() => {
      for (const s of sentencias) this.almacen.sql.exec(s.consulta, ...s.parametros.map(aParametro));
      return sentencias.length;
    });
  }
}

export class SqlD1 implements SQL {
  constructor(private readonly db: D1Database) {}

  async ejecutar<T = Record<string, ValorSQL>>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
    const r = await this.db.prepare(consulta).bind(...parametros.map(aParametro)).all();
    return (r.results ?? []).map((f) => deFila(f as Record<string, unknown>)) as T[];
  }

  /** D1 no tiene transacciones interactivas: se ejecuta tal cual (las cuentas no las necesitan). */
  async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/**
 * SQL remoto: el Workflow habla con la estantería del usuario por RPC. Las
 * lecturas van una a una; dentro de `transaccion` las escrituras se acumulan
 * y se mandan en un único lote atómico al final.
 */
export interface EstanteriaRemota {
  sql(consulta: string, parametros: ValorSQL[]): Promise<Record<string, ValorSQL>[]>;
  lote(sentencias: Array<{ consulta: string; parametros: ValorSQL[] }>): Promise<number>;
}

const ES_LECTURA = /^\s*(SELECT|WITH|PRAGMA)\b/i;

/**
 * Las escrituras (sin RETURNING) se acumulan y viajan en lotes atómicos de
 * hasta 300 sentencias; cualquier lectura vacía antes lo pendiente, así que se
 * leen siempre las propias escrituras. Al terminar hay que llamar a
 * `vaciarPendientes()`.
 */
export class SqlRemoto implements SQL {
  private pendientes: Array<{ consulta: string; parametros: ValorSQL[] }> = [];
  private bytes = 0;

  constructor(private readonly remota: EstanteriaRemota) {}

  async ejecutar<T = Record<string, ValorSQL>>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
    const ps = parametros.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v));
    if (!ES_LECTURA.test(consulta) && !/\bRETURNING\b/i.test(consulta)) {
      this.pendientes.push({ consulta, parametros: ps });
      for (const v of ps) this.bytes += v instanceof Uint8Array ? v.byteLength : typeof v === 'string' ? v.length : 8;
      if (this.pendientes.length >= 300 || this.bytes > 4_000_000) await this.vaciarPendientes();
      return [];
    }
    await this.vaciarPendientes();
    return (await this.remota.sql(consulta, ps)) as T[];
  }

  async vaciarPendientes(): Promise<void> {
    while (this.pendientes.length) {
      const lote = this.pendientes.splice(0, 300);
      this.bytes = 0;
      await this.remota.lote(lote);
    }
  }

  async transaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    const r = await fn(this);
    await this.vaciarPendientes();
    return r;
  }
}
