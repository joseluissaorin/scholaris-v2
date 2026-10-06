# Notas de @scholaris/funciones para el orquestador

Estas son las cosas en las que el contrato (`packages/contrato/src/funciones.ts` y `cuenta.ts`) y la lógica no encajan del todo, y las decisiones que he tomado.

## Contrato

- **Campos de más.** Las respuestas cumplen los tipos del contrato y en algunos casos llevan campos extra: `TarjetaCompleta.estado`/`respaldo`, `SintesisCompleta.confianza`, `AlertaCompleta.tipoCambio`, `TramoCompleto.citaCorta`/`frase`/`lema`… También `Arqueologia.linea`, que es la línea temporal de temas de la versión anterior; el contrato solo tiene `olvidados`.
- **Rutas de más:**
  - `GET /historial/:id/reproducir` (SSE; `?velocidad=original` respeta los tiempos)
  - `POST /alertas/vistas`
  - `POST /perspectivas/recomendaciones/:documento/descartar`
  - `GET /historial` también admite `confianza` y `biblioteca`
  - `GET /grafo` también admite `confianzaMinima` y `todos`
- **Formatos de exportación de conceptos.** El contrato dice `csv|json`. Además se admiten `jsonl`, `html`, `bibtex`, `tei` y `xlsx`, que el Scholaris anterior ya tenía.
- **Progreso en tiempo real.** En `EventoTiempoReal`, la variante `progreso` lleva un `Progreso` de ingesta (`FaseIngesta`), que no sirve para el mapa ni para los conceptos. Por eso:
  - el mapa (y los conceptos, si se pide `Accept: text/event-stream`) emiten su progreso por SSE en la propia respuesta;
  - por el emisor solo sale `{ tipo: 'fin', tarea: <informe>, estado }`.

  Si se quiere progreso por WebSocket, haría falta una variante genérica, por ejemplo `{ tipo: 'progreso_tarea'; tarea; fase: string; avance; mensaje }`.
- **`tarea` de `/conceptos/:id/ejecutar`.** Es el id del informe, porque no tengo acceso al registro de tareas de la plataforma.
  - Con `enSegundoPlano` (waitUntil), la ruta responde 202 y sigue trabajando.
  - Sin él, la ruta trabaja antes de responder y devuelve 201.
- **`AristaGrafo.unidades`.** Son las páginas físicas donde está la referencia en la bibliografía.
- **`/privacidad/purgar`.** Borra todas las tablas de las funciones y de la estantería (SPDF). Los originales del almacén y los vectores de Vectorize son de la plataforma. `purgarTodo` devuelve los recuentos para el `ResultadoPurga`.
- **Multilingüe.** El router `multilingual.py` del Scholaris anterior queda en `/busqueda/multilingue`, que es de la plataforma. Aquí no hay ruta para eso.

## Plataforma

- **Montaje.** Las rutas se montan con `rutasFunciones(api)` (o grupo a grupo). El middleware tiene que poner `c.set('funciones', PuertosFunciones)`.
- **Esquema.** Hay que llamar a `aplicarEsquemaFunciones(sql)` después del esquema SPDF 4.0, porque usa `fragmentos.n` como rowid de FTS.
- **Enganches.** La plataforma tiene que llamar a:
  - `registrarBusqueda` / `GrabadorBusqueda`: en `/busqueda*`
  - `alIngerirDocumento`: tras cada ingesta
  - `alBorrarDocumento`: tras borrar un documento
  - `ejecutarVigilantesProgramados`: en el cron diario y en el semanal
- **Límite de parámetros.** Los INSERT por lotes respetan el límite de 100 parámetros de D1 y del Durable Object.
- **Filtros con muchos documentos.** Un filtro `documentos` con más de unos 90 ids en un vigilante o en un concepto superaría ese límite. Falta trocearlo, y sería raro que pasara.

## Pruebas

- **sql.js.** No trae FTS5 (`no such module: fts5`), y el esquema SPDF 4.0 lo necesita. Por eso las pruebas usan better-sqlite3 en memoria (dependencia de desarrollo), que es lo mismo que monta `apps/local`.
- **Hono.** Es dependencia de desarrollo y `peerDependency` (solo se importan tipos). Las pruebas de rutas montan las funciones en un `Hono` con más variables que las nuestras, como hará la plataforma.

## Huecos funcionales

- **Extracción de conceptos.** La versión ligera no tiene spaCy, WordNet ni concordancia de género por morfología. Las tildes y los plurales salen de reglas, y el léxico por idioma lo genera el redactor y se guarda.
  - Los léxicos curados del Scholaris anterior (`lexicons/*.json`) no están incluidos.
  - Los conceptos de género dependen del léxico generado.
- **Muestreo del mapa.** El mapa coloca con UMAP una muestra estratificada de hasta 8000 puntos. El resto se pone junto a sus vecinos muestreados (`proyectado = 0`).
- **Etiquetas del mapa.** Están en español por defecto (`idioma: 'en'` para inglés).
