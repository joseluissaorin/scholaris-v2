import type { Pagina } from './tipos';
import { lupa } from '../../bocetos/dibujos/lupa';

export const busqueda: Pagina = {
  clave: 'busqueda',
  rutas: { es: '/saber/busqueda', en: '/en/knowledge/search' },
  boceto: lupa,
  es: {
    titulo: 'Cómo busca, por palabras, por sentido y por imagen',
    corto: 'Búsqueda',
    descripcion: 'Tres búsquedas a la vez (léxica, semántica y visual) que se funden y se reordenan; frases exactas entre comillas; una capa de grafía modernizada para el castellano antiguo y el latín, y resultados en dos tiempos.',
    md: `## Tres caminos que se juntan

Cada consulta va a la vez por tres caminos y los resultados se funden por rango recíproco (RRF), con pesos que dependen de lo que parece que buscas:

| Camino | Qué encuentra | Cómo |
| --- | --- | --- |
| Léxico | Las palabras que escribes, sin distinguir tildes | Índice FTS5 de SQLite con BM25; los títulos de sección y el contexto pesan menos que el texto |
| Semántico | Lo que significa la consulta, aunque el pasaje use otras palabras o esté en otra lengua | Vectores de Gemini Embedding 2 (1536 dimensiones) en Cloudflare Vectorize |
| Visual | Láminas, figuras, gráficos y fotogramas | Los mismos vectores multimodales, aplicados a las imágenes de las páginas y a las figuras |

| Si la consulta parece… | léxico | semántico | visual |
| --- | --- | --- | --- |
| una idea | 0,35 | 1 | 0 |
| una cita literal | 1 | 0,45 | 0 |
| algo que se ve | 0,35 | 0,6 | 1 |
| una pregunta por fechas | 0,35 | 1 | 0 |

Los treinta primeros candidatos los reordena un juez, Jev (de TypeSafe), que contesta para cada pasaje si responde a la consulta; la puntuación final es un 20 % la de la fusión y un 80 % la del juez. El camino visual solo pesa cuando buscas algo que se ve: medido solo, acierta poco con preguntas de texto y las empeoraba.

## Frases exactas

Entre comillas («…», "…" o “…”) la frase se busca literal, sin modelo de por medio. Primero salen las coincidencias exactas y después los pasajes cercanos en sentido. Si la frase no aparece en ningún sitio, Scholaris lo dice («La frase exacta no aparece; se busca por sentido») en lugar de fingir que la encontró.

## Castellano antiguo y latín {#grafia}

Un libro del siglo XVII escribe «dixo», «muger», «assi» o «agora»; tú buscas «dijo», «mujer», «así», «ahora». Para que se encuentren sin tocar el texto que se cita, cada pasaje lleva una **sombra en grafía modernizada** que solo sirve para buscar, y la consulta se reduce con las mismas reglas:

- **castellano de los siglos XVI a XVIII:** listas de palabras (fee → fe, agora → ahora, mesmo → mismo, truxo → trajo) y reglas fonéticas y ortográficas (b/v, c/z, g/j, h, x → j, ph, rr…);
- **latín:** u/v, i/j, æ/œ, michi → mihi, enclíticos -que/-ne/-ve y el lematizador de Schinke y otros (1996);
- **francés e italiano antiguos:** reglas básicas.

La capa se aplica al latín siempre y a las demás lenguas cuando el documento es anterior a una fecha de corte (1830 para el castellano, 1800 para el francés y el italiano) o el propio texto da señales (ſ, ç, «assi», «dixo»…). Son reglas, sin modelos. En una comedia de Lope, la exhaustividad media por consulta pasó del 32 % al 100 %; en documentos modernos, las búsquedas devuelven exactamente lo mismo que sin la capa (ver [Rendimiento](/saber/rendimiento)).

## Resultados en dos tiempos

En la aplicación, la búsqueda llega en tres entregas por un canal de eventos: primero lo que encuentra el índice léxico, sin esperar al vector de la consulta; después la fusión de los tres caminos, hacia los 350 ms; y al final el orden del juez, hacia los 650 ms de mediana medidos desde casa. Lo primero que ves ya es útil y no se reordena de golpe.

## Filtros

Se puede filtrar por biblioteca, documento, tipo, autor, idioma y año (desde, hasta). Algunos filtros se entienden escritos en la propia consulta: «antes de 1980», «desde 1950», el apellido de un autor de tu biblioteca. «Ir a la página 145» salta a esa página impresa.

## Lo que devuelve cada resultado

El pasaje literal, su cita lista para pegar («(Foucault, 1975, p. 23)»), el localizador exacto, el ancla y un enlace que abre el lector en esa página o en ese segundo. La búsqueda nunca escribe una cita: la cita sale del ancla.

## También

- **Preguntar:** una respuesta breve en Markdown con notas al pie; el redactor solo puede citar los pasajes que se le dan y cada nota se comprueba.
- **Parecidos:** pasajes y figuras parecidos a uno dado.
- **En varias lenguas:** la consulta traducida a las lenguas de tu biblioteca.
- **Bibliotecas que sigues:** buscar a la vez en las tuyas y en las que otros comparten contigo.
`,
  },
  en: {
    titulo: 'How it searches, by words, by meaning and by image',
    corto: 'Search',
    descripcion: 'Three searches at once (lexical, semantic and visual), fused and reranked; exact phrases in quotes; a modernised-spelling layer for Old Spanish and Latin; and results that arrive in two stages.',
    md: `## Three routes that meet

Every query goes down three routes at once, and the results are fused by reciprocal rank (RRF), with weights that depend on what you seem to be looking for:

| Route | What it finds | How |
| --- | --- | --- |
| Lexical | The words you type, accent-insensitive | SQLite FTS5 index with BM25; section headings and context weigh less than the text |
| Semantic | What the query means, even when the passage uses other words or another language | Gemini Embedding 2 vectors (1536 dimensions) in Cloudflare Vectorize |
| Visual | Plates, figures, charts and video frames | The same multimodal vectors, applied to page images and figures |

| If the query looks like… | lexical | semantic | visual |
| --- | --- | --- | --- |
| an idea | 0.35 | 1 | 0 |
| a literal quotation | 1 | 0.45 | 0 |
| something you can see | 0.35 | 0.6 | 1 |
| a question about dates | 0.35 | 1 | 0 |

The top thirty candidates are reranked by a judge, Jev (by TypeSafe), which answers for each passage whether it addresses the query; the final score is 20 % fusion and 80 % judge. The visual route only counts when you are looking for something visual: on its own it does poorly on text questions and was making them worse.

## Exact phrases

In quotes ("…", “…” or «…») the phrase is searched literally, with no model involved. Exact matches come first, then passages close in meaning. If the phrase appears nowhere, Scholaris says so ("La frase exacta no aparece; se busca por sentido": the exact phrase does not appear, searching by meaning) instead of pretending it found it.

## Old Spanish and Latin {#grafia}

A seventeenth-century book writes "dixo", "muger", "assi" or "agora"; you search for "dijo", "mujer", "así", "ahora". So that they meet without touching the text that is cited, every passage carries a **modernised-spelling shadow** used only for searching, and the query is reduced with the same rules:

- **Spanish, 16th to 18th century:** word lists (fee → fe, agora → ahora, mesmo → mismo, truxo → trajo) and phonetic and spelling rules (b/v, c/z, g/j, h, x → j, ph, rr…);
- **Latin:** u/v, i/j, æ/œ, michi → mihi, the enclitics -que/-ne/-ve and the Schinke et al. (1996) stemmer;
- **Old French and Italian:** basic rules.

The layer always applies to Latin, and to the other languages when the document predates a cut-off (1830 for Spanish, 1800 for French and Italian) or the text itself gives signs (ſ, ç, "assi", "dixo"…). It is rules, no models. On a play by Lope de Vega, average recall per query went from 32 % to 100 %; on modern documents, searches return exactly the same as without the layer (see [Performance](/en/knowledge/performance)).

## Results in two stages

In the app, search arrives in three deliveries over an event stream: first what the lexical index finds, without waiting for the query vector; then the fusion of the three routes, at around 350 ms; and finally the judge's order, at around 650 ms median measured from home. What you see first is already useful and does not get reshuffled all at once.

## Filters

You can filter by library, document, type, author, language and year (from, to). Some filters are understood when written into the query itself: "before 1980", "since 1950", the surname of an author in your library. "Go to page 145" jumps to that printed page.

## What each result returns

The literal passage, its citation ready to paste ("(Foucault, 1975, p. 23)"), the exact locator, the anchor and a link that opens the reader at that page or second. Search never writes a citation: the citation comes from the anchor.

## Also

- **Ask:** a short Markdown answer with footnotes; the writer may only cite the passages it is given, and every note is checked.
- **Similar:** passages and figures similar to a given one.
- **Across languages:** the query translated into the languages of your library.
- **Libraries you follow:** search your own and the ones others share with you at the same time.
`,
  },
};
