/**
 * Tablas propias de la plataforma dentro de la estantería de cada usuario,
 * junto al esquema SPDF v4 y el de `@scholaris/funciones`.
 */
import type { SQL } from '@scholaris/nucleo';
import { aplicarEsquema, ESQUEMA_V4 } from '@scholaris/spdf';
import { aplicarEsquemaFunciones, esquemaFunciones } from '@scholaris/funciones';

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
  // Lotes: llenar una biblioteca de golpe, con una cola de concurrencia limitada.
  `CREATE TABLE IF NOT EXISTS pl_lotes (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, biblioteca TEXT, modo TEXT NOT NULL, concurrencia INTEGER NOT NULL, estado TEXT NOT NULL,
    estimacion TEXT, creado TEXT NOT NULL, actualizado TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pl_lote_elementos (
    lote TEXT NOT NULL, n INTEGER NOT NULL, clase TEXT NOT NULL, nombre TEXT NOT NULL, ruta TEXT, mime TEXT, bytes INTEGER, huella TEXT, url TEXT,
    tipo TEXT, paginas INTEGER, minutos REAL, metadatos TEXT, estado TEXT NOT NULL, documento TEXT, tarea TEXT, error TEXT,
    intentos INTEGER NOT NULL DEFAULT 0, actualizado TEXT NOT NULL, PRIMARY KEY (lote, n)
  )`,
  `CREATE INDEX IF NOT EXISTS pl_lote_elementos_estado ON pl_lote_elementos(lote, estado)`,
  `CREATE INDEX IF NOT EXISTS pl_lote_elementos_documento ON pl_lote_elementos(documento)`,
];

/** Columnas añadidas después a tablas que ya existían en las estanterías (entran en la huella). */
export const COLUMNAS_NUEVAS: Array<[tabla: string, columna: string, tipo: string]> = [
  ['pl_bibliotecas', 'derechos', 'TEXT'],
  ['pl_bibliotecas', 'nota_derechos', 'TEXT'],
  ['pl_bibliotecas', 'copiada_de', 'TEXT'],
];

async function anadirColumnas(sql: SQL): Promise<void> {
  const porTabla = new Map<string, Set<string>>();
  for (const [t, c, tipo] of COLUMNAS_NUEVAS) {
    if (!porTabla.has(t)) porTabla.set(t, new Set((await sql.ejecutar<{ name: string }>(`PRAGMA table_info(${t})`)).map((f) => f.name)));
    if (porTabla.get(t)!.has(c)) continue;
    try { await sql.ejecutar(`ALTER TABLE ${t} ADD COLUMN ${c} ${tipo}`); } catch (e) {
      if (!/duplicate column/i.test((e as Error).message)) throw e;
    }
  }
}

/** Aplica los tres esquemas (SPDF, funciones, plataforma). Idempotente. */
/**
 * Huella de todos los esquemas que aplica `prepararEstanteria` (SPDF, funciones y
 * plataforma). Si una estantería ya los aplicó con esta misma huella, despertar
 * no tiene que repetirlos (cientos de sentencias en frío).
 */
export const HUELLA_ESQUEMA = (() => {
  const texto = [ESQUEMA_V4, esquemaFunciones, ...ESQUEMA_PLATAFORMA, JSON.stringify(COLUMNAS_NUEVAS)].join('\u0000');
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193) >>> 0;
  return `${texto.length.toString(36)}-${h.toString(36)}`;
})();

/** Devuelve si todo quedó aplicado (si falló el de funciones, hay que volver a intentarlo al despertar). */
export async function prepararEstanteria(sql: SQL): Promise<boolean> {
  let completo = true;
  await aplicarEsquema(sql, { generador: 'scholaris-plataforma' });
  // Un fallo en el esquema de las funciones no puede dejar sin biblioteca a nadie:
  // se registra y la estantería sigue (las funciones afectadas fallarán solas).
  try {
    await aplicarEsquemaFunciones(sql);
  } catch (e) {
    console.error(JSON.stringify({ nivel: 'error', que: 'esquema_funciones', error: (e as Error).message }));
    completo = false;
  }
  for (const s of ESQUEMA_PLATAFORMA) await sql.ejecutar(s);
  await anadirColumnas(sql);
  return completo;
}
