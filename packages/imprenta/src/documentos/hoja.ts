/** XLSX, XLS, ODS, CSV, TSV → hojas en tablas Markdown troceadas por filas. */

import * as XLSX from 'xlsx';
import type { Contexto } from '../contexto.js';
import type { Deteccion } from '../detectar.js';
import type { ArchivoEntrada, Hoja, OrigenArchivo, PaqueteConversion, TramoHoja } from '../tipos.js';
import { VERSION_PAQUETE } from '../tipos.js';
import { metadatosOoxml } from './convertir-documento.js';
import { decodificarTexto } from './texto.js';

const celda = (v: unknown) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

export function hojaAMarkdown(nombre: string, filas: unknown[][], primeraFila: number, filasPorTramo: number): Hoja {
  // Quita filas y columnas vacías del final.
  const datos = filas.map((f) => f.map(celda));
  while (datos.length && datos[datos.length - 1]?.every((c) => !c)) datos.pop();
  let columnas = 0;
  for (const f of datos) for (let i = f.length - 1; i >= 0; i--) if (f[i]) { columnas = Math.max(columnas, i + 1); break; }
  const iCab = datos.findIndex((f) => f.some(Boolean));
  if (iCab < 0) return { nombre, filas: 0, columnas: 0, cabecera: [], tramos: [] };
  const cabecera = Array.from({ length: columnas }, (_, i) => datos[iCab]?.[i] || `Col${i + 1}`);
  const fila = (f: string[]) => '| ' + Array.from({ length: columnas }, (_, i) => f[i] ?? '').join(' | ') + ' |';
  const tramos: TramoHoja[] = [];
  const cuerpo = datos.slice(iCab + 1);
  for (let i = 0; i < cuerpo.length; i += filasPorTramo) {
    const trozo = cuerpo.slice(i, i + filasPorTramo);
    if (!trozo.some((f) => f.some(Boolean))) continue;
    const desde = primeraFila + iCab + 1 + i;
    tramos.push({
      filaDesde: desde,
      filaHasta: desde + trozo.length - 1,
      markdown: [fila(cabecera), '|' + ' --- |'.repeat(columnas), ...trozo.map(fila)].join('\n'),
    });
  }
  return { nombre, filas: datos.length, columnas, cabecera, tramos };
}

export async function convertirHoja(ctx: Contexto, archivo: ArchivoEntrada, d: Deteccion, origen: OrigenArchivo): Promise<PaqueteConversion> {
  await ctx.emitir({ tipo: 'inicio', entrada: 'hoja', origen, unidades: null, metadatos: {} });
  const t = performance.now();
  const libro = d.formato === 'csv' || d.formato === 'tsv'
    ? XLSX.read(decodificarTexto(archivo.bytes), { type: 'string', raw: false, ...(d.formato === 'tsv' ? { FS: '\t' } : {}) })
    : XLSX.read(archivo.bytes, { type: 'array', cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false });
  const hojas: Hoja[] = [];
  for (const nombre of libro.SheetNames) {
    const h = libro.Sheets[nombre];
    if (!h) continue;
    const rango = h['!ref'] ? XLSX.utils.decode_range(h['!ref']) : null;
    const filas = XLSX.utils.sheet_to_json<unknown[]>(h, { header: 1, raw: false, defval: '', blankrows: true });
    hojas.push(hojaAMarkdown(nombre, filas, (rango?.s.r ?? 0) + 1, ctx.op.filasPorTramo));
  }
  ctx.tiempos.texto = Math.round(performance.now() - t);
  const metadatos = d.formato === 'xlsx' ? metadatosOoxml(archivo.bytes) : {};
  return {
    version: VERSION_PAQUETE, tipo: 'hoja', origen, metadatos, unidades: hojas.length,
    contenido: { clase: 'hoja', hojas }, partes: ctx.partes, reserva: null, avisos: ctx.avisos,
    entorno: ctx.plataforma.nombre, tiempos: ctx.cerrarTiempos(),
  };
}
