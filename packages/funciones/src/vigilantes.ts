/**
 * Vigilantes: búsquedas guardadas que se vuelven a lanzar (a mano, al ingerir
 * un documento, cada día o cada semana) y avisan cuando aparecen documentos
 * nuevos entre los primeros resultados o cambia la respuesta.
 *
 * Mejora respecto a la versión anterior: al ingerir, la búsqueda se lanza
 * sobre toda la biblioteca (no solo sobre el documento nuevo) y se compara con
 * la línea base completa, así que la línea base nunca queda recortada.
 */

import { nuevoId, type Filtros, type SQL } from '@scholaris/nucleo';
import type { Alerta, ModoVigilante, NuevoVigilante, Vigilante } from '@scholaris/contrato';
import { buscadorDe } from './buscador-local.js';
import type { ConfianzaRespuesta, PuertosFunciones } from './puertos.js';
import { aJSON, ahora, bool, deJSON, ErrorFunciones, limitar, noEncontrado, num, texto, una } from './util.js';

const MODOS: readonly ModoVigilante[] = ['manual', 'al_ingerir', 'diario', 'semanal'];

export type CambioRespuesta = 'sin_cambios' | 'confianza_sube' | 'confianza_baja' | 'respuesta_cambia';

const TEXTO_CAMBIO: Record<CambioRespuesta, string | undefined> = {
  sin_cambios: undefined,
  confianza_sube: 'La respuesta es ahora más segura que la última vez.',
  confianza_baja: 'La respuesta es ahora menos segura que la última vez.',
  respuesta_cambia: 'La respuesta ha cambiado desde la última vez.',
};

/** Documentos nuevos respecto a la línea base, sin repetir y en orden de aparición. */
export function documentosNuevos(antes: readonly string[], ahoraIds: readonly string[]): string[] {
  const previos = new Set(antes);
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const x of ahoraIds) if (x && !previos.has(x) && !vistos.has(x)) { vistos.add(x); salida.push(x); }
  return salida;
}

export function clasificarCambio(
  textoAntes: string | null, confAntes: string | null, textoAhora: string | null, confAhora: string | null,
): CambioRespuesta {
  if ((textoAhora ?? '') === (textoAntes ?? '') && (confAhora ?? '') === (confAntes ?? '')) return 'sin_cambios';
  const orden: Record<string, number> = { baja: 0, media: 1, alta: 2 };
  if (confAhora && confAntes && confAhora in orden && confAntes in orden && orden[confAhora] !== orden[confAntes]) {
    return orden[confAhora]! > orden[confAntes]! ? 'confianza_sube' : 'confianza_baja';
  }
  // Sin respuesta antes ni ahora y solo cambia la nada: no es un cambio.
  if (!textoAhora && !textoAntes) return 'sin_cambios';
  return 'respuesta_cambia';
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function filaAVigilante(f: Record<string, unknown>): Vigilante {
  const v: Vigilante = {
    id: String(f.id),
    nombre: String(f.nombre),
    consulta: String(f.consulta),
    modo: String(f.modo) as ModoVigilante,
    alertas: bool(f.alertas),
    pendientes: num(f.pendientes),
    creado: String(f.creado),
    actualizado: String(f.actualizado),
  };
  const filtros = deJSON<Filtros | null>(f.filtros, null);
  if (filtros) v.filtros = filtros;
  if (f.ultima_ejecucion) v.ultimaEjecucion = String(f.ultima_ejecucion);
  if (f.ultima_confianza) v.ultimaConfianza = String(f.ultima_confianza) as ConfianzaRespuesta;
  return v;
}

const SELECT_VIGILANTE = `SELECT v.*, (SELECT count(*) FROM alertas a WHERE a.vigilante = v.id AND a.vista IS NULL) AS pendientes FROM vigilantes v`;

function validar(n: Partial<NuevoVigilante>, parcial: boolean) {
  if (!parcial || n.nombre !== undefined) {
    if (typeof n.nombre !== 'string' || !n.nombre.trim()) throw new ErrorFunciones('peticion_invalida', 'El vigilante necesita un nombre.');
    if (n.nombre.length > 200) throw new ErrorFunciones('peticion_invalida', 'El nombre no puede pasar de 200 caracteres.');
  }
  if (!parcial || n.consulta !== undefined) {
    if (typeof n.consulta !== 'string' || !n.consulta.trim()) throw new ErrorFunciones('peticion_invalida', 'El vigilante necesita una consulta.');
    if (n.consulta.length > 4000) throw new ErrorFunciones('peticion_invalida', 'La consulta no puede pasar de 4000 caracteres.');
  }
  if (n.modo !== undefined && !MODOS.includes(n.modo)) {
    throw new ErrorFunciones('peticion_invalida', 'El modo debe ser «manual», «al_ingerir», «diario» o «semanal».');
  }
}

export async function crearVigilante(sql: SQL, n: NuevoVigilante & { k?: number }): Promise<Vigilante> {
  validar(n, false);
  const id = nuevoId('v');
  const t = ahora();
  await sql.ejecutar(
    `INSERT INTO vigilantes (id, nombre, consulta, filtros, modo, alertas, k, creado, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, n.nombre.trim(), n.consulta.trim(), aJSON(n.filtros), n.modo ?? 'manual', n.alertas === false ? 0 : 1,
    limitar(n.k, 1, 100, 10), t, t,
  );
  return obtenerVigilante(sql, id);
}

export async function listarVigilantes(sql: SQL, modo?: ModoVigilante): Promise<Vigilante[]> {
  const filas = modo
    ? await sql.ejecutar(`${SELECT_VIGILANTE} WHERE v.modo = ? ORDER BY v.creado DESC`, modo)
    : await sql.ejecutar(`${SELECT_VIGILANTE} ORDER BY v.creado DESC`);
  return filas.map(filaAVigilante);
}

export async function obtenerVigilante(sql: SQL, id: string): Promise<Vigilante> {
  const f = await una(sql, `${SELECT_VIGILANTE} WHERE v.id = ?`, id);
  if (!f) throw noEncontrado('ese vigilante');
  return filaAVigilante(f);
}

export async function actualizarVigilante(sql: SQL, id: string, c: Partial<NuevoVigilante>): Promise<Vigilante> {
  await obtenerVigilante(sql, id);
  validar(c, true);
  const sets: string[] = [];
  const p: Array<string | number | null> = [];
  if (c.nombre !== undefined) { sets.push('nombre = ?'); p.push(c.nombre.trim()); }
  if (c.consulta !== undefined) {
    // Otra consulta: la línea base anterior ya no vale.
    sets.push('consulta = ?', 'ultimos_documentos = NULL', 'ultimos_fragmentos = NULL', 'ultima_respuesta = NULL', 'ultima_confianza = NULL');
    p.push(c.consulta.trim());
  }
  if (c.filtros !== undefined) { sets.push('filtros = ?'); p.push(aJSON(c.filtros)); }
  if (c.modo !== undefined) { sets.push('modo = ?'); p.push(c.modo); }
  if (c.alertas !== undefined) { sets.push('alertas = ?'); p.push(c.alertas ? 1 : 0); }
  if (!sets.length) throw new ErrorFunciones('peticion_invalida', 'No hay nada que cambiar.');
  sets.push('actualizado = ?');
  p.push(ahora());
  await sql.ejecutar(`UPDATE vigilantes SET ${sets.join(', ')} WHERE id = ?`, ...p, id);
  return obtenerVigilante(sql, id);
}

export async function borrarVigilante(sql: SQL, id: string): Promise<void> {
  await obtenerVigilante(sql, id);
  await sql.transaccion(async (tx) => {
    await tx.ejecutar('DELETE FROM alertas WHERE vigilante = ?', id);
    await tx.ejecutar('DELETE FROM vigilantes WHERE id = ?', id);
  });
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export interface AlertaCompleta extends Alerta {
  fragmentosNuevos: string[];
  tipoCambio: CambioRespuesta;
  detalle?: string;
}

function filaAAlerta(f: Record<string, unknown>): AlertaCompleta {
  const tipoCambio = String(f.cambio) as CambioRespuesta;
  const a: AlertaCompleta = {
    id: String(f.id),
    vigilante: String(f.vigilante),
    documentosNuevos: deJSON(f.documentos_nuevos, []),
    fragmentosNuevos: deJSON(f.fragmentos_nuevos, []),
    tipoCambio,
    disparadaPor: String(f.disparada_por) as Alerta['disparadaPor'],
    creada: String(f.creada),
  };
  if (f.nombre_vigilante) a.nombreVigilante = String(f.nombre_vigilante);
  const cambio = TEXTO_CAMBIO[tipoCambio];
  if (cambio) a.cambio = cambio;
  if (f.vista) a.vista = String(f.vista);
  if (f.detalle) a.detalle = String(f.detalle);
  return a;
}

const SELECT_ALERTA = `SELECT a.*, v.nombre AS nombre_vigilante FROM alertas a LEFT JOIN vigilantes v ON v.id = a.vigilante`;

export async function listarAlertas(sql: SQL, opciones: { pendientes?: boolean; vigilante?: string; limite?: number } = {}): Promise<AlertaCompleta[]> {
  const donde: string[] = [];
  const p: Array<string | number> = [];
  if (opciones.pendientes) donde.push('a.vista IS NULL');
  if (opciones.vigilante) { donde.push('a.vigilante = ?'); p.push(opciones.vigilante); }
  const filas = await sql.ejecutar(
    `${SELECT_ALERTA} ${donde.length ? 'WHERE ' + donde.join(' AND ') : ''} ORDER BY a.creada DESC, a.id DESC LIMIT ?`,
    ...p, limitar(opciones.limite, 1, 500, 100),
  );
  return filas.map(filaAAlerta);
}

export async function alertasDeVigilante(sql: SQL, vigilante: string, limite?: number): Promise<AlertaCompleta[]> {
  await obtenerVigilante(sql, vigilante);
  return listarAlertas(sql, { vigilante, ...(limite ? { limite } : {}) });
}

export async function marcarAlertaVista(sql: SQL, id: string): Promise<void> {
  if (!(await una(sql, 'SELECT 1 AS x FROM alertas WHERE id = ?', id))) throw noEncontrado('esa alerta');
  await sql.ejecutar('UPDATE alertas SET vista = coalesce(vista, ?) WHERE id = ?', ahora(), id);
}

export async function marcarTodasVistas(sql: SQL): Promise<number> {
  const n = await una<{ n: number }>(sql, 'SELECT count(*) AS n FROM alertas WHERE vista IS NULL');
  await sql.ejecutar('UPDATE alertas SET vista = ? WHERE vista IS NULL', ahora());
  return num(n?.n);
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

export interface OpcionesEjecucion {
  disparadaPor?: Alerta['disparadaPor'];
  /** Documento ingerido o cadencia del programa. */
  detalle?: string;
}

/**
 * Lanza un vigilante. Devuelve la alerta si hay algo nuevo, o `null` si nada
 * ha cambiado. Siempre actualiza la línea base.
 */
export async function ejecutarVigilante(p: PuertosFunciones, id: string, o: OpcionesEjecucion = {}): Promise<AlertaCompleta | null> {
  const { sql } = p;
  const f = await una(sql, 'SELECT * FROM vigilantes WHERE id = ?', id);
  if (!f) throw noEncontrado('ese vigilante');
  const filtros = deJSON<Filtros | undefined>(f.filtros, undefined);
  const buscador = buscadorDe(p);
  let r;
  try {
    r = await buscador.buscar({ consulta: String(f.consulta), ...(filtros ? { filtros } : {}), k: num(f.k, 10), respuesta: true });
  } catch (e) {
    throw new ErrorFunciones('proveedor_fallo', `La búsqueda del vigilante ha fallado: ${(e as Error).message}`, 502);
  }
  const docs: string[] = [];
  const frags: string[] = [];
  for (const x of r.resultados) {
    if (!docs.includes(x.documento.id)) docs.push(x.documento.id);
    frags.push(x.fragmento.id);
  }
  const primeraVez = f.ultimos_documentos === null || f.ultimos_documentos === undefined;
  const nuevosDocs = primeraVez ? [] : documentosNuevos(deJSON<string[]>(f.ultimos_documentos, []), docs);
  const nuevosFrags = primeraVez ? [] : documentosNuevos(deJSON<string[]>(f.ultimos_fragmentos, []), frags);
  const textoAhora = r.respuesta?.texto ?? null;
  const confAhora = r.respuesta?.confianza ?? null;
  const cambio = primeraVez ? 'sin_cambios' : clasificarCambio(texto(f.ultima_respuesta), texto(f.ultima_confianza), textoAhora, confAhora);
  const t = ahora();
  await sql.ejecutar(
    `UPDATE vigilantes SET ultima_ejecucion = ?, ultimos_documentos = ?, ultimos_fragmentos = ?, ultima_respuesta = ?, ultima_confianza = ? WHERE id = ?`,
    t, JSON.stringify(docs), JSON.stringify(frags), textoAhora, confAhora, id,
  );
  if (!nuevosDocs.length && cambio === 'sin_cambios') return null;
  const alertaId = nuevoId('a');
  await sql.ejecutar(
    `INSERT INTO alertas (id, vigilante, documentos_nuevos, fragmentos_nuevos, cambio, disparada_por, detalle, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    alertaId, id, JSON.stringify(nuevosDocs), JSON.stringify(nuevosFrags), cambio, o.disparadaPor ?? 'manual', o.detalle ?? null, t,
  );
  const alerta = filaAAlerta((await una(sql, `${SELECT_ALERTA} WHERE a.id = ?`, alertaId))!);
  if (bool(f.alertas) && p.emisor) {
    try {
      await p.emisor.emitir(p.canal ?? `usuario:${p.usuario.id}`, { tipo: 'alerta', alerta });
    } catch {
      // El aviso en tiempo real es secundario: la alerta ya está guardada.
    }
  }
  return alerta;
}

/** Tras ingerir un documento: lanza los vigilantes «al ingerir» (y los programados, que también vigilan lo nuevo). */
export async function vigilarIngesta(p: PuertosFunciones, documento: string): Promise<AlertaCompleta[]> {
  const filas = await p.sql.ejecutar(`SELECT id FROM vigilantes WHERE modo IN ('al_ingerir', 'diario', 'semanal')`);
  const salida: AlertaCompleta[] = [];
  for (const f of filas) {
    try {
      const a = await ejecutarVigilante(p, String(f.id), { disparadaPor: 'ingesta', detalle: documento });
      if (a) salida.push(a);
    } catch {
      // Un vigilante roto no para a los demás.
    }
  }
  return salida;
}

/** Barrido periódico (cron diario o semanal de la plataforma). */
export async function ejecutarVigilantesProgramados(p: PuertosFunciones, cadencia: 'diario' | 'semanal'): Promise<AlertaCompleta[]> {
  const filas = await p.sql.ejecutar('SELECT id FROM vigilantes WHERE modo = ?', cadencia);
  const salida: AlertaCompleta[] = [];
  for (const f of filas) {
    try {
      const a = await ejecutarVigilante(p, String(f.id), { disparadaPor: 'programada', detalle: cadencia });
      if (a) salida.push(a);
    } catch {
      // Igual que arriba.
    }
  }
  return salida;
}
