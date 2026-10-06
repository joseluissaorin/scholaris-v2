import type { Pagina } from './tipos';
import { llave } from '../../bocetos/dibujos/llave';
import { ORIGEN } from '../origen';

const B = `${ORIGEN}/api/v1`;

const CURL = `export SCHOLARIS=sch_…   # Ajustes → Claves de API

# Subir (espera a que esté leído, hasta 60 s; si tarda más, 202 y progreso_url)
curl -s "${B}/documentos?nombre=articulo.pdf" -H "Authorization: Bearer $SCHOLARIS" \\
  -H "Content-Type: application/pdf" --data-binary @articulo.pdf

# Buscar, en Markdown
curl -sG ${B}/buscar -H "Authorization: Bearer $SCHOLARIS" \\
  --data-urlencode "q=atención escalada" -d k=5 -d formato=markdown

# Verificar una afirmación
curl -s ${B}/verificar -H "Authorization: Bearer $SCHOLARIS" -H "Content-Type: application/json" \\
  -d '{"afirmacion": "El Transformer prescinde de la recurrencia."}'`;

const MCP_CLAUDE = `claude mcp add --transport http scholaris ${ORIGEN}/mcp \\
  --header "Authorization: Bearer sch_…"`;

const MCP_JSON = `{
  "mcpServers": {
    "scholaris": {
      "url": "${ORIGEN}/mcp",
      "headers": { "Authorization": "Bearer sch_…" }
    }
  }
}`;

const PY = `from scholaris.api import Scholaris

s = Scholaris("sch_…")                      # o la variable SCHOLARIS_CLAVE
doc = s.subir("articulo.pdf")                # también una URL
for p in s.buscar("atención escalada", k=3):
    print(p["cita"], p["texto"][:80], p["enlace"])`;

const tablaVerbos = (en: boolean) => `| ${en ? 'Method' : 'Método'} | ${en ? 'Path' : 'Ruta'} | ${en ? 'What it does' : 'Qué hace'} |
| --- | --- | --- |
| POST | /documentos | ${en ? 'Upload a file (raw body, multipart field «archivo» or JSON with «url»)' : 'Sube un fichero (cuerpo crudo, multipart con «archivo» o JSON con «url»)'} |
| GET | /documentos | ${en ? 'List the library (q, estado, cursor; up to 200 per page)' : 'Lista la biblioteca (q, estado, cursor; hasta 200 por página)'} |
| GET | /documentos/{id} | ${en ? 'The record; with esperar=30 it waits until it is read' : 'La ficha; con esperar=30 espera a que esté leído'} |
| DELETE | /documentos/{id} | ${en ? 'Delete it with everything derived' : 'Lo borra con todo lo derivado'} |
| GET | /documentos/{id}/texto | ${en ? 'Text by printed page, [physical page] or time range' : 'El texto por página impresa, [página física] o tramo de tiempo'} |
| GET, POST | /buscar | ${en ? 'Search passages (k up to 50)' : 'Busca pasajes (k hasta 50)'} |
| POST | /preguntar | ${en ? 'Answer with checked footnotes; stream by events' : 'Responde con notas comprobadas; por eventos con stream'} |
| POST | /citar | ${en ? 'Your text (or .docx) back with citations and bibliography' : 'Tu texto (o tu .docx) con las citas y la bibliografía'} |
| POST | /verificar | ${en ? 'Does your library support a claim?' : '¿Respalda tu biblioteca una afirmación?'} |`;

export const api: Pagina = {
  clave: 'api',
  rutas: { es: '/saber/api-y-mcp', en: '/en/knowledge/api-and-mcp' },
  boceto: llave,
  es: {
    titulo: 'La API v1 y el servidor MCP',
    corto: 'API y MCP',
    descripcion: 'Nueve verbos sobre HTTP con una clave, respuestas en JSON o Markdown, y un servidor MCP con OAuth para Claude, Cursor y otros agentes. Límites, alcances, errores y ejemplos para copiar.',
    md: `## En una frase

Todo lo que hace la aplicación con tus documentos se puede hacer desde fuera con una cabecera \`Authorization: Bearer sch_…\` y nueve verbos. La guía completa, con una sesión grabada de verdad, está en [/api](/api); la especificación, en [OpenAPI 3.1](/api/v1/openapi.json); y las instrucciones para modelos, en [/api/v1/llms.txt](/api/v1/llms.txt).

## Los verbos

Base: \`${B}\`

${tablaVerbos(false)}

Cualquier lectura admite \`formato=markdown\` o la cabecera \`Accept: text/markdown\`. Lo que tarda (subir y citar) espera por defecto; con \`esperar=0\` o \`Prefer: respond-async\` responde 202 con \`progreso_url\`.

\`\`\`sh
${CURL}
\`\`\`

\`\`\`py
${PY}
\`\`\`

## Claves y alcances

Las claves se crean en Ajustes → Claves de API y se enseñan una sola vez; Scholaris solo guarda su huella SHA-256. Pueden caducar al cabo de los días que elijas. Cada clave tiene alcances:

lectura
: buscar, leer, preguntar y verificar.

escritura
: subir y borrar documentos, y citar un texto entero (la autocita guarda su trabajo).

mcp
: usar la clave en el servidor MCP.

Sin alcances explícitos, una clave nueva tiene lectura y mcp.

## Límites

| | Gratis | Pro |
| --- | --- | --- |
| Peticiones por minuto | 120 | 600 |
| Búsquedas al día | 100 | 5000 |
| Autocitas al mes | 5 | 500 |
| Páginas o minutos leídos al mes | 1500 | 60 000 |
| Fichero por petición en la API v1 | 95 MB | 95 MB |

Al pasarse del ritmo se recibe un 429 con \`Retry-After\`; al agotar una cuota, un 402 (\`cuota_superada\` o \`requiere_pro\`). Para reintentar sin duplicar, \`Idempotency-Key\` en subir y citar: con la misma clave, durante 24 horas, se devuelve el mismo recurso. Un fichero idéntico (misma huella) devuelve el que ya había, con \`duplicado: true\`.

## Errores

Todos tienen la misma forma, con el mensaje en castellano y en inglés:

\`\`\`json
{ "error": { "codigo": "prohibido", "mensaje": "Esta clave de API es de solo lectura.", "message": "This key is not allowed to do that.", "estado": 403, "documentacion": "${ORIGEN}/api#errores" } }
\`\`\`

Códigos: \`no_autenticado\` (401), \`prohibido\` (403), \`peticion_invalida\` (400), \`no_encontrado\` (404), \`conflicto\` (409), \`demasiado_grande\` (413), \`cuota_superada\` y \`requiere_pro\` (402), \`limite_de_ritmo\` (429), \`proveedor_fallo\` (502), \`no_disponible\` e \`interno\`.

## El servidor MCP

En \`${ORIGEN}/mcp\`, por HTTP («Streamable HTTP», sin estado). Ofrece cuatro herramientas:

| Herramienta | Qué hace |
| --- | --- |
| search | Búsqueda híbrida; pasajes con su localizador exacto |
| cite | Cita CSL de un fragmento o de un documento, en el estilo y la lengua que se pidan |
| open_page | El texto entero de una página, por posición física o por folio impreso |
| verify_claim | Veredicto sobre una afirmación, con los pasajes que la apoyan o la contradicen |

Para conectarse hay dos caminos:

- **OAuth 2.1**, para Claude (web y escritorio) y cualquier cliente que lo hable: Ajustes → Conectores → Añadir conector personalizado, con la dirección \`${ORIGEN}/mcp\`. El cliente se registra solo, tú entras en Scholaris y concedes acceso. Ese acceso es de solo lectura: buscar, abrir páginas, citar y verificar; no puede subir, cambiar ni borrar. Los tokens duran una hora y se renuevan.
- **Una clave** con el alcance \`mcp\`, para Claude Code, Cursor, Windsurf y los demás:

\`\`\`sh
${MCP_CLAUDE}
\`\`\`

\`\`\`json
${MCP_JSON}
\`\`\`

Los metadatos de OAuth están donde los buscan los clientes: [/.well-known/oauth-authorization-server](/.well-known/oauth-authorization-server) y [/.well-known/oauth-protected-resource](/.well-known/oauth-protected-resource). Hay además una tarjeta del servidor en [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json).

## Para agentes

Las reglas de uso (citar solo lo que devuelve la API, copiar la cita tal cual, dar el enlace, decir cuándo no se encuentra nada) están en la [hoja para agentes](/agentes).
`,
  },
  en: {
    titulo: 'API v1 and the MCP server',
    corto: 'API and MCP',
    descripcion: 'Nine verbs over HTTP with one key, answers in JSON or Markdown, and an MCP server with OAuth for Claude, Cursor and other agents. Limits, scopes, errors and examples to copy.',
    md: `## In one sentence

Everything the app does with your documents can be done from outside with an \`Authorization: Bearer sch_…\` header and nine verbs. The full guide, with a real recorded session, is at [/en/api](/en/api); the specification, in [OpenAPI 3.1](/api/v1/openapi.json); and the instructions for models, at [/api/v1/llms.txt](/api/v1/llms.txt). Field names are in Spanish.

## The verbs

Base: \`${B}\`

${tablaVerbos(true)}

Every read accepts \`formato=markdown\` or the header \`Accept: text/markdown\`. What takes time (uploading and citing) waits by default; with \`esperar=0\` or \`Prefer: respond-async\` it answers 202 with \`progreso_url\`.

\`\`\`sh
${CURL.replace('# Ajustes → Claves de API', '# Settings → API keys').replace('# Subir (espera a que esté leído, hasta 60 s; si tarda más, 202 y progreso_url)', '# Upload (waits until read, up to 60 s; longer, 202 with progreso_url)').replace('# Buscar, en Markdown', '# Search, in Markdown').replace('# Verificar una afirmación', '# Verify a claim')}
\`\`\`

\`\`\`py
${PY.replace('# o la variable SCHOLARIS_CLAVE', '# or the SCHOLARIS_CLAVE variable').replace('# también una URL', '# a URL works too')}
\`\`\`

## Keys and scopes

Keys are created in Ajustes (Settings) → Claves de API (API keys) and shown only once; Scholaris stores only their SHA-256 hash. They can expire after as many days as you choose. Each key has scopes:

lectura (read)
: search, read, ask and verify.

escritura (write)
: upload and delete documents, and cite a whole text (autocite stores its work).

mcp
: use the key with the MCP server.

Without explicit scopes, a new key gets lectura and mcp.

## Limits

| | Free | Pro |
| --- | --- | --- |
| Requests per minute | 120 | 600 |
| Searches per day | 100 | 5,000 |
| Autocites per month | 5 | 500 |
| Pages or minutes read per month | 1,500 | 60,000 |
| File per API v1 request | 95 MB | 95 MB |

Going over the rate gives a 429 with \`Retry-After\`; using up a quota, a 402 (\`cuota_superada\` or \`requiere_pro\`). To retry without duplicating, send \`Idempotency-Key\` when uploading and citing: with the same key, for 24 hours, you get the same resource back. An identical file (same hash) returns the existing one, with \`duplicado: true\`.

## Errors

They all have the same shape, with the message in Spanish and English:

\`\`\`json
{ "error": { "codigo": "prohibido", "mensaje": "Esta clave de API es de solo lectura.", "message": "This key is not allowed to do that.", "estado": 403, "documentacion": "${ORIGEN}/api#errores" } }
\`\`\`

Codes: \`no_autenticado\` (401), \`prohibido\` (403), \`peticion_invalida\` (400), \`no_encontrado\` (404), \`conflicto\` (409), \`demasiado_grande\` (413), \`cuota_superada\` and \`requiere_pro\` (402), \`limite_de_ritmo\` (429), \`proveedor_fallo\` (502), \`no_disponible\` and \`interno\`.

## The MCP server

At \`${ORIGEN}/mcp\`, over HTTP (stateless Streamable HTTP). It offers four tools:

| Tool | What it does |
| --- | --- |
| search | Hybrid search; passages with their exact locator |
| cite | A CSL citation for a fragment or a document, in the requested style and language |
| open_page | The full text of a page, by physical position or printed folio |
| verify_claim | A verdict on a claim, with the passages that support or contradict it |

There are two ways to connect:

- **OAuth 2.1**, for Claude (web and desktop) and any client that speaks it: Settings → Connectors → Add custom connector, with the address \`${ORIGEN}/mcp\`. The client registers itself, you sign in to Scholaris and grant access. That access is read-only: search, open pages, cite and verify; it cannot upload, change or delete. Tokens last an hour and are refreshed.
- **A key** with the \`mcp\` scope, for Claude Code, Cursor, Windsurf and the rest:

\`\`\`sh
${MCP_CLAUDE}
\`\`\`

\`\`\`json
${MCP_JSON}
\`\`\`

The OAuth metadata is where clients look for it: [/.well-known/oauth-authorization-server](/.well-known/oauth-authorization-server) and [/.well-known/oauth-protected-resource](/.well-known/oauth-protected-resource). There is also a server card at [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json).

## For agents

The rules of use (cite only what the API returns, copy the citation verbatim, give the link, say when nothing is found) are on the [page for agents](/en/agents).
`,
  },
};
