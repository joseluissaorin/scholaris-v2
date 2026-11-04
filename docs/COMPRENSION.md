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

## Principios

1. **Anclaje material.** Toda afirmación derivada (una ficha, una mención, una
   alineación, un recuerdo, una frase de una respuesta) apunta a pruebas: documento,
   ancla y, cuando el soporte lo permite, la posición exacta. Eso son los caracteres del
   texto de la unidad, la región en la imagen de la página o del fotograma, el instante
   y el hablante. Lo que no tiene prueba se marca como inferido y nunca se cita como
   hecho.
2. **Capas, no sustitución.** El texto fiel (unidades y fragmentos) no se toca. La
   comprensión es una capa derivada, versionada (modelo, versión del prompt, fecha),
   recalculable y con procedencia.
3. **Una gramática para todos los medios.** Libro, artículo, manuscrito, película,
   clase, entrevista, pódcast, presentación, hoja o web comparten las mismas estructuras:
   segmentos, fichas, entidades, menciones, relaciones, alineaciones y recuerdos.
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
`packages/spdf/src/comprension.ts`.

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

### Entidades y menciones (el grafo de la biblioteca)

Las entidades viven en la estantería del usuario, una para toda la biblioteca: personas,
personajes, lugares, obras, organizaciones, conceptos, eventos, objetos, motivos, temas,
obras musicales y fechas. Llevan nombre, alias en cualquier lengua, etiquetas por
idioma, QID de Wikidata, descripción y datos. Por ejemplo, un personaje lleva quién lo
interpreta y un evento su orden en la historia.

Cada aparición en un documento es una mención con ancla material, la forma en que
aparece y su rol: `nombrado`, `aludido`, `presente`, `habla`, `visible`, `audible`,
`citado` o `definido`. Así Diego es la misma entidad en el cuento y en la película, y
«Lezama» se puede seguir por toda la biblioteca.

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

Lo que se investiga no se pierde. Un recuerdo es una pregunta, una respuesta, un
hallazgo, una nota, una hipótesis, una decisión o una preferencia, con sus evidencias,
los documentos que toca, el proyecto (biblioteca), su fuente (`investigar`, `usuario`,
`sistema`), si está fijado y de qué recuerdo cuelga. Los recuerdos se buscan (FTS y
vectores) y el modo Investigar los consulta y los escribe. Se exportan como anotaciones
W3C (`*.spdfa.json`, SPDF 5.0 §9).

### Vectores y búsqueda

`vectores.objetivo` admite, además de `fragmento | unidad | figura`, los valores
`ficha`, `entidad` y `recuerdo`. Las fichas tienen su propia tabla FTS (`fichas_fts`),
las entidades la suya (`entidades_fts`) y la memoria la suya (`memoria_fts`). El
buscador fusiona la capa literal y la de comprensión. Cada resultado dice de qué capa
viene, y uno de comprensión arrastra sus evidencias literales.

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

La comprensión es un Workflow propio (`scholaris-comprension`). Se lanza cuando la
ingesta deja el documento «listo», así que el documento se puede leer y buscar desde el
primer momento y la comprensión llega después, con su progreso. Pasos:

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
4. **Entidades y menciones**: reconocimiento y correferencia en todo el documento (el
   reparto como guía), enlace a Wikidata (personas, lugares, obras) y, en el cine, la
   relación actor ↔ personaje (P161 con el calificador P453).
5. **Ficha global holística**: sinopsis extensa, tesis o argumento, temas y motivos con
   todas sus apariciones, cronología de la historia frente al orden del relato, voz y
   punto de vista, estilo y contexto. Lo que venga de fuera del documento (Wikidata,
   OpenAlex) se marca como contexto externo.
6. **Indexado**: fichas, entidades y menciones a FTS y vectores; segmentos a `secciones`.
7. **Transmedia**: detección de relaciones con el resto de la biblioteca (metadatos,
   Wikidata P144 «basado en», P629 «edición de», P655 traductor, guionista, título,
   contenido) y alineación de cada pareja relacionada. Cuando entra un documento nuevo
   se revisan sus relaciones con todos los demás.

Modelos: el de comprensión es el mejor disponible, elegido por medición en el banco
(candidatos a 4-11-2026: `gemini-4-argon`, `gemini-3.1-pro-preview`, `gemini-pro-latest`
y `gemini-3.8-flash`). Las ventanas pueden ir con uno rápido si el banco lo permite.
Se configuran en `MODELOS_GEMINI.comprension` y `MODELOS_GEMINI.comprensionRapida`.

## Responder: el modo Investigar

El modo rápido (`responder`) se queda para lo sencillo. `investigar` es un agente con
herramientas:

- `buscar`: capa literal y de comprensión, con filtros por documento, capa, idioma,
  tramo de páginas o de tiempo, entidad y tipo de segmento.
- `leer`: unidades o segmentos enteros.
- `mapa`: la estructura y la ficha global de un documento.
- `entidad`: una entidad y todas sus menciones en la biblioteca.
- `alinear`: lo que corresponde a un tramo en las obras relacionadas.
- `ver`: un fragmento de vídeo o unas páginas, que el modelo mira con la pregunta.
- `escuchar`: un tramo de audio.
- `recordar` y `anotar`: la memoria.

El agente planifica (qué obras intervienen, qué pruebas hacen falta y qué subpreguntas
salen), investiga en varios pasos con presupuesto de pasos y de tiempo, y apunta cada
prueba en un cuaderno de evidencias. Después escribe una respuesta con la extensión que
pida la pregunta, en registro académico, con tablas cuando compara. Cada afirmación
lleva su evidencia («p. 14», «1:02:03-1:03:10»). Lo visual se comprueba volviendo a
mirar, y lo que no se pueda probar se dice. Emite eventos en directo (`plan`, `paso`,
`evidencia`, `texto`, `verificacion`, `fin`) y guarda la pregunta, la respuesta y las
pruebas en la memoria.

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

Por dentro, el esquema pasa a SPDF 4.2 con las tablas de comprensión. Al exportar a 5.0,
la comprensión viaja como extensión opcional `x_scholaris_comprension`, con las tablas
`x_scholaris_segments`, `x_scholaris_cards`, `x_scholaris_entities`,
`x_scholaris_mentions`, `x_scholaris_relations` y `x_scholaris_alignments`. Las
relaciones nombran al otro documento por su `sha256-…` y la memoria va como anotaciones
W3C. En el repositorio de SPDF se propone un RFC para un perfil `understanding` en 5.1.
