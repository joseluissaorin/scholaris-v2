/**
 * Un fichero .spdf abierto en memoria: una base SQLite (sqlite-wasm) con el
 * esquema v4 y unos ayudantes tipados. Se crea vacío o se abre desde bytes
 * (gzip o SQLite sin comprimir), y se exporta otra vez a bytes gzip.
 */

import type {
  Documento,
  EspacioVectorial,
  Figura,
  Fragmento,
  ObjetivoVector,
  SQL,
} from '@scholaris/nucleo';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { gunzipSync, gzipSync } from 'fflate';
import { aplicarEsquema, VERSION_SPDF } from './esquema.js';
import { motor, motorCargado } from './motor.js';
import { SqlWasm } from './puerto.js';
import * as repo from './repositorio.js';

export const GENERADOR = 'scholaris-nube/spdf 0.2';

const CABECERA_SQLITE = 'SQLite format 3\u0000';

export function esGzip(b: Uint8Array): boolean {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export function esSqlite(b: Uint8Array): boolean {
  if (b.length < 100) return false;
  for (let i = 0; i < CABECERA_SQLITE.length; i++) if (b[i] !== CABECERA_SQLITE.charCodeAt(i)) return false;
  return true;
}

/** Descomprime si hace falta y comprueba que son los bytes de una base SQLite. */
export function bytesSqlite(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (esGzip(b)) b = gunzipSync(b);
  if (!esSqlite(b)) throw new Error('Esto no es un SPDF: ni gzip de SQLite ni SQLite.');
  return b;
}

/**
 * Abre bytes SQLite en una base en memoria de sqlite-wasm. Si la base venía en
 * modo WAL (cabecera 2/2), se pasa a modo de diario clásico: una base
 * deserializada no puede abrir el WAL.
 */
export async function abrirBaseCruda(bytes: Uint8Array): Promise<{ db: Database; sql: SqlWasm }> {
  const s3 = await motor();
  let b = bytes;
  if (b[18] === 2 || b[19] === 2) {
    b = b.slice();
    b[18] = 1;
    b[19] = 1;
  }
  const db = new s3.oo1.DB(':memory:', 'c');
  const p = s3.wasm.allocFromTypedArray(b);
  const rc = s3.capi.sqlite3_deserialize(
    db,
    'main',
    p,
    b.byteLength,
    b.byteLength,
    s3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  if (rc !== 0) {
    db.close();
    throw new Error(`No se pudo abrir la base SQLite (código ${rc}).`);
  }
  return { db, sql: new SqlWasm(db) };
}

export type VersionDetectada = '4' | '3' | 'desconocida';

/** Mira qué es una base abierta: SPDF 4 (tabla spdf), SPDF 1-3 (tabla metadata) u otra cosa. */
export async function detectarVersion(sql: SQL): Promise<{ version: VersionDetectada; detalle: string | null }> {
  const tablas = new Set(
    (await sql.ejecutar<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")).map((f) => f.name),
  );
  if (tablas.has('spdf') && tablas.has('documentos')) {
    const [f] = await sql.ejecutar<{ valor: string }>("SELECT valor FROM spdf WHERE clave = 'spdf_version'");
    return { version: '4', detalle: f?.valor ?? null };
  }
  if (tablas.has('metadata') && tablas.has('chunks')) {
    const [f] = await sql.ejecutar<{ value: string }>("SELECT value FROM metadata WHERE key = 'schema_version'");
    return { version: '3', detalle: f?.value ?? null };
  }
  return { version: 'desconocida', detalle: null };
}

export class ArchivoSpdf {
  private cerrado = false;

  private constructor(
    readonly db: Database,
    private readonly puerto: SqlWasm,
  ) {}

  /** El puerto `SQL` de nucleo sobre este fichero. */
  get sql(): SQL {
    return this.puerto;
  }

  /** Acceso síncrono (inserciones masivas). */
  get sqlSync(): SqlWasm {
    return this.puerto;
  }

  /** Un SPDF 4.0 vacío con el esquema aplicado. */
  static async crear(opciones: { generador?: string } = {}): Promise<ArchivoSpdf> {
    const s3 = await motor();
    const db = new s3.oo1.DB(':memory:', 'c');
    const a = new ArchivoSpdf(db, new SqlWasm(db));
    await aplicarEsquema(a.sql, { generador: opciones.generador ?? GENERADOR });
    return a;
  }

  /**
   * Abre un .spdf (gzip o SQLite). Un SPDF v1-v3 se migra al vuelo a v4 salvo
   * que se pida `migrar: false`, en cuyo caso se rechaza.
   */
  static async abrir(bytes: Uint8Array | ArrayBuffer, opciones: { migrar?: boolean } = {}): Promise<ArchivoSpdf> {
    const crudos = bytesSqlite(bytes);
    const { db, sql } = await abrirBaseCruda(crudos);
    const { version, detalle } = await detectarVersion(sql);
    if (version === '4') {
      const a = new ArchivoSpdf(db, sql);
      // Completa tablas o índices nuevos de revisiones posteriores del esquema 4.x.
      await aplicarEsquema(a.sql);
      return a;
    }
    sql.liberar();
    db.close();
    if (version === '3') {
      if (opciones.migrar === false) throw new Error(`Es un SPDF ${detalle ?? '3'}: hay que migrarlo con migrarV3aV4.`);
      const { migrarBaseV3 } = await import('./migrar-v3.js');
      const { archivo } = await migrarBaseV3(crudos);
      return archivo;
    }
    throw new Error('La base SQLite no tiene el esquema de un SPDF.');
  }

  /** Construcción interna (la usa el migrador). */
  static desdeBase(db: Database): ArchivoSpdf {
    return new ArchivoSpdf(db, new SqlWasm(db));
  }

  async version(): Promise<string> {
    return (await repo.leerClave(this.sql, 'spdf_version')) ?? VERSION_SPDF;
  }

  // --- clave/valor -------------------------------------------------------
  ponerClave(clave: string, valor: string) { return repo.ponerClave(this.sql, clave, valor); }
  leerClave(clave: string) { return repo.leerClave(this.sql, clave); }
  leerClaves() { return repo.leerClaves(this.sql); }

  // --- documento ---------------------------------------------------------
  escribirDocumento(d: Documento) { return repo.escribirDocumento(this.sql, d); }
  /** Sin id, el (único) documento del fichero. */
  leerDocumento(id?: string) { return repo.leerDocumento(this.sql, id); }
  documentos() { return repo.listarDocumentos(this.sql); }
  borrarDocumento(id: string) { return repo.borrarDocumento(this.sql, id); }

  // --- unidades, secciones, fragmentos, figuras --------------------------
  escribirUnidades(u: readonly repo.UnidadSpdf[]) { return this.enTransaccion((s) => repo.escribirUnidades(s, u)); }
  leerUnidades(documento: string, rango?: { desde?: number; hasta?: number }) { return repo.leerUnidades(this.sql, documento, rango); }
  unidadPorFolio(documento: string, impresa: string) { return repo.buscarUnidadPorFolio(this.sql, documento, impresa); }
  escribirSecciones(s: readonly repo.Seccion[]) { return this.enTransaccion((t) => repo.escribirSecciones(t, s)); }
  leerSecciones(documento: string) { return repo.leerSecciones(this.sql, documento); }
  escribirFragmentos(f: readonly Fragmento[]) { return this.enTransaccion((s) => repo.escribirFragmentos(s, f)); }
  leerFragmentos(documento: string) { return repo.leerFragmentos(this.sql, documento); }
  leerFragmento(id: string) { return repo.leerFragmento(this.sql, id); }
  escribirFiguras(f: readonly Figura[]) { return this.enTransaccion((s) => repo.escribirFiguras(s, f)); }
  leerFiguras(documento: string) { return repo.leerFiguras(this.sql, documento); }

  // --- búsqueda léxica ---------------------------------------------------
  buscarTexto(consulta: string, opciones?: Parameters<typeof repo.buscarTexto>[2]) { return repo.buscarTexto(this.sql, consulta, opciones); }

  // --- vectores ----------------------------------------------------------
  escribirEspacio(e: EspacioVectorial) { return repo.escribirEspacio(this.sql, e); }
  espacios() { return repo.leerEspacios(this.sql); }
  escribirVectores(v: readonly repo.VectorSpdf[]) { return this.enTransaccion((s) => repo.escribirVectores(s, v)); }
  leerVectores(filtro: { espacio: string; documento?: string; objetivo?: ObjetivoVector; ids?: string[] }) { return repo.leerVectores(this.sql, filtro); }

  // --- blobs y procedencia -----------------------------------------------
  ponerBlob(clave: string, mime: string, datos: Uint8Array) { return repo.ponerBlob(this.sql, clave, mime, datos); }
  leerBlob(clave: string) { return repo.leerBlob(this.sql, clave); }
  blobs(prefijo?: string) { return repo.listarBlobs(this.sql, prefijo); }
  registrarProcedencia(e: repo.EntradaProcedencia) { return repo.registrarProcedencia(this.sql, e); }
  leerProcedencia(documento: string) { return repo.leerProcedencia(this.sql, documento); }

  private enTransaccion<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    return this.sql.transaccion(fn);
  }

  /** Reconstruye el índice FTS5 y lo compacta (útil tras cargas masivas). */
  async optimizarIndice(): Promise<void> {
    await this.sql.ejecutar("INSERT INTO fragmentos_fts(fragmentos_fts) VALUES ('optimize')");
  }

  /** Comprueba la integridad de la base y del índice FTS5. Devuelve los problemas encontrados. */
  async comprobarIntegridad(): Promise<string[]> {
    const problemas: string[] = [];
    const filas = await this.sql.ejecutar<{ integrity_check: string }>('PRAGMA integrity_check');
    for (const f of filas) if (f.integrity_check !== 'ok') problemas.push(f.integrity_check);
    try {
      await this.sql.ejecutar("INSERT INTO fragmentos_fts(fragmentos_fts, rank) VALUES ('integrity-check', 1)");
    } catch (e) {
      problemas.push(`FTS5: ${(e as Error).message}`);
    }
    return problemas;
  }

  /** VACUUM: recupera el espacio de lo borrado antes de exportar. */
  compactar(): void {
    this.puerto.liberar();
    this.db.exec('VACUUM');
  }

  /** Bytes SQLite sin comprimir. */
  exportarSqlite(): Uint8Array {
    this.comprobarAbierto();
    this.puerto.liberar();
    return motorCargado().capi.sqlite3_js_db_export(this.db);
  }

  /** El .spdf: la base SQLite comprimida con gzip (nivel 6). */
  exportar(): Uint8Array {
    return gzipSync(this.exportarSqlite(), { level: 6, mtime: 0 });
  }

  cerrar(): void {
    if (this.cerrado) return;
    this.puerto.liberar();
    this.db.close();
    this.cerrado = true;
  }

  private comprobarAbierto(): void {
    if (this.cerrado) throw new Error('El SPDF ya está cerrado.');
  }
}

/** Un SPDF 4.0 vacío, listo para escribir. */
export function crearSpdf(opciones?: { generador?: string }): Promise<ArchivoSpdf> {
  return ArchivoSpdf.crear(opciones);
}

/** Abre un .spdf (v4, o v1-v3 que se migra al vuelo). */
export function abrirSpdf(bytes: Uint8Array | ArrayBuffer, opciones?: { migrar?: boolean }): Promise<ArchivoSpdf> {
  return ArchivoSpdf.abrir(bytes, opciones);
}
