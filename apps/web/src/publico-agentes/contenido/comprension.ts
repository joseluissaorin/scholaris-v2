import type { Pagina } from './tipos';
import { notaOjo } from '../../bocetos/dibujos/nota-ojo';

export const comprension: Pagina = {
  clave: 'comprension',
  rutas: { es: '/saber/comprension', en: '/en/knowledge/understanding' },
  boceto: notaOjo,
  es: {
    titulo: 'Lo que Scholaris entiende de cada obra y cómo lo prueba',
    corto: 'Comprensión',
    descripcion: 'La capa de comprensión: estructura, fichas con lentes de especialista, personajes y lugares, películas vistas plano a plano, obras que se adaptan o se traducen, el modo Investigar y el sitio material exacto de cada afirmación.',
    md: `## Una capa que se suma al texto

Leer una obra no es entenderla. Además de su texto fiel, Scholaris puede dejar escrito lo que anotaría quien la hubiera estudiado entera: de qué partes se compone, qué pasa o qué se argumenta en cada una, quién aparece y dónde, de qué trata el conjunto y con qué otras obras de tu biblioteca se relaciona. Esa capa no toca el texto: se guarda aparte, con el modelo y la versión que la produjeron, y se puede rehacer.

Todo lo que afirma lleva su prueba. Una ficha que dice que una escena está rodada en plano medio apunta al segundo exacto, y si se ve, a la región del fotograma; una que cita un libro apunta a la página y a los caracteres de la cita, y en un escaneado, al recuadro de la página donde está. Lo que no tiene prueba se marca como inferido.

## Lentes de especialista

Cada obra se analiza con los ojos de su disciplina, no con un resumen genérico. Hay dieciséis lentes: narrativa (orden, duración y frecuencia del relato, focalización, discurso), poesía, teatro, cine (escala de plano, angulación, movimiento, composición, montaje, sonido diegético o no), documental, periodismo, entrevista, pódcast, clase, ensayo (pregunta, tesis, argumentos, conceptos, obras con las que discute), artículo científico, archivo, jurídico, datos, presentaciones y una general. La lente se elige sola por el tipo de obra y su contenido, y cuando duda pregunta a un modelo rápido; también se puede fijar a mano.

## Estructura, fichas y entidades

La comprensión de una obra tiene cuatro piezas:

- **La estructura**: partes, capítulos, escenas, secuencias o planos, en árbol. En audio y vídeo alimenta los capítulos del reproductor.
- **Una ficha de cada parte** y **una ficha global** de la obra entera: sinopsis, tesis o sentido, temas y motivos con sus apariciones, orden del relato frente a cronología, voz y contexto. Lo que viene de fuera de la obra se marca como contexto externo.
- **Personas, personajes, lugares, obras y motivos**, enlazados al grafo de tu biblioteca: el mismo personaje es la misma entidad en el cuento y en la película que lo adapta. En el cine, cada personaje lleva el actor que lo interpreta.
- **Apariciones** de cada uno, con su ancla: nombrado en una página, en cuadro en un plano, con su voz en un tramo.

Las fichas se buscan como el resto de la biblioteca, por palabras y por significado.

## Películas, clases y audios vistos y oídos de verdad

De cada vídeo se hace una versión ligera, y un modelo lo ve entero por ventanas de unos ocho minutos: escenas, planos con su escala, angulación, movimiento y composición, quién está en cuadro y en qué región del fotograma, objetos significativos, texto en pantalla, música (diegética o no), canciones y silencios.

La transcripción se hace por piezas de dos minutos y medio y se compara con un mapa de dónde hay voz: los tramos que suenan y no tienen texto se vuelven a escuchar y se rellenan, y quién dice cada frase se corrige mirando quién habla en pantalla. Los tramos sin palabras que son música no cuentan como habla perdida. En una película de dos horas, los aciertos de hablante pasaron del 52 % al 96 %.

## Obras que se adaptan, se traducen o se responden

Scholaris busca qué obras de tu biblioteca se relacionan: una película que adapta un cuento, una traducción, otra edición, un ensayo que comenta un libro. Lo deduce de los metadatos, de Wikidata, de lo que la propia obra declara (los créditos de una película, por ejemplo), del grafo de citas y de los personajes que comparten. Puedes confirmar, rechazar o añadir relaciones a mano.

Cada pareja se **alinea** tramo a tramo: esta escena frente a este pasaje, este párrafo traducido frente al original, con el tipo de correspondencia (equivalente, condensado, ampliado, transformado, reordenado, añadido o suprimido) y una nota que dice qué cambia y con qué efecto. Además, una ficha analiza la transformación entera: estructura, personajes que se añaden o se funden, punto de vista, tiempo y final. Se ven lado a lado, con las dos obras abiertas.

Entre lenguas, una pregunta en inglés, francés o italiano encuentra el pasaje en español, y las citas se dan en el original con su traducción al lado.

## El modo Investigar

Para las preguntas difíciles hay un agente que primero mira lo que ya investigaste, después planifica (qué obras intervienen, qué pruebas hacen falta, en qué subpreguntas se divide) y luego investiga en varios pasos con herramientas: buscar en el texto y en la comprensión, leer unidades enteras, consultar el mapa de una obra, seguir una entidad por toda la biblioteca, ver las alineaciones y **mirar o escuchar el fragmento original** de un vídeo o una página.

La respuesta tiene la extensión que pida la pregunta, en registro académico y con tablas cuando compara. Cada afirmación va en su frase con su prueba, y un verificador comprueba frase a frase que la prueba dice eso: lo que se nombra o se cita tiene que estar literalmente en lo citado, y lo visual se vuelve a mirar. Lo que no se puede probar se dice. Nunca concluye que algo falta solo porque una búsqueda no lo encuentre. Cada investigación deja la pregunta en tu historial y sus pruebas en un cuaderno, como tarjetas verificadas.

En un banco de 36 preguntas difíciles sobre una película y el cuento que adapta (en cuatro lenguas, con trampas), la respuesta rápida de siempre obtenía 47 sobre 100 y cubría el 43 % de los puntos exigidos; Investigar, 84 y el 91 %.

## Cuánto cuesta y quién decide

Comprender usa modelos de pago, así que **no se lanza sola**: se pide con «Comprender» en cada documento, que antes dice lo que costará aproximadamente. Como orientación, con el mejor modelo un libro cuesta del orden de un dólar y una película de dos horas unos tres; el modo económico, con el modelo rápido, cuesta en torno a un tercio. Se puede poner un tope de gasto por documento: al llegar a él no se hacen más fichas de partes y lo demás se termina con el modelo rápido. Una investigación cuesta unos céntimos de dólar.

## En el fichero abierto

Al exportar a SPDF 5.0, la comprensión viaja como extensión opcional (\`scholaris_comprension\`): estructura, fichas, entidades con su identificador de Wikidata, apariciones, relaciones y alineaciones, con las anclas del estándar. Un lector que no la conozca la ignora. Los cuadernos de una investigación se exportan como anotaciones W3C. La propuesta para que esta capa forme parte del estándar en la versión 5.1 está en discusión pública.
`,
  },
  en: {
    titulo: 'What Scholaris understands about each work, and how it proves it',
    corto: 'Understanding',
    descripcion: 'The understanding layer: structure, cards written with a specialist lens, characters and places, films watched shot by shot, works that adapt or translate each other, Research mode, and the exact material place of every claim.',
    md: `## A layer on top of the text

Reading a work is not understanding it. Besides the faithful text, Scholaris can write down what someone who had studied the whole work would note: its parts, what happens or is argued in each, who appears and where, what the whole is about, and which other works in your library it relates to. This layer never touches the text: it is stored separately, with the model and version that produced it, and can be redone.

Every claim carries its evidence. A card saying a scene is shot in a medium shot points to the exact second and, when visible, to the region of the frame; one quoting a book points to the page and the characters of the quote and, on a scan, to the box on the page where it is. Anything without evidence is marked as inferred.

## Specialist lenses

Each work is analysed through its discipline, not with a generic summary. There are sixteen lenses: narrative (order, duration and frequency, focalisation, discourse), poetry, drama, film (shot scale, angle, camera movement, composition, editing, diegetic or non-diegetic sound), documentary, journalism, interview, podcast, lecture, essay (question, thesis, arguments, concepts, works it argues with), scientific article, archive, legal, data, slides and a general one. The lens is chosen automatically from the kind of work and its content, asking a fast model when unsure; it can also be set by hand.

## Structure, cards and entities

The understanding of a work has four pieces:

- **The structure**: parts, chapters, scenes, sequences or shots, as a tree. In audio and video it feeds the player's chapters.
- **A card for each part** and **a global card** for the whole work: synopsis, thesis or meaning, themes and motifs with their occurrences, narrative order against chronology, voice and context. Anything from outside the work is marked as external context.
- **People, characters, places, works and motifs**, linked to your library's graph: the same character is the same entity in a story and in the film that adapts it. In film, each character carries the actor who plays them.
- **Appearances** of each, with their anchor: named on a page, on screen in a shot, speaking in a span.

Cards are searched like the rest of the library, by words and by meaning.

## Films, lectures and audio, actually watched and heard

A light version of each video is made, and a model watches it whole in windows of about eight minutes: scenes, shots with scale, angle, movement and composition, who is on screen and in which region of the frame, significant objects, on-screen text, music (diegetic or not), songs and silences.

The transcript is made in pieces of two and a half minutes and compared with a map of where there is voice: spans that sound but have no text are listened to again and filled, and who says each line is corrected by looking at who speaks on screen. Wordless spans that are music do not count as lost speech. On a two-hour film, speaker accuracy went from 52 % to 96 %.

## Works that adapt, translate or answer each other

Scholaris looks for related works in your library: a film adapting a story, a translation, another edition, an essay discussing a book. It infers this from metadata, Wikidata, what the work itself states (a film's credits, for example), the citation graph and shared characters. You can confirm, reject or add relations by hand.

Each pair is **aligned** span by span: this scene against this passage, this translated paragraph against the original, with the kind of correspondence (equivalent, condensed, expanded, transformed, reordered, added or suppressed) and a note on what changes and to what effect. A card also analyses the whole transformation: structure, characters added or merged, point of view, time and ending. They are shown side by side, with both works open.

Across languages, a question in English, French or Italian finds the passage in Spanish, and quotes are given in the original with their translation alongside.

## Research mode

For hard questions there is an agent that first looks at what you have already researched, then plans (which works are involved, what evidence is needed, which sub-questions) and then investigates in several steps with tools: searching the text and the understanding layer, reading whole units, opening a work's map, following an entity through the whole library, looking at alignments and **watching or listening to the original span** of a video or a page.

The answer is as long as the question needs, in an academic register, with tables when comparing. Each claim sits in its own sentence with its evidence, and a verifier checks sentence by sentence that the evidence says so: anything named or quoted must be literally in what is cited, and visual claims are looked at again. What cannot be proved is said. It never concludes that something is missing just because a search did not find it. Each investigation stores the question in your history and its evidence in a notebook, as verified cards.

On a bench of 36 hard questions about a film and the story it adapts (in four languages, with traps), the usual quick answer scored 47 out of 100 and covered 43 % of the required points; Research mode scored 84 and covered 91 %.

## What it costs and who decides

Understanding uses paid models, so **it never starts on its own**: you ask for it with «Comprender» on each document, which first tells you roughly what it will cost. As a guide, with the best model a book costs about a dollar and a two-hour film about three; economy mode, with the fast model, costs around a third. A spending cap can be set per document: once reached, no more part cards are written and the rest is finished with the fast model. An investigation costs a few cents.

## In the open file

When exporting to SPDF 5.0, the understanding layer travels as an optional extension (\`scholaris_comprension\`): structure, cards, entities with their Wikidata identifier, appearances, relations and alignments, with the standard's anchors. A reader that does not know it ignores it. The notebooks of an investigation are exported as W3C annotations. The proposal to make this layer part of the standard in version 5.1 is under public discussion.
`,
  },
};
