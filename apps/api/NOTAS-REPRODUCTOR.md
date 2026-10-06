# Notas del reproductor (para quien toque la API)

Lo que el reproductor nuevo (`apps/web/src/componentes/reproductor/`) necesita
de la API, por qué, y qué se cambió aquí. Si tocas estas piezas, mantén lo de
abajo o avisa.

## 1. Por qué no se veía el vídeo de Cortázar

`GET /binarios` (la URL firmada de `/documentos/:id/original`) respondía **500**
a `Range: bytes=0-`, que es lo primero que pide un `<video>`. El almacén leía
el rango entero en memoria (`rango()` → `arrayBuffer()`): 357 MB en un Worker
de 128 MB. Con `bytes=0-1023` funcionaba, por eso parecía que el Range iba bien.

Arreglo (commit 18565f9): `AlmacenAmpliado.flujoRango?(clave, desde, hasta)`
devuelve el rango como flujo (R2: `bucket.get(..., { range }).body`; disco:
`createReadStream`), y `servirBinario` lo usa. Si un almacén no lo tiene, se
sirve como mucho 8 MiB por respuesta (un 206 más corto es válido).
Medido: 206 en 0,4 s y ~40 MB/s; un salto a 1:06:56 suena en ~0,1-0,6 s.

**No volver a leer rangos de medio con `rango()`** en rutas que sirvan medios.

Cabeceras que sirve hoy (y que necesita el `<video>`): `accept-ranges: bytes`,
`content-range`, `content-length`, `content-type` del documento, `etag`,
`cache-control: private, max-age=3600`. La URL caduca a las 6 h (redondeada a
la hora: la misma URL durante una hora, el navegador cachea). El reproductor
**pide otra URL** a `/documentos/:id/original` si el medio falla a mitad
(403 por caducidad, red) y sigue en el mismo instante, con reintentos
0 / 0,5 / 1 / 2 s.

## 2. MP4 con el índice al final («faststart»)

`src/compartido/medio-rapido.ts`: hace lo de `ffmpeg -movflags +faststart` sin
ffmpeg y sin cargar el archivo: lee las cabeceras de primer nivel y la `moov`,
suma su tamaño a `stco`/`co64` y reescribe el objeto **en la misma clave** por
partes de 16 MiB (R2 sustituye el objeto de golpe al completar). Muestras
bit a bit idénticas (comprobado con `ffmpeg -c copy -f md5` en un MP4 de 77 MB).
También lee los códecs de `stsd` (avc1, hvc1, av01, vp09, mp4a…).

- Ingesta nueva: paso `medio-rapido` del Workflow, después de `original`
  (no es fatal si falla); en local, en `apps/local/src/cola.ts`.
- Documentos que ya estaban:
  `GET /documentos/:id/medio/diagnostico` y `POST /documentos/:id/medio/preparar`
  (rutas en `src/rutas/medios.ts`; tipos `DiagnosticoMedio` y `MedioPreparado`
  en el contrato). Para una cuenta entera: `bench/src/reparar-medios.ts`.
- Pruebas: `test/medio-rapido.test.ts` (R2 de miniflare).

Las dos entrevistas de la cuenta de prueba ya venían con la `moov` delante
(Cortázar: `moov` de 6,8 MB al principio); `3b1b_1min_real.mp4` la tiene al final.

## 3. Pendiente (necesita reconstruir la imagen del conversor)

- **Versión H.264/AAC para los códecs dudosos** (AV1, VP9 o HEVC dentro de
  MP4, que yt-dlp produce a menudo y Safari antiguo no reproduce). El
  diagnóstico ya los detecta; el reproductor enseña «Este navegador no puede
  reproducirlo». Propuesta: `POST /reproducible` en `apps/local/src/conversor.ts`
  con `ffmpeg -i - -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k
  -movflags +faststart` y guardar `reproducible.mp4` junto al original;
  `/original` devolvería esa URL si existe. Hace falta Docker (servidor de casa).
- **Picos de la onda en la ingesta**: hoy la onda de los audios se calcula en
  el navegador para archivos de hasta 40 MB / 40 min (y se guarda en
  localStorage); en los largos se dibuja la densidad del habla de la
  transcripción. La imprenta ya decodifica el audio: podría emitir una parte
  `medio/picos.bin` (Uint8, ~10 por segundo) y una ruta que la sirva.
- **Palabras con su instante**: la transcripción guarda las palabras con tiempo
  en `trabajo/<doc>/tanda/*.json`, pero se borran al consolidar. El karaoke
  estima el instante de cada palabra dentro de su tramo (por sílabas y pausas);
  si se guardaran (p. ej. un blob `transcripcion/palabras.json`) el karaoke
  sería exacto. Toca `packages/ingesta/src/tuberia.ts` (agente de ingesta).
