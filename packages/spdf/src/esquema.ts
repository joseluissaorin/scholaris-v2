/**
 * El esquema SPDF 4.1 como cadena, para poder aplicarlo en cualquier plataforma
 * (navegador, Workers, Node) sin leer ficheros. `esquema/v4.1.sql` es una copia
 * legible; una prueba comprueba que ambos coinciden. `esquema/v4.0.sql` queda
 * como referencia histórica (las pruebas de migración lo usan).
 *
 * 4.1: `fragmentos.texto_busqueda`, la capa de ortografía modernizada
 * (@scholaris/normalizacion), indexada en FTS5 junto al texto fiel.
 */

import type { SQL, ValorSQL } from "@scholaris/nucleo";
import { limpiarMarcadoOCR } from "@scholaris/nucleo";
import { epocaDeDocumento, lenguaDe, textoBusqueda, type Epoca } from "@scholaris/normalizacion";

export const VERSION_SPDF = "4.1";
export const USER_VERSION_SPDF = 410;

export const ESQUEMA_V4 = `-- SPDF 4.1: un documento leído y citable, de cualquier cosa.
--
-- Un .spdf es una base SQLite comprimida con gzip. Este esquema es también el de
-- la «estantería» (el Durable Object de cada usuario): allí conviven muchos
-- documentos; en un .spdf exportado hay exactamente uno.
--
-- Principios:
--   1. Todo fragmento lleva su ancla (JSON): página impresa, tiempo, sección…
--   2. Un documento puede llevar vectores de VARIOS espacios (modelos).
--   3. Todo es reconstruible desde el original + las unidades leídas: los
--      vectores y los contextos son derivados y se pueden recalcular.
--   4. Procedencia: qué lector leyó cada unidad y con qué confianza.
--   5. El texto fiel no se toca: la búsqueda en grafía moderna va por una
--      columna sombra (fragmentos.texto_busqueda, desde la 4.1).
--
-- Este fichero es una copia legible de «ESQUEMA_V4» (packages/spdf/src/esquema.ts),
-- que es la fuente de verdad; una prueba comprueba que coinciden. «aplicarEsquema»
-- ejecuta las sentencias una a una sobre cualquier puerto SQL (sqlite-wasm,
-- Durable Object, better-sqlite3), y fija «PRAGMA user_version = 410» solo donde
-- la plataforma lo permite: la versión vive además en la tabla «spdf».

-- Clave/valor del fichero: spdf_version, creado, generador, huella_original…
CREATE TABLE IF NOT EXISTS spdf (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentos (
  id           TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL,          -- TipoEntrada
  metadatos    TEXT NOT NULL,          -- JSON MetadatosDocumento
  estado       TEXT NOT NULL DEFAULT 'pendiente',
  huella       TEXT NOT NULL,          -- SHA-256 del original
  original     TEXT NOT NULL,          -- clave en el almacén ('' si va incrustado en blobs)
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  unidades     INTEGER NOT NULL DEFAULT 0,
  duracion     REAL,
  creado       TEXT NOT NULL,
  actualizado  TEXT NOT NULL,
  bibliotecas  TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  -- columnas desnormalizadas para filtrar sin abrir el JSON
  titulo       TEXT,
  autores      TEXT,                   -- «Foucault; Deleuze» para FTS y filtros
  anio         INTEGER,
  idioma       TEXT
);
CREATE INDEX IF NOT EXISTS documentos_anio ON documentos(anio);

-- Unidades citables: páginas, tramos de tiempo, diapositivas, secciones, hojas.
CREATE TABLE IF NOT EXISTS unidades (
  id          TEXT PRIMARY KEY,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL,
  ancla       TEXT NOT NULL,           -- JSON Ancla
  texto       TEXT NOT NULL DEFAULT '',
  notas       TEXT,                    -- JSON string[]
  cabecera    TEXT,
  pie         TEXT,
  imagen      TEXT,                    -- clave en el almacén
  miniatura   TEXT,
  lector      TEXT NOT NULL,           -- «gemini-3-flash», «capa-pdf», «whisper-large-v3-turbo»
  confianza   REAL NOT NULL DEFAULT 1,
  -- folio impreso desnormalizado para «ir a la página 145»
  impresa     TEXT,
  t0          REAL,
  t1          REAL,
  -- audio y vídeo: instante de cada palabra del texto, JSON {"v":1,"t0":…,"cs":[inicio,duración,…]}
  -- en centésimas desde t0, alineado con las palabras de «texto» sin las marcas «**Nombre:**»
  palabras    TEXT
);
CREATE INDEX IF NOT EXISTS unidades_doc ON unidades(documento, orden);
CREATE INDEX IF NOT EXISTS unidades_impresa ON unidades(documento, impresa);

CREATE TABLE IF NOT EXISTS secciones (
  id          TEXT PRIMARY KEY,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  padre       TEXT,
  nivel       INTEGER NOT NULL,
  titulo      TEXT NOT NULL,
  unidad_desde TEXT NOT NULL,
  unidad_hasta TEXT,
  resumen     TEXT
);
CREATE INDEX IF NOT EXISTS secciones_doc ON secciones(documento);

-- «n» es el rowid estable que usa el índice FTS5 (un rowid implícito puede
-- cambiar con VACUUM y desincronizar el índice de contenido externo).
CREATE TABLE IF NOT EXISTS fragmentos (
  n           INTEGER PRIMARY KEY,
  id          TEXT NOT NULL UNIQUE,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  unidad      TEXT NOT NULL,
  orden       INTEGER NOT NULL,
  texto       TEXT NOT NULL,
  contexto    TEXT NOT NULL DEFAULT '',
  seccion     TEXT,                    -- JSON string[]
  ancla       TEXT NOT NULL,           -- JSON Ancla
  ancla_fin   TEXT,                    -- JSON Ancla, si el fragmento cruza unidades
  -- Capa de ortografía modernizada, SOLO para buscar («aſsi» → «asi»). NULL:
  -- aún sin calcular (se rellena al abrir); '': no aporta nada (texto moderno).
  texto_busqueda TEXT
);
CREATE INDEX IF NOT EXISTS fragmentos_doc ON fragmentos(documento, orden);
CREATE INDEX IF NOT EXISTS fragmentos_unidad ON fragmentos(unidad);
CREATE INDEX IF NOT EXISTS fragmentos_sin_busqueda ON fragmentos(n) WHERE texto_busqueda IS NULL;

-- Búsqueda léxica (BM25). Indexa texto + contexto + títulos de sección + la
-- capa normalizada. El texto fiel sigue en la columna 0 (resaltado, frases
-- literales); texto_busqueda va la última para no mover los pesos de bm25().
CREATE VIRTUAL TABLE IF NOT EXISTS fragmentos_fts USING fts5(
  texto, contexto, seccion, texto_busqueda,
  content='fragmentos', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS fragmentos_ai AFTER INSERT ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion, texto_busqueda) VALUES (new.n, new.texto, new.contexto, new.seccion, new.texto_busqueda);
END;
CREATE TRIGGER IF NOT EXISTS fragmentos_ad AFTER DELETE ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(fragmentos_fts, rowid, texto, contexto, seccion, texto_busqueda) VALUES ('delete', old.n, old.texto, old.contexto, old.seccion, old.texto_busqueda);
END;
CREATE TRIGGER IF NOT EXISTS fragmentos_au AFTER UPDATE ON fragmentos BEGIN
  INSERT INTO fragmentos_fts(fragmentos_fts, rowid, texto, contexto, seccion, texto_busqueda) VALUES ('delete', old.n, old.texto, old.contexto, old.seccion, old.texto_busqueda);
  INSERT INTO fragmentos_fts(rowid, texto, contexto, seccion, texto_busqueda) VALUES (new.n, new.texto, new.contexto, new.seccion, new.texto_busqueda);
END;

CREATE TABLE IF NOT EXISTS figuras (
  id          TEXT PRIMARY KEY,
  documento   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  unidad      TEXT NOT NULL,
  imagen      TEXT NOT NULL,
  pie         TEXT,
  descripcion TEXT,
  ancla       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS figuras_doc ON figuras(documento);

-- Espacios vectoriales: quién produjo los vectores.
CREATE TABLE IF NOT EXISTS espacios (
  id          TEXT PRIMARY KEY,        -- «gemini-embedding-2@1536»
  proveedor   TEXT NOT NULL,
  modelo      TEXT NOT NULL,
  version     TEXT,
  dims        INTEGER NOT NULL,
  normalizado INTEGER NOT NULL DEFAULT 1,
  modalidades TEXT NOT NULL,           -- JSON Modalidad[]
  creado      TEXT
);

-- Vectores: float32 little-endian, dims × 4 bytes. Varios espacios por objetivo.
CREATE TABLE IF NOT EXISTS vectores (
  objetivo    TEXT NOT NULL,           -- fragmento | unidad | figura
  id          TEXT NOT NULL,
  espacio     TEXT NOT NULL REFERENCES espacios(id),
  documento   TEXT NOT NULL,
  valores     BLOB NOT NULL,
  PRIMARY KEY (objetivo, id, espacio)
);
CREATE INDEX IF NOT EXISTS vectores_doc ON vectores(documento, espacio);

-- Bloques binarios incrustados (solo en .spdf exportados): original, imágenes.
CREATE TABLE IF NOT EXISTS blobs (
  clave       TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  datos       BLOB NOT NULL
);

-- Procedencia y registro de la ingesta: qué se hizo, con qué, cuánto tardó.
CREATE TABLE IF NOT EXISTS procedencia (
  documento   TEXT NOT NULL,
  fase        TEXT NOT NULL,
  proveedor   TEXT,
  detalle     TEXT,                    -- JSON
  ms          INTEGER,
  cuando      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS procedencia_doc ON procedencia(documento);
`;

/**
 * Parte un guion SQL en sentencias. Respeta comentarios, cadenas entre comillas
 * y los cuerpos BEGIN … END de los disparadores, que llevan «;» dentro.
 */
export function partirSentencias(guion: string): string[] {
  const sentencias: string[] = [];
  let actual = "";
  let profundidad = 0; // dentro de BEGIN … END
  let i = 0;
  const n = guion.length;
  while (i < n) {
    const c = guion[i] as string;
    // Comentario de línea
    if (c === "-" && guion[i + 1] === "-") {
      const fin = guion.indexOf("\n", i);
      i = fin < 0 ? n : fin + 1;
      actual += " ";
      continue;
    }
    // Comentario de bloque
    if (c === "/" && guion[i + 1] === "*") {
      const fin = guion.indexOf("*/", i + 2);
      i = fin < 0 ? n : fin + 2;
      actual += " ";
      continue;
    }
    // Cadenas y nombres entre comillas
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (guion[j] === c) {
          if (guion[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      actual += guion.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Palabras clave BEGIN / END (solo como palabras completas)
    if (/[A-Za-z_]/.test(c) && (i === 0 || !/[A-Za-z0-9_]/.test(guion[i - 1] as string))) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(guion[j] as string)) j++;
      const palabra = guion.slice(i, j).toUpperCase();
      if (palabra === "BEGIN" && /\bCREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(actual)) profundidad++;
      else if (palabra === "END" && profundidad > 0) profundidad--;
      actual += guion.slice(i, j);
      i = j;
      continue;
    }
    if (c === ";" && profundidad === 0) {
      const s = actual.trim();
      if (s) sentencias.push(s);
      actual = "";
      i++;
      continue;
    }
    actual += c;
    i++;
  }
  const s = actual.trim();
  if (s) sentencias.push(s);
  return sentencias;
}

// ---------------------------------------------------------------------------
// Migración 4.0 → 4.1 (capa de ortografía modernizada)
// ---------------------------------------------------------------------------

const DISPARADORES_FTS = ['fragmentos_ai', 'fragmentos_ad', 'fragmentos_au'];

/**
 * Prepara una base 4.0 para el esquema 4.1: el índice FTS5 no admite ALTER, así
 * que se quitan sus disparadores y la tabla virtual, se añade la columna y se
 * deja la marca «fts_pendiente»; `aplicarEsquema` los vuelve a crear, rellena la
 * columna y reconstruye el índice. Cada paso se puede repetir: si algo se corta
 * a medias, la siguiente apertura termina el trabajo.
 */
async function prepararMigracion41(sql: SQL): Promise<boolean> {
  const filas = await sql.ejecutar<{ name: string; sql: string | null }>(
    "SELECT name, sql FROM sqlite_master WHERE name IN ('fragmentos', 'fragmentos_fts', 'spdf')",
  );
  const fragmentos = filas.find((f) => f.name === 'fragmentos');
  if (!fragmentos) return false; // base nueva: el guion lo crea todo
  const fts = filas.find((f) => f.name === 'fragmentos_fts');
  const ftsAlDia = !!fts?.sql && fts.sql.includes('texto_busqueda');
  const conColumna = (fragmentos.sql ?? '').includes('texto_busqueda');
  let pendiente = false;
  if (filas.some((f) => f.name === 'spdf')) {
    const [m] = await sql.ejecutar<{ valor: string }>("SELECT valor FROM spdf WHERE clave = 'fts_pendiente'");
    pendiente = m?.valor === '1';
  }
  if (ftsAlDia && conColumna) return pendiente;
  await sql.ejecutar("CREATE TABLE IF NOT EXISTS spdf (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)");
  await sql.ejecutar("INSERT INTO spdf(clave, valor) VALUES ('fts_pendiente', '1') ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor");
  if (!ftsAlDia) {
    for (const d of DISPARADORES_FTS) await sql.ejecutar(`DROP TRIGGER IF EXISTS ${d}`);
    await sql.ejecutar('DROP TABLE IF EXISTS fragmentos_fts');
  }
  if (!conColumna) await sql.ejecutar('ALTER TABLE fragmentos ADD COLUMN texto_busqueda TEXT');
  return true;
}

/** Idioma y época de un documento, para calcular su capa de búsqueda. */
export interface ContextoBusqueda {
  idioma: string | null;
  epoca: Epoca;
}

/**
 * Idioma y época de un documento de la base: el idioma de `documentos` (o de sus
 * metadatos), el año de la obra original o de la edición y, si hace falta, las
 * señales de su propio texto (`muestra`, o los primeros fragmentos guardados).
 */
export async function contextoBusqueda(sql: SQL, documento: string, muestra?: readonly string[]): Promise<ContextoBusqueda> {
  const [d] = await sql.ejecutar<{ idioma: string | null; anio: number | null; metadatos: string | null }>(
    'SELECT idioma, anio, metadatos FROM documentos WHERE id = ?', documento,
  );
  let idioma = d?.idioma ?? null;
  let anio: number | null = d?.anio ?? null;
  if (d?.metadatos) {
    try {
      const m = JSON.parse(d.metadatos) as { idioma?: string; anio?: number; anioOriginal?: number };
      idioma ??= m.idioma ?? null;
      anio = m.anioOriginal ?? anio ?? m.anio ?? null;
    } catch { /* metadatos ilegibles: se sigue con las columnas */ }
  }
  const lengua = lenguaDe(idioma);
  if (lengua === 'otra') return { idioma, epoca: 'moderna' };
  if (lengua === 'la') return { idioma, epoca: 'antigua' };
  let textos = muestra;
  if (!textos?.length) {
    textos = (await sql.ejecutar<{ texto: string }>('SELECT texto FROM fragmentos WHERE documento = ? ORDER BY orden LIMIT 400', documento)).map((f) => f.texto);
  }
  return { idioma, epoca: epocaDeDocumento(textos, idioma, anio) };
}

/**
 * Calcula `texto_busqueda` de los fragmentos que aún no la tienen (NULL): los de
 * una base recién migrada de 4.0 y los que alguien insertó con SQL a mano. Va por
 * lotes y en orden de `n`. Devuelve cuántos fragmentos ha rellenado.
 */
export async function rellenarTextoBusqueda(sql: SQL, opciones: { lote?: number; documento?: string } = {}): Promise<number> {
  const lote = opciones.lote ?? 500;
  const contextos = new Map<string, ContextoBusqueda>();
  let ultimo = Number.MIN_SAFE_INTEGER;
  let total = 0;
  const filtro = opciones.documento ? ' AND documento = ?' : '';
  for (;;) {
    const params: ValorSQL[] = [ultimo, ...(opciones.documento ? [opciones.documento] : []), lote];
    const filas = await sql.ejecutar<{ n: number; documento: string; texto: string }>(
      `SELECT n, documento, texto FROM fragmentos WHERE texto_busqueda IS NULL AND n > ?${filtro} ORDER BY n LIMIT ?`,
      ...params,
    );
    if (!filas.length) break;
    for (const f of filas) if (!contextos.has(f.documento)) contextos.set(f.documento, await contextoBusqueda(sql, f.documento));
    await sql.transaccion(async (t) => {
      for (const f of filas) {
        const c = contextos.get(f.documento) as ContextoBusqueda;
        await t.ejecutar('UPDATE fragmentos SET texto_busqueda = ? WHERE n = ?', textoBusqueda(f.texto ?? '', c.idioma, c.epoca), f.n);
      }
    });
    ultimo = Number((filas[filas.length - 1] as { n: number }).n);
    total += filas.length;
    if (filas.length < lote) break;
  }
  return total;
}

/**
 * Crea (o completa) el esquema SPDF 4.1 sobre cualquier puerto SQL, y migra una
 * base 4.0 si la encuentra. Es idempotente: todas las sentencias llevan IF NOT
 * EXISTS y la migración mira antes qué falta. Las plataformas que no permiten
 * PRAGMA user_version (Durable Objects) se conforman con la tabla `spdf`.
 *
 * Al terminar, rellena la capa de búsqueda de los fragmentos que no la tengan
 * (`rellenar: false` lo evita; el índice parcial lo hace barato cuando no hay nada).
 */
/**
 * Columna `unidades.palabras` (instantes por palabra de audio y vídeo): se añade
 * a las bases que no la tienen. Repetirlo no hace nada.
 */
async function migrarPalabras(sql: SQL): Promise<void> {
  const [t] = await sql.ejecutar<{ sql: string | null }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'unidades'");
  if (t && !/\bpalabras\b/.test(t.sql ?? '')) await sql.ejecutar('ALTER TABLE unidades ADD COLUMN palabras TEXT');
}

/**
 * Reparación de una sola vez de los documentos migrados de la v1/v3 con el
 * migrador antiguo: unidades numeradas desde 1 (el contrato es desde 0; la web
 * dejaba la primera fila de páginas en esqueleto) y el marcado de la OCR vieja
 * dentro del texto («![](page=0,bbox=[…])», «<div align="center">»). Queda
 * anotada en la tabla `spdf`; repetirla no hace nada.
 */
export const REPARACION_MIGRADOS = 'reparacion_migrados_v3_1';
export async function repararMigrados(sql: SQL): Promise<{ renumerados: number; textos: number }> {
  const [hecha] = await sql.ejecutar<{ valor: string }>('SELECT valor FROM spdf WHERE clave = ?', REPARACION_MIGRADOS);
  if (hecha) return { renumerados: 0, textos: 0 };
  // Solo documentos migrados (lector de v3) cuya numeración entera empieza en 1.
  const docs = await sql.ejecutar<{ documento: string }>(
    "SELECT documento FROM unidades GROUP BY documento HAVING MIN(orden) = 1 AND SUM(CASE WHEN lector LIKE 'scholaris-v3%' THEN 1 ELSE 0 END) > 0",
  );
  for (const d of docs) await sql.ejecutar('UPDATE unidades SET orden = orden - 1 WHERE documento = ?', d.documento);
  let textos = 0;
  const sucias = "(texto LIKE '%](page=%' OR texto LIKE '%![](%' OR texto LIKE '%<div align%' OR texto LIKE '%</div>%')";
  for (const u of await sql.ejecutar<{ id: string; texto: string }>(`SELECT id, texto FROM unidades WHERE ${sucias}`)) {
    const limpio = limpiarMarcadoOCR(u.texto ?? '');
    if (limpio !== u.texto) { await sql.ejecutar('UPDATE unidades SET texto = ? WHERE id = ?', limpio, u.id); textos++; }
  }
  let fragmentos = 0;
  for (const f of await sql.ejecutar<{ n: number; texto: string }>(`SELECT n, texto FROM fragmentos WHERE ${sucias}`)) {
    const limpio = limpiarMarcadoOCR(f.texto ?? '');
    if (limpio !== f.texto) { await sql.ejecutar('UPDATE fragmentos SET texto = ?, texto_busqueda = NULL WHERE n = ?', limpio, f.n); fragmentos++; }
  }
  if (fragmentos) await rellenarTextoBusqueda(sql);
  await sql.ejecutar("INSERT INTO spdf(clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", REPARACION_MIGRADOS, new Date().toISOString());
  return { renumerados: docs.length, textos: textos + fragmentos };
}

export async function aplicarEsquema(sql: SQL, opciones: { generador?: string; rellenar?: boolean } = {}): Promise<void> {
  await migrarPalabras(sql);
  const reconstruir = await prepararMigracion41(sql);
  // Con los disparadores quitados, rellenar la columna no toca el índice: va rápido.
  if (reconstruir && opciones.rellenar !== false) await rellenarTextoBusqueda(sql);
  for (const sentencia of partirSentencias(ESQUEMA_V4)) {
    await sql.ejecutar(sentencia);
  }
  if (reconstruir) {
    await sql.ejecutar("INSERT INTO fragmentos_fts(fragmentos_fts) VALUES ('rebuild')");
    await sql.ejecutar("DELETE FROM spdf WHERE clave = 'fts_pendiente'");
  } else if (opciones.rellenar !== false) {
    // Fragmentos insertados a mano sin capa: los disparadores ya mantienen el índice.
    await rellenarTextoBusqueda(sql);
  }
  try {
    await sql.ejecutar(`PRAGMA user_version = ${USER_VERSION_SPDF}`);
  } catch {
    // Plataforma sin PRAGMA: la versión queda en la tabla spdf.
  }
  const ahora = new Date().toISOString();
  await sql.ejecutar("INSERT INTO spdf(clave, valor) VALUES ('spdf_version', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", VERSION_SPDF);
  await sql.ejecutar("INSERT INTO spdf(clave, valor) VALUES ('creado', ?) ON CONFLICT(clave) DO NOTHING", ahora);
  if (opciones.generador) {
    await sql.ejecutar("INSERT INTO spdf(clave, valor) VALUES ('generador', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", opciones.generador);
  }
  await repararMigrados(sql);
}
