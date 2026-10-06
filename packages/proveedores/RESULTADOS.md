# Resultados del banco de proveedores

Medido el 6 de octubre de 2026 con `npx tsx packages/proveedores/vivo/probar.ts`
desde un Mac en Tenerife (Node 26), con las claves reales. Las tablas en bruto
quedan en `vivo/resultados/*.md`. Precios de la API con clave, comprobados ese día.

## Lo que se decidió

| Puerto | Por defecto | Por qué |
|---|---|---|
| Lector | `gemini-3.8-flash`, una página por llamada, todas a la vez | CER 0,006 en teatro del XVII (la tubería antigua: 0,073); 43 páginas en 13-20 s |
| Lector rápido | `gemini-3.5-flash-lite`, una página por llamada | CER 0,021, 43 páginas en 6-7 s, 96 páginas digitales en 7 s; igual que Flash en PDF digital |
| Reservas del lector | OpenRouter (Mistral OCR), luego Workers AI `llama-4-scout` | Llama 4 Scout es el mejor lector de Workers AI (CER 0,058) |
| Embebedor | `gemini-embedding-2`, 1536 dims | Texto, imagen, PDF y audio en un espacio; 159 fragmentos/s |
| Redactor | «rapida» `gemini-3.5-flash-lite`, «alta» `gemini-3.8-flash` | Caché explícita del sistema largo: 9.667 de 9.698 tokens servidos de caché |
| Transcriptor | Whisper large-v3-turbo (Workers AI); `gemini-3.5-transcribe` si se piden hablantes | Whisper: 0,0005 $/min; Gemini: hablantes y palabras, 0,005 $/min |
| Reordenador y juez | Jev (`jev-latest` = jev-1.13.0) | 0,3-0,4 s por petición con todas las preguntas juntas |

## Lector: por qué una página por llamada

El modelo genera la salida en serie (unos 100-200 tokens por segundo, ~1.000
tokens por página de teatro). Un pliego de 8 páginas tarda 8 veces más que uno de
una, y además, con Flash-Lite, los pliegos grandes **desalinean páginas** (pliego
de 16: CER 0,754 y 0 de 14 folios bien; Flash 3.1-Lite a 8 páginas: CER 0,521).
Con una página por llamada y muchas llamadas a la vez, el libro entero tarda lo que
tarda la página más lenta.

### Libro entero en paralelo (lo que cuenta)

| doc | modelo | páginas | simultáneas | muro s | s/página | $/1000 p | calidad | folios bien |
|---|---|---|---|---|---|---|---|---|
| Casamiento (escaneado, s. XVII) | gemini-3.5-flash-lite | 43 | 43 | 6,3 | 0,146 | 2,43 | CER 0,023 | 26/32 |
| Casamiento | gemini-3.1-flash-lite | 43 | 43 | 6,0 | 0,139 | 1,45 | CER 0,023 | 27/31 |
| Casamiento | **gemini-3.8-flash** | 43 | 43 | 13,3 | 0,309 | 3,92 | **CER 0,006** | **30/31** |
| Discarded Image (digital) | gemini-3.5-flash-lite | 96 | 48 | 7,1 | 0,074 | 1,62 | F1 0,920 | 84/95 con folio |
| Discarded Image | gemini-3.8-flash | 96 | 48 | 17,2 | 0,179 | 2,75 | F1 0,921 | 86/95 con folio |
| Casamiento | gemini-3.5-flash-lite, pliegos de 4 | 43 | 11 | 16,2 | 0,378 | 2,18 | CER 0,053 | 28/31 |
| Casamiento | gemini-3.5-flash-lite, pliegos de 8 | 43 | 6 | 28,4 | 0,659 | 2,07 | CER 0,054 | 30/32 |
| Casamiento | gemini-3.8-flash, pliegos de 8 | 43 | 6 | 58,4 | 1,357 | 3,31 | CER 0,008 | 31/32 |

La tubería antigua (Gemma 3 27B gratis, una página por llamada, unas 8 a la vez, ~10 s
por página en reserva) tardaba del orden de 50-100 s en este libro y su CER en la
página de oro es **0,073** (confunde ſ con f: «fobre», «defvelas», «Nodigas»).
Con 3.8 Flash el mismo libro sale en 13 s con **11 veces menos errores**; con
Flash-Lite, en 6 s con 3 veces menos. Proyección a 300 páginas con 48-64 llamadas a
la vez: unos 60-100 s con Flash y 40 s con Flash-Lite, si la cuota lo permite.

**CER de oro**: transcripción hecha a mano de la página física 10 del *Casamiento*
(`vivo/oro/casamiento-p10.txt`, dos columnas de verso, ſ normalizada a s), sin
espacios ni mayúsculas. **F1**: palabras frente a la capa de texto del PDF digital
(incluye cabeceras; las páginas de figuras bajan la media). Folios: el impreso que
lee el modelo frente al esperado (físico menos 6 en el *Casamiento*).

### Matriz modelo × pliego (16 páginas, una configuración tras otra)

Latencias ruidosas: la misma llamada de una página osciló entre 4 y 90 s según la
carga del momento; la calidad sí es estable.

| doc | modelo | pliego | lat. media s | $/1000 p | CER oro | F1 capa | folios |
|---|---|---|---|---|---|---|---|
| casamiento | 3.5-flash-lite | 1 | 4,8 | 2,89 | 0,025 | | 13/16 |
| casamiento | 3.5-flash-lite | 4 | 33,5 | 2,66 | 0,055 | | 15/16 |
| casamiento | 3.5-flash-lite | 8 | 40,5 | 2,71 | 0,051 | | 15/16 |
| casamiento | 3.5-flash-lite | 16 | 53,1 | 2,80 | **0,754** | | **0/14** |
| casamiento | 3.1-flash-lite | 1 | 35,8 | 1,81 | 0,021 | | 15/16 |
| casamiento | 3.1-flash-lite | 4 | 34,4 | 1,65 | 0,022 | | 15/15 |
| casamiento | 3.1-flash-lite | 8 | 35,7 | 1,47 | **0,521** | | 15/15 |
| casamiento | 3.1-flash-lite | 16 | 50,8 | 1,48 | 0,016 | | 16/16 |
| casamiento | 3.8-flash | 1 | 91,9* | 4,79 | 0,006 | | 16/16 |
| casamiento | 3.8-flash | 4 | 81,0* | 4,26 | 0,006 | | 16/16 |
| casamiento | 3.8-flash | 8 | 90,2* | 4,17 | 0,006 | | 16/16 |
| casamiento | 3.8-flash | 16 | 118,0* | 4,16 | 0,007 | | 16/16 |
| discarded | 3.5-flash-lite | 1 / 4 / 8 / 16 | 18 / 14 / 16 / 19 | 1,5-1,2 | | 0,981 | 15-16/16 |
| discarded | 3.1-flash-lite | 1 / 4 / 8 / 16 | 20 / 15 / 16 / 21 | 1,0-0,7 | | 0,98 | 15-16/16 |
| discarded | 3.8-flash | 1 / 4 / 8 / 16 | 47* / 36 / 35 / 52 | 2,6-2,1 | | 0,981 | 16/16 |
| attention | 3.5-flash-lite | 1 / 4 / 8 | 30 / 29 / 27 | 2,9-2,3 | | 0,88 / 0,78 / 0,76 | 14/15 |
| attention | 3.1-flash-lite | 1 / 4 / 8 | 31 / 33 / 29 | 1,7-1,5 | | 0,87 / 0,94 / 0,90 | 14/15 |
| attention | 3.8-flash | 1 | 7,9 | 4,45 | | 0,789 (0,982 sin las 3 láminas finales) | 14/15 |

\* Con «thinkingLevel: low»; aislado, una página tarda 10 s con `low` y 7,5 s con
`thinkingBudget: 0`, que es lo que usa ahora el lector. En *Attention*, Flash
describe como figura las láminas de visualización de atención (páginas 13-15) en vez
de transcribir las palabras sueltas que contienen; en las 12 páginas de texto, F1
0,982 frente a 0,978 de 3.1-Lite.

### Imágenes JPEG (lo que manda el navegador) frente a PDF

| modelo | pliego | muro s | CER oro |
|---|---|---|---|
| 3.5-flash-lite | 1 | 7,5 | 0,057 |
| 3.5-flash-lite | 4 | 16,1 | 0,026 |
| 3.8-flash | 1 | 13,4 | 0,009 |
| 3.8-flash | 4 | 39,1 | 0,009 |

Con JPEG de 150 ppp, Flash-Lite empeora y oscila; Flash se mantiene. Otra razón
para que el lector por defecto sea 3.8 Flash.

### Otras observaciones del lector

- **Recitación.** Gemini corta la respuesta (`finishReason: RECITATION`) en
  páginas de libros con derechos: le pasó a la página 3 de *The Discarded Image*
  con los tres modelos. El lector lo convierte en error y la cascada pasa esa
  página al siguiente lector (OpenRouter o Workers AI).
- `mediaResolution: MEDIUM` (560 tokens por página) y salida por
  `responseJsonSchema`. `thinkingLevel: minimal` no existe en 3.8 Flash
  (error 400); el lector baja solo por la escalera presupuesto 0, minimal, low.
- Fax de 1972: transcripción completa, incluida la firma «Phil.» que la tubería
  antigua perdía.

### Workers AI (una página, la de oro, en JPEG)

| modelo | ms | CER oro | folio | coste por página |
|---|---|---|---|---|
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 22.228 | **0,058** | 4 (bien) | 0,0016 $ |
| `@cf/google/gemma-4-26b-a4b-it` | 7.319 | 0,105 | 4 (bien) | 0,0004 $ |
| `@cf/zai-org/glm-5.3-flash` | 121.162 | 1 (no leyó nada) | ninguno | 0,0009 $ |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | sin dato | error 400 con `json_schema` | | |

Llama 4 Scout queda como reserva por defecto (mejor que la tubería antigua, pero
lejos de Gemini). Ninguno acepta PDF: en la cascada se saltan los pliegos PDF.

## Embebedor: Gemini Embedding 2 @1536

| prueba | ms | resultado |
|---|---|---|
| 4 documentos + 3 consultas (es/en) | 723 | 3 de 3 consultas aciertan el documento |
| imagen de la p. 10 del *Casamiento* | 1.042 | coseno 0,560 con «versos de amor y celos…», 0,33-0,37 con las otras |
| PDF de una página (*Attention*, p. 3) | 927 | 0,571 con «transformer architecture…», 0,313 con la del IRA |
| audio de 60 s (3Blue1Brown, vectores) | 1.221 | 0,714 con «what is a vector…», 0,379 con la del IRA |
| lote de 300 fragmentos | 1.884 | 159 fragmentos/s (lotes de 100 en paralelo) |

Embedding 2 no admite `task_type`: la tarea va en el texto
(`task: search result | query: …` y `title: none | text: …`). El vector a 1536
llega normalizado; se renormaliza igualmente.

## Redactor (línea de contexto con el libro en el sistema, ~9.700 tokens)

| calidad | ms | tokens de caché | coste |
|---|---|---|---|
| rápida (3.5-flash-lite) | 2.182 / 1.063 | 9.667 de 9.698 | 0,00041 $ |
| alta (3.8-flash) | 3.866 / 2.259 | 9.667 de 9.698 | 0,00089 $ |

Al pasar de 16.000 caracteres, el sistema se guarda en `cachedContents` (15 min) y
las llamadas siguientes lo reutilizan; por debajo se confía en la caché implícita.
El coste de almacenamiento de la caché no está incluido.

## Transcriptores (mp3 de 60 s)

| transcriptor | ms | palabras | hablantes | coste |
|---|---|---|---|---|
| `gemini-3.5-transcribe` (Interactions API, `store: false`) | 2.884 | 157 | sí (1) | 0,0050 $ |
| `@cf/openai/whisper-large-v3-turbo` | 4.516 | 159 | no | 0,0005 $ |

## Reordenadores y juez

| prueba | ms | coste | resultado |
|---|---|---|---|
| Jev, reordenar 4 pasajes en 1 petición | 358 | 0,00003 $ | 0,03 · **0,94** · 0,93 · 0,03 (el 3.º es del mismo tema y lo contradice: relevante, no respaldo) |
| Jev, juez con 4 preguntas (sí/no, 2 elecciones, escala) | 290 | 0,00003 $ | respalda 0,80 · APOYO_DIRECTO 0,99 · folio «142» 0,88 · escala 2,76/3 |
| Workers AI `bge-reranker-base` | 215 | 0,0000004 $ | 0,000 · **0,097** · 0,000 |
| Workers AI `bge-m3` (consulta + contextos) | sin dato | sin dato | probado a mano: 0,82 frente a 0,61 |
| Workers AI `qwen3-embedding-0.6b` | 528 | 0,0000012 $ | coseno 0,18 · **0,71** · 0,12 |

## Identificadores comprobados (6-10-2026)

- Gemini (`GET /v1beta/models`): `gemini-3.8-flash`, `gemini-3.5-flash-lite`,
  `gemini-3.1-flash-lite`, `gemini-embedding-2` (`batchEmbedContents`, 128-3072
  dims, 6 imágenes, 180 s de audio, 120 s de vídeo, PDF de hasta 6 páginas),
  `gemini-3.5-transcribe` (Interactions API, `POST /v1beta/interactions`).
- Workers AI (`/ai/models/search` y `/ai/models/schema`): `@cf/openai/whisper-large-v3-turbo`
  (palabras en `segments[].words`), `@cf/baai/bge-reranker-base`, `@cf/baai/bge-m3`,
  `@cf/qwen/qwen3-embedding-0.6b` (32 textos por llamada), `@cf/meta/llama-4-scout-17b-16e-instruct`,
  `@cf/google/gemma-4-26b-a4b-it`.
- OpenRouter: plugin `file-parser` con motores `mistral-ocr` (2 $/1000 páginas),
  `cloudflare-ai` (gratis) y `native`; `google/gemini-3.5-flash-lite`, `z-ai/glm-5.3-flash`.
- TypeSafe: `POST https://api.typesafe.ai/v1/systemone`, `jev-latest` = `jev-1.13.0`.

## Sin probar en vivo

- **OpenRouter**: la cuenta está sin crédito (402, 10,20 $ usados de 10 $). Lector
  y redactor probados solo con `fetch` simulado.
- **InferBox**: apagado; implementado a partir de su README y del cliente antiguo,
  probado con `fetch` simulado.
- **Binding `env.AI`** dentro de un Worker: probado con un binding simulado; en vivo
  se usó la API REST con el token OAuth de wrangler.
- Subida a la Files API de Gemini para audios de más de 18 MB.
- AI Gateway (`baseUrl`): solo comprobada la forma de la URL.
