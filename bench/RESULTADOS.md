# Banco de la ingesta: SPDF 4.0 frente a SPDF 3

Medido el 6 de octubre de 2026 en el Mac de José Luis. La red es la de casa y todo pasa por APIs: Gemini 3.5 Flash-Lite y 3.8 Flash para leer y redactar, Gemini Transcribe, Gemini Embedding 2 a 1536 dimensiones, Jev como juez de folios, y Crossref y OpenAlex para verificar. No se usa ninguna GPU propia. La imprenta convierte con `@scholaris/imprenta/node`; en producción esa parte la hace el navegador.

Para reproducirlo:

```
pnpm bench ingesta bench/datos/originales/<archivo> [--etiqueta X] [--tramo 300] [--digital capa|vision|auto] [--lector alta|rapida]
pnpm bench comparar [etiqueta…]
pnpm --filter @scholaris/bench exec tsx src/turnos.ts muestra|puntuar <etiqueta>
```

Los SPDF salen en `bench/datos/salida/`: el `.spdf` (gzip), una copia `.sqlite` para inspeccionar y un `.informe.json` con tiempos, coste y recuentos. Cada ejecución deja además un registro en `historial/`.

## Lo principal

| Documento | Antes (v3) | Ahora (v4) | Coste |
|---|---|---|---|
| Entrevista *A fondo* con Facundo Cabral, vídeo de 54 min | **3 h 39 min** solo en la segunda mitad de la tarea (registro del servidor, 17-6-2026); a unos 4 min de proceso por minuto de vídeo | **45 s** (30 s sin atribución de hablantes) | 0,41 $ |
| Entrevista *A fondo* con Cortázar, vídeo de 2 h 2 min | Las de *A fondo* de 83 min tardaron 5 h 43 min | **70 s** | 0,94 $ |
| *The Discarded Image*, libro de 245 págs. con OCR antiguo | No consta. El OCR de v3 iba a unos 20-25 s por página (Iconologia, 186 págs.: 66 min solo de OCR) | **Mediana de 85 s** en 16 ejecuciones (mínimo 37 s, máximo 175 s) | 0,64 $ (mediana) |
| *El casamiento en la muerte*, 43 págs. escaneadas del XVII | No consta (mismo régimen de 20-25 s por página) | **27 s** | 0,20 $ |
| *Attention Is All You Need*, 15 págs. digitales | No consta | **12 s** | 0,04 $ |
| *El perseguidor*, 37 págs. digitales | No consta | **15 s** | 0,04 $ |

El tiempo cuenta de punta a punta, imprenta incluida. Los vídeos se trocean en tramos de 300 s.

En calidad, la diferencia más grande está en el libro de 245 páginas. El SPDF 3 tenía **195 páginas vacías** (74.000 caracteres en todo el libro), el título era el nombre del archivo de Z-Library y en 194 páginas el folio era igual a la página física, es decir, no se dedujo. El SPDF 4 tiene 358.000 caracteres, 7 páginas vacías (cubiertas y guardas) y **245 folios**: 229 leídos y contrastados con las etiquetas del PDF, que coinciden en 229 de 232 páginas. Revisé a ojo las páginas 12 («ix») y 100 («87») contra su imagen y están bien.

## Velocidad por documento

| Etiqueta | Tipo | Unidades | Imprenta | Ingesta | Total | s/unidad | $ | Llamadas |
|---|---|---|---|---|---|---|---|---|
| attention_2017 | pdf | 15 págs. | 1,2 s | 11,2 s | 12,4 s | 0,83 | 0,040 | 34 |
| cortazar1959persegui | pdf | 37 págs. | 1,7 s | 13,2 s | 14,8 s | 0,40 | 0,037 | 11 |
| scanned_ocr_test | pdf_escaneado | 1 pág. | 0,3 s | 10,7 s | 11,0 s | 11,0 | 0,004 | 6 |
| el-casamiento | pdf_escaneado | 43 págs. | 3,4 s | 24,1 s | 27,5 s | 0,64 | 0,200 | 59 |
| discarded (mediana) | pdf (OCR ajeno) | 245 págs. | 4,4 s | ~80 s | 85 s | 0,35 | 0,64 | ~350 |
| audio_conference | audio | 1 min | 0,5 s | 5,2 s | 5,6 s | 5,6 s/min | 0,006 | 4 |
| 3b1b_1min_real | vídeo | 1 min | 0,5 s | 5,7 s | 6,2 s | 6,2 s/min | 0,008 | 6 |
| serrano | vídeo | 53,7 min | 7,3 s | 37,9 s | 45,2 s | 0,8 s/min | 0,41 | 78 |
| cortazar-afondo | vídeo | 122 min | 18,2 s | 52,0 s | 70,2 s | 0,6 s/min | 0,94 | 189 |

**Cuándo se ven las primeras páginas.** Por `unidadesListas`, la interfaz puede enseñar páginas mientras se procesa. En un PDF digital aparecen en menos de 0,01 s, porque salen de la capa de texto. En un escaneado aparecen con el primer pliego, a los 5-8 s. En un medio, con el primer tramo transcrito, a los 3-5 s.

**La variación del libro de 245 páginas es real y la pongo entera.** Las ejecuciones fueron 37, 40, 46, 47, 53, 56, 58, 81, 89, 93, 100, 111, 118, 127, 133 y 175 s. Las lentas tienen siempre una de tres causas, y las tres son de la API o de la red, no del código:

1. **Ráfagas de «fetch failed»** de `generativelanguage.googleapis.com` con cientos de peticiones en vuelo. Las páginas afectadas se reintentan y pasan a 3.8 Flash.
2. **Bloqueos por «recitación»**: Gemini se niega a transcribir algunas páginas de un libro con derechos. En ese caso caen a la capa de texto.
3. **Bucles de repetición de Flash-Lite**: una página que se repite hasta agotar los tokens. Proveedores ya los corta en unos 8 s.

Lo que ya se hizo contra esto:

- **Llamadas cubiertas.** Si un pliego tarda más de 2,2 veces la mediana, se lanza otra petición con la pista algo cambiada para no repetir el bucle, y gana la primera que responda. Tienen un presupuesto del 20 % para no empeorar la carga.
- **Límite de tiempo por pliego** de 20 s por página.
- **Concurrencia medida.** Con 48 peticiones a la vez va bien; con 192, la API corta conexiones y todo tarda el triple.

**Un hallazgo importante para la versión local.** El `fetch` que trae Node 26 pone en cola las peticiones simultáneas a Gemini: 8 llamadas en paralelo acaban a 0,6, 1,3, 1,9… 5,2 s, una detrás de otra. Con `setGlobalDispatcher(new Agent({ connections: 128, allowH2: true, keepAliveTimeout: 4000 }))` de undici acaban todas a la vez. Sin esto, el libro tardaba 235 s. `apps/local` debe ponerlo al arrancar; en Workers no hace falta.

## Calidad frente al SPDF 3

| | Attention | El perseguidor | Casamiento | Discarded Image | Cabral (vídeo) |
|---|---|---|---|---|---|
| Fragmentos v3 → v4 | 135 → 38 | 152 → 87 | 216 → 69 | 285 → 279 | 99 → 67 |
| Tokens por fragmento, mediana | 107 → 303 | 209 → 332 | 76 → 309 | 63 → 345 | 112 → 181 |
| En el rango 150-500 tokens | 1 % → 82 % | 66 % → 100 % | 19 % → 96 % | 1 % → 97 % | 1 % → 66 %* |
| Secciones | 0 → 22 | 0 → 1 | 0 → 6 | 2 → 31 | 0 → 0 |
| Fragmentos que cruzan página (con `ancla_fin`) | 0 → 11 | 0 → 33 | 0 → 14 | 0 → 186 | no aplica |
| Línea de contexto | no → 100 % | sí → 100 % | sí → 100 % | sí → 100 % | no → 100 % |
| Páginas sin texto | 0 → 0 | 0 → 0 | 11 → 11 | **195 → 7** | 5 → 0 |
| Caracteres leídos | 42 k → 39 k | 107 k → 115 k | 85 k → 84 k | **74 k → 358 k** | 40 k → 44 k |

\* En los medios, cada fragmento es un tramo de 30-60 s que termina en fin de frase, con su hablante: 181 tokens son unos 45 s de habla.

**Fidelidad del texto.** Medida como F1 de palabras por página entre v3 y v4. Para Attention da 0,90: v4 lee las seis páginas con tablas y fórmulas con visión, que las devuelve como tablas Markdown y LaTeX, y la capa de texto las destrozaba («P E (pos,2i) = sin(pos/100002i/dmodel)»). Para El perseguidor da 0,93. Las páginas 8 y 26 de v3 tenían solo 550 caracteres frente a los más de 3.000 de v4, porque v3 había perdido texto. V4 además quita el adorno «OO» que pdf.js metía delante de cada párrafo y pone rayas de diálogo («—¿Cuándo empiezas, Johnny?») en vez del signo menos. Para el Casamiento da 0,72, porque v4 conserva la grafía original («quanto», «recompẽsa», «dì») y v3 la normalizaba con erratas. Contra una transcripción de referencia, el banco de proveedores mide un CER de 0,007 con 3.8 Flash, frente a 0,073 del lector de v3 (Gemma). En el libro de Lewis, la capa de OCR de Acrobat traía «n6o», «II55», «beliefis», «rmlike» y el titulillo dentro del cuerpo. La relectura con visión da «1160», «1155», «belief is» y «unlike», y separa las notas al pie con su llamada `[^1]`.

**Metadatos**

| | v3 | v4 |
|---|---|---|
| Discarded Image | Título: «The_Discarded_Image_An_Introduction_t_z_library_sk,_1lib_sk,» | «The Discarded Image», con su subtítulo; C. S. Lewis bien partido; 1964; Cambridge University Press; verificado en OpenAlex |
| Attention | 3 autores sin nombre de pila | Los 8 autores con nombre y apellidos; 2017; *paper-conference*. Se descartó a propósito un DOI basura de 2025 (10.65215/…) que Crossref y OpenAlex devuelven primero: un artículo no cambia de año |
| El perseguidor | Idioma «EN» | «es» |
| Casamiento | Título con la imprenta pegada; año 1753 (lo puso el usuario); idioma «NO» | Título limpio y subtítulo «comedia famosa»; Lope de Vega; idioma «es». **Sin año**: la edición no lo imprime y v4 no lo inventa |
| Carta escaneada | «Scanned Document Test», año 2026 | «The Slerexe Company Limited», P. J. Cross, 1972 |
| Cabral (vídeo) | Idioma «en» | «A fondo», Joaquín Soler Serrano y Facundo Cabral, 1977, «es», *broadcast*, con resumen |

Cada campo guarda su procedencia: lectura, Crossref, OpenAlex, la ficha del PDF o el usuario. Un registro externo solo se acepta si coinciden el título y el autor; el autor tiene que coincidir también en el nombre de pila («C. S.» no es «Cynthia», un falso positivo real que salió en OpenAlex). Si es un artículo, también tiene que coincidir el año. El título tal como figura en la portada manda sobre la forma del catálogo («The discarded image : an introduction…»).

**Folios**

| | v3 | v4 |
|---|---|---|
| Discarded Image | 194 de 245 iguales a la página física | 245 con folio, 229 leídos y 16 deducidos; etiquetas del PDF contrastadas en 229 de 232 páginas |
| Casamiento | Las páginas 1-24 en negativo (como si fueran preliminares) y la 26 con «20» | Desfase constante de 6: la 7 es la «1» (primera página de la comedia, sin número impreso), la 11 es la «5» (vista en la imagen). 30 leídos, 7 deducidos y 6 sin folio (tapas y guardas) |
| Attention, Perseguidor | Folio = página física (correcto por casualidad) | Leídos del pie |

**Hablantes en entrevistas.** Medí 25 turnos al azar por ejecución, anotados a mano leyendo el texto; los cruces de una palabra que no se pueden decidir sin oír el audio quedan fuera. Las muestras están en `bench/resultados/hablantes/`.

| Entrevista | v3 | v4 antes del paso de hablantes | v4 |
|---|---|---|---|
| Cabral, 54 min | Sin hablantes | 31 % (Soler Serrano no aparecía nunca; un «turno» de 44 min mezclaba a los dos) | **95 %** (20/21) |
| Cortázar, 2 h | Sin hablantes | 55 % (etiquetas cruzadas desde el minuto 30; un «turno» de 50 min) | **100 %** (23/23) |

El caso que se señaló, Cabral en el 10:11, sale ahora así: «**Joaquín Soler Serrano:** ¿Eres un místico?» y luego «**Facundo Cabral:** Es inevitable…». Lo que sigue fallando son las interjecciones de una sola palabra cuando hablan los dos a la vez.

## Decisiones tomadas con datos

- **¿Las páginas digitales, por visión o por la capa?** Depende del origen de la capa:
  - **Capa nacida digital** (LaTeX, Word, HTML): por la capa. Es gratis, inmediata y tiene el mismo texto (F1 0,98 frente a visión en el banco de proveedores). Las notas al pie se separan por cuerpo de letra y los títulos por tamaño.
  - **Páginas con tablas o fórmulas**, que se detectan por la proporción de bloques diminutos y de símbolos matemáticos, y **letras espaciadas** («T H E  D I S C A R D E D»): por visión.
  - **Capa de un OCR ajeno** (Acrobat Paper Capture, ABBYY…; se detecta por el productor del PDF o por `origen: 'ocr'`): el documento entero se relee con visión. Cuesta unos 0,0015 $ por página con Flash-Lite y arregla erratas, titulillos y notas.
- **Tamaño del pliego.** Con 48 páginas en paralelo y Flash-Lite: 1 página por llamada, 5,6 s y 0,00165 $/pág.; 4 páginas, 7,5 s y 0,00143 $/pág.; 8 páginas, 11,2 s y 0,00131 $/pág. La salida se genera en serie, así que los pliegos grandes son más lentos, y además desalinean páginas. Uso 4 páginas, y el lector de Gemini las parte en llamadas de una página.
- **Qué lector.** Escaneados y fotos van con 3.8 Flash primero, porque en el Casamiento tiene un CER de 0,007 frente a 0,021 de Flash-Lite. Lo digital y las relecturas van con Flash-Lite, igual de bueno y unas 3 veces más rápido. El banco lo elige por el tipo del paquete (`calidadLector`).
- **Tramos de audio.** Con tramos de 300 s en vez de 600 s, la transcripción del vídeo de 54 min baja de unos 25 s a 12 s, al mismo precio por minuto.

## El coste, desglosado (mediana del libro de 245 páginas: 0,64 $)

| Parte | $ |
|---|---|
| Lectura (Flash-Lite, unas 300 llamadas) | ~0,50 |
| Vectores (279 fragmentos + 245 imágenes de página) | 0,05 |
| Línea de contexto (una llamada por sección) | ~0,05 |
| Metadatos, figuras y folios (Jev) | ~0,03 |

El plan calculaba unos 0,10 $ por leer 300 páginas con Workers AI; esta máquina no tiene credenciales de Cloudflare y no se pudo medir. En medios, lo que más cuesta es Gemini Transcribe: 0,005 $/min, unos 0,27 $ para 54 min. Whisper en Workers AI cuesta diez veces menos, pero no separa hablantes.

## Notas honestas

- Los tiempos de v3 salen del registro del servidor: `scheduled_reactivation.log` y las fechas de creación de los SPDF. Para el libro de 245 páginas, el Casamiento y los PDF cortos no hay registro de tiempos; la cifra de 20-25 s por página es la de los trabajos de OCR registrados (Iconologia, Mafalda), con `conversion_max_workers=1`.
- OpenRouter estaba sin saldo (402) durante las pruebas. El tercer escalón de la cascada no se pudo usar.
- La red de casa influye. Los tiempos en Workers, que llaman a Google desde la red de Cloudflare, deberían ser más estables.
- No medí la recuperación (Recall@20, nDCG). Eso es del banco de búsqueda.
