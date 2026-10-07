import type { Pagina } from './tipos';
import { estante } from '../../bocetos/dibujos/estante';
import { videoMd } from '../../portada/video';
import { ORIGEN } from '../origen';

export const indice: Pagina = {
  clave: 'indice',
  rutas: { es: '/saber', en: '/en/knowledge' },
  tipo: 'CollectionPage',
  boceto: estante,
  es: {
    titulo: 'Todo lo que hay que saber de Scholaris',
    corto: 'Saber',
    descripcion: 'Qué lee Scholaris, cómo encuentra y cita, qué formato guarda, qué hace con tus datos, cuánto cuesta y cómo lo usa un agente. Más detallado que la portada y escrito para leerlo despacio.',
    md: `## Para qué existe esta parte

La [portada](/acerca) cuenta por qué existe Scholaris. Estas hojas cuentan cómo funciona, con los datos concretos: los formatos que entran, de dónde sale cada número de página, qué proveedor lee qué, cuánto tarda y cuánto cuesta lo que hemos medido, y lo que todavía no hace. Si algo de lo que pone aquí no coincide con lo que ves en la aplicación, manda la aplicación y esta página está equivocada: escríbenos y la corregimos.

Cada hoja tiene su gemelo en Markdown (la misma dirección terminada en \`.md\`), y hay un índice para máquinas en [/llms.txt](/llms.txt) y el texto entero de todas las hojas en [/llms-full.txt](/llms-full.txt). Si eres un agente, empieza por la [hoja para agentes](/agentes).

## Las hojas {#hojas}

<!-- hojas -->

## La demostración en vídeo {#video}

${videoMd('es', ORIGEN, '/acerca')}

## Scholaris en tres frases

- Lee lo que le das (PDF digitales y escaneados, fotos de páginas, EPUB, Word, presentaciones, hojas de cálculo, audio, vídeo, webs y YouTube) y guarda de cada pasaje un ancla: la página impresa, el segundo, la diapositiva o el párrafo.
- Cuando buscas o preguntas, te devuelve pasajes con su cita lista para pegar, y cada cita se escribe desde el ancla guardada, nunca desde lo que diga un modelo.
- No escribe por ti ni decide qué autor tiene razón: señala el sitio y se aparta.

## Quién lo hace

Scholaris lo hace [José Luis Saorín Ferrer](https://joseluissaorin.com), filólogo y programador, en Santa Cruz de Tenerife. El correo es [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
  en: {
    titulo: 'Everything worth knowing about Scholaris',
    corto: 'Knowledge',
    descripcion: 'What Scholaris reads, how it finds and cites, what format it stores, what it does with your data, what it costs and how an agent uses it. More detailed than the front page, and written to be read slowly.',
    md: `## What this part is for

The [front page](/en) says why Scholaris exists. These pages say how it works, with the specifics: which formats go in, where each page number comes from, which provider reads what, how long the things we measured take and what they cost, and what it does not do yet. If anything here disagrees with what you see in the app, the app is right and this page is wrong: write to us and we will fix it.

Every page has a Markdown twin (the same address ending in \`.md\`). There is an index for machines at [/llms.txt](/llms.txt) and the full text of every page at [/llms-full.txt](/llms-full.txt). If you are an agent, start with the [page for agents](/en/agents).

## The pages {#hojas}

<!-- hojas -->

## The demo video {#video}

${videoMd('en', ORIGEN, '/en')}

## Scholaris in three sentences

- It reads what you give it (digital and scanned PDFs, photos of pages, EPUB, Word, slides, spreadsheets, audio, video, web pages and YouTube) and stores an anchor for every passage: the printed page, the second, the slide or the paragraph.
- When you search or ask, it gives you passages with a citation ready to paste, and every citation is written from the stored anchor, never from what a model says.
- It does not write for you or decide which author is right: it points to the place and steps aside.

## Who makes it

Scholaris is made by [José Luis Saorín Ferrer](https://joseluissaorin.com), philologist and programmer, in Santa Cruz de Tenerife. Write to [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).
`,
  },
};
