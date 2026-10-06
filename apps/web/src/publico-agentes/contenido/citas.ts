import type { Pagina } from './tipos';
import { notaFolio } from '../../bocetos/dibujos/nota-folio';

export const citas: Pagina = {
  clave: 'citas',
  rutas: { es: '/saber/citas', en: '/en/knowledge/citations' },
  boceto: notaFolio,
  comoSe: { id: 'subir-y-citar', es: 'Subir una fuente y citarla con su página exacta', en: 'Upload a source and cite it with its exact page' },
  es: {
    titulo: 'Citas que se comprueban antes de llegar a ti',
    corto: 'Citas',
    descripcion: 'Nueve estilos CSL, BibTeX, RIS y CSL-JSON; una autocita que repasa tu borrador y propone cada referencia con su página; verificación de afirmaciones con lógica temporal, e inserción en .docx sin romper el formato.',
    md: `## Subir y citar, paso a paso {#subir-y-citar}

1. Entra en Scholaris, o pruébalo sin cuenta desde [la demostración](/?demostracion).
2. En la Biblioteca, arrastra el fichero (o pega una dirección: una web, un PDF, YouTube, un pódcast). Las primeras páginas de un PDF digital se pueden buscar en menos de un segundo; las de un escaneado, en unos segundos.
3. En Buscar, escribe la idea con tus palabras o la frase exacta entre comillas.
4. En el resultado, copia la referencia: sale en tu estilo, con la página impresa o el minuto, y como texto con formato (cursivas incluidas).
5. Para un texto entero, ve a Escribir y pega tu borrador o sube tu .docx: la autocita propone una cita para cada afirmación, con su página, y tú aceptas o descartas una a una.
6. Exporta el texto citado (.docx, Markdown, texto o LaTeX) y la bibliografía (BibTeX, RIS o CSL-JSON).

## Estilos

Las citas las da formato citeproc-js con los ficheros CSL oficiales, en cuatro locales (es-ES, en-US, fr-FR, it-IT). El estilo por defecto es APA.

| Identificador | Estilo |
| --- | --- |
| apa | APA, 7.ª edición |
| chicago-author-date | Chicago, 18.ª edición, autor-fecha |
| chicago-note-bibliography | Chicago, 18.ª edición, notas y bibliografía |
| mla | MLA, 9.ª edición |
| harvard | Harvard (Cite Them Right, 12.ª edición) |
| iso690 | ISO 690 autor-fecha, en castellano |
| iso690-en | ISO 690 autor-fecha, en inglés |
| iso690-numerico | ISO 690 numérico |
| ieee | IEEE |

Cuando la fecha de la obra original no coincide con la de la edición, sale como fecha original («1605/2004»); la edición se indica salvo que sea una reimpresión del mismo año.

## De dónde sale cada cita

La cita no la escribe un modelo. El localizador («p. 23», «12:04», «diap. 7») sale del ancla guardada al leer el documento (ver [Formatos y anclas](/saber/formatos)), y el autor, el año y el título salen de la ficha, cuya procedencia se puede consultar campo a campo. La ficha se contrasta con Crossref, OpenAlex, Open Library y Wikidata, y solo se acepta un registro externo si el título coincide y además coincide el autor o el año.

## La autocita

Para un borrador entero, Scholaris:

1. lo parte en párrafos y afirmaciones;
2. recupera catorce pasajes candidatos para cada una;
3. deja que un modelo proponga qué pasaje respalda cada afirmación;
4. comprueba en código que la evidencia aparece literal en el pasaje, que no se cita una afirmación negativa como si fuera positiva, que están los términos clave y que la cronología es posible;
5. y pasa cada propuesta por un juez (Jev, de TypeSafe) en lotes de ocho.

Las propuestas con probabilidad de 0,7 o más quedan aceptadas; entre 0,4 y 0,7, para revisar; por debajo, se descartan. Las páginas consecutivas verificadas se juntan («pp. 23-25»). En el banco de pruebas, la precisión fue del 95,1 %, la exhaustividad del 96,7 % y las citas inventadas, cero.

## Verificar una afirmación

Le das una frase y Scholaris dice si tu biblioteca la respalda, con los pasajes:

respaldada
: el mejor pasaje la apoya directamente, con probabilidad de 0,7 o más.

parcial
: algún pasaje la apoya en parte (probabilidad de 0,4 o más).

contradicha
: algún pasaje dice lo contrario, con probabilidad de 0,5 o más.

sin_respaldo
: no hay pasajes que la apoyen.

El juez clasifica además la relación de cada pasaje con la afirmación: apoyo directo, aplicación de un marco, contexto, contradicción, opinión referida o afirmación negativa.

## La lógica temporal

Comparar fechas no se le pide a un modelo: lo hace el código.

- Se usa el año de la obra original, no el de la edición.
- Un texto no puede apoyar directamente una afirmación sobre algo que se inventó después: Scholaris conoce el año de aparición de términos como «internet» (1983), «deconstrucción» (1967) o «transformer» (2017).
- Si la afirmación dice que un autor «anticipó» o «se basó en» otro, la cronología tiene que ser posible; si no lo es, la cita se descarta.
- Si la afirmación habla de un año más de veinte años posterior a la fuente, el apoyo directo baja a «aplicación de un marco».
- Una fuente posterior al año de tu propio texto no puede citarse en él.
- Sin fecha («s. f.»), no se aplica nada de esto.

## Dentro de Word

Scholaris abre el .docx, inserta cada cita en su sitio respetando el formato de cada fragmento de texto, usa notas al pie de verdad de Word en los estilos de notas y añade la bibliografía al final. También acepta ODT, texto, Markdown y HTML, hasta 50 MB.

## Copiar una referencia

Cada documento tiene un botón para copiar su referencia en tu estilo (o en otro, con vista previa). Se copia como texto con formato, con las cursivas, y como texto plano.

## Exportar e importar

- Exportar: BibTeX, RIS y CSL-JSON; la bibliografía, como texto, HTML o Markdown.
- Importar un BibTeX (por ejemplo, el de Zotero): cada entrada se casa con tus documentos por DOI, después por ISBN y después por título; las que no casan quedan como referencias sin texto.
`,
  },
  en: {
    titulo: 'Citations that are checked before they reach you',
    corto: 'Citations',
    descripcion: 'Nine CSL styles, BibTeX, RIS and CSL-JSON; an autocite that reads your draft and proposes each reference with its page; claim verification with temporal logic; and insertion into .docx without breaking the formatting.',
    md: `## Upload and cite, step by step {#subir-y-citar}

1. Sign in to Scholaris, or try it without an account in [the demo](/?demostracion).
2. In the Library (Biblioteca), drop the file (or paste an address: a web page, a PDF, YouTube, a podcast). The first pages of a digital PDF are searchable in under a second; those of a scan, in a few seconds.
3. In Search (Buscar), type the idea in your own words or the exact phrase in quotes.
4. In the result, copy the reference: it comes out in your style, with the printed page or the minute, as formatted text (italics included).
5. For a whole text, go to Write (Escribir) and paste your draft or upload your .docx: autocite proposes a citation for each claim, with its page, and you accept or discard them one by one.
6. Export the cited text (.docx, Markdown, plain text or LaTeX) and the bibliography (BibTeX, RIS or CSL-JSON).

## Styles

Citations are formatted by citeproc-js with the official CSL files, in four locales (es-ES, en-US, fr-FR, it-IT). The default style is APA.

| Identifier | Style |
| --- | --- |
| apa | APA, 7th edition |
| chicago-author-date | Chicago, 18th edition, author-date |
| chicago-note-bibliography | Chicago, 18th edition, notes and bibliography |
| mla | MLA, 9th edition |
| harvard | Harvard (Cite Them Right, 12th edition) |
| iso690 | ISO 690 author-date, Spanish |
| iso690-en | ISO 690 author-date, English |
| iso690-numerico | ISO 690 numeric |
| ieee | IEEE |

When the date of the original work differs from the edition's, it appears as the original date ("1605/2004"); the edition is given unless it is a same-year reprint.

## Where each citation comes from

No model writes the citation. The locator ("p. 23", "12:04", "slide 7") comes from the anchor stored when the document was read (see [Formats and anchors](/en/knowledge/formats)), and author, year and title come from the record, whose provenance you can inspect field by field. The record is checked against Crossref, OpenAlex, Open Library and Wikidata, and an external record is only accepted if the title matches and the author or the year matches too.

## Autocite

For a whole draft, Scholaris:

1. splits it into paragraphs and claims;
2. retrieves fourteen candidate passages for each;
3. lets a model propose which passage supports each claim;
4. checks in code that the evidence appears verbatim in the passage, that a negative statement is not cited as if it were positive, that the key terms are there and that the chronology is possible;
5. and runs every proposal past a judge (Jev, by TypeSafe) in batches of eight.

Proposals with probability 0.7 or more are accepted; between 0.4 and 0.7, flagged for review; below that, discarded. Consecutive verified pages are merged ("pp. 23-25"). In the benchmark, precision was 95.1 %, recall 96.7 % and invented citations zero.

## Verifying a claim

You give it a sentence and Scholaris says whether your library supports it, with the passages:

respaldada (supported)
: the best passage supports it directly, with probability 0.7 or more.

parcial (partial)
: some passage partly supports it (probability 0.4 or more).

contradicha (contradicted)
: some passage says the opposite, with probability 0.5 or more.

sin_respaldo (unsupported)
: no passage supports it.

The judge also classifies how each passage relates to the claim: direct support, application of a framework, context, contradiction, reported opinion or negative statement.

## Temporal logic

Comparing dates is not left to a model: code does it.

- The year of the original work is used, not the edition's.
- A text cannot directly support a claim about something invented later: Scholaris knows when terms like "internet" (1983), "deconstruction" (1967) or "transformer" (2017) appeared.
- If the claim says one author "anticipated" or "built on" another, the chronology has to be possible; if it is not, the citation is dropped.
- If the claim refers to a year more than twenty years after the source, direct support is downgraded to "application of a framework".
- A source later than the year of your own text cannot be cited in it.
- Undated sources ("n.d.") skip all of this.

## Inside Word

Scholaris opens the .docx, inserts each citation in place keeping the formatting of every run of text, uses real Word footnotes for note styles and appends the bibliography. It also takes ODT, plain text, Markdown and HTML, up to 50 MB.

## Copying a reference

Every document has a button to copy its reference in your style (or another, with a preview). It is copied as formatted text, italics included, and as plain text.

## Export and import

- Export: BibTeX, RIS and CSL-JSON; the bibliography as text, HTML or Markdown.
- Import a BibTeX file (from Zotero, say): each entry is matched to your documents by DOI, then ISBN, then title; those that do not match stay as references without text.
`,
  },
};
