# Percepción y anclaje material: cómo funciona y qué se midió

La percepción es el paso 1 de la comprensión (docs/COMPRENSION.md, «Ingesta»): un modelo multimodal ve u oye la obra entera y devuelve un `PercepcionMedio` (packages/nucleo/src/comprension.ts) con escenas, planos, sonido, frases clave, reparto y regiones. El anclaje material lleva una cita de una página a sus `caracteres` y a su `region`.

## El proxy

El conversor hace, junto al original, una copia ligera para los modelos y para «ver» de Investigar. Va bajo el prefijo del documento (`u/<usuario>/d/<documento>/`):

| Clave | Qué es |
|---|---|
| `proxy.mp4` | 360p H.264 a 300 kbps (máximo 15 fps) y audio mono AAC a 48 kbps. En los audios, solo el audio (`audio/mp4`). |
| `proxy.cortes.json` | Cortes de plano de ffmpeg (`select='gt(scene,0.08)'` sobre una copia de 192 px), con `{ cortes, umbral, candidatos }`. |
| `proxy.gemini.json` | El fichero en la Files API: `{ uri, nombre, mime, bytes, etag, subido, expira }`. |
| `percepcion.json` | El `PercepcionMedio` de la obra (lo lee la comprensión), con `coste` y `ventanas` de más. |
| `percepcion/<huella>/<t0>-<t1>.json` | Lo que devolvió cada ventana. |
| `percepcion/anclaje/…` | Las localizaciones de citas en imágenes de página. |

Se hace en una sola pasada de ffmpeg (`crearProxy` en `@scholaris/imprenta/node`), que lo divide en dos ramas: el proxy y las puntuaciones de cambio de escena. La película entera (1 h 50 min, 1080p, 2 GB) tardó 7 min en el Mac y dio 293 MB.

- En Cloudflare lo hace el contenedor (`POST /proxy`). El original va a disco y el proxy vuelve en tramas de 8 MiB, que el Worker escribe en R2 por partes (`guardarPorTrozos`). El Workflow de ingesta lo hace en el paso `proxy`, después de `medio-rapido`, con un plazo de 60 min. Si falla, el documento sigue valiendo.
- En local lo hace ffmpeg en la propia máquina, o el contenedor si hay `SCHOLARIS_CONVERSOR_URL`.
- Para los documentos que ya existen: `asegurarProxy` (apps/api/src/compartido/proxy.ts). `percibirDocumento` lo llama antes de mirar, así que la comprensión lo crea si falta.

El umbral de corte 0,3 está medido sobre *Fresa y chocolate*: en los cuatro clips de prueba, todos los candidatos con 0,3 o más eran cortes de verdad, y no faltaba ninguno (revisado fotograma a fotograma). Los de menos de 0,3 eran cambios de luz o el mismo corte repetido. Lo que no detecta son los fundidos lentos entre rótulos de crédito.

## Ficheros de Gemini

`fuenteGemini` (y su versión de plataforma, `fuenteGeminiDocumento`) sube el proxy por trozos de 16 MiB leídos del almacén con la subida reanudable. Nunca tiene el fichero entero en memoria, y si se corta pregunta cuánto llegó (`X-Goog-Upload-Command: query`). Después espera a `ACTIVE`. Los 293 MB tardaron 133 s, procesado incluido. El fichero se reaprovecha mientras le queden más de 6 h de vida, el proxy no cambie (bytes y etag) y el servidor lo tenga. Si el modelo responde 403 o 404 con un fichero caducado, `percibirMedio` lo vuelve a subir y repite la ventana.

## Ventanas

- Las ventanas son de 8 min con 30 s de solape (`ventanasDe`). Un resto final de menos de 2,5 min se suma a la última. Cada ventana es dueña de su tramo hasta la mitad de los solapes, y los tramos propios tilan la obra.
- Cada llamada lleva el fichero con `videoMetadata` (`startOffset`/`endOffset`, `fps`), la transcripción de la ventana con sus hablantes (de `unidades` y el instante de cada palabra), el reparto conocido, los cortes detectados y la lente. Devuelve listas planas por esquema JSON: escenas, planos, sonidos, frases clave y reparto.
- Las marcas que da Gemini con `videoMetadata` son absolutas, contadas desde el inicio del vídeo, en los cuatro modelos. Si alguna ventana las diera relativas, `normalizarVentana` lo detecta y las desplaza.
- La primera ventana va sola, porque su descripción de cada persona guía a las demás. Las otras van de 4 en 4.
- Fusión (`fusionar`):
  - Cada elemento se queda en la ventana dueña de su punto medio, y los planos y escenas repetidos en los solapes se funden.
  - Los planos quedan contiguos y ajustados a los cortes detectados a menos de 1 s.
  - Las escenas tilan la obra. Un hueco de más de 20 s sin escena se rellena y se avisa.
  - Una música que cruza ventanas es una sola.
  - Cada nombre se lleva a su forma canónica (`Unificador`): por el nombre, por el actor o por el nombre de pila sin ambigüedad.
- El reparto de Wikidata sale de P161, con P453 o P4633 si los tiene. Cuando falta el papel (como en esta película), los intérpretes van aparte y el modelo dice a quién hace cada uno. Los hablantes de la transcripción entran como reparto conocido.
- `percibirMedio` es idempotente y reanudable: cada ventana se graba en cuanto llega, con una huella que incluye la versión del prompt, el modelo, la lente, el medio, los fps y la resolución. Si la salida no cabe (`MAX_TOKENS`), la ventana se parte en dos. Lleva un presupuesto (`presupuestoUsd`, que para y deja lo hecho), el progreso y el coste.
- En audio se usa el mismo esquema sin planos. En las notas van el tono, la prosodia, las risas, las pausas y los solapamientos.

## Elección del modelo (4-11-2026)

**Oro.** Cuatro clips de 3 min de *Fresa y chocolate*, 80 planos en total:

- A: créditos y la posada, 0:00-3:00.
- B: Coppelia, 9:30-12:30, plano y contraplano rápido.
- C: la guarida, con un plano secuencia de 76 s y la foto de Lezama, 37:00-40:00.
- D: Coppelia al final y el abrazo, 1:45:00-1:48:00.

Los cortes se comprobaron fotograma a fotograma con hojas de contacto. Cada plano lleva su escala y quién está, anotados a mano en su fotograma central. Las regiones se comparan con las personas que detecta Vision de macOS (cuerpo entero y torso) en el instante que da el modelo: IoU con la mejor y proporción de cajas que contienen una cara. La música se comprueba contra el clasificador de sonido de macOS (SoundAnalysis, música > 0,5, por medios segundos).

**Métricas.**

- Cortes: F1 con 1 s de tolerancia, con y sin los cortes de ffmpeg en el prompt.
- Escala: acierto exacto y a un paso.
- Personas: TP / (TP + FN + FP) por plano.
- Regiones: IoU y proporción de cajas con IoU ≥ 0,5.
- Coste y latencia: por clip de 3 min.

| Modelo (fps 1, resolución media) | Cortes sin ayuda | Escala (exacta / ±1) | Personas | IoU (≥ 0,5) | Caras | Música F1 | $ por 3 min | s por 3 min |
|---|---|---|---|---|---|---|---|---|
| **gemini-4-argon** | **0,97** | 0,66 / **0,97** | **1,00** | **0,73 (0,88)** | 0,81 | **0,80** | 0,134 | 97 |
| gemini-3.8-flash | 0,86 | 0,67 / 0,95 | 0,99 | 0,54 (0,69) | 0,76 | 0,74 | **0,051** | **75** |
| gemini-3.1-pro-preview | 0,90 | 0,65 / 0,94 | 0,94 | 0,55 (0,69) | 0,84 | 0,76 | 0,205 | 87 |
| gemini-pro-latest | 0,91 | 0,61 / 0,92 | 0,95 | 0,59 (0,89) | 0,84 | 0,80 | 0,178 | 81 |
| gemini-omni-1.1-flash | no se puede usar: solo admite la Interactions API, sin recorte por tiempo (`video_metadata`) ni modo JSON, y su contexto es de 131 072 tokens | | | | | | | |

Variantes:

- Con los cortes de ffmpeg en el prompt, los cuatro llegan a F1 0,99 en cortes, y el ajuste posterior a los cortes deja los límites al fotograma.
- Argon con resolución alta: IoU 0,75, pero 2,7 veces más tokens (0,212 $ por clip). No compensa.
- Argon con fps 2: lo mismo que con fps 1, por 0,168 $.
- Flash con resolución alta: IoU 0,68 por 0,080 $. Es la mejor opción barata si importan las cajas.
- **Ventana real de 8 min** (9:00-17:00, puntuada sobre el oro de B):
  - Argon: escala exacta 0,86, IoU 0,79 (el 96 % ≥ 0,5), 0,326 $ y 203 s.
  - Flash: escala 0,81, IoU 0,59, 0,128 $ y 182 s.
  - La ventana larga no empeora el resultado. Con el prompt 1, los dos llamaron «Germán» al chico de la camisa de cuadros, que no habla: era la presión del reparto conocido.
  - El prompt 2 marca en el reparto quién habla en cada fragmento y pide no nombrar a nadie solo por estar en la lista. Con él, Argon llega a personas 1,00, escala exacta 0,90 e IoU 0,80, por 0,353 $ y 231 s. El prompt 3 (`VERSION_PERCEPCION = 'percepcion-3'`, el vigente) añade que el hablante de las frases clave es quien se ve u oye decirlas, no la etiqueta de la transcripción.

**Por defecto.**

- `MODELOS_GEMINI.percepcion = 'gemini-4-argon'`: resolución media, fps 1, cortes de ffmpeg en el prompt y ajuste de los planos a ellos.
- `percepcionRapida = 'gemini-3.8-flash'`.

**Coste por hora de vídeo.** Unas 8 ventanas por hora:

- Argon: 2,6 $ hasta el 30-11-2026. Desde el 1-12-2026 su precio se dobla (4 $ y 20 $ por millón), y la hora pasa a unos 5,2 $.
- Flash: 1,0 $.
- Una ventana de 8 min tiene unos 56 000 tokens de entrada (unos 117 por segundo) y de 15 000 a 25 000 de salida.

Argon admite como mucho 32 768 de salida. Una ventana muy cortada (más de unos 120 planos) se parte sola.

## Película completa

Todo está fuera del repositorio, en `~/tmp/scholaris-fresa/percepcion/`.

**`fresa-y-chocolate.json`**

- Hecho con `scripts/pelicula.ts`: Argon, prompt 2, 15 ventanas de 8 min, cinco a la vez.
- Costó 4,07 $ y 50 min de reloj.
- Contiene:
  - 62 escenas que tilan los 6638 s.
  - 521 planos. ffmpeg da 496 cortes con 0,3 o más; el resto son rótulos de créditos y fundidos.
  - 686 personas localizadas, todas con región e instante, y 144 objetos.
  - 102 sonidos: 40 de música o canción, con 8 obras identificadas.
  - 377 frases clave.
  - Un reparto de 32, con los actores de Diego, David, Nancy, Vivian y Miguel. A Germán no le pone actor, porque Joel Angelino no está en el P161 de Wikidata.
- Los hablantes de las frases clave se tomaron después de la transcripción revisada (`hablantesDeDialogos`): 19 cambios.

**`fresa-y-chocolate.transcripcion.json`**

- La `RevisionTranscripcion` con sus correcciones: 36 huecos (172 segmentos), 161 hablantes y 11 desfases.
- Las `unidadesRevisadas`: de 120 unidades se pasa a 153.
- Coste: huecos con Flash, 1,14 $ en 96 llamadas; hablantes con Argon, 1,71 $ en 15 ventanas.
- Contra Whisper, los segmentos que no tiene la transcripción bajan de 191 (328 s) a 58 (108 s). Lo que queda es sobre todo letra de canciones y frases sueltas.
- Las palabras añadidas coinciden en un 76 % con las de Whisper. El inicio difiere 0,28 s de mediana y 2,3 s en el percentil 90.
- Hablantes en las 101 frases del oro: del 52 % al 98 % (46 cambios buenos y 1 malo).

La medición y el oro están en `oro/`, `resultados/`, `revision/` y `scripts/`.

## Anclaje material

`anclarMaterial(puertos, unidad, { cita | caracteres })`:

- **Caracteres.** Son puntos de código NFC del texto de la unidad. Primero se busca la cita exacta (confianza 1). Después por su esqueleto, sin mayúsculas, tildes, puntuación, guiones de corte ni Markdown (0,95). Por último por el principio y el final de la cita, si trae erratas (0,75).
- **PDF digital.** Con las líneas de la capa de texto (`paquete.json`, solo las páginas de origen digital), se calcula la unión de las líneas que ocupa la cita. La primera y la última se recortan en proporción a sus letras. No cuesta ninguna llamada. La imprenta da cajas por línea, no por palabra, y con eso basta.
- **Escaneado o foto.** Gemini 3.8 Flash («alta») devuelve una caja por línea (`box_2d` en 0-1000) y se unen. El resultado se guarda en caché.

Probado sobre el cuento escaneado (`dmw21xdj01a6v8dkc`, pliegos de dos páginas) con 7 citas: las 7 en la página y las líneas correctas, unos 3,5 s y 0,001 $ por cita. Sobre un PDF digital de la biblioteca (`dmuxsagujsmaagbja`), 8 de 8, sin modelo. En la plataforma, `crearAnclador(ctx, doc)` (apps/api/src/compartido/percepcion.ts) carga una vez las líneas del paquete y devuelve `anclarMaterial` atado al documento.

## Descripción de fotogramas

`describirFiguras` separa los fotogramas de un vídeo de las figuras de página. Los describe en calidad «alta» con lenguaje de cine (escala, angulación, quién y dónde en el cuadro, quién domina, luz y color, objetos, texto en pantalla). A cada uno le da lo que se dice 20 s antes y 20 s después y los hablantes de la obra. El esquema SPDF no cambia: sigue siendo la `descripcion` de la figura.

## La transcripción: por qué tiene huecos y cómo se arregla

### Qué pasa

La transcripción de la película en producción (`dmw21xnomjseg07mi`) tiene huecos largos, frases mal colocadas y hablantes cambiados. Comparada con un Whisper local completo (`~/tmp/scholaris-fresa/banco/whisper/`), le faltan 146 segmentos de Whisper, unos 261 s de habla. Casi todo está en dos tramos de 10 min: el 5 (40:14-44:36) y el 10 (1:33:32-1:39:31). Además:

- **Tiempos rotos.** 542 de 7522 palabras (7,2 %) duran 0,02 s o menos y se amontonan en un mismo instante. Por ejemplo, en la unidad de 6:58 a 7:46 todas acaban en 7:46,9.
- **Frases mal colocadas.** La primera frase («¿No había otro lugar?») está en 0:01 y se dice en 1:40,3.
- **Hablantes cambiados.** En 101 frases comprobadas a mano (Coppelia, Miguel en la universidad, Germán y la exposición, «Son mías»), la etiqueta acierta solo en el 52 %. Las frases de Miguel van a nombre de Diego; las de Germán, a nombre de Vivian, David o Diego, y las de Diego a nombre de David.

### Por qué

1. **El transcriptor se salta trozos largos de un tramo de 10 minutos, y no siempre los mismos.** La ingesta manda tramos de 600 s (Opus a 24 kbps) a `gemini-3.5-transcribe` con marcas por palabra y diarización. Al repetir el tramo 10 igual que en producción, faltaron 71 de 128 segmentos de Whisper (136 s). En trozos de 2 min faltaron 23 (45 s, casi todos letra de canciones en la fiesta). El tramo 5 repetido salió entero (1 de 138): el fallo es aleatorio. Una de las dos repeticiones de 10 min falló además con un HTTP 400 («invalid argument»).
2. **No es la música.** El clasificador de sonido de macOS da poca música (de 0,07 a 0,12) y mucha voz (de 0,32 a 0,53) en los minutos perdidos del tramo 5.
3. **Nada lo comprueba.** `transcribirTramo` acepta lo que llegue. El transcriptor enrutado solo pasa a Whisper si hay un error, no si la salida viene incompleta. El solape entre tramos es de 2 s y no hay ninguna comparación con el audio.
4. **Los tiempos de palabra salen del propio modelo.** Cuando pierde la alineación, amontona palabras o las coloca en otro sitio. Es lo que pasa tras los 80 s de créditos del principio.
5. **Los hablantes se ponen solo por el texto.** Cada tramo se diariza por separado; después se casan las etiquetas por el solape y un modelo de texto pone nombres (`atribuirHablantes`). Nadie ve quién habla. Con personajes que salen poco (Miguel, Germán), los grupos de voces acaban con los nombres de los protagonistas.

### Cómo se arregla (`revision.ts`)

- **Actividad de la voz.** El conversor la calcula en la misma pasada del proxy: `silencedetect` a -35 dB en la banda de 150 a 4000 Hz, guardado en `proxy.voz.json`. Cubre el 97 % de lo que habla Whisper (a -38 dB, el 99 %, pero marca como activo el 88 % de la película). Para un proxy antiguo está `actividadDeAudio` (Node).
- **Tiempos frente a la actividad.** Ninguna de las 6980 palabras con duración válida cae en silencio (a -35 dB), así que en esta película los tiempos malos no se ven con la energía del audio. Se ven por las duraciones rotas y por la revisión con vídeo de cada frase.
- **Cobertura** (`coberturaTranscripcion`). Un hueco es un tramo con sonido sin palabras válidas a menos de 1,2 s, de 3 s o más. Las unidades con un cuarto o más de palabras rotas cuentan como huecos de `tiempos_rotos`. Sin mapa de actividad, solo se ven los silencios de transcripción de más de 25 s. En la película salen 124 huecos (2551 s) en 96 subventanas.
- **Huecos** (`revisarTranscripcionConVideo`). Cada subventana, de 75 s como mucho, se transcribe con Flash mirando el proxy, a unos 0,012 $ cada una. Con las mismas marcas absolutas de `videoMetadata`, el hablante sale por la voz y por la imagen, y el modelo recibe lo transcrito alrededor para orientarse. Si la llamada falla, entra la reserva: Whisper de Workers AI con el tramo de audio del paquete, o en local `mlx_whisper` con large-v3-turbo. Lo que ya estaba no se repite, y las unidades con el tiempo roto se sustituyen por lo que se oye en su tramo (`reemplaza`).
- **Hablantes y tiempos.** Argon ve cada ventana de 8 min con sus frases numeradas y dice quién dice cada una, si se le ve decirla y, si su marca está a más de 2 s, cuándo empieza de verdad.
  - Sobre las 101 frases del oro: del 52 % de aciertos al **99 %**, con 47 cambios buenos y ninguno malo, por 0,128 $ por ventana.
  - Flash llega al 96 %, con 3 cambios malos, por 0,069 $.
  - En esas cuatro ventanas también encuentra 6 desfases. Uno es la primera frase, que se mueve de 0:01 a 1:40.
- **Salida.** `RevisionTranscripcion`, con la cobertura, las correcciones (`hueco`, `hablante`, `desfase`), los avisos y el coste. Se guarda en `transcripcion.revision.json`.
- **Aplicación.** La ingesta aplica las correcciones con `aplicarCorrecciones(unidades, correcciones, { minConfianza: 0.7 })`, que devuelve las unidades nuevas:
  - cambia las marcas «**Nombre:**»;
  - mueve las palabras desfasadas;
  - convierte cada hueco en una unidad nueva;
  - sustituye las unidades rotas;
  - no duplica lo que ya está.

  Después se reescribe la capa literal con `reescribirTranscripcion` (packages/ingesta/src/transcripcion.ts): ver «La transcripción en la ingesta» más abajo.

### Orden en la comprensión

1. Revisar la transcripción (`revisarTranscripcionDocumento`, ahora en apps/api/src/compartido/transcripcion.ts).
2. Percibir (`percibirDocumento`). Si existe `transcripcion.revision.json` sin aplicar, lo aplica en memoria y mira con la transcripción revisada. Una revisión ya aplicada (`aplicada`) no se vuelve a aplicar: sus `unidad` son las de antes.
3. Para una percepción hecha antes de la revisión, `hablantesDeDialogos(percepcion, unidadesRevisadas)` pone en las frases clave el hablante bueno.

## La transcripción en la ingesta (4-11-2026)

### Piezas de 150 s

`transcribirTramo` parte cada tramo del conversor (600 s) en piezas de unos 150 s con 5 s de solape (`partirAudio`, pasos/piezas.ts) y las transcribe a la vez, de cuatro en cuatro. No decodifica nada: en Ogg/Opus lee los paquetes, saca la duración de cada uno de su byte TOC y los vuelve a empaquetar con la misma `OpusHead` (con un paquete de más al principio para que el decodificador se asiente); en WAV corta las muestras; en YouTube cambia el subtramo del JSON. Las etiquetas de hablante de cada pieza se casan con las de la anterior por las palabras del solape (`casarHablantes`) y cada palabra se queda en la pieza dueña de su centro. Los recortes de un tramo real de la película decodifican con ffmpeg sin errores y caen en su sitio (0,25 ms de desfase con el original).

En la película, con el mismo transcriptor y los mismos tramos del conversor, los segmentos de Whisper sin cubrir bajan de 191 (328 s) a **92 (215 s)** solo con las piezas, y la primera frase ya no sale en 0:01: queda en 1:41, donde se dice. La transcripción entera costó unos 0,61 $ (122 min de audio con el solape).

### Completar antes de consolidar

Paso «transcripcion» del Workflow de ingesta (y lo mismo en la cola local, con `antesDeConsolidar`), después del proxy y antes de consolidar: `completarTranscripcion` (packages/ingesta/src/transcripcion.ts) con los puertos de `puertosRevision` (apps/api/src/compartido/transcripcion.ts):

- Cobertura contra `proxy.voz.json`; sin él, los silencios de la transcripción de más de 25 s.
- Huecos en subventanas de 75 s como mucho con Flash mirando el proxy (marcas absolutas, hablante por la voz y la imagen). Sin proxy, o si falla, la reserva: el transcriptor de la plataforma (con hablantes: Gemini Transcribe antes que Whisper) con el audio del tramo **recortado a la subventana** (`recortarAudio`), sin las etiquetas de su diarización y sin pasar por la grabación de la ingesta (que devolvería lo ya oído). Todo grabado en `percepcion/revision/`.
- Unidades con el tiempo roto, sustituidas por lo que se oye en su tramo.
- Con percepción (un reproceso) y plan de pago, los hablantes con Argon; si no, se quedan para `atribuirHablantes`.
- Tope de gasto: 1,5 $ por hora de medio en los planes de pago y 0,3 en el gratuito, y como mucho una subventana por minuto.
- Las palabras corregidas quedan en `trabajo/<doc>/transcripcion.json`; `consolidar` las recoge en vez de casar otra vez las de las tandas. La revisión se guarda en `transcripcion.revision.json` con `aplicada` y `coberturaFinal`.
- Idempotente: el trabajador lo hace con `UnaVez` recordado y cada llamada está grabada. Si el paso falla del todo, se consolida lo que hay.

En la película, después de las piezas: 96 subventanas con Flash, 27 huecos rellenos, 1,09 $ y 7,5 min; los segmentos de Whisper sin cubrir quedan en **66 (117 s)**. La revisión de este equipo sobre la transcripción de producción llegó a 58 (108 s), con la ayuda de los desfases de Argon. Lo que falta en las dos es casi todo letra de canciones, interjecciones y frases que Whisper oye de otra manera («¡Ah! ¡Raskolnikov!» frente a «A Rastólnikov»). Una segunda escucha de los huecos que quedan con Gemini Transcribe (95 subventanas, 0,17 $) deja 59 (94 s), pero solo el 29 % de las palabras que añade las oye también Whisper: no se ha puesto.

Ojo con el límite de la cuenta: `gemini-3.5-transcribe` admite 100 000 tokens de entrada por minuto en el nivel 2, y una película son unas 48 piezas a la vez. En la plataforma el transcriptor enrutado pasa a Whisper si Gemini responde 429; el paso de la tanda, además, se reintenta y las piezas ya oídas están grabadas.

### Documentos que ya existen

- `POST /documentos/:id/transcripcion/revisar` (y `/api/v1/…`, y `revisar_transcripcion` en el SDK de Python): revisa la transcripción o aplica una revisión que llega en el cuerpo. Se lanza como una tarea con la fase `transcripcion` del Workflow de ingesta: proxy si falta, revisión (si no hay una guardada sin aplicar), revisión aplicada. `percepcion: true` añade la percepción completa y, con su reparto, la revisión de los hablantes. El documento sigue «listo» mientras tanto y nunca queda en error por esto; al cerrar, la comprensión de los planes de pago se pone al día sola (solo los segmentos cuyo texto cambió).
- `aplicarRevisionDocumento` comprueba antes que la revisión es de estas unidades (sus frases de hablante y de desfase citan el texto que tocan); si no coincide el 90 %, no la aplica.
- `reescribirTranscripcion` rehace unidades de 30 a 60 s, fragmentos, instantes por palabra y hablantes. Los fragmentos con el mismo texto conservan id, contexto y vectores; lo nuevo se sitúa y se vectoriza; lo que sobra sale de la estantería y del índice; los fotogramas se cuelgan de la unidad que los contiene.
- `GET /documentos/:id/transcripcion/revision`: la revisión resumida (correcciones, cobertura antes y después, `aplicada`) y la última tarea.
- `POST /transcripcion/revisar` y `POST /medios/percibir`: lo mismo para la biblioteca. Sin `confirmar` solo estiman (dólares por documento y total, con el precio de Argon doblado desde el 1-12-2026); se encolan de dos en dos (la cola vive en `procedencia`, fase `cola_medio`, y avanza al cerrar cada tarea). Percibir la biblioteca entera es de los planes de pago.

Prueba en local sobre una copia de *Fresa y chocolate* (el .spdf 4.2 de producción importado en `apps/local`, con los instantes por palabra de la API v2, porque el .spdf 4.2 no los lleva), con la revisión de este equipo y la orden de producción contra el servidor local:

- Comprobación: 172 de 172 frases coinciden.
- 120 → 137 unidades. De 137 fragmentos, 41 conservan id y vectores; 96 nuevos (96 vectores), 79 fuera. 587 fotogramas recolgados. 4,9 s.
- Segmentos de Whisper sin cubrir: 191 (328 s) → **58 (108 s)**.
- Hablantes en las 101 frases del oro (casadas por tiempo y texto con la transcripción nueva): del 52 % al **96 %**.

La orden para producción:

```
SCHOLARIS_CLAVE=sch_… python3 apps/api/scripts/revisar-transcripcion.py \
  --documento dmw21xnomjseg07mi --revision ~/tmp/scholaris-fresa/percepcion/fresa-y-chocolate.transcripcion.json
```

## Pendiente

- Los créditos con fundidos no dan cortes de ffmpeg; el modelo los trata como un plano por rótulo.
- En el contenedor (`standard-4`), el proxy de una película de 2 h debería tardar de 20 a 35 min, pero no se ha medido. Ahora el «listo» de un medio espera al proxy y a completar la transcripción (las unidades de las tandas ya se leen mientras tanto).
- El .spdf 4.2 que exporta la API no lleva los instantes por palabra (`unidades.palabras`).
