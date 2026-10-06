import type { Pagina } from './tipos';
import { constelacionVacia } from '../../bocetos/dibujos/constelacion-vacia';

export const investigacion: Pagina = {
  clave: 'investigacion',
  rutas: { es: '/saber/investigacion', en: '/en/knowledge/research-tools' },
  boceto: constelacionVacia,
  es: {
    titulo: 'Las herramientas para pensar con una biblioteca entera',
    corto: 'Explorar',
    descripcion: 'El grafo de personas, obras, lugares y conceptos enlazado con Wikidata; el mapa de conceptos; el grafo de citas entre tus libros; los vigilantes que avisan cuando algo cambia y los cuadernos con citas que se vuelven a comprobar.',
    md: `## Personas, obras, lugares y conceptos

Scholaris lee toda la biblioteca buscando entidades: personas, obras, lugares, organizaciones, conceptos, acontecimientos y fechas (y distingue a los personajes de ficción). Un modelo las propone por lotes de unos 48 000 caracteres, y después el código busca cada mención en el texto, de modo que cada aparición tiene su ancla exacta y se puede abrir en su página. Cada entidad se enlaza, cuando se puede, con su ficha de Wikidata.

Dos entidades quedan unidas cuando aparecen cerca: el peso de la arista baja con la distancia dentro del pasaje y es menor entre pasajes vecinos. Para las relaciones más fuertes de cada documento, un modelo pone nombre a la relación. Desde el grafo se puede ver a los vecinos de una entidad, su línea temporal y el camino más corto entre dos. Medido en el banco, extraer las entidades de 300 páginas cuesta unos 0,03 $.

## El mapa de conceptos

Una vista de la biblioteca como un mapa del cielo: los vectores de los pasajes y las figuras se agrupan, se proyectan a dos dimensiones con UMAP (sobre una muestra de hasta 8000 puntos) y cada grupo recibe un nombre. Sirve para ver de qué habla tu biblioteca y qué queda lejos de qué.

Aparte está **Conceptos**: escribes un concepto y Scholaris reúne dónde se define, dónde se aplica, dónde se critica y dónde solo se menciona, con su pasaje y su página. Se exporta en CSV, JSON, JSONL, HTML, BibTeX, TEI y XLSX.

## El grafo de citas

Cómo se citan unos documentos de tu biblioteca a otros. Las entradas de la bibliografía de cada documento se resuelven contra tu biblioteca por DOI, por título (con el año compatible) o por primer autor y año cuando solo hay un candidato, y cada enlace lleva su confianza. Lo que tus libros citan y tú no tienes aparece como **referencias huérfanas**: una lista de lo que te falta por leer. El grafo solo mira dentro de tu biblioteca; no consulta bases externas.

## Vigilantes

Un vigilante es una búsqueda guardada que se repite sola: a mano, al subir un documento, cada día o cada semana (en la nube, cada día a las 06:17 UTC, y los lunes los semanales). Te avisa cuando aparece un documento nuevo entre los primeros resultados o cuando la respuesta cambia: si sube o baja la confianza, o si dice otra cosa.

## Cuadernos

Notas en Markdown con fichas: un pasaje, una página, una figura, un tramo de audio, una nota tuya o una síntesis. Cada ficha guarda una copia verificada del pasaje, su ancla y una huella, y con **volver a verificar** Scholaris comprueba que la biblioteca sigue diciendo lo mismo: citas vivas. La síntesis de un cuaderno solo puede citar las fichas del propio cuaderno; cualquier otra marca se elimina.

## Perspectivas

Documentos que llevas tiempo sin abrir, huecos (temas de los que tienes poco) y recomendaciones dentro de lo que ya tienes.
`,
  },
  en: {
    titulo: 'The tools for thinking with a whole library',
    corto: 'Explore',
    descripcion: 'The graph of people, works, places and concepts linked to Wikidata; the concept map; the citation graph between your books; watchers that tell you when something changes; and notebooks whose citations are checked again.',
    md: `## People, works, places and concepts

Scholaris reads the whole library looking for entities: people, works, places, organisations, concepts, events and dates (and it tells fictional characters apart). A model proposes them in batches of about 48,000 characters, and then code finds each mention in the text, so every occurrence has its exact anchor and can be opened at its page. Each entity is linked, where possible, to its Wikidata record.

Two entities are joined when they appear close together: the edge weight falls with distance inside a passage and is lower between neighbouring passages. For the strongest relations in each document, a model names the relation. From the graph you can see an entity's neighbours, its timeline and the shortest path between two. Measured in the benchmark, extracting the entities of 300 pages costs about $0.03.

## The concept map

A view of the library as a chart of the sky: the vectors of passages and figures are clustered, projected to two dimensions with UMAP (on a sample of up to 8,000 points) and each cluster gets a name. It shows what your library talks about and what lies far from what.

Separately there is **Concepts**: you type a concept and Scholaris gathers where it is defined, applied, criticised and merely mentioned, each with its passage and page. It exports to CSV, JSON, JSONL, HTML, BibTeX, TEI and XLSX.

## The citation graph

How the documents in your library cite each other. The bibliography entries of each document are resolved against your library by DOI, by title (with a compatible year) or by first author and year when there is a single candidate, and every link carries its confidence. What your books cite and you do not have shows up as **orphan references**: a list of what you still have to read. The graph only looks inside your library; it does not query external databases.

## Watchers

A watcher is a saved search that repeats itself: by hand, on every upload, daily or weekly (in the cloud, every day at 06:17 UTC, and the weekly ones on Mondays). It tells you when a new document enters the top results or when the answer changes: if confidence rises or falls, or if it says something else.

## Notebooks

Markdown notes with cards: a passage, a page, a figure, a stretch of audio, a note of yours or a synthesis. Each card keeps a verified copy of the passage, its anchor and a hash, and with **verify again** Scholaris checks that the library still says the same thing: living citations. A notebook's synthesis may only cite the notebook's own cards; any other mark is removed.

## Perspectives

Documents you have not opened in a while, gaps (topics you have little on) and recommendations from within what you already have.
`,
  },
};
