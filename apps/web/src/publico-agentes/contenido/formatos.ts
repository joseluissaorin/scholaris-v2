import type { Pagina } from './tipos';
import { imprenta } from '../../bocetos/dibujos/imprenta';

export const formatos: Pagina = {
  clave: 'formatos',
  rutas: { es: '/saber/formatos', en: '/en/knowledge/formats' },
  boceto: imprenta,
  es: {
    titulo: 'Qué formatos entran y cómo se ancla cada cita',
    corto: 'Formatos y anclas',
    descripcion: 'PDF digitales y escaneados, fotos, EPUB, Word, presentaciones, hojas de cálculo, audio, vídeo, webs, YouTube y pódcast. Para cada uno, cómo se lee y qué ancla queda: folio impreso, segundo, diapositiva, filas o párrafo.',
    md: `## Cómo entra un fichero

Todo pasa primero por la **imprenta**, el conversor de Scholaris. Reconoce el tipo por los primeros bytes del fichero (después por el tipo MIME y, por último, por la extensión), y lo convierte en tu propio navegador siempre que puede. Lo que el navegador no sabe hacer (decodificar ciertas imágenes, sacar fotogramas de un vídeo, convertir una presentación de Keynote) lo hace un contenedor en el servidor con ffmpeg y LibreOffice.

Después, lo que hay que leer con los ojos (páginas escaneadas, fotos, diapositivas) lo lee un modelo de visión, cuatro páginas por petición, y lo que hay que oír lo transcribe un modelo de voz. Qué proveedor hace cada cosa está en [Privacidad](/saber/privacidad).

## Formatos y anclas

| Lo que subes | Extensiones | Cómo se lee | Ancla y cómo se cita |
| --- | --- | --- | --- |
| PDF digital | pdf | La capa de texto, con sus líneas y bloques; cabeceras y pies aparte; se usan las etiquetas de página del propio PDF, su índice y sus metadatos | Página impresa: «p. 23», «pp. 23-24», «p. xiv» |
| PDF escaneado o con un OCR antiguo | pdf | Visión: cada página como imagen. Si el PDF trae un OCR viejo de mala calidad, se vuelve a leer | Página impresa, o la física entre corchetes: «p. [12]» |
| Fotos de un libro | jpg, png, webp, gif, tiff, heic, bmp, avif | Se ordenan por nombre en orden numérico (IMG_2 antes que IMG_10), se enderezan y se recortan los bordes vacíos | Página impresa de cada foto |
| Textos | docx, odt, rtf, html, md, txt | Bloques (títulos, párrafos, listas, citas, tablas, notas) con su ruta de títulos | Sección y párrafo: «Introducción, párr. 4» |
| EPUB | epub | El orden de lectura, el índice y, sobre todo, la lista de páginas impresas si el EPUB la trae | «p. 23» si hay lista de páginas; si no, «párr. N» |
| Presentaciones | pptx, odp, key | Texto y notas del orador de cada diapositiva; ODP y Keynote se convierten enteras con LibreOffice | «diap. 7» |
| Hojas de cálculo | xlsx, xls, ods, csv, tsv | Tablas en trozos de 50 filas, con la cabecera repetida en cada trozo | «Hoja1, filas 2-51» |
| Audio | mp3, wav, m4a, ogg, opus, flac, aac | Transcripción palabra a palabra, con quién habla; tramos citables de 30 a 60 segundos que acaban en final de frase | «12:04», «1:02:03», «12:04-12:40» |
| Vídeo | mp4, mov, webm, mkv, avi | El audio como arriba; además, fotogramas en cada cambio de escena (o cada 20 segundos) que también se pueden buscar | Igual que el audio |
| Una web | URL | Se guarda una copia fechada y se parte el artículo en bloques | Sección y párrafo, con la fecha de consulta |
| YouTube | URL | No se descarga: Gemini ve el vídeo desde la dirección, en tramos de diez minutos | El segundo |
| Vimeo, pódcast, enlaces a audio | URL | Vimeo, el fichero progresivo más pequeño; un pódcast, el audio de su RSS | El segundo |
| SPDF y paquetes .scholaris | spdf, scholaris | No se vuelve a leer nada: se copian el texto, las anclas y los vectores | Las anclas que traía |

## El folio impreso

El número que importa en una nota al pie es el que está impreso en el papel, no la posición de la página en el fichero. Un libro puede empezar en romanos, saltarse láminas sin numerar o tener dos páginas por imagen. Para cada página, Scholaris junta varias pruebas:

1. las etiquetas de página del propio PDF, si las tiene;
2. los números candidatos de la cabecera, del pie y de los bordes del texto, y lo que vio el lector de visión;
3. la secuencia coherente más larga de esas lecturas;
4. en los casos dudosos, un juez (Jev, de TypeSafe) que decide entre candidatos;
5. y, para las páginas sin número visible, interpolación dentro de cada tramo.

Reconoce números romanos (con la página en que se pasa a arábigos), foliación por hojas («23r», «23v»), escaneos a doble página, láminas sin numerar y años que no son folios. Cada página guarda de dónde salió su número (leído, deducido, del EPUB o ninguno) y con qué confianza. **Si un libro no imprime ningún número, no se inventa ninguno:** se cita la posición física entre corchetes.

En el banco de pruebas, los 64 folios comprobados a ojo salieron exactos (ver [Rendimiento](/saber/rendimiento)).

## La ortografía original se respeta

El lector transcribe con fidelidad: no moderniza «dixo», «assi» o «muger», mantiene u/v, i/j/y y ç, no corrige erratas y deja fuera del cuerpo los titulillos, los reclamos y las signaturas. La única excepción es la s larga (ſ), que se escribe «s». Para que esas grafías se encuentren al buscar existe una capa aparte, explicada en [Búsqueda](/saber/busqueda).

## Límites de tamaño

| Plan | Fichero más grande | Almacenamiento |
| --- | --- | --- |
| Gratis | 200 MB | 1 GB |
| Pro | 4 GB | 100 GB |
| Versión local | 16 GB | el de tu disco |

Por la API v1 en la nube caben ficheros de hasta 95 MB en una sola petición; para más, la aplicación y el SDK de Python suben por partes. No hay una duración máxima para audio y vídeo más allá del tamaño del fichero.

## Lo que todavía no va bien

- Los .doc antiguos de Word no tienen un lector propio: conviértelos a .docx antes de subirlos.
- Vimeo solo funciona cuando el vídeo ofrece un fichero descargable; si no, bájalo y súbelo.
- Las anclas de una web son de párrafo: si la página cambia después, la copia fechada que guardamos es la que manda.
`,
  },
  en: {
    titulo: 'Which formats go in, and how each citation is anchored',
    corto: 'Formats and anchors',
    descripcion: 'Digital and scanned PDFs, photos, EPUB, Word, slides, spreadsheets, audio, video, web pages, YouTube and podcasts. For each, how it is read and which anchor it leaves: printed folio, second, slide, rows or paragraph.',
    md: `## How a file goes in

Everything first goes through the **imprenta** (the press), Scholaris's converter. It recognises the type from the first bytes of the file (then from its MIME type and, last, its extension) and converts it in your own browser whenever it can. What the browser cannot do (decode some images, extract video frames, convert a Keynote deck) is done by a server container with ffmpeg and LibreOffice.

Then whatever has to be read with eyes (scanned pages, photos, slides) is read by a vision model, four pages per request, and whatever has to be heard is transcribed by a speech model. Which provider does what is in [Privacy](/en/knowledge/privacy).

## Formats and anchors

| What you upload | Extensions | How it is read | Anchor and how it is cited |
| --- | --- | --- | --- |
| Digital PDF | pdf | The text layer, with its lines and blocks; headers and footers set apart; the PDF's own page labels, outline and metadata are used | Printed page: "p. 23", "pp. 23-24", "p. xiv" |
| Scanned PDF, or one with old OCR | pdf | Vision: each page as an image. If the PDF carries a poor old OCR layer, it is read again | Printed page, or the physical one in brackets: "p. [12]" |
| Photos of a book | jpg, png, webp, gif, tiff, heic, bmp, avif | Sorted by name in numeric order (IMG_2 before IMG_10), straightened and cropped | Printed page of each photo |
| Text documents | docx, odt, rtf, html, md, txt | Blocks (headings, paragraphs, lists, quotations, tables, notes) with their heading path | Section and paragraph: "Introduction, para. 4" |
| EPUB | epub | Reading order, table of contents and, above all, the print page list when the EPUB has one | "p. 23" with a page list; otherwise "para. N" |
| Slides | pptx, odp, key | Text and speaker notes of every slide; ODP and Keynote are converted whole with LibreOffice | "slide 7" |
| Spreadsheets | xlsx, xls, ods, csv, tsv | Tables in chunks of 50 rows, with the header repeated in each chunk | "Sheet1, rows 2-51" |
| Audio | mp3, wav, m4a, ogg, opus, flac, aac | Word-by-word transcription with who is speaking; citable stretches of 30 to 60 seconds that end at a sentence boundary | "12:04", "1:02:03", "12:04-12:40" |
| Video | mp4, mov, webm, mkv, avi | Audio as above; plus frames at every scene change (or every 20 seconds), which are searchable too | Same as audio |
| A web page | URL | A dated copy is stored and the article is split into blocks | Section and paragraph, with the access date |
| YouTube | URL | Not downloaded: Gemini watches the video from its address, ten minutes at a time | The second |
| Vimeo, podcasts, audio links | URL | Vimeo, the smallest progressive file; a podcast, the audio in its RSS | The second |
| SPDF and .scholaris packages | spdf, scholaris | Nothing is read again: text, anchors and vectors are copied | The anchors they carried |

## The printed folio

The number that matters in a footnote is the one printed on paper, not the page's position in the file. A book may start in roman numerals, skip unnumbered plates or have two pages per image. For each page Scholaris gathers several pieces of evidence:

1. the PDF's own page labels, if any;
2. candidate numbers from the header, the footer and the text edges, plus what the vision reader saw;
3. the longest coherent sequence of those readings;
4. for doubtful cases, a judge (Jev, by TypeSafe) choosing between candidates;
5. and, for pages with no visible number, interpolation within each stretch.

It recognises roman numerals (and the page where arabic numbering starts), foliation by leaves ("23r", "23v"), two-up scans, unnumbered plates and years that are not folios. Every page records where its number came from (read, inferred, from the EPUB, or none) and how confident it is. **If a book prints no number at all, none is invented:** the physical position is cited in brackets.

In the benchmark, all 64 folios checked by eye came out exact (see [Performance](/en/knowledge/performance)).

## Original spelling is kept

The reader transcribes faithfully: it does not modernise "dixo", "assi" or "muger", keeps u/v, i/j/y and ç, does not fix misprints and keeps running heads, catchwords and signatures out of the body. The one exception is the long s (ſ), written as "s". So that those spellings can still be found, there is a separate layer, explained in [Search](/en/knowledge/search).

## Size limits

| Plan | Largest file | Storage |
| --- | --- | --- |
| Free | 200 MB | 1 GB |
| Pro | 4 GB | 100 GB |
| Home version | 16 GB | your disk |

Through API v1 in the cloud a single request takes files up to 95 MB; for more, the app and the Python SDK upload in parts. There is no maximum duration for audio and video beyond the file size.

## What does not work well yet

- Old Word .doc files have no reader of their own: convert them to .docx first.
- Vimeo only works when the video offers a downloadable file; otherwise, download it and upload it.
- Web anchors are paragraph anchors: if the page changes later, the dated copy we stored is the one that counts.
`,
  },
};
