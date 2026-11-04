/**
 * Guardar, confirmar, crear y rechazar relaciones entre obras.
 *
 * - Las que salen de la detección se sustituyen en cada pasada (las del par que ya
 *   no se sostienen se van, con sus alineaciones y su ficha).
 * - Las del usuario (`fuente: 'usuario'`, creadas o confirmadas) no las toca la detección.
 * - Las que el usuario rechaza no vuelven: el rechazo queda en la procedencia del
 *   documento de origen (`transmedia:rechazo`) y se va con él si se borra.
 */
import type { Relacion, SQL, TipoRelacion } from '@scholaris/nucleo';
import { borrarRelacion, escribirRelaciones, leerDocumento, leerRelaciones } from '@scholaris/spdf';
import { huella } from '../comprension/util.js';
import type { CandidataRelacion } from './tipos.js';

export const TIPOS_RELACION: readonly TipoRelacion[] = ['adaptacion_de', 'traduccion_de', 'edicion_de', 'version_de', 'cita_a', 'comenta_a', 'responde_a', 'parte_de', 'misma_obra', 'relacionado'];

export const idRelacion = (origen: string, destino: string, tipo: TipoRelacion) => `rel-${huella(`${origen}>${destino}:${tipo}`)}`;
export const idFichaRelacion = (relacion: string) => `${relacion}:fi`;
const par = (a: string, b: string) => [a, b].sort().join('|');

/** Quita una relación con todo lo que cuelga de ella: alineaciones, ficha (y su vector) y el estado de su alineación. */
export async function borrarRelacionCompleta(sql: SQL, id: string): Promise<string[]> {
  const fichas = (await sql.ejecutar<{ id: string }>("SELECT id FROM fichas WHERE objetivo = 'relacion' AND objetivo_id = ?", id)).map((f) => String(f.id));
  for (const f of fichas) {
    await sql.ejecutar('DELETE FROM fichas WHERE id = ?', f);
    await sql.ejecutar("DELETE FROM vectores WHERE objetivo = 'ficha' AND id = ?", f);
  }
  await borrarRelacion(sql, id);
  await sql.ejecutar('DELETE FROM procedencia WHERE fase = ?', `transmedia:alineacion:${id}`);
  return fichas;
}

/**
 * Guarda lo detectado en los pares evaluados: escribe las candidatas y quita las
 * relaciones detectadas antes en esos pares que ya no salen. No toca las del usuario.
 */
export async function guardarDetectadas(sql: SQL, candidatas: readonly CandidataRelacion[], evaluados: ReadonlyArray<[string, string]>, ahora: string): Promise<{ relaciones: Relacion[]; nuevas: number; quitadas: string[] }> {
  const pares = new Set(evaluados.map(([a, b]) => par(a, b)));
  const docs = [...new Set(evaluados.flat())];
  const previas = new Map<string, Relacion>();
  for (const d of docs) for (const r of await leerRelaciones(sql, d)) previas.set(r.id, r);
  const relaciones: Relacion[] = candidatas.map((c) => {
    const id = idRelacion(c.origen, c.destino, c.tipo);
    return { id, origen: c.origen, destino: c.destino, tipo: c.tipo, nota: c.nota, evidencias: c.evidencias, confianza: c.confianza, fuente: c.fuente, creada: previas.get(id)?.creada ?? ahora };
  });
  const vigentes = new Set(relaciones.map((r) => r.id));
  const quitadas: string[] = [];
  for (const r of previas.values()) {
    if (r.fuente === 'usuario' || vigentes.has(r.id) || !pares.has(par(r.origen, r.destino))) continue;
    await borrarRelacionCompleta(sql, r.id);
    quitadas.push(r.id);
  }
  // Una relación que el usuario ya confirmó con este mismo id se queda como suya.
  const nuevas = relaciones.filter((r) => !previas.has(r.id)).length;
  const guardar = relaciones.filter((r) => previas.get(r.id)?.fuente !== 'usuario');
  await escribirRelaciones(sql, guardar);
  return { relaciones: relaciones.map((r) => (previas.get(r.id)?.fuente === 'usuario' ? previas.get(r.id)! : r)), nuevas, quitadas };
}

export interface RechazoRelacion {
  par: string;
  origen: string;
  destino: string;
  tipo?: TipoRelacion;
  cuando: string;
}

export async function leerRechazos(sql: SQL): Promise<RechazoRelacion[]> {
  const filas = await sql.ejecutar<{ documento: string; detalle: string; cuando: string }>("SELECT documento, detalle, cuando FROM procedencia WHERE fase = 'transmedia:rechazo'");
  return filas.flatMap((f) => {
    try {
      const d = JSON.parse(String(f.detalle)) as { destino: string; tipo?: TipoRelacion };
      return [{ par: par(String(f.documento), d.destino), origen: String(f.documento), destino: d.destino, ...(d.tipo ? { tipo: d.tipo } : {}), cuando: String(f.cuando) }];
    } catch { return []; }
  });
}

async function quitarRechazos(sql: SQL, a: string, b: string): Promise<void> {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    await sql.ejecutar("DELETE FROM procedencia WHERE documento = ? AND fase = 'transmedia:rechazo' AND json_extract(detalle, '$.destino') = ?", x, y);
  }
}

export async function leerRelacion(sql: SQL, id: string): Promise<Relacion | null> {
  const [f] = await sql.ejecutar<{ origen: string }>('SELECT origen FROM relaciones WHERE id = ?', id);
  if (!f) return null;
  return (await leerRelaciones(sql, String(f.origen))).find((r) => r.id === id) ?? null;
}

export class ErrorRelacion extends Error {
  constructor(mensaje: string, public readonly codigo: 'no_existe' | 'invalida') { super(mensaje); }
}

/** El usuario dice que `origen` adapta (traduce, edita…) a `destino`. Sustituye lo detectado en ese par. */
export async function crearRelacionUsuario(sql: SQL, r: { origen: string; destino: string; tipo: TipoRelacion; nota?: string }, ahora: string): Promise<Relacion> {
  if (!TIPOS_RELACION.includes(r.tipo)) throw new ErrorRelacion(`«${r.tipo}» no es un tipo de relación. Admitidos: ${TIPOS_RELACION.join(', ')}.`, 'invalida');
  if (r.origen === r.destino) throw new ErrorRelacion('Una obra no se relaciona consigo misma.', 'invalida');
  for (const d of [r.origen, r.destino]) if (!(await leerDocumento(sql, d))) throw new ErrorRelacion(`No existe el documento ${d}.`, 'no_existe');
  const id = idRelacion(r.origen, r.destino, r.tipo);
  const previas = (await leerRelaciones(sql, r.origen)).filter((x) => par(x.origen, x.destino) === par(r.origen, r.destino));
  const misma = previas.find((x) => x.id === id);
  for (const x of previas) if (x.id !== id && x.fuente !== 'usuario') await borrarRelacionCompleta(sql, x.id);
  await quitarRechazos(sql, r.origen, r.destino);
  const rel: Relacion = {
    id, origen: r.origen, destino: r.destino, tipo: r.tipo, ...(r.nota?.trim() ? { nota: r.nota.trim() } : misma?.nota ? { nota: misma.nota } : {}),
    evidencias: misma?.evidencias ?? [], confianza: 1, fuente: 'usuario', creada: misma?.creada ?? ahora,
  };
  await escribirRelaciones(sql, [rel]);
  return rel;
}

/** El usuario confirma una relación detectada: pasa a ser suya (la detección ya no la toca). */
export async function confirmarRelacion(sql: SQL, id: string): Promise<Relacion> {
  const r = await leerRelacion(sql, id);
  if (!r) throw new ErrorRelacion('Esa relación no existe.', 'no_existe');
  const confirmada: Relacion = { ...r, fuente: 'usuario', confianza: 1 };
  await escribirRelaciones(sql, [confirmada]);
  return confirmada;
}

/** El usuario quita una relación: se borra con sus alineaciones y la detección no la vuelve a proponer. */
export async function rechazarRelacion(sql: SQL, id: string, ahora: string): Promise<void> {
  const r = await leerRelacion(sql, id);
  if (!r) throw new ErrorRelacion('Esa relación no existe.', 'no_existe');
  await borrarRelacionCompleta(sql, id);
  await sql.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)',
    r.origen, 'transmedia:rechazo', null, JSON.stringify({ destino: r.destino, tipo: r.tipo }), null, ahora);
}

/** Al borrar un documento: fuera sus relaciones (con alineaciones y fichas) y los rechazos que lo nombran. */
export async function borrarRelacionesDeDocumento(sql: SQL, documento: string): Promise<string[]> {
  const fichas: string[] = [];
  for (const r of await leerRelaciones(sql, documento)) fichas.push(...await borrarRelacionCompleta(sql, r.id));
  await sql.ejecutar("DELETE FROM procedencia WHERE fase = 'transmedia:rechazo' AND json_extract(detalle, '$.destino') = ?", documento);
  return fichas;
}
