import type { Pagina } from './tipos';
import { paginaArrancada } from '../../bocetos/dibujos/pagina-arrancada';

export const cambios: Pagina = {
  clave: 'cambios',
  rutas: { es: '/saber/cambios', en: '/en/knowledge/changelog' },
  boceto: paginaArrancada,
  es: {
    titulo: 'Registro de cambios',
    corto: 'Cambios',
    descripcion: 'Lo que ha cambiado en Scholaris, de la primera versión a la segunda, contado por hitos y en el orden en que se hicieron.',
    md: `## Octubre de 2026

- **6 de octubre:** scholaris.joseluissaorin.com pasa a servir la segunda versión de Scholaris, en Cloudflare. La primera versión queda en reserva.
- Esta base de conocimiento, con un gemelo en Markdown de cada hoja, [/llms.txt](/llms.txt), [/llms-full.txt](/llms-full.txt) y la [hoja para agentes](/agentes).
- El SDK de Python, listo para publicarse en PyPI como \`scholaris-sdk\`, con licencia EUPL-1.2.
- Exportar un .spdf desde el servidor, con un tope de 24 MB de ficheros incrustados y aviso de lo que queda fuera.
- Rehacer la ficha de un documento cuando las pruebas de su identidad cambian (otro episodio, otro invitado), con modo simulado.
- Rehacer solo las figuras de un documento, con el coste estimado antes.

## La segunda versión, en el orden en que se hizo

La segunda versión de Scholaris se escribió de nuevo. Sus hitos, del primero al último:

1. **Cimientos:** el formato SPDF 4.0 y la imprenta, el conversor que lee cualquier fichero en el navegador.
2. **Búsqueda** por tres caminos fundidos (léxico, semántico y visual) y respuestas con citas validadas; los estilos CSL oficiales.
3. **Lectura por lotes de páginas**, folios impresos, fichas, fragmentos, vectores y figuras; el mapa de conceptos.
4. **Citas:** lógica temporal, autocita con juez, inserción en .docx y BibTeX.
5. **La API en Cloudflare Workers**, con inicio de sesión de Clerk y claves propias cifradas; el SPDF en Workers y la migración de los SPDF antiguos.
6. **La aplicación web** (biblioteca, lector, búsqueda, escritura, exploración), la **versión local** sobre Node y SQLite, el **ejecutable de escritorio** y la imagen de Docker.
7. **Un lector nuevo**, Gemini 3.8 Flash, elegido con el banco de pruebas.
8. **Medios:** YouTube por su dirección, pódcast, Vimeo y enlaces directos.
9. **El servidor MCP con OAuth 2.1** y la migración de las cuentas de la primera versión.
10. **La lectura en tres tiempos** (legible, buscable, con vectores), el **modo económico** y el **grafo de entidades** enlazado con Wikidata.
11. **El banco de calidad:** nDCG@10 de 0,889 y ninguna cita inventada.
12. **La búsqueda en dos tiempos** y el **reproductor nuevo**, con la palabra que suena resaltada.
13. **La API v1** con su guía en [/api](/api), la versión local para varios usuarios y las bibliotecas compartidas.
14. **Los dibujos y el movimiento** de la aplicación; fichas de programas de radio y televisión; OpenAlex con caché.
15. **La puesta a punto para producción.**

## La primera versión

La primera Scholaris corría en un servidor doméstico y guardaba los documentos en SPDF 1 a 3. Sus SPDF se siguen abriendo: se migran solos al formato 4. Comparada con ella, la segunda lee una entrevista de 54 minutos en 45 segundos en lugar de tres horas y 39 minutos, y encuentra mejor (nDCG@10 de 0,695 a 0,889). Ver [Rendimiento](/saber/rendimiento).
`,
  },
  en: {
    titulo: 'Changelog',
    corto: 'Changelog',
    descripcion: 'What has changed in Scholaris, from the first version to the second, told by milestones and in the order they were made.',
    md: `## October 2026

- **6 October:** scholaris.joseluissaorin.com starts serving the second version of Scholaris, on Cloudflare. The first version is kept in reserve.
- This knowledge base, with a Markdown twin of every page, [/llms.txt](/llms.txt), [/llms-full.txt](/llms-full.txt) and the [page for agents](/en/agents).
- The Python SDK, ready to be published on PyPI as \`scholaris-sdk\`, under the EUPL-1.2.
- Exporting an .spdf from the server, with a 24 MB cap on embedded files and a notice of what is left out.
- Redoing a document's record when the evidence of its identity changes (another episode, another guest), with a dry-run mode.
- Redoing only a document's figures, with the estimated cost shown first.

## The second version, in the order it was made

The second version of Scholaris was written anew. Its milestones, first to last:

1. **Foundations:** the SPDF 4.0 format and the imprenta, the converter that reads any file in the browser.
2. **Search** by three fused routes (lexical, semantic and visual) and answers with validated citations; the official CSL styles.
3. **Reading pages in batches**, printed folios, records, fragments, vectors and figures; the concept map.
4. **Citations:** temporal logic, autocite with a judge, .docx insertion and BibTeX.
5. **The API on Cloudflare Workers**, with Clerk sign-in and encrypted own keys; SPDF on Workers and migration of old SPDFs.
6. **The web app** (library, reader, search, writing, exploring), the **home version** on Node and SQLite, the **desktop executable** and the Docker image.
7. **A new reader**, Gemini 3.8 Flash, chosen with the benchmark.
8. **Media:** YouTube by address, podcasts, Vimeo and direct links.
9. **The MCP server with OAuth 2.1** and migration of first-version accounts.
10. **Reading in three stages** (readable, searchable, vectorised), **economy mode** and the **entity graph** linked to Wikidata.
11. **The quality benchmark:** nDCG@10 of 0.889 and no invented citations.
12. **Two-stage search** and the **new player**, highlighting the word being spoken.
13. **API v1** with its guide at [/en/api](/en/api), the multi-user home version and shared libraries.
14. **Drawings and motion** in the app; records for radio and TV programmes; OpenAlex with a cache.
15. **Getting ready for production.**

## The first version

The first Scholaris ran on a home server and stored documents as SPDF 1 to 3. Its SPDFs still open: they are migrated to format 4 on the fly. Compared with it, the second reads a 54-minute interview in 45 seconds instead of three hours and 39 minutes, and finds better (nDCG@10 from 0.695 to 0.889). See [Performance](/en/knowledge/performance).
`,
  },
};
