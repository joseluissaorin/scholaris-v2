/**
 * Lectura y escritura tipadas del esquema v4 sobre CUALQUIER puerto SQL.
 *
 * Sirven igual para un .spdf abierto con sqlite-wasm que para la estantería de
 * un Durable Object o una base better-sqlite3: solo hablan con `SQL`.
 */

import type {
  Ancla,
  Documento,
  EspacioVectorial,
  Figura,
  Fragmento,
  MetadatosDocumento,
  Modalidad,
  ObjetivoVector,
  SQL,
  Unidad,
  ValorSQL,
  Vector,
} from '@scholaris/nucleo';
import { textoBusqueda, variantesConsulta } from '@scholaris/normalizacion';
import { contextoBusqueda, type ContextoBusqueda } from './esquema.js';
import { bytesAFloat32, float32ABytes } from './vectores.js';

// ---------------------------------------------------------------------------
// Tipos propios del fichero (los que nucleo no necesita)
// ---------------------------------------------------------------------------

/** Una unidad tal como se guarda: con la cabecera y el pie que vio el lector. */
export interface UnidadSpdf extends Unidad {
  cabecera?: string;
  pie?: string;
}

export interface Seccion {
  id: string;
  documento: string;
  padre?: string | null;
  nivel: number;
  titulo: string;
  unidadDesde: string;
  unidadHasta?: string | null;
  resumen?: string | null;
}

export interface VectorSpdf extends Vector {
  documento: string;
}

export interface EntradaProcedencia {
  documento: string;
  fase: string;
  proveedor?: string | null;
  detalle?: unknown;
  ms?: number | null;
  cuando?: string;
}

export interface BlobSpdf {
  clave: string;
  mime: string;
  datos: Uint8Array;
}

type Fila = Record<string, ValorSQL>;

const json = (v: unknown): string => JSON.stringify(v);
const texto = (v: ValorSQL | undefined): string => (v === null || v === undefined ? '' : String(v));
const textoONulo = (v: ValorSQL | undefined): string | null => (v === null || v === undefined ? null : String(v));
const numero = (v: ValorSQL | undefined): number => (typeof v === 'number' ? v : Number(v ?? 0));
const deJson = <T>(v: ValorSQL | undefined, defecto: T): T => {
  if (v === null || v === undefined || v === '') return defecto;
  try { return JSON.parse(String(v)) as T; } catch { return defecto; }
};
const aBytes = (v: ValorSQL | undefined): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === 'string') return new TextEncoder().encode(v);
  return new Uint8Array(0);
};

// ---------------------------------------------------------------------------
// Clave/valor del fichero
// ---------------------------------------------------------------------------

export async function ponerClave(sql: SQL, clave: string, valor: string): Promise<void> {
  await sql.ejecutar('INSERT INTO spdf(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', clave, valor);
}

export async function leerClave(sql: SQL, clave: string): Promise<string | null> {
  const [f] = await sql.ejecutar<Fila>('SELECT valor FROM spdf WHERE clave = ?', clave);
  return f ? texto(f.valor) : null;
}

export async function leerClaves(sql: SQL): Promise<Record<string, string>> {
  const filas = await sql.ejecutar<Fila>('SELECT clave, valor FROM spdf ORDER BY clave');
  return Object.fromEntries(filas.map((f) => [texto(f.clave), texto(f.valor)]));
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

/** «Foucault; Deleuze»: columna desnormalizada para filtros y FTS. */
export function autoresPlanos(m: MetadatosDocumento): string {
  return (m.autores ?? []).map((a) => a.apellidos || a.nombre).filter(Boolean).join('; ');
}

export async function escribirDocumento(sql: SQL, d: Documento): Promise<void> {
  await sql.ejecutar(
    `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, duracion,
       creado, actualizado, bibliotecas, titulo, autores, anio, idioma)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET tipo = excluded.tipo, metadatos = excluded.metadatos, estado = excluded.estado,
       huella = excluded.huella, original = excluded.original, mime = excluded.mime, bytes = excluded.bytes,
       unidades = excluded.unidades, duracion = excluded.duracion, actualizado = excluded.actualizado,
       bibliotecas = excluded.bibliotecas, titulo = excluded.titulo, autores = excluded.autores,
       anio = excluded.anio, idioma = excluded.idioma`,
    d.id, d.tipo, json(d.metadatos), d.estado, d.huella, d.original, d.mime, d.bytes, d.unidades,
    d.duracion ?? null, d.creado, d.actualizado, json(d.bibliotecas ?? []),
    d.metadatos.titulo ?? null, autoresPlanos(d.metadatos) || null, d.metadatos.anio ?? null, d.metadatos.idioma ?? null,
  );
}

function filaADocumento(f: Fila): Documento {
  const d: Documento = {
    id: texto(f.id),
    tipo: texto(f.tipo) as Documento['tipo'],
    metadatos: deJson<MetadatosDocumento>(f.metadatos, { titulo: texto(f.titulo), autores: [] }),
    estado: texto(f.estado) as Documento['estado'],
    huella: texto(f.huella),
    original: texto(f.original),
    mime: texto(f.mime),
    bytes: numero(f.bytes),
    unidades: numero(f.unidades),
    creado: texto(f.creado),
    actualizado: texto(f.actualizado),
    bibliotecas: deJson<string[]>(f.bibliotecas, []),
  };
  if (f.duracion !== null && f.duracion !== undefined) d.duracion = numero(f.duracion);
  return d;
}

export async function leerDocumento(sql: SQL, id?: string): Promise<Documento | null> {
  const filas = id
    ? await sql.ejecutar<Fila>('SELECT * FROM documentos WHERE id = ?', id)
    : await sql.ejecutar<Fila>('SELECT * FROM documentos ORDER BY creado LIMIT 1');
  return filas[0] ? filaADocumento(filas[0]) : null;
}

export async function listarDocumentos(sql: SQL): Promise<Documento[]> {
  return (await sql.ejecutar<Fila>('SELECT * FROM documentos ORDER BY creado')).map(filaADocumento);
}

/** Borra un documento y todo lo que cuelga de él (también en esquemas sin ON DELETE CASCADE activo). */
export async function borrarDocumento(sql: SQL, id: string): Promise<void> {
  await sql.transaccion(async (t) => {
    await t.ejecutar('DELETE FROM vectores WHERE documento = ?', id);
    await t.ejecutar('DELETE FROM fragmentos WHERE documento = ?', id);
    await t.ejecutar('DELETE FROM figuras WHERE documento = ?', id);
    await t.ejecutar('DELETE FROM secciones WHERE documento = ?', id);
    await t.ejecutar('DELETE FROM unidades WHERE documento = ?', id);
    await t.ejecutar('DELETE FROM procedencia WHERE documento = ?', id);
    await t.ejecutar('DELETE FROM documentos WHERE id = ?', id);
  });
}

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------

export async function escribirUnidades(sql: SQL, unidades: readonly UnidadSpdf[]): Promise<void> {
  for (const u of unidades) {
    const a = u.ancla;
    await sql.ejecutar(
      `INSERT OR REPLACE INTO unidades (id, documento, orden, ancla, texto, notas, cabecera, pie, imagen, miniatura,
         lector, confianza, impresa, t0, t1)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      u.id, u.documento, u.orden, json(a), u.texto ?? '', u.notas && u.notas.length ? json(u.notas) : null,
      u.cabecera ?? null, u.pie ?? null, u.imagen ?? null, u.miniatura ?? null, u.lector, u.confianza,
      a.tipo === 'pagina' ? a.impresa : a.tipo === 'seccion' ? (a.impresa ?? null) : null,
      a.tipo === 'tiempo' ? a.t0 : null,
      a.tipo === 'tiempo' ? a.t1 : null,
    );
  }
}

function filaAUnidad(f: Fila): UnidadSpdf {
  const u: UnidadSpdf = {
    id: texto(f.id),
    documento: texto(f.documento),
    orden: numero(f.orden),
    ancla: deJson<Ancla>(f.ancla, { tipo: 'imagen' }),
    texto: texto(f.texto),
    lector: texto(f.lector),
    confianza: numero(f.confianza),
  };
  const notas = deJson<string[] | null>(f.notas, null);
  if (notas) u.notas = notas;
  if (f.imagen) u.imagen = texto(f.imagen);
  if (f.miniatura) u.miniatura = texto(f.miniatura);
  if (f.cabecera) u.cabecera = texto(f.cabecera);
  if (f.pie) u.pie = texto(f.pie);
  return u;
}

export async function leerUnidades(sql: SQL, documento: string, rango?: { desde?: number; hasta?: number }): Promise<UnidadSpdf[]> {
  const desde = rango?.desde ?? Number.MIN_SAFE_INTEGER, hasta = rango?.hasta ?? Number.MAX_SAFE_INTEGER;
  return (await sql.ejecutar<Fila>('SELECT * FROM unidades WHERE documento = ? AND orden BETWEEN ? AND ? ORDER BY orden', documento, desde, hasta)).map(filaAUnidad);
}

/** «Ir a la página 145»: unidades cuyo folio impreso es ese. */
export async function buscarUnidadPorFolio(sql: SQL, documento: string, impresa: string): Promise<UnidadSpdf[]> {
  return (await sql.ejecutar<Fila>('SELECT * FROM unidades WHERE documento = ? AND impresa = ? ORDER BY orden', documento, impresa)).map(filaAUnidad);
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

export async function escribirSecciones(sql: SQL, secciones: readonly Seccion[]): Promise<void> {
  for (const s of secciones) {
    await sql.ejecutar(
      `INSERT OR REPLACE INTO secciones (id, documento, padre, nivel, titulo, unidad_desde, unidad_hasta, resumen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, s.documento, s.padre ?? null, s.nivel, s.titulo, s.unidadDesde, s.unidadHasta ?? null, s.resumen ?? null,
    );
  }
}

export async function leerSecciones(sql: SQL, documento: string): Promise<Seccion[]> {
  const filas = await sql.ejecutar<Fila>('SELECT * FROM secciones WHERE documento = ? ORDER BY rowid', documento);
  return filas.map((f) => ({
    id: texto(f.id),
    documento: texto(f.documento),
    padre: textoONulo(f.padre),
    nivel: numero(f.nivel),
    titulo: texto(f.titulo),
    unidadDesde: texto(f.unidad_desde),
    unidadHasta: textoONulo(f.unidad_hasta),
    resumen: textoONulo(f.resumen),
  }));
}

// ---------------------------------------------------------------------------
// Fragmentos
// ---------------------------------------------------------------------------

/**
 * Escribe fragmentos. La capa de búsqueda (`texto_busqueda`) se toma del
 * fragmento si la trae; si no, se calcula con el idioma y la época de su
 * documento (que conviene escribir antes), mirando los textos de este mismo lote.
 */
export async function escribirFragmentos(sql: SQL, fragmentos: readonly Fragmento[]): Promise<void> {
  const contextos = new Map<string, ContextoBusqueda>();
  for (const f of fragmentos) {
    if (f.textoBusqueda !== undefined || contextos.has(f.documento)) continue;
    const muestra = fragmentos.filter((g) => g.documento === f.documento).slice(0, 400).map((g) => g.texto);
    contextos.set(f.documento, await contextoBusqueda(sql, f.documento, muestra));
  }
  for (const f of fragmentos) {
    const c = contextos.get(f.documento);
    const busqueda = f.textoBusqueda ?? (c ? textoBusqueda(f.texto, c.idioma, c.epoca) : '');
    // UPSERT (no INSERT OR REPLACE): así los disparadores mantienen el índice FTS al día.
    await sql.ejecutar(
      `INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin, texto_busqueda)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET documento = excluded.documento, unidad = excluded.unidad, orden = excluded.orden,
         texto = excluded.texto, contexto = excluded.contexto, seccion = excluded.seccion,
         ancla = excluded.ancla, ancla_fin = excluded.ancla_fin, texto_busqueda = excluded.texto_busqueda`,
      f.id, f.documento, f.unidad, f.orden, f.texto, f.contexto ?? '', json(f.seccion ?? []), json(f.ancla),
      f.anclaFin ? json(f.anclaFin) : null, busqueda,
    );
  }
}

export function filaAFragmento(f: Fila): Fragmento {
  const fr: Fragmento = {
    id: texto(f.id),
    documento: texto(f.documento),
    unidad: texto(f.unidad),
    orden: numero(f.orden),
    texto: texto(f.texto),
    contexto: texto(f.contexto),
    seccion: deJson<string[]>(f.seccion, []),
    ancla: deJson<Ancla>(f.ancla, { tipo: 'imagen' }),
  };
  const fin = deJson<Ancla | null>(f.ancla_fin, null);
  if (fin) fr.anclaFin = fin;
  return fr;
}

export async function leerFragmentos(sql: SQL, documento: string): Promise<Fragmento[]> {
  return (await sql.ejecutar<Fila>('SELECT * FROM fragmentos WHERE documento = ? ORDER BY orden', documento)).map(filaAFragmento);
}

export async function leerFragmento(sql: SQL, id: string): Promise<Fragmento | null> {
  const [f] = await sql.ejecutar<Fila>('SELECT * FROM fragmentos WHERE id = ?', id);
  return f ? filaAFragmento(f) : null;
}

// ---------------------------------------------------------------------------
// Búsqueda léxica (FTS5)
// ---------------------------------------------------------------------------

/** Peso BM25 de la columna normalizada frente al texto fiel (1.0). */
export const PESO_NORMALIZADA = 0.9;

export interface ResultadoLexico {
  fragmento: Fragmento;
  /** BM25 cambiado de signo: más alto es mejor. */
  puntuacion: number;
  /** Texto con las coincidencias entre «[» y «]». */
  resaltado: string;
}

/**
 * Variantes de ortografía antigua de una palabra o frase, restringidas a la
 * columna `texto_busqueda` (SPDF 4.1): `texto_busqueda : ("onra" OR …)`.
 * '' si no hay ninguna.
 */
export function filtroNormalizado(termino: string): string {
  const vs = variantesConsulta(termino);
  if (!vs.length) return '';
  return `texto_busqueda : (${vs.map((v) => `"${v}"`).join(' OR ')})`;
}

/**
 * Convierte texto libre en una consulta FTS5 segura: cada palabra entre
 * comillas (así «AND», «NEAR» o un guion no se interpretan como operadores).
 *
 * Con `normalizada` (por defecto), cada palabra casa también con sus variantes
 * de ortografía antigua en la capa de búsqueda: «honra» encuentra «honrra»,
 * «así» encuentra «aſsi». La frase literal se sigue buscando en el texto fiel.
 */
export function consultaFts(textoLibre: string, modo: 'todas' | 'alguna' | 'frase' = 'alguna', normalizada = true): string {
  const palabras = textoLibre.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!palabras.length) return '';
  if (modo === 'frase') {
    const frase = `"${palabras.join(' ')}"`;
    const extra = normalizada ? filtroNormalizado(palabras.join(' ')) : '';
    return extra ? `${frase} OR ${extra}` : frase;
  }
  const citadas = palabras.map((p) => {
    const extra = normalizada ? filtroNormalizado(p) : '';
    return extra ? `("${p}" OR ${extra})` : `"${p}"`;
  });
  return citadas.join(modo === 'todas' ? ' AND ' : ' OR ');
}

export async function buscarTexto(
  sql: SQL,
  consulta: string,
  opciones: { limite?: number; documentos?: string[]; crudo?: boolean; modo?: 'todas' | 'alguna' | 'frase'; normalizada?: boolean } = {},
): Promise<ResultadoLexico[]> {
  const q = opciones.crudo ? consulta : consultaFts(consulta, opciones.modo, opciones.normalizada ?? true);
  if (!q) return [];
  const limite = opciones.limite ?? 20;
  const docs = opciones.documentos ?? [];
  const filtro = docs.length ? `AND f.documento IN (${docs.map(() => '?').join(', ')})` : '';
  const filas = await sql.ejecutar<Fila>(
    `SELECT f.*, bm25(fragmentos_fts, 1.0, 0.4, 0.6, ${PESO_NORMALIZADA}) AS rango,
            highlight(fragmentos_fts, 0, '[', ']') AS resaltado
       FROM fragmentos_fts JOIN fragmentos f ON f.n = fragmentos_fts.rowid
      WHERE fragmentos_fts MATCH ? ${filtro}
      ORDER BY rango LIMIT ?`,
    q, ...docs, limite,
  );
  return filas.map((f) => ({ fragmento: filaAFragmento(f), puntuacion: -numero(f.rango), resaltado: texto(f.resaltado) }));
}

// ---------------------------------------------------------------------------
// Figuras
// ---------------------------------------------------------------------------

export async function escribirFiguras(sql: SQL, figuras: readonly Figura[]): Promise<void> {
  for (const f of figuras) {
    await sql.ejecutar(
      'INSERT OR REPLACE INTO figuras (id, documento, unidad, imagen, pie, descripcion, ancla) VALUES (?, ?, ?, ?, ?, ?, ?)',
      f.id, f.documento, f.unidad, f.imagen, f.pie ?? null, f.descripcion ?? null, json(f.ancla),
    );
  }
}

export async function leerFiguras(sql: SQL, documento: string): Promise<Figura[]> {
  const filas = await sql.ejecutar<Fila>('SELECT * FROM figuras WHERE documento = ? ORDER BY rowid', documento);
  return filas.map((f) => {
    const fig: Figura = {
      id: texto(f.id),
      documento: texto(f.documento),
      unidad: texto(f.unidad),
      imagen: texto(f.imagen),
      ancla: deJson<Ancla>(f.ancla, { tipo: 'imagen' }),
    };
    if (f.pie) fig.pie = texto(f.pie);
    if (f.descripcion) fig.descripcion = texto(f.descripcion);
    return fig;
  });
}

// ---------------------------------------------------------------------------
// Espacios y vectores
// ---------------------------------------------------------------------------

export async function escribirEspacio(sql: SQL, e: EspacioVectorial): Promise<void> {
  await sql.ejecutar(
    `INSERT INTO espacios (id, proveedor, modelo, version, dims, normalizado, modalidades, creado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET proveedor = excluded.proveedor, modelo = excluded.modelo, version = excluded.version,
       dims = excluded.dims, normalizado = excluded.normalizado, modalidades = excluded.modalidades`,
    e.id, e.proveedor, e.modelo, e.version ?? null, e.dims, e.normalizado ? 1 : 0, json(e.modalidades), new Date().toISOString(),
  );
}

export async function leerEspacios(sql: SQL): Promise<EspacioVectorial[]> {
  const filas = await sql.ejecutar<Fila>('SELECT * FROM espacios ORDER BY id');
  return filas.map((f) => {
    const e: EspacioVectorial = {
      id: texto(f.id),
      proveedor: texto(f.proveedor),
      modelo: texto(f.modelo),
      dims: numero(f.dims),
      normalizado: numero(f.normalizado) === 1,
      modalidades: deJson<Modalidad[]>(f.modalidades, []),
    };
    if (f.version) e.version = texto(f.version);
    return e;
  });
}

export async function escribirVectores(sql: SQL, vectores: readonly VectorSpdf[]): Promise<void> {
  const dims = new Map<string, number>();
  for (const v of vectores) {
    let d = dims.get(v.espacio);
    if (d === undefined) {
      const [f] = await sql.ejecutar<Fila>('SELECT dims FROM espacios WHERE id = ?', v.espacio);
      if (!f) throw new Error(`El espacio vectorial «${v.espacio}» no está registrado: llama antes a escribirEspacio.`);
      d = numero(f.dims);
      dims.set(v.espacio, d);
    }
    if (v.valores.length !== d) throw new Error(`Vector ${v.objetivo}/${v.id} con ${v.valores.length} dimensiones en un espacio de ${d}.`);
    await sql.ejecutar(
      'INSERT OR REPLACE INTO vectores (objetivo, id, espacio, documento, valores) VALUES (?, ?, ?, ?, ?)',
      v.objetivo, v.id, v.espacio, v.documento, float32ABytes(v.valores),
    );
  }
}

export async function leerVectores(
  sql: SQL,
  filtro: { espacio: string; documento?: string; objetivo?: ObjetivoVector; ids?: string[] },
): Promise<VectorSpdf[]> {
  const condiciones = ['espacio = ?'];
  const params: ValorSQL[] = [filtro.espacio];
  if (filtro.documento) { condiciones.push('documento = ?'); params.push(filtro.documento); }
  if (filtro.objetivo) { condiciones.push('objetivo = ?'); params.push(filtro.objetivo); }
  if (filtro.ids?.length) { condiciones.push(`id IN (${filtro.ids.map(() => '?').join(', ')})`); params.push(...filtro.ids); }
  const filas = await sql.ejecutar<Fila>(`SELECT * FROM vectores WHERE ${condiciones.join(' AND ')} ORDER BY objetivo, id`, ...params);
  return filas.map((f) => ({
    objetivo: texto(f.objetivo) as ObjetivoVector,
    id: texto(f.id),
    espacio: texto(f.espacio),
    documento: texto(f.documento),
    valores: bytesAFloat32(aBytes(f.valores)),
  }));
}

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

export async function ponerBlob(sql: SQL, clave: string, mime: string, datos: Uint8Array): Promise<void> {
  await sql.ejecutar('INSERT OR REPLACE INTO blobs (clave, mime, datos) VALUES (?, ?, ?)', clave, mime, datos);
}

export async function leerBlob(sql: SQL, clave: string): Promise<BlobSpdf | null> {
  const [f] = await sql.ejecutar<Fila>('SELECT clave, mime, datos FROM blobs WHERE clave = ?', clave);
  return f ? { clave: texto(f.clave), mime: texto(f.mime), datos: aBytes(f.datos) } : null;
}

export async function listarBlobs(sql: SQL, prefijo = ''): Promise<Array<{ clave: string; mime: string; bytes: number }>> {
  const filas = await sql.ejecutar<Fila>(
    "SELECT clave, mime, length(datos) AS bytes FROM blobs WHERE substr(clave, 1, length(?)) = ? ORDER BY clave", prefijo, prefijo,
  );
  return filas.map((f) => ({ clave: texto(f.clave), mime: texto(f.mime), bytes: numero(f.bytes) }));
}

// ---------------------------------------------------------------------------
// Procedencia
// ---------------------------------------------------------------------------

export async function registrarProcedencia(sql: SQL, e: EntradaProcedencia): Promise<void> {
  await sql.ejecutar(
    'INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)',
    e.documento, e.fase, e.proveedor ?? null, e.detalle === undefined ? null : json(e.detalle), e.ms ?? null,
    e.cuando ?? new Date().toISOString(),
  );
}

export async function leerProcedencia(sql: SQL, documento: string): Promise<EntradaProcedencia[]> {
  const filas = await sql.ejecutar<Fila>('SELECT * FROM procedencia WHERE documento = ? ORDER BY rowid', documento);
  return filas.map((f) => ({
    documento: texto(f.documento),
    fase: texto(f.fase),
    proveedor: textoONulo(f.proveedor),
    detalle: deJson<unknown>(f.detalle, null),
    ms: f.ms === null || f.ms === undefined ? null : numero(f.ms),
    cuando: texto(f.cuando),
  }));
}
