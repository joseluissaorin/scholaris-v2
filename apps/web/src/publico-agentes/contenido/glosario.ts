import type { Pagina } from './tipos';
import { compas } from '../../bocetos/dibujos/compas';

export const glosario: Pagina = {
  clave: 'glosario',
  rutas: { es: '/saber/glosario', en: '/en/knowledge/glossary' },
  boceto: compas,
  es: {
    titulo: 'Glosario de Scholaris',
    corto: 'Glosario',
    descripcion: 'Las palabras que usa Scholaris, de folio y ancla a pliego, imprenta, SPDF o vigilante, con lo que significan aquí y, cuando viene a cuento, en la tradición del libro.',
    md: `## Las palabras

Ancla
: El sitio exacto de un pasaje dentro de su documento: la página física y el folio impreso, el segundo de un audio, la diapositiva, la hoja y las filas de una tabla, o la sección y el párrafo de una web con su fecha de consulta. Toda cita se escribe desde un ancla.

Autocita
: La función que lee tu borrador, busca en tu biblioteca un pasaje para cada afirmación y propone la cita con su página; tú aceptas o descartas.

Cuaderno
: Notas en Markdown con fichas de pasajes verificados que se pueden volver a comprobar contra la biblioteca.

Espacio vectorial
: El modelo, la versión y las dimensiones con que se calcularon unos vectores, por ejemplo «gemini-embedding-2@1536». Un .spdf puede llevar varios.

Ficha
: Los metadatos de un documento (autores, título, año, edición, editorial, DOI, ISBN…), cada campo con su procedencia.

Folio
: En el libro antiguo, cada hoja numerada, con su recto (r) y su vuelto (v): «fol. 23v». En Scholaris, por extensión, el número de página impreso en el papel, frente a la posición de la página en el fichero.

Foliación
: La numeración de un libro: por páginas, por hojas, en romanos y arábigos, con saltos y láminas sin numerar. Scholaris la reconstruye página a página.

Fragmento
: El pasaje que se busca y se cita: un trozo de texto con su ancla de inicio y de fin.

Grafía modernizada
: Una copia del texto con la ortografía puesta al día («dixo» → «dijo»), guardada aparte y usada solo para buscar. El texto que se cita conserva siempre la grafía original.

Huella
: El resumen SHA-256 de un fichero; dos ficheros con la misma huella son el mismo fichero.

Imprenta
: El conversor de Scholaris: reconoce el tipo de cada fichero y lo prepara para leerlo (páginas como imágenes, texto, audio, fotogramas). Trabaja en el navegador y, para lo que el navegador no sabe hacer, en un contenedor del servidor.

Jev
: El modelo de TypeSafe que hace de juez: reordena resultados, decide si un pasaje respalda una afirmación y elige entre candidatos de número de página.

Lector
: El modelo que lee páginas como imágenes y devuelve su texto fiel, sus notas, su cabecera y su pie, y el folio que ve impreso.

Manícula
: La manita con el índice extendido que los lectores antiguos dibujaban en los márgenes para señalar un pasaje. Es el emblema de Scholaris.

Pliego
: En imprenta, la hoja grande que, doblada, forma un cuadernillo del libro. En Scholaris, el grupo de cuatro páginas que se manda de una vez al lector.

Procedencia
: De dónde sale cada dato: qué fuente dio la ficha, qué lector leyó la página, con qué confianza y quién lo corrigió.

Reclamo
: En el libro antiguo, la palabra que se imprime al pie de una página y repite la primera de la siguiente. Scholaris la deja fuera del texto del pasaje.

SPDF
: El formato abierto de Scholaris para un documento ya leído: una base de datos SQLite comprimida con gzip, con texto, anclas, figuras, vectores y procedencia. Versión actual: 4.1.

Paquete .scholaris
: Una biblioteca entera en un ZIP: un .spdf por documento, un manifiesto y un aviso de derechos.

Tramo
: En audio y vídeo, la unidad citable: entre 30 y 60 segundos de transcripción que acaban en final de frase.

Unidad
: Lo que se cita como un todo: una página, un tramo de audio, una diapositiva, un trozo de hoja de cálculo.

Vigilante
: Una búsqueda guardada que se repite sola y avisa cuando cambia lo que encuentra.
`,
  },
  en: {
    titulo: 'Scholaris glossary',
    corto: 'Glossary',
    descripcion: 'The words Scholaris uses, from folio and anchor to pliego, imprenta, SPDF or watcher, with what they mean here and, where it helps, in the tradition of the book.',
    md: `## The words

Anchor (ancla)
: The exact place of a passage inside its document: the physical page and the printed folio, the second of a recording, the slide, the sheet and rows of a table, or the section and paragraph of a web page with its access date. Every citation is written from an anchor.

Autocite (autocita)
: The function that reads your draft, finds a passage in your library for each claim and proposes the citation with its page; you accept or discard.

Notebook (cuaderno)
: Markdown notes with cards of verified passages that can be checked again against the library.

Vector space (espacio vectorial)
: The model, version and dimensions used to compute some vectors, e.g. "gemini-embedding-2@1536". An .spdf can carry several.

Record (ficha)
: A document's metadata (authors, title, year, edition, publisher, DOI, ISBN…), each field with its provenance.

Folio
: In early books, each numbered leaf, with its recto (r) and verso (v): "fol. 23v". In Scholaris, by extension, the page number printed on paper, as opposed to the page's position in the file.

Foliation (foliación)
: How a book is numbered: by pages or leaves, in roman and arabic numerals, with jumps and unnumbered plates. Scholaris rebuilds it page by page.

Fragment (fragmento)
: The passage that is searched and cited: a stretch of text with its start and end anchors.

Modernised spelling (grafía modernizada)
: A copy of the text with spelling brought up to date ("dixo" → "dijo"), stored separately and used only for searching. The cited text always keeps its original spelling.

Hash (huella)
: The SHA-256 digest of a file; two files with the same hash are the same file.

Imprenta (the press)
: Scholaris's converter: it recognises each file's type and prepares it for reading (pages as images, text, audio, frames). It works in the browser and, for what the browser cannot do, in a server container.

Jev
: TypeSafe's model that acts as judge: it reranks results, decides whether a passage supports a claim and chooses between page-number candidates.

Reader (lector)
: The model that reads pages as images and returns their faithful text, notes, header and footer, and the folio it sees printed.

Manicule (manícula)
: The little hand with an outstretched finger that early readers drew in margins to point at a passage. It is Scholaris's emblem.

Pliego
: In printing, the large sheet that, folded, makes a gathering of the book. In Scholaris, the group of four pages sent at once to the reader.

Provenance (procedencia)
: Where each piece of data comes from: which source gave the record, which reader read the page, how confidently and who corrected it.

Catchword (reclamo)
: In early books, the word printed at the foot of a page that repeats the first word of the next. Scholaris keeps it out of the passage text.

SPDF
: Scholaris's open format for a document already read: a gzip-compressed SQLite database with text, anchors, figures, vectors and provenance. Current version: 4.1.

.scholaris package
: A whole library in a ZIP: one .spdf per document, a manifest and a rights notice.

Stretch (tramo)
: In audio and video, the citable unit: 30 to 60 seconds of transcript ending at a sentence boundary.

Unit (unidad)
: What is cited as a whole: a page, a stretch of audio, a slide, a chunk of a spreadsheet.

Watcher (vigilante)
: A saved search that repeats itself and tells you when what it finds changes.
`,
  },
};
