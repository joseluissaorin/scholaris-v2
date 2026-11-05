# Comprensión: entender, recordar y anclar cualquier documento

Este documento es el contrato de la capa de comprensión de Scholaris. Todas las piezas
(ingesta, transmedia, investigación, memoria, banco, interfaz y SPDF) se programan contra
él. Si algo de aquí no encaja con el código, se discute y se corrige aquí primero.

## Qué queremos

Scholaris ya lee bien: texto fiel, folio impreso, segundo exacto. Lo que falta es
**comprender**. Hoy un libro es una lista de pasajes y una película es una transcripción
con fotogramas sueltos. El que responde hace una sola búsqueda, recibe ocho pasajes de
texto y escribe tres párrafos. No sabe qué escena es, quién está en pantalla, qué pasa
en el capítulo ni qué obra adapta a cuál.

La capa de comprensión le da a cada documento, sea del medio que sea, lo que anotaría
un especialista que lo hubiera estudiado entero. Además enlaza los documentos de la
biblioteca entre sí, por encima de medios y de lenguas, y recuerda lo que se ha
investigado. Todo queda anclado al sitio material exacto de donde sale.

Prueba de fuego: *Fresa y chocolate* (Gutiérrez Alea y Tabío, 1993) y el cuento que
adapta, «El lobo, el bosque y el hombre nuevo» (Senel Paz, ed. Luminaria, 1994), en la
misma biblioteca. Preguntas como esta tienen que salir bien, con páginas y segundos:
«¿Cómo cambia la función de Coppelia entre el cuento y la película, cómo está filmada la
primera escena (planos, quién domina el encuadre) y cómo resignifica la película el
helado al final?».

## Lo que ya existe y se aprovecha

La comprensión no parte de cero. `@scholaris/funciones` ya trae, sobre la estantería de
cada usuario:

- **Grafo de entidades** (`entidades`, `menciones`, `aristas_entidades`,
  `entidades_relaciones`, `entidades_wikidata`): personas, obras, lugares,
  organizaciones, conceptos, eventos y fechas, con alias, clave normalizada, fusión de
  duplicados (`fusionada_en`), personajes (`ficticia`), Wikidata, coapariciones,
  relaciones con nombre entre entidades, línea temporal, vecindarios y caminos
  (`entidades/consultas.ts`). Sus menciones son de texto, por fragmento y desplazamiento.
- **Grafo de citas** (`grafo_referencias`, `grafo_aristas`): qué documento cita o
  menciona a cuál.
- **Cuadernos** (`cuadernos`, `cuadernos_tarjetas`, `cuadernos_sintesis`): notas con
  tarjetas que guardan una copia verificada del pasaje y su ancla («citas vivas»), y
  síntesis que solo pueden citar sus tarjetas.
- **Historial** (`historial`, `historial_fts`, `historial_eventos`), **vigilantes**,
  **conceptos** y **mapa de conceptos**, **perspectivas** y **corpus**.

La capa de comprensión se construye encima. Las entidades y sus menciones de texto
siguen siendo las del grafo, y la comprensión añade las **apariciones** multimodales
ancladas (región de un fotograma, voz en un tramo, caracteres de una página). La
memoria de la investigación son los **cuadernos** y el **historial**: Investigar escribe
en ellos. Las relaciones entre obras de la comprensión (adaptación, traducción, edición)
completan el grafo de citas, no lo sustituyen.

## Principios

1. **Anclaje material.** Toda afirmación derivada (una ficha, una mención, una
   alineación, una tarjeta de un cuaderno, una frase de una respuesta) apunta a pruebas: documento,
   ancla y, cuando el soporte lo permite, la posición exacta. Eso son los caracteres del
   texto de la unidad, la región en la imagen de la página o del fotograma, el instante
   y el hablante. Lo que no tiene prueba se marca como inferido y nunca se cita como
   hecho.
2. **Capas, no sustitución.** El texto fiel (unidades y fragmentos) no se toca. La
   comprensión es una capa derivada, versionada (modelo, versión del prompt, fecha),
   recalculable y con procedencia.
3. **Una gramática para todos los medios.** Libro, artículo, manuscrito, película,
   clase, entrevista, pódcast, presentación, hoja o web comparten las mismas estructuras:
   segmentos, fichas, entidades con sus apariciones, relaciones, alineaciones y la
   memoria de los cuadernos.
4. **Lentes de especialista.** El análisis se hace con la lente del género y de la
   disciplina (ver «Lentes»), con su vocabulario y sus preguntas. No hay resúmenes
   genéricos.
5. **Transidioma.** Las entidades se normalizan con identificadores independientes de
   la lengua (Wikidata). Las fichas se escriben en la lengua del documento y llevan
   campos neutros. El espacio vectorial es multilingüe. Las citas van siempre en el
   original, con traducción al lado cuando la lengua no es la de quien pregunta.
6. **Holismo.** Cada documento se entiende entero (estructura, ficha global, temas que
   lo atraviesan) y cada parte se entiende dentro del todo. El modelo trabaja con el
   documento completo cuando cabe (hasta 1 M de tokens) y, si no, con su mapa.
7. **Durable y honrado con el coste.** Pasos idempotentes (`UnaVez`), lecturas grabadas,
   presupuesto por documento, todo reanudable. El coste se mide y se registra en la
   procedencia.

## Modelo de datos

Los tipos están en `packages/nucleo/src/comprension.ts`, el esquema interno en
`packages/spdf/src/esquema.ts` (SPDF 4.2 interno) y el repositorio en
`packages/spdf/src/comprension.ts`. Ningún nombre de tabla puede chocar con los de
`@scholaris/funciones`: lo comprueba `packages/funciones/test/esquema.test.ts` contra
todas las versiones del esquema SPDF.

### Ancla material y evidencia

`AnclaMaterial` es un `Ancla` de siempre con precisión opcional:

- `caracteres: [inicio, fin)`: posición en puntos de código NFC del texto de la unidad
  (`chars` en SPDF 5.0).
- `region: {x, y, w, h}`: fracciones 0-1 de la imagen de la unidad (página escaneada,
  fotograma, diapositiva).
- `instante`: en vídeo, el segundo del fotograma al que se refiere la región.

Una `Evidencia` es una prueba concreta. Lleva documento, ancla material (y de cierre),
la cita literal o lo que se ve u oye, el modo (`texto | imagen | video | audio | dato`) y,
si la hay, la unidad, el fragmento o la figura de donde sale.

### Segmentos (estructura)

Partes, capítulos, apartados, escenas, secuencias, planos, actos, poemas, estrofas,
temas de una clase o intervenciones, en árbol (`padre`, `nivel`, `orden`). Cada uno lleva
ancla de inicio y de fin, unidades desde y hasta, `t0`/`t1` en medios, resumen de una
línea, origen (`leido` del índice del documento, `deducido` de la maqueta, `modelo`) y
confianza. Los segmentos de nivel alto alimentan también `secciones`, que es el índice
navegable y los capítulos del reproductor.

### Fichas (comprensión)

Una ficha es el análisis de algo: el documento entero (`global`), un segmento (una
escena, un capítulo), una entidad (un personaje), una figura o una relación entre obras.
Tiene:

- `texto`: prosa analítica en la lengua del documento. Se busca (FTS y vectores) y se
  lee.
- `datos`: campos estructurados según la lente.
- `evidencias`: las pruebas de lo que afirma.
- `lente`, `clase`, `idioma`, `modelo`, `version` y fecha de creación.

### Entidades y apariciones (el grafo de la biblioteca)

Las entidades son las del grafo de `@scholaris/funciones`, una para toda la biblioteca,
y se crean y se fusionan con su resolutor (`entidades/resolver.ts`). La comprensión les
propone tipos más finos (personaje, objeto, motivo, tema, obra musical) en sus datos y
añade quién interpreta a cada personaje.

Cada aparición de una entidad en el material es una `Aparicion` (tabla `apariciones`)
con ancla material, la forma en que aparece y su rol: `nombrado`, `aludido`, `presente`,
`habla`, `visible`, `audible`, `citado` o `definido`. Las menciones de texto que el grafo
ya detecta siguen en `menciones`. Así Diego es la misma entidad en el cuento y en la
película, se ve en qué plano está y en qué región del fotograma, y «Lezama» se puede
seguir por toda la biblioteca.

### Relaciones y alineaciones (transmedia y transidioma)

Una relación une dos documentos (o dos entidades): `adaptacion_de`, `traduccion_de`,
`edicion_de`, `version_de`, `cita_a`, `comenta_a`, `responde_a`, `parte_de`,
`misma_obra` o `relacionado`. Lleva evidencias, confianza y fuente (`metadatos`,
`wikidata`, `modelo`, `usuario`).

Una alineación es una correspondencia fina dentro de una relación: un tramo de A frente
a un tramo de B (escena ↔ pasaje, párrafo traducido ↔ original, edición ↔ edición), con
su tipo (`equivalente`, `traducido`, `condensado`, `ampliado`, `transformado`,
`reordenado`, `anadido`, `suprimido`, `alusion`) y una nota analítica que dice en qué
cambia y con qué efecto. Si un lado no existe (algo añadido o suprimido), ese lado queda
vacío.

### Memoria

Lo que se investiga no se pierde, y se guarda con lo que ya existe. Cada pregunta queda
en el **historial**. Cada investigación deja un **cuaderno**: sus pruebas son tarjetas
verificadas (pasaje literal, ancla material y huella, que «reverificar» comprueba), y su
respuesta es una síntesis que solo cita esas tarjetas. Los hallazgos, las notas y las
hipótesis son tarjetas de tipo nota. Investigar consulta esa memoria antes de buscar y
escribe en ella al terminar. Si hace falta, la memoria gana su índice de búsqueda
(`cuadernos_fts`) en el esquema de funciones. Se exporta como anotaciones W3C
(`*.spdfa.json`, SPDF 5.0 §9).

### Vectores y búsqueda

`vectores.objetivo` admite, además de `fragmento | unidad | figura`, los valores
`ficha` y `entidad`. Las fichas tienen su propia tabla FTS (`fichas_fts`); las entidades
se buscan con el campo `busqueda` del grafo. El buscador fusiona la capa literal y la de
comprensión. Cada resultado dice de qué capa viene, y uno de comprensión arrastra sus
evidencias literales.

## Lentes

La lente se elige sola por el tipo CSL, el tipo de entrada, el contenido y la
disciplina, y se puede fijar a mano. Cada lente define qué segmentos se buscan, qué
campos lleva cada ficha, qué entidades importan y con qué vocabulario se escribe. Los
prompts y esquemas viven en `packages/ingesta/src/comprension/lentes/`.

| Lente | Segmentos | Lo que analiza cada ficha |
|---|---|---|
| narrativa | parte, capítulo, escena | acontecimientos, personajes, espacio, tiempo (historia frente a relato: analepsis, prolepsis, elipsis), narrador y focalización, discurso (directo, indirecto, indirecto libre), motivos, función en la trama |
| poesia | poema, estrofa | métrica, rima, figuras, yo lírico, tópicos, intertextos |
| teatro | acto, cuadro, escena | personajes en escena, acotaciones, conflicto, espacio escénico |
| cine | secuencia, escena, plano | quién y dónde, acción, diálogo clave, escala de plano, angulación, movimiento de cámara, composición y quién domina el encuadre, profundidad de campo, luz y color, montaje (raccord, elipsis, montaje paralelo), sonido (diegético o no, música, silencio), objetos y símbolos, texto en pantalla, función narrativa |
| documental / periodismo | secuencia, bloque | tesis, fuentes y testimonios, material de archivo, retórica audiovisual |
| entrevista / podcast | bloque, intervención | quién habla, preguntas y respuestas, tesis de cada interlocutor, desacuerdos, tono, pragmática |
| clase | tema, apartado | conceptos y definiciones, ejemplos, lo que está en la pizarra o la diapositiva, referencias |
| ensayo / cientifico | apartado | pregunta, tesis, argumentos y su estructura, método, datos, resultados, limitaciones, obras con las que discute |
| archivo | documento, folio | tipo documental, fecha, lugar, otorgantes, fórmulas, letra, estado de conservación, abreviaturas |
| juridico | artículo, apartado | norma, supuesto, consecuencia, remisiones |
| datos / presentacion | hoja, diapositiva | qué mide, variables, unidades, hallazgos |
| general | apartado | lo esencial y sus pruebas |

Una obra puede tener más de una lente: un documental es cine y argumento, y un poema
filmado es cine y poesía.

## Ingesta: el flujo de comprensión

La comprensión es un Workflow propio (`scholaris-comprension`). Gasta modelo, así que no
se lanza sola al terminar la ingesta (`COMPRENSION_AUTOMATICA = false` en
`apps/api/src/compartido/cierre.ts`): se pide por documento con
`POST /documentos/:id/comprender`. El documento se puede leer y buscar desde que está
«listo», y la comprensión llega después, con su progreso. Pasos:

1. **Percepción completa**, según el medio.
   - Texto (PDF, EPUB, Word, web): el texto entero de las unidades. En los escaneados,
     además, las imágenes de página, para anclar regiones. En los PDF digitales la capa
     de texto ya da posiciones de línea, así que `caracteres` → `region` sale por
     cálculo.
   - Vídeo: el conversor hace un proxy ligero (360p, audio mono) que se sube una vez a
     la API de ficheros de Gemini. El modelo de comprensión ve la obra en ventanas de
     unos 8 minutos con solape, junto con la transcripción de esa ventana, el reparto y
     la lente. Devuelve el découpage: planos (`t0`, `t1`, escala, angulación,
     movimiento, composición con la región de cada personaje en un instante, luz y
     color), escenas, sonido (música diegética o no, canciones, silencios, ruido), texto
     en pantalla, personajes presentes (identificados por la imagen y por la voz),
     acciones y objetos significativos con región e instante.
   - Audio: ventanas de escucha con música, tono, prosodia, risas, pausas,
     solapamientos y papel de cada voz.
   - Presentaciones y hojas: maqueta de cada diapositiva y semántica de cada tabla.
2. **Estructura**: el árbol de segmentos de la lente, consolidado entre ventanas.
3. **Fichas de segmento**, con el esquema de la lente y sus evidencias.
4. **Entidades y apariciones**: reconocimiento y correferencia en todo el documento (el
   reparto como guía), resueltas contra el grafo (`entidades/resolver.ts`) y su enlace a
   Wikidata, apariciones multimodales ancladas y, en el cine, la relación actor ↔
   personaje (P161 con el calificador P453).
5. **Ficha global holística**: sinopsis extensa, tesis o argumento, temas y motivos con
   todas sus apariciones, cronología de la historia frente al orden del relato, voz y
   punto de vista, estilo y contexto. Lo que venga de fuera del documento (Wikidata,
   OpenAlex) se marca como contexto externo.
6. **Indexado**: fichas, entidades y menciones a FTS y vectores; segmentos a `secciones`.
7. **Transmedia**: detección de relaciones con el resto de la biblioteca (metadatos,
   Wikidata P144 «basado en», P629 «edición de», P655 traductor, guionista, título,
   contenido) y alineación de cada pareja relacionada. Cuando entra un documento nuevo
   se revisan sus relaciones con todos los demás.

### Coste, tope y cancelación

Casi todos los pasos leen la obra entera: la estructura, cada tanda de fichas (seis
segmentos), las entidades, cada llamada del análisis de personajes (cinco entidades) y
la ficha global. El coste crece, por tanto, con la extensión multiplicada por el número
de llamadas. *Mil mesetas*, unos 380 000 tokens, costó 3,53 USD en modo económico
(5-11-2026): 0,29 la estructura, 0,30 cada una de las seis tandas, 0,25 las entidades,
0,87 el análisis y 0,31 la global. `prevision()` (en `comprension/flujo.ts`) calcula
cada paso sin contar con la caché del proveedor y da la estimación del plan.

- **Sin tope pedido** rige uno blando de 4 USD: al pasarlo no se hacen más tandas de
  fichas y lo que queda va con el modelo rápido.
- **Con `presupuestoUsd`** el tope es estricto (`plan.tope`). El Workflow lo hace todo
  en fila. Antes de cada paso se suma lo gastado, lo que costará ese paso (en las tandas
  de fichas, la media de las ya hechas) y lo que hay que guardar para la ficha global, y
  las entidades se suman cuando aún faltan. Lo que no cabe no se hace y queda en los
  avisos. El análisis de personajes se recorta a las llamadas que caben. Si no
  llegan ni la estructura ni la global, el plan falla con «El presupuesto no alcanza»,
  sin gastar nada y sin reintentos.
- **Caché del proveedor.** La primera tanda de fichas y la primera del análisis van
  solas. Las siguientes empiezan igual (sistema y obra), así que pueden leer la obra de
  la caché implícita a una décima parte del precio. Todas a la vez desde el principio no
  la encontraban nunca. Queda por medir en la próxima comprensión de pago.
- **Cancelar**: `POST /documentos/:id/comprension/cancelar` (botón «Parar» en la
  web, `cancelar_comprension` en el SDK de Python). Termina el Workflow y deja el
  estado en `error` con `cancelada: true`. El vigilante de la estantería no la relanza,
  y al pedirla otra vez sigue donde quedó con los mismos parámetros, sin repetir lo
  pagado. Terminar el Workflow a mano no basta: el vigilante lo ve muerto y lo relanza.
  Lo que ya se estaba pidiendo al modelo termina y se cobra.

### Transmedia y transidioma

El código está en `packages/ingesta/src/transmedia/`. El paso 7 corre en el mismo Workflow,
después de cerrar la comprensión (un fallo suyo no la estropea), y también solo, para un
documento o para la biblioteca entera (`ParamsComprension.transmedia`).

- **Detección** (`detectarRelaciones`), par a par. Cada par reúne indicios con peso y prueba:
  metadatos CSL (mismo título en otro medio o en otra lengua, título y lengua originales,
  traductores, obra contenedora, otra edición); contenido (el título de la otra obra en el
  material, con su contexto: «guion basado en su cuento…» en el texto en pantalla de los
  créditos, «traducción de…»); Wikidata (P144, P4969, P629, P747, P655, P58, P50, P57, P1877;
  la prueba lleva la URL del dato y la consulta queda en caché en `entidades_wikidata`); el
  grafo de citas; las entidades del grafo que comparten (los personajes de ficción pesan más,
  con su rareza en la biblioteca) y el parecido de las fichas globales. Los indicios con tipo
  se combinan por tipo; los demás solo refuerzan una derivación. Lo dudoso lo decide el modelo
  rápido. Las relaciones del usuario (creadas o confirmadas) no se tocan; las que rechaza no
  vuelven (`transmedia:rechazo` en la procedencia).
- **Alineación** (`alinearRelacion`), con un cerrojo por relación y una huella de las dos obras
  y de su comprensión: si no cambian, no se repite. El lado `a` es siempre el origen. Gruesa:
  segmentos ↔ segmentos, con lo que se añade y lo que se suprime, a partir de la estructura, los
  resúmenes y las fichas globales. Fina: por cada grupo (segmentos de la obra de partida y los
  de la derivada que les corresponden), pasaje ↔ pasaje, con el texto de esos segmentos y la
  percepción de sus escenas; cada lado se ancla contra el material (caracteres en el texto;
  tramo, instante y región del fotograma percibido en el vídeo) y lo que no se encuentra no es
  prueba. Una supresión en un tramo con huecos de transcripción baja de confianza y lo dice en
  la nota. Las traducciones entre textos se alinean párrafo a párrafo (Gale y Church por
  longitudes y revisión del modelo por ventanas), con anclas exactas de párrafo en las dos
  lenguas y sin necesidad de comprensión. Memoria acotada (un Durable Object tiene 128 MB): de
  cada obra solo se tiene en mano lo ligero (índice de unidades sin texto, estructura sin
  planos, resúmenes, percepción condensada) y el texto se carga grupo a grupo; ninguna consulta
  pide las fichas enteras, los planos ni las apariciones fila a fila. Durable: la gruesa y cada
  grupo (o ventana) se guardan al acabar (`transmedia:gruesa:…`, `transmedia:grupo:…`), y un
  reintento con la misma huella sigue donde quedó sin pagar dos veces. Cada llamada se acota al
  plazo del paso, con el modelo rápido de respaldo; cualquier fallo deja el estado en `error` y
  sube para que el Workflow reintente, y un `en_marcha` que no se mueve en 15 minutos se ve como
  error.
- **Ficha de la relación** (objetivo `relacion`, clase `adaptacion`, `traduccion`…, sin
  documento): el ensayo de la transformación entera, con `datos.cambios` y `datos.personajes`
  anclados en los dos lados (índices a `evidencias`; `inferido` si falta prueba) y el mapa de
  la alineación gruesa. Se vectoriza en el documento de origen.
- **Rutas**: `GET /documentos/:id/relaciones`, `POST /documentos/:id/alinear`,
  `GET /relaciones/:id`, `GET /relaciones/:id/alineaciones`, `POST /relaciones`,
  `POST /relaciones/:id/confirmar`, `DELETE /relaciones/:id` y `POST /transmedia/biblioteca`
  (tipos en `packages/contrato/src/transmedia.ts`), las mismas en la v1 y en el SDK de Python.

Modelos de la alineación, medidos el 4-11-2026 con *Fresa y chocolate* y el cuento (la misma
gruesa y la fina de dos escenas): `gemini-4-argon` da 14 y 18 correspondencias por escena,
todas ancladas, con notas de unas cincuenta palabras y el vocabulario de los estudios de
adaptación; `gemini-3.1-pro-preview`, 6 y 10, más someras; `gemini-3.8-flash` se desbocó en
una (salida cortada) y escribe notas más cortas. La alineación y la ficha van con
`comprension` (argon); las ventanas de párrafos de una traducción, con `comprensionRapida`.

Prueba real del 4-11-2026. *Fresa y chocolate* y el cuento: la detección da `adaptacion_de`
con confianza 0,99 (P144 de Wikidata y los créditos de 7:18, «guion… basado en su cuento»);
la alineación, 139 correspondencias (128 finas, 83 con los dos lados anclados) y una ficha de
1 600 palabras con 76 pruebas, por 1,07 USD; 106 de los 112 puntos de la rúbrica de las
preguntas transmedia del banco tienen una alineación fina en sus anclas. *Marianela*
(capítulos I-V) y la traducción de Clara Bell: 240 pares de párrafos y la ficha por 0,24 USD,
y las preguntas en inglés, francés e italiano sobre el original encuentran su párrafo por
vectores (de 24 a 26 de 30 en primer lugar, 30 de 30 entre los cinco primeros) frente a 5-8 de
30 por la búsqueda léxica.

Modelos: el de comprensión es el mejor disponible, elegido por medición en el banco
(candidatos a 4-11-2026: `gemini-4-argon`, `gemini-3.1-pro-preview`, `gemini-pro-latest`
y `gemini-3.8-flash`). Las ventanas pueden ir con uno rápido si el banco lo permite.
Se configuran en `MODELOS_GEMINI.comprension` y `MODELOS_GEMINI.comprensionRapida`.
Medición del 4-11-2026 (las mismas tandas de fichas de segmento del cuento y de la
película, con la obra entera en contexto): `gemini-4-argon` ancla 14-15 pruebas literales
por tanda frente a 6-9 de `gemini-3.1-pro-preview` (`gemini-pro-latest` da lo mismo),
ninguna cita inventada y el vocabulario técnico más fino, a unos 0,09-0,16 USD y 60 s por
tanda; `gemini-3.8-flash` se queda cerca a un tercio del precio, pero a veces deja en la
prosa las marcas del material. De ahí `comprension = gemini-4-argon` y
`comprensionRapida = gemini-3.8-flash`.

## Responder: el modo Investigar

El modo rápido (`responder`) se queda para lo sencillo. `investigar` es un agente con
herramientas:

- `buscar`: capa literal y de comprensión, con filtros por documento, capa, idioma,
  tramo de páginas o de tiempo, entidad y tipo de segmento.
- `leer`: unidades o segmentos enteros.
- `mapa`: la estructura y la ficha global de un documento.
- `entidad`: una entidad del grafo, con sus menciones, apariciones, vecinos, línea
  temporal y caminos hacia otras (`entidades/consultas.ts`).
- `alinear`: lo que corresponde a un tramo en las obras relacionadas.
- `ver`: un fragmento de vídeo o unas páginas, que el modelo mira con la pregunta.
- `escuchar`: un tramo de audio.
- `citas`: el grafo de citas entre documentos.
- `recordar` y `anotar`: la memoria (historial y cuadernos).

El agente planifica (qué obras intervienen, qué pruebas hacen falta y qué subpreguntas
salen), investiga en varios pasos con presupuesto de pasos y de tiempo, y apunta cada
prueba en el cuaderno de la investigación. Después escribe una respuesta con la extensión que
pida la pregunta, en registro académico, con tablas cuando compara. Cada afirmación
lleva su evidencia («p. 14», «1:02:03-1:03:10»). Lo visual se comprueba volviendo a
mirar, y lo que no se pueda probar se dice. Emite eventos en directo (`plan`, `paso`,
`evidencia`, `texto`, `verificacion`, `fin`) y deja la pregunta en el historial y las
pruebas y la respuesta en su cuaderno.

Va en la API (`POST /busqueda/investigar` y `/api/v1/investigar`), en el SDK
(`investigar()`), en el MCP (herramienta `investigate`) y en la web, donde se ven el plan
y las pruebas mientras trabaja.

## Anclaje material en la interfaz

Una cita abre el lector en la página con la región o los caracteres resaltados. En vídeo
salta al segundo y dibuja la región sobre el fotograma. En audio resalta las palabras (sus
tiempos ya están en `unidades.palabras`). Cada evidencia se ve como una tarjeta con su
recorte de página o de fotograma.

## Banco

`bench/comprension/` reúne un corpus (la película, el cuento y más parejas entre medios
y entre lenguas) y preguntas excepcionalmente difíciles. Cada pregunta lleva una rúbrica
de puntos obligatorios con sus anclas, comprobados contra las fuentes. El juez puntúa la
respuesta entera: acierto, exhaustividad, precisión de cada cita (el ancla citada dice lo
que se le atribuye) y citas inventadas, que tienen que ser cero. `pnpm bench comprension`
compara el modo rápido con Investigar, antes y después de cada cambio.

## SPDF

Por dentro, el esquema pasa a SPDF 4.2 con las tablas de comprensión. El código de la
frontera está en `apps/api/src/compartido/comprension-spdf.ts` (la capa) y
`anotaciones-spdf.ts` (la memoria).

**SPDF 4.2 interno** (el .spdf de Scholaris y las copias entre bibliotecas): las mismas
tablas que la estantería, más `comprension_entidades` con las entidades del grafo que
aparecen en el documento, porque el grafo no viaja.

**SPDF 5.0**: la comprensión va como extensión opcional `scholaris_comprension`
(versión 1.0, `required = 0`), así que un lector que no la conoce la ignora. Nombres y
valores en inglés, como en el núcleo:

| Tabla | Columnas |
|---|---|
| `x_scholaris_segments` | `id, document, parent, level, ord, kind, title, anchor, anchor_end, unit_from, unit_to, summary, origin, confidence, t0, t1` |
| `x_scholaris_cards` | `n, id, document, target, target_id, lens, class, language, text, data, evidence, model, version, created` |
| `x_scholaris_entities` | `id, kind, name, aliases, wikidata, description, fictional` |
| `x_scholaris_appearances` | `id, entity, document, segment, anchor, anchor_end, form, role, confidence, t0, physical` |
| `x_scholaris_relations` | `id, source, target, kind, note, evidence, confidence, origin, created` |
| `x_scholaris_alignments` | `id, relation, ord, kind, doc_a, anchor_a, anchor_end_a, segment_a, doc_b, anchor_b, anchor_end_b, segment_b, note, confidence` |
| `x_scholaris_vectors` | `target` (`card`), `id, space, data` |

- Solo van las entidades que aparecen en el documento (por sus apariciones, sus fichas o
  sus relaciones), con su Wikidata y siguiendo las fusiones del grafo.
- Los otros documentos se nombran por su `docref` (`sha256-<huella>`, o el id si no hay
  huella), en las relaciones, en los lados de las alineaciones y en el campo `doc` de
  cada prueba (`{doc, anchor, anchor_end?, quote?, mode, unit?, fragment?, figure?}`).
- Las anclas son anclas 5.0: `caracteres` pasa a `chars` y `region` queda igual. Lo que
  se ve en un instante de un vídeo se escribe como ancla de tiempo de ese instante
  (`t0 = t1`) con su región, y el plano de donde sale queda en el miembro `span`. Su URI
  es la de Media Fragments, `#t=6.5,6.5&xywh=percent:25,10,30,60`.
- La tabla `vectors` del núcleo solo admite `fragment`, `unit` y `figure` (§3.9), así que
  los vectores de las fichas van en `x_scholaris_vectors`, en un espacio de `spaces`.
- No hay índice FTS de las fichas en el fichero, porque la especificación prohíbe tablas
  virtuales fuera de `fragments_fts` (§2.1). Al importar, `fichas_fts` se rehace solo.
- Importar resuelve cada entidad contra el grafo de la biblioteca (primero por Wikidata,
  después por tipo y nombre), da ids nuevos si el documento entra como copia y busca cada
  `docref` por su huella. Las relaciones con obras que no están en la estantería se
  quedan fuera, con un aviso. Si la extensión no está, el fichero entra igual; si viene
  en una versión mayor desconocida, entra solo el texto.

**La memoria** de una investigación se exporta con `GET /cuadernos/:id/anotaciones`
como `.spdfa.json` (SPDF 5.0 §17.1). Cada tarjeta verificada es una anotación con la
URI de ancla de su prueba (`SpdfAnchorSelector`, con caracteres, región e instante), la
cita literal con su contexto (`TextQuoteSelector`) y, en vídeo y audio, un
`FragmentSelector` de Media Fragments. Las notas y las síntesis apuntan a las pruebas
que citan, así que su `target` es una lista; como eso no cabe en las anotaciones 1.0 de
SPDF 5.0, la colección se declara 1.1 (la versión que propone la RFC 0004) solo cuando
lleva alguna.

En el repositorio de SPDF, la RFC 0004 propone un perfil `understanding` para la 5.1 con
estas mismas tablas sin el prefijo del fabricante.
