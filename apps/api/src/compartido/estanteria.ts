/**
 * Operaciones de la plataforma sobre la estantería de un usuario (puerto SQL):
 * tareas, subidas, bibliotecas y el estado de los documentos. Las usan las
 * rutas, el Durable Object `Estanteria` (por RPC desde el Workflow) y la cola
 * local; por eso no saben nada de HTTP.
 */
import type { Documento, FaseIngesta, Progreso, SQL, ValorSQL } from '@scholaris/nucleo';
import { nuevoId } from '@scholaris/nucleo';
import type { Biblioteca, EstadoTarea, Tarea, TipoTarea } from '@scholaris/contrato';

export const ahora = () => new Date().toISOString();

type Fila = Record<string, ValorSQL>;
const s = (v: ValorSQL | undefined): string => (v === null || v === undefined ? '' : String(v));
const n = (v: ValorSQL | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0));
const j = <T>(v: ValorSQL | undefined, def: T): T => {
  if (typeof v !== 'string' || !v) return def;
  try { return JSON.parse(v) as T; } catch { return def; }
};

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export function filaATarea(f: Fila): Tarea {
  const t: Tarea = {
    id: s(f.id),
    tipo: s(f.tipo) as TipoTarea,
    estado: s(f.estado) as EstadoTarea,
    creada: s(f.creada),
    actualizada: s(f.actualizada),
  };
  if (f.documento) t.documento = s(f.documento);
  const p = j<Progreso | null>(f.progreso, null);
  if (p) t.progreso = p;
  if (f.error) t.error = s(f.error);
  if (f.terminada) t.terminada = s(f.terminada);
  return t;
}

export async function crearTarea(sql: SQL, tipo: TipoTarea, documento: string | null, params: unknown, id = nuevoId('t')): Promise<Tarea> {
  const t = ahora();
  await sql.ejecutar('INSERT INTO pl_tareas (id, tipo, estado, documento, params, creada, actualizada) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, tipo, 'en_cola', documento, JSON.stringify(params ?? null), t, t);
  return { id, tipo, estado: 'en_cola', documento: documento ?? undefined, creada: t, actualizada: t };
}

export async function leerTarea(sql: SQL, id: string): Promise<(Tarea & { params: unknown }) | null> {
  const [f] = await sql.ejecutar<Fila>('SELECT * FROM pl_tareas WHERE id = ?', id);
  return f ? { ...filaATarea(f), params: j(f.params, null) } : null;
}

export async function listarTareas(sql: SQL, activas: boolean, limite = 100): Promise<Tarea[]> {
  const filas = activas
    ? await sql.ejecutar<Fila>("SELECT * FROM pl_tareas WHERE estado IN ('en_cola','procesando') ORDER BY creada DESC LIMIT ?", limite)
    : await sql.ejecutar<Fila>('SELECT * FROM pl_tareas ORDER BY creada DESC LIMIT ?', limite);
  return filas.map(filaATarea);
}

/** Apunta el progreso de una tarea (y su documento pasa a «procesando»). */
export async function apuntarProgreso(sql: SQL, p: Progreso): Promise<void> {
  await sql.ejecutar("UPDATE pl_tareas SET estado = CASE WHEN estado IN ('en_cola','procesando') THEN 'procesando' ELSE estado END, progreso = ?, actualizada = ? WHERE id = ?",
    JSON.stringify(p), ahora(), p.tarea);
}

export async function terminarTarea(sql: SQL, id: string, estado: EstadoTarea, error?: string): Promise<Tarea | null> {
  const t = ahora();
  await sql.ejecutar('UPDATE pl_tareas SET estado = ?, error = ?, actualizada = ?, terminada = ? WHERE id = ?', estado, error ?? null, t, t, id);
  const tarea = await leerTarea(sql, id);
  if (tarea?.documento && tarea.tipo !== 'autocita') {
    await sql.ejecutar('UPDATE documentos SET estado = ?, actualizado = ? WHERE id = ?', estado === 'listo' ? 'listo' : estado === 'cancelada' ? 'error' : 'error', t, tarea.documento);
    if (estado !== 'listo') await sql.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)',
      tarea.documento, 'error', null, JSON.stringify({ tarea: id, error: error ?? estado }), null, t);
  }
  return tarea;
}

/** Tarea en curso de un documento, si la hay. */
export async function tareaDeDocumento(sql: SQL, documento: string): Promise<string | undefined> {
  const [f] = await sql.ejecutar<{ id: string }>("SELECT id FROM pl_tareas WHERE documento = ? AND estado IN ('en_cola','procesando') ORDER BY creada DESC LIMIT 1", documento);
  return f?.id;
}

export async function ultimoError(sql: SQL, documento: string): Promise<string | undefined> {
  const [f] = await sql.ejecutar<{ error: string | null }>('SELECT error FROM pl_tareas WHERE documento = ? ORDER BY creada DESC LIMIT 1', documento);
  return f?.error ?? undefined;
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export async function crearDocumentoPendiente(sql: SQL, d: Omit<Documento, 'creado' | 'actualizado' | 'estado' | 'unidades'> & { estado?: Documento['estado'] }): Promise<void> {
  const t = ahora();
  const m = d.metadatos;
  await sql.ejecutar(
    `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, creado, actualizado, bibliotecas, titulo, autores, anio, idioma)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    d.id, d.tipo, JSON.stringify(m), d.estado ?? 'pendiente', d.huella, d.original, d.mime, d.bytes, t, t,
    JSON.stringify(d.bibliotecas ?? []), m.titulo ?? null, (m.autores ?? []).map((a) => a.apellidos || a.nombre).join('; ') || null, m.anio ?? null, m.idioma ?? null,
  );
}

export async function marcarDocumento(sql: SQL, documento: string, estado: Documento['estado']): Promise<void> {
  await sql.ejecutar('UPDATE documentos SET estado = ?, actualizado = ? WHERE id = ?', estado, ahora(), documento);
}

export async function documentoPorHuella(sql: SQL, huella: string): Promise<string | null> {
  const [f] = await sql.ejecutar<{ id: string }>("SELECT id FROM documentos WHERE huella = ? AND estado <> 'error' LIMIT 1", huella);
  return f?.id ?? null;
}

export async function totalesEstanteria(sql: SQL): Promise<{ documentos: number; bytes: number }> {
  const [f] = await sql.ejecutar<{ d: number; b: number }>('SELECT COUNT(*) AS d, COALESCE(SUM(bytes), 0) AS b FROM documentos');
  return { documentos: n(f?.d), bytes: n(f?.b) };
}

/** Claves del almacén que pertenecen a un documento (para borrarlas). */
export async function clavesDeDocumento(sql: SQL, documento: string): Promise<string[]> {
  const filas = await sql.ejecutar<{ k: string | null }>(
    `SELECT original AS k FROM documentos WHERE id = ?
     UNION SELECT imagen FROM unidades WHERE documento = ? UNION SELECT miniatura FROM unidades WHERE documento = ?
     UNION SELECT imagen FROM figuras WHERE documento = ?`, documento, documento, documento, documento);
  return filas.map((f) => f.k).filter((k): k is string => !!k);
}

/**
 * Ids en el índice vectorial de un documento. Son los ids de fragmentos,
 * unidades y figuras tal cual (los adaptadores del índice los aíslan por
 * usuario con el espacio de nombres).
 */
export async function idsIndiceDeDocumento(sql: SQL, documento: string): Promise<string[]> {
  const ids = (await sql.ejecutar<{ id: string }>('SELECT DISTINCT id FROM vectores WHERE documento = ?', documento)).map((f) => f.id);
  for (const t of ['fragmentos', 'unidades', 'figuras']) {
    for (const f of await sql.ejecutar<{ id: string }>(`SELECT id FROM ${t} WHERE documento = ?`, documento)) ids.push(f.id);
  }
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// Bibliotecas
// ---------------------------------------------------------------------------

export async function listarBibliotecasPropias(sql: SQL, propietario: string): Promise<Biblioteca[]> {
  const filas = await sql.ejecutar<Fila>(
    `SELECT b.*, (SELECT COUNT(*) FROM documentos d, json_each(d.bibliotecas) je WHERE je.value = b.id) AS docs
     FROM pl_bibliotecas b ORDER BY b.nombre COLLATE NOCASE`);
  return filas.map((f) => filaABiblioteca(f, propietario));
}

export function filaABiblioteca(f: Fila, propietario: string): Biblioteca {
  const b: Biblioteca = {
    id: s(f.id), nombre: s(f.nombre), documentos: n(f.docs), creada: s(f.creada), actualizada: s(f.actualizada),
    propietario, permiso: 'propietario', compartida: n(f.compartida) > 0,
  };
  if (f.descripcion) b.descripcion = s(f.descripcion);
  if (f.color) b.color = s(f.color);
  return b;
}

export async function leerBiblioteca(sql: SQL, id: string, propietario: string): Promise<Biblioteca | null> {
  const [f] = await sql.ejecutar<Fila>(
    `SELECT b.*, (SELECT COUNT(*) FROM documentos d, json_each(d.bibliotecas) je WHERE je.value = b.id) AS docs
     FROM pl_bibliotecas b WHERE b.id = ?`, id);
  return f ? filaABiblioteca(f, propietario) : null;
}

/** Añade o quita una biblioteca del JSON `bibliotecas` de los documentos. */
export async function cambiarBiblioteca(sql: SQL, biblioteca: string, documentos: string[], anadir: boolean): Promise<void> {
  await sql.transaccion(async (t) => {
    for (const d of documentos) {
      const [f] = await t.ejecutar<{ bibliotecas: string }>('SELECT bibliotecas FROM documentos WHERE id = ?', d);
      if (!f) continue;
      const actual = new Set(j<string[]>(f.bibliotecas, []));
      if (anadir) actual.add(biblioteca); else actual.delete(biblioteca);
      await t.ejecutar('UPDATE documentos SET bibliotecas = ?, actualizado = ? WHERE id = ?', JSON.stringify([...actual]), ahora(), d);
    }
  });
  await sql.ejecutar('UPDATE pl_bibliotecas SET actualizada = ? WHERE id = ?', ahora(), biblioteca);
}

export type { FaseIngesta };
