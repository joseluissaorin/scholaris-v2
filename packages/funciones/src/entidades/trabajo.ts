/**
 * El trabajo de fondo por documento: extraer, resolver, enlazar con Wikidata,
 * tejer las aristas y nombrar las relaciones fuertes.
 *
 * Idempotente y reanudable: los lotes son deterministas y cada lote terminado
 * queda apuntado (`entidades_trabajos.hechos`) en la misma transacción que sus
 * menciones. Si el proceso muere (un Durable Object que se recicla), la
 * siguiente pasada sigue donde se quedó. Si los fragmentos del documento
 * cambian (otra ingesta), la huella no casa y se empieza de cero.
 */

import type { SQL } from '@scholaris/nucleo';
import type { EstadoExtraccion, ExtraccionEntidades } from '@scholaris/contrato';
import { leerDocumentos } from '../estanteria.js';
import type { AlProgreso, PuertosFunciones } from '../puertos.js';
import { ahora, deJSON, num } from '../util.js';
import { CARACTERES_LOTE, extraerLote, formarLotes, localizarMenciones, usdAprox, type FragmentoEntidades, type UsoLote } from './extraer.js';
import { completarMenciones, guardarMenciones, recontar, resolverBiblioteca } from './resolver.js';
import { enlazarWikidata, type OpcionesWikidata } from './wikidata.js';
import { etiquetarRelaciones, reconstruirAristasDocumento } from './aristas.js';

export interface OpcionesEntidades {
  /** Fuerza a empezar de cero aunque ya esté hecho. */
  forzar?: boolean;
  /** Lotes en vuelo a la vez (por defecto 4). */
  concurrencia?: number;
  caracteresLote?: number;
  /** Enlace con Wikidata (por defecto, sí). `false` lo apaga. */
  wikidata?: false | OpcionesWikidata;
  /** Nombrar las relaciones fuertes (por defecto, sí). */
  relaciones?: boolean;
  alProgreso?: AlProgreso;
}

/** Un trabajo «en marcha» sin latido en este tiempo se da por muerto. */
export const CADUCIDAD_TRABAJO_MS = 3 * 60_000;

interface FilaTrabajo {
  documento: string;
  estado: EstadoExtraccion;
  huella: string | null;
  lotes: number;
  hechos: string;
  tokens_entrada: number;
  tokens_salida: number;
  llamadas: number;
  usd: number;
  error: string | null;
  iniciado: string;
  actualizado: string;
}

async function leerTrabajo(sql: SQL, documento: string): Promise<FilaTrabajo | null> {
  const [f] = await sql.ejecutar<FilaTrabajo>('SELECT * FROM entidades_trabajos WHERE documento = ?', documento);
  return f ?? null;
}

export async function estadoExtraccion(sql: SQL, documento: string): Promise<ExtraccionEntidades | null> {
  const t = await leerTrabajo(sql, documento);
  if (!t) return null;
  const [c] = await sql.ejecutar<{ m: number; e: number }>('SELECT COUNT(*) AS m, COUNT(DISTINCT entidad) AS e FROM menciones WHERE documento = ?', documento);
  return aExtraccion(t, num(c?.m), num(c?.e));
}

function aExtraccion(t: FilaTrabajo, menciones: number, entidades: number): ExtraccionEntidades {
  return {
    documento: t.documento, estado: t.estado, lotes: num(t.lotes), lotesHechos: deJSON<number[]>(t.hechos, []).length,
    menciones, entidades, usdEstimado: Math.round(num(t.usd) * 1e5) / 1e5, actualizado: t.actualizado,
    ...(t.error ? { error: t.error } : {}),
  };
}

/** Huella barata de los fragmentos: cambia si la ingesta se rehace. */
function huellaDe(fs: readonly FragmentoEntidades[]): string {
  let h = 2166136261;
  for (const f of fs) {
    const s = `${f.id}:${f.texto.length};`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return `${fs.length}-${(h >>> 0).toString(36)}`;
}

/** Cerrojo de escritura dentro del proceso: los lotes van en paralelo, las transacciones no. */
function cerrojo() {
  let cola: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const r = cola.then(fn, fn);
    cola = r.catch(() => undefined);
    return r;
  };
}

/** Marca un documento como pendiente (para que lo recoja `reanudarEntidades`). */
export async function encolarEntidades(sql: SQL, documento: string): Promise<void> {
  const t = ahora();
  await sql.ejecutar(
    `INSERT INTO entidades_trabajos (documento, estado, iniciado, actualizado) VALUES (?, 'pendiente', ?, ?)
     ON CONFLICT(documento) DO UPDATE SET estado = CASE WHEN estado = 'en_marcha' THEN estado ELSE 'pendiente' END, actualizado = excluded.actualizado`,
    documento, t, t,
  );
}

/**
 * Extrae (o termina de extraer) las entidades de un documento y actualiza el
 * grafo de la biblioteca. Nunca deja el trabajo a medias en un estado que no
 * se pueda reanudar.
 */
export async function extraerEntidadesDocumento(p: PuertosFunciones, documento: string, o: OpcionesEntidades = {}): Promise<ExtraccionEntidades> {
  const { sql } = p;
  const inicio = Date.now();
  const progreso = async (fase: string, estado: 'inicio' | 'avance' | 'hecho' | 'error', mensaje: string, avance?: number) => {
    try { await o.alProgreso?.({ fase, estado, mensaje, ms: Date.now() - inicio, ...(avance !== undefined ? { avance } : {}) }); } catch { /* el progreso no tumba el trabajo */ }
  };
  const t0 = ahora();
  const redactor = p.inteligencia?.redactor;
  const docs = await leerDocumentos(sql, [documento]);
  const doc = docs.get(documento);
  if (!doc) {
    await sql.ejecutar('DELETE FROM entidades_trabajos WHERE documento = ?', documento);
    throw new Error(`No existe el documento ${documento}.`);
  }
  if (!redactor) {
    await sql.ejecutar(
      `INSERT INTO entidades_trabajos (documento, estado, iniciado, actualizado) VALUES (?, 'sin_redactor', ?, ?)
       ON CONFLICT(documento) DO UPDATE SET estado = 'sin_redactor', actualizado = excluded.actualizado`, documento, t0, t0,
    );
    return (await estadoExtraccion(sql, documento))!;
  }

  const fragmentos: FragmentoEntidades[] = (await sql.ejecutar<{ id: string; orden: number; texto: string; ancla: string }>(
    'SELECT id, orden, texto, ancla FROM fragmentos WHERE documento = ? ORDER BY orden', documento,
  )).map((f) => ({ id: f.id, orden: num(f.orden), texto: String(f.texto ?? ''), ancla: deJSON(f.ancla, { tipo: 'imagen' } as const) }));
  const huella = huellaDe(fragmentos);
  const lotes = formarLotes(fragmentos, o.caracteresLote ?? CARACTERES_LOTE);

  let trabajo = await leerTrabajo(sql, documento);
  if (trabajo && !o.forzar) {
    if (trabajo.estado === 'hecho' && trabajo.huella === huella) return (await estadoExtraccion(sql, documento))!;
    if (trabajo.estado === 'en_marcha' && Date.now() - Date.parse(trabajo.actualizado) < CADUCIDAD_TRABAJO_MS) return (await estadoExtraccion(sql, documento))!;
  }
  if (!trabajo || o.forzar || trabajo.huella !== huella) {
    // De cero: fuera lo de una versión anterior del documento.
    await borrarEntidadesDocumento(sql, documento, false);
    await sql.ejecutar(
      `INSERT INTO entidades_trabajos (documento, estado, huella, lotes, hechos, iniciado, actualizado) VALUES (?, 'en_marcha', ?, ?, '[]', ?, ?)
       ON CONFLICT(documento) DO UPDATE SET estado = 'en_marcha', huella = excluded.huella, lotes = excluded.lotes, hechos = '[]',
         tokens_entrada = 0, tokens_salida = 0, llamadas = 0, usd = 0, error = NULL, iniciado = excluded.iniciado, actualizado = excluded.actualizado`,
      documento, huella, lotes.length, t0, t0,
    );
  } else {
    await sql.ejecutar("UPDATE entidades_trabajos SET estado = 'en_marcha', lotes = ?, error = NULL, actualizado = ? WHERE documento = ?", lotes.length, t0, documento);
  }
  trabajo = (await leerTrabajo(sql, documento))!;
  const hechos = new Set(deJSON<number[]>(trabajo.hechos, []));
  const pendientes = lotes.filter((l) => !hechos.has(l.indice));
  const contexto = { titulo: doc.titulo, autores: doc.autores, anio: doc.anio };
  const escribir = cerrojo();
  const uso: UsoLote = { tokensEntrada: 0, tokensSalida: 0, llamadas: 0 };
  const errores: string[] = [];
  await progreso('extraer', 'inicio', `Leyendo ${lotes.length} ${lotes.length === 1 ? 'lote' : 'lotes'} en busca de entidades`, hechos.size / Math.max(1, lotes.length));

  const anotarUso = (u: UsoLote, s: SQL = sql) =>
    s.ejecutar(
      'UPDATE entidades_trabajos SET tokens_entrada = tokens_entrada + ?, tokens_salida = tokens_salida + ?, llamadas = llamadas + ?, usd = usd + ?, actualizado = ? WHERE documento = ?',
      u.tokensEntrada, u.tokensSalida, u.llamadas, usdAprox(u), ahora(), documento,
    );

  let siguiente = 0;
  const concurrencia = Math.max(1, Math.min(8, o.concurrencia ?? 4));
  const tocadas = new Set<string>();
  await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length) }, async () => {
    while (siguiente < pendientes.length) {
      const lote = pendientes[siguiente++]!;
      try {
        const { entidades, uso: u } = await extraerLote(redactor, lote, contexto);
        const menciones = localizarMenciones(lote, entidades);
        await escribir(() => sql.transaccion(async (tx) => {
          for (const id of await guardarMenciones(tx, documento, lote.fragmentos.map((f) => f.id), menciones)) tocadas.add(id);
          hechos.add(lote.indice);
          await tx.ejecutar('UPDATE entidades_trabajos SET hechos = ?, actualizado = ? WHERE documento = ?', JSON.stringify([...hechos].sort((a, b) => a - b)), ahora(), documento);
          await anotarUso(u, tx);
        }));
        uso.tokensEntrada += u.tokensEntrada; uso.tokensSalida += u.tokensSalida; uso.llamadas += u.llamadas;
        await progreso('extraer', 'avance', `Lote ${hechos.size} de ${lotes.length}`, hechos.size / lotes.length);
      } catch (e) {
        errores.push(`lote ${lote.indice + 1}: ${(e as Error).message}`);
      }
    }
  }));
  await recontar(sql, tocadas);
  if (!errores.length) await completarMenciones(sql, documento, fragmentos);

  if (errores.length) {
    await sql.ejecutar("UPDATE entidades_trabajos SET estado = 'error', error = ?, actualizado = ? WHERE documento = ?", errores.slice(0, 3).join(' · ').slice(0, 500), ahora(), documento);
    await progreso('extraer', 'error', `No se pudieron leer ${errores.length} ${errores.length === 1 ? 'lote' : 'lotes'}; se reintentarán`);
    // Lo ya leído sirve: se tejen las aristas con lo que hay.
    await reconstruirAristasDocumento(sql, documento);
    return (await estadoExtraccion(sql, documento))!;
  }

  await progreso('resolver', 'inicio', 'Uniendo variantes de los nombres en toda la biblioteca');
  const afectados = new Set<string>([documento]);
  for (const d of (await resolverBiblioteca(sql)).documentos) afectados.add(d);
  if (o.wikidata !== false) {
    // Las pistas de Wikidata (autores, años, vecinos) salen de las aristas: primero se tejen.
    await reconstruirAristasDocumento(sql, documento);
    await progreso('wikidata', 'inicio', 'Enlazando con Wikidata');
    try {
      const w = await enlazarWikidata(sql, o.wikidata ?? {});
      if (w.enlazadas) for (const d of (await resolverBiblioteca(sql)).documentos) afectados.add(d);
    } catch { /* Wikidata es un añadido: sin él, el grafo sigue */ }
  }
  await progreso('aristas', 'inicio', 'Tejiendo las coapariciones');
  for (const d of afectados) await reconstruirAristasDocumento(sql, d);
  if (o.relaciones !== false) {
    await progreso('relaciones', 'inicio', 'Poniendo nombre a las relaciones más fuertes');
    const r = await etiquetarRelaciones(sql, redactor, documento);
    if (r.uso.llamadas) await anotarUso(r.uso);
  }
  await sql.ejecutar("UPDATE entidades_trabajos SET estado = 'hecho', error = NULL, actualizado = ? WHERE documento = ?", ahora(), documento);
  const final = (await estadoExtraccion(sql, documento))!;
  await progreso('fin', 'hecho', `${final.entidades} entidades y ${final.menciones} menciones`, 1);
  return final;
}

/** Borra lo de un documento (menciones, aristas y, si se pide, el trabajo) y recuenta. */
export async function borrarEntidadesDocumento(sql: SQL, documento: string, conTrabajo = true): Promise<void> {
  const tocadas = (await sql.ejecutar<{ entidad: string }>('SELECT DISTINCT entidad FROM menciones WHERE documento = ?', documento)).map((f) => f.entidad);
  await sql.ejecutar('DELETE FROM menciones WHERE documento = ?', documento);
  await sql.ejecutar('DELETE FROM aristas_entidades WHERE documento = ?', documento);
  await sql.ejecutar('DELETE FROM entidades_relaciones WHERE documento = ?', documento);
  if (conTrabajo) await sql.ejecutar('DELETE FROM entidades_trabajos WHERE documento = ?', documento);
  if (tocadas.length) await recontar(sql, tocadas);
}

/**
 * Recoge los trabajos parados (pendientes, o en marcha sin latido, o con
 * error) y los termina, uno detrás de otro. Con `todos`, además, los
 * documentos listos que aún no se han mirado nunca (la biblioteca anterior).
 */
export async function reanudarEntidades(p: PuertosFunciones, o: OpcionesEntidades & { todos?: boolean; maximo?: number } = {}): Promise<string[]> {
  if (!p.inteligencia?.redactor) return [];
  // Antes de nada, si las reglas de enlace han cambiado, la biblioteca se pone al día.
  try {
    const { ponerAlDiaEnlaces } = await import('./reparar.js');
    await ponerAlDiaEnlaces(p.sql, p.inteligencia.redactor, o.wikidata === false ? { wikidata: false } : o.wikidata ? { wikidata: o.wikidata } : {});
  } catch { /* la reparación es un añadido: la extracción sigue */ }
  const limite = new Date(Date.now() - CADUCIDAD_TRABAJO_MS).toISOString();
  const docs = (await p.sql.ejecutar<{ documento: string }>(
    `SELECT documento FROM entidades_trabajos
      WHERE estado = 'pendiente' OR estado = 'sin_redactor' OR (estado IN ('en_marcha', 'error') AND actualizado < ?)
      ORDER BY actualizado`, limite,
  )).map((f) => f.documento);
  if (o.todos) {
    for (const f of await p.sql.ejecutar<{ id: string }>(
      "SELECT id FROM documentos WHERE estado = 'listo' AND id NOT IN (SELECT documento FROM entidades_trabajos) ORDER BY creado",
    )) docs.push(f.id);
  }
  const elegidos = docs.slice(0, o.maximo ?? 50);
  for (const d of elegidos) await encolarEntidades(p.sql, d);
  for (const d of elegidos) {
    try { await extraerEntidadesDocumento(p, d, o); } catch { /* el siguiente sigue */ }
  }
  return elegidos;
}

/** ¿Hay trabajos parados que reanudar? (Barato: para decidir si lanzar `reanudarEntidades`.) */
export async function hayEntidadesPendientes(sql: SQL): Promise<boolean> {
  const limite = new Date(Date.now() - CADUCIDAD_TRABAJO_MS).toISOString();
  const [f] = await sql.ejecutar<{ n: number }>(
    "SELECT COUNT(*) AS n FROM entidades_trabajos WHERE estado = 'pendiente' OR (estado IN ('en_marcha', 'error') AND actualizado < ?)", limite,
  );
  return num(f?.n) > 0;
}
