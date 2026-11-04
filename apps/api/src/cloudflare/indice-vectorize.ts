/**
 * Índice vectorial sobre Vectorize: un índice (`scholaris-gemini-1536`) y un
 * espacio de nombres por usuario. Los ids de Vectorize son únicos en todo el
 * índice (no por espacio de nombres), así que se guardan como
 * «<espacio>.<id>» y se devuelven sin el prefijo.
 *
 * Metadatos filtrables (índices creados por el bootstrap): documento, tipo,
 * anio, idioma, objetivo.
 */
import type { CoincidenciaIndice, EntradaIndice, EspacioVectorial, IndiceVectorial } from '@scholaris/nucleo';

const LOTE = 1000;

export interface CupoVectorial {
  /** Espera hasta que haya cupo para escribir `n` vectores (reparte el cupo de la cuenta). */
  turno(n: number): Promise<void>;
  /** Vectorize ha dicho «demasiadas peticiones»: frenar a todos un rato. */
  frenar(): Promise<void>;
}

const esLimite = (e: unknown) => /40041|429|Too Many Requests|rate.?limit/i.test(String((e as Error)?.message ?? e));
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Escribe con reintentos y espera exponencial ante los límites de Vectorize. */
async function conReintentos<T>(fn: () => Promise<T>, cupo?: CupoVectorial, intentos = 9): Promise<T> {
  let espera = 1000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!esLimite(e) || i >= intentos - 1) throw e;
      await cupo?.frenar().catch(() => undefined);
      await dormir(espera + Math.random() * espera);
      espera = Math.min(espera * 2, 60_000);
    }
  }
}
const CAMPOS = new Set(['documento', 'tipo', 'anio', 'idioma', 'objetivo', 't0']);

function filtroVectorize(f: Record<string, unknown> | undefined): VectorizeVectorMetadataFilter | undefined {
  if (!f) return undefined;
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (!CAMPOS.has(k) || v === undefined) continue;
    if (Array.isArray(v)) salida[k] = { $in: v };
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      // Vectorize limita $in a listas razonables; las muy largas se filtran después.
      if (Array.isArray(o.$in) && o.$in.length > 100) continue;
      salida[k] = o;
    } else salida[k] = v;
  }
  return Object.keys(salida).length ? (salida as VectorizeVectorMetadataFilter) : undefined;
}

/**
 * Vectorize admite ids de 64 bytes como mucho, y el nuestro lleva delante el espacio de nombres
 * del usuario (unos 16). Los de las fichas repiten el del documento («doc:fi:doc:sg82:lente», 53
 * caracteres) y no cabían: Vectorize rechazaba todos los vectores de las fichas. La segunda vez
 * que aparece el documento (el primer tramo del id) se escribe «~», y se deshace al leer.
 */
export const MAX_ID_VECTORIZE = 64;
export function idParaVectorize(ns: string, id: string): string {
  const doc = id.split(':')[0] ?? '';
  const corto = doc.length >= 8 && !id.includes('~') ? doc + id.slice(doc.length).split(doc).join('~') : id;
  return `${ns}.${corto}`;
}
export function idDeVectorize(ns: string, idVectorize: string): string {
  const prefijo = `${ns}.`;
  const id = idVectorize.startsWith(prefijo) ? idVectorize.slice(prefijo.length) : idVectorize;
  if (!id.includes('~')) return id;
  const doc = id.split(':')[0] ?? '';
  return doc + id.slice(doc.length).split('~').join(doc);
}
const bytes = (t: string) => new TextEncoder().encode(t).length;

export function crearIndiceVectorize(indice: VectorizeIndex, espacio: EspacioVectorial, cupo?: CupoVectorial): IndiceVectorial {
  const recortar = (v: Float32Array | number[]) => {
    const a = Array.from(v.length > espacio.dims ? v.slice(0, espacio.dims) : v);
    return a;
  };
  return {
    espacio,
    async insertar(ns, entradas: EntradaIndice[]) {
      const largas = entradas.filter((e) => bytes(idParaVectorize(ns, e.id)) > MAX_ID_VECTORIZE);
      if (largas.length) {
        // No se tragan: que se vea en el registro y que el llamador lo cuente como pendiente.
        console.error(JSON.stringify({ que: 'vectorize_id_largo', n: largas.length, ejemplo: largas[0]!.id }));
        throw new Error(`${largas.length} ids no caben en Vectorize (más de ${MAX_ID_VECTORIZE} bytes), p. ej. «${largas[0]!.id}»`);
      }
      for (let i = 0; i < entradas.length; i += LOTE) {
        const lote = entradas.slice(i, i + LOTE);
        await cupo?.turno(lote.length);
        await conReintentos(() => indice.upsert(lote.map((e) => ({
          id: idParaVectorize(ns, e.id),
          values: recortar(e.valores),
          namespace: ns,
          metadata: Object.fromEntries(Object.entries(e.metadatos).filter(([k]) => CAMPOS.has(k))) as Record<string, VectorizeVectorMetadata>,
        }))), cupo);
      }
    },
    async consultar(ns, vector, op): Promise<CoincidenciaIndice[]> {
      const filtro = filtroVectorize(op.filtro);
      const pedir = (topK: number) => indice.query(recortar(vector), { topK, namespace: ns, returnMetadata: op.conMetadatos ? 'indexed' : 'none', ...(filtro ? { filter: filtro } : {}) });
      let r: VectorizeMatches;
      try {
        r = await pedir(Math.min(100, op.k));
      } catch {
        r = await pedir(Math.min(50, op.k));
      }
      return r.matches.map((m) => ({
        id: idDeVectorize(ns, m.id),
        puntuacion: m.score,
        ...(m.metadata ? { metadatos: m.metadata as Record<string, string | number | boolean> } : {}),
      }));
    },
    async borrar(ns, ids) {
      for (let i = 0; i < ids.length; i += LOTE) {
        const lote = ids.slice(i, i + LOTE).map((id) => idParaVectorize(ns, id));
        await conReintentos(() => indice.deleteByIds(lote), cupo);
      }
    },
  };
}

/** Espacio de nombres corto y estable para un usuario (≤ 64 bytes con el id). */
export function espacioNombresDe(usuario: string): string {
  // FNV-1a de 64 bits en dos mitades de 32: suficiente para separar usuarios.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < usuario.length; i++) {
    const c = usuario.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `u${h1.toString(36)}${h2.toString(36)}`;
}
