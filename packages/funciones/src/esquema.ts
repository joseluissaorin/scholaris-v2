/**
 * Esquema de las funciones de investigación, dentro de la estantería de cada
 * usuario (junto al esquema SPDF 4.0). Todas las tablas son por usuario: no hay
 * forma de consultar las de otro.
 *
 * Las relaciones se declaran con claves foráneas, pero el código borra los
 * hijos a mano: no todas las plataformas activan `foreign_keys`.
 */

import type { SQL } from '@scholaris/nucleo';

export const VERSION_ESQUEMA_FUNCIONES = 2;

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
    cita        TEXT,                -- «Darwin 1859, p. 81»
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
    cita              TEXT,           -- «Darwin 1859, p. 81»
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
    fragmento TEXT,                   -- fragmento donde aparece la referencia
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

  // --- Entidades (grafo de conocimiento de la biblioteca) ----------------
  // Una entidad por (tipo, clave normalizada). Al fusionar dos, la que pierde
  // queda con `fusionada_en` para que sus enlaces y su clave sigan resolviendo.
  `CREATE TABLE IF NOT EXISTS entidades (
    id           TEXT PRIMARY KEY,
    tipo         TEXT NOT NULL,       -- persona | obra | lugar | organizacion | concepto | evento | fecha
    clave        TEXT NOT NULL,       -- nombre normalizado (minúsculas, sin diacríticos)
    nombre       TEXT NOT NULL,
    alias        TEXT NOT NULL DEFAULT '[]', -- JSON string[]
    busqueda     TEXT NOT NULL DEFAULT '', -- «|clave|alias1|alias2|» normalizados, para buscar por cualquier forma
    wikidata     TEXT,
    descripcion  TEXT,
    wikidata_visto INTEGER NOT NULL DEFAULT 0,
    ficticia     INTEGER,             -- 1 personaje de ficción, 0 persona real, null sin saber
    fusionada_en TEXT,
    n_menciones  INTEGER NOT NULL DEFAULT 0,
    n_documentos INTEGER NOT NULL DEFAULT 0,
    creada       TEXT NOT NULL,
    actualizada  TEXT NOT NULL,
    UNIQUE (tipo, clave)
  )`,
  `CREATE INDEX IF NOT EXISTS entidades_activas ON entidades(fusionada_en, n_menciones)`,
  `CREATE INDEX IF NOT EXISTS entidades_qid ON entidades(wikidata) WHERE wikidata IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS menciones (
    id         TEXT PRIMARY KEY,
    entidad    TEXT NOT NULL,
    documento  TEXT NOT NULL,
    fragmento  TEXT NOT NULL,
    orden      INTEGER NOT NULL,      -- orden del fragmento en el documento
    texto      TEXT NOT NULL,         -- la forma tal como aparece
    normalizado TEXT NOT NULL,        -- el nombre canónico que dio el redactor
    tipo       TEXT NOT NULL,
    ini        INTEGER NOT NULL,      -- desplazamiento en el texto del fragmento
    fin        INTEGER NOT NULL,
    ancla      TEXT NOT NULL          -- JSON Ancla (la del fragmento)
  )`,
  `CREATE INDEX IF NOT EXISTS menciones_entidad ON menciones(entidad, documento, orden)`,
  `CREATE INDEX IF NOT EXISTS menciones_documento ON menciones(documento, orden)`,
  `CREATE INDEX IF NOT EXISTS menciones_fragmento ON menciones(fragmento)`,
  // Coapariciones por documento (a < b); el peso global es la suma.
  `CREATE TABLE IF NOT EXISTS aristas_entidades (
    a            TEXT NOT NULL,
    b            TEXT NOT NULL,
    documento    TEXT NOT NULL,
    peso         REAL NOT NULL,
    coapariciones INTEGER NOT NULL,
    fragmento    TEXT,                -- el pasaje donde están más cerca
    PRIMARY KEY (a, b, documento)
  )`,
  `CREATE INDEX IF NOT EXISTS aristas_entidades_b ON aristas_entidades(b)`,
  `CREATE INDEX IF NOT EXISTS aristas_entidades_documento ON aristas_entidades(documento)`,
  `CREATE TABLE IF NOT EXISTS entidades_relaciones (
    a          TEXT NOT NULL,
    b          TEXT NOT NULL,
    etiqueta   TEXT,                  -- null: se preguntó y no hay relación nombrable
    documento  TEXT,
    fragmento  TEXT,
    creada     TEXT NOT NULL,
    PRIMARY KEY (a, b)
  )`,
  // Trabajo de extracción por documento: idempotente y reanudable por lotes.
  `CREATE TABLE IF NOT EXISTS entidades_trabajos (
    documento    TEXT PRIMARY KEY,
    estado       TEXT NOT NULL,       -- pendiente | en_marcha | hecho | error | sin_redactor
    huella       TEXT,                -- huella de los fragmentos procesados
    lotes        INTEGER NOT NULL DEFAULT 0,
    hechos       TEXT NOT NULL DEFAULT '[]', -- JSON number[] (lotes terminados)
    tokens_entrada INTEGER NOT NULL DEFAULT 0,
    tokens_salida  INTEGER NOT NULL DEFAULT 0,
    llamadas     INTEGER NOT NULL DEFAULT 0,
    usd          REAL NOT NULL DEFAULT 0,
    error        TEXT,
    iniciado     TEXT NOT NULL,
    actualizado  TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entidades_wikidata (
    consulta  TEXT NOT NULL,
    idioma    TEXT NOT NULL,
    respuesta TEXT NOT NULL,          -- JSON de wbsearchentities (recortado)
    creada    TEXT NOT NULL,
    PRIMARY KEY (consulta, idioma)
  )`,

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

/**
 * Columnas que se añadieron después de crear una tabla (o que una base a medio
 * crear puede no tener). `ALTER TABLE … ADD COLUMN` solo admite columnas con
 * valor por defecto o anulables, y así están declaradas.
 */
export const COLUMNAS_TARDIAS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  entidades: [
    ['alias', "TEXT NOT NULL DEFAULT '[]'"],
    ['busqueda', "TEXT NOT NULL DEFAULT ''"],
    ['wikidata', 'TEXT'],
    ['descripcion', 'TEXT'],
    ['wikidata_visto', 'INTEGER NOT NULL DEFAULT 0'],
    ['fusionada_en', 'TEXT'],
    ['n_menciones', 'INTEGER NOT NULL DEFAULT 0'],
    ['n_documentos', 'INTEGER NOT NULL DEFAULT 0'],
    ['ficticia', 'INTEGER'],
  ],
};

/** Tipo y nombre del objeto que crea una sentencia («table», «entidades»). */
export function objetoDeSentencia(s: string): { tipo: 'table' | 'index' | 'trigger'; nombre: string } | null {
  const m = /^\s*CREATE\s+(VIRTUAL\s+TABLE|TABLE|INDEX|UNIQUE\s+INDEX|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(s);
  if (!m) return null;
  const t = m[1]!.toUpperCase();
  return { tipo: t.includes('TABLE') ? 'table' : t.includes('INDEX') ? 'index' : 'trigger', nombre: m[2]! };
}

async function columnasDe(sql: SQL, tabla: string): Promise<Set<string>> {
  const t = tabla.replace(/[^\w]/g, '');
  let filas: Array<{ name: string }>;
  try {
    filas = await sql.ejecutar<{ name: string }>(`SELECT name FROM pragma_table_info('${t}')`);
  } catch {
    // Algunas plataformas no admiten las funciones de pragma; la sentencia sí.
    filas = await sql.ejecutar<{ name: string }>(`PRAGMA table_info(${t})`);
  }
  return new Set(filas.map((f) => String(f.name)));
}

/**
 * Crea (o completa, o repara) las tablas de las funciones. Idempotente, y
 * aguanta una base a medio crear:
 *   1. si un nombre que el esquema necesita lo ocupa un objeto de otro tipo
 *      (un índice con el nombre de una tabla), el índice se quita: los índices
 *      se rehacen, las tablas nunca se borran;
 *   2. se crean las tablas;
 *   3. se añaden las columnas que falten (`COLUMNAS_TARDIAS`);
 *   4. índices y disparadores.
 * Si una sentencia falla se siguen aplicando las demás y al final se lanza un
 * error con todas: una tabla rota no deja sin crear las otras.
 */
export async function aplicarEsquemaFunciones(sql: SQL): Promise<void> {
  const existentes = new Map(
    (await sql.ejecutar<{ type: string; name: string }>("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view')"))
      .map((f) => [String(f.name), String(f.type)]),
  );
  const errores: string[] = [];
  const intentar = async (s: string) => {
    try { await sql.ejecutar(s); } catch (e) { errores.push(`${objetoDeSentencia(s)?.nombre ?? s.slice(0, 60)}: ${(e as Error).message}`); }
  };
  // 1. Nombres ocupados por un objeto de otro tipo.
  for (const s of SENTENCIAS_FUNCIONES) {
    const o = objetoDeSentencia(s);
    if (!o) continue;
    const tipo = existentes.get(o.nombre);
    if (!tipo || tipo === o.tipo) continue;
    if (tipo === 'index') await intentar(`DROP INDEX IF EXISTS "${o.nombre}"`);
    else if (tipo === 'trigger') await intentar(`DROP TRIGGER IF EXISTS "${o.nombre}"`);
    else errores.push(`${o.nombre}: el nombre lo ocupa un objeto de tipo ${tipo}`);
  }
  // 2. Tablas.
  const tablas = SENTENCIAS_FUNCIONES.filter((s) => objetoDeSentencia(s)?.tipo === 'table');
  for (const s of tablas) await intentar(s);
  // 3. Columnas que falten.
  for (const [tabla, columnas] of Object.entries(COLUMNAS_TARDIAS)) {
    try {
      const hay = await columnasDe(sql, tabla);
      if (!hay.size) continue;
      for (const [c, def] of columnas) if (!hay.has(c)) await intentar(`ALTER TABLE ${tabla} ADD COLUMN ${c} ${def}`);
    } catch (e) {
      errores.push(`${tabla}: ${(e as Error).message}`);
    }
  }
  // 4. El resto (índices, disparadores).
  for (const s of SENTENCIAS_FUNCIONES) if (!tablas.includes(s)) await intentar(s);
  if (errores.length) throw new Error(`Esquema de funciones incompleto: ${errores.join(' · ')}`);
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
  'menciones', 'aristas_entidades', 'entidades_relaciones', 'entidades_trabajos', 'entidades_wikidata', 'entidades',
  'corpus_instantanea',
  'insights_aperturas', 'insights_descartes',
  'funciones_ajustes',
] as const;
