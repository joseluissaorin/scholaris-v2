# Avisos de terceros

El código de Scholaris se distribuye bajo la licencia [EUPL-1.2](LICENSE). Este fichero recoge los materiales de terceros incluidos en el repositorio y sus condiciones propias.

## Estilos y localizaciones CSL

Los estilos de cita de `packages/citas/src/csl/vendor/estilos` (APA, Chicago, MLA, Harvard, IEEE, ISO 690…) y las localizaciones de `packages/citas/src/csl/vendor/locales` proceden del [Citation Style Language](https://citationstyles.org/) ([styles](https://github.com/citation-style-language/styles) y [locales](https://github.com/citation-style-language/locales)) y se distribuyen bajo **CC BY-SA 3.0**, con sus autores y colaboradores en la cabecera XML de cada estilo. Se incorporan sin modificar, envueltos en un módulo de TypeScript por `packages/citas/scripts/vendorizar-csl.mjs`; la licencia CC BY-SA se aplica a esos ficheros, no al resto del código.

## Tipografías

- **DM Sans** (`apps/web/public/fuentes/dm-sans-latin.woff2`, `apps/web/public/portada/dm-sans.woff2`), © 2014 The DM Sans Project Authors, bajo la **SIL Open Font License 1.1**.
- **Nothing You Could Do** (`apps/web/public/portada/mano.woff2`), © 2010 Kimberly Geswein, bajo la **SIL Open Font License 1.1**.

Texto de la licencia: <https://openfontlicense.org/open-font-license-official-text/>.

## Banco de pruebas público

Los documentos de `bench/calidad` son de dominio público o tienen licencia libre (detalle en `bench/calidad/corpus.json`):

- Lope de Vega, *El casamiento en la muerte y hechos de Bernardo del Carpio* (comedia suelta, c. 1700): dominio público. Se publica el texto leído, sin las imágenes del escaneado.
- Jenna Kanerva, Cassandra Ledins, Siiri Käpyaho y Filip Ginter, *OCR Error Post-Correction with LLMs in Historical Documents: No Free Lunches* (arXiv:2502.01205, 2025): **CC BY 4.0**.
- Gustavo Adolfo Bécquer, *El monte de las ánimas*, grabación de Elena del Valle para [LibriVox](https://librivox.org/): dominio público.

Las pruebas unitarias citan frases sueltas de obras con derechos (Foucault, Lewis, Cortázar…) como material de prueba, en extensión de cita breve.

## Dependencias destacadas

| Componente | Licencia | Uso |
|---|---|---|
| [SQLite](https://sqlite.org/) y [`@sqlite.org/sqlite-wasm`](https://sqlite.org/wasm) | Dominio público / Apache-2.0 | El formato SPDF y la base de cada biblioteca |
| [sqlite-vec](https://github.com/asg017/sqlite-vec) | MIT o Apache-2.0 | Búsqueda vectorial en local |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | SQLite en Node |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Apache-2.0 | Lectura y pintado de PDF |
| [citeproc-js](https://github.com/Juris-M/citeproc-js) | CPAL-1.0 o AGPL-3.0 | Motor CSL de las citas y la bibliografía |
| [mp4box.js](https://github.com/gpac/mp4box.js) | BSD-3-Clause | Vídeo en el navegador |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | Conversión de DOCX |
| [fflate](https://github.com/101arrowz/fflate) | MIT | ZIP y gzip |
| [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) | MIT | Recortes e imágenes en Node |
| [Hono](https://hono.dev/), [React](https://react.dev/), [TanStack](https://tanstack.com/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) | MIT | Servidor, web y compilación |
| [FFmpeg](https://ffmpeg.org/) (solo en la imagen Docker y el contenedor de conversión) | LGPL-2.1 o posterior / GPL | Audio y vídeo |

Las licencias completas de las dependencias se distribuyen con sus paquetes npm.

## Servicios externos

Scholaris llama a servicios de terceros con las claves de quien lo instala (Google Gemini, OpenRouter, TypeSafe/Jev, Cloudflare Workers AI, OpenAlex, Crossref, Wikidata). Sus condiciones de uso son las de cada proveedor.

## Marca

El nombre «Scholaris», el logotipo y los dibujos de la portada son del autor. La licencia del código no incluye el uso de la marca para servicios derivados que puedan confundirse con la instancia oficial (<https://scholaris.joseluissaorin.com>).
