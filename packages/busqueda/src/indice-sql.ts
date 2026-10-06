/**
 * Índice vectorial de fuerza bruta sobre la tabla `vectores` de la estantería.
 *
 * Sirve donde no hay Vectorize ni sqlite-vec: el banco de pruebas, la versión
 * local sin extensiones y los tests. Carga los vectores de un espacio en memoria
 * la primera vez y calcula el coseno contra todos (decenas de miles de vectores
 * caben de sobra en un isolate).
 */
import type { CoincidenciaIndice, EntradaIndice, EspacioVectorial, IndiceVectorial, SQL } from '@scholaris/nucleo';
import { bytesAVector, normalizarVector, vectorABytes } from '@scholaris/nucleo';

type Metadatos = Record<string, string | number | boolean>;

interface Cargado {
  ids: string[];
  matriz: Float32Array[];
  metadatos: Metadatos[];
}

/** Evalúa un filtro al estilo Vectorize: igualdad, $eq, $ne, $in, $nin, $lt, $lte, $gt, $gte. */
export function cumpleFiltro(m: Metadatos, filtro: Record<string, unknown> | undefined): boolean {
  if (!filtro) return true;
  for (const [campo, cond] of Object.entries(filtro)) {
    const v = m[campo];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, x] of Object.entries(cond as Record<string, unknown>)) {
        switch (op) {
          case '$eq': if (v !== x) return false; break;
          case '$ne': if (v === x) return false; break;
          case '$in': if (!(x as unknown[]).includes(v)) return false; break;
          case '$nin': if ((x as unknown[]).includes(v)) return false; break;
          case '$lt': if (!(typeof v === 'number' && v < (x as number))) return false; break;
          case '$lte': if (!(typeof v === 'number' && v <= (x as number))) return false; break;
          case '$gt': if (!(typeof v === 'number' && v > (x as number))) return false; break;
          case '$gte': if (!(typeof v === 'number' && v >= (x as number))) return false; break;
          default: return false;
        }
      }
    } else if (v !== cond) return false;
  }
  return true;
}

export class IndiceVectorialSQL implements IndiceVectorial {
  private cargado?: Promise<Cargado>;

  constructor(private sql: SQL, readonly espacio: EspacioVectorial) {}

  private cargar(): Promise<Cargado> {
    this.cargado ??= (async () => {
      const filas = await this.sql.ejecutar<{ objetivo: string; id: string; documento: string; valores: Uint8Array | ArrayBuffer; tipo: string | null; anio: number | null; idioma: string | null }>(
        `SELECT v.objetivo, v.id, v.documento, v.valores, d.tipo, d.anio, d.idioma
           FROM vectores v LEFT JOIN documentos d ON d.id = v.documento
          WHERE v.espacio = ?`,
        this.espacio.id,
      );
      const c: Cargado = { ids: [], matriz: [], metadatos: [] };
      for (const f of filas) {
        c.ids.push(f.id);
        const v = bytesAVector(f.valores);
        c.matriz.push(this.espacio.normalizado ? v : normalizarVector(v));
        const m: Metadatos = { objetivo: f.objetivo, documento: f.documento };
        if (f.tipo) m.tipo = f.tipo;
        if (f.anio != null) m.anio = Number(f.anio);
        if (f.idioma) m.idioma = f.idioma;
        c.metadatos.push(m);
      }
      return c;
    })();
    return this.cargado;
  }

  /** Olvida lo cargado (tras insertar desde fuera). */
  invalidar(): void { this.cargado = undefined; }

  async insertar(_ns: string, entradas: EntradaIndice[]): Promise<void> {
    for (const e of entradas) {
      const v = e.valores instanceof Float32Array ? e.valores : new Float32Array(e.valores);
      await this.sql.ejecutar(
        `INSERT OR REPLACE INTO vectores (objetivo, id, espacio, documento, valores) VALUES (?, ?, ?, ?, ?)`,
        String(e.metadatos.objetivo ?? 'fragmento'), e.id, this.espacio.id, String(e.metadatos.documento ?? ''), vectorABytes(v),
      );
    }
    this.invalidar();
  }

  async consultar(_ns: string, vector: Float32Array | number[], opciones: { k: number; filtro?: Record<string, unknown>; conMetadatos?: boolean }): Promise<CoincidenciaIndice[]> {
    const c = await this.cargar();
    const q = normalizarVector(vector instanceof Float32Array ? vector : new Float32Array(vector));
    const puntos: Array<{ i: number; p: number }> = [];
    for (let i = 0; i < c.ids.length; i++) {
      if (!cumpleFiltro(c.metadatos[i] as Metadatos, opciones.filtro)) continue;
      const v = c.matriz[i] as Float32Array;
      let p = 0;
      const n = Math.min(v.length, q.length);
      for (let j = 0; j < n; j++) p += (v[j] as number) * (q[j] as number);
      puntos.push({ i, p });
    }
    puntos.sort((a, b) => b.p - a.p);
    return puntos.slice(0, opciones.k).map(({ i, p }) => ({
      id: c.ids[i] as string,
      puntuacion: p,
      ...(opciones.conMetadatos ? { metadatos: c.metadatos[i] } : {}),
    }));
  }

  async borrar(_ns: string, ids: string[]): Promise<void> {
    for (const id of ids) await this.sql.ejecutar(`DELETE FROM vectores WHERE id = ? AND espacio = ?`, id, this.espacio.id);
    this.invalidar();
  }
}
