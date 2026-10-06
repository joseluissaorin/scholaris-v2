import type { Pagina } from './tipos';
import { escuadra } from '../../bocetos/dibujos/escuadra';

const REPO = 'https://github.com/joseluissaorin/scholaris-v2';

export const local: Pagina = {
  clave: 'local',
  rutas: { es: '/saber/version-local', en: '/en/knowledge/self-hosting' },
  boceto: escuadra,
  es: {
    titulo: 'Scholaris en tu ordenador o en tu propia cuenta de Cloudflare',
    corto: 'Versión local',
    descripcion: 'La misma aplicación con SQLite y tu disco: en Node, en Docker, como ejecutable de escritorio o desplegada en tu cuenta de Cloudflare. Qué se queda en tu máquina y cómo funciona sin conexión.',
    md: `## Cuatro maneras

La instancia de [scholaris.joseluissaorin.com](/acerca) es la versión alojada, la que se paga con el plan Pro. El mismo código funciona también en tu ordenador:

| Cómo | Qué es | Dónde quedan tus datos |
| --- | --- | --- |
| Node | La misma API sobre Node, SQLite (con sqlite-vec para los vectores) y el disco, con una cola que se reanuda si se corta; escucha en el puerto 8790 | La carpeta que elijas |
| Docker | Lo mismo en un contenedor con ffmpeg; una variante lo monta sin conexión con sus modelos (Ollama, EmbeddingGemma 2 y Whisper), con o sin GPU NVIDIA | Un volumen de Docker |
| Escritorio | Un solo ejecutable (Bun) para macOS, Windows y Linux, con la web dentro, que abre el navegador al arrancar | ~/Scholaris |
| Tu cuenta de Cloudflare | Un guion crea la base de datos, el almacenamiento, el índice de vectores y la cola, y despliega el Worker (necesita Workers de pago) | Tu cuenta |

La versión local no tiene cuotas: el plan «local» no limita documentos, páginas ni búsquedas, y admite ficheros de hasta 16 GB. Puede tener un solo usuario, varios sin cuenta externa o usar Clerk para iniciar sesión.

## Código abierto

El código se publicará con licencia **EUPL-1.2** en [${REPO.replace('https://', '')}](${REPO}). Mientras se termina de revisar, el repositorio es privado: no damos fecha. Las órdenes exactas de instalación estarán en su README, que manda sobre esta página. El SDK de Python ya tiene esa misma licencia.

## Qué se queda en tu máquina y qué no

En la versión local, **tus ficheros, tu biblioteca, los vectores y el índice viven en tu disco**. La inteligencia se elige:

- **Con tus claves** (Gemini; OpenRouter, TypeSafe y Workers AI opcionales): lo más rápido y lo más fiel. Las páginas, el audio y los pasajes van a esos proveedores, con sus condiciones.
- **Sin conexión** (\`SCHOLARIS_SIN_CONEXION=1\`): ninguna clave de nube. Todo corre en tu máquina o en tu red y nada sale a internet; una guardia de red bloquea y anota cualquier intento, y una prueba de punta a punta lo comprueba.

| Pieza | Sin conexión | Con un proveedor en la nube |
| --- | --- | --- |
| Leer páginas (escaneados, fotos, diapositivas) | Un modelo de visión propio: Qwen3-VL 8B Instruct en Ollama, llama.cpp o vLLM | Gemini, OpenRouter (Mistral OCR) o Workers AI |
| Vectores | EmbeddingGemma 2 (texto, imagen, audio y vídeo, 768 dimensiones), en un servidor propio o en InferBox | Gemini Embedding 2 |
| Reordenar | bge-reranker-v2-m3 | Jev (TypeSafe) o Workers AI |
| Juzgar citas y redactar | El mismo modelo de visión, con probabilidades de los logprobs | Jev, Gemini u OpenRouter |
| Transcribir | Whisper large-v3-turbo (whisper.cpp) o Parakeet en InferBox | Gemini Transcribe o Whisper en Workers AI |
| Fichas bibliográficas | Solo lo que dice el documento (los catálogos en línea se abren con \`SCHOLARIS_CATALOGOS=1\`) | Crossref, OpenAlex, Open Library, Wikidata |

Lo que cuesta, medido en un Mac con M4 Max: una página escaneada del siglo XVIII tarda unos 26 s (la nube lee el libro entero en 13-20 s), con un CER de 0,06 en la página transcrita a mano frente a 0,006 con Gemini; 19 minutos de audio quedan listos en 2 min 34 s; la búsqueda da 0,804 de nDCG@10 frente a 0,899; y las citas que acepta son todas correctas y ninguna inventada, aunque deja sin cita más afirmaciones que la nube (61,5 % de exhaustividad frente a 100 %). Solo con CPU, leer escaneados se mide en minutos por página. El informe completo, con cómo reproducirlo, está en el repositorio (\`packages/proveedores/SIN-CONEXION.md\`), y el Docker de todo junto en \`deploy/docker/compose.sin-conexion.yml\`.

Además, **abrir y buscar un .spdf ya leído** funciona sin nada de lo anterior, con el SDK de Python (ver [El formato SPDF](/saber/spdf)).

## Lo mismo por fuera

La versión local habla la misma API (v1 y v2) y el mismo MCP que la nube, así que el SDK de Python, los ejemplos de la [guía de la API](/api) y los agentes funcionan igual apuntando a \`http://localhost:8790\`.
`,
  },
  en: {
    titulo: 'Scholaris on your computer, or in your own Cloudflare account',
    corto: 'Self-hosting',
    descripcion: 'The same app with SQLite and your disk: on Node, in Docker, as a desktop executable or deployed to your Cloudflare account. What stays on your machine and how it works offline.',
    md: `## Four ways

The instance at [scholaris.joseluissaorin.com](/en) is the hosted version, the one paid for with the Pro plan. The same code also runs on your computer:

| How | What it is | Where your data lives |
| --- | --- | --- |
| Node | The same API on Node, SQLite (with sqlite-vec for vectors) and the disk, with a queue that resumes if interrupted; listens on port 8790 | The folder you choose |
| Docker | The same in a container with ffmpeg; a variant runs it offline with its models (Ollama, EmbeddingGemma 2 and Whisper), with or without an NVIDIA GPU | A Docker volume |
| Desktop | A single executable (Bun) for macOS, Windows and Linux, with the web app inside, that opens the browser on start | ~/Scholaris |
| Your Cloudflare account | A script creates the database, storage, vector index and queue, and deploys the Worker (needs paid Workers) | Your account |

The home version has no quotas: the "local" plan does not limit documents, pages or searches, and takes files up to 16 GB. It can have a single user, several without an external account, or use Clerk to sign in.

## Open source

The code will be published under the **EUPL-1.2** at [${REPO.replace('https://', '')}](${REPO}). While the review is finished the repository is private: we are not giving a date. The exact installation commands will be in its README, which takes precedence over this page. The Python SDK already carries the same licence.

## What stays on your machine and what does not

In the home version, **your files, your library, the vectors and the index live on your disk**. You choose where the intelligence runs:

- **With your keys** (Gemini; OpenRouter, TypeSafe and Workers AI optional): the fastest and most faithful. Pages, audio and passages go to those providers, under their terms.
- **Offline** (\`SCHOLARIS_SIN_CONEXION=1\`): no cloud key at all. Everything runs on your machine or your network and nothing goes out to the internet; a network guard blocks and logs any attempt, and an end-to-end test checks it.

| Piece | Offline | With a cloud provider |
| --- | --- | --- |
| Reading pages (scans, photos, slides) | Your own vision model: Qwen3-VL 8B Instruct on Ollama, llama.cpp or vLLM | Gemini, OpenRouter (Mistral OCR) or Workers AI |
| Vectors | EmbeddingGemma 2 (text, image, audio and video, 768 dimensions), on its own server or on InferBox | Gemini Embedding 2 |
| Reranking | bge-reranker-v2-m3 | Jev (TypeSafe) or Workers AI |
| Judging citations and drafting | The same vision model, with probabilities from logprobs | Jev, Gemini or OpenRouter |
| Transcribing | Whisper large-v3-turbo (whisper.cpp) or Parakeet on InferBox | Gemini Transcribe or Whisper on Workers AI |
| Bibliographic records | Only what the document says (online catalogues open with \`SCHOLARIS_CATALOGOS=1\`) | Crossref, OpenAlex, Open Library, Wikidata |

What it costs, measured on an M4 Max Mac: an eighteenth-century scanned page takes about 26 s (the cloud reads the whole book in 13-20 s), with a CER of 0.06 on the hand-transcribed page against 0.006 with Gemini; 19 minutes of audio are ready in 2 min 34 s; search scores 0.804 nDCG@10 against 0.899; and every citation it accepts is correct and none is invented, though it leaves more claims without a citation than the cloud does (61.5 % recall against 100 %). On CPU alone, reading scans takes minutes per page. The full report, with how to reproduce it, is in the repository (\`packages/proveedores/SIN-CONEXION.md\`), and the all-in-one Docker setup in \`deploy/docker/compose.sin-conexion.yml\`.

On top of that, **opening and searching an .spdf that has already been read** works with none of the above, through the Python SDK (see [The SPDF format](/en/knowledge/spdf)).

## The same from outside

The home version speaks the same API (v1 and v2) and the same MCP as the cloud, so the Python SDK, the examples in the [API guide](/en/api) and agents work the same pointed at \`http://localhost:8790\`.
`,
  },
};
