# Scholaris sin conexión

Medido el 6 y el 7 de octubre de 2026 en un Mac Studio con M4 Max (36 GB de memoria unificada, Metal), sin ninguna clave de nube y con la red de Scholaris cerrada a todo lo que no fuera local. InferBox (la RTX 3060 de casa) estaba dormida y no despertó con Wake-on-LAN, así que las cifras de GPU NVIDIA son estimaciones y lo dicen.

## Qué es

`SCHOLARIS_SIN_CONEXION=1` hace que `crearInteligencia` monte los seis puertos (lector, embebedor, reordenador, transcriptor, juez y redactor) sobre servidores propios compatibles con OpenAI, con `crearOpenAICompatible` (`src/compatible.ts`) y `crearInteligenciaSinConexion` (`src/sin-conexion.ts`). Las claves de nube se ignoran aunque estén puestas, y cualquier URL que no sea local (localhost, red privada, Tailscale, nombre de servicio de Docker, `.local`) hace que se niegue a arrancar.

| Variable | Para qué | Por defecto |
|---|---|---|
| `SCHOLARIS_SIN_CONEXION=1` | Activa el modo | |
| `INFERENCIA_URL` | El servidor de chat y visión (Ollama, llama.cpp, vLLM, LM Studio, InferBox) | obligatoria (o `INFERBOX_URL`) |
| `INFERENCIA_SABOR` | `ollama`, `inferbox`, `llamacpp`, `vllm`, `lmstudio` o `generico` | se deduce del puerto |
| `INFERENCIA_CLAVE` | Si el servidor pide clave | |
| `INFERENCIA_MODELO_LECTOR` | Modelo de visión que lee las páginas | `qwen3-vl:8b-instruct` en Ollama |
| `INFERENCIA_MODELO_REDACTOR`, `INFERENCIA_MODELO_JUEZ` | LLM para redactar y para juzgar | el del lector |
| `INFERENCIA_EMBEBEDOR_URL` | Servidor de vectores con el contrato `/v1/embed` (`deploy/inferencia/embeddinggemma2`) | |
| `INFERENCIA_MODELO_EMBEBEDOR`, `INFERENCIA_DIMS` | Embebedor y dimensiones (Matryoshka: 768, 512, 256 o 128) | `embeddinggemma-2`, 768 |
| `INFERENCIA_REORDENADOR_URL` | `/v1/rerank` (el mismo servidor de vectores con `--reordenador`, llama.cpp con `--reranking`, vLLM, Infinity) | coseno si no hay |
| `INFERENCIA_TRANSCRIPCION_URL` | `/v1/audio/transcriptions` (whisper.cpp con `--inference-path`, faster-whisper-server, speaches) o `/v1/transcribe` de InferBox | |
| `INFERENCIA_CONCURRENCIA` | Peticiones a la vez por servidor | 4 (2 en el compose) |
| `SCHOLARIS_SIN_CONEXION_PERMITIR` | Anfitriones extra que se aceptan como locales (`gpu.mi-casa.es`, `.mi-dominio`) | |
| `SCHOLARIS_CATALOGOS=1` | Abre a sabiendas OpenAlex, Crossref, Open Library, Wikidata, Wikipedia, Google Books, arXiv y DataCite (sale el título y los autores, nunca el texto) | apagado |

## Las piezas y por qué

| Puerto | Sin conexión | Por qué |
|---|---|---|
| Lector | Qwen3-VL 8B Instruct (Ollama, Q4_K_M), una página por llamada, salida restringida por esquema, en streaming con corte de bucles | Qwen2.5-VL 7B pierde una de las dos columnas en 2 de cada 5 páginas de la comedia; Qwen3-VL no. La variante «-instruct» importa: la de por defecto piensa y Ollama no deja apagarlo por `/v1` |
| Embebedor | EmbeddingGemma 2 (Google DeepMind, 6-10-2026, Apache 2.0): texto, imagen, audio y vídeo en un espacio de 768 dimensiones | Un solo espacio multimodal, 740M parámetros, corre en un portátil |
| Reordenador | bge-reranker-v2-m3 en el mismo servidor de vectores | Ollama no tiene `/v1/rerank`; sin reordenador se pierden 0,04 de nDCG@10 |
| Transcriptor | whisper.cpp large-v3-turbo (q5_0) con marcas por palabra | Rápido en Metal y en CUDA, y habla el formato de OpenAI |
| Juez | El mismo Qwen3-VL contesta cada pregunta con una letra; la probabilidad sale de los `logprobs` (Ollama 0.40 los da) | |
| Redactor | El mismo Qwen3-VL con esquema JSON | |

### EmbeddingGemma 2, comprobado en fuentes primarias

Ficha de [google/embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2) (Apache 2.0): 740M parámetros (texto 270M, visión 170M, audio 300M, que se cargan por separado), 768 dimensiones nativas con Matryoshka a 512, 256 y 128 (no hay 1536), 8.192 tokens de contexto, prefijos de tarea `task: search result | query: …` para las consultas y `title: none | text: …` para los documentos (solo en el texto), y nunca `float16` (da NaN).

- **Ollama 0.40** lo sirve (`embeddinggemma-2`, 1,3 GB en nvfp4) pero **solo para texto**: acepta imágenes en `/api/embed` y las ignora (una imagen roja y una azul dan el mismo vector, coseno 1,000). Ollama 0.34 ni lo carga.
- **sentence-transformers 6.1** con el procesador oficial sí hace las cuatro modalidades. Es lo que usa el servidor propio `deploy/inferencia/embeddinggemma2/servidor.py` (CUDA en bfloat16, MPS en el Mac, CPU en float32), con el contrato `/v1/embed` de InferBox, y el cargador `st_embeddinggemma2` que se añadió a InferBox (rama `embeddinggemma-2` de su repositorio).
- Los vectores de Ollama (nvfp4) y los de sentence-transformers (bfloat16) del mismo texto tienen coseno 0,984-0,994: el mismo espacio, `embeddinggemma-2@768`, sirva quien sirva el modelo. Para mezclar en una biblioteca, mejor revectorizar con uno solo.

Comprobación multimodal en el Mac (MPS, bfloat16):

| Prueba | Resultado |
|---|---|
| Imagen roja frente a azul | coseno 0,868; «a solid red square» recupera la roja (0,760 frente a 0,665) y «blue» la azul |
| 10 tramos de 30-50 s del audio de Bécquer frente a su transcripción | acierto@1 10/10 (pareja 0,832, resto 0,699); 490 s de audio en 2,1 s (230 veces tiempo real) |
| 10 páginas escaneadas de la comedia frente a su texto | acierto@1 6/10 (azar: 1/10); imprenta del siglo XVIII, el caso difícil |
| Vídeos rojo, azul y carta de ajuste frente a su descripción | acierto@1 3/3 |
| Texto | 18 ms por pasaje de 700 caracteres; 2,7 GB de memoria con los tres codificadores |
| Solo CPU (M4 Max, float32) | 58 ms por pasaje, 628 ms por página, audio 48 veces tiempo real; 4,9 GB de memoria |

## Búsqueda: el banco público

`pnpm bench calidad embebedores --modelos gemini,servidor:embeddinggemma-2,ollama:bge-m3 --reordenador http://localhost:8812` sobre el banco público (66 consultas, 126 fragmentos, 2.387 juicios). nDCG@10 / Recall@20 / MRR:

| Espacio | densa | léxica + densa | + reordenador local (bge-reranker-v2-m3) |
|---|---|---|---|
| Gemini Embedding 2 @1536 (nube) | 0,781 / 0,889 / 0,856 | 0,807 / 0,904 / 0,899 | 0,833 / 0,920 / 0,939 |
| **EmbeddingGemma 2 @768** | 0,716 / 0,881 / 0,806 | 0,762 / 0,890 / 0,879 | **0,804 / 0,907 / 0,924** |
| EmbeddingGemma 2 @256 (Matryoshka) | 0,691 / 0,870 / 0,793 | 0,748 / 0,881 / 0,858 | |
| bge-m3 @1024 (Ollama) | 0,735 / 0,890 / 0,846 | 0,768 / 0,906 / 0,887 | 0,802 / 0,906 / 0,932 |

La producción en la nube (Gemini Embedding 2 + Jev) da **0,899**. Sin conexión, con EmbeddingGemma 2 y bge-reranker, **0,804**: unos 0,10 por debajo, sobre todo por el reordenador (Jev frente a bge-reranker). En recall la diferencia es pequeña (0,907 frente a 0,950): lo que se encuentra es casi lo mismo; cambia el orden. bge-m3 iguala a EmbeddingGemma 2 en texto, pero no ve imágenes ni oye audio. Qwen3-VL-Embedding (InferBox) no se pudo medir esta noche.

El reordenador local tarda 0,56 s por consulta (40 pasajes en MPS).

## Ingesta: dos documentos del banco, de punta a punta

`SCHOLARIS_SIN_CONEXION=1 … pnpm bench ingesta <archivo>` con Ollama 0.40 (2 peticiones a la vez), el servidor de EmbeddingGemma 2 y whisper.cpp en el mismo Mac. El banco cambia `fetch` por uno que bloquea y cuenta todo lo que no sea local: **0 peticiones a internet** en las dos.

| | En la nube (Gemini) | Sin conexión |
|---|---|---|
| *El monte de las ánimas* (LibriVox, 19 min de audio) | 55 s, 0,15 $ | **2 min 34 s**, 0 $; buscable a los 27 s |
| Transcripción | Gemini Transcribe | whisper.cpp large-v3-turbo: 2,2 % de WER contra la de Gemini |
| Metadatos | «Gustavo Adolfo Bécquer» | «Gustavo Adolfo Béquer»: sin catálogos, la errata del audio se queda |
| *El casamiento en la muerte* (escaneado del XVIII, 43 páginas) | 13-20 s, ~0,17 $ | **22 min 44 s**, 0 $; primera página legible a los 24 s |
| Lectura | Gemini 3.8 Flash, CER 0,006 contra el oro (p. 10) | Qwen3-VL 8B: CER 0,06 contra el oro; 0,069 contra la lectura de Gemini en todo el libro (mediana 0,048 por página); 1 página de 32 incompleta |
| Folios impresos | 30/31 | 32/32 iguales a los de la nube (la secuencia los deduce aunque el modelo vea pocos) |

Lectura: ~26 s por página con dos a la vez (unos 60 tokens/s por petición en Metal). Un libro de 300 páginas escaneadas son unas 2 horas y media en este Mac; uno digital con capa de texto buena apenas pasa por el lector (solo las páginas con tablas, fórmulas o maquetación difícil).

## Citas

Las 19 afirmaciones del banco público (13 con respaldo y 6 negativas), con autocita y verificación hechas por Qwen3-VL 8B como juez y redactor, EmbeddingGemma 2 y bge-reranker:

| | Nube (Gemini + Jev) | Sin conexión |
|---|---|---|
| Precisión de las citas aceptadas | 100 % | **100 %** |
| Exhaustividad | 100 % | **61,5 %** |
| Citas inventadas | 0 | **0** |
| Citas en afirmaciones sin respaldo | 0 | 0 |
| Veredicto de verificación correcto | 100 % | 94,7 % |
| Tiempo por afirmación | 0,77 s | 32,6 s |

Lo que acepta es correcto y nunca inventa (las comprobaciones literales de la evidencia y del ancla no dependen del modelo); lo que cambia es que el juez local es más prudente y deja sin cita 5 de las 13 afirmaciones que sí la tienen, y que tarda unas 40 veces más. Los `logprobs` de Ollama 0.40 dan probabilidades reales al juez (con un servidor sin ellos, la elección restringida vale 1 y el nombre del juez lo dice: `…+sin-logprobs`).

## Lo que no hace sin conexión

- **Catálogos.** Sin OpenAlex, Crossref, Open Library ni Wikidata, la ficha sale solo de lo que dice el documento (y de lo que el usuario corrija). `SCHOLARIS_CATALOGOS=1` los abre a sabiendas.
- **YouTube por URL**: necesita la red.
- **Clerk**: en este modo se ignora; la instancia usa `SCHOLARIS_TOKEN` o `SCHOLARIS_USUARIOS`.
- **Hablantes**: whisper.cpp no separa hablantes; las entrevistas salen sin «quién habla» salvo con un transcriptor que los dé (InferBox con pyannote).
- **Velocidad**: la nube lee un libro en paralelo; un Mac o una GPU de casa, de dos en dos.

## La guardia de red

En la versión local (`apps/local/src/guardia-red.ts`) cierra `fetch`, el despachador de undici y `http`/`https`: lo que no es local se bloquea con un error y se anota (una línea por anfitrión en el registro). La prueba `apps/local/test/sin-conexion.test.ts` sube un PDF escaneado, lo lee con un servidor falso compatible con OpenAI en 127.0.0.1, busca y verifica una cita, y comprueba que no se ha hecho ni bloqueado ninguna petición a internet, y que una a OpenAlex, otra por `https.get` y otra por `undici.request` sí se bloquean.

## Cómo reproducirlo

```bash
# Ollama ≥ 0.40 y los modelos
ollama pull qwen3-vl:8b-instruct
# EmbeddingGemma 2 multimodal + reordenador (MPS en el Mac, CUDA en Linux)
pip install -r deploy/inferencia/embeddinggemma2/requirements.txt
python deploy/inferencia/embeddinggemma2/servidor.py --puerto 8812 --reordenador BAAI/bge-reranker-v2-m3
# whisper.cpp con el formato de OpenAI
whisper-server -m ggml-large-v3-turbo-q5_0.bin --port 8814 --inference-path /v1/audio/transcriptions --convert

export SCHOLARIS_SIN_CONEXION=1 INFERENCIA_URL=http://localhost:11434 \
  INFERENCIA_EMBEBEDOR_URL=http://localhost:8812 INFERENCIA_REORDENADOR_URL=http://localhost:8812 \
  INFERENCIA_TRANSCRIPCION_URL=http://localhost:8814 INFERENCIA_CONCURRENCIA=2
pnpm --filter @scholaris/local start                      # la aplicación
pnpm bench ingesta bench/datos/originales-publicos/becquer-monte-de-las-animas-librivox.mp3
pnpm bench calidad embebedores --modelos gemini,servidor:embeddinggemma-2 --reordenador http://localhost:8812 --citas
npx tsx packages/proveedores/vivo/sin-conexion-lector.ts qwen3-vl:8b-instruct http://localhost:11434 7 12
```

O con Docker: `deploy/docker/compose.sin-conexion.yml` (y `compose.sin-conexion.gpu.yml` con NVIDIA).

## GPU NVIDIA y solo CPU (estimaciones)

- **RTX 3060 (12 GB)**: Qwen3-VL 8B en Q4 genera del orden de 50-60 tokens/s, como el M4 Max; espera las mismas cifras de lectura. Los tres servicios caben muy justos en 12 GB.
- **Solo CPU**: EmbeddingGemma 2 y whisper van bien (medido arriba); el lector de visión es el cuello de botella, de minutos por página escaneada en una CPU de portátil. Para escaneados sin GPU, mejor `qwen2.5vl:3b` o leer los escaneados con una clave propia y dejar el resto en casa.
