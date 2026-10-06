# La imprenta: resultados

Medido el 6 de octubre de 2026 en un Mac de 14 núcleos con los originales de
`bench/datos/originales/`. Node 26 con pdf.js 6.4 y @napi-rs/canvas; Chrome 154
sin cabeza con el mismo código empaquetado por esbuild y corriendo dentro de un
Web Worker (con 13 trabajadores anidados para las páginas).

Cómo repetirlo:

```sh
pnpm --filter @scholaris/imprenta bench attention_2017.pdf serrano1977fondo.mp4   # Node
node packages/imprenta/bench/navegador/construir.mjs /tmp/imprenta-web             # navegador
node packages/imprenta/bench/navegador/probar.mjs /tmp/imprenta-web attention_2017.pdf
```

## PDF

Imagen de página: 1200 px de lado largo si la capa de texto es buena (solo sirve
para el folio y las figuras), 1600 px si la página va a visión; JPEG de calidad
0,8 y miniatura de 240 px.

| Archivo | Páginas | Navegador | Node | Páginas/s (nav. / Node) | Primera página (nav. / Node) | MB producidos | Escaneadas |
|---|---:|---:|---:|---:|---:|---:|---:|
| attention_2017.pdf (digital) | 15 | 0,51 s | 1,31 s ¹ | 29 / 11 | 0,31 s / 0,52 s | 2,4 | 0 |
| the_discarded_image (ClearScan) | 245 | 0,86 s | 4,4 s (4,2 s ¹) | 285 / 55 | 0,18 s / 1,6 s | 50,6 | 7 |
| el-casamiento (escaneado, s. XVII) | 43 | 1,02 s | 3,6 s | 42 / 12 | 0,12 s / 1,3 s | 19,6 | 43 |
| cortazar1959perseguidor (digital) | 37 | 0,25 s | 1,8 s | 148 / 21 | 0,12 s / 1,3 s | 10,7 | 0 |
| scanned_ocr_test (escaneado) | 1 | 0,10 s | 1,2 s | | | 0,17 | 1 |

¹ En el mismo hilo. En Node, arrancar cada `worker_thread` (tsx + pdf.js + el
documento) cuesta 0,8-1,5 s, así que por defecto se usa un trabajador por cada 25
páginas (como mucho núcleos − 1, máximo 8) y ninguno hasta 25 páginas. En el navegador un trabajador arranca en unos
70 ms y Chrome rasteriza y codifica en GPU: ahí está la diferencia.

Tamaño y tiempo de la imagen por página (Node, un hilo, 10 páginas):

| Página | Lado | Calidad | KB/página | ms/página |
|---|---:|---:|---:|---:|
| Escaneada (el-casamiento) | 1200 | 0,8 | 299 | 147 |
| | 1600 | 0,7 | 422 | 106 |
| | **1600** | **0,8** | **516** | 104 |
| | 2000 | 0,8 | 730 | 107 |
| Digital (discarded_image) | **1200** | **0,8** | **182** | 20 |
| | 1600 | 0,8 | 271 | 19 |

Bajar a 0,7 ahorra un 18 % de subida en los escaneados; 2000 px no mejora la
lectura de un libro en octavo y cuesta un 40 % más.

Clasificación por página (heurística sin modelo): la capa de texto se acepta si
tiene al menos 25 caracteres y calidad ≥ 0,6; si la página está cubierta por una
imagen (≥ 85 %), la capa es OCR y se le pide calidad ≥ 0,9 y 200 caracteres. La
calidad castiga los caracteres imposibles (U+FFFD, uso privado, control: fuentes
sin ToUnicode), las palabras raras («AJtI1EN») y los signos que siembra el OCR
(`~ \ { } |`). Resultado: las 43 páginas del Lope (OCR de 2010, inservible) van a
visión; el C. S. Lewis (ClearScan) se lee del texto salvo sobrecubierta y
preliminares; los PDF digitales, enteros por texto.

## Audio y vídeo

Tramos mono a 16 kHz en Ogg/Opus de 24 kbit/s (unos 1,8 MB por cada 10 minutos;
en WAV serían 19 MB), de 600 s con 2 s de solape. Fotogramas: solo los fotogramas
clave del códec (se decodifican sueltos), con cambio de escena por diferencia de
luminancia a 64 × 36 (≥ 3 s de separación) o uno periódico cada 20 s.

| Archivo | Duración | Navegador (WebCodecs) | Node (ffmpeg) | Tramos | Fotogramas | MB |
|---|---:|---:|---:|---:|---:|---:|
| audio_conference.mp3 | 60 s | 0,48 s (125×) | 0,49 s (122×) | 1 | | 0,18 |
| 3b1b_1min_real.mp4 | 60 s | 0,58 s (104×) | 0,56 s (106×) | 1 | 3 de 11 claves | 0,22 |
| serrano1977fondo.mp4 (76 MB) | 53 min 39 s | 11,1 s (290×) | 8,9 s (360×) | 6 | 148 de 718 claves | 11,9 |

En los dos entornos la primera pieza sale en menos de 0,3 s (el primer fotograma);
el primer tramo de audio, en cuanto se han decodificado sus 10 minutos.

## Documentos

DOCX, EPUB, ODT, RTF, HTML, Markdown, TXT, PPTX, XLSX y CSV de `test/fixtures`
se convierten en menos de 30 ms en los dos entornos. El EPUB de prueba saca el
folio impreso de cada párrafo (pagebreak y page-list), el índice del nav y la
ficha del OPF; el DOCX, títulos, cita y notas al pie con el bloque que las llama.

## Límites conocidos

- PPTX y Keynote: el texto y las notas salen en el navegador; la imagen de cada
  diapositiva no (hace falta LibreOffice): el paquete lo pide en `reserva`.
- Audio en el navegador: WAV, MP3 y la pista AAC de MP4/M4A/MOV por WebCodecs;
  OGG, FLAC, WebM o MKV solo si el código corre en el hilo principal
  (`OfflineAudioContext`). Si no, `reserva.tareas = ['decodificar_audio']`.
  Fotogramas: solo MP4/MOV (mp4box); WebM y MKV, al servidor.
- HEIC y TIFF solo se decodifican donde el navegador sepa (Safari): si no, aviso
  y reserva.
- Fotos de un libro: orientación EXIF y reducción; no hay enderezado ni recorte.
- En el navegador pdf.js dibuja los glifos como trazos (`disableFontFace`: en un
  worker no hay `document`); se ve igual y, medido, va más rápido que Node.
- La lectura de varias columnas usa un corte XY sencillo: acierta con artículos a
  dos columnas y portadas con rejilla de autores, pero no reconstruye tablas.
