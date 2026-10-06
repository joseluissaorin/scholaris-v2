import type { Pagina } from './tipos';
import { transportador } from '../../bocetos/dibujos/transportador';

export const rendimiento: Pagina = {
  clave: 'rendimiento',
  rutas: { es: '/saber/rendimiento', en: '/en/knowledge/performance' },
  boceto: transportador,
  es: {
    titulo: 'Lo que hemos medido, con sus condiciones',
    corto: 'Rendimiento',
    descripcion: 'Tiempos y costes de lectura, exactitud del folio, calidad de búsqueda, citas inventadas y latencias, tal como salieron en el banco de pruebas del 6 de octubre de 2026, con lo que esas cifras no dicen.',
    md: `## Las condiciones

Todo se midió el **6 de octubre de 2026**, desde un Mac en Tenerife, por la red de casa, contra las API en la nube (Gemini 3.5 Flash-Lite y 3.8 Flash, Gemini Transcribe, Gemini Embedding 2 a 1536 dimensiones, Jev, Crossref y OpenAlex) y sin GPU local. **No se midió en Cloudflare**, que debería ser más estable; tampoco la latencia de «preguntar». Las cifras en dólares son el coste de los proveedores, no un precio.

## Leer un documento

| Documento | Antes (primera Scholaris) | Ahora | Coste |
| --- | --- | --- | --- |
| Entrevista en vídeo, 54 min | 3 h 39 min | 45 s (30 s sin atribuir hablantes) | 0,41 $ |
| Entrevista en vídeo (Cortázar), 2 h 2 min | las de 83 min tardaban 5 h 43 min | 70 s | 0,94 $ |
| *The Discarded Image*, 245 p., con un OCR antiguo | sin registro | mediana de 85 s en 16 ejecuciones (de 37 a 175 s) | 0,64 $ |
| *El casamiento en la muerte*, 43 p. escaneadas, siglo XVII | sin registro | 27 s | 0,20 $ |
| *Attention Is All You Need*, 15 p. digitales | sin registro | 12 s | 0,04 $ |
| *El perseguidor*, 37 p. digitales | sin registro | 15 s | 0,04 $ |

Los tiempos son de principio a fin, con la conversión incluida. Las primeras páginas se pueden buscar antes: en menos de una décima de segundo en un PDF digital, en unos 3 a 6 segundos en un escaneado y en unos 3 a 6 segundos en un vídeo. La lentitud de algunas ejecuciones del libro de 245 páginas vino de la API o de la red, no del código. En los medios muy cortos (un minuto) el documento tarda ahora algo más en quedar listo que antes: de 5 a 6 segundos se pasó a entre 8 y 10.

El **modo económico** bajó el coste del *Casamiento* de 0,206 $ a 0,111 $ (un 46 % menos), a cambio de que tardara 6,9 minutos en lugar de 19,7 segundos. Transcribir cuesta unos 0,005 $ por minuto.

## Leer bien

- **Errores de carácter (CER)** en teatro del siglo XVII: 0,007 con Gemini 3.8 Flash, frente a 0,073 del lector de la primera Scholaris. Medido sobre una sola página transcrita a mano.
- ***The Discarded Image***: la primera Scholaris dejaba 195 páginas vacías (74 000 caracteres en total); ahora salen 358 000 caracteres y 7 páginas vacías.
- **Folio impreso:** 64 de 64 exactos en las páginas comprobadas a ojo (45 de 45 con el número a la vista). En *The Discarded Image*, 229 folios leídos coinciden con las etiquetas del PDF en 229 de 232 páginas.
- **Hablantes:** atribución correcta en 20 de 21 turnos y en 23 de 23 en dos entrevistas (25 turnos al azar en cada una, anotados leyendo el texto).
- **Fichas:** 55 de 55 comprobaciones correctas en 9 documentos tras contrastar con las fuentes externas (antes, 30 de 55).

## Buscar bien

Sobre 183 consultas y 8879 juicios de relevancia. Los juicios son «de plata»: los hicieron dos modelos y un árbitro, no personas; coincidieron entre sí en un 82 % exacto y en un 99 % con un punto de margen, y de 30 revisados a mano, el autor estuvo de acuerdo con 29.

| Sistema | nDCG@10 | Recall@20 | MRR |
| --- | --- | --- | --- |
| Primera Scholaris | 0,695 | 0,618 | 0,925 |
| Solo léxica | 0,564 | | |
| Solo visual | 0,199 | | |
| Solo semántica | 0,804 | 0,860 | 0,931 |
| Híbrida sin reordenar | 0,818 | 0,884 | 0,942 |
| **La de ahora** (híbrida y reordenada) | **0,889** | **0,904** | **0,979** |

Por tipo de consulta (nDCG@10 del sistema actual): entre lenguas 0,897; literales 0,880; audio y vídeo 0,882; grafía antigua 0,814; visuales 0,950 (solo 4 consultas).

**Grafía antigua:** en *El casamiento en la muerte* de Lope, con 30 consultas, la exhaustividad media por consulta pasó del 32 % al 100 % con la capa de grafía modernizada; en documentos modernos, 250 de 250 búsquedas devolvieron exactamente lo mismo.

**Latencia:** mediana de unos 650 ms desde casa, sin cachés (unos 360 ms el vector de la consulta y unos 300 ms el juez); sin reordenar, unos 350 ms con nDCG 0,818. En las ejecuciones medidas, la mediana y el percentil 95 fueron 687 y 856 ms.

## Citar bien

Sobre 41 afirmaciones (30 respaldadas y 11 que no lo estaban): **precisión del 95,1 %, exhaustividad del 96,7 %, cero citas inventadas**, cero citas en afirmaciones sin respaldo y el veredicto de verificación, correcto en el 100 %. Cada afirmación tardó 998 ms y costó 0,0054 $.

## Lo que estas cifras no dicen

- Son de una red doméstica, no de Cloudflare, y no incluyen la latencia de «preguntar».
- Quedan 1594 juicios de relevancia con árbitro o discrepancia pendientes de revisión humana.
- El CER se calculó sobre una sola página.
- El banco es pequeño y lo hizo quien hace Scholaris. Si quieres repetirlo con tus documentos, escríbenos.
`,
  },
  en: {
    titulo: 'What we measured, and under what conditions',
    corto: 'Performance',
    descripcion: 'Reading times and costs, folio accuracy, search quality, invented citations and latency, as they came out of the benchmark of 6 October 2026, and what those figures do not say.',
    md: `## Conditions

Everything was measured on **6 October 2026**, from a Mac in Tenerife over a home connection, against the cloud APIs (Gemini 3.5 Flash-Lite and 3.8 Flash, Gemini Transcribe, Gemini Embedding 2 at 1536 dimensions, Jev, Crossref and OpenAlex) with no local GPU. **It was not measured on Cloudflare**, which should be more stable; nor was the latency of "ask". Dollar figures are provider costs, not prices.

## Reading a document

| Document | Before (first Scholaris) | Now | Cost |
| --- | --- | --- | --- |
| Video interview, 54 min | 3 h 39 min | 45 s (30 s without speaker attribution) | $0.41 |
| Video interview (Cortázar), 2 h 2 min | the 83-min ones took 5 h 43 min | 70 s | $0.94 |
| *The Discarded Image*, 245 pp., with old OCR | not recorded | median 85 s over 16 runs (37 to 175 s) | $0.64 |
| *El casamiento en la muerte*, 43 scanned pp., 17th century | not recorded | 27 s | $0.20 |
| *Attention Is All You Need*, 15 digital pp. | not recorded | 12 s | $0.04 |
| *El perseguidor*, 37 digital pp. | not recorded | 15 s | $0.04 |

Times are end to end, conversion included. The first pages are searchable earlier: in under a tenth of a second for a digital PDF, in about 3 to 6 seconds for a scan and in about 3 to 6 seconds for a video. The slow runs of the 245-page book came from the API or the network, not the code. Very short media (one minute) now take a little longer to be ready than before: from 5 to 6 seconds it went to between 8 and 10.

**Economy mode** cut the cost of the *Casamiento* from $0.206 to $0.111 (46 % less), in exchange for taking 6.9 minutes instead of 19.7 seconds. Transcription costs about $0.005 a minute.

## Reading well

- **Character error rate (CER)** on seventeenth-century drama: 0.007 with Gemini 3.8 Flash, against 0.073 for the first Scholaris's reader. Measured on a single hand-transcribed page.
- ***The Discarded Image***: the first Scholaris left 195 pages empty (74,000 characters in all); now there are 358,000 characters and 7 empty pages.
- **Printed folio:** 64 of 64 exact on the pages checked by eye (45 of 45 with the number visible). In *The Discarded Image*, 229 folios read agree with the PDF's labels on 229 of 232 pages.
- **Speakers:** attribution right in 20 of 21 turns and in 23 of 23 in two interviews (25 random turns each, annotated by reading the text).
- **Records:** 55 of 55 checks right across 9 documents after checking against external sources (30 of 55 before).

## Searching well

Over 183 queries and 8,879 relevance judgments. The judgments are "silver": two models and an arbiter made them, not people; they agreed 82 % exactly and 99 % within one point, and of 30 checked by hand, the author agreed with 29.

| System | nDCG@10 | Recall@20 | MRR |
| --- | --- | --- | --- |
| First Scholaris | 0.695 | 0.618 | 0.925 |
| Lexical only | 0.564 | | |
| Visual only | 0.199 | | |
| Semantic only | 0.804 | 0.860 | 0.931 |
| Hybrid, not reranked | 0.818 | 0.884 | 0.942 |
| **Current** (hybrid, reranked) | **0.889** | **0.904** | **0.979** |

By query type (nDCG@10 of the current system): cross-language 0.897; literal 0.880; audio and video 0.882; old spelling 0.814; visual 0.950 (only 4 queries).

**Old spelling:** on Lope de Vega's *El casamiento en la muerte*, with 30 queries, average recall per query went from 32 % to 100 % with the modernised-spelling layer; on modern documents, 250 of 250 searches returned exactly the same.

**Latency:** median of about 650 ms from home, no caches (about 360 ms for the query vector and about 300 ms for the judge); without reranking, about 350 ms with nDCG 0.818. In the measured runs, median and 95th percentile were 687 and 856 ms.

## Citing well

Over 41 claims (30 supported and 11 not): **95.1 % precision, 96.7 % recall, zero invented citations**, zero citations on unsupported claims and the verification verdict right 100 % of the time. Each claim took 998 ms and cost $0.0054.

## What these figures do not say

- They come from a home connection, not Cloudflare, and do not include the latency of "ask".
- 1,594 relevance judgments with an arbiter or a disagreement are still awaiting human review.
- The CER was computed on a single page.
- The benchmark is small and was made by the person who makes Scholaris. If you want to repeat it with your documents, write to us.
`,
  },
};
