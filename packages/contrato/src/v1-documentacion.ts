/**
 * La API v1 descrita por sí misma: la especificación OpenAPI 3.1 que sirve
 * `/api/v1/openapi.json` y el `llms.txt` para agentes (`/llms.txt` y
 * `/api/v1/llms.txt`). Datos puros: los usan la API y la página `/api`.
 */
import { PREFIJO_V1 } from './v1.js';

type Esquema = Record<string, unknown>;

const ref = (n: string): Esquema => ({ $ref: `#/components/schemas/${n}` });
const str = (description?: string, extra: Esquema = {}): Esquema => ({ type: 'string', ...(description ? { description } : {}), ...extra });
const int = (description?: string, extra: Esquema = {}): Esquema => ({ type: 'integer', ...(description ? { description } : {}), ...extra });
const num = (description?: string, extra: Esquema = {}): Esquema => ({ type: 'number', ...(description ? { description } : {}), ...extra });
const arr = (items: Esquema, description?: string): Esquema => ({ type: 'array', items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, Esquema>, required: string[] = [], description?: string): Esquema => ({
  type: 'object', properties, ...(required.length ? { required } : {}), ...(description ? { description } : {}),
});

const ESQUEMAS: Record<string, Esquema> = {
  Error: obj({
    error: obj({
      codigo: str('Código estable: no_autenticado, prohibido, no_encontrado, peticion_invalida, conflicto, cuota_superada, limite_de_ritmo, requiere_pro, demasiado_grande, no_disponible, proveedor_fallo, interno.'),
      mensaje: str('Qué ha pasado, en español.'),
      message: str('The same, in English.'),
      estado: int('Código HTTP.'),
      documentacion: str('Dónde se explica.', { format: 'uri' }),
      detalles: { type: 'object', additionalProperties: true },
    }, ['codigo', 'mensaje', 'message', 'estado']),
  }, ['error']),
  Ancla: {
    description: 'A qué apunta una cita. Las citas y los enlaces salen siempre de aquí, nunca de un modelo.',
    oneOf: [
      obj({ tipo: { const: 'pagina' }, fisica: int('Página física, desde 1.'), impresa: { type: ['string', 'null'], description: 'Folio impreso («23», «xiv»).' }, romana: { type: 'boolean' }, origen: str(), confianza: num() }, ['tipo', 'fisica']),
      obj({ tipo: { const: 'tiempo' }, t0: num('Segundo de inicio.'), t1: num('Segundo de fin.'), hablante: str() }, ['tipo', 't0', 't1']),
      obj({ tipo: { const: 'seccion' }, ruta: arr(str()), parrafo: int(), impresa: { type: ['string', 'null'] } }, ['tipo', 'ruta', 'parrafo']),
      obj({ tipo: { const: 'diapositiva' }, n: int() }, ['tipo', 'n']),
      obj({ tipo: { const: 'hoja' }, hoja: str(), filaDesde: int(), filaHasta: int() }, ['tipo']),
      obj({ tipo: { const: 'web' }, url: str(), ruta: arr(str()), parrafo: int(), consultada: str() }, ['tipo']),
      obj({ tipo: { const: 'imagen' } }, ['tipo']),
    ],
  },
  Documento: obj({
    id: str('Id estable y corto.', { examples: ['dmuwtm9kmsanlrbm5'] }),
    titulo: str(), autores: arr(str(), '«Apellidos, Nombre». En las listas, solo los apellidos.'), anio: int(),
    tipo: str('pdf, pdf_escaneado, epub, documento, presentacion, hoja, audio, video, imagen, web.'),
    estado: str('', { enum: ['en_cola', 'procesando', 'listo', 'error'] }),
    progreso: num('Avance global 0-1 mientras se procesa.'), fase: str('Fase en curso.'),
    unidades: int('Páginas, diapositivas o tramos.'), duracion: num('Segundos (audio y vídeo).'), idioma: str(), url: str('Origen, si entró por URL.'),
    referencia: str('Referencia bibliográfica en APA, cuando está listo.'), duplicado: { type: 'boolean', description: 'Ya estaba en la biblioteca (misma huella SHA-256).' },
    error: str(), creado: str('', { format: 'date-time' }), enlace: str('El documento en el lector.', { format: 'uri' }),
    texto_url: str('', { format: 'uri' }), progreso_url: str('Mientras se procesa: dónde preguntar.', { format: 'uri' }),
  }, ['id', 'titulo', 'autores', 'tipo', 'estado', 'unidades', 'creado', 'enlace', 'texto_url']),
  ListaDocumentos: obj({ documentos: arr(ref('Documento')), total: int(), siguiente: str('Cursor de la página siguiente.') }, ['documentos', 'total']),
  DocumentoBreve: obj({ id: str(), titulo: str(), autores: arr(str()), anio: int() }, ['id', 'titulo', 'autores']),
  Pasaje: obj({
    id: str('Id del fragmento (el del documento, «:» y su posición).', { examples: ['dmuwtm9kmsanlrbm5:p23.1'] }), documento: ref('DocumentoBreve'), texto: str('Texto literal.'),
    cita: str('Cita corta lista para pegar.', { examples: ['(Cortázar, 1977, 1:06:56)', '(Foucault, 1975, p. 23)'] }),
    localizador: str('Solo el localizador.', { examples: ['p. 23', 'pp. 23-24', '1:06:56', 'diap. 7'] }),
    ancla: ref('Ancla'), enlace: str('El lector abierto en esa página o en ese segundo.', { format: 'uri' }), puntuacion: num(),
  }, ['id', 'documento', 'texto', 'cita', 'localizador', 'ancla', 'enlace']),
  Busqueda: obj({ consulta: str(), pasajes: arr(ref('Pasaje')), ms: int() }, ['consulta', 'pasajes']),
  Fuente: { allOf: [ref('Pasaje'), obj({ n: int('Número de la nota: [^n].') }, ['n'])] },
  Respuesta: obj({
    pregunta: str(), respuesta: str('Markdown con notas al pie [^n]; las definiciones van al final.'), fuentes: arr(ref('Fuente')),
    confianza: str('', { enum: ['alta', 'media', 'baja'] }), ms: int(),
  }, ['pregunta', 'respuesta', 'fuentes', 'confianza']),
  Cita: obj({
    afirmacion: str(), cita: str('La cita en el estilo pedido, tal como se insertó.'), localizador: str(), documento: str(), fragmento: str(),
    pasaje: str(), respaldo: num('Probabilidad 0-1 de que el pasaje la respalde.'), enlace: str('', { format: 'uri' }),
  }, ['afirmacion', 'cita', 'localizador', 'documento', 'fragmento', 'pasaje', 'respaldo']),
  Citado: obj({
    id: str(), estado: str('', { enum: ['en_cola', 'procesando', 'listo', 'error'] }), texto: str('El texto con las citas insertadas (Markdown).'),
    citas: arr(ref('Cita')), bibliografia: arr(str()), estilo: str(), progreso_url: str('', { format: 'uri' }), error: str(),
  }, ['id', 'estado', 'estilo']),
  Verificacion: obj({
    afirmacion: str(), veredicto: str('', { enum: ['respaldada', 'parcial', 'sin_respaldo', 'contradicha'] }),
    respaldada: { type: 'boolean' }, probabilidad: num('Respaldo del mejor pasaje (0-1).'),
    pasajes: arr({ allOf: [ref('Pasaje'), obj({ relacion: str('APOYO_DIRECTO, CONTRADICCION, CONTEXTO, APLICACION_DE_MARCO, IMPOSIBLE_TEMPORAL…'), respaldo: num() })] }), ms: int(),
  }, ['afirmacion', 'veredicto', 'respaldada', 'probabilidad', 'pasajes']),
  Texto: obj({
    documento: { allOf: [ref('DocumentoBreve'), obj({ tipo: str() })] },
    unidades: arr(obj({ posicion: int('Posición física, desde 1.'), localizador: str(), cita: str(), enlace: str('', { format: 'uri' }), t0: num(), t1: num(), texto: str() }, ['posicion', 'localizador', 'cita', 'enlace', 'texto'])),
    siguiente: str('Si hay más: pásalo como «desde».', { examples: ['[21]'] }),
  }, ['documento', 'unidades']),
};

const ERRORES = {
  '400': { description: 'Petición no válida', content: { 'application/json': { schema: ref('Error') } } },
  '401': { description: 'Falta la clave o no vale', content: { 'application/json': { schema: ref('Error') } } },
  '403': { description: 'La clave no tiene el alcance necesario', content: { 'application/json': { schema: ref('Error') } } },
  '429': { description: 'Demasiadas peticiones (mira Retry-After)', content: { 'application/json': { schema: ref('Error') } } },
};

const pFormato = { name: 'formato', in: 'query', schema: { type: 'string', enum: ['json', 'markdown'] }, description: 'markdown devuelve text/markdown (también con Accept: text/markdown).' };
const pEsperar = (def: number) => ({ name: 'esperar', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 600, default: def }, description: `Segundos que espera a que termine (${def} por defecto). 0 o «Prefer: respond-async»: responde enseguida con 202 y progreso_url.` });
const pIdem = { name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 255 }, description: 'Repetir la petición con la misma clave en 24 h devuelve el mismo recurso, sin duplicarlo.' };
const pId = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const json = (schema: Esquema, md = true) => ({ 'application/json': { schema }, ...(md ? { 'text/markdown': { schema: { type: 'string' } } } : {}) });

export function openapiV1(origen: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Scholaris API v1',
      version: '1.0.0',
      summary: 'Subo cualquier cosa, busco, pregunto, cito. Upload anything, search, ask, cite.',
      description: [
        'La API sencilla de Scholaris: una biblioteca leída y citable, con la página impresa o el segundo exactos de cada pasaje y ninguna cita inventada.',
        '',
        'Autenticación: `Authorization: Bearer sch_…` con una clave personal (Ajustes → Claves de API). Alcances: `lectura` para leer y buscar, `escritura` para subir, borrar y citar.',
        '',
        `Para agentes: ${origen}/llms.txt. Servidor MCP: ${origen}/mcp.`,
      ].join('\n'),
      contact: { name: 'José Luis Saorín Ferrer', url: 'https://joseluissaorin.com', email: 'jl@joseluissaorin.com' },
    },
    servers: [{ url: `${origen}${PREFIJO_V1}` }],
    security: [{ clave: [] }],
    externalDocs: { url: `${origen}/api`, description: 'Guía con ejemplos que se pueden copiar y pegar' },
    tags: [{ name: 'documentos' }, { name: 'buscar' }, { name: 'preguntar' }, { name: 'citar' }],
    paths: {
      '/documentos': {
        post: {
          tags: ['documentos'], operationId: 'subir',
          summary: 'Subir cualquier cosa: un fichero o una URL',
          description: 'El fichero va como cuerpo crudo (con su Content-Type y `?nombre=`) o como multipart (campo `archivo`); una URL, como JSON `{ "url": … }` (página web, PDF, YouTube, Vimeo, pódcast). El servidor convierte y lee. Si ya estaba (misma huella SHA-256), devuelve el que hay con `duplicado: true`.',
          parameters: [
            pEsperar(60), pIdem, pFormato,
            { name: 'nombre', in: 'query', schema: { type: 'string' }, description: 'Nombre del fichero (cuerpo crudo).' },
            { name: 'titulo', in: 'query', schema: { type: 'string' } },
            { name: 'autores', in: 'query', schema: { type: 'string' }, description: '«Apellidos, Nombre; Apellidos, Nombre».' },
            { name: 'anio', in: 'query', schema: { type: 'integer' } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
              'multipart/form-data': { schema: obj({ archivo: { type: 'string', format: 'binary' }, titulo: str(), autores: str(), anio: int() }) },
              'application/json': { schema: obj({ url: str('', { format: 'uri' }), titulo: str(), autores: arr(str()), anio: int(), tipo: str(), modo: str('', { enum: ['rapido', 'economico'] }) }, ['url']) },
            },
          },
          responses: {
            '201': { description: 'Listo (o terminado con error: mira `estado`)', content: json(ref('Documento')) },
            '200': { description: 'Ya estaba (duplicado o Idempotency-Key repetida)', content: json(ref('Documento')) },
            '202': { description: 'Sigue procesándose: pregunta en `progreso_url`', content: json(ref('Documento')) },
            '413': { description: 'Demasiado grande', content: { 'application/json': { schema: ref('Error') } } },
            ...ERRORES,
          },
        },
        get: {
          tags: ['documentos'], operationId: 'listar', summary: 'Listar la biblioteca',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Título o autor.' },
            { name: 'estado', in: 'query', schema: { type: 'string', enum: ['en_cola', 'procesando', 'listo', 'error'] } },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } }, pFormato,
          ],
          responses: { '200': { description: 'Página de documentos', content: json(ref('ListaDocumentos')) }, ...ERRORES },
        },
      },
      '/documentos/{id}': {
        get: {
          tags: ['documentos'], operationId: 'documento', summary: 'Ficha, estado y progreso',
          parameters: [pId, pEsperar(0), pFormato],
          responses: { '200': { description: 'El documento', content: json(ref('Documento')) }, '404': { description: 'No existe', content: { 'application/json': { schema: ref('Error') } } }, ...ERRORES },
        },
        delete: {
          tags: ['documentos'], operationId: 'borrar', summary: 'Borrar (con todo lo derivado)',
          parameters: [pId],
          responses: { '200': { description: 'Borrado', content: { 'application/json': { schema: obj({ ok: { type: 'boolean' }, id: str(), borrado: { type: 'boolean' } }) } } }, ...ERRORES },
        },
      },
      '/documentos/{id}/texto': {
        get: {
          tags: ['documentos'], operationId: 'texto', summary: 'Leer páginas o un tramo de tiempo',
          description: '`desde` y `hasta` admiten el folio impreso («23», «xiv»), la posición física entre corchetes («[12]») y, en audio y vídeo, tiempos («1:06:56», «66:56», «4016»). Sin `hasta`, devuelve `limite` unidades y `siguiente` para seguir.',
          parameters: [
            pId, { name: 'desde', in: 'query', schema: { type: 'string' } }, { name: 'hasta', in: 'query', schema: { type: 'string' } },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } }, pFormato,
          ],
          responses: { '200': { description: 'El texto, unidad a unidad, con su localizador', content: json(ref('Texto')) }, '409': { description: 'Todavía sin texto', content: { 'application/json': { schema: ref('Error') } } }, ...ERRORES },
        },
      },
      '/buscar': {
        get: {
          tags: ['buscar'], operationId: 'buscar', summary: 'Buscar pasajes con su cita',
          description: 'Búsqueda híbrida (léxica, semántica y visual) reordenada. Entre comillas, una frase literal.',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'k', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
            { name: 'documento', in: 'query', schema: { type: 'string' }, description: 'Restringir a un documento (se puede repetir o separar por comas).' },
            { name: 'biblioteca', in: 'query', schema: { type: 'string' } }, pFormato,
          ],
          responses: { '200': { description: 'Pasajes', content: json(ref('Busqueda')) }, ...ERRORES },
        },
        post: {
          tags: ['buscar'], operationId: 'buscarPost', summary: 'Lo mismo, con JSON',
          requestBody: { content: { 'application/json': { schema: obj({ q: str(), k: int(), documentos: arr(str()), biblioteca: str(), formato: str() }, ['q']) } } },
          responses: { '200': { description: 'Pasajes', content: json(ref('Busqueda')) }, ...ERRORES },
        },
      },
      '/preguntar': {
        post: {
          tags: ['preguntar'], operationId: 'preguntar', summary: 'Una respuesta con notas al pie verificadas',
          description: 'El redactor solo puede citar los pasajes que se le dan; cada nota [^n] se comprueba y su texto sale del ancla. Con `stream: true` (o Accept: text/event-stream), eventos SSE: `pasajes`, `texto` (delta), `fuente`, `fin` (la respuesta entera) y `error`.',
          parameters: [pFormato],
          requestBody: { required: true, content: { 'application/json': { schema: obj({ pregunta: str(), k: int('Pasajes de contexto (8, máximo 12).'), documentos: arr(str()), biblioteca: str(), stream: { type: 'boolean' } }, ['pregunta']) } } },
          responses: { '200': { description: 'Respuesta', content: { ...json(ref('Respuesta')), 'text/event-stream': { schema: { type: 'string' } } } }, ...ERRORES },
        },
      },
      '/citar': {
        post: {
          tags: ['citar'], operationId: 'citar', summary: 'Citar un texto con la biblioteca',
          description: 'Inserta citas verificadas (con página exacta) en el texto y devuelve la bibliografía. Acepta JSON `{ "texto": … }` o un .docx como cuerpo; con `Accept: application/vnd.openxmlformats-officedocument.wordprocessingml.document` (o `?formato=docx`) y un .docx de entrada, devuelve el .docx citado.',
          parameters: [pEsperar(120), pIdem, pFormato],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: obj({ texto: str(), estilo: str('Cualquier estilo CSL.', { default: 'apa' }), idioma: str('', { default: 'es-ES' }), umbral: num('Respaldo mínimo (0,7).'), documentos: arr(str()), biblioteca: str() }, ['texto']) },
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: {
            '200': { description: 'Terminado', content: { ...json(ref('Citado')), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { schema: { type: 'string', format: 'binary' } } } },
            '202': { description: 'Sigue trabajando: pregunta en `progreso_url`', content: json(ref('Citado')) },
            '402': { description: 'Cuota de citas del plan agotada', content: { 'application/json': { schema: ref('Error') } } },
            ...ERRORES,
          },
        },
      },
      '/citar/{id}': {
        get: {
          tags: ['citar'], operationId: 'citado', summary: 'Estado o resultado de una cita en curso',
          parameters: [pId, pEsperar(0), pFormato],
          responses: { '200': { description: 'Terminado', content: json(ref('Citado')) }, '202': { description: 'Sigue trabajando', content: json(ref('Citado')) }, ...ERRORES },
        },
      },
      '/verificar': {
        post: {
          tags: ['citar'], operationId: 'verificar', summary: '¿Respalda la biblioteca esta afirmación?',
          parameters: [pFormato],
          requestBody: { required: true, content: { 'application/json': { schema: obj({ afirmacion: str(), anio: int('Año del texto que la hace: descarta fuentes posteriores.'), k: int(), documentos: arr(str()) }, ['afirmacion']) } } },
          responses: { '200': { description: 'Veredicto con los pasajes', content: json(ref('Verificacion')) }, ...ERRORES },
        },
      },
    },
    components: {
      securitySchemes: { clave: { type: 'http', scheme: 'bearer', bearerFormat: 'sch_…', description: 'Clave personal de Ajustes → Claves de API.' } },
      schemas: ESQUEMAS,
    },
  };
}

export function llmsTxtV1(origen: string): string {
  const B = `${origen}${PREFIJO_V1}`;
  return `# Scholaris

> Scholaris is a personal research library that reads anything (PDF, EPUB, DOCX, slides, audio, video, web pages, YouTube) and lets you search, ask and cite it with the exact printed page or second of every passage. Citations always come from stored anchors, never from a model: if a passage is not in the library, Scholaris will not cite it.

En español: Scholaris es una biblioteca leída y citable. Subes cualquier cosa, buscas, preguntas y citas, con la página impresa o el segundo exactos y ninguna cita inventada. Los nombres de los campos de la API están en español; abajo se explican en inglés.

## Quick start

- Base URL: ${B}
- Auth: one header, \`Authorization: Bearer sch_…\`. Keys are created by the user in Scholaris → Ajustes (Settings) → Claves de API (${origen}/ajustes/claves). Scopes: \`lectura\` (read, search, ask), \`escritura\` (upload, delete, cite), \`mcp\`.
- JSON in, JSON out. Add \`?formato=markdown\` (or \`Accept: text/markdown\`) to any read to get Markdown, which is usually best for you.
- Errors: \`{ "error": { "codigo", "mensaje" (Spanish), "message" (English), "estado", "documentacion" } }\`. On 429, wait \`Retry-After\` seconds.
- Ids are short and stable: a document is like \`dmuwtm9kmsanlrbm5\`; a passage (fragment) id starts with its document id (\`dmuwtm9kmsanlrbm5:t0.0\`).

## The verbs

- \`POST ${B}/documentos\`: add something. Body: the raw file (any Content-Type; pass \`?nombre=file.pdf\`), multipart field \`archivo\`, or JSON \`{"url": "…"}\`. Waits up to \`?esperar=60\` seconds; if not ready, returns 202 with \`progreso_url\`. Same file twice (SHA-256) returns the existing document with \`duplicado: true\`. Send \`Idempotency-Key\` when retrying URL uploads.
- \`GET ${B}/documentos\`: list (\`q\`, \`estado\`, \`limite\`, \`cursor\`).
- \`GET ${B}/documentos/{id}\`: metadata, \`estado\` (en_cola | procesando | listo | error), \`progreso\` 0-1, APA \`referencia\`. \`?esperar=30\` long-polls until done.
- \`DELETE ${B}/documentos/{id}\`.
- \`GET ${B}/documentos/{id}/texto?desde=23&hasta=25\`: read pages by printed folio («23», «xiv») or physical position («[12]»); in audio/video by time (\`desde=1:02:00&hasta=1:05:00\`). Without \`hasta\` returns 20 units and \`siguiente\` (pass it as \`desde\`).
- \`GET ${B}/buscar?q=…&k=10&documento=ID\`: passages with \`cita\` («(Cortázar, 1977, 1:06:56)»), \`localizador\` («p. 23»), \`ancla\`, \`enlace\` (deep link to the reader at that page or second) and literal \`texto\`. Quote a phrase ("…") for literal search.
- \`POST ${B}/preguntar {"pregunta": "…"}\`: Markdown answer with footnotes [^n] and \`fuentes\` (each a passage with its citation). \`"stream": true\` for SSE (\`pasajes\`, \`texto\`, \`fuente\`, \`fin\`).
- \`POST ${B}/citar {"texto": "…", "estilo": "apa"}\`: returns the text with verified citations inserted, the list of \`citas\` (claim, citation, passage, \`respaldo\` 0-1) and the \`bibliografia\`. Any CSL style. A .docx body with \`Accept: application/vnd.openxmlformats-officedocument.wordprocessingml.document\` returns the cited .docx. Slow (often 20-90 s): waits \`?esperar=120\`, then 202 + \`GET ${B}/citar/{id}\`.
- \`POST ${B}/verificar {"afirmacion": "…"}\`: \`veredicto\` (respaldada | parcial | sin_respaldo | contradicha), \`probabilidad\` and the supporting or contradicting passages.

## Rules for agents

1. Cite only what the API returns. Copy \`cita\` and \`localizador\` verbatim; never build a page number yourself.
2. Quote \`texto\` literally when you quote. If you paraphrase, still attach the \`cita\`.
3. Give the user the \`enlace\` so they can check the page or the second.
4. If \`buscar\` returns nothing relevant, say so. Do not fill the gap from memory.
5. Before asserting something as supported by the user's sources, call \`verificar\`.

## Examples

\`\`\`sh
export SCHOLARIS=sch_…   # Ajustes → Claves de API
curl -s ${B}/documentos -H "Authorization: Bearer $SCHOLARIS" -H "Content-Type: application/pdf" --data-binary @articulo.pdf
curl -s "${B}/buscar?q=atención+escalada&k=3&formato=markdown" -H "Authorization: Bearer $SCHOLARIS"
curl -s ${B}/preguntar -H "Authorization: Bearer $SCHOLARIS" -H "Content-Type: application/json" -d '{"pregunta":"¿Qué es la atención multicabeza?"}'
\`\`\`

## More

- [Human guide (Spanish and English)](${origen}/api): copy-paste examples in curl, JavaScript and Python.
- [OpenAPI 3.1](${B}/openapi.json)
- [MCP server](${origen}/mcp): Streamable HTTP with OAuth or a key with the \`mcp\` scope. Tools: search, cite, open_page, verify_claim.
- [Python](${origen}/api#python): \`pip install scholaris-sdk\` (import name \`scholaris\`), then \`from scholaris.api import Scholaris; Scholaris("sch_…").buscar("…")\`.
`;
}
