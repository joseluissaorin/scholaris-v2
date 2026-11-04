-- SPDF 4.2: un documento leído y citable, de cualquier cosa, y lo que se entiende de él.
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
-- Durable Object, better-sqlite3), y fija «PRAGMA user_version = 420» solo donde
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

-- ===========================================================================
-- 4.2: la capa de comprensión (docs/COMPRENSION.md). Todo derivado, versionado
-- y anclado: las anclas son JSON con la precisión material opcional
-- («caracteres» [inicio, fin) en puntos de código NFC, «region» {x,y,w,h} en
-- fracciones de la imagen de la unidad, «instante» en vídeo). Las evidencias son
-- listas JSON de {documento, ancla, anclaFin?, cita?, modo, unidad?, fragmento?, figura?}.
-- En SPDF 5.0 viaja como extensión opcional «x_scholaris_comprension».
-- ===========================================================================

-- Estructura: partes, capítulos, escenas, planos, poemas, temas… en árbol.
CREATE TABLE IF NOT EXISTS segmentos (
  id           TEXT PRIMARY KEY,
  documento    TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  padre        TEXT,
  nivel        INTEGER NOT NULL,
  orden        INTEGER NOT NULL,         -- orden de lectura en todo el árbol (preorden)
  tipo         TEXT NOT NULL,            -- TipoSegmento
  titulo       TEXT NOT NULL,
  ancla        TEXT NOT NULL,            -- JSON AnclaMaterial
  ancla_fin    TEXT,
  unidad_desde TEXT NOT NULL,
  unidad_hasta TEXT NOT NULL,
  resumen      TEXT,
  origen       TEXT NOT NULL,            -- leido | deducido | modelo
  confianza    REAL NOT NULL DEFAULT 1,
  t0           REAL,                     -- desnormalizado en audio y vídeo
  t1           REAL
);
CREATE INDEX IF NOT EXISTS segmentos_doc ON segmentos(documento, orden);

-- Fichas: el análisis de un documento, un segmento, una entidad, una figura o una relación.
CREATE TABLE IF NOT EXISTS fichas (
  n            INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  documento    TEXT,                     -- NULL en las de una entidad o una relación
  objetivo     TEXT NOT NULL,            -- documento | segmento | entidad | figura | relacion
  objetivo_id  TEXT NOT NULL,
  lente        TEXT NOT NULL,
  clase        TEXT NOT NULL,            -- global | escena | capitulo | plano | personaje | …
  idioma       TEXT,
  texto        TEXT NOT NULL,            -- prosa analítica (se busca y se lee)
  datos        TEXT NOT NULL DEFAULT '{}',
  evidencias   TEXT NOT NULL DEFAULT '[]',
  modelo       TEXT NOT NULL,
  version      TEXT NOT NULL,
  creada       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fichas_doc ON fichas(documento, clase);
CREATE INDEX IF NOT EXISTS fichas_objetivo ON fichas(objetivo, objetivo_id);
CREATE VIRTUAL TABLE IF NOT EXISTS fichas_fts USING fts5(
  texto, clase,
  content='fichas', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS fichas_ai AFTER INSERT ON fichas BEGIN
  INSERT INTO fichas_fts(rowid, texto, clase) VALUES (new.n, new.texto, new.clase);
END;
CREATE TRIGGER IF NOT EXISTS fichas_ad AFTER DELETE ON fichas BEGIN
  INSERT INTO fichas_fts(fichas_fts, rowid, texto, clase) VALUES ('delete', old.n, old.texto, old.clase);
END;
CREATE TRIGGER IF NOT EXISTS fichas_au AFTER UPDATE ON fichas BEGIN
  INSERT INTO fichas_fts(fichas_fts, rowid, texto, clase) VALUES ('delete', old.n, old.texto, old.clase);
  INSERT INTO fichas_fts(rowid, texto, clase) VALUES (new.n, new.texto, new.clase);
END;

-- Entidades: una para toda la biblioteca (personas, personajes, lugares, obras, conceptos…).
CREATE TABLE IF NOT EXISTS entidades (
  n            INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  tipo         TEXT NOT NULL,            -- TipoEntidad
  nombre       TEXT NOT NULL,
  alias        TEXT NOT NULL DEFAULT '[]',   -- JSON string[], en cualquier lengua
  etiquetas    TEXT,                     -- JSON {idioma: nombre}
  qid          TEXT,                     -- Wikidata
  descripcion  TEXT,
  datos        TEXT                      -- JSON
);
CREATE INDEX IF NOT EXISTS entidades_qid ON entidades(qid);
CREATE INDEX IF NOT EXISTS entidades_tipo ON entidades(tipo, nombre);
CREATE VIRTUAL TABLE IF NOT EXISTS entidades_fts USING fts5(
  nombre, alias, descripcion,
  content='entidades', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS entidades_ai AFTER INSERT ON entidades BEGIN
  INSERT INTO entidades_fts(rowid, nombre, alias, descripcion) VALUES (new.n, new.nombre, new.alias, new.descripcion);
END;
CREATE TRIGGER IF NOT EXISTS entidades_ad AFTER DELETE ON entidades BEGIN
  INSERT INTO entidades_fts(entidades_fts, rowid, nombre, alias, descripcion) VALUES ('delete', old.n, old.nombre, old.alias, old.descripcion);
END;
CREATE TRIGGER IF NOT EXISTS entidades_au AFTER UPDATE ON entidades BEGIN
  INSERT INTO entidades_fts(entidades_fts, rowid, nombre, alias, descripcion) VALUES ('delete', old.n, old.nombre, old.alias, old.descripcion);
  INSERT INTO entidades_fts(rowid, nombre, alias, descripcion) VALUES (new.n, new.nombre, new.alias, new.descripcion);
END;

-- Menciones: cada aparición de una entidad en un documento.
CREATE TABLE IF NOT EXISTS menciones (
  id           TEXT PRIMARY KEY,
  entidad      TEXT NOT NULL,
  documento    TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
  segmento     TEXT,
  ancla        TEXT NOT NULL,
  ancla_fin    TEXT,
  forma        TEXT NOT NULL,
  rol          TEXT NOT NULL,            -- RolMencion
  confianza    REAL NOT NULL DEFAULT 1,
  t0           REAL,                     -- desnormalizados para ordenar y filtrar
  fisica       INTEGER
);
CREATE INDEX IF NOT EXISTS menciones_entidad ON menciones(entidad, documento);
CREATE INDEX IF NOT EXISTS menciones_doc ON menciones(documento, segmento);

-- Relaciones entre obras (o entre entidades, con «ent:»): adaptación, traducción, edición…
CREATE TABLE IF NOT EXISTS relaciones (
  id           TEXT PRIMARY KEY,
  origen       TEXT NOT NULL,
  destino      TEXT NOT NULL,
  tipo         TEXT NOT NULL,            -- TipoRelacion
  nota         TEXT,
  evidencias   TEXT NOT NULL DEFAULT '[]',
  confianza    REAL NOT NULL DEFAULT 1,
  fuente       TEXT NOT NULL,            -- metadatos | wikidata | modelo | usuario
  creada       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relaciones_origen ON relaciones(origen);
CREATE INDEX IF NOT EXISTS relaciones_destino ON relaciones(destino);

-- Alineaciones: correspondencias finas dentro de una relación (escena ↔ pasaje, traducción ↔ original).
CREATE TABLE IF NOT EXISTS alineaciones (
  id           TEXT PRIMARY KEY,
  relacion     TEXT NOT NULL REFERENCES relaciones(id) ON DELETE CASCADE,
  orden        INTEGER NOT NULL,
  tipo         TEXT NOT NULL,            -- TipoCorrespondencia
  doc_a        TEXT,
  ancla_a      TEXT,
  ancla_fin_a  TEXT,
  segmento_a   TEXT,
  doc_b        TEXT,
  ancla_b      TEXT,
  ancla_fin_b  TEXT,
  segmento_b   TEXT,
  nota         TEXT NOT NULL DEFAULT '',
  confianza    REAL NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS alineaciones_relacion ON alineaciones(relacion, orden);
CREATE INDEX IF NOT EXISTS alineaciones_a ON alineaciones(doc_a, segmento_a);
CREATE INDEX IF NOT EXISTS alineaciones_b ON alineaciones(doc_b, segmento_b);

-- Memoria: preguntas, respuestas, hallazgos, notas e hipótesis de la investigación.
CREATE TABLE IF NOT EXISTS memoria (
  n            INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  tipo         TEXT NOT NULL,            -- TipoRecuerdo
  texto        TEXT NOT NULL,
  evidencias   TEXT NOT NULL DEFAULT '[]',
  documentos   TEXT NOT NULL DEFAULT '[]',
  proyecto     TEXT,
  fuente       TEXT NOT NULL,            -- investigar | usuario | sistema
  creado       TEXT NOT NULL,
  fijado       INTEGER NOT NULL DEFAULT 0,
  padre        TEXT
);
CREATE INDEX IF NOT EXISTS memoria_proyecto ON memoria(proyecto, creado);
CREATE VIRTUAL TABLE IF NOT EXISTS memoria_fts USING fts5(
  texto,
  content='memoria', content_rowid='n',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS memoria_ai AFTER INSERT ON memoria BEGIN
  INSERT INTO memoria_fts(rowid, texto) VALUES (new.n, new.texto);
END;
CREATE TRIGGER IF NOT EXISTS memoria_ad AFTER DELETE ON memoria BEGIN
  INSERT INTO memoria_fts(memoria_fts, rowid, texto) VALUES ('delete', old.n, old.texto);
END;
CREATE TRIGGER IF NOT EXISTS memoria_au AFTER UPDATE ON memoria BEGIN
  INSERT INTO memoria_fts(memoria_fts, rowid, texto) VALUES ('delete', old.n, old.texto);
  INSERT INTO memoria_fts(rowid, texto) VALUES (new.n, new.texto);
END;
