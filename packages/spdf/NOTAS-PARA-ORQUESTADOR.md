# Notas para el orquestador (spdf y folios)

## Motor SQLite: sqlite-wasm oficial, no sql.js

- `sql.js` 1.14 no trae FTS5 («no such module: fts5»). Se usa
  `@sqlite.org/sqlite-wasm` 3.53.4 (la compilación oficial, con FTS5), y se
  ha quitado `sql.js` de las dependencias de `@scholaris/spdf`.
- Node y navegador: sin configuración.
- Workers (workerd): no se puede compilar wasm en tiempo de ejecución, ni el
  `sqlite3.wasm` ni los puentes diminutos que sqlite-wasm compila al arrancar
  (`jsFuncToWasm`). Ambos van precompilados (`wasm/puentes/*.wasm`, regla
  CompiledWasm de wrangler, activa por defecto). En el Worker basta con:

  ```ts
  import { prepararMotorWorkers } from '@scholaris/spdf/workers';
  prepararMotorWorkers();
  ```

  Probado en workerd real (wrangler 4.147 `unstable_dev`): crear, FTS5,
  vectores, exportar/abrir y migrar SPDF v3 de hasta 12 MB dentro del Worker.
- Por defecto se desactivan los VFS persistentes del navegador (OPFS, kvvfs):
  el SPDF vive en memoria. `configurarMotor({ vfsPersistentes: true })` los
  vuelve a activar (solo navegador).

## Cambios al esquema v4 (packages/spdf/esquema/v4.0.sql)

- `fragmentos.n INTEGER PRIMARY KEY` y `id TEXT NOT NULL UNIQUE`: el índice
  FTS5 de contenido externo usa `n` como rowid estable (un rowid implícito
  cambia con VACUUM y desincroniza el índice). `fragmentos.rowid` sigue
  funcionando (es alias de `n`): las consultas que hagan
  `JOIN fragmentos f ON f.rowid = fragmentos_fts.rowid` siguen valiendo.
- `documentos.bibliotecas` (JSON string[]), porque `Documento` lo tiene.
- `espacios.creado`; índices `unidades_impresa`, `fragmentos_unidad`, `procedencia_doc`.
- El `PRAGMA user_version = 400` ya no está en el guion: `aplicarEsquema` lo
  intenta y, si la plataforma no lo permite (Durable Objects), sigue; la
  versión queda en la tabla `spdf`. La fuente de verdad es `ESQUEMA_V4`
  (`src/esquema.ts`); una prueba comprueba que el .sql coincide.

## Dependencias

- `@scholaris/spdf` depende ahora de `@scholaris/folios` (el migrador revisa
  los folios de v3).
- `pnpm-lock.yaml` cambió al añadir `@sqlite.org/sqlite-wasm` y
  `@scholaris/folios`; no lo he incluido en mis commits (solo toco mis
  paquetes): conviene confirmarlo junto con el resto.
- `tsconfig.json` de spdf y folios incluye `"types": ["node"]` (las pruebas
  usan `node:fs`, `node:sqlite` y `node:zlib`; el código de `src` no usa Node).

## Juez (Jev) en folios

- `elegirConJuez` hace UNA llamada con hasta 100 preguntas `eleccion` (una
  por página dudosa). El estado de cada lote lleva solo sus páginas
  (~140 tokens por página) para no pasar del tope de ~28 000 tokens de
  estado del adaptador de Jev. Más de 100 páginas dudosas → varios lotes en
  paralelo (`preguntasPorLlamada`, `llamadasSimultaneas`).

## Migración v3 → v4: decisiones a revisar

- Espacios: `qwen3-vl-embedding-2b@2048` (texto, imágenes, fotogramas, vídeo
  directo), `…@2048+contexto` (context_embedding de chunk_contexts) y
  `…@2048+fotogramas` (composite_segment de vídeo). Los tres son del mismo
  modelo; se separan porque `vectores` tiene un vector por (objetivo, id, espacio).
- Los vectores `direct_video` de v3 (tramos de 15 s sin objetivo en v4) se
  guardan como figuras «Tramo de vídeo m:ss-m:ss» con ancla de tiempo.
- `fragmentos.contexto` = final de `context_before` (≤ 240 caracteres). La
  línea de contexto «de verdad» (recuperación contextual) está por generar.
- No tienen sitio en v4 y se cuentan en el informe y en `procedencia`:
  cross_modal_links, scenes, speaker_turns, voice_embedding, embedding de
  secciones, context_after y las miniaturas de figuras (se regeneran).
- Folios: si v3 no tenía NINGUNA lectura fiable (≥ 0,9) y el texto tampoco
  da ninguna, la página queda sin folio («ninguno»), en vez de conservar la
  numeración inventada de v3 (p. ej. «El casamiento en la muerte»: i–xxiii).
