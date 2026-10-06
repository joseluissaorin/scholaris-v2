import type { Pagina } from './tipos';
import { sobre } from '../../bocetos/dibujos/sobre';

export const privacidad: Pagina = {
  clave: 'privacidad',
  rutas: { es: '/saber/privacidad', en: '/en/knowledge/privacy' },
  boceto: sobre,
  es: {
    titulo: 'Qué pasa con tus datos, proveedor a proveedor',
    corto: 'Privacidad',
    descripcion: 'Dónde se guardan tus documentos, qué proveedor de IA lee qué, qué se manda a las bases bibliográficas abiertas, cómo se cifran tus claves y qué se borra cuando borras.',
    md: `## Lo principal

Tus documentos son tuyos. No entrenamos modelos con ellos. Para leerlos, transcribirlos y buscar en ellos, Scholaris manda páginas, audio y consultas a proveedores de IA, y esta hoja dice cuáles, para qué y qué se guarda en cada sitio. Si trabajas con material que no debe salir de tu ordenador, la [versión local](/saber/version-local) guarda todo en tu disco, aunque sigue necesitando un proveedor para leer páginas.

No hay analítica de terceros ni anuncios en la web. Las únicas cookies son las de la sesión (Clerk) y una que recuerda que estás en la demostración.

## Dónde se guarda cada cosa

Todo vive en Cloudflare, en la cuenta de Scholaris:

| Qué | Dónde |
| --- | --- |
| Tu cuenta, tus claves de API (solo su huella), ajustes, uso, invitaciones y registro de accesos | D1, la base de datos de Cloudflare |
| Los originales y las imágenes de las páginas | R2, el almacenamiento de objetos de Cloudflare, bajo una carpeta tuya |
| Tu biblioteca leída (texto, anclas, fichas, índice) | Un Durable Object propio, con su base SQLite, solo para ti |
| Los vectores | Cloudflare Vectorize, en un espacio de nombres propio |
| La sesión | Clerk, que gestiona el inicio de sesión (correo y nombre) y los pagos |

## Qué lee cada proveedor

| Proveedor | Qué recibe | Para qué |
| --- | --- | --- |
| Google Gemini (API de pago) | Imágenes de páginas, audio, la dirección de los vídeos de YouTube, pasajes y consultas | Leer páginas (Gemini 3.8 Flash y 3.5 Flash-Lite), transcribir (Gemini Transcribe), vectores (Gemini Embedding 2), redactar respuestas y extraer entidades |
| Cloudflare Workers AI | Audio, imágenes de páginas fáciles y texto | Transcribir con Whisper, lector de reserva y del modo económico, vectores y reordenador de reserva |
| OpenRouter (con Mistral OCR) | Páginas que los lectores anteriores no pudieron leer; texto para redactar si Gemini falla | Lector y redactor de reserva |
| TypeSafe (Jev) | Pares de consulta y pasaje, afirmaciones y pasajes, candidatos de número de página | Reordenar resultados, juzgar citas y decidir folios dudosos |

Estos proveedores reciben lo justo para cada tarea y se usan con sus API de pago o empresariales. Sus condiciones (no las nuestras) dicen cuánto tiempo conservan los datos y si los usan para algo más; por ejemplo, las condiciones de pago de la API de Gemini excluyen el uso de las peticiones para mejorar sus productos, aunque permiten guardarlas un tiempo limitado para detectar abusos. Si eso no te basta, usa la versión local con tus propias claves o, en su [modo sin conexión](/saber/version-local), sin ningún proveedor: los modelos corren en tu máquina o en tu red y ninguna petición sale a internet.

## Qué se manda a las bases bibliográficas abiertas

Para completar y contrastar la ficha de cada documento, Scholaris pregunta a Crossref, OpenAlex, Open Library, Wikidata, Wikipedia, arXiv, DataCite y, como último recurso, Google Books. Lo que se manda es **el título, los autores, el ISBN o el DOI**, nunca el texto. Para enlazar entidades se manda a Wikidata el nombre de cada entidad. Las peticiones se identifican como «Scholaris/2» con la dirección de la web. En el modo sin conexión de la versión local estas consultas van apagadas, salvo que las abras tú.

## Tus propias claves

Puedes poner tus claves de Gemini, OpenRouter, TypeSafe, Mistral, Voyage, Cohere, Jina o ZeroEntropy para que tu biblioteca use tus cuentas. Se guardan cifradas con AES-256-GCM, con una clave derivada para cada usuario, y solo se usan si lo activas.

## Borrar

- **Borrar un documento** borra también todo lo derivado: páginas, vectores, imágenes.
- **Borrar el historial** de búsquedas, o pausar que se guarde.
- **Exportar todo** en un ZIP antes de irte.
- **Borrar la cuenta:** se borran tus claves, ajustes, uso, invitaciones, notificaciones y enlaces compartidos; se vacía tu biblioteca; los vectores y los ficheros se purgan en segundo plano. Queda una fila con tu identificador marcada como borrada, sin correo ni nombre, para que no se pueda reutilizar. La excepción: si alguien copió un documento de una biblioteca que le compartiste, su copia sigue siendo suya.

## Contacto

Para cualquier cosa sobre tus datos, [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
  en: {
    titulo: 'What happens to your data, provider by provider',
    corto: 'Privacy',
    descripcion: 'Where your documents are stored, which AI provider reads what, what is sent to the open bibliographic databases, how your keys are encrypted and what is deleted when you delete.',
    md: `## The main thing

Your documents are yours. We do not train models on them. To read them, transcribe them and search them, Scholaris sends pages, audio and queries to AI providers, and this page says which ones, what for and what is stored where. If you work with material that must not leave your computer, the [home version](/en/knowledge/self-hosting) keeps everything on your disk, although it still needs a provider to read pages.

There are no third-party analytics and no ads on the site. The only cookies are the session ones (Clerk) and one that remembers you are in the demo.

## Where each thing is stored

Everything lives on Cloudflare, in Scholaris's account:

| What | Where |
| --- | --- |
| Your account, your API keys (hash only), settings, usage, invitations and access log | D1, Cloudflare's database |
| Originals and page images | R2, Cloudflare's object storage, under a folder of your own |
| Your read library (text, anchors, records, index) | A Durable Object of your own, with its SQLite database, just for you |
| Vectors | Cloudflare Vectorize, in a namespace of your own |
| The session | Clerk, which handles sign-in (email and name) and payments |

## What each provider reads

| Provider | What it receives | What for |
| --- | --- | --- |
| Google Gemini (paid API) | Page images, audio, the address of YouTube videos, passages and queries | Reading pages (Gemini 3.8 Flash and 3.5 Flash-Lite), transcribing (Gemini Transcribe), vectors (Gemini Embedding 2), drafting answers and extracting entities |
| Cloudflare Workers AI | Audio, images of easy pages and text | Transcribing with Whisper, fallback and economy reader, fallback vectors and reranker |
| OpenRouter (with Mistral OCR) | Pages the previous readers could not read; text to draft if Gemini fails | Fallback reader and writer |
| TypeSafe (Jev) | Query and passage pairs, claims and passages, page-number candidates | Reranking results, judging citations and settling doubtful folios |

These providers get just what each task needs and are used through their paid or business APIs. Their terms (not ours) say how long they keep data and whether they use it for anything else; for instance, the Gemini API's paid terms exclude using requests to improve their products, while allowing them to be kept for a limited time to detect abuse. If that is not enough for you, use the home version with your own keys or, in its [offline mode](/en/knowledge/self-hosting), with no provider at all: the models run on your machine or your network and no request goes out to the internet.

## What is sent to open bibliographic databases

To complete and check each document's record, Scholaris asks Crossref, OpenAlex, Open Library, Wikidata, Wikipedia, arXiv, DataCite and, as a last resort, Google Books. What is sent is **the title, the authors, the ISBN or the DOI**, never the text. To link entities, each entity's name is sent to Wikidata. Requests identify themselves as "Scholaris/2" with the site's address. In the offline mode of the home version these lookups are off unless you turn them on.

## Your own keys

You can add your own Gemini, OpenRouter, TypeSafe, Mistral, Voyage, Cohere, Jina or ZeroEntropy keys so your library uses your accounts. They are stored encrypted with AES-256-GCM, with a key derived per user, and are only used if you switch them on.

## Deleting

- **Deleting a document** also deletes everything derived from it: pages, vectors, images.
- **Deleting your search history**, or pausing it.
- **Exporting everything** as a ZIP before you leave.
- **Deleting your account:** your keys, settings, usage, invitations, notifications and shared links are deleted; your library is emptied; vectors and files are purged in the background. A row with your identifier remains, marked as deleted, with no email or name, so it cannot be reused. The exception: if someone copied a document from a library you shared with them, their copy remains theirs.

## Contact

For anything about your data, [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
};
