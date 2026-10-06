/**
 * La estantería del banco de calidad: todos los SPDF de bench/datos/salida
 * fundidos en una sola base SQLite (esquema SPDF 4.0), congelada en
 * bench/datos/calidad/estanteria.sqlite para que los juicios apunten siempre a
 * los mismos fragmentos. Se reconstruye con `pnpm bench calidad estanteria`.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { ESQUEMA_V4, rellenarTextoBusqueda } from '@scholaris/spdf';
import type { SQL, ValorSQL } from '@scholaris/nucleo';
import { RAIZ, SALIDA } from '../ingesta.js';

/**
 * Dos juegos de pruebas con el mismo código:
 *
 *   público (por defecto)  bench/calidad: documentos de dominio público o con licencia
 *                          libre, con sus SPDF en bench/calidad/fuentes; cualquiera puede
 *                          reproducirlo con una clave de Gemini.
 *   privado                SCHOLARIS_BANCO=privado: el juego grande sobre libros y
 *                          entrevistas con derechos; vive en bench/datos/calidad (fuera de git).
 *
 * SCHOLARIS_BANCO también admite una ruta a otro juego con la misma forma.
 */
const BANCO = process.env.SCHOLARIS_BANCO ?? 'publico';
const PRIVADO = BANCO === 'privado';

/** El juego: consultas, juicios, citas, folios, corpus.json, RESULTADOS.md e historial. */
export const DIR_CALIDAD = PRIVADO ? join(RAIZ, 'datos', 'calidad', 'juego') : BANCO === 'publico' ? join(RAIZ, 'calidad') : resolve(BANCO);
/** Lo que se regenera (estantería, cachés, pool, experimentos): siempre fuera de git. */
export const DIR_DATOS_CALIDAD = PRIVADO ? join(RAIZ, 'datos', 'calidad') : BANCO === 'publico' ? join(RAIZ, 'datos', 'calidad-publica') : join(resolve(BANCO), 'datos');
export const RUTA_ESTANTERIA = join(DIR_DATOS_CALIDAD, 'estanteria.sqlite');

/** Un documento del juego (corpus.json). */
export interface DocCorpus {
  /** Etiqueta del SPDF (bench/datos/salida/<etiqueta>.spdf o <juego>/fuentes/<etiqueta>.spdf). */
  etiqueta: string;
  /** Nombre corto y estable para los informes y los juicios. */
  corto: string;
  /** Cuántas consultas pide `proponer` y qué afirmaciones pide `citas-proponer`. */
  consultas?: number;
  citas?: { apoyo: number; negativa: number; idioma: string };
  /** PDF digital sin láminas: entra en el experimento «vista» (vectores de página en texto). */
  textoDigital?: boolean;
  titulo?: string;
  fuente?: string;
  licencia?: string;
  original?: { url: string; sha256: string; archivo: string };
}

function cargarCorpus(): DocCorpus[] {
  const ruta = join(DIR_CALIDAD, 'corpus.json');
  if (!existsSync(ruta)) throw new Error(`Falta ${ruta}`);
  return (JSON.parse(readFileSync(ruta, 'utf8')) as { documentos: DocCorpus[] }).documentos;
}

export const CORPUS: DocCorpus[] = cargarCorpus();

/** Los SPDF de la biblioteca de pruebas (etiquetas). */
export const SPDF_BANCO = CORPUS.map((d) => d.etiqueta);

/** Nombre corto y estable de cada documento para los informes. */
export const CORTO: Record<string, string> = Object.fromEntries(CORPUS.map((d) => [d.etiqueta, d.corto]));

function columnas(bd: DatabaseSync, tabla: string, esquema = 'main'): string[] {
  return (bd.prepare(`PRAGMA ${esquema}.table_info(${tabla})`).all() as Array<{ name: string }>).map((f) => f.name);
}

export async function construirEstanteria(o: { actualizar?: boolean } = {}): Promise<{ documentos: number; fragmentos: number; huella: string; capaNormalizada: number }> {
  mkdirSync(DIR_DATOS_CALIDAD, { recursive: true });
  if (existsSync(RUTA_ESTANTERIA)) rmSync(RUTA_ESTANTERIA);
  const bd = new DatabaseSync(RUTA_ESTANTERIA);
  bd.exec(ESQUEMA_V4);
  const cortos: Record<string, string> = {};
  const tablas = ['documentos', 'unidades', 'secciones', 'fragmentos', 'figuras', 'espacios', 'vectores'];
  // Las fuentes se congelan en bench/datos/calidad/fuentes: otras ingestas reescriben
  // bench/datos/salida y los juicios apuntan a ids de fragmento concretos.
  const fuentes = join(DIR_DATOS_CALIDAD, 'fuentes');
  mkdirSync(fuentes, { recursive: true });
  for (const etiqueta of SPDF_BANCO) {
    const congelada = join(fuentes, `${etiqueta}.sqlite`);
    const publicado = join(DIR_CALIDAD, 'fuentes', `${etiqueta}.spdf`);
    if (o.actualizar || (!existsSync(congelada) && !existsSync(publicado))) {
      const origen = join(SALIDA, `${etiqueta}.sqlite`);
      if (existsSync(origen)) copyFileSync(origen, congelada);
    }
  }
  for (const etiqueta of SPDF_BANCO) {
    let ruta = join(fuentes, `${etiqueta}.sqlite`);
    if (!existsSync(ruta)) {
      // El juego público trae sus SPDF en <juego>/fuentes; si no, los de bench/datos/salida.
      const publicado = join(DIR_CALIDAD, 'fuentes', `${etiqueta}.spdf`);
      const gz = existsSync(publicado) ? publicado : join(SALIDA, `${etiqueta}.spdf`);
      if (!existsSync(gz)) throw new Error(`Falta ${etiqueta}.spdf en ${join(DIR_CALIDAD, 'fuentes')} o en ${SALIDA}`);
      ruta = join(DIR_DATOS_CALIDAD, `${etiqueta}.tmp.sqlite`);
      const b = readFileSync(gz);
      writeFileSync(ruta, b[0] === 0x1f ? gunzipSync(b) : b);
    }
    const docId = (() => { const b = new DatabaseSync(ruta, { readOnly: true }); const f = b.prepare('SELECT id FROM documentos').get() as { id: string }; b.close(); return f.id; })();
    cortos[docId] = CORTO[etiqueta] ?? etiqueta;
    bd.exec(`ATTACH DATABASE '${ruta.replace(/'/g, "''")}' AS src`);
    bd.exec('BEGIN');
    for (const t of tablas) {
      const destino = columnas(bd, t);
      const origen = new Set(columnas(bd, t, 'src'));
      // `n` es el rowid del FTS: se reasigna para no chocar entre documentos.
      const comunes = destino.filter((c) => origen.has(c) && !(t === 'fragmentos' && c === 'n'));
      const lista = comunes.join(', ');
      bd.exec(`INSERT OR IGNORE INTO main.${t} (${lista}) SELECT ${lista} FROM src.${t}${t === 'fragmentos' ? ' ORDER BY n' : ''}`);
    }
    bd.exec('COMMIT');
    bd.exec('DETACH DATABASE src');
  }
  bd.exec(`UPDATE documentos SET estado = 'listo'`);
  // SPDF 4.1: la capa de ortografía modernizada se calcula en código (los SPDF 4.0 no la traen).
  const puerto: SQL = {
    async ejecutar<T>(c: string, ...p: ValorSQL[]) { return bd.prepare(c).all(...(p.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)) as Array<string | number | null | Uint8Array>)) as T[]; },
    async transaccion<T>(fn: (s: SQL) => Promise<T>) { bd.exec('BEGIN'); try { const r = await fn(puerto); bd.exec('COMMIT'); return r; } catch (e) { bd.exec('ROLLBACK'); throw e; } },
  };
  const tieneCapa = columnas(bd, 'fragmentos').includes('texto_busqueda');
  const capaNormalizada = tieneCapa ? await rellenarTextoBusqueda(puerto) : 0;
  bd.exec(`INSERT INTO fragmentos_fts(fragmentos_fts) VALUES ('optimize')`);
  const documentos = (bd.prepare('SELECT count(*) AS n FROM documentos').get() as { n: number }).n;
  const fragmentos = (bd.prepare('SELECT count(*) AS n FROM fragmentos').get() as { n: number }).n;
  const ids = (bd.prepare('SELECT id, texto FROM fragmentos ORDER BY id').all() as Array<{ id: string; texto: string }>);
  const huella = createHash('sha256').update(ids.map((f) => `${f.id}:${f.texto.length}`).join('\n')).digest('hex').slice(0, 12);
  bd.prepare(`INSERT OR REPLACE INTO spdf (clave, valor) VALUES ('huella_banco', ?)`).run(huella);
  bd.prepare(`INSERT OR REPLACE INTO spdf (clave, valor) VALUES ('cortos_banco', ?)`).run(JSON.stringify(cortos));
  bd.close();
  return { documentos, fragmentos, huella, capaNormalizada };
}

/** Puerto SQL sobre la estantería congelada (solo lectura). */
/** `copia`: abre una copia escribible (para experimentos que añaden vectores sin tocar la estantería congelada). */
export function abrirEstanteria(copia?: string): SQL & { bd: DatabaseSync; huella: string } {
  if (!existsSync(RUTA_ESTANTERIA)) throw new Error('Falta la estantería del banco: pnpm bench calidad estanteria');
  if (copia) copyFileSync(RUTA_ESTANTERIA, copia);
  const bd = new DatabaseSync(copia ?? RUTA_ESTANTERIA, { readOnly: !copia });
  const huella = (bd.prepare(`SELECT valor FROM spdf WHERE clave = 'huella_banco'`).get() as { valor: string } | undefined)?.valor ?? '?';
  const preparadas = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const sql = {
    bd,
    huella,
    async ejecutar<T>(consulta: string, ...parametros: ValorSQL[]): Promise<T[]> {
      let p = preparadas.get(consulta);
      if (!p) { p = bd.prepare(consulta); if (preparadas.size < 500) preparadas.set(consulta, p); }
      const ps = parametros.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));
      return p.all(...(ps as Array<string | number | null | Uint8Array>)) as T[];
    },
    async transaccion<T>(fn: (s: SQL) => Promise<T>): Promise<T> { return fn(sql); },
  };
  return sql;
}

export interface DocBanco { corto: string; titulo: string; tipo: string; idioma: string | null; anio: number | null; autores: string | null }

/** Etiqueta corta, título, tipo… de cada documento, para informes y prompts. */
export function mapaDocumentos(bd: DatabaseSync): Map<string, DocBanco> {
  const cortos = JSON.parse((bd.prepare(`SELECT valor FROM spdf WHERE clave = 'cortos_banco'`).get() as { valor: string } | undefined)?.valor ?? '{}') as Record<string, string>;
  const filas = bd.prepare('SELECT id, titulo, tipo, idioma, anio, autores FROM documentos').all() as Array<Omit<DocBanco, 'corto'> & { id: string }>;
  return new Map(filas.map((f) => [f.id, { corto: cortos[f.id] ?? f.titulo, titulo: f.titulo, tipo: f.tipo, idioma: f.idioma, anio: f.anio, autores: f.autores }]));
}
