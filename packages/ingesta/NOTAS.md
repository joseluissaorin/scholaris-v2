# La tubería por tandas: cómo llevarla a pasos

`ejecutarIngesta` es la versión local: Node, banco y `apps/local`. Hace lo mismo que el Workflow de Cloudflare, con las mismas funciones, todas exportadas por `@scholaris/ingesta`. Cada función recibe datos pequeños y un `ContextoTuberia`, que reúne el paquete, el plan, los puertos, el id del documento y las opciones. Lo que una función deja para la siguiente se guarda en el puerto SQL: las filas de siempre más `blobs` bajo `trabajo/<documento>/`, que se borra al consolidar. Ningún paso necesita el resultado de otro en memoria.

## Pasos

| Paso | Función | Entrada | Escribe | Señal para la web |
|---|---|---|---|---|
| preparar | `planificar(paquete, opciones)` + `prepararDocumento(ctx)` | paquete | fila del documento (`procesando`) y espacios | ninguna |
| enviar lote (económico) | `enviarLote(ctx)` | nada | nada; devuelve el id del trabajo | ninguna |
| esperar el lote (económico) | `step.sleep` + `recogerLote(ctx, id)` hasta `listo` | id | nada; devuelve los resultados por clave «desde-hasta» | ninguna |
| leer tanda *t* | `leerTanda(t, ctx, { resultadosLote })` | tanda | nada (lectura pura; el lector se graba como hoy) | ninguna |
| indexar tanda *t* | `indexarTanda(t, lectura, ctx, { metadatos })` | lectura del paso anterior | unidades con folio provisional, fragmentos (FTS), contexto, vectores y estado de la tanda | `unidades` legibles al escribir las unidades; `unidades` con `buscables: true` en `alBuscables` |
| metadatos | `metadatosTempranos(ctx, primerasUnidades)` | las 5 primeras páginas | ficha en la fila del documento | título y autores |
| consolidar | `consolidar(ctx, { metadatos })` | nada (lee las tandas de `blobs`) | folios definitivos, secciones, fragmentos finales, figuras, vectores nuevos y documento `listo`; borra lo provisional sobrante y `trabajo/` | `listo` |

`leerTanda` e `indexarTanda` pueden ir en un solo `step.do`, porque su resultado cabe de sobra en 1 MiB. Separadas, se reintenta la indexación sin volver a pagar la lectura. `plan.tandas` viene en orden de prioridad: primero los lotes de capa (buscables al instante) y después los pliegos por orden de página.

## Orden y paralelismo en el Workflow

1. `preparar`.
2. Las tandas, en paralelo. Leer cuesta API; indexar, poco.
3. `metadatos`, en cuanto esté leída la tanda que contiene las páginas 1-5. Si una tanda se indexa antes de tener metadatos, deja los fragmentos sin contexto ni vectores (`vector: false` en su estado) y la consolidación los completa. Pasar `metadatos` a `indexarTanda` cuando ya existan es lo que hace que la búsqueda densa funcione durante la lectura.
4. `consolidar`, cuando estén todas las tandas. En local empieza antes: arranca en cuanto todo está leído y espera a que terminen de enriquecerse (`esperarTandas`). En el Workflow basta con encadenarlo al final.

**Medios.** Cada tramo de audio es una tanda. Su texto se vuelve buscable en cuanto se transcribe. Las unidades provisionales tienen id `<doc>:m<segundo>` y orden igual a su segundo de inicio. La consolidación casa las etiquetas de hablante entre tramos, atribuye las frases a personas con nombre y sustituye las unidades por las definitivas (`<doc>:u<n>`).

## Identificadores (todos deterministas: reintentar un paso escribe las mismas filas)

- Unidad: `<doc>:u<orden>`. La página física *f* es la `u<f-1>`. Las provisionales de los medios son `<doc>:m<segundo>`.
- Fragmento provisional: `<doc>:t<tanda>.<i>`. Si al consolidar sale igual (mismo texto), conserva el id, el contexto y los vectores.
- Fragmento rehecho en una costura o nuevo: `<doc>:c<huella>`.
- Lo provisional que ya no existe se borra de `fragmentos` y de `vectores`, y del índice si `indice.borrar` existe.

## Por qué la consolidación rehace tan poco

`trocear(…, { cortes })` cierra el grupo de párrafos en el primer párrafo de cada tanda, igual cuando trocea una tanda sola que cuando trocea el documento entero. Así los fragmentos de dentro de cada tanda salen idénticos en las dos pasadas. Solo cambian las costuras: un párrafo partido entre dos tandas se une al anterior, y su fragmento reaprovecha el contexto de la cola y solo se vuelve a vectorizar. Si un fragmento solo cambia de sección (un libro sin índice cuya tanda no veía el título de capítulo de páginas anteriores), conserva su contexto y solo se vuelve a vectorizar.

## Contexto que el modelo no da

Si el Redactor bloquea un grupo por seguridad (`PROHIBITED_CONTENT` en El perseguidor, por las escenas de drogas) o tarda más de 20 s, al consolidar se escribe una línea extractiva: título, autores, año, sección y página. En las tandas, el tope es de 12 s y lo que no llega lo completa la consolidación.

## Concurrencia en una misma base

Las escrituras de la tubería pasan por `escribir(sql, fn)`, que las pone en fila por conexión. Así dos tandas no abren transacciones a la vez en la misma conexión. Ocurre en sqlite-wasm y en better-sqlite3, y hay que tenerlo en cuenta en el SQL del Durable Object si se llama a la tubería en paralelo dentro de un mismo aislamiento.

## Modo económico (`modo: 'economico'`)

El plan hace tres cosas:

- Aprovecha tal cual la capa de OCR ajena si su calidad es ≥ 0,9, sin hacer llamadas.
- Marca como «fáciles» las páginas con una capa de OCR legible; van con `puertos.lectorEconomico` (Workers AI) y, si falla, con la cascada.
- Marca como «difíciles» las demás; van en un solo envío a `puertos.lotes` (Gemini Batch: mitad de precio, entrega objetivo en 24 h). Lo que el lote no traiga se lee en línea al procesar la tanda.

Los dos puertos los pone la plataforma: `crearWorkersAI(...).lector()` si hay `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, y el `LotesLectura` de proveedores. Están probados con dobles en `test/economico.test.ts`; la verificación en vivo queda para la plataforma.

## Vista de página

`vistaPaginas` admite tres valores:

- `utiles` (por defecto): lleva vector de imagen la página escaneada, la foto, la diapositiva, la página con figuras o con tablas y fórmulas, y la capa de OCR que se relee. La página digital de solo texto no lo lleva.
- `todas`.
- `ninguna`.

Confirmado por el banco de calidad (`bench/calidad`, 183 consultas). En las consultas sobre Attention, El perseguidor y Lewis, añadir la vía visual con peso 0,3 baja el nDCG@10 de 0,751 a 0,723 sin reordenador y lo deja igual con Jev (0,833 sin ella, 0,832 con ella). Sobre las 183, quitarla de la fusión sube de 0,643 a 0,658. La vista solo aporta en las consultas visuales, y el buscador ya solo la usa para esas.

# La comprensión (`src/comprension`)

La capa de docs/COMPRENSION.md, con las mismas reglas: pasos sobre puertos que reciben un plan pequeño y leen lo demás del SQL. El Workflow `scholaris-comprension` (apps/api) los llama uno a uno; `comprenderDocumento` los encadena en local, en el banco y en `apps/api/scripts/comprender-local.ts`.

| Paso | Función | Escribe |
|---|---|---|
| plan | `planificarComprension` | estado «en_marcha» (fila `comprension` de la procedencia); elige lentes, plazos y presupuesto |
| estructura | `pasoSegmentos` | `segmentos` (y `secciones` si el documento no tenía índice); fichas de plano si hay percepción |
| fichas *i* | `pasoFichas` | fichas de los segmentos de la tanda *i* (`lotesDeFichas`, deterministas) |
| entidades | `pasoEntidades` | entidades del grafo (resolutor de @scholaris/funciones), `apariciones`, «X interpreta a Y», fichas de entidad |
| global | `pasoGlobal` | ficha global por lente; temas y motivos como entidades con todas sus apariciones |
| indexado | `pasoIndexado` | un vector por ficha (`objetivo: 'ficha'`) en la estantería y en el índice |

- Cada paso hecho deja una fila `comprension:<paso>` en la procedencia con modelo, tokens y dólares; si ya está, no se repite. El estado y los totales se leen con `leerEstadoComprension`.
- Rehacer: con otra versión de lente o `forzar`, de cero. Con la misma versión y otro material (transcripción reparada, percepción nueva) o tras un error, por partes: la estructura de un medio con la misma percepción se reancla por tiempo y las fichas cuya huella de entrada (`huellaEntradaSegmento`) no cambió se aprovechan.
- Anclaje: el modelo cita «u + cita literal» y aquí se busca (sin tildes ni puntuación, con ventanas para las erratas del OCR); se guarda la cita del material con sus `caracteres` NFC. Lo que no aparece no se guarda (`citasNoVerificadas`).
- Medios: los tramos sin transcripción se dicen en el material y en cada ficha (`datos.transcripcion`); quién habla lo decide la percepción (`m.voces`) cuando la hay.
