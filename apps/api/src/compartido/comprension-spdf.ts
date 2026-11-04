/**
 * La capa de comprensión fuera de la estantería (docs/COMPRENSION.md, «SPDF»).
 *
 * - **SPDF 4.2 interno** (el .spdf de Scholaris, copias entre bibliotecas): las mismas
 *   tablas que la estantería (`segmentos`, `fichas`, `apariciones`, `relaciones`,
 *   `alineaciones` y los vectores de las fichas) más `comprension_entidades`, las
 *   entidades del grafo que aparecen en el documento (en un .spdf no está el grafo).
 * - **SPDF 5.0** (el estándar abierto): la extensión opcional `x_scholaris_comprension`
 *   (fila en `extensions` con `required = 0`): tablas `x_scholaris_segments`,
 *   `x_scholaris_cards`, `x_scholaris_entities`, `x_scholaris_appearances`,
 *   `x_scholaris_relations`, `x_scholaris_alignments` y `x_scholaris_vectors`, con
 *   nombres y valores en inglés y anclas 5.0 (§3). Sin índice FTS: la especificación
 *   prohíbe tablas virtuales fuera de `fragments_fts` (§2.1), así que el lector lo
 *   rehace al importar (`fichas_fts` se llena solo con sus disparadores).
 *
 * En los dos casos, los otros documentos se nombran por su `sha256-<hex>` (el
 * `docref` de las URI de ancla, §5): un id interno no significa nada fuera de la
 * estantería. Al importar, cada `docref` se busca por su huella; lo que no está en la
 * estantería se deja fuera con un aviso.
 */
import type {
  Alineacion, AnclaMaterial, Aparicion, EspacioVectorial, Evidencia, Ficha, LadoAlineacion, Relacion, Segmento, SQL, ValorSQL,
} from '@scholaris/nucleo';
import { enLista } from '@scholaris/nucleo';
import type { TipoEntidad } from '@scholaris/contrato';
import {
  escribirAlineaciones, escribirApariciones, escribirEspacio, escribirFichas, escribirRelaciones, escribirSegmentos, escribirVectores,
  leerAlineaciones, leerApariciones, leerEspacios, leerFichas, leerFichasPorId, leerRelaciones, leerSegmentos, leerVectores, type VectorSpdf,
} from '@scholaris/spdf';
import { esTipoEntidad, obtenerEntidad } from '@scholaris/funciones';
import { decodeVector, mapLegacyAnchor, type Anchor, type SpdfDocument, type SpdfWriter, type SqlRow, type SqlValue } from 'spdf-format/core';
import { anclaDe50 } from './spdf50.js';

/** Nombre y versión de la extensión en `extensions` (SPDF 5.0 §11). */
export const EXTENSION_COMPRENSION = 'x_scholaris_comprension';
export const VERSION_EXTENSION_COMPRENSION = '1.0';

/**
 * Las tablas de la extensión. Mismas columnas que las del perfil `understanding`
 * propuesto para SPDF 5.1 (RFC 0004 del repositorio de SPDF), con el prefijo del
 * fabricante: pasar de una a otra es renombrar tablas.
 */
export const ESQUEMA_EXTENSION_COMPRENSION = `
CREATE TABLE x_scholaris_segments (
  id TEXT PRIMARY KEY, document TEXT NOT NULL, parent TEXT, level INTEGER NOT NULL, ord INTEGER NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, anchor TEXT NOT NULL, anchor_end TEXT, unit_from TEXT NOT NULL,
  unit_to TEXT NOT NULL, summary TEXT, origin TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, t0 REAL, t1 REAL);
CREATE INDEX x_scholaris_segments_ord ON x_scholaris_segments(document, ord);
CREATE TABLE x_scholaris_cards (
  n INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT, target TEXT NOT NULL, target_id TEXT NOT NULL,
  lens TEXT NOT NULL, class TEXT NOT NULL, language TEXT, text TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL DEFAULT '[]', model TEXT NOT NULL, version TEXT NOT NULL, created TEXT NOT NULL);
CREATE INDEX x_scholaris_cards_target ON x_scholaris_cards(target, target_id);
CREATE TABLE x_scholaris_entities (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
  wikidata TEXT, description TEXT, fictional INTEGER);
CREATE TABLE x_scholaris_appearances (
  id TEXT PRIMARY KEY, entity TEXT NOT NULL, document TEXT NOT NULL, segment TEXT, anchor TEXT NOT NULL,
  anchor_end TEXT, form TEXT NOT NULL, role TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, t0 REAL, physical INTEGER);
CREATE INDEX x_scholaris_appearances_entity ON x_scholaris_appearances(entity);
CREATE TABLE x_scholaris_relations (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, note TEXT,
  evidence TEXT NOT NULL DEFAULT '[]', confidence REAL NOT NULL DEFAULT 1, origin TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE x_scholaris_alignments (
  id TEXT PRIMARY KEY, relation TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL,
  doc_a TEXT, anchor_a TEXT, anchor_end_a TEXT, segment_a TEXT, doc_b TEXT, anchor_b TEXT, anchor_end_b TEXT, segment_b TEXT,
  note TEXT NOT NULL DEFAULT '', confidence REAL NOT NULL DEFAULT 1);
CREATE INDEX x_scholaris_alignments_relation ON x_scholaris_alignments(relation, ord);
CREATE TABLE x_scholaris_vectors (
  target TEXT NOT NULL, id TEXT NOT NULL, space TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (target, id, space));
`;

/** Las entidades del grafo en un .spdf 4.2 (el grafo de la biblioteca no viaja). */
const ESQUEMA_ENTIDADES_ARCHIVO = `CREATE TABLE IF NOT EXISTS comprension_entidades (
  id TEXT PRIMARY KEY, tipo TEXT NOT NULL, nombre TEXT NOT NULL, alias TEXT NOT NULL DEFAULT '[]',
  wikidata TEXT, descripcion TEXT, ficticia INTEGER)`;

// ---------------------------------------------------------------------------
// La capa en memoria
// ---------------------------------------------------------------------------

/** Una entidad del grafo, sin lo que solo vale dentro de una biblioteca (recuentos, fusiones, claves). */
export interface EntidadPortatil {
  id: string;
  tipo: TipoEntidad;
  nombre: string;
  alias: string[];
  wikidata: string | null;
  descripcion: string | null;
  ficticia: boolean | null;
}

/**
 * La comprensión de un documento, lista para viajar. `documento` es su id; cualquier
 * otro documento va por su `docref` (`sha256-<hex>`, o su id si no tiene huella).
 */
export interface CapaComprension {
  documento: string;
  segmentos: Segmento[];
  fichas: Ficha[];
  apariciones: Aparicion[];
  relaciones: Relacion[];
  alineaciones: Alineacion[];
  entidades: EntidadPortatil[];
  espacios: EspacioVectorial[];
  /** Vectores de las fichas (los de las entidades no se guardan por documento). */
  vectores: Array<{ ficha: string; espacio: string; valores: Float32Array }>;
}

export function capaVacia(c: CapaComprension): boolean {
  return !c.segmentos.length && !c.fichas.length && !c.apariciones.length && !c.relaciones.length && !c.alineaciones.length;
}

const DOCREF = /^sha256-[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

type Fila = Record<string, ValorSQL>;
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const numero = (v: unknown, defecto = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v ?? Number.NaN);
  return Number.isFinite(n) ? n : defecto;
};
const deJson = <T>(v: unknown, defecto: T): T => {
  if (v === null || v === undefined || v === '') return defecto;
  try { return JSON.parse(String(v)) as T; } catch { return defecto; }
};

async function tablas(sql: SQL): Promise<Set<string>> {
  return new Set((await sql.ejecutar<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((f) => String(f.name)));
}

// ---------------------------------------------------------------------------
// Leer la capa de una base con el esquema 4.2 (la estantería o un .spdf)
// ---------------------------------------------------------------------------

export interface OpcionesLeerCapa {
  /** De dónde salen las entidades: el grafo de @scholaris/funciones o `comprension_entidades` de un .spdf. */
  entidades: 'grafo' | 'archivo';
  /** Con los vectores de las fichas (por defecto sí). */
  vectores?: boolean;
}

/**
 * La comprensión de un documento: sus segmentos, sus fichas (y las de la biblioteca
 * sobre sus relaciones), sus apariciones, las relaciones en que participa con sus
 * alineaciones y las entidades que aparecen. Devuelve null si la base no tiene la capa
 * (un SPDF 4.0 o 4.1).
 */
export async function leerCapaComprension(sql: SQL, documento: string, o: OpcionesLeerCapa): Promise<CapaComprension | null> {
  const hay = await tablas(sql);
  if (!['segmentos', 'fichas', 'apariciones', 'relaciones', 'alineaciones'].every((t) => hay.has(t))) return null;
  const huellas = new Map<string, string>();
  const ref = async (id: string): Promise<string> => {
    if (!id || id === documento || DOCREF.test(id) || id.startsWith('ent:')) return id;
    if (!huellas.has(id)) {
      const [f] = await sql.ejecutar<{ huella: string | null }>('SELECT huella FROM documentos WHERE id = ?', id);
      const h = texto(f?.huella).trim().toLowerCase();
      huellas.set(id, HEX64.test(h) ? `sha256-${h}` : id);
    }
    return huellas.get(id)!;
  };
  const evidencias = async (es: Evidencia[]): Promise<Evidencia[]> => Promise.all(es.map(async (e) => ({ ...e, documento: await ref(e.documento) })));

  const segmentos = await leerSegmentos(sql, documento);
  const relaciones0 = await leerRelaciones(sql, documento);
  const relaciones: Relacion[] = [];
  for (const r of relaciones0) relaciones.push({ ...r, origen: await ref(r.origen), destino: await ref(r.destino), evidencias: await evidencias(r.evidencias) });
  const alineaciones: Alineacion[] = [];
  const lado = async (l?: LadoAlineacion): Promise<LadoAlineacion | undefined> => (l ? { ...l, documento: await ref(l.documento) } : undefined);
  for (const r of relaciones0) {
    for (const a of await leerAlineaciones(sql, { relacion: r.id })) {
      const x: Alineacion = { ...a };
      delete x.a; delete x.b;
      const la = await lado(a.a);
      const lb = await lado(a.b);
      if (la) x.a = la;
      if (lb) x.b = lb;
      alineaciones.push(x);
    }
  }
  // Las fichas del documento y las de la biblioteca sobre sus relaciones.
  const propias = await leerFichas(sql, { documento });
  const deRelaciones = relaciones0.length
    ? (await sql.ejecutar<{ id: string }>(
      `SELECT id FROM fichas WHERE documento IS NULL AND objetivo = 'relacion' AND objetivo_id IN ${enLista(relaciones0.map((r) => r.id)).sql}`,
      enLista(relaciones0.map((r) => r.id)).param,
    )).map((f) => String(f.id))
    : [];
  const fichas: Ficha[] = [];
  for (const f of [...propias, ...(deRelaciones.length ? await leerFichasPorId(sql, deRelaciones) : [])]) {
    fichas.push({ ...f, evidencias: await evidencias(f.evidencias), ...(f.objetivo === 'documento' ? { objetivoId: await ref(f.objetivoId) } : {}) });
  }
  // Por id: el orden material tiene empates (varias apariciones en el mismo segundo) y el fichero ha de salir igual siempre.
  const apariciones = (await leerApariciones(sql, { documento, limite: 1_000_000 })).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  // Entidades: las de las apariciones, las de las fichas de entidad y las de relaciones entre entidades.
  const ids = new Set<string>();
  for (const m of apariciones) ids.add(m.entidad);
  for (const f of fichas) if (f.objetivo === 'entidad') ids.add(f.objetivoId);
  for (const r of relaciones) for (const x of [r.origen, r.destino]) if (x.startsWith('ent:')) ids.add(x.slice(4));
  const { entidades, activa } = o.entidades === 'grafo' && hay.has('entidades')
    ? await entidadesDelGrafo(sql, [...ids])
    : o.entidades === 'archivo' && hay.has('comprension_entidades')
      ? await entidadesDelArchivo(sql, [...ids])
      : { entidades: [], activa: new Map<string, string>() };
  const ent = (id: string) => activa.get(id) ?? id;
  for (const m of apariciones) m.entidad = ent(m.entidad);
  for (const f of fichas) if (f.objetivo === 'entidad') f.objetivoId = ent(f.objetivoId);
  for (const r of relaciones) {
    if (r.origen.startsWith('ent:')) r.origen = `ent:${ent(r.origen.slice(4))}`;
    if (r.destino.startsWith('ent:')) r.destino = `ent:${ent(r.destino.slice(4))}`;
  }

  let espacios: EspacioVectorial[] = [];
  const vectores: CapaComprension['vectores'] = [];
  if (o.vectores !== false && fichas.length) {
    const deFichas = new Set(fichas.map((f) => f.id));
    const usados = new Set((await sql.ejecutar<{ espacio: string }>("SELECT DISTINCT espacio FROM vectores WHERE documento = ? AND objetivo = 'ficha'", documento)).map((f) => String(f.espacio)));
    espacios = (await leerEspacios(sql)).filter((e) => usados.has(e.id));
    for (const e of espacios) {
      for (const v of await leerVectores(sql, { espacio: e.id, documento, objetivo: 'ficha' })) {
        if (deFichas.has(v.id)) vectores.push({ ficha: v.id, espacio: e.id, valores: v.valores });
      }
    }
  }
  return { documento, segmentos, fichas, apariciones, relaciones, alineaciones, entidades, espacios, vectores };
}

interface FilaEntidadGrafo {
  id: string; tipo: string; nombre: string; alias: string | null; wikidata: string | null; descripcion: string | null;
  ficticia: number | null; fusionada_en: string | null;
}

function aPortatil(f: { id: unknown; tipo: unknown; nombre: unknown; alias: unknown; wikidata: unknown; descripcion: unknown; ficticia: unknown }): EntidadPortatil | null {
  const tipo = texto(f.tipo);
  if (!esTipoEntidad(tipo) || !texto(f.nombre)) return null;
  const alias = deJson<unknown[]>(f.alias, []).filter((a): a is string => typeof a === 'string');
  return {
    id: texto(f.id), tipo, nombre: texto(f.nombre), alias,
    wikidata: f.wikidata ? texto(f.wikidata) : null, descripcion: f.descripcion ? texto(f.descripcion) : null,
    ficticia: f.ficticia === null || f.ficticia === undefined ? null : numero(f.ficticia) === 1,
  };
}

/** Las entidades activas del grafo detrás de unos ids (siguiendo las fusiones). */
async function entidadesDelGrafo(sql: SQL, ids: string[]): Promise<{ entidades: EntidadPortatil[]; activa: Map<string, string> }> {
  const activa = new Map<string, string>();
  const filas = new Map<string, FilaEntidadGrafo>();
  let pendientes = [...new Set(ids)];
  for (let paso = 0; paso < 12 && pendientes.length; paso++) {
    const l = enLista(pendientes);
    const leidas = await sql.ejecutar<FilaEntidadGrafo>(`SELECT id, tipo, nombre, alias, wikidata, descripcion, ficticia, fusionada_en FROM entidades WHERE id IN ${l.sql}`, l.param);
    for (const f of leidas) filas.set(String(f.id), f);
    pendientes = leidas.map((f) => f.fusionada_en).filter((x): x is string => !!x && !filas.has(x));
  }
  const final = (id: string): string | null => {
    let actual = id;
    for (let i = 0; i < 12; i++) {
      const f = filas.get(actual);
      if (!f) return null;
      if (!f.fusionada_en) return actual;
      actual = f.fusionada_en;
    }
    return null;
  };
  const entidades = new Map<string, EntidadPortatil>();
  for (const id of ids) {
    const a = final(id);
    if (!a) continue;
    activa.set(id, a);
    if (!entidades.has(a)) {
      const p = aPortatil(filas.get(a)!);
      if (p) entidades.set(a, p);
    }
  }
  return { entidades: [...entidades.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)), activa };
}

async function entidadesDelArchivo(sql: SQL, ids: string[]): Promise<{ entidades: EntidadPortatil[]; activa: Map<string, string> }> {
  if (!ids.length) return { entidades: [], activa: new Map() };
  const l = enLista(ids);
  const filas = await sql.ejecutar<Fila>(`SELECT * FROM comprension_entidades WHERE id IN ${l.sql} ORDER BY id`, l.param);
  return { entidades: filas.map((f) => aPortatil(f as never)).filter((e): e is EntidadPortatil => !!e), activa: new Map() };
}

// ---------------------------------------------------------------------------
// Escribir la capa en un .spdf 4.2 (o en el 4.1 en memoria de una importación 5.0)
// ---------------------------------------------------------------------------

export async function escribirCapaEnArchivo(sql: SQL, c: CapaComprension): Promise<void> {
  await sql.transaccion(async (tx) => {
    await escribirSegmentos(tx, c.segmentos);
    await escribirFichas(tx, c.fichas);
    await escribirApariciones(tx, c.apariciones);
    await escribirRelaciones(tx, c.relaciones);
    await escribirAlineaciones(tx, c.alineaciones);
    if (c.entidades.length) {
      await tx.ejecutar(ESQUEMA_ENTIDADES_ARCHIVO);
      for (const e of c.entidades) {
        await tx.ejecutar(
          'INSERT OR REPLACE INTO comprension_entidades (id, tipo, nombre, alias, wikidata, descripcion, ficticia) VALUES (?, ?, ?, ?, ?, ?, ?)',
          e.id, e.tipo, e.nombre, JSON.stringify(e.alias), e.wikidata, e.descripcion, e.ficticia === null ? null : e.ficticia ? 1 : 0,
        );
      }
    }
  });
  if (c.vectores.length) {
    for (const e of c.espacios) await escribirEspacio(sql, e);
    const conocidos = new Set(c.espacios.map((e) => e.id));
    const vs: VectorSpdf[] = c.vectores.filter((v) => conocidos.has(v.espacio)).map((v) => ({ objetivo: 'ficha', id: v.ficha, espacio: v.espacio, documento: c.documento, valores: v.valores }));
    for (let i = 0; i < vs.length; i += 500) await sql.transaccion((tx) => escribirVectores(tx, vs.slice(i, i + 500)));
  }
}

// ---------------------------------------------------------------------------
// Vocabularios: los valores internos (en español) y los de la extensión (en inglés)
// ---------------------------------------------------------------------------

function vocabulario(pares: Record<string, string>): { a: (v: string) => string; de: (v: string) => string } {
  const inverso = Object.fromEntries(Object.entries(pares).map(([k, v]) => [v, k]));
  return { a: (v) => pares[v] ?? v, de: (v) => inverso[v] ?? v };
}

const TIPO_SEGMENTO = vocabulario({
  obra: 'work', parte: 'part', capitulo: 'chapter', apartado: 'section', secuencia: 'sequence', escena: 'scene', plano: 'shot',
  acto: 'act', cuadro: 'tableau', poema: 'poem', estrofa: 'stanza', tema: 'topic', bloque: 'block', intervencion: 'turn',
  diapositiva: 'slide', tabla: 'table', folio: 'folio', articulo: 'article', otro: 'other',
});
const ORIGEN_SEGMENTO = vocabulario({ leido: 'read', deducido: 'inferred', modelo: 'model' });
const LENTE = vocabulario({
  narrativa: 'narrative', poesia: 'poetry', teatro: 'drama', cine: 'film', documental: 'documentary', periodismo: 'journalism',
  entrevista: 'interview', podcast: 'podcast', clase: 'lecture', ensayo: 'essay', cientifico: 'scientific', archivo: 'archival',
  juridico: 'legal', datos: 'data', presentacion: 'presentation', general: 'general',
});
/** Clases de ficha: las de los segmentos y unas cuantas propias; las demás pasan tal cual. */
const CLASE_FICHA = vocabulario({
  global: 'global', capitulo: 'chapter', apartado: 'section', secuencia: 'sequence', escena: 'scene', plano: 'shot', acto: 'act',
  cuadro: 'tableau', poema: 'poem', estrofa: 'stanza', personaje: 'character', argumento: 'argument', persona: 'person',
  obra: 'work', lugar: 'place', organizacion: 'organization', concepto: 'concept', evento: 'event', fecha: 'date', relacion: 'relation',
});
const OBJETIVO_FICHA = vocabulario({ documento: 'document', segmento: 'segment', entidad: 'entity', figura: 'figure', relacion: 'relation' });
const MODO = vocabulario({ texto: 'text', imagen: 'image', video: 'video', audio: 'audio', dato: 'data' });
const TIPO_ENTIDAD = vocabulario({ persona: 'person', obra: 'work', lugar: 'place', organizacion: 'organization', concepto: 'concept', evento: 'event', fecha: 'date' });
const ROL = vocabulario({
  nombrado: 'named', aludido: 'alluded', presente: 'present', habla: 'speaks', visible: 'visible', audible: 'audible', citado: 'quoted',
  definido: 'defined', otro: 'other',
});
const TIPO_RELACION = vocabulario({
  adaptacion_de: 'adaptation_of', traduccion_de: 'translation_of', edicion_de: 'edition_of', version_de: 'version_of', cita_a: 'cites',
  comenta_a: 'comments_on', responde_a: 'responds_to', parte_de: 'part_of', misma_obra: 'same_work', relacionado: 'related',
});
const FUENTE_RELACION = vocabulario({ metadatos: 'metadata', wikidata: 'wikidata', modelo: 'model', usuario: 'user' });
const CORRESPONDENCIA = vocabulario({
  equivalente: 'equivalent', traducido: 'translated', condensado: 'condensed', ampliado: 'expanded', transformado: 'transformed',
  reordenado: 'reordered', anadido: 'added', suprimido: 'omitted', alusion: 'allusion',
});

// ---------------------------------------------------------------------------
// Anclas materiales ↔ anclas 5.0
// ---------------------------------------------------------------------------

/**
 * Un ancla material de Scholaris como ancla 5.0 (§3): `caracteres` → `chars`, `region`
 * tal cual, y lo que se ve en un instante de un vídeo como ancla de tiempo de ese
 * instante (`t0 = t1`), que con la región da la URI `t=…&xywh=percent:…` (Media
 * Fragments: la región de ese fotograma). El tramo de donde sale (el plano) queda en el
 * miembro `span`, que los lectores 5.0 conservan sin entenderlo.
 */
export function anclaA50(a: AnclaMaterial): Anchor {
  const { caracteres, instante, ...resto } = a as AnclaMaterial & Record<string, unknown>;
  const foliacion = (resto as Record<string, unknown>).foliacion;
  delete (resto as Record<string, unknown>).foliacion;
  const x = mapLegacyAnchor(resto) as Anchor & Record<string, unknown>;
  if (typeof foliacion === 'string') x.foliation = foliacion;
  if (Array.isArray(caracteres) && caracteres.length === 2) x.chars = [caracteres[0], caracteres[1]];
  if (typeof instante === 'number' && Number.isFinite(instante)) {
    if (x.type === 'time') {
      x.span = [x.t0, x.t1];
      x.t0 = instante;
      x.t1 = instante;
    } else {
      x.instant = instante;
    }
  }
  return x;
}

/** El camino de vuelta de `anclaA50`. */
export function anclaDe50Material(a: Anchor): AnclaMaterial {
  const { chars, span, instant, ...resto } = a as Anchor & Record<string, unknown>;
  const x = anclaDe50(resto as unknown as Anchor) as AnclaMaterial & Record<string, unknown>;
  if (Array.isArray(chars) && chars.length === 2 && chars.every((n) => Number.isInteger(n))) x.caracteres = [chars[0] as number, chars[1] as number];
  if (x.tipo === 'tiempo' && Array.isArray(span) && span.length === 2 && span.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    x.instante = x.t0;
    x.t0 = span[0] as number;
    x.t1 = span[1] as number;
  } else if (typeof instant === 'number' && Number.isFinite(instant)) {
    x.instante = instant;
  }
  return x;
}

const anclaJson = (a: AnclaMaterial | undefined | null): string | null => (a ? JSON.stringify(anclaA50(a)) : null);

function anclaLeida(v: SqlValue | undefined): AnclaMaterial | null {
  const a = deJson<unknown>(v, null);
  if (!a || typeof a !== 'object' || Array.isArray(a) || typeof (a as { type?: unknown }).type !== 'string') return null;
  return anclaDe50Material(a as Anchor);
}

// ---------------------------------------------------------------------------
// SPDF 5.0: escribir la extensión
// ---------------------------------------------------------------------------

export interface OpcionesExtension {
  /** El `docref` del documento del fichero (`sha256-<hex>` de su original, o su id). */
  docref: string;
  /** Espacios ya registrados en `spaces`: los vectores de otros espacios no se escriben. */
  espacios: ReadonlySet<string>;
}

/** Evidencias en la forma de la extensión: `doc` es un docref y el ancla, 5.0. */
function evidenciasA50(es: readonly Evidencia[], aDocref: (id: string) => string): string {
  return JSON.stringify(es.map((e) => {
    const x: Record<string, unknown> = { doc: aDocref(e.documento), anchor: anclaA50(e.ancla), mode: MODO.a(e.modo) };
    if (e.anclaFin) x.anchor_end = anclaA50(e.anclaFin);
    if (e.cita !== undefined) x.quote = e.cita;
    if (e.unidad) x.unit = e.unidad;
    if (e.fragmento) x.fragment = e.fragmento;
    if (e.figura) x.figure = e.figura;
    return x;
  }));
}

/**
 * Escribe la comprensión como extensión opcional de un SPDF 5.0 que se está armando.
 * No escribe nada (ni la fila de `extensions`) si la capa está vacía. Devuelve cuántas
 * filas escribió por tabla.
 */
export async function escribirExtensionComprension(w: SpdfWriter, c: CapaComprension, o: OpcionesExtension): Promise<Record<string, number> | null> {
  if (capaVacia(c)) return null;
  const conn = w.connection;
  const aDocref = (id: string) => (id === c.documento ? o.docref : id);
  const cuentas: Record<string, number> = {};
  const contar = (t: string) => { cuentas[t] = (cuentas[t] ?? 0) + 1; };
  await conn.exec(ESQUEMA_EXTENSION_COMPRENSION);
  for (const s of c.segmentos) {
    await conn.run(
      `INSERT INTO x_scholaris_segments (id, document, parent, level, ord, kind, title, anchor, anchor_end, unit_from, unit_to, summary, origin, confidence, t0, t1)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, c.documento, s.padre, s.nivel, s.orden, TIPO_SEGMENTO.a(s.tipo), s.titulo, anclaJson(s.ancla), anclaJson(s.anclaFin),
        s.unidadDesde, s.unidadHasta, s.resumen ?? null, ORIGEN_SEGMENTO.a(s.origen), s.confianza,
        s.ancla.tipo === 'tiempo' ? s.ancla.t0 : null, s.ancla.tipo === 'tiempo' ? (s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1) : null],
    );
    contar('segments');
  }
  for (const f of c.fichas) {
    await conn.run(
      `INSERT INTO x_scholaris_cards (id, document, target, target_id, lens, class, language, text, data, evidence, model, version, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      // Una ficha del propio documento lo nombra por su id (`documents.id`); la de otro, por su docref.
      [f.id, f.documento, OBJETIVO_FICHA.a(f.objetivo), f.objetivoId,
        LENTE.a(f.lente), CLASE_FICHA.a(f.clase), f.idioma || null, f.texto, JSON.stringify(f.datos ?? {}), evidenciasA50(f.evidencias, aDocref),
        f.modelo, f.version, f.creada],
    );
    contar('cards');
  }
  for (const e of c.entidades) {
    await conn.run(
      'INSERT INTO x_scholaris_entities (id, kind, name, aliases, wikidata, description, fictional) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [e.id, TIPO_ENTIDAD.a(e.tipo), e.nombre, JSON.stringify(e.alias), e.wikidata, e.descripcion, e.ficticia === null ? null : e.ficticia ? 1 : 0],
    );
    contar('entities');
  }
  for (const m of c.apariciones) {
    await conn.run(
      `INSERT INTO x_scholaris_appearances (id, entity, document, segment, anchor, anchor_end, form, role, confidence, t0, physical)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.entidad, c.documento, m.segmento ?? null, anclaJson(m.ancla), anclaJson(m.anclaFin), m.forma, ROL.a(m.rol), m.confianza,
        m.ancla.tipo === 'tiempo' ? (m.ancla.instante ?? m.ancla.t0) : null, m.ancla.tipo === 'pagina' ? m.ancla.fisica : null],
    );
    contar('appearances');
  }
  const refRelacion = (x: string) => (x.startsWith('ent:') ? `entity:${x.slice(4)}` : aDocref(x));
  for (const r of c.relaciones) {
    await conn.run(
      'INSERT INTO x_scholaris_relations (id, source, target, kind, note, evidence, confidence, origin, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [r.id, refRelacion(r.origen), refRelacion(r.destino), TIPO_RELACION.a(r.tipo), r.nota ?? null, evidenciasA50(r.evidencias, aDocref),
        r.confianza, FUENTE_RELACION.a(r.fuente), r.creada],
    );
    contar('relations');
  }
  for (const a of c.alineaciones) {
    await conn.run(
      `INSERT INTO x_scholaris_alignments (id, relation, ord, kind, doc_a, anchor_a, anchor_end_a, segment_a, doc_b, anchor_b, anchor_end_b, segment_b, note, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.relacion, a.orden, CORRESPONDENCIA.a(a.tipo),
        a.a ? aDocref(a.a.documento) : null, anclaJson(a.a?.ancla), anclaJson(a.a?.anclaFin), a.a?.segmento ?? null,
        a.b ? aDocref(a.b.documento) : null, anclaJson(a.b?.ancla), anclaJson(a.b?.anclaFin), a.b?.segmento ?? null,
        a.nota, a.confianza],
    );
    contar('alignments');
  }
  for (const v of c.vectores) {
    if (!o.espacios.has(v.espacio)) continue;
    const datos = new Uint8Array(v.valores.length * 4);
    const dv = new DataView(datos.buffer);
    v.valores.forEach((x, i) => dv.setFloat32(i * 4, x, true));
    await conn.run('INSERT OR REPLACE INTO x_scholaris_vectors (target, id, space, data) VALUES (?, ?, ?, ?)', ['card', v.ficha, v.espacio, datos]);
    contar('vectors');
  }
  await w.addExtension(EXTENSION_COMPRENSION, VERSION_EXTENSION_COMPRENSION, false);
  return cuentas;
}

// ---------------------------------------------------------------------------
// SPDF 5.0: leer la extensión
// ---------------------------------------------------------------------------

export interface ExtensionLeida {
  capa: CapaComprension | null;
  avisos: string[];
}

function evidenciasDe50(v: SqlValue | undefined, deDocref: (r: string) => string): Evidencia[] {
  const crudas = deJson<unknown[]>(v, []);
  const salida: Evidencia[] = [];
  for (const x of Array.isArray(crudas) ? crudas : []) {
    if (!x || typeof x !== 'object') continue;
    const e = x as Record<string, unknown>;
    const ancla = e.anchor && typeof e.anchor === 'object' ? anclaDe50Material(e.anchor as Anchor) : null;
    if (typeof e.doc !== 'string' || !ancla) continue;
    const ev: Evidencia = { documento: deDocref(e.doc), ancla, modo: MODO.de(texto(e.mode) || 'text') as Evidencia['modo'] };
    if (e.anchor_end && typeof e.anchor_end === 'object') ev.anclaFin = anclaDe50Material(e.anchor_end as Anchor);
    if (typeof e.quote === 'string') ev.cita = e.quote;
    if (typeof e.unit === 'string') ev.unidad = e.unit;
    if (typeof e.fragment === 'string') ev.fragmento = e.fragment;
    if (typeof e.figure === 'string') ev.figura = e.figure;
    salida.push(ev);
  }
  return salida;
}

/**
 * La extensión `x_scholaris_comprension` de un SPDF 5.0 abierto, como capa de
 * comprensión con los ids del fichero. Sin la extensión, `capa` es null y no hay avisos.
 * Las filas mal formadas se saltan (con un aviso): el fichero puede venir de cualquiera.
 */
export async function leerExtensionComprension(doc: SpdfDocument): Promise<ExtensionLeida> {
  const avisos: string[] = [];
  const ext = (await doc.extensions()).find((e) => e.name === EXTENSION_COMPRENSION);
  if (!ext) return { capa: null, avisos };
  if (ext.version.split('.')[0] !== VERSION_EXTENSION_COMPRENSION.split('.')[0]) {
    avisos.push(`La comprensión del fichero viene en una versión que esta instancia no entiende (${ext.version}): se importa solo el texto.`);
    return { capa: null, avisos };
  }
  const conn = doc.connection;
  const hay = new Set((await conn.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'x_scholaris_%'")).map((f) => String(f.name)));
  const filas = async (tabla: string, orden: string): Promise<SqlRow[]> => (hay.has(tabla) ? conn.all(`SELECT * FROM ${tabla} ORDER BY ${orden}`) : []);
  const d = doc.document;
  const propio = `sha256-${String(d.source_sha256 ?? '').toLowerCase()}`;
  const deDocref = (r: string) => (r === propio || r === d.id ? d.id : r);
  let malas = 0;
  const cada = <T>(xs: SqlRow[], f: (x: SqlRow) => T | null): T[] => {
    const salida: T[] = [];
    for (const x of xs) {
      try {
        const y = f(x);
        if (y) salida.push(y); else malas++;
      } catch { malas++; }
    }
    return salida;
  };

  const segmentos = cada(await filas('x_scholaris_segments', 'ord, id'), (f) => {
    const ancla = anclaLeida(f.anchor);
    if (!ancla || !f.id || !f.unit_from) return null;
    const s: Segmento = {
      id: texto(f.id), documento: d.id, padre: f.parent === null || f.parent === undefined ? null : texto(f.parent), nivel: numero(f.level),
      orden: numero(f.ord), tipo: TIPO_SEGMENTO.de(texto(f.kind)) as Segmento['tipo'], titulo: texto(f.title), ancla,
      unidadDesde: texto(f.unit_from), unidadHasta: texto(f.unit_to) || texto(f.unit_from),
      origen: ORIGEN_SEGMENTO.de(texto(f.origin) || 'model') as Segmento['origen'], confianza: numero(f.confidence, 1),
    };
    const fin = anclaLeida(f.anchor_end);
    if (fin) s.anclaFin = fin;
    if (f.summary) s.resumen = texto(f.summary);
    return s;
  });
  const fichas = cada(await filas('x_scholaris_cards', 'n'), (f) => {
    if (!f.id || !f.target_id || typeof f.text !== 'string') return null;
    const objetivo = OBJETIVO_FICHA.de(texto(f.target)) as Ficha['objetivo'];
    const datos = deJson<unknown>(f.data, {});
    return {
      id: texto(f.id), documento: f.document === null || f.document === undefined ? null : d.id, objetivo,
      objetivoId: objetivo === 'documento' ? deDocref(texto(f.target_id)) : texto(f.target_id),
      lente: LENTE.de(texto(f.lens) || 'general') as Ficha['lente'], clase: CLASE_FICHA.de(texto(f.class)), idioma: texto(f.language),
      texto: f.text, datos: datos && typeof datos === 'object' && !Array.isArray(datos) ? (datos as Record<string, unknown>) : {},
      evidencias: evidenciasDe50(f.evidence, deDocref), modelo: texto(f.model), version: texto(f.version), creada: texto(f.created),
    } satisfies Ficha;
  });
  const entidades = cada(await filas('x_scholaris_entities', 'id'), (f) => aPortatil({
    id: f.id, tipo: TIPO_ENTIDAD.de(texto(f.kind)), nombre: f.name, alias: f.aliases, wikidata: f.wikidata, descripcion: f.description, ficticia: f.fictional,
  }));
  const apariciones = cada(await filas('x_scholaris_appearances', 'id'), (f) => {
    const ancla = anclaLeida(f.anchor);
    if (!ancla || !f.id || !f.entity) return null;
    const m: Aparicion = {
      id: texto(f.id), entidad: texto(f.entity), documento: d.id, ancla, forma: texto(f.form),
      rol: ROL.de(texto(f.role) || 'other') as Aparicion['rol'], confianza: numero(f.confidence, 1),
    };
    if (f.segment) m.segmento = texto(f.segment);
    const fin = anclaLeida(f.anchor_end);
    if (fin) m.anclaFin = fin;
    return m;
  });
  const refRelacion = (x: string) => (x.startsWith('entity:') ? `ent:${x.slice(7)}` : deDocref(x));
  const relaciones = cada(await filas('x_scholaris_relations', 'id'), (f) => {
    if (!f.id || !f.source || !f.target) return null;
    const r: Relacion = {
      id: texto(f.id), origen: refRelacion(texto(f.source)), destino: refRelacion(texto(f.target)), tipo: TIPO_RELACION.de(texto(f.kind)) as Relacion['tipo'],
      evidencias: evidenciasDe50(f.evidence, deDocref), confianza: numero(f.confidence, 1),
      fuente: FUENTE_RELACION.de(texto(f.origin) || 'model') as Relacion['fuente'], creada: texto(f.created),
    };
    if (f.note) r.nota = texto(f.note);
    return r;
  });
  const lado = (doc0: SqlValue | undefined, ancla0: SqlValue | undefined, fin0: SqlValue | undefined, seg: SqlValue | undefined): LadoAlineacion | undefined => {
    const ancla = anclaLeida(ancla0);
    if (!doc0 || !ancla) return undefined;
    const l: LadoAlineacion = { documento: deDocref(texto(doc0)), ancla };
    const fin = anclaLeida(fin0);
    if (fin) l.anclaFin = fin;
    if (seg) l.segmento = texto(seg);
    return l;
  };
  const alineaciones = cada(await filas('x_scholaris_alignments', 'relation, ord, id'), (f) => {
    if (!f.id || !f.relation) return null;
    const a: Alineacion = { id: texto(f.id), relacion: texto(f.relation), orden: numero(f.ord), tipo: CORRESPONDENCIA.de(texto(f.kind)) as Alineacion['tipo'], nota: texto(f.note), confianza: numero(f.confidence, 1) };
    const la = lado(f.doc_a, f.anchor_a, f.anchor_end_a, f.segment_a);
    const lb = lado(f.doc_b, f.anchor_b, f.anchor_end_b, f.segment_b);
    if (la) a.a = la;
    if (lb) a.b = lb;
    return la || lb ? a : null;
  });

  const espaciosDoc = new Map((await doc.spaces()).map((s) => [s.id, s]));
  const fichasIds = new Set(fichas.map((f) => f.id));
  const usados = new Set<string>();
  const vectores = cada(await filas('x_scholaris_vectors', 'target, id, space'), (f) => {
    const s = espaciosDoc.get(texto(f.space));
    if (texto(f.target) !== 'card' || !s || !(f.data instanceof Uint8Array) || !fichasIds.has(texto(f.id))) return null;
    const valores = decodeVector(f.data, s.dtype);
    if (valores.length !== s.dims) return null;
    usados.add(s.id);
    return { ficha: texto(f.id), espacio: s.id, valores };
  });
  const MODALIDAD: Record<string, string> = { text: 'texto', image: 'imagen', audio: 'audio', video: 'video', pdf: 'pdf' };
  const espacios: EspacioVectorial[] = [...usados].map((id) => {
    const s = espaciosDoc.get(id)!;
    return {
      id: s.id, proveedor: s.provider, modelo: s.model, dims: s.dims, normalizado: s.normalized,
      modalidades: s.modalities.map((m) => MODALIDAD[m] ?? m) as EspacioVectorial['modalidades'], ...(s.version ? { version: s.version } : {}),
    };
  });
  if (malas) avisos.push(`${malas} ${malas === 1 ? 'fila de la comprensión estaba mal formada y se ha dejado' : 'filas de la comprensión estaban mal formadas y se han dejado'} fuera.`);
  const capa: CapaComprension = { documento: d.id, segmentos, fichas, apariciones, relaciones, alineaciones, entidades, espacios, vectores };
  return { capa: capaVacia(capa) ? null : capa, avisos };
}

// ---------------------------------------------------------------------------
// Importar: la capa de un .spdf → la estantería
// ---------------------------------------------------------------------------

export interface OpcionesRestaurar {
  /** El id del documento en la estantería. */
  documento: string;
  /** Sufijo de los ids cuando se importa una copia de un documento que ya estaba (como hace el importador). */
  sufijo?: string;
  mapaUnidad: ReadonlyMap<string, string>;
  mapaFragmento: ReadonlyMap<string, string>;
}

export interface ComprensionRestaurada {
  segmentos: number;
  fichas: number;
  apariciones: number;
  relaciones: number;
  alineaciones: number;
  entidades: number;
  /** Los vectores de fichas escritos (con sus ids nuevos), para el índice vectorial. */
  vectores: VectorSpdf[];
  avisos: string[];
}

/** Busca (o crea) en el grafo la entidad de otra biblioteca: primero por Wikidata, después por tipo y nombre. */
async function resolverEntidad(sql: SQL, e: EntidadPortatil): Promise<string> {
  const qid = e.wikidata && /^Q[1-9]\d*$/.test(e.wikidata) ? e.wikidata : null;
  if (qid) {
    const [f] = await sql.ejecutar<{ id: string }>('SELECT id FROM entidades WHERE wikidata = ? AND tipo = ? AND fusionada_en IS NULL LIMIT 1', qid, e.tipo);
    if (f) return String(f.id);
  }
  const id = await obtenerEntidad(sql, e.tipo, e.nombre, e.alias, e.ficticia);
  if (qid) {
    await sql.ejecutar('UPDATE entidades SET wikidata = ?, descripcion = coalesce(descripcion, ?), wikidata_visto = 1 WHERE id = ? AND wikidata IS NULL', qid, e.descripcion, id);
  } else if (e.descripcion) {
    await sql.ejecutar('UPDATE entidades SET descripcion = ? WHERE id = ? AND descripcion IS NULL', e.descripcion, id);
  }
  return id;
}

/**
 * Mete en la estantería la comprensión leída de un .spdf: entidades resueltas contra el
 * grafo de la biblioteca, ids nuevos si es una copia, unidades y fragmentos con los ids
 * con que entraron, y cada `docref` de otro documento buscado por su huella. Las
 * relaciones con obras que no están en la estantería (y sus alineaciones) se quedan fuera.
 */
export async function restaurarComprension(sql: SQL, c: CapaComprension, o: OpcionesRestaurar): Promise<ComprensionRestaurada> {
  const avisos: string[] = [];
  const r = (id: string) => (o.sufijo ? `${id}_${o.sufijo}` : id);
  const hay = await tablas(sql);

  // Documentos: el propio y los demás por su huella (o por su id, si no la tenían).
  const docs = new Map<string, string | null>([[c.documento, o.documento]]);
  const doc = async (ref: string): Promise<string | null> => {
    if (docs.has(ref)) return docs.get(ref)!;
    let id: string | null = null;
    if (DOCREF.test(ref)) {
      const [f] = await sql.ejecutar<{ id: string }>("SELECT id FROM documentos WHERE huella = ? AND estado IN ('listo','procesando') LIMIT 1", ref.slice(7));
      id = f ? String(f.id) : null;
    } else if (!ref.startsWith('ent:')) {
      const [f] = await sql.ejecutar<{ id: string }>('SELECT id FROM documentos WHERE id = ?', ref);
      id = f ? String(f.id) : null;
    }
    docs.set(ref, id);
    return id;
  };

  // Entidades.
  const entidades = new Map<string, string>();
  if (c.entidades.length) {
    if (hay.has('entidades')) {
      for (const e of c.entidades) entidades.set(e.id, await resolverEntidad(sql, e));
    } else {
      avisos.push('Esta estantería no tiene grafo de entidades: las apariciones no se importan.');
    }
  }

  const propio = (id: string | undefined, mapa?: ReadonlyMap<string, string>) => (id ? (mapa ? mapa.get(id) ?? id : r(id)) : undefined);
  const evidencias = async (es: readonly Evidencia[]): Promise<Evidencia[]> => {
    const salida: Evidencia[] = [];
    for (const e of es) {
      const destino = await doc(e.documento);
      if (destino === o.documento) {
        const x: Evidencia = { ...e, documento: destino };
        delete x.unidad; delete x.fragmento; delete x.figura;
        const u = propio(e.unidad, o.mapaUnidad);
        const f = propio(e.fragmento, o.mapaFragmento);
        const g = propio(e.figura);
        if (u) x.unidad = u;
        if (f) x.fragmento = f;
        if (g) x.figura = g;
        salida.push(x);
      } else {
        // Otra obra: si no está en la estantería, la prueba conserva su docref (su ancla sigue diciendo dónde está).
        salida.push({ ...e, documento: destino ?? e.documento });
      }
    }
    return salida;
  };

  const segmentos: Segmento[] = c.segmentos.map((s) => ({
    ...s, id: r(s.id), documento: o.documento, padre: s.padre ? r(s.padre) : null,
    unidadDesde: o.mapaUnidad.get(s.unidadDesde) ?? s.unidadDesde, unidadHasta: o.mapaUnidad.get(s.unidadHasta) ?? s.unidadHasta,
  }));

  // Relaciones con obras de la estantería.
  const relaciones: Relacion[] = [];
  const relacionesIds = new Set<string>();
  let fuera = 0;
  const extremo = async (x: string): Promise<string | null> => {
    if (x.startsWith('ent:')) { const e = entidades.get(x.slice(4)); return e ? `ent:${e}` : null; }
    return doc(x);
  };
  for (const rel of c.relaciones) {
    const origen = await extremo(rel.origen);
    const destino = await extremo(rel.destino);
    if (!origen || !destino) { fuera++; continue; }
    relaciones.push({ ...rel, id: r(rel.id), origen, destino, evidencias: await evidencias(rel.evidencias) });
    relacionesIds.add(rel.id);
  }
  if (fuera) avisos.push(`${fuera} ${fuera === 1 ? 'relación con una obra que no está en tu estantería se ha dejado' : 'relaciones con obras que no están en tu estantería se han dejado'} fuera.`);

  const segmentosLocales = async (ids: string[]): Promise<Set<string>> => {
    if (!ids.length) return new Set();
    const l = enLista(ids);
    return new Set((await sql.ejecutar<{ id: string }>(`SELECT id FROM segmentos WHERE id IN ${l.sql}`, l.param)).map((f) => String(f.id)));
  };
  const ajenos = await segmentosLocales(c.alineaciones.flatMap((a) => [a.a, a.b]).filter((l): l is LadoAlineacion => !!l && l.documento !== c.documento && !!l.segmento).map((l) => l.segmento!));
  const lado = async (l?: LadoAlineacion): Promise<LadoAlineacion | undefined> => {
    if (!l) return undefined;
    const destino = await doc(l.documento);
    if (!destino) return undefined;
    const x: LadoAlineacion = { ...l, documento: destino };
    delete x.segmento;
    if (l.segmento) {
      if (destino === o.documento) x.segmento = r(l.segmento);
      else if (ajenos.has(l.segmento)) x.segmento = l.segmento;
    }
    return x;
  };
  const alineaciones: Alineacion[] = [];
  for (const a of c.alineaciones) {
    if (!relacionesIds.has(a.relacion)) continue;
    const x: Alineacion = { ...a, id: r(a.id), relacion: r(a.relacion) };
    delete x.a; delete x.b;
    const la = await lado(a.a);
    const lb = await lado(a.b);
    if (la) x.a = la;
    if (lb) x.b = lb;
    if (la || lb) alineaciones.push(x);
  }

  const apariciones: Aparicion[] = [];
  for (const m of c.apariciones) {
    const entidad = entidades.get(m.entidad);
    if (!entidad) continue;
    const x: Aparicion = { ...m, id: r(m.id), entidad, documento: o.documento };
    delete x.segmento;
    if (m.segmento) x.segmento = r(m.segmento);
    apariciones.push(x);
  }

  const fichas: Ficha[] = [];
  for (const f of c.fichas) {
    let objetivoId: string | null = f.objetivoId;
    if (f.objetivo === 'segmento' || f.objetivo === 'figura') objetivoId = r(f.objetivoId);
    else if (f.objetivo === 'entidad') objetivoId = entidades.get(f.objetivoId) ?? null;
    else if (f.objetivo === 'relacion') objetivoId = relacionesIds.has(f.objetivoId) ? r(f.objetivoId) : null;
    else if (f.objetivo === 'documento') objetivoId = await doc(f.objetivoId);
    if (!objetivoId) continue;
    fichas.push({ ...f, id: r(f.id), documento: f.documento === null ? null : o.documento, objetivoId, evidencias: await evidencias(f.evidencias) });
  }

  // Si se rehace la importación del mismo fichero, las fichas viejas de este documento se sustituyen.
  await sql.transaccion(async (tx) => {
    await escribirSegmentos(tx, segmentos);
    await escribirFichas(tx, fichas);
    await escribirApariciones(tx, apariciones);
    await escribirRelaciones(tx, relaciones);
    await escribirAlineaciones(tx, alineaciones);
  });

  const escritas = new Set(fichas.map((f) => f.id));
  const espacios = new Set(c.espacios.map((e) => e.id));
  for (const e of c.espacios) await escribirEspacio(sql, e);
  const vectores: VectorSpdf[] = c.vectores
    .filter((v) => espacios.has(v.espacio) && escritas.has(r(v.ficha)))
    .map((v) => ({ objetivo: 'ficha', id: r(v.ficha), espacio: v.espacio, documento: o.documento, valores: v.valores }));
  for (let i = 0; i < vectores.length; i += 500) await sql.transaccion((tx) => escribirVectores(tx, vectores.slice(i, i + 500)));

  return {
    segmentos: segmentos.length, fichas: fichas.length, apariciones: apariciones.length, relaciones: relaciones.length,
    alineaciones: alineaciones.length, entidades: new Set(entidades.values()).size, vectores, avisos,
  };
}
