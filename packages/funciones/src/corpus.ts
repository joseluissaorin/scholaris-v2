/**
 * Corpus: cifras de la biblioteca. Antes había que abrir cada SPDF; ahora es
 * un puñado de consultas agregadas sobre la estantería, así que la
 * instantánea se recalcula al vuelo cuando caduca (o tras una ingesta).
 */

import type { SQL } from '@scholaris/nucleo';
import type { InstantaneaCorpus, KpisCorpus } from '@scholaris/contrato';
import { ahora, deJSON, num, texto, una } from './util.js';

export interface InstantaneaCompleta extends InstantaneaCorpus {
  hablantes: number;
  porEstado: Record<string, number>;
  vectoresPorEspacio: Record<string, number>;
  referencias: number;
}

const UNA_HORA = 3_600_000;

async function agrupar(sql: SQL, consulta: string): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const f of await sql.ejecutar(consulta)) r[texto(f.k) ?? 'desconocido'] = num(f.n);
  return r;
}

export async function construirInstantanea(sql: SQL): Promise<InstantaneaCompleta> {
  const t0 = Date.now();
  const d = await una(sql, 'SELECT count(*) AS n, coalesce(sum(bytes), 0) AS bytes, coalesce(sum(duracion), 0) AS segundos FROM documentos');
  const cuenta = async (tabla: string) => num((await una(sql, `SELECT count(*) AS n FROM ${tabla}`))?.n);
  const hablantes = num((await una(sql,
    `SELECT count(DISTINCT documento || '|' || json_extract(ancla, '$.hablante')) AS n FROM unidades
     WHERE json_extract(ancla, '$.tipo') = 'tiempo' AND json_extract(ancla, '$.hablante') IS NOT NULL`))?.n);
  const porAnio = await agrupar(sql, 'SELECT anio AS k, count(*) AS n FROM documentos WHERE anio IS NOT NULL GROUP BY anio ORDER BY anio');
  const porDecada: Record<string, number> = {};
  for (const [a, n] of Object.entries(porAnio)) {
    const dec = `${Math.floor(Number(a) / 10) * 10}s`;
    porDecada[dec] = (porDecada[dec] ?? 0) + n;
  }
  const inst: InstantaneaCompleta = {
    documentos: num(d?.n),
    unidades: await cuenta('unidades'),
    fragmentos: await cuenta('fragmentos'),
    figuras: await cuenta('figuras'),
    segundosDeMedio: Math.round(num(d?.segundos)),
    bytes: num(d?.bytes),
    porIdioma: await agrupar(sql, "SELECT coalesce(nullif(lower(idioma), ''), 'desconocido') AS k, count(*) AS n FROM documentos GROUP BY k"),
    porTipo: await agrupar(sql, 'SELECT tipo AS k, count(*) AS n FROM documentos GROUP BY tipo'),
    porAnio,
    porDecada,
    hablantes,
    porEstado: await agrupar(sql, 'SELECT estado AS k, count(*) AS n FROM documentos GROUP BY estado'),
    vectoresPorEspacio: await agrupar(sql, 'SELECT espacio AS k, count(*) AS n FROM vectores GROUP BY espacio'),
    referencias: await cuenta('grafo_referencias'),
    refrescado: ahora(),
    ms: 0,
  };
  inst.ms = Date.now() - t0;
  await sql.ejecutar(
    `INSERT INTO corpus_instantanea (id, datos, construida, ms) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET datos = excluded.datos, construida = excluded.construida, ms = excluded.ms`,
    JSON.stringify(inst), inst.refrescado!, inst.ms,
  );
  return inst;
}

/** La instantánea guardada si no ha caducado; si no, una nueva. */
export async function obtenerInstantanea(sql: SQL, maxEdadMs = UNA_HORA): Promise<InstantaneaCompleta> {
  const f = await una(sql, 'SELECT datos, construida FROM corpus_instantanea WHERE id = 1');
  if (f && Date.now() - Date.parse(String(f.construida)) <= maxEdadMs) {
    const datos = deJSON<InstantaneaCompleta | null>(f.datos, null);
    if (datos) return datos;
  }
  return construirInstantanea(sql);
}

export async function kpisCorpus(sql: SQL): Promise<KpisCorpus> {
  const i = await obtenerInstantanea(sql);
  return {
    documentos: i.documentos, unidades: i.unidades, fragmentos: i.fragmentos, figuras: i.figuras,
    segundosDeMedio: i.segundosDeMedio, bytes: i.bytes, ...(i.refrescado ? { refrescado: i.refrescado } : {}),
  };
}

/** Tras una ingesta o un borrado: la próxima lectura recalcula. */
export async function invalidarInstantanea(sql: SQL): Promise<void> {
  await sql.ejecutar('DELETE FROM corpus_instantanea WHERE id = 1');
}
