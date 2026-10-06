import type { Pagina } from './tipos';
import { notaAqui } from '../../bocetos/dibujos/nota-aqui';

export const preguntas: Pagina = {
  clave: 'preguntas',
  rutas: { es: '/saber/preguntas', en: '/en/knowledge/faq' },
  tipo: 'FAQPage',
  boceto: notaAqui,
  es: {
    titulo: 'Preguntas frecuentes',
    corto: 'Preguntas',
    descripcion: 'Si inventa citas, si sirve con libros escaneados del siglo XVII o con entrevistas en vídeo, qué pasa con tus datos, si funciona sin conexión y otras dudas, contestadas sin rodeos.',
    md: `## Sobre las citas

### ¿Inventa citas?

No. Ninguna cita la escribe un modelo: el autor, el año y la página salen de la ficha del documento y del ancla que se guardó al leerlo. Cuando un modelo redacta una respuesta, solo puede citar los pasajes que se le dan, y cada nota se comprueba contra el texto antes de enseñártela. Si no hay pasaje que respalde algo, la respuesta lo dice. En el banco de 41 afirmaciones, las citas inventadas fueron cero. Ver [Citas](/saber/citas).

### ¿La página es la del PDF o la del libro?

La del libro: el número impreso en el papel, aunque el PDF empiece en la cubierta, el libro use romanos en el prólogo o se salte láminas. Si el libro no imprime número, se cita la posición física entre corchetes, «p. [12]», en lugar de inventar uno. Ver [Formatos y anclas](/saber/formatos).

### ¿Qué estilos de cita tiene?

APA, Chicago (autor-fecha y notas), MLA, Harvard, ISO 690 (autor-fecha en castellano y en inglés, y numérico) e IEEE, en castellano, inglés, francés e italiano. Exporta BibTeX, RIS y CSL-JSON, e inserta las citas en un .docx con notas al pie de Word de verdad.

## Sobre lo que lee

### ¿Funciona con libros escaneados del siglo XVII?

Sí, y es uno de los casos para los que está hecho. Lee las páginas con un modelo de visión que respeta la ortografía original («dixo», «muger», u/v, ç) y deja fuera titulillos, reclamos y signaturas; reconoce la foliación por hojas («23r», «23v»). Para que esas grafías aparezcan cuando buscas «dijo» o «mujer», cada pasaje lleva una capa de grafía modernizada solo para buscar. En una comedia de Lope de 43 páginas, los errores de carácter fueron un 0,7 % y la exhaustividad de búsqueda pasó del 32 % al 100 %. Ver [Búsqueda](/saber/busqueda#grafia).

### ¿Y con entrevistas en vídeo?

También. Transcribe palabra a palabra, distingue quién habla y le pone nombre, parte el texto en tramos de 30 a 60 segundos y cita el minuto exacto («12:04-12:40»). Los fotogramas también se buscan. Una entrevista de dos horas quedó lista en 70 segundos. YouTube se lee desde la dirección, sin descargar el vídeo. Ver [Audio y vídeo](/saber/reproductor).

### ¿Lee latín?

Sí. La capa de búsqueda iguala u/v, i/j, æ/œ y los enclíticos, y reduce las palabras a su raíz con el lematizador de Schinke y otros, así que «urbis» encuentra «Vrbs».

### ¿Qué formatos acepta?

PDF (digitales y escaneados), fotos (JPG, PNG, HEIC…), EPUB, Word, ODT, RTF, HTML, Markdown, PowerPoint, Keynote, ODP, Excel, ODS, CSV, audio (MP3, WAV, M4A…), vídeo (MP4, MOV, WebM…), webs, YouTube, Vimeo y pódcast. La lista completa, con el ancla de cada uno, está en [Formatos y anclas](/saber/formatos).

## Sobre tus datos

### ¿Qué pasa con mis datos?

Se guardan en Cloudflare, en un espacio propio para tu cuenta, y no se usan para entrenar modelos. Para leerlos y buscar en ellos se mandan páginas, audio y consultas a Google Gemini, Cloudflare Workers AI, OpenRouter y TypeSafe, cada uno para una tarea concreta; a las bases bibliográficas abiertas solo se mandan títulos, autores, ISBN y DOI. Puedes exportarlo todo y borrar tu cuenta cuando quieras. El detalle, proveedor a proveedor, está en [Privacidad](/saber/privacidad).

### ¿Alguien más puede ver mi biblioteca?

Solo si la compartes: invitando a alguien por correo o creando un enlace público, que puedes proteger con contraseña, hacer caducar o revocar. Las páginas de esos enlaces piden a los buscadores que no las indexen.

### ¿Puedo usarlo sin conexión?

En parte. La versión local guarda todo en tu ordenador y, con InferBox, hace allí los vectores, la transcripción y las respuestas; pero para leer páginas necesita todavía un proveedor en la nube. Lo que sí funciona del todo sin conexión es abrir y buscar un .spdf ya leído con el SDK de Python. Ver [Versión local](/saber/version-local).

### ¿Es de código abierto?

El SDK de Python lo es (EUPL-1.2). El resto del código se publicará con la misma licencia cuando termine su revisión; aún no hay fecha.

## Sobre el uso

### ¿Escribe mi trabajo?

No, y no lo hará. Busca, señala, cita y verifica; pensar y escribir siguen siendo tuyos. La función «citar» devuelve tu propio texto con las citas puestas, no un texto nuevo.

### ¿Busca artículos en internet?

No: trabaja sobre lo que tú le das. Para descubrir literatura que aún no tienes, usa un buscador académico y trae aquí lo que encuentres. El grafo de citas sí te dice qué obras citan tus libros y no tienes.

### ¿Cuánto cuesta?

Hay un plan gratuito (25 documentos, 1500 páginas o minutos al mes, 100 búsquedas al día) y un plan Pro, cuyo precio se ve en la aplicación. La versión local no tiene cuotas. Ver [Planes](/saber/planes).

### ¿Lo puede usar un agente o un programa?

Sí, con la API v1 o con el servidor MCP (Claude, Cursor y otros). Ver [La API v1 y el servidor MCP](/saber/api-y-mcp) y la [hoja para agentes](/agentes).

### ¿Quién lo hace?

José Luis Saorín Ferrer, filólogo y programador, en Santa Cruz de Tenerife. Escríbele a [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
  en: {
    titulo: 'Frequently asked questions',
    corto: 'FAQ',
    descripcion: 'Whether it invents citations, whether it works with seventeenth-century scans or video interviews, what happens to your data, whether it works offline, and other questions, answered plainly.',
    md: `## About citations

### Does it invent citations?

No. No model writes a citation: author, year and page come from the document's record and from the anchor stored when it was read. When a model drafts an answer, it may only cite the passages it is given, and every note is checked against the text before you see it. If no passage supports something, the answer says so. In the 41-claim benchmark, invented citations were zero. See [Citations](/en/knowledge/citations).

### Is the page the PDF's or the book's?

The book's: the number printed on paper, even when the PDF starts at the cover, the book uses roman numerals in the preface or skips plates. If the book prints no number, the physical position is cited in brackets, "p. [12]", instead of inventing one. See [Formats and anchors](/en/knowledge/formats).

### Which citation styles does it have?

APA, Chicago (author-date and notes), MLA, Harvard, ISO 690 (author-date in Spanish and English, and numeric) and IEEE, in Spanish, English, French and Italian. It exports BibTeX, RIS and CSL-JSON, and inserts citations into a .docx with real Word footnotes.

## About what it reads

### Does it work with scanned seventeenth-century books?

Yes, it is one of the cases it was built for. It reads pages with a vision model that keeps the original spelling ("dixo", "muger", u/v, ç) and leaves out running heads, catchwords and signatures; it recognises foliation by leaves ("23r", "23v"). So that those spellings show up when you search for "dijo" or "mujer", every passage carries a modernised-spelling layer used only for searching. On a 43-page play by Lope de Vega, the character error rate was 0.7 % and search recall went from 32 % to 100 %. See [Search](/en/knowledge/search#grafia).

### And with video interviews?

Yes. It transcribes word by word, tells speakers apart and names them, cuts the text into 30-to-60-second stretches and cites the exact minute ("12:04-12:40"). Video frames are searchable too. A two-hour interview was ready in 70 seconds. YouTube is read from its address, without downloading the video. See [Audio and video](/en/knowledge/media-player).

### Does it read Latin?

Yes. The search layer evens out u/v, i/j, æ/œ and the enclitics, and reduces words to their stem with the Schinke et al. stemmer, so "urbis" finds "Vrbs".

### Which formats does it take?

PDF (digital and scanned), photos (JPG, PNG, HEIC…), EPUB, Word, ODT, RTF, HTML, Markdown, PowerPoint, Keynote, ODP, Excel, ODS, CSV, audio (MP3, WAV, M4A…), video (MP4, MOV, WebM…), web pages, YouTube, Vimeo and podcasts. The full list, with each one's anchor, is in [Formats and anchors](/en/knowledge/formats).

## About your data

### What happens to my data?

It is stored on Cloudflare, in a space of its own for your account, and it is not used to train models. To read and search it, pages, audio and queries are sent to Google Gemini, Cloudflare Workers AI, OpenRouter and TypeSafe, each for a specific task; open bibliographic databases only receive titles, authors, ISBNs and DOIs. You can export everything and delete your account whenever you like. The detail, provider by provider, is in [Privacy](/en/knowledge/privacy).

### Can anyone else see my library?

Only if you share it: by inviting someone by email or creating a public link, which you can protect with a password, set to expire or revoke. Those pages ask search engines not to index them.

### Can I use it offline?

Partly. The home version keeps everything on your computer and, with InferBox, computes vectors, transcripts and answers there; but it still needs a cloud provider to read pages. What does work fully offline is opening and searching an .spdf that has already been read, with the Python SDK. See [Self-hosting](/en/knowledge/self-hosting).

### Is it open source?

The Python SDK is (EUPL-1.2). The rest of the code will be published under the same licence when its review is finished; there is no date yet.

## About using it

### Does it write my paper?

No, and it will not. It searches, points, cites and verifies; thinking and writing remain yours. The "cite" function gives you back your own text with the citations in place, not a new text.

### Does it search the internet for papers?

No: it works on what you give it. To discover literature you do not have yet, use an academic search engine and bring what you find here. The citation graph does tell you which works your books cite that you do not have.

### How much does it cost?

There is a free plan (25 documents, 1,500 pages or minutes a month, 100 searches a day) and a Pro plan, whose price is shown in the app. The home version has no quotas. See [Plans](/en/knowledge/plans).

### Can an agent or a program use it?

Yes, through API v1 or the MCP server (Claude, Cursor and others). See [API v1 and the MCP server](/en/knowledge/api-and-mcp) and the [page for agents](/en/agents).

### Who makes it?

José Luis Saorín Ferrer, philologist and programmer, in Santa Cruz de Tenerife. Write to [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
};
