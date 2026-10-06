/**
 * Esquema de las funciones de investigación, dentro de la estantería de cada
 * usuario (junto al esquema SPDF 4.0). Todas las tablas son por usuario: no hay
 * forma de consultar las de otro.
 *
 * Las relaciones se declaran con claves foráneas, pero el código borra los
 * hijos a mano: no todas las plataformas activan `foreign_keys`.
 */

import type { SQL } from '@scholaris/nucleo';

export const VERSION_ESQUEMA_FUNCIONES = 1;

export const SENTENCIAS_FUNCIONES: readonly string[] = [
  // --- Ajustes (grabación, versión del esquema, preferencias) -------------
  `CREATE TABLE IF NOT EXISTS funciones_ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT
  )`,

  // --- Historial de búsquedas ---------------------------------------------
  `CREATE TABLE IF NOT EXISTS historial (
    n               INTEGER PRIMARY KEY,
    id              TEXT NOT NULL UNIQUE,
    correlacion     TEXT,
    tipo            TEXT NOT NULL DEFAULT 'busqueda', -- busqueda | respuesta | multilingue | verificacion | similares
    consulta        TEXT NOT NULL,
    intencion       TEXT,
    biblioteca      TEXT,
    documento       TEXT,
    tipo_medio      TEXT,
    filtros         TEXT,            -- JSON Filtros
    idioma          TEXT,
    verbosidad      INTEGER NOT NULL DEFAULT 1,
    pro             INTEGER NOT NULL DEFAULT 0,
    estado          TEXT NOT NULL,   -- ok | error | cancelada
    codigo_error    TEXT,
    mensaje_error   TEXT,
    n_resultados    INTEGER NOT NULL DEFAULT 0,
    respuesta       TEXT,
    confianza       TEXT,            -- alta | media | baja
    resumen         TEXT,
    refinamientos   TEXT,            -- JSON
    resultados      TEXT,            -- JSON (los diez primeros, compactos)
    espacio         TEXT,            -- espacio vectorial del vector de la consulta
    vector          BLOB,            -- float32 de la consulta (insights)
    ms              INTEGER,
    ms_redactor     INTEGER,
    ms_busqueda     INTEGER,
    ms_reordenacion INTEGER,
    redactada       INTEGER NOT NULL DEFAULT 0,
    fijada          INTEGER NOT NULL DEFAULT 0,
    nota            TEXT,
    creada          TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS historial_creada ON historial(creada)`,
  `CREATE INDEX IF NOT EXISTS historial_intencion ON historial(intencion)`,
  `CREATE INDEX IF NOT EXISTS historial_biblioteca ON historial(biblioteca)`,
  `CREATE INDEX IF NOT EXISTS historial_fijada ON historial(fijada) WHERE fijada = 1`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS historial_fts USING fts5(
    consulta, respuesta, resumen, nota,
    content='historial', content_rowid='n',
    tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE TRIGGER IF NOT EXISTS historial_ai AFTER INSERT ON historial BEGIN
    INSERT INTO historial_fts(rowid, consulta, respuesta, resumen, nota)
    VALUES (new.n, new.consulta, coalesce(new.respuesta, ''), coalesce(new.resumen, ''), coalesce(new.nota, ''));
  END`,
  `CREATE TRIGGER IF NOT EXISTS historial_ad AFTER DELETE ON historial BEGIN
    INSERT INTO historial_fts(historial_fts, rowid, consulta, respuesta, resumen, nota)
    VALUES ('delete', old.n, old.consulta, coalesce(old.respuesta, ''), coalesce(old.resumen, ''), coalesce(old.nota, ''));
  END`,
  `CREATE TRIGGER IF NOT EXISTS historial_au AFTER UPDATE ON historial BEGIN
    INSERT INTO historial_fts(historial_fts, rowid, consulta, respuesta, resumen, nota)
    VALUES ('delete', old.n, old.consulta, coalesce(old.respuesta, ''), coalesce(old.resumen, ''), coalesce(old.nota, ''));
    INSERT INTO historial_fts(rowid, consulta, respuesta, resumen, nota)
    VALUES (new.n, new.consulta, coalesce(new.respuesta, ''), coalesce(new.resumen, ''), coalesce(new.nota, ''));
  END`,
  // Registro paso a paso de cada búsqueda (para reproducirla).
  `CREATE TABLE IF NOT EXISTS historial_eventos (
    busqueda  TEXT NOT NULL,
    n         INTEGER NOT NULL,
    ms        INTEGER NOT NULL,
    etapa     TEXT,
    datos     TEXT NOT NULL,         -- JSON del evento
    PRIMARY KEY (busqueda, n)
  )`,

  // --- Cuadernos ----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS cuadernos (
    id          TEXT PRIMARY KEY,
    titulo      TEXT NOT NULL,
    cuerpo      TEXT NOT NULL DEFAULT '',
    metadatos   TEXT,
    creado      TEXT NOT NULL,
    actualizado TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cuadernos_tarjetas (
    id          TEXT PRIMARY KEY,
    cuaderno    TEXT NOT NULL REFERENCES cuadernos(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,       -- fragmento | figura | unidad | nota | sintesis
    documento   TEXT,
    objetivo    TEXT,                -- id del fragmento, figura o unidad
    ancla       TEXT,                -- JSON Ancla
    ancla_fin   TEXT,
    pasaje      TEXT,                -- texto literal citado (copia verificada)
    cita        TEXT,                -- «Foucault 1975, p. 23»
    huella      TEXT,                -- huella del pasaje para reverificar
    contenido   TEXT NOT NULL,       -- JSON libre (nota, título, comentario…)
    afirmacion  TEXT,
    respaldo    REAL,
    posicion    INTEGER NOT NULL,
    estado      TEXT NOT NULL,       -- verificada | cambiada | huerfana | libre
    verificada  TEXT,
    creada      TEXT NOT NULL,
    actualizada TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cuadernos_tarjetas_cuaderno ON cuadernos_tarjetas(cuaderno, posicion)`,
  `CREATE INDEX IF NOT EXISTS cuadernos_tarjetas_objetivo ON cuadernos_tarjetas(objetivo)`,
  `CREATE TABLE IF NOT EXISTS cuadernos_sintesis (
    id          TEXT PRIMARY KEY,
    cuaderno    TEXT REFERENCES cuadernos(id) ON DELETE SET NULL,
    peticion    TEXT NOT NULL,
    cuerpo      TEXT NOT NULL,
    fuentes     TEXT NOT NULL,       -- JSON
    confianza   TEXT,
    modelo      TEXT,
    ms          INTEGER,
    creada      TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS cuadernos_sintesis_cuaderno ON cuadernos_sintesis(cuaderno)`,

  // --- Vigilantes y alertas -----------------------------------------------
  `CREATE TABLE IF NOT EXISTS vigilantes (
    id                 TEXT PRIMARY KEY,
    nombre             TEXT NOT NULL,
    consulta           TEXT NOT NULL,
    filtros            TEXT,          -- JSON Filtros
    modo               TEXT NOT NULL, -- manual | al_ingerir | diario | semanal
    alertas            INTEGER NOT NULL DEFAULT 1,
    k                  INTEGER NOT NULL DEFAULT 10,
    ultima_ejecucion   TEXT,
    ultimos_documentos TEXT,          -- JSON string[]
    ultimos_fragmentos TEXT,          -- JSON string[]
    ultima_respuesta   TEXT,
    ultima_confianza   TEXT,
    creado             TEXT NOT NULL,
    actualizado        TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS vigilantes_modo ON vigilantes(modo)`,
  // Cada alerta es un acierto de un vigilante: documentos nuevos o una respuesta que cambia.
  `CREATE TABLE IF NOT EXISTS alertas (
    id                 TEXT PRIMARY KEY,
    vigilante          TEXT NOT NULL REFERENCES vigilantes(id) ON DELETE CASCADE,
    documentos_nuevos  TEXT NOT NULL, -- JSON string[]
    fragmentos_nuevos  TEXT NOT NULL, -- JSON string[]
    cambio             TEXT NOT NULL, -- sin_cambios | confianza_sube | confianza_baja | respuesta_cambia
    disparada_por      TEXT NOT NULL, -- manual | ingesta | programada
    detalle            TEXT,          -- documento ingerido o cadencia
    vista              TEXT,
    creada             TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS alertas_vigilante ON alertas(vigilante, creada)`,
  `CREATE INDEX IF NOT EXISTS alertas_vista ON alertas(vista, creada)`,

  // --- Conceptos ----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS conceptos (
    id          TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL UNIQUE,
    tipo        TEXT NOT NULL,
    genero      TEXT NOT NULL DEFAULT 'cualquiera',
    definicion  TEXT NOT NULL,        -- JSON DefinicionConcepto
    creado      TEXT NOT NULL,
    actualizado TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conceptos_lexicos (
    concepto TEXT NOT NULL,
    idioma   TEXT NOT NULL,
    lexico   TEXT NOT NULL,           -- JSON LexicoConcepto
    origen   TEXT NOT NULL,           -- redactor | semillas
    creado   TEXT NOT NULL,
    PRIMARY KEY (concepto, idioma)
  )`,
  `CREATE TABLE IF NOT EXISTS conceptos_informes (
    id           TEXT PRIMARY KEY,
    concepto     TEXT NOT NULL REFERENCES conceptos(id) ON DELETE CASCADE,
    estado       TEXT NOT NULL,       -- en_cola | en_marcha | hecho | error
    revision     TEXT,                -- huella de la biblioteca analizada
    iniciado     TEXT NOT NULL,
    terminado    TEXT,
    n_fragmentos INTEGER NOT NULL DEFAULT 0,
    n_spans      INTEGER NOT NULL DEFAULT 0,
    fase         TEXT,
    avance       REAL NOT NULL DEFAULT 0,
    manifiesto   TEXT,
    error        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS conceptos_informes_concepto ON conceptos_informes(concepto, iniciado)`,
  `CREATE TABLE IF NOT EXISTS conceptos_spans (
    id                TEXT PRIMARY KEY,
    informe           TEXT NOT NULL REFERENCES conceptos_informes(id) ON DELETE CASCADE,
    documento         TEXT NOT NULL,
    titulo            TEXT,
    autores           TEXT,           -- JSON string[]
    anio              INTEGER,
    idioma            TEXT,
    fragmento         TEXT,
    unidad            TEXT,
    ancla             TEXT,           -- JSON Ancla
    etiqueta          TEXT,           -- «p. 23», «12:04»
    cita              TEXT,           -- «Foucault 1975, p. 23»
    texto             TEXT NOT NULL,
    lema              TEXT,
    categoria         TEXT,
    genero            TEXT,
    numero            TEXT,
    ini               INTEGER,
    fin               INTEGER,
    frase             TEXT,
    frase_ini         INTEGER,
    frase_fin         INTEGER,
    tipo_coincidencia TEXT,
    regla             TEXT,
    puntuacion_regla  REAL,
    semantica         REAL,
    reordenacion      REAL,
    uso               TEXT,           -- definicion | aplicacion | critica | mencion
    veredicto         TEXT,           -- si | no | dudoso
    etiqueta_usuario  TEXT,           -- correcto | incorrecto | dudoso
    razon             TEXT,
    confianza         REAL NOT NULL,
    justificacion     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS conceptos_spans_informe ON conceptos_spans(informe, confianza)`,
  `CREATE INDEX IF NOT EXISTS conceptos_spans_documento ON conceptos_spans(informe, documento)`,
  `CREATE INDEX IF NOT EXISTS conceptos_spans_lema ON conceptos_spans(informe, lema)`,
  `CREATE TABLE IF NOT EXISTS conceptos_etiquetas (
    id       TEXT PRIMARY KEY,
    span     TEXT NOT NULL REFERENCES conceptos_spans(id) ON DELETE CASCADE,
    etiqueta TEXT NOT NULL,           -- correcto | incorrecto | dudoso
    nota     TEXT,
    creada   TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS conceptos_etiquetas_span ON conceptos_etiquetas(span)`,

  // --- Mapa de conceptos --------------------------------------------------
  `CREATE TABLE IF NOT EXISTS mapa_meta (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    ejecucion_activa TEXT,
    construido       TEXT,
    n_grupos         INTEGER,
    n_puntos         INTEGER,
    n_proyectados    INTEGER,
    ms               INTEGER,
    espacio          TEXT,
    reduccion        TEXT             -- JSON: cómo se reducen los vectores (para comparar consultas)
  )`,
  `CREATE TABLE IF NOT EXISTS mapa_grupos (
    ejecucion   TEXT NOT NULL,
    indice      INTEGER NOT NULL,
    etiqueta    TEXT,
    confianza   REAL,
    descripcion TEXT,
    tamano      INTEGER NOT NULL,
    mezcla      TEXT,                 -- JSON {objetivo: n}
    documentos  TEXT,                 -- JSON string[] (los más representados)
    x           REAL NOT NULL,
    y           REAL NOT NULL,
    centroide   BLOB,                 -- float32 en el espacio reducido
    PRIMARY KEY (ejecucion, indice)
  )`,
  `CREATE TABLE IF NOT EXISTS mapa_puntos (
    ejecucion  TEXT NOT NULL,
    grupo      INTEGER NOT NULL,
    objetivo   TEXT NOT NULL,         -- fragmento | unidad | figura
    id         TEXT NOT NULL,
    documento  TEXT NOT NULL,
    x          REAL NOT NULL,
    y          REAL NOT NULL,
    distancia  REAL NOT NULL,
    proyectado INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS mapa_puntos_grupo ON mapa_puntos(ejecucion, grupo, distancia)`,
  `CREATE INDEX IF NOT EXISTS mapa_puntos_documento ON mapa_puntos(documento)`,

  // --- Grafo de citas -----------------------------------------------------
  `CREATE TABLE IF NOT EXISTS grafo_referencias (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    origen    TEXT NOT NULL,
    texto     TEXT NOT NULL,
    doi       TEXT,
    titulo    TEXT,
    autores   TEXT,                   -- JSON string[] (apellidos)
    anio      INTEGER,
    resuelto  TEXT,                   -- documento de la biblioteca al que apunta
    via       TEXT,                   -- doi | titulo_anio | autor_anio | doi_en_texto
    confianza REAL,
    UNIQUE (origen, texto)
  )`,
  `CREATE INDEX IF NOT EXISTS grafo_referencias_resuelto ON grafo_referencias(resuelto)`,
  `CREATE INDEX IF NOT EXISTS grafo_referencias_doi ON grafo_referencias(doi)`,
  `CREATE TABLE IF NOT EXISTS grafo_aristas (
    origen     TEXT NOT NULL,
    destino    TEXT NOT NULL,
    tipo       TEXT NOT NULL,         -- cita | menciona
    via        TEXT NOT NULL,
    confianza  REAL NOT NULL,
    referencia TEXT,
    PRIMARY KEY (origen, destino, tipo)
  )`,
  `CREATE INDEX IF NOT EXISTS grafo_aristas_destino ON grafo_aristas(destino)`,

  // --- Corpus -------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS corpus_instantanea (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    datos      TEXT NOT NULL,         -- JSON InstantaneaCorpus
    construida TEXT NOT NULL,
    ms         INTEGER
  )`,

  // --- Insights -----------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS insights_aperturas (
    n          INTEGER PRIMARY KEY,
    documento  TEXT NOT NULL,
    objetivo   TEXT NOT NULL,         -- fragmento | unidad | figura | documento
    id         TEXT,
    superficie TEXT NOT NULL,         -- visor | busqueda | cuaderno | mapa…
    abierta    TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS insights_aperturas_documento ON insights_aperturas(documento)`,
  `CREATE TABLE IF NOT EXISTS insights_descartes (
    documento  TEXT PRIMARY KEY,
    descartado TEXT NOT NULL
  )`,
];

/** El esquema completo, legible, por si alguien lo quiere volcar o comparar. */
export const esquemaFunciones = SENTENCIAS_FUNCIONES.map((s) => s.trim() + ';').join('\n\n');

/** Crea (o completa) las tablas de las funciones. Idempotente. */
export async function aplicarEsquemaFunciones(sql: SQL): Promise<void> {
  for (const s of SENTENCIAS_FUNCIONES) await sql.ejecutar(s);
  await sql.ejecutar(
    `INSERT INTO funciones_ajustes (clave, valor) VALUES ('esquema_funciones', ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    String(VERSION_ESQUEMA_FUNCIONES),
  );
}

/** Tablas de las funciones, en orden de borrado seguro (hijos primero). */
export const TABLAS_FUNCIONES = [
  'historial_eventos', 'historial',
  'cuadernos_sintesis', 'cuadernos_tarjetas', 'cuadernos',
  'alertas', 'vigilantes',
  'conceptos_etiquetas', 'conceptos_spans', 'conceptos_informes', 'conceptos_lexicos', 'conceptos',
  'mapa_puntos', 'mapa_grupos', 'mapa_meta',
  'grafo_aristas', 'grafo_referencias',
  'corpus_instantanea',
  'insights_aperturas', 'insights_descartes',
  'funciones_ajustes',
] as const;
