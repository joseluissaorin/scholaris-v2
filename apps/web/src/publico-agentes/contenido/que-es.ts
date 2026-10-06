import type { Pagina } from './tipos';
import { manecilla } from '../../portada/dibujo/dibujos/manicula';

export const queEs: Pagina = {
  clave: 'que-es',
  rutas: { es: '/saber/que-es', en: '/en/knowledge/what-it-is' },
  tipo: 'AboutPage',
  boceto: manecilla,
  es: {
    titulo: 'Qué es Scholaris y qué no hará nunca',
    corto: 'Qué es',
    descripcion: 'Una biblioteca que lee tus fuentes y, cuando preguntas, señala la página impresa o el segundo exactos. Las reglas que la sostienen: no inventar citas, enseñar la procedencia y dejar el pensamiento a quien escribe.',
    md: `## Lo que hace

Scholaris es una aplicación web (y una versión para tu ordenador) para quien lee para escribir. Subes tus fuentes: libros escaneados, artículos, tesis, apuntes, presentaciones, entrevistas grabadas, clases, vídeos de YouTube, páginas web. Scholaris las lee una vez, con cuidado, y a partir de ahí puedes:

- **buscar** en toda tu biblioteca a la vez, por palabras exactas o por sentido, en cualquier lengua, también en castellano antiguo y en latín;
- **preguntar**, y recibir una respuesta corta con notas al pie, cada una con su pasaje;
- **citar** en el estilo que pida tu revista, con la página impresa de la edición que tienes delante o el minuto exacto de la grabación;
- **verificar** si tu biblioteca respalda una frase de tu borrador;
- **explorar** lo que tu biblioteca tiene dentro: personas, obras, lugares y conceptos, y cómo se citan unos libros a otros.

## Las cuatro reglas

### Señalar la página exacta

Una cita que no dice dónde está no se puede comprobar. Por eso Scholaris guarda de cada pasaje un **ancla**: el folio impreso que se ve en el papel (no el número que pone el visor de PDF), el segundo de una grabación, la diapositiva, la hoja y las filas de una tabla, o la sección y el párrafo de una web con su fecha de consulta. Cómo se calcula cada ancla está en [Formatos y anclas](/saber/formatos).

### No inventar citas

Ninguna cita sale de un modelo de lenguaje. El modelo puede redactar una respuesta, pero solo puede citar los pasajes que se le dan, y cada nota se comprueba contra el texto antes de enseñártela; la referencia (autor, año, página) se escribe desde el ancla guardada. Si no hay pasaje, la respuesta lo dice. En el banco de pruebas de citas, sobre 41 afirmaciones, las citas inventadas fueron cero (ver [Rendimiento](/saber/rendimiento)).

### Enseñar la procedencia

Cada dato lleva su origen a la vista: de qué fuente salió la ficha (el propio PDF, Crossref, OpenAlex, Open Library, Wikidata), con qué confianza se leyó un número de página, si se dedujo o se leyó impreso, y quién lo corrigió. Lo que no se sabe se deja vacío en lugar de rellenarlo.

### Dejar el pensamiento a quien escribe

Scholaris no escribe ensayos, no resume libros para que no tengas que leerlos y no decide qué cita es la buena. Te lleva al sitio; lo que hagas con lo que encuentres es tuyo.

## Lo que no hace (todavía o nunca)

- No busca en internet por ti: trabaja sobre lo que tú le das. Para descubrir literatura nueva hay herramientas mejores (ver [Alternativas](/saber/alternativas)).
- No escribe tu texto. La función «citar» devuelve tu propio texto con las citas insertadas, no un texto nuevo.
- No garantiza que un número de página impreso sea correcto cuando el libro no lo imprime: en ese caso cita la posición física entre corchetes, «p. [12]», y lo dice.
- No funciona del todo sin conexión: incluso la versión local necesita un proveedor en la nube para leer páginas (ver [Versión local](/saber/version-local)).

## Para quién es

Para la doctoranda con trescientos PDF y una directora que pide la página; para el profesor que prepara clase con veinte años de subrayados; para la periodista que vuelve a una entrevista de hace dos años buscando una frase; para quien traduce, archiva o estudia, y para cualquiera que haya dicho alguna vez «lo leí en algún sitio».
`,
  },
  en: {
    titulo: 'What Scholaris is, and what it will never do',
    corto: 'What it is',
    descripcion: 'A library that reads your sources and, when you ask, points to the exact printed page or second. The rules that hold it up: never invent a citation, show the provenance, leave the thinking to whoever writes.',
    md: `## What it does

Scholaris is a web app (and a version for your own computer) for people who read in order to write. You upload your sources: scanned books, papers, theses, notes, slides, recorded interviews, lectures, YouTube videos, web pages. Scholaris reads them once, carefully, and from then on you can:

- **search** your whole library at once, by exact words or by meaning, in any language, Old Spanish and Latin included;
- **ask**, and get a short answer with footnotes, each tied to its passage;
- **cite** in whatever style your journal wants, with the printed page of the edition in front of you or the exact minute of the recording;
- **verify** whether your library supports a sentence in your draft;
- **explore** what your library holds: people, works, places and concepts, and how the books cite each other.

## The four rules

### Point to the exact page

A citation that does not say where it is cannot be checked. So Scholaris stores an **anchor** for every passage: the printed folio you see on paper (not the number your PDF viewer shows), the second of a recording, the slide, the sheet and rows of a table, or the section and paragraph of a web page with its access date. How each anchor is worked out is in [Formats and anchors](/en/knowledge/formats).

### Never invent a citation

No citation comes from a language model. A model may draft an answer, but it may only cite the passages it is given, and every note is checked against the text before you see it; the reference (author, year, page) is written from the stored anchor. If there is no passage, the answer says so. In the citation benchmark, over 41 claims, invented citations were zero (see [Performance](/en/knowledge/performance)).

### Show the provenance

Every piece of data shows where it came from: which source the record came from (the PDF itself, Crossref, OpenAlex, Open Library, Wikidata), how confidently a page number was read, whether it was printed or inferred, and who corrected it. What is not known is left empty instead of being filled in.

### Leave the thinking to whoever writes

Scholaris does not write essays, does not summarise books so you can skip them and does not decide which quotation is the good one. It takes you to the place; what you do with what you find is yours.

## What it does not do (yet, or ever)

- It does not search the internet for you: it works on what you give it. For discovering new literature there are better tools (see [Alternatives](/en/knowledge/alternatives)).
- It does not write your text. The "cite" function gives you back your own text with the citations inserted, not a new text.
- It cannot guarantee a printed page number when the book does not print one: in that case it cites the physical position in brackets, "p. [12]", and says so.
- It does not work fully offline: even the home version needs a cloud provider to read pages (see [Self-hosting](/en/knowledge/self-hosting)).

## Who it is for

For the doctoral student with three hundred PDFs and a supervisor who wants the page number; for the lecturer preparing a class with twenty years of underlining; for the journalist going back to a two-year-old interview in search of one sentence; for translators, archivists and students, and for anyone who has ever said "I read it somewhere".
`,
  },
};
