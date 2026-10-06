import type { Pagina } from './tipos';
import { maniculaSuelta } from '../../bocetos/dibujos/manicula-suelta';
import { ORIGEN } from '../origen';

const LEER = `# Cualquier página pública, en Markdown
curl -s ${ORIGEN}/saber/formatos.md
curl -s -H "Accept: text/markdown" ${ORIGEN}/saber/formatos

# Todo de una vez
curl -s ${ORIGEN}/llms.txt
curl -s ${ORIGEN}/llms-full.txt`;

const ACTUAR = `curl -sG ${ORIGEN}/api/v1/buscar -H "Authorization: Bearer $SCHOLARIS" \\
  --data-urlencode "q=la música me metía en el tiempo" -d k=5 -d formato=markdown`;

const FICHEROS = (en: boolean) => `| ${en ? 'Address' : 'Dirección'} | ${en ? 'What it is' : 'Qué es'} |
| --- | --- |
| [/llms.txt](/llms.txt) | ${en ? 'Short index with a link to every Markdown page' : 'Índice breve con un enlace a cada página en Markdown'} |
| [/llms-full.txt](/llms-full.txt) | ${en ? 'The full text of every public page, Spanish and English' : 'El texto entero de todas las páginas públicas, en castellano y en inglés'} |
| ${en ? '/any/page.md' : '/cualquier/pagina.md'} | ${en ? 'The Markdown twin of each public page' : 'El gemelo en Markdown de cada página pública'} |
| [/api/v1/llms.txt](/api/v1/llms.txt) | ${en ? 'How to use the API without inventing citations' : 'Cómo usar la API sin inventar citas'} |
| [/api/v1/openapi.json](/api/v1/openapi.json) | ${en ? 'OpenAPI 3.1 specification of API v1' : 'Especificación OpenAPI 3.1 de la API v1'} |
| [/.well-known/api-catalog](/.well-known/api-catalog) | ${en ? 'API catalogue (RFC 9727)' : 'Catálogo de API (RFC 9727)'} |
| [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json) | ${en ? 'MCP server card' : 'Tarjeta del servidor MCP'} |
| [/.well-known/oauth-protected-resource](/.well-known/oauth-protected-resource) | ${en ? 'OAuth metadata of the MCP resource' : 'Metadatos OAuth del recurso MCP'} |
| [/.well-known/oauth-authorization-server](/.well-known/oauth-authorization-server) | ${en ? 'OAuth authorisation server metadata' : 'Metadatos del servidor de autorización OAuth'} |
| [/.well-known/security.txt](/.well-known/security.txt) | ${en ? 'Where to report a security problem' : 'Dónde avisar de un problema de seguridad'} |
| [/sitemap.xml](/sitemap.xml) | ${en ? 'Every public page, with its date and languages' : 'Todas las páginas públicas, con su fecha y sus lenguas'} |
| [/robots.txt](/robots.txt) | ${en ? 'What may be crawled' : 'Qué se puede rastrear'} |`;

export const agentes: Pagina = {
  clave: 'agentes',
  rutas: { es: '/agentes', en: '/en/agents' },
  tipo: 'TechArticle',
  // La mano que señala, sin la nota a lápiz («suéltalo aquí»), que aquí no viene a cuento.
  boceto: { ...maniculaSuelta, id: 'manicula-agentes', elementos: maniculaSuelta.elementos.filter((e) => e.tipo !== 'nota') },
  es: {
    titulo: 'Para agentes: cómo leer Scholaris y cómo usarlo en nombre de alguien',
    corto: 'Para agentes',
    descripcion: 'Qué puede leer un agente en esta web y en qué formato, cómo actuar sobre la biblioteca de una persona con la API v1 o el MCP, con qué permisos y límites, y las reglas para citar sin inventar.',
    md: `## Si solo quieres entender qué es Scholaris

Todo lo público está pensado para leerse sin JavaScript y sin raspar HTML. Cada página tiene un gemelo en Markdown en la misma dirección terminada en \`.md\`, y también se sirve en Markdown si lo pides con la cabecera \`Accept: text/markdown\`. Las páginas llevan además JSON-LD de schema.org (SoftwareApplication, TechArticle, FAQPage, HowTo, DefinedTermSet).

\`\`\`sh
${LEER}
\`\`\`

## Los ficheros para máquinas

${FICHEROS(false)}

## Qué se puede rastrear

Las páginas públicas (la portada, esta base de conocimiento, la guía de la API y esta hoja) se pueden leer, indexar, citar y usar para responder, también para entrenar modelos: está dicho en [/robots.txt](/robots.txt), con una línea para cada rastreador conocido (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot y otros). **No se rastrea** la aplicación, la API ni las bibliotecas de nadie: los enlaces públicos que comparten las personas piden expresamente no ser indexados, y su contenido es suyo.

## Si actúas en nombre de una persona

Necesitas que esa persona te dé acceso; no hay acceso anónimo a ninguna biblioteca. Hay dos caminos:

1. **MCP con OAuth.** Si tu cliente habla MCP, conecta con \`${ORIGEN}/mcp\`. Te registras solo (registro dinámico de clientes), la persona entra en Scholaris y te concede acceso de solo lectura. Herramientas: \`search\`, \`cite\`, \`open_page\` y \`verify_claim\`.
2. **API v1 con una clave.** La persona crea una clave en Ajustes → Claves de API y te la da. Con el alcance \`lectura\` puedes buscar, leer, preguntar y verificar; con \`escritura\`, además subir, borrar y citar un texto entero; con \`mcp\`, usarla en el servidor MCP. Base: \`${ORIGEN}/api/v1\`.

\`\`\`sh
${ACTUAR}
\`\`\`

Todo está explicado en [La API v1 y el servidor MCP](/saber/api-y-mcp) y, con una sesión grabada, en la [guía de la API](/api).

## Límites que tienes que respetar

- **Ritmo:** 120 peticiones por minuto en el plan gratuito y 600 en Pro. Si recibes un 429, espera los segundos de \`Retry-After\`.
- **Cuotas** de la persona: búsquedas al día, páginas o minutos al mes, autocitas al mes (ver [Planes](/saber/planes)). Un 402 quiere decir que se han agotado: díselo, no insistas.
- **Ficheros:** hasta 95 MB por petición en la API v1.
- **Reintentos:** manda \`Idempotency-Key\` al subir y al citar para no duplicar nada.
- **Lo que tarda:** subir y citar esperan por defecto; para no bloquearte, \`esperar=0\` o \`Prefer: respond-async\`, y consulta \`progreso_url\`.

## Las reglas para citar

1. Cita solo lo que devuelve Scholaris, y copia \`cita\` y \`localizador\` tal cual.
2. Si citas literalmente, copia el \`texto\` literal; si parafraseas, pon igualmente la cita.
3. Da el \`enlace\`: es como la persona comprueba la página o el segundo.
4. Si la búsqueda no encuentra nada, dilo. No rellenes el hueco de memoria ni inventes una página.
5. No presentes una respuesta de \`preguntar\` como si fuera tuya: sus notas al pie son la parte importante.
6. No escribas el trabajo de la persona haciéndolo pasar por suyo. Scholaris existe para que encuentre y piense ella.

## Errores

Todas las respuestas de error tienen un \`codigo\` estable, un \`mensaje\` en castellano, un \`message\` en inglés y un enlace a la documentación. Los campos de la API están en castellano y en minúsculas.

## Contacto

Para avisar de un fallo, pedir más ritmo o proponer una integración: [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
  en: {
    titulo: 'For agents: how to read Scholaris and how to use it on someone’s behalf',
    corto: 'For agents',
    descripcion: 'What an agent can read on this site and in which format, how to act on a person’s library through API v1 or MCP, with which permissions and limits, and the rules for citing without inventing.',
    md: `## If you only want to understand what Scholaris is

Everything public is built to be read without JavaScript and without scraping HTML. Every page has a Markdown twin at the same address ending in \`.md\`, and is also served as Markdown if you ask with the header \`Accept: text/markdown\`. Pages also carry schema.org JSON-LD (SoftwareApplication, TechArticle, FAQPage, HowTo, DefinedTermSet).

\`\`\`sh
${LEER.replace('# Cualquier página pública, en Markdown', '# Any public page, as Markdown').replace('/saber/formatos', '/en/knowledge/formats').replace('/saber/formatos', '/en/knowledge/formats').replace('# Todo de una vez', '# Everything at once')}
\`\`\`

## Files for machines

${FICHEROS(true)}

## What may be crawled

The public pages (the front page, this knowledge base, the API guide and this page) may be read, indexed, quoted and used to answer, including for training models: [/robots.txt](/robots.txt) says so, with a line for each known crawler (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot and others). The app, the API and anyone's libraries are **not** to be crawled: the public links people share explicitly ask not to be indexed, and their content belongs to them.

## If you act on a person's behalf

You need that person to give you access; there is no anonymous access to any library. There are two ways:

1. **MCP with OAuth.** If your client speaks MCP, connect to \`${ORIGEN}/mcp\`. You register yourself (dynamic client registration), the person signs in to Scholaris and grants you read-only access. Tools: \`search\`, \`cite\`, \`open_page\` and \`verify_claim\`.
2. **API v1 with a key.** The person creates a key in Ajustes (Settings) → Claves de API (API keys) and gives it to you. With the \`lectura\` (read) scope you can search, read, ask and verify; with \`escritura\` (write), also upload, delete and cite a whole text; with \`mcp\`, use it with the MCP server. Base: \`${ORIGEN}/api/v1\`.

\`\`\`sh
${ACTUAR}
\`\`\`

All of it is explained in [API v1 and the MCP server](/en/knowledge/api-and-mcp) and, with a recorded session, in the [API guide](/en/api).

## Limits you must respect

- **Rate:** 120 requests per minute on the free plan and 600 on Pro. On a 429, wait the seconds in \`Retry-After\`.
- **The person's quotas:** searches per day, pages or minutes per month, autocites per month (see [Plans](/en/knowledge/plans)). A 402 means they are used up: tell them, do not keep trying.
- **Files:** up to 95 MB per request on API v1.
- **Retries:** send \`Idempotency-Key\` when uploading and citing so nothing is duplicated.
- **What takes time:** uploading and citing wait by default; not to block, use \`esperar=0\` or \`Prefer: respond-async\` and poll \`progreso_url\`.

## Rules for citing

1. Cite only what Scholaris returns, and copy \`cita\` (citation) and \`localizador\` (locator) verbatim.
2. When you quote, copy the literal \`texto\`; when you paraphrase, still attach the citation.
3. Give the \`enlace\` (link): it is how the person checks the page or the second.
4. If the search finds nothing, say so. Do not fill the gap from memory or invent a page.
5. Do not present an answer from \`preguntar\` (ask) as your own: its footnotes are the important part.
6. Do not write the person's work and pass it off as theirs. Scholaris exists so that they find and think.

## Errors

Every error response has a stable \`codigo\` (code), a \`mensaje\` in Spanish, a \`message\` in English and a link to the documentation. API fields are in Spanish and lower case.

## Contact

To report a bug, ask for a higher rate or propose an integration: [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
};
