import type { Pagina } from './tipos';
import { tintero } from '../../bocetos/dibujos/tintero';

const PY = `pip install scholaris-sdk                 # solo depende de requests
pip install "scholaris-sdk[vectores]"     # con numpy, para buscar por vectores`;

const ABRIR = `from scholaris.v2 import SPDF

with SPDF.abrir("vigilar.spdf") as s:
    print(s.documento["metadatos"]["titulo"])
    for f in s.buscar("panóptico", k=5):       # FTS5, insensible a acentos
        print(f.cita, f.texto[:80])            # «(Foucault, 1975, p. 23) …»
    print(s.pagina("145").texto)               # por número de página impreso`;

const SQLITE = `gzip -dc libro.spdf > libro.sqlite
sqlite3 libro.sqlite "SELECT valor FROM spdf WHERE clave = 'spdf_version'"
sqlite3 libro.sqlite "SELECT texto FROM fragmentos_fts WHERE fragmentos_fts MATCH 'panoptico' LIMIT 3"`;

export const spdf: Pagina = {
  clave: 'spdf',
  rutas: { es: '/saber/spdf', en: '/en/knowledge/spdf' },
  boceto: tintero,
  es: {
    titulo: 'El formato SPDF 4.1, una biblioteca que te llevas',
    corto: 'Formato SPDF',
    descripcion: 'Un .spdf es una base de datos SQLite comprimida con gzip que guarda el documento ya leído: texto, anclas, secciones, figuras, vectores y procedencia. Se abre sin Scholaris y sin conexión.',
    md: `## Qué es un .spdf

Un fichero **.spdf** (Scholaris PDF) guarda un documento ya leído: no solo el original, sino todo lo que Scholaris sacó de él, de manera que se pueda buscar y citar en otro sitio sin volver a leerlo ni pagar otra vez por ello.

Por dentro es una base de datos **SQLite comprimida con gzip** (no es un ZIP). Cualquier lenguaje con SQLite la abre; también se acepta sin comprimir. La versión actual es la **4.1**; la versión se guarda en la tabla \`spdf\`, con la clave \`spdf_version\`. Los SPDF antiguos (versiones 1 a 3, de la primera Scholaris) se migran solos al abrirlos.

Cada .spdf exportado lleva un documento. El mismo esquema es el que usa, en el servidor, la biblioteca de cada usuario.

## Las tablas

| Tabla | Qué guarda |
| --- | --- |
| spdf | Clave y valor: versión, fecha de creación, programa que lo generó, huella del original |
| documentos | Tipo, ficha (JSON), huella SHA-256, tipo MIME, tamaño, número de unidades, duración, título, autores, año e idioma |
| unidades | Las unidades citables (páginas, tramos de audio, diapositivas): ancla, texto, notas, cabecera y pie, imagen, confianza, página impresa, tiempos y los tiempos de cada palabra |
| secciones | El árbol de secciones |
| fragmentos | Los pasajes que se buscan y se citan: texto, contexto, sección, ancla de inicio y de fin, y la capa de grafía modernizada (texto_busqueda) |
| fragmentos_fts | Índice de texto completo FTS5 sobre texto, contexto, sección y grafía modernizada, sin distinguir tildes |
| figuras | Figuras, láminas y fotogramas, con su región, pie y descripción |
| espacios | Los espacios vectoriales: proveedor, modelo, versión, dimensiones, normalización y modalidades |
| vectores | Un vector por objetivo (fragmento, unidad o figura) y espacio, en float32 little-endian |
| blobs | El original y las imágenes (solo en los ficheros exportados) |
| procedencia | El registro de cómo se leyó: cada fase, qué proveedor la hizo, cuánto tardó y cuándo |

La versión 4.1 añadió la columna \`texto_busqueda\`: una sombra del texto con la ortografía modernizada, solo para buscar (ver [Búsqueda](/saber/busqueda)). El texto que se cita no se toca nunca.

## Espacios vectoriales

Un mismo .spdf puede llevar vectores de varios modelos a la vez, y cada uno se declara en la tabla \`espacios\`. Los que usa Scholaris hoy:

| Espacio | Modelo | Dimensiones | Cuándo |
| --- | --- | --- | --- |
| gemini-embedding-2@1536 | Gemini Embedding 2, multimodal, recortado | 1536 | Por defecto, en la nube y en casa |
| embeddinggemma-2@768 | EmbeddingGemma 2 (texto, imagen, audio y vídeo), en tu máquina | 768 (o 512, 256, 128) | En la versión local sin conexión |
| qwen3-vl-embedding-2b@2048 | Qwen3-VL Embedding 2B, en InferBox | 2048 | En la versión local con InferBox, como espacio extra |
| qwen3-embedding-0.6b@1024 | Qwen3 Embedding 0.6B, en Workers AI | 1024 | Si no hay clave de Gemini |

Al importar un .spdf solo se calculan los vectores que falten para el espacio que use tu biblioteca; el texto y las anclas no se vuelven a leer.

## Abrirlo sin conexión con Python

El SDK de Python trae un lector de SPDF que solo usa la biblioteca estándar (gzip y sqlite3) y abre el fichero en modo de solo lectura:

\`\`\`sh
${PY}
\`\`\`

\`\`\`py
${ABRIR}
\`\`\`

El lector también da acceso a \`documentos\`, \`unidades\`, \`fragmentos\`, \`secciones\`, \`espacios\`, \`blob\`, \`original\` y \`vectores(espacio)\`, y busca por similitud con \`buscar_vector(vector, espacio, k)\`. El paquete se llama \`scholaris-sdk\` en PyPI y se importa como \`scholaris\`; tiene licencia EUPL-1.2.

Una advertencia: la búsqueda del lector de Python usa el índice FTS5 tal cual, sin la capa de grafía modernizada que aplica Scholaris a la consulta.

## Abrirlo sin Python

\`\`\`sh
${SQLITE}
\`\`\`

## Exportar e importar

- Desde la aplicación, cada documento se exporta como .spdf, con o sin el original y los vectores. Desde el servidor caben hasta 24 MB de ficheros incrustados; para más, la exportación se hace en el navegador.
- Una biblioteca entera se exporta como paquete **.scholaris**: un ZIP con un .spdf por documento, un \`manifest.json\` (formato \`scholaris-biblioteca\`, versión 1) y un \`LEEME.txt\` con los derechos de la biblioteca. Ver [Bibliotecas](/saber/bibliotecas).
- Importar un .spdf (hasta 512 MB) no vuelve a leer nada.

## Lo que falta

Aún no hay un validador público para la versión 4. La especificación completa vive en el código (\`packages/spdf/esquema/v4.1.sql\`), que se publicará con el resto del código fuente (ver [Versión local](/saber/version-local)).
`,
  },
  en: {
    titulo: 'The SPDF 4.1 format, a library you can take with you',
    corto: 'SPDF format',
    descripcion: 'An .spdf is a gzip-compressed SQLite database holding the document already read: text, anchors, sections, figures, vectors and provenance. It opens without Scholaris and offline.',
    md: `## What an .spdf is

An **.spdf** file (Scholaris PDF) stores a document already read: not just the original but everything Scholaris got out of it, so it can be searched and cited elsewhere without reading it again or paying for it twice.

Inside it is a **gzip-compressed SQLite database** (not a ZIP). Any language with SQLite opens it; uncompressed files are accepted too. The current version is **4.1**; the version is stored in the \`spdf\` table under the key \`spdf_version\`. Old SPDFs (versions 1 to 3, from the first Scholaris) are migrated on the fly when opened.

Each exported .spdf holds one document. The same schema is what each user's library uses on the server.

## The tables

| Table | What it stores |
| --- | --- |
| spdf | Key and value: version, creation date, generator, hash of the original |
| documentos | Type, record (JSON), SHA-256 hash, MIME type, size, number of units, duration, title, authors, year and language |
| unidades | The citable units (pages, audio stretches, slides): anchor, text, notes, header and footer, image, confidence, printed page, times and per-word timings |
| secciones | The section tree |
| fragmentos | The passages that are searched and cited: text, context, section, start and end anchors, and the modernised-spelling layer (texto_busqueda) |
| fragmentos_fts | FTS5 full-text index over text, context, section and modernised spelling, accent-insensitive |
| figuras | Figures, plates and video frames, with region, caption and description |
| espacios | Vector spaces: provider, model, version, dimensions, normalisation and modalities |
| vectores | One vector per target (fragment, unit or figure) and space, as little-endian float32 |
| blobs | The original and the images (only in exported files) |
| procedencia | The log of how it was read: each phase, which provider did it, how long it took and when |

Version 4.1 added the \`texto_busqueda\` column: a shadow of the text in modernised spelling, used only for searching (see [Search](/en/knowledge/search)). The text that gets cited is never touched.

## Vector spaces

One .spdf can carry vectors from several models at once, each declared in the \`espacios\` table. The ones Scholaris uses today:

| Space | Model | Dimensions | When |
| --- | --- | --- | --- |
| gemini-embedding-2@1536 | Gemini Embedding 2, multimodal, truncated | 1536 | By default, in the cloud and at home |
| embeddinggemma-2@768 | EmbeddingGemma 2 (text, image, audio and video), on your machine | 768 (or 512, 256, 128) | In the home version offline |
| qwen3-vl-embedding-2b@2048 | Qwen3-VL Embedding 2B, on InferBox | 2048 | In the home version with InferBox, as an extra space |
| qwen3-embedding-0.6b@1024 | Qwen3 Embedding 0.6B, on Workers AI | 1024 | When there is no Gemini key |

When an .spdf is imported, only the vectors missing for your library's space are computed; text and anchors are not read again.

## Opening it offline with Python

The Python SDK includes an SPDF reader that uses only the standard library (gzip and sqlite3) and opens the file read-only:

\`\`\`sh
${PY.replace('solo depende de requests', 'only needs requests').replace('con numpy, para buscar por vectores', 'with numpy, for vector search')}
\`\`\`

\`\`\`py
${ABRIR.replace('FTS5, insensible a acentos', 'FTS5, accent-insensitive').replace('por número de página impreso', 'by printed page number')}
\`\`\`

The reader also exposes \`documentos\`, \`unidades\`, \`fragmentos\`, \`secciones\`, \`espacios\`, \`blob\`, \`original\` and \`vectores(espacio)\`, and does similarity search with \`buscar_vector(vector, espacio, k)\`. The package is \`scholaris-sdk\` on PyPI and is imported as \`scholaris\`; it is licensed under the EUPL-1.2.

One caveat: the Python reader searches the FTS5 index as is, without the modernised-spelling layer that Scholaris applies to the query.

## Opening it without Python

\`\`\`sh
${SQLITE}
\`\`\`

## Export and import

- From the app, every document exports as an .spdf, with or without the original and the vectors. The server embeds up to 24 MB of files; for more, the export runs in the browser.
- A whole library exports as a **.scholaris** package: a ZIP with one .spdf per document, a \`manifest.json\` (format \`scholaris-biblioteca\`, version 1) and a \`LEEME.txt\` with the library's rights. See [Libraries](/en/knowledge/libraries).
- Importing an .spdf (up to 512 MB) reads nothing again.

## What is missing

There is no public validator for version 4 yet. The full specification lives in the code (\`packages/spdf/esquema/v4.1.sql\`), which will be published with the rest of the source (see [Self-hosting](/en/knowledge/self-hosting)).
`,
  },
};
