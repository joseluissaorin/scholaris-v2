import type { Pagina } from './tipos';
import { regla } from '../../bocetos/dibujos/regla';

export const planes: Pagina = {
  clave: 'planes',
  rutas: { es: '/saber/planes', en: '/en/knowledge/plans' },
  boceto: regla,
  es: {
    titulo: 'Planes, cupones y límites',
    corto: 'Planes',
    descripcion: 'Un plan gratuito para empezar, Pro para trabajar de verdad y la versión local sin cuotas. Cuánto cabe en cada uno, cómo se cuentan las páginas y los minutos, y cómo funcionan los cupones.',
    md: `## Los planes

| | Gratis | Pro | Versión local |
| --- | --- | --- | --- |
| Documentos | 25 | 5000 | sin límite |
| Páginas o minutos leídos al mes | 1500 | 60 000 | sin límite |
| Búsquedas al día | 100 | 5000 | sin límite |
| Autocitas al mes | 5 | 500 | sin límite |
| Almacenamiento | 1 GB | 100 GB | tu disco |
| Fichero más grande | 200 MB | 4 GB | 16 GB |
| Peticiones a la API por minuto | 120 | 600 | sin límite práctico |

El plan gratuito no caduca. El precio de Pro se ve en la aplicación (Ajustes), donde se contrata; los pagos los gestiona Clerk. La versión local es gratuita, pero pagas tú a los proveedores de IA que uses con tus claves.

## Cómo se cuenta

- Una página de un PDF, de un EPUB o de una foto cuenta como una página; un minuto de audio o de vídeo, como una página.
- Las cuotas mensuales se reinician el día 1 de cada mes y las diarias a medianoche, en hora UTC.
- Volver a subir un fichero idéntico no cuenta: se detecta por su huella y se devuelve el que ya había.

## El modo económico

Al llenar una biblioteca grande se puede elegir el modo económico: las páginas difíciles se leen por el lote de Gemini, a mitad de precio, y tardan horas en vez de segundos. En una comedia escaneada de 43 páginas, el coste bajó un 46 %.

## Cupones

Un cupón es un código con la forma \`SCHO-XXXX-XXXX\` que concede un plan durante unos días o para siempre. Se canjea en Ajustes. Un cupón nunca baja de plan una cuenta; si ya tienes ese plan por tiempo limitado, lo alarga. Para evitar que se adivinen, se admiten diez intentos fallidos por hora, y Scholaris solo guarda una huella cifrada de cada código.

Si crees que tu grupo o tu proyecto debería tener uno, escribe a [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).

## Probar sin cuenta

La [demostración](/?demostracion) abre la aplicación con una biblioteca de ejemplo que vive en tu navegador: no se sube nada ni hace falta registrarse.
`,
  },
  en: {
    titulo: 'Plans, coupons and limits',
    corto: 'Plans',
    descripcion: 'A free plan to start, Pro for real work, and the home version with no quotas. How much fits in each, how pages and minutes are counted, and how coupons work.',
    md: `## The plans

| | Free | Pro | Home version |
| --- | --- | --- | --- |
| Documents | 25 | 5,000 | unlimited |
| Pages or minutes read per month | 1,500 | 60,000 | unlimited |
| Searches per day | 100 | 5,000 | unlimited |
| Autocites per month | 5 | 500 | unlimited |
| Storage | 1 GB | 100 GB | your disk |
| Largest file | 200 MB | 4 GB | 16 GB |
| API requests per minute | 120 | 600 | no practical limit |

The free plan does not expire. The Pro price is shown in the app (Ajustes, Settings), where you subscribe; payments are handled by Clerk. The home version is free, but you pay the AI providers you use with your own keys.

## How it is counted

- A page of a PDF, an EPUB or a photo counts as one page; a minute of audio or video counts as one page.
- Monthly quotas reset on the 1st of each month and daily ones at midnight, UTC.
- Uploading an identical file again does not count: it is recognised by its hash and the existing one is returned.

## Economy mode

When filling a large library you can choose economy mode: hard pages are read through Gemini's batch API at half price, and take hours instead of seconds. On a 43-page scanned play, the cost fell by 46 %.

## Coupons

A coupon is a code shaped like \`SCHO-XXXX-XXXX\` that grants a plan for a number of days or for good. Redeem it in Ajustes (Settings). A coupon never downgrades an account; if you already have that plan for a limited time, it extends it. To stop guessing, ten failed attempts per hour are allowed, and Scholaris only stores an encrypted hash of each code.

If you think your class or your project should have one, write to [jl@joseluissaorin.com](mailto:jl@joseluissaorin.com).

## Trying it without an account

The [demo](/?demostracion) opens the app with a sample library that lives in your browser: nothing is uploaded and no sign-up is needed.
`,
  },
};
