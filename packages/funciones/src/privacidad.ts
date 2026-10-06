/**
 * Privacidad: exportar todo lo del usuario (estructura lista para ZIP) y
 * borrar el historial o todo. La grabación vive en `ajustes.ts`.
 */

import { strToU8, zipSync } from 'fflate';
import type { SQL } from '@scholaris/nucleo';
import type { ResultadoPurga } from '@scholaris/contrato';
import { TABLAS_FUNCIONES } from './esquema.js';
import { aBytes, ahora, num } from './util.js';

/** Tablas de la estantería (SPDF 4.0), en orden de borrado seguro. */
export const TABLAS_ESTANTERIA = ['vectores', 'figuras', 'fragmentos', 'secciones', 'unidades', 'procedencia', 'blobs', 'documentos', 'espacios'] as const;

/** Columnas binarias que no se exportan en JSON (vectores, centroides, blobs). */
const BINARIAS = new Set(['vector', 'centroide', 'valores', 'datos_binarios']);

function limpiarFila(f: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (BINARIAS.has(k) || aBytes(v)) continue;
    if (typeof v === 'bigint') { o[k] = Number(v); continue; }
    o[k] = v;
  }
  return o;
}

async function* filas(sql: SQL, tabla: string, orden = 'rowid'): AsyncGenerator<Record<string, unknown>> {
  let desde = -Infinity;
  for (;;) {
    const lote = await sql.ejecutar(`SELECT rowid AS _r, * FROM ${tabla} WHERE rowid > ? ORDER BY ${orden} LIMIT 1000`, desde === -Infinity ? -1 : desde);
    if (!lote.length) return;
    for (const f of lote) {
      desde = num(f._r);
      const { _r, ...resto } = f as Record<string, unknown>;
      yield limpiarFila(resto);
    }
  }
}

async function ndjson(sql: SQL, tabla: string): Promise<{ texto: string; n: number }> {
  const partes: string[] = [];
  for await (const f of filas(sql, tabla)) partes.push(JSON.stringify(f));
  return { texto: partes.join('\n') + (partes.length ? '\n' : ''), n: partes.length };
}

export interface OpcionesExportacion {
  /** Incluir la biblioteca: metadatos de documentos, unidades, fragmentos, figuras (sin originales ni vectores). */
  biblioteca?: boolean;
}

/**
 * Todo lo del usuario como `{ ruta: bytes }`, listo para `zipExportacion` o
 * para que la plataforma lo empaquete a su manera. Los originales (PDF, audio)
 * están en el almacén y no van aquí.
 */
export async function exportarDatos(sql: SQL, o: OpcionesExportacion = {}): Promise<Record<string, Uint8Array>> {
  const archivos: Record<string, Uint8Array> = {};
  const recuento: Record<string, number> = {};
  for (const t of TABLAS_FUNCIONES) {
    const { texto, n } = await ndjson(sql, t);
    archivos[`funciones/${t}.ndjson`] = strToU8(texto);
    recuento[t] = n;
  }
  if (o.biblioteca !== false) {
    for (const t of ['documentos', 'unidades', 'secciones', 'fragmentos', 'figuras', 'espacios', 'procedencia']) {
      const { texto, n } = await ndjson(sql, t);
      archivos[`biblioteca/${t}.ndjson`] = strToU8(texto);
      recuento[t] = n;
    }
  }
  const leeme = [
    'Exportación de Scholaris',
    '',
    `Fecha: ${ahora()}`,
    '',
    'Cada fichero .ndjson tiene una fila por línea, en JSON. La carpeta «funciones»',
    'contiene el historial de búsquedas, los cuadernos, los vigilantes y sus alertas,',
    'los conceptos, el mapa, el grafo de citas y las perspectivas. La carpeta',
    '«biblioteca» contiene los metadatos y el texto leído de cada documento.',
    '',
    'No se incluyen los vectores (se pueden recalcular) ni los ficheros originales,',
    'que se descargan desde la biblioteca o como SPDF.',
    '',
    'Filas por tabla:',
    ...Object.entries(recuento).map(([t, n]) => `  ${t}: ${n}`),
    '',
  ].join('\n');
  archivos['LEEME.txt'] = strToU8(leeme);
  archivos['manifiesto.json'] = strToU8(JSON.stringify({ generado: ahora(), formato: 'scholaris-exportacion@1', filas: recuento }, null, 2));
  return archivos;
}

export function zipExportacion(archivos: Record<string, Uint8Array>): Uint8Array {
  return zipSync(archivos, { level: 6 });
}

async function contarYBorrar(sql: SQL, tablas: readonly string[]): Promise<Record<string, number>> {
  const borrados: Record<string, number> = {};
  await sql.transaccion(async (tx) => {
    for (const t of tablas) {
      borrados[t] = num((await tx.ejecutar(`SELECT count(*) AS n FROM ${t}`))[0]?.n);
      await tx.ejecutar(`DELETE FROM ${t}`);
    }
  });
  return borrados;
}

/** Borra el historial de búsquedas y el registro de lecturas. No toca la biblioteca ni los cuadernos. */
export async function purgarHistorial(sql: SQL): Promise<ResultadoPurga> {
  return { borrados: await contarYBorrar(sql, ['historial_eventos', 'historial', 'insights_aperturas', 'insights_descartes']) };
}

/** Borra todo lo de las funciones (menos los ajustes de privacidad). */
export async function purgarFunciones(sql: SQL): Promise<ResultadoPurga> {
  return { borrados: await contarYBorrar(sql, TABLAS_FUNCIONES.filter((t) => t !== 'funciones_ajustes')) };
}

/**
 * Borra todo: funciones y estantería. Los originales del almacén y los
 * vectores de Vectorize son cosa de la plataforma.
 */
export async function purgarTodo(sql: SQL): Promise<ResultadoPurga> {
  const f = await purgarFunciones(sql);
  const e = await contarYBorrar(sql, TABLAS_ESTANTERIA);
  return { borrados: { ...f.borrados, ...e } };
}
