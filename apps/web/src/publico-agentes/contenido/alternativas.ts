import type { Pagina } from './tipos';
import { borron } from '../../bocetos/dibujos/borron';

export const alternativas: Pagina = {
  clave: 'alternativas',
  rutas: { es: '/saber/alternativas', en: '/en/knowledge/alternatives' },
  boceto: borron,
  es: {
    titulo: 'Scholaris al lado de Zotero, Elicit, NotebookLM y los demás',
    corto: 'Alternativas',
    descripcion: 'Qué hace cada herramienta, cuándo conviene otra antes que Scholaris y qué hace Scholaris que las demás no se proponen. Sin cifras ajenas que no podamos comprobar.',
    md: `## Cómo leer esta hoja

No hemos medido las otras herramientas con nuestro banco de pruebas, así que aquí no hay cifras suyas ni tablas de casillas marcadas. Lo que sigue describe para qué está pensada cada una, a la fecha de esta revisión, y en qué se diferencia Scholaris. Las herramientas cambian deprisa: si algo de lo que decimos de ellas ha dejado de ser cierto, avísanos y lo corregimos.

## Zotero

Un gestor de referencias libre y de código abierto: recoge referencias desde el navegador, guarda los PDF, los anota y da formato a las citas en Word, LibreOffice y Google Docs con estilos CSL. Para coleccionar y ordenar referencias es difícil de mejorar, y Scholaris no intenta sustituirlo.

**Cuándo elegir Zotero:** para construir y mantener tu bibliografía, colaborar en grupos de referencias y citar mientras escribes en el procesador de textos.

**Lo que añade Scholaris:** leer el contenido de esas fuentes (también escaneados antiguos, audio y vídeo), encontrar el pasaje por su sentido y devolver la cita con la página impresa exacta. Se llevan bien: Scholaris importa el BibTeX o el RIS de Zotero con su carpeta de ficheros y casa cada entrada con su documento.

## Elicit

Un asistente de investigación que busca en la literatura científica publicada, resume artículos y extrae datos de ellos en tablas para revisiones sistemáticas.

**Cuándo elegir Elicit:** para descubrir artículos que todavía no tienes y comparar muchos estudios empíricos a la vez.

**Lo que añade Scholaris:** trabaja sobre tu propia biblioteca, no sobre un corpus de artículos: libros escaneados del siglo XVII, ediciones concretas, entrevistas grabadas, apuntes; y cita la página impresa o el segundo de tu ejemplar.

## NotebookLM

La herramienta de Google para conversar con las fuentes que subes, con referencias a los pasajes de origen y resúmenes en audio.

**Cuándo elegir NotebookLM:** para hacerte una idea rápida de un conjunto pequeño de fuentes, gratis y sin instalar nada, si te parece bien que las procese Google dentro de su producto.

**Lo que añade Scholaris:** citas en estilos bibliográficos (APA, Chicago, MLA, ISO 690…) con el folio impreso, listas para una nota al pie; foliación de libros antiguos y capa de grafía modernizada; verificación con lógica temporal; un formato abierto (SPDF) para llevarte la biblioteca ya leída; API y MCP, y una versión que se instala en tu ordenador. Y no te resume los libros: no es para eso.

## ChatGPT o Claude con ficheros subidos

Los asistentes generales leen los ficheros que adjuntas a una conversación y contestan sobre ellos, a menudo muy bien.

**Cuándo elegirlos:** para conversar, explorar ideas o redactar con ayuda, sobre unos pocos documentos.

**Lo que añade Scholaris:** una biblioteca persistente de miles de documentos en lugar de los ficheros de una conversación; citas que salen del ancla guardada y no del modelo, comprobadas antes de llegar a ti; la página impresa y el segundo; y la regla de no escribir por ti. De hecho, se pueden usar juntos: Claude puede consultar tu biblioteca de Scholaris por [MCP](/saber/api-y-mcp) y citar desde ella.

## Adobe Acrobat con IA

El asistente de Acrobat responde preguntas sobre PDF y genera resúmenes dentro del lector de PDF más extendido.

**Cuándo elegirlo:** si ya trabajas en Acrobat y te basta con preguntar sobre los PDF que tienes abiertos.

**Lo que añade Scholaris:** muchos formatos además del PDF (EPUB, audio, vídeo, webs, presentaciones), búsqueda en toda la biblioteca a la vez, estilos de cita y página impresa, y el texto de los escaneados antiguos leído con fidelidad.

## En resumen

| Si necesitas… | Mira… |
| --- | --- |
| Coleccionar referencias y citar mientras escribes en Word | Zotero (y, para el contenido, Scholaris al lado) |
| Descubrir artículos científicos que aún no tienes | Elicit o un buscador académico |
| Hacerte una idea rápida de unas pocas fuentes | NotebookLM o un asistente general |
| Encontrar en tu biblioteca el pasaje exacto y citarlo con su página o su segundo | Scholaris |
`,
  },
  en: {
    titulo: 'Scholaris beside Zotero, Elicit, NotebookLM and the rest',
    corto: 'Alternatives',
    descripcion: 'What each tool does, when another one suits you better than Scholaris, and what Scholaris does that the others do not set out to do. No figures about others that we cannot check.',
    md: `## How to read this page

We have not measured the other tools with our benchmark, so there are no figures of theirs here and no tables of ticked boxes. What follows describes what each one is designed for, as of this review, and how Scholaris differs. Tools change fast: if something we say about them is no longer true, tell us and we will fix it.

## Zotero

A free, open-source reference manager: it captures references from the browser, stores PDFs, annotates them and formats citations in Word, LibreOffice and Google Docs with CSL styles. For collecting and organising references it is hard to beat, and Scholaris does not try to replace it.

**When to choose Zotero:** to build and keep your bibliography, collaborate in reference groups and cite while you write in your word processor.

**What Scholaris adds:** reading the content of those sources (old scans, audio and video included), finding the passage by meaning and returning the citation with the exact printed page. They get on well: Scholaris imports Zotero's BibTeX or RIS with its file folder and matches every entry to its document.

## Elicit

A research assistant that searches the published scientific literature, summarises papers and extracts data from them into tables for systematic reviews.

**When to choose Elicit:** to discover papers you do not have yet and compare many empirical studies at once.

**What Scholaris adds:** it works on your own library, not on a corpus of papers: seventeenth-century scans, specific editions, recorded interviews, notes; and it cites the printed page or the second of your copy.

## NotebookLM

Google's tool for talking with the sources you upload, with references to the source passages and audio overviews.

**When to choose NotebookLM:** to get a quick sense of a small set of sources, free and with nothing to install, if you are happy for Google to process them inside its product.

**What Scholaris adds:** citations in bibliographic styles (APA, Chicago, MLA, ISO 690…) with the printed folio, ready for a footnote; foliation of early books and a modernised-spelling layer; verification with temporal logic; an open format (SPDF) to take your read library with you; an API and MCP, and a version you install on your own computer. And it does not summarise books for you: that is not what it is for.

## ChatGPT or Claude with uploaded files

General assistants read the files you attach to a conversation and answer about them, often very well.

**When to choose them:** to talk, explore ideas or draft with help, over a handful of documents.

**What Scholaris adds:** a persistent library of thousands of documents instead of one conversation's files; citations that come from the stored anchor rather than the model, checked before they reach you; the printed page and the second; and the rule of not writing for you. In fact they can be used together: Claude can query your Scholaris library over [MCP](/en/knowledge/api-and-mcp) and cite from it.

## Adobe Acrobat with AI

Acrobat's assistant answers questions about PDFs and generates summaries inside the most widespread PDF reader.

**When to choose it:** if you already work in Acrobat and asking about the PDFs you have open is enough.

**What Scholaris adds:** many formats besides PDF (EPUB, audio, video, web pages, slides), search across the whole library at once, citation styles and printed pages, and the text of old scans read faithfully.

## In short

| If you need to… | Look at… |
| --- | --- |
| Collect references and cite while writing in Word | Zotero (and, for the content, Scholaris beside it) |
| Discover scientific papers you do not have yet | Elicit or an academic search engine |
| Get a quick sense of a few sources | NotebookLM or a general assistant |
| Find the exact passage in your library and cite it with its page or second | Scholaris |
`,
  },
};
