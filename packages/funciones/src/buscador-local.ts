/**
 * Buscador local de reserva: léxico (FTS5/BM25) + denso (fuerza bruta sobre
 * la tabla `vectores`), fusionados por rangos recíprocos. Lo usan los
 * vigilantes cuando la plataforma no pasa su `Buscador`, y las pruebas.
 * No redacta respuestas.
 */

import {
  bytesAVector,
  enLista,
  fusionarRangos,
  type Embebedor,
  type Filtros,
  type Fragmento,
  type Resultado,
  type SQL,
  type ValorSQL,
} from '@scholaris/nucleo';
import { filaAFragmento, leerDocumentos } from './estanteria.js';
import type { Buscador, PeticionBusqueda, RespuestaBusqueda } from './puertos.js';
import { aBytes, consultaFTSAmplia } from './util.js';

/** Condición SQL sobre la tabla `documentos` (alias `d`) según los filtros. */
export function condicionDocumentos(f: Filtros | undefined): { donde: string; p: ValorSQL[] } {
  const c: string[] = [];
  const p: ValorSQL[] = [];
  if (!f) return { donde: '1', p };
  // Cada lista va en un solo parámetro JSON (D1 y los Durable Objects admiten 100 por sentencia).
  const en = (columna: string, valores: readonly string[]) => { const l = enLista(valores); c.push(`${columna} IN ${l.sql}`); p.push(l.param); };
  if (f.documentos?.length) en('d.id', f.documentos);
  if (f.tipos?.length) en('d.tipo', f.tipos);
  if (f.idiomas?.length) en('d.idioma', f.idiomas);
  if (f.anioDesde !== undefined) { c.push('d.anio >= ?'); p.push(f.anioDesde); }
  if (f.anioHasta !== undefined) { c.push('d.anio <= ?'); p.push(f.anioHasta); }
  if (f.bibliotecas?.length) {
    c.push('EXISTS (SELECT 1 FROM json_each(d.bibliotecas) b WHERE b.value IN (SELECT value FROM json_each(?)))');
    p.push(JSON.stringify(f.bibliotecas));
  }
  if (f.autores?.length) {
    c.push('EXISTS (SELECT 1 FROM json_each(?) a WHERE d.autores LIKE a.value)');
    p.push(JSON.stringify(f.autores.map((a) => `%${a}%`)));
  }
  return { donde: c.length ? c.join(' AND ') : '1', p };
}

/** Ids de los documentos que cumplen los filtros (null = todos). */
export async function documentosFiltrados(sql: SQL, f: Filtros | undefined): Promise<Set<string> | null> {
  const { donde, p } = condicionDocumentos(f);
  if (donde === '1') return null;
  const filas = await sql.ejecutar(`SELECT d.id FROM documentos d WHERE ${donde}`, ...p);
  return new Set(filas.map((x) => String(x.id)));
}

export function buscadorLocal(sql: SQL, embebedor?: Embebedor): Buscador {
  return {
    async buscar(pet: PeticionBusqueda): Promise<RespuestaBusqueda> {
      const k = pet.k ?? 10;
      const amplio = Math.max(k * 4, 50);
      const { donde, p } = condicionDocumentos(pet.filtros);
      const listas: Array<{ ids: string[]; peso?: number }> = [];
      const lexicos = new Set<string>();
      const densos = new Set<string>();

      const q = consultaFTSAmplia(pet.consulta);
      if (q) {
        const filas = await sql.ejecutar(
          `SELECT f.id FROM fragmentos_fts JOIN fragmentos f ON f.n = fragmentos_fts.rowid
           JOIN documentos d ON d.id = f.documento
           WHERE fragmentos_fts MATCH ? AND ${donde}
           ORDER BY bm25(fragmentos_fts) LIMIT ?`,
          q, ...p, amplio,
        );
        const ids = filas.map((x) => String(x.id));
        ids.forEach((i) => lexicos.add(i));
        listas.push({ ids });
      }

      let vectorConsulta: Float32Array | undefined;
      if (embebedor) {
        [vectorConsulta] = await embebedor.vectorizar([{ modalidad: 'texto', texto: pet.consulta }], 'consulta');
        if (vectorConsulta) {
          const permitidos = await documentosFiltrados(sql, pet.filtros);
          const mejores: Array<{ id: string; s: number }> = [];
          const qv = vectorConsulta;
          let ultimo = 0;
          // Por páginas, para no cargar toda la tabla de golpe.
          for (;;) {
            const filas = await sql.ejecutar(
              `SELECT rowid AS r, id, documento, valores FROM vectores WHERE espacio = ? AND objetivo = 'fragmento' AND rowid > ? ORDER BY rowid LIMIT 2000`,
              embebedor.espacio.id, ultimo,
            );
            if (!filas.length) break;
            for (const f of filas) {
              ultimo = Number(f.r);
              if (permitidos && !permitidos.has(String(f.documento))) continue;
              const b = aBytes(f.valores);
              if (!b) continue;
              const v = bytesAVector(b);
              let s = 0, nv = 0;
              const n = Math.min(v.length, qv.length);
              for (let i = 0; i < n; i++) { s += v[i]! * qv[i]!; nv += v[i]! * v[i]!; }
              s /= Math.sqrt(nv) || 1;
              if (mejores.length < amplio) mejores.push({ id: String(f.id), s });
              else if (s > mejores[mejores.length - 1]!.s) mejores[mejores.length - 1] = { id: String(f.id), s };
              else continue;
              mejores.sort((a, b2) => b2.s - a.s);
            }
          }
          const ids = mejores.filter((m) => m.s > 0).map((m) => m.id);
          ids.forEach((i) => densos.add(i));
          listas.push({ ids });
        }
      }

      const puntos = [...fusionarRangos(listas).entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
      if (!puntos.length) return { resultados: [], ...(vectorConsulta ? { vectorConsulta, espacio: embebedor!.espacio.id } : {}) };
      const ids = enLista(puntos.map(([id]) => id));
      const filas = await sql.ejecutar(
        `SELECT id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin FROM fragmentos WHERE id IN ${ids.sql}`,
        ids.param,
      );
      const porId = new Map(filas.map((f) => [String(f.id), filaAFragmento(f)]));
      const docs = await leerDocumentos(sql, [...new Set(filas.map((f) => String(f.documento)))]);
      const resultados: Resultado[] = [];
      for (const [id, s] of puntos) {
        const fr = porId.get(id);
        const d = fr && docs.get(fr.documento);
        if (!fr || !d) continue;
        const fragmento: Fragmento = {
          id: fr.id, documento: fr.documento, unidad: fr.unidad, orden: fr.orden, texto: fr.texto,
          contexto: fr.contexto, seccion: fr.seccion, ancla: fr.ancla, ...(fr.anclaFin ? { anclaFin: fr.anclaFin } : {}),
        };
        const vias: Resultado['vias'] = [];
        if (lexicos.has(id)) vias.push('lexica');
        if (densos.has(id)) vias.push('densa');
        resultados.push({ fragmento, documento: { id: d.id, tipo: d.tipo, metadatos: d.metadatos }, puntuacion: s, vias });
      }
      return { resultados, ...(vectorConsulta ? { vectorConsulta, espacio: embebedor!.espacio.id } : {}) };
    },
  };
}

/** El buscador de la plataforma si lo hay; si no, el local. */
export function buscadorDe(p: { sql: SQL; buscador?: Buscador; inteligencia?: { embebedor?: Embebedor } }): Buscador {
  return p.buscador ?? buscadorLocal(p.sql, p.inteligencia?.embebedor);
}
