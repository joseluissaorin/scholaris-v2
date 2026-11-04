/**
 * Repositorio de la capa de comprensión (SPDF 4.2, docs/COMPRENSION.md):
 * segmentos, fichas, apariciones, relaciones y alineaciones. Las entidades son
 * las del grafo de @scholaris/funciones; aquí solo se anota dónde aparecen.
 *
 * Mismas reglas que el resto del repositorio: un puerto SQL cualquiera (sqlite-wasm,
 * Durable Object, D1, better-sqlite3), JSON en las columnas de anclas y evidencias,
 * y nunca más de 100 parámetros por sentencia (las listas van como un solo JSON).
 */
import type {
  Alineacion, AnclaMaterial, Aparicion, Evidencia, Ficha, LadoAlineacion, Lente, ObjetivoFicha, Relacion, RolAparicion,
  Segmento, SQL, TipoCorrespondencia, TipoRelacion, TipoSegmento, ValorSQL,
} from '@scholaris/nucleo';
import { enLista } from '@scholaris/nucleo';

type Fila = Record<string, ValorSQL>;

const json = (v: unknown): string => JSON.stringify(v);
const texto = (v: ValorSQL | undefined): string => (v === null || v === undefined ? '' : String(v));
const numero = (v: ValorSQL | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0));
const deJson = <T>(v: ValorSQL | undefined, defecto: T): T => {
  if (v === null || v === undefined || v === '') return defecto;
  try { return JSON.parse(String(v)) as T; } catch { return defecto; }
};
const opcional = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v);

/** Segundo de inicio y de fin de un ancla de tiempo, para las columnas desnormalizadas. */
function tiempos(a: AnclaMaterial, fin?: AnclaMaterial): [number | null, number | null] {
  if (a.tipo !== 'tiempo') return [null, null];
  return [a.t0, fin && fin.tipo === 'tiempo' ? fin.t1 : a.t1];
}

/**
 * Consulta FTS5 segura para las tablas de comprensión (sin la columna normalizada de
 * los fragmentos): cada palabra entre comillas (sin
 * operadores), unidas con OR. Devuelve null si no queda ninguna palabra.
 */
export function consultaFtsComprension(textoLibre: string): string | null {
  const palabras = textoLibre.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  const unicas = [...new Set(palabras.filter((p) => p.length > 1).map((p) => p.toLowerCase()))].slice(0, 32);
  return unicas.length ? unicas.map((p) => `"${p}"`).join(' OR ') : null;
}

// ---------------------------------------------------------------------------
// Segmentos
// ---------------------------------------------------------------------------

export async function escribirSegmentos(sql: SQL, segmentos: readonly Segmento[]): Promise<void> {
  for (const s of segmentos) {
    const [t0, t1] = tiempos(s.ancla, s.anclaFin);
    await sql.ejecutar(
      `INSERT OR REPLACE INTO segmentos (id, documento, padre, nivel, orden, tipo, titulo, ancla, ancla_fin, unidad_desde, unidad_hasta, resumen, origen, confianza, t0, t1)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.documento, s.padre, s.nivel, s.orden, s.tipo, s.titulo, json(s.ancla), s.anclaFin ? json(s.anclaFin) : null,
      s.unidadDesde, s.unidadHasta, opcional(s.resumen), s.origen, s.confianza, t0, t1,
    );
  }
}

function filaASegmento(f: Fila): Segmento {
  const s: Segmento = {
    id: texto(f.id), documento: texto(f.documento), padre: f.padre === null || f.padre === undefined ? null : texto(f.padre),
    nivel: numero(f.nivel), orden: numero(f.orden), tipo: texto(f.tipo) as TipoSegmento, titulo: texto(f.titulo),
    ancla: deJson<AnclaMaterial>(f.ancla, { tipo: 'imagen' }), unidadDesde: texto(f.unidad_desde), unidadHasta: texto(f.unidad_hasta),
    origen: texto(f.origen) as Segmento['origen'], confianza: numero(f.confianza),
  };
  if (f.ancla_fin) s.anclaFin = deJson<AnclaMaterial>(f.ancla_fin, s.ancla);
  if (f.resumen) s.resumen = texto(f.resumen);
  return s;
}

export async function leerSegmentos(sql: SQL, documento: string, filtro: { tipo?: TipoSegmento; nivelMaximo?: number } = {}): Promise<Segmento[]> {
  const condiciones = ['documento = ?'];
  const p: ValorSQL[] = [documento];
  if (filtro.tipo) { condiciones.push('tipo = ?'); p.push(filtro.tipo); }
  if (filtro.nivelMaximo !== undefined) { condiciones.push('nivel <= ?'); p.push(filtro.nivelMaximo); }
  return (await sql.ejecutar<Fila>(`SELECT * FROM segmentos WHERE ${condiciones.join(' AND ')} ORDER BY orden`, ...p)).map(filaASegmento);
}

export async function leerSegmento(sql: SQL, id: string): Promise<Segmento | null> {
  const [f] = await sql.ejecutar<Fila>('SELECT * FROM segmentos WHERE id = ?', id);
  return f ? filaASegmento(f) : null;
}

/** Segmentos que tocan un tramo de tiempo (audio y vídeo). */
export async function segmentosEnTiempo(sql: SQL, documento: string, t0: number, t1: number): Promise<Segmento[]> {
  return (await sql.ejecutar<Fila>('SELECT * FROM segmentos WHERE documento = ? AND t0 < ? AND t1 > ? ORDER BY orden', documento, t1, t0)).map(filaASegmento);
}

export async function borrarSegmentos(sql: SQL, documento: string): Promise<void> {
  await sql.ejecutar('DELETE FROM segmentos WHERE documento = ?', documento);
}

// ---------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------

export async function escribirFichas(sql: SQL, fichas: readonly Ficha[]): Promise<void> {
  for (const f of fichas) {
    await sql.ejecutar(
      `INSERT INTO fichas (id, documento, objetivo, objetivo_id, lente, clase, idioma, texto, datos, evidencias, modelo, version, creada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET documento = excluded.documento, objetivo = excluded.objetivo, objetivo_id = excluded.objetivo_id,
         lente = excluded.lente, clase = excluded.clase, idioma = excluded.idioma, texto = excluded.texto, datos = excluded.datos,
         evidencias = excluded.evidencias, modelo = excluded.modelo, version = excluded.version, creada = excluded.creada`,
      f.id, f.documento, f.objetivo, f.objetivoId, f.lente, f.clase, f.idioma, f.texto, json(f.datos), json(f.evidencias), f.modelo, f.version, f.creada,
    );
  }
}

function filaAFicha(f: Fila): Ficha {
  return {
    id: texto(f.id), documento: f.documento === null || f.documento === undefined ? null : texto(f.documento),
    objetivo: texto(f.objetivo) as ObjetivoFicha, objetivoId: texto(f.objetivo_id), lente: texto(f.lente) as Lente, clase: texto(f.clase),
    idioma: texto(f.idioma), texto: texto(f.texto), datos: deJson<Record<string, unknown>>(f.datos, {}),
    evidencias: deJson<Evidencia[]>(f.evidencias, []), modelo: texto(f.modelo), version: texto(f.version), creada: texto(f.creada),
  };
}

export interface FiltroFichas {
  documento?: string;
  objetivo?: ObjetivoFicha;
  objetivoId?: string;
  clase?: string;
  lente?: Lente;
}

export async function leerFichas(sql: SQL, filtro: FiltroFichas = {}): Promise<Ficha[]> {
  const condiciones: string[] = [];
  const p: ValorSQL[] = [];
  if (filtro.documento !== undefined) { condiciones.push('documento = ?'); p.push(filtro.documento); }
  if (filtro.objetivo) { condiciones.push('objetivo = ?'); p.push(filtro.objetivo); }
  if (filtro.objetivoId) { condiciones.push('objetivo_id = ?'); p.push(filtro.objetivoId); }
  if (filtro.clase) { condiciones.push('clase = ?'); p.push(filtro.clase); }
  if (filtro.lente) { condiciones.push('lente = ?'); p.push(filtro.lente); }
  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return (await sql.ejecutar<Fila>(`SELECT * FROM fichas ${donde} ORDER BY n`, ...p)).map(filaAFicha);
}

export async function leerFichasPorId(sql: SQL, ids: readonly string[]): Promise<Ficha[]> {
  if (!ids.length) return [];
  const l = enLista([...ids]);
  return (await sql.ejecutar<Fila>(`SELECT * FROM fichas WHERE id IN ${l.sql}`, l.param)).map(filaAFicha);
}

/** Búsqueda léxica (BM25) en las fichas. */
export async function buscarFichas(sql: SQL, consulta: string, opciones: { documentos?: string[]; limite?: number } = {}): Promise<Array<Ficha & { puntuacion: number }>> {
  const q = consultaFtsComprension(consulta);
  if (!q) return [];
  const p: ValorSQL[] = [q];
  let filtro = '';
  if (opciones.documentos?.length) { const l = enLista(opciones.documentos); filtro = ` AND f.documento IN ${l.sql}`; p.push(l.param); }
  p.push(opciones.limite ?? 20);
  const filas = await sql.ejecutar<Fila>(
    `SELECT f.*, bm25(fichas_fts) AS rango FROM fichas_fts JOIN fichas f ON f.n = fichas_fts.rowid
     WHERE fichas_fts MATCH ?${filtro} ORDER BY rango LIMIT ?`, ...p,
  );
  return filas.map((f) => ({ ...filaAFicha(f), puntuacion: -numero(f.rango) }));
}

/** Borra las fichas de un documento (todas, o las de otra versión del prompt) con sus vectores. */
export async function borrarFichas(sql: SQL, documento: string, opciones: { salvoVersion?: string } = {}): Promise<string[]> {
  const filas = opciones.salvoVersion
    ? await sql.ejecutar<{ id: string }>('SELECT id FROM fichas WHERE documento = ? AND version <> ?', documento, opciones.salvoVersion)
    : await sql.ejecutar<{ id: string }>('SELECT id FROM fichas WHERE documento = ?', documento);
  const ids = filas.map((f) => texto(f.id));
  for (let i = 0; i < ids.length; i += 500) {
    const l = enLista(ids.slice(i, i + 500));
    await sql.ejecutar(`DELETE FROM fichas WHERE id IN ${l.sql}`, l.param);
    await sql.ejecutar(`DELETE FROM vectores WHERE objetivo = 'ficha' AND id IN ${l.sql}`, l.param);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Apariciones
// ---------------------------------------------------------------------------

export async function escribirApariciones(sql: SQL, apariciones: readonly Aparicion[]): Promise<void> {
  for (const m of apariciones) {
    const [t0] = tiempos(m.ancla, m.anclaFin);
    const fisica = m.ancla.tipo === 'pagina' ? m.ancla.fisica : null;
    await sql.ejecutar(
      `INSERT OR REPLACE INTO apariciones (id, entidad, documento, segmento, ancla, ancla_fin, forma, rol, confianza, t0, fisica)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.id, m.entidad, m.documento, opcional(m.segmento), json(m.ancla), m.anclaFin ? json(m.anclaFin) : null, m.forma, m.rol, m.confianza, t0, fisica,
    );
  }
}

function filaAAparicion(f: Fila): Aparicion {
  const m: Aparicion = {
    id: texto(f.id), entidad: texto(f.entidad), documento: texto(f.documento), ancla: deJson<AnclaMaterial>(f.ancla, { tipo: 'imagen' }),
    forma: texto(f.forma), rol: texto(f.rol) as RolAparicion, confianza: numero(f.confianza),
  };
  if (f.segmento) m.segmento = texto(f.segmento);
  if (f.ancla_fin) m.anclaFin = deJson<AnclaMaterial>(f.ancla_fin, m.ancla);
  return m;
}

export async function leerApariciones(sql: SQL, filtro: { entidad?: string; documento?: string; segmento?: string; limite?: number }): Promise<Aparicion[]> {
  const condiciones: string[] = [];
  const p: ValorSQL[] = [];
  if (filtro.entidad) { condiciones.push('entidad = ?'); p.push(filtro.entidad); }
  if (filtro.documento) { condiciones.push('documento = ?'); p.push(filtro.documento); }
  if (filtro.segmento) { condiciones.push('segmento = ?'); p.push(filtro.segmento); }
  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  p.push(filtro.limite ?? 5000);
  return (await sql.ejecutar<Fila>(`SELECT * FROM apariciones ${donde} ORDER BY documento, coalesce(fisica, 0), coalesce(t0, 0) LIMIT ?`, ...p)).map(filaAAparicion);
}

/** Apariciones en un tramo de tiempo (quién está en pantalla o se oye entre t0 y t1). */
export async function aparicionesEnTiempo(sql: SQL, documento: string, t0: number, t1: number): Promise<Aparicion[]> {
  return (await sql.ejecutar<Fila>('SELECT * FROM apariciones WHERE documento = ? AND t0 >= ? AND t0 < ? ORDER BY t0', documento, t0, t1)).map(filaAAparicion);
}

export async function borrarApariciones(sql: SQL, documento: string): Promise<void> {
  await sql.ejecutar('DELETE FROM apariciones WHERE documento = ?', documento);
}

// ---------------------------------------------------------------------------
// Relaciones y alineaciones
// ---------------------------------------------------------------------------

export async function escribirRelaciones(sql: SQL, relaciones: readonly Relacion[]): Promise<void> {
  for (const r of relaciones) {
    await sql.ejecutar(
      `INSERT OR REPLACE INTO relaciones (id, origen, destino, tipo, nota, evidencias, confianza, fuente, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.origen, r.destino, r.tipo, opcional(r.nota), json(r.evidencias), r.confianza, r.fuente, r.creada,
    );
  }
}

function filaARelacion(f: Fila): Relacion {
  const r: Relacion = {
    id: texto(f.id), origen: texto(f.origen), destino: texto(f.destino), tipo: texto(f.tipo) as TipoRelacion,
    evidencias: deJson<Evidencia[]>(f.evidencias, []), confianza: numero(f.confianza), fuente: texto(f.fuente) as Relacion['fuente'], creada: texto(f.creada),
  };
  if (f.nota) r.nota = texto(f.nota);
  return r;
}

/** Relaciones en que participa un documento, en cualquiera de los dos lados. */
export async function leerRelaciones(sql: SQL, quien?: string): Promise<Relacion[]> {
  const filas = quien
    ? await sql.ejecutar<Fila>('SELECT * FROM relaciones WHERE origen = ? OR destino = ? ORDER BY creada', quien, quien)
    : await sql.ejecutar<Fila>('SELECT * FROM relaciones ORDER BY creada');
  return filas.map(filaARelacion);
}

export async function borrarRelacion(sql: SQL, id: string): Promise<void> {
  await sql.ejecutar('DELETE FROM alineaciones WHERE relacion = ?', id);
  await sql.ejecutar('DELETE FROM relaciones WHERE id = ?', id);
}

export async function escribirAlineaciones(sql: SQL, alineaciones: readonly Alineacion[]): Promise<void> {
  for (const a of alineaciones) {
    await sql.ejecutar(
      `INSERT OR REPLACE INTO alineaciones (id, relacion, orden, tipo, doc_a, ancla_a, ancla_fin_a, segmento_a, doc_b, ancla_b, ancla_fin_b, segmento_b, nota, confianza)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id, a.relacion, a.orden, a.tipo,
      a.a?.documento ?? null, a.a ? json(a.a.ancla) : null, a.a?.anclaFin ? json(a.a.anclaFin) : null, a.a?.segmento ?? null,
      a.b?.documento ?? null, a.b ? json(a.b.ancla) : null, a.b?.anclaFin ? json(a.b.anclaFin) : null, a.b?.segmento ?? null,
      a.nota, a.confianza,
    );
  }
}

function lado(doc: ValorSQL | undefined, ancla: ValorSQL | undefined, fin: ValorSQL | undefined, segmento: ValorSQL | undefined): LadoAlineacion | undefined {
  if (!doc || !ancla) return undefined;
  const l: LadoAlineacion = { documento: texto(doc), ancla: deJson<AnclaMaterial>(ancla, { tipo: 'imagen' }) };
  if (fin) l.anclaFin = deJson<AnclaMaterial>(fin, l.ancla);
  if (segmento) l.segmento = texto(segmento);
  return l;
}

function filaAAlineacion(f: Fila): Alineacion {
  const a: Alineacion = { id: texto(f.id), relacion: texto(f.relacion), orden: numero(f.orden), tipo: texto(f.tipo) as TipoCorrespondencia, nota: texto(f.nota), confianza: numero(f.confianza) };
  const la = lado(f.doc_a, f.ancla_a, f.ancla_fin_a, f.segmento_a);
  const lb = lado(f.doc_b, f.ancla_b, f.ancla_fin_b, f.segmento_b);
  if (la) a.a = la;
  if (lb) a.b = lb;
  return a;
}

export async function leerAlineaciones(sql: SQL, filtro: { relacion?: string; documento?: string; segmento?: string }): Promise<Alineacion[]> {
  if (filtro.relacion) return (await sql.ejecutar<Fila>('SELECT * FROM alineaciones WHERE relacion = ? ORDER BY orden', filtro.relacion)).map(filaAAlineacion);
  if (filtro.segmento) return (await sql.ejecutar<Fila>('SELECT * FROM alineaciones WHERE segmento_a = ? OR segmento_b = ? ORDER BY relacion, orden', filtro.segmento, filtro.segmento)).map(filaAAlineacion);
  if (filtro.documento) return (await sql.ejecutar<Fila>('SELECT * FROM alineaciones WHERE doc_a = ? OR doc_b = ? ORDER BY relacion, orden', filtro.documento, filtro.documento)).map(filaAAlineacion);
  return [];
}

// ---------------------------------------------------------------------------
// Limpieza por documento
// ---------------------------------------------------------------------------

/**
 * Quita la comprensión de un documento (para rehacerla): segmentos, fichas con sus vectores,
 * apariciones y las alineaciones en que interviene. Las relaciones y las entidades se quedan:
 * son de la biblioteca.
 */
export async function borrarComprension(sql: SQL, documento: string): Promise<{ fichas: string[] }> {
  const fichas = await borrarFichas(sql, documento);
  await borrarSegmentos(sql, documento);
  await borrarApariciones(sql, documento);
  await sql.ejecutar('DELETE FROM alineaciones WHERE doc_a = ? OR doc_b = ?', documento, documento);
  return { fichas };
}
