/**
 * Tablas propias de la plataforma dentro de la estantería de cada usuario,
 * junto al esquema SPDF v4 y el de `@scholaris/funciones`.
 */
import type { SQL } from '@scholaris/nucleo';
import { aplicarEsquema } from '@scholaris/spdf';
import { aplicarEsquemaFunciones } from '@scholaris/funciones';

export const ESQUEMA_PLATAFORMA = [
  `CREATE TABLE IF NOT EXISTS pl_bibliotecas (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, descripcion TEXT, color TEXT, creada TEXT NOT NULL, actualizada TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pl_tareas (
    id TEXT PRIMARY KEY, tipo TEXT NOT NULL, estado TEXT NOT NULL, documento TEXT, progreso TEXT, error TEXT,
    params TEXT, creada TEXT NOT NULL, actualizada TEXT NOT NULL, terminada TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS pl_tareas_estado ON pl_tareas(estado, creada)`,
  `CREATE INDEX IF NOT EXISTS pl_tareas_documento ON pl_tareas(documento)`,
  `CREATE TABLE IF NOT EXISTS pl_subidas (
    id TEXT PRIMARY KEY, documento TEXT NOT NULL, nombre TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
    huella TEXT, tipo TEXT NOT NULL, clave TEXT NOT NULL, id_partes TEXT, prefijo TEXT NOT NULL,
    bibliotecas TEXT NOT NULL DEFAULT '[]', metadatos TEXT, estado TEXT NOT NULL, creada TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pl_uso (
    metrica TEXT NOT NULL, periodo TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (metrica, periodo)
  )`,
  `CREATE TABLE IF NOT EXISTS pl_avisos (
    documento TEXT NOT NULL, codigo TEXT NOT NULL, mensaje TEXT NOT NULL, creado TEXT NOT NULL, PRIMARY KEY (documento, codigo)
  )`,
  `CREATE TABLE IF NOT EXISTS pl_temporales (
    clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, creado TEXT NOT NULL, caduca TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pl_autocitas (
    id TEXT PRIMARY KEY, titulo TEXT NOT NULL, estado TEXT NOT NULL, peticion TEXT NOT NULL, texto TEXT NOT NULL DEFAULT '',
    parrafos TEXT NOT NULL DEFAULT '[]', propuestas TEXT NOT NULL DEFAULT '[]', bibliografia TEXT NOT NULL DEFAULT '[]',
    estilo TEXT NOT NULL, error TEXT, creada TEXT NOT NULL
  )`,
];

/** Aplica los tres esquemas (SPDF, funciones, plataforma). Idempotente. */
export async function prepararEstanteria(sql: SQL): Promise<void> {
  await aplicarEsquema(sql, { generador: 'scholaris-plataforma' });
  // Un fallo en el esquema de las funciones no puede dejar sin biblioteca a nadie:
  // se registra y la estantería sigue (las funciones afectadas fallarán solas).
  try {
    await aplicarEsquemaFunciones(sql);
  } catch (e) {
    console.error(JSON.stringify({ nivel: 'error', que: 'esquema_funciones', error: (e as Error).message }));
  }
  for (const s of ESQUEMA_PLATAFORMA) await sql.ejecutar(s);
}
