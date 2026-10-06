/**
 * Índice vectorial local con sqlite-vec (tabla virtual vec0 con columnas de
 * metadatos) dentro de la propia estantería del usuario. El espacio de nombres
 * sobra: cada usuario tiene su fichero. Si la extensión no carga, se usa la
 * búsqueda por fuerza bruta de @scholaris/busqueda sobre la tabla `vectores`.
 */
import type { CoincidenciaIndice, EntradaIndice, EspacioVectorial, IndiceVectorial, SQL } from '@scholaris/nucleo';
import { normalizarVector } from '@scholaris/nucleo';
import { IndiceVectorialSQL } from '@scholaris/busqueda';
import type { BaseSqlite } from './sql.js';

const META = ['objetivo', 'documento', 'tipo', 'anio', 'idioma'] as const;

export function cargarSqliteVec(db: BaseSqlite, cargar: (db: BaseSqlite) => void): boolean {
  try {
    cargar(db);
    db.prepare('SELECT vec_version() AS v').all();
    return true;
  } catch (e) {
    console.warn(`sqlite-vec no disponible (${(e as Error).message}); búsqueda densa por fuerza bruta.`);
    return false;
  }
}

function cumple(m: Record<string, unknown>, f: Record<string, unknown> | undefined): boolean {
  if (!f) return true;
  for (const [k, cond] of Object.entries(f)) {
    const v = m[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if (Array.isArray(c.$in) && !c.$in.includes(v)) return false;
      if (Array.isArray(c.$nin) && c.$nin.includes(v)) return false;
      if ('$eq' in c && c.$eq !== v) return false;
      if ('$ne' in c && c.$ne === v) return false;
      if ('$gte' in c && !(Number(v) >= Number(c.$gte))) return false;
      if ('$lte' in c && !(Number(v) <= Number(c.$lte))) return false;
      if ('$gt' in c && !(Number(v) > Number(c.$gt))) return false;
      if ('$lt' in c && !(Number(v) < Number(c.$lt))) return false;
    } else if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false;
    } else if (cond !== undefined && v !== cond) return false;
  }
  return true;
}

export class IndiceSqliteVec implements IndiceVectorial {
  private readonly tabla: string;

  constructor(private readonly db: BaseSqlite, readonly espacio: EspacioVectorial) {
    this.tabla = `vec_${espacio.dims}`;
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tabla} USING vec0(
      id TEXT PRIMARY KEY, embedding float[${espacio.dims}] distance_metric=cosine,
      objetivo TEXT, documento TEXT, tipo TEXT, anio INTEGER, idioma TEXT)`);
  }

  private bytes(v: Float32Array | number[]): Uint8Array {
    const f = v instanceof Float32Array ? v : new Float32Array(v);
    const n = normalizarVector(f.length > this.espacio.dims ? f.subarray(0, this.espacio.dims) : f);
    return new Uint8Array(n.buffer, n.byteOffset, n.byteLength);
  }

  async insertar(_ns: string, entradas: EntradaIndice[]): Promise<void> {
    const borrar = this.db.prepare(`DELETE FROM ${this.tabla} WHERE id = ?`);
    const poner = this.db.prepare(`INSERT INTO ${this.tabla} (id, embedding, objetivo, documento, tipo, anio, idioma) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    this.db.exec('SAVEPOINT vec');
    try {
      for (const e of entradas) {
        borrar.run(e.id);
        const m = e.metadatos;
        poner.run(e.id, this.bytes(e.valores), String(m.objetivo ?? ''), String(m.documento ?? ''), m.tipo == null ? null : String(m.tipo),
          typeof m.anio === 'number' ? BigInt(Math.trunc(m.anio)) : null, m.idioma == null ? null : String(m.idioma));
      }
      this.db.exec('RELEASE vec');
    } catch (e) {
      this.db.exec('ROLLBACK TO vec');
      this.db.exec('RELEASE vec');
      throw e;
    }
  }

  async consultar(_ns: string, vector: Float32Array | number[], op: { k: number; filtro?: Record<string, unknown>; conMetadatos?: boolean }): Promise<CoincidenciaIndice[]> {
    // El objetivo simple va dentro de la KNN (filtro de metadatos de vec0); el resto, después.
    const obj = typeof op.filtro?.objetivo === 'string' ? op.filtro.objetivo : null;
    const resto = op.filtro ? Object.fromEntries(Object.entries(op.filtro).filter(([k]) => k !== 'objetivo' || !obj)) : undefined;
    const k = Math.min(4096, resto && Object.keys(resto).length ? op.k * 8 : op.k);
    const filas = this.db.prepare(
      `SELECT id, distance, ${META.join(', ')} FROM ${this.tabla} WHERE embedding MATCH ? AND k = ?${obj ? ' AND objetivo = ?' : ''} ORDER BY distance`,
    ).all(...[this.bytes(vector), k, ...(obj ? [obj] : [])]) as Array<Record<string, unknown> & { id: string; distance: number }>;
    return filas
      .filter((f) => cumple(f, resto))
      .slice(0, op.k)
      .map((f) => ({
        id: f.id,
        puntuacion: 1 - f.distance,
        ...(op.conMetadatos ? { metadatos: Object.fromEntries(META.filter((m) => f[m] != null).map((m) => [m, f[m] as string | number])) } : {}),
      }));
  }

  async borrar(_ns: string, ids: string[]): Promise<void> {
    const st = this.db.prepare(`DELETE FROM ${this.tabla} WHERE id = ?`);
    for (const id of ids) st.run(id);
  }
}

/** Índice para una estantería: sqlite-vec si cargó, si no fuerza bruta. */
export function crearIndiceLocal(db: BaseSqlite, sql: SQL, espacio: EspacioVectorial, conVec: boolean): IndiceVectorial {
  return conVec ? new IndiceSqliteVec(db, espacio) : new IndiceVectorialSQL(sql, espacio);
}
