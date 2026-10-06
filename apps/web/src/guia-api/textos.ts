/**
 * Los textos de la guía de la API (/api en castellano, /en/api en inglés).
 * El código de los ejemplos es el mismo en las dos lenguas: vive en pagina.ts.
 */
export type Lengua = 'es' | 'en';

export interface Verbo {
  metodo: 'GET' | 'POST' | 'DELETE';
  ruta: string;
  que: string;
  /** Clave del ejemplo en pagina.ts. */
  ejemplo: string;
}

export interface TextosGuia {
  lengua: Lengua;
  html: string;
  ruta: string;
  otra: { ruta: string; nombre: string; hreflang: string; etiqueta: string };
  titulo: string;
  descripcion: string;
  saltar: string;
  nav: { verbos: string; agentes: string; crear: string };
  heroe: { rotulo: string; titular: string; entradilla: string; crear: string; openapi: string; nota: string };
  minuto: { rubrica: string; pasos: [string, string, string]; despues: string };
  verbos: { rubrica: string; intro: string; lista: Verbo[]; formato: string; espera: string };
  sesion: { rubrica: string; intro: string; comandos: string[] };
  js: { rubrica: string; intro: string };
  py: { rubrica: string; intro: string; instalar: string };
  agentes: { rubrica: string; intro: string; llms: string; claudeCode: string; claudeApp: string; otros: string; reglas: string[] };
  errores: { rubrica: string; intro: string; cabecera: [string, string, string]; codigos: Array<[string, number, string]>; ritmo: string; idem: string };
  anclas: { rubrica: string; parrafos: string[] };
  copiar: string;
  copiado: string;
  pie: string;
}

const ES: TextosGuia = {
  lengua: 'es',
  html: 'es',
  ruta: '/api',
  otra: { ruta: '/en/api', nombre: 'English', hreflang: 'en', etiqueta: 'Read this guide in English' },
  titulo: 'La API de Scholaris: subes, buscas, preguntas y citas',
  descripcion: 'Una API sencilla para personas y agentes. Subes cualquier cosa, buscas, preguntas y citas con la página impresa o el segundo exactos y ninguna cita inventada.',
  saltar: 'Saltar a la guía',
  nav: { verbos: 'Verbos', agentes: 'Agentes', crear: 'Crear clave' },
  heroe: {
    rotulo: 'API v1',
    titular: 'Subes cualquier cosa, buscas, preguntas y citas.',
    entradilla: 'Una cabecera, nueve verbos y JSON de ida y vuelta (o Markdown, que los agentes leen mejor). Cada pasaje llega con su página impresa o su segundo exactos y un enlace al lector, y ninguna cita sale de un modelo: todas salen del ancla guardada.',
    crear: 'Crear una clave',
    openapi: 'Ver la especificación OpenAPI',
    nota: 'Funciona igual en la nube y en la versión de casa.',
  },
  minuto: {
    rubrica: 'Empieza en un minuto',
    pasos: [
      'Crea una clave en Ajustes → Claves de API, con los alcances de lectura y escritura. Se enseña una sola vez: guárdala.',
      'Sube un fichero. La petición espera a que esté leído (hasta un minuto; si tarda más, responde 202 con dónde preguntar).',
      'Busca. Cada pasaje trae su cita lista para pegar, el localizador exacto y el enlace al lector en esa página.',
    ],
    despues: 'Los ejemplos se pueden copiar y pegar tal cual: solo hace falta la variable SCHOLARIS con tu clave.',
  },
  verbos: {
    rubrica: 'Los nueve verbos',
    intro: 'Todo cuelga de una misma dirección base. Los nombres de los campos están en castellano y en minúsculas.',
    lista: [
      { metodo: 'POST', ruta: '/documentos', que: 'Sube cualquier cosa: el fichero como cuerpo (PDF, EPUB, DOCX, presentaciones, hojas, audio, vídeo, imágenes), un formulario multipart con el campo «archivo» o un JSON con «url» (una web, un PDF, YouTube, Vimeo, un pódcast). Si el fichero ya estaba (misma huella SHA-256), devuelve el que hay con «duplicado».', ejemplo: 'subir' },
      { metodo: 'GET', ruta: '/documentos', que: 'Lista la biblioteca. Filtra con «q» (título o autor) y «estado»; pagina con «cursor».', ejemplo: 'listar' },
      { metodo: 'GET', ruta: '/documentos/{id}', que: 'La ficha: título, autores, año, estado, progreso mientras se procesa y la referencia completa cuando está listo. Con «esperar=30» espera a que termine.', ejemplo: 'documento' },
      { metodo: 'DELETE', ruta: '/documentos/{id}', que: 'Lo borra con todo lo derivado (páginas, vectores, imágenes).', ejemplo: 'borrar' },
      { metodo: 'GET', ruta: '/documentos/{id}/texto', que: 'Lee el texto por páginas o por un tramo de tiempo. «desde» y «hasta» admiten el folio impreso («23», «xiv»), la posición física entre corchetes («[12]») y, en audio y vídeo, tiempos («1:06:56»).', ejemplo: 'texto' },
      { metodo: 'GET', ruta: '/buscar', que: 'Busca pasajes (búsqueda híbrida y reordenada). Entre comillas, una frase literal. Cada pasaje trae «cita», «localizador», «ancla», «enlace» y el «texto» literal.', ejemplo: 'buscar' },
      { metodo: 'POST', ruta: '/preguntar', que: 'Responde en Markdown con notas al pie [^n]. El redactor solo puede citar los pasajes que se le dan, y cada nota se comprueba. Con «stream» llega por eventos.', ejemplo: 'preguntar' },
      { metodo: 'POST', ruta: '/citar', que: 'Devuelve tu texto con las citas insertadas (página exacta y cualquier estilo CSL) y la bibliografía. También acepta un .docx y lo devuelve citado, con su formato.', ejemplo: 'citar' },
      { metodo: 'POST', ruta: '/verificar', que: 'Dice si tu biblioteca respalda una afirmación: «respaldada», «parcial», «sin_respaldo» o «contradicha», con la probabilidad y los pasajes.', ejemplo: 'verificar' },
    ],
    formato: 'Cualquier lectura admite «formato=markdown» (o la cabecera Accept: text/markdown).',
    espera: 'Lo que tarda (subir y citar) espera por defecto y responde con el resultado. Para no esperar, «esperar=0» o la cabecera «Prefer: respond-async»: la respuesta es un 202 con «progreso_url».',
  },
  sesion: {
    rubrica: 'Una sesión de verdad',
    intro: 'Cinco órdenes grabadas tal cual contra la versión local, con los ficheros del banco de pruebas: un cuento de Cortázar en PDF y una clase en audio ya subida. Las respuestas largas están recortadas donde dice […].',
    comandos: ['Subir un PDF y esperar a que esté leído', 'Buscar, en Markdown', 'Un pasaje de audio: el localizador es el segundo', 'Preguntar', 'Citar un texto propio'],
  },
  js: { rubrica: 'Desde JavaScript', intro: 'Con fetch y nada más (Node 20 o el navegador). Diez líneas: subir, buscar y preguntar.' },
  py: { rubrica: 'Desde Python', intro: 'El SDK trae una fachada de cinco verbos sobre esta misma API.', instalar: 'Instálalo con pip (solo necesita requests):' },
  agentes: {
    rubrica: 'Para agentes',
    intro: 'Hay dos caminos: el servidor MCP, para los agentes que hablan MCP, y esta API, que cualquier agente con una herramienta HTTP sabe usar.',
    llms: 'Un agente que solo sepa leer la web tiene sus instrucciones en /llms.txt: los verbos, los campos y las reglas para citar sin inventar.',
    claudeCode: 'En Claude Code, con una clave que tenga el alcance «mcp»:',
    claudeApp: 'En Claude (web o escritorio): Ajustes → Conectores → Añadir conector personalizado, con esta dirección. Inicias sesión en Scholaris y concedes acceso; no hace falta clave.',
    otros: 'En Cursor, Windsurf y los demás clientes MCP:',
    reglas: [
      'Cita solo lo que devuelve la API, y copia «cita» y «localizador» tal cual.',
      'Si citas literalmente, copia el «texto» literal; si parafraseas, pon igualmente la cita.',
      'Da el «enlace»: es la manera de comprobar la página o el segundo.',
      'Si la búsqueda no encuentra nada, dilo; no rellenes el hueco de memoria.',
    ],
  },
  errores: {
    rubrica: 'Cuando algo falla',
    intro: 'Los errores dicen qué ha pasado en castellano («mensaje») y en inglés («message»), con un código estable para el programa y el enlace a esta guía:',
    cabecera: ['Código', 'HTTP', 'Qué significa'],
    codigos: [
      ['no_autenticado', 401, 'Falta la clave, no vale o se ha revocado.'],
      ['prohibido', 403, 'La clave no tiene el alcance necesario (escribir necesita «escritura»).'],
      ['peticion_invalida', 400, 'Falta un campo o no es válido: el mensaje dice cuál.'],
      ['no_encontrado', 404, 'No existe o no es tuyo.'],
      ['conflicto', 409, 'Choca con el estado actual; por ejemplo, el documento aún no tiene texto.'],
      ['demasiado_grande', 413, 'Por aquí caben ficheros de hasta 95 MB; para más, el SDK sube por partes.'],
      ['cuota_superada · requiere_pro', 402, 'Se ha agotado una cuota del plan.'],
      ['limite_de_ritmo', 429, 'Demasiadas peticiones seguidas: espera los segundos de Retry-After.'],
      ['proveedor_fallo', 502, 'Ha fallado un proveedor de IA: vuelve a intentarlo.'],
    ],
    ritmo: 'Los límites de ritmo y las cuotas son los de tu plan, los mismos que en la aplicación.',
    idem: 'Para reintentar sin duplicar, manda una cabecera Idempotency-Key en «subir» y «citar»: con la misma clave, durante 24 horas, se devuelve el mismo recurso.',
  },
  anclas: {
    rubrica: 'De dónde sale cada cita',
    parrafos: [
      'Al leer un documento, Scholaris guarda de cada pasaje un ancla: la página física y el folio impreso que se ve en el papel, el segundo de un audio o de un vídeo, la diapositiva, la sección y el párrafo de una web. Es lo que devuelve el campo «ancla».',
      'La «cita» y el «localizador» se escriben desde esa ancla, nunca desde lo que diga un modelo; el «enlace» abre el lector en esa misma página o en ese mismo segundo. Si un pasaje no está en tu biblioteca, la API no lo cita.',
    ],
  },
  copiar: 'Copiar',
  copiado: 'Copiado',
  pie: 'Scholaris · una biblioteca leída y citable',
};

const EN: TextosGuia = {
  lengua: 'en',
  html: 'en',
  ruta: '/en/api',
  otra: { ruta: '/api', nombre: 'Español', hreflang: 'es', etiqueta: 'Lee esta guía en español' },
  titulo: 'The Scholaris API: upload, search, ask and cite',
  descripcion: 'A simple API for people and agents. Upload anything, search, ask and cite, with the exact printed page or second and no invented citations.',
  saltar: 'Skip to the guide',
  nav: { verbos: 'Verbs', agentes: 'Agents', crear: 'Create key' },
  heroe: {
    rotulo: 'API v1',
    titular: 'Upload anything, search, ask and cite.',
    entradilla: 'One header, nine verbs, JSON in and out (or Markdown, which agents read better). Every passage comes with its exact printed page or second and a link to the reader, and no citation comes from a model: they all come from the stored anchor.',
    crear: 'Create a key',
    openapi: 'See the OpenAPI spec',
    nota: 'Works the same in the cloud and in the home version.',
  },
  minuto: {
    rubrica: 'Start in a minute',
    pasos: [
      'Create a key in Ajustes (Settings) → Claves de API (API keys), with the read and write scopes. It is shown only once: keep it.',
      'Upload a file. The request waits until it has been read (up to a minute; if it takes longer, it answers 202 with where to ask).',
      'Search. Every passage brings a citation ready to paste, the exact locator and the link to the reader at that page.',
    ],
    despues: 'The examples can be copied and pasted as they are: you only need the SCHOLARIS variable with your key.',
  },
  verbos: {
    rubrica: 'The nine verbs',
    intro: 'Everything hangs from one base address. Field names are in Spanish and lower case; this guide translates them.',
    lista: [
      { metodo: 'POST', ruta: '/documentos', que: 'Upload anything: the file as the body (PDF, EPUB, DOCX, slides, spreadsheets, audio, video, images), a multipart form with the field «archivo» (file), or JSON with «url» (a web page, a PDF, YouTube, Vimeo, a podcast). If the file was already there (same SHA-256), you get the existing one with «duplicado» (duplicate).', ejemplo: 'subir' },
      { metodo: 'GET', ruta: '/documentos', que: 'List the library. Filter with «q» (title or author) and «estado» (status); page with «cursor».', ejemplo: 'listar' },
      { metodo: 'GET', ruta: '/documentos/{id}', que: 'The record: title, authors, year, status, progress while it is processed and the full reference when it is ready. With «esperar=30» (wait) it long-polls until done.', ejemplo: 'documento' },
      { metodo: 'DELETE', ruta: '/documentos/{id}', que: 'Delete it with everything derived from it (pages, vectors, images).', ejemplo: 'borrar' },
      { metodo: 'GET', ruta: '/documentos/{id}/texto', que: 'Read the text by pages or by a time range. «desde» (from) and «hasta» (to) take the printed page («23», «xiv»), the physical position in brackets («[12]») and, in audio and video, times («1:06:56»).', ejemplo: 'texto' },
      { metodo: 'GET', ruta: '/buscar', que: 'Search passages (hybrid search, reranked). Quote a phrase for a literal match. Each passage brings «cita» (citation), «localizador» (locator), «ancla» (anchor), «enlace» (link) and the literal «texto».', ejemplo: 'buscar' },
      { metodo: 'POST', ruta: '/preguntar', que: 'Answer in Markdown with footnotes [^n]. The writer may only cite the passages it is given, and every note is checked. With «stream» it arrives as events.', ejemplo: 'preguntar' },
      { metodo: 'POST', ruta: '/citar', que: 'Your text back with the citations inserted (exact page, any CSL style) and the bibliography. It also takes a .docx and returns it cited, formatting intact.', ejemplo: 'citar' },
      { metodo: 'POST', ruta: '/verificar', que: 'Whether your library supports a claim: «respaldada» (supported), «parcial», «sin_respaldo» (unsupported) or «contradicha» (contradicted), with the probability and the passages.', ejemplo: 'verificar' },
    ],
    formato: 'Every read accepts «formato=markdown» (or the header Accept: text/markdown).',
    espera: 'What takes time (uploading and citing) waits by default and answers with the result. Not to wait, «esperar=0» or the header «Prefer: respond-async»: the answer is a 202 with «progreso_url».',
  },
  sesion: {
    rubrica: 'A real session',
    intro: 'Five commands recorded as they ran against the home version, with the benchmark files: a short story by Cortázar in PDF and a lecture in audio already uploaded. Long answers are cut where it says […].',
    comandos: ['Upload a PDF and wait until it is read', 'Search, in Markdown', 'An audio passage: the locator is the second', 'Ask', 'Cite your own text'],
  },
  js: { rubrica: 'From JavaScript', intro: 'With fetch and nothing else (Node 20 or the browser). Ten lines: upload, search and ask.' },
  py: { rubrica: 'From Python', intro: 'The SDK has a five-verb facade over this same API.', instalar: 'Install it with pip (it only needs requests):' },
  agentes: {
    rubrica: 'For agents',
    intro: 'There are two ways in: the MCP server, for agents that speak MCP, and this API, which any agent with an HTTP tool can use.',
    llms: 'An agent that can only read the web finds its instructions in /llms.txt: the verbs, the fields and the rules to cite without inventing.',
    claudeCode: 'In Claude Code, with a key that has the «mcp» scope:',
    claudeApp: 'In Claude (web or desktop): Settings → Connectors → Add custom connector, with this address. You sign in to Scholaris and grant access; no key needed.',
    otros: 'In Cursor, Windsurf and other MCP clients:',
    reglas: [
      'Cite only what the API returns, and copy «cita» and «localizador» verbatim.',
      'When you quote, copy the literal «texto»; when you paraphrase, still attach the citation.',
      'Give the «enlace»: it is how the reader checks the page or the second.',
      'If the search finds nothing, say so; do not fill the gap from memory.',
    ],
  },
  errores: {
    rubrica: 'When something fails',
    intro: 'Errors say what happened in Spanish («mensaje») and in English («message»), with a stable code for your program and a link to this guide:',
    cabecera: ['Code', 'HTTP', 'Meaning'],
    codigos: [
      ['no_autenticado', 401, 'The key is missing, wrong or revoked.'],
      ['prohibido', 403, 'The key lacks the scope (writing needs «escritura»).'],
      ['peticion_invalida', 400, 'A field is missing or invalid: the message says which.'],
      ['no_encontrado', 404, 'It does not exist or it is not yours.'],
      ['conflicto', 409, 'It clashes with the current state; for example, the document has no text yet.'],
      ['demasiado_grande', 413, 'This endpoint takes files up to 95 MB; for more, the SDK uploads in parts.'],
      ['cuota_superada · requiere_pro', 402, 'A quota of the plan is used up.'],
      ['limite_de_ritmo', 429, 'Too many requests: wait the seconds in Retry-After.'],
      ['proveedor_fallo', 502, 'An AI provider failed: try again.'],
    ],
    ritmo: 'Rate limits and quotas are those of your plan, the same as in the app.',
    idem: 'To retry without duplicating, send an Idempotency-Key header when uploading and citing: with the same key, for 24 hours, you get the same resource back.',
  },
  anclas: {
    rubrica: 'Where every citation comes from',
    parrafos: [
      'When it reads a document, Scholaris stores an anchor for every passage: the physical page and the printed folio you see on paper, the second of an audio or a video, the slide, the section and paragraph of a web page. That is the «ancla» field.',
      'The «cita» and the «localizador» are written from that anchor, never from what a model says; the «enlace» opens the reader at that same page or second. If a passage is not in your library, the API will not cite it.',
    ],
  },
  copiar: 'Copy',
  copiado: 'Copied',
  pie: 'Scholaris · a library, read and citable',
};

export const TEXTOS: Record<Lengua, TextosGuia> = { es: ES, en: EN };
