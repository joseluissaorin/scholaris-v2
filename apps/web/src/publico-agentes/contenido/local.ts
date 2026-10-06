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
    descripcion: 'La misma aplicación con SQLite y tu disco: en Node, en Docker, como ejecutable de escritorio o desplegada en tu cuenta de Cloudflare. Qué se queda en tu máquina y qué sigue necesitando la nube.',
    md: `## Cuatro maneras

La instancia de [scholaris.joseluissaorin.com](/acerca) es la versión alojada, la que se paga con el plan Pro. El mismo código funciona también en tu ordenador:

| Cómo | Qué es | Dónde quedan tus datos |
| --- | --- | --- |
| Node | La misma API sobre Node, SQLite (con sqlite-vec para los vectores) y el disco, con una cola que se reanuda si se corta; escucha en el puerto 8790 | La carpeta que elijas |
| Docker | Lo mismo en un contenedor con ffmpeg; una variante añade InferBox, un servidor de modelos con GPU NVIDIA | Un volumen de Docker |
| Escritorio | Un solo ejecutable (Bun) para macOS, Windows y Linux, con la web dentro, que abre el navegador al arrancar | ~/Scholaris |
| Tu cuenta de Cloudflare | Un guion crea la base de datos, el almacenamiento, el índice de vectores y la cola, y despliega el Worker (necesita Workers de pago) | Tu cuenta |

La versión local no tiene cuotas: el plan «local» no limita documentos, páginas ni búsquedas, y admite ficheros de hasta 16 GB. Puede tener un solo usuario, varios sin cuenta externa o usar Clerk para iniciar sesión.

## Código abierto

El código se publicará con licencia **EUPL-1.2** en [${REPO.replace('https://', '')}](${REPO}). Mientras se termina de revisar, el repositorio es privado: no damos fecha. Las órdenes exactas de instalación estarán en su README, que manda sobre esta página. El SDK de Python ya tiene esa misma licencia.

## Qué se queda en tu máquina y qué no

En la versión local, **tus ficheros, tu biblioteca, los vectores y el índice viven en tu disco**. Pero Scholaris no funciona del todo sin conexión: para leer páginas necesita al menos un lector en la nube.

| Pieza | Sin conexión | Con un proveedor en la nube |
| --- | --- | --- |
| Leer páginas (escaneados, fotos, diapositivas) | No hay lector local todavía | Gemini, OpenRouter (Mistral OCR) o Workers AI |
| Vectores | InferBox (Qwen3-VL Embedding, 2048 dimensiones) | Gemini Embedding 2 |
| Reordenar y juzgar | InferBox | Jev (TypeSafe) o Workers AI |
| Transcribir | InferBox | Gemini Transcribe o Whisper en Workers AI |
| Redactar respuestas | InferBox | Gemini u OpenRouter |
| Buscar y citar sobre lo ya leído | Sí: la búsqueda por palabras siempre; la de sentido, con InferBox | |

La clave de Gemini es la única obligatoria en la práctica; las de OpenRouter y TypeSafe, Workers AI y OpenAlex son opcionales. Lo que sí funciona del todo sin conexión es **abrir y buscar un .spdf ya leído** con el SDK de Python (ver [El formato SPDF](/saber/spdf)).

## Lo mismo por fuera

La versión local habla la misma API (v1 y v2) y el mismo MCP que la nube, así que el SDK de Python, los ejemplos de la [guía de la API](/api) y los agentes funcionan igual apuntando a \`http://localhost:8790\`.
`,
  },
  en: {
    titulo: 'Scholaris on your computer, or in your own Cloudflare account',
    corto: 'Self-hosting',
    descripcion: 'The same app with SQLite and your disk: on Node, in Docker, as a desktop executable or deployed to your Cloudflare account. What stays on your machine and what still needs the cloud.',
    md: `## Four ways

The instance at [scholaris.joseluissaorin.com](/en) is the hosted version, the one paid for with the Pro plan. The same code also runs on your computer:

| How | What it is | Where your data lives |
| --- | --- | --- |
| Node | The same API on Node, SQLite (with sqlite-vec for vectors) and the disk, with a queue that resumes if interrupted; listens on port 8790 | The folder you choose |
| Docker | The same in a container with ffmpeg; a variant adds InferBox, a model server with an NVIDIA GPU | A Docker volume |
| Desktop | A single executable (Bun) for macOS, Windows and Linux, with the web app inside, that opens the browser on start | ~/Scholaris |
| Your Cloudflare account | A script creates the database, storage, vector index and queue, and deploys the Worker (needs paid Workers) | Your account |

The home version has no quotas: the "local" plan does not limit documents, pages or searches, and takes files up to 16 GB. It can have a single user, several without an external account, or use Clerk to sign in.

## Open source

The code will be published under the **EUPL-1.2** at [${REPO.replace('https://', '')}](${REPO}). While the review is finished the repository is private: we are not giving a date. The exact installation commands will be in its README, which takes precedence over this page. The Python SDK already carries the same licence.

## What stays on your machine and what does not

In the home version, **your files, your library, the vectors and the index live on your disk**. But Scholaris does not work fully offline: to read pages it needs at least one cloud reader.

| Piece | Offline | With a cloud provider |
| --- | --- | --- |
| Reading pages (scans, photos, slides) | No local reader yet | Gemini, OpenRouter (Mistral OCR) or Workers AI |
| Vectors | InferBox (Qwen3-VL Embedding, 2048 dimensions) | Gemini Embedding 2 |
| Reranking and judging | InferBox | Jev (TypeSafe) or Workers AI |
| Transcribing | InferBox | Gemini Transcribe or Whisper on Workers AI |
| Drafting answers | InferBox | Gemini or OpenRouter |
| Searching and citing what is already read | Yes: word search always; search by meaning, with InferBox | |

In practice the Gemini key is the only required one; OpenRouter, TypeSafe, Workers AI and OpenAlex are optional. What does work fully offline is **opening and searching an .spdf that has already been read** with the Python SDK (see [The SPDF format](/en/knowledge/spdf)).

## The same from outside

The home version speaks the same API (v1 and v2) and the same MCP as the cloud, so the Python SDK, the examples in the [API guide](/en/api) and agents work the same pointed at \`http://localhost:8790\`.
`,
  },
};
