# Scholaris · diseño de la web

La web de Scholaris v2: una biblioteca donde se suelta cualquier archivo, se lee
y cada cita apunta a la página impresa o al segundo exacto. Este documento
explica el sistema visual, la arquitectura de la interfaz y por qué es así.

## 1. La idea: la Scholaris de siempre, con relieve y con Bauhaus

La base visual es la de la Scholaris original (scholaris.joseluissaorin.com),
portada casi al pie de la letra:

- la barra lateral de café oscuro con el **logo dibujado a mano** (la cabeza de
  perfil con un libro abierto por sombrero), los lugares con su icono y la
  marca amarilla del activo;
- **DM Sans** para todo;
- crema y café; tarjetas de 16 px de radio que se levantan del papel con
  sombras blandas en capas;
- campos y botones de 12 px; rótulos en mayúsculas seminegritas;
- el fondo Bauhaus de cruces, puntos y una diagonal roja muy tenue.

Encima van dos capas nuevas:

1. **Cualidad táctil.** Lo que se pulsa sube: tiene un filo de luz arriba y una
   sombra corta y blanda, sube un poco al pasar el ratón y se hunde al
   pulsarlo. Lo que recibe contenido se hunde: campos, carriles de progreso,
   bandejas y zonas de soltar. Las tarjetas se levantan del papel. Hay grano de
   papel sobre todo. Son objetos sobre una mesa.
2. **El lenguaje Bauhaus, con contención.** Rige la correspondencia de
   Kandinsky (azul-círculo, amarillo-triángulo, rojo-cuadrado), con tres
   registros (`Composicion`):
   - Kandinsky: círculos concéntricos, líneas que cruzan, puntos en tensión;
   - Malevich: el cuadrado negro dominante y barras en diagonal;
   - Bauhaus: retícula y formas primarias.

   Aparece en las cabeceras de cada lugar (su forma delante del título y una
   composición pequeña a la derecha), en los estados vacíos, en las portadas
   generadas (Malevich para libros y escaneos, Kandinsky para el audio, el
   cuadrado rojo para el vídeo), en los iconos de tipo, en la franja de tres
   tintas de la tarjeta de ingesta, en la respuesta de Preguntar y en la
   tarjeta social. Nunca dentro del texto que se lee.

De lo nuevo se conservan solo los detalles que no chocan: los folios en mono
(ahora como plaquita hundida con cuña roja), los hitos de ingesta y ⌘K. El
texto de los libros se lee en Georgia; todo lo demás va en DM Sans.

## 2. Arquitectura de la información

Las ~20 secciones del frontend anterior se agrupan en cuatro lugares y unos
ajustes:

| Lugar | Ruta | Qué reúne |
|---|---|---|
| 01 · Biblioteca | `/` | Documentos, colecciones, la mesa de entrada (ingestas en vivo), filtros, orden, rejilla o lista |
| Lector | `/lector/$id` | Página y texto lado a lado, folio fijo, «ir a» por folio impreso, índice, figuras, ficha editable, audio y vídeo con transcripción karaoke |
| 02 · Buscar | `/buscar` | Buscar pasajes, Preguntar (respuesta con citas), filtros como chips, en todas las lenguas; pestañas de Vigilantes y Historial |
| 03 · Escribir | `/escribir` | Autocita (pegar o abrir DOCX/PDF, aceptar y rechazar, exportar) y Cuadernos (tarjetas, notas, síntesis con citas) |
| 04 · Explorar | `/explorar` | Mapa de conceptos, grafo de citas, conceptos, perspectivas (lo olvidado, los huecos, lo que falta leer), corpus |
| Ajustes | `/ajustes` | Cuenta y plan (Clerk Billing), claves de API y claves propias, privacidad, apariencia |

Equivalencias con el frontend anterior: *dashboard, documents, library, convert*
→ Biblioteca; *search, multilingual* → Buscar; *watchers, history* → pestañas de
Buscar; *autocite, citations (exportación), notebooks* → Escribir; *concept-map,
citations (grafo), concepts, insights, corpus* → Explorar; *settings, pricing,
privacy* → Ajustes.

Además, en todas partes:

- **⌘K / Ctrl K**: la paleta. Ir a cualquier sitio, hacer cualquier acción,
  encontrar documentos (al instante, de la caché) y pasajes (mientras se
  escribe), o lanzar «Preguntar». Los pasajes abren el lector en su ancla.
- **Toda la ventana acepta archivos**: soltar, pegar (archivo o enlace) o el
  botón rojo «+». En el móvil, «Fotografiar páginas» abre la cámara.
- **`/`** lleva a Buscar con el cursor en la caja. **⌘U** abre el selector de
  archivos.

## 3. Tokens

En `packages/ui/src/tema.css` hay una sola paleta, la antigua afinada:

| Familia | Valores | Uso |
|---|---|---|
| cream 50-500 | #FAF7F0 · #F5F0E8 · #EDE6D6 · #E2D9C5 · #D4C4B0 · #C4AE96 | papel, tarjetas, huecos, bordes |
| coffee 300-900 | #8F7868 · #7A5F4F · #6B4226 · #5C3D2E · #4A2E1A · #2C1810 · #1A0F0A | tinta, texto secundario, barra lateral |
| Bauhaus | rojo #B83E33 (el #C1453B de siempre, ajustado a AA) · azul #2B4C7E · amarillo #E8A838 | acentos, formas, folio |
| Semánticos apagados | verde #5B7A3D · ocre #B8860B | éxito, avisos |

Los nombres semánticos (`papel`, `hoja`, `hondo`, `filete`, `tinta`, `apagado`,
`rojo`…) apuntan a esas familias. El tema oscuro invierte la escala sin
cambiar los nombres. Todos los textos pequeños cumplen AA: coffee-400 y
`apagado` tienen un contraste de 5:1 sobre crema.

Las sombras son las de siempre: `soft`, `card`, `lifted`, `inner-soft` y
`glow`. El relieve se añade como variables:

| Variable | Qué es |
|---|---|
| `--relieve`, `--relieve-alto` | botones y chips: filo de luz arriba, sombra corta |
| `--relieve-oscuro` | el botón café y el rojo |
| `--pulsado` | al pulsar: se hunde |
| `--hundido` | campos, carriles, bandejas, zonas de soltar |
| `--levantado`, `--levantado-alto` | tarjetas: se levantan del papel (y más al pasar) |

Radios: 8 px (`rounded-lg`), 12 px (`rounded-xl`: botones y campos) y 16 px
(`rounded-2xl`: tarjetas y diálogos). La tipografía es DM Sans variable, solo
latín, servida desde `/fuentes/` y precargada. Georgia queda para el texto de
los libros y la mono para los datos (`.dato`, `Folio`).

## 4. Componentes

`packages/ui` exporta exactamente un componente por función:

| Componente | Notas |
|---|---|
| `Boton` | variantes `tinta` (café con degradado y relieve), `rojo`, `linea` (crema con borde) y `fantasma`; sube al pasar el ratón y se hunde al pulsar |
| `Campo`, `AreaTexto`, `Selector`, `Etiquetado` | campos hundidos, foco con borde café y halo |
| `Tarjeta` | `rounded-2xl`, levantada; `viva` sube un poco más al pasar |
| `Chip` | píldora con relieve, con punto de color opcional; la activa se hunde en café |
| `Folio` | plaquita mono hundida con cuña roja; amarilla si el folio es dudoso |
| `Teclas` | teclas con relieve y canto |
| `BarraAvance` | carril hundido |
| `Vacio` | bandeja hundida con borde discontinuo, una composición, un titular y una acción |
| `Composicion` | el lenguaje de formas: `kandinsky`, `malevich`, `bauhaus` |
| `Dialogo`, menús, `Interruptor`, `Consejo` | los de Radix, vestidos de crema, con el pie del diálogo en una franja hundida |
| `avisar`, `conDeshacer`, `Tostadora` | avisos en café con «Deshacer» en amarillo |
| `Icono` | trazado redondo, como los de siempre |

En la web viven `Cabecera` (forma del lugar, título y composición), `Pestanas`
(control segmentado hundido; la activa sube), `Seccion` (tarjeta con icono,
como los ajustes de siempre), `IconoTipo` (el icono sobre su forma de color),
`Portada` (cubiertas generadas, con lomo) y `Logo`.

### Composiciones recuperadas de la antigua

- **Biblioteca**: el panel de inicio de siempre (filtro, banda de cifras,
  píldoras de tipo con punto de color) y la columna derecha de acciones y
  colecciones, con la rejilla de portadas y la mesa de entrada.
- **Barra lateral** oscura con los lugares y, debajo del activo, sus
  subapartados.
- **Móvil**: la cabecera café con el menú que se despliega, más un botón
  redondo para añadir.
- **Ajustes**: secciones en tarjeta con icono.
- **Autocita**: barra de opciones, documento en tarjeta y pie con las cifras y
  «Analizar y citar».

## 5. Datos: el contrato, siempre

- Todas las pantallas hablan con la API a través del cliente tipado de
  `@scholaris/contrato` (`src/datos/api.ts`). No hay una capa de datos paralela.
- **Demostración sin API**: si `/api/v2/config` no responde en desarrollo (o
  con `?demostracion` o `VITE_FUENTE=simulada`), al cliente se le pasa un
  `fetch` simulado (`src/datos/simulada/`) que responde las mismas rutas, SSE
  incluido, con un corpus de ejemplo escrito para la demo (paráfrasis propias,
  no citas de las obras). Se carga en su propio trozo: en producción no pesa.
- TanStack Query con `staleTime` de 30 s, `keepPreviousData` en búsquedas y
  listados, actualizaciones optimistas (metadatos, colecciones, decisiones de
  autocita, vigilantes, historial, notas) y reversión si el servidor falla.
- La API numera las unidades desde 0 y la web desde 1 (la página física 1 es la
  unidad 1): la traducción se hace en un único sitio, `src/datos/consultas.ts`.
- Las opciones de cada consulta viven en `src/datos/consultas.ts`; los
  `loader` de las rutas las precargan y el enrutador precarga al pasar el
  ratón o enfocar un enlace (`defaultPreload: 'intent'`).
- Tiempo real: un único WebSocket por usuario (`escucharTiempoReal`) con
  billete, como define el contrato; reparte progreso, unidades nuevas, fin de
  tareas y alertas.

## 6. La ingesta que se siente rápida

`src/datos/ingesta.ts` y `src/trabajadores/imprenta.worker.ts`:

1. La tarjeta aparece en el mismo fotograma en que se suelta el archivo.
2. `POST /subidas` y, **en paralelo**, la subida del original (por partes si es
   grande, con `subirFichero` del contrato) y la conversión en el navegador con
   `convertir()` de `@scholaris/imprenta/navegador`, dentro de un Web Worker.
3. Las miniaturas que rasteriza la imprenta se enseñan al instante: el usuario
   ve sus páginas en segundos (un libro de 245 páginas, en unos 3 s). Las
   partes suben por tandas de 24 con 6 en vuelo; al final, `paquete.json` y
   `POST /subidas/:id/ingestar { paquete }`.
4. Después, cada evento `unidades` del tiempo real marca páginas ya legibles:
   se pueden abrir y citar antes de que termine la ingesta («Leer ya»).
5. Varias fotos juntas se leen como las páginas de un mismo libro (con
   «Son sueltas» para deshacerlo). Un enlace pegado entra por `/subidas/url`.
6. Si la imprenta no puede con un formato, convierte el servidor.

La mesa de entrada se conoce antes del primer pintado (el `loader` de la
Biblioteca espera a `recuperarTareas()`), así nada empuja la rejilla después.

**Vista previa local** (`src/datos/previa.ts`). Las páginas que imprime el
navegador (imagen y capa de texto) se guardan en memoria ligadas al documento, y
el lector las enseña mientras el servidor todavía lee, marcadas «Vista previa».
Después las sustituyen las unidades provisionales del servidor (evento
`unidades`) y, al final, las definitivas.

Otras decisiones de la ingesta:

- La huella SHA-256 se calcula antes de subir: un fichero repetido no se vuelve a
  subir ni a leer («Ya estaba en tu biblioteca»).
- Con paquete, `ingestar` se llama en cuanto termina la imprenta; el original
  sigue subiendo en paralelo.
- «Buscar ya» aparece en la tarjeta en cuanto hay unidades buscables y abre
  Buscar filtrado a ese documento (`/buscar?doc=`).
- Modo de lectura rápido o económico, en el menú «Añadir» y en Ajustes.

**Tiempos percibidos medidos** (tres hitos que la web anota en
`window.__hitos` y en `performance.mark`: se ve la página 1, se lee su texto,
se puede buscar):

| Entrada | Dónde | Se ve | Se lee | Se busca |
|---|---|---|---|---|
| PDF digital, 15 pp | local | 0,5 s | 0,5 s | 24,6 s |
| PDF digital, 37 pp | Cloudflare | 2,1 s | 2,1 s | 36,6 s |
| Escaneado, 43 pp | local | 0,7 s | 6,6 s | 47,5 s |
| Escaneado, 43 pp | Cloudflare | 1,8 s | 39,6 s | 5 min 11 s |
| MP3, 1 min | local | — | — | 5,8 s |
| Vídeo, 54 min (74 MB) | local | — | — | 51 s |

Antes de esta tanda, «se lee» era igual a «se busca» (había que esperar a toda
la ingesta). Los tiempos de la nube dependen del servidor.

## 7. El lector

- Página e imagen en la **misma fila virtualizada**: el desplazamiento va
  sincronizado por construcción y solo existen (y solo se descargan) las
  páginas visibles y las vecinas. Las filas se colocan con `top`, no con
  `transform`, para que el folio pegado (`position: sticky`) funcione.
- El folio impreso está siempre a la vista: en la barra del lector y pegado
  arriba de cada página. Pulsarlo es «ir a»: acepta «145», «xiv» o «[153]»
  (física), y en medios «12:04».
- Seleccionar texto abre la barra **Citar** (copia «pasaje» + cita en el estilo
  elegido con su localizador, también rangos «pp. 23-24»), **Parecidos** y
  **Al cuaderno**.
- La URL sigue a la lectura (`?u=`, `?t=`): cualquier momento se puede enlazar.
- Audio y vídeo (`src/componentes/reproductor/`): un solo motor para toda la
  aplicación, con una máquina de estados pura (cargando, esperando, buscando,
  error con reintentos que piden otra URL firmada y siguen en el mismo
  segundo). El elemento de medio cambia de sitio sin pararse: al salir del
  lector mientras suena, sigue en el reproductor pequeño. En escritorio, el
  escenario pegado a la izquierda (vídeo, o la onda del audio con un disco de
  Kandinsky), la línea del tiempo como una línea de Kandinsky (lo oído en tinta,
  los turnos de cada hablante en su color, los capítulos como círculos, el
  cabezal en tres círculos concéntricos, el fotograma clave al pasar), quién
  habla y las escenas; a la derecha, la transcripción virtualizada con karaoke
  por búsqueda binaria (sin renders por fotograma) que sigue a la voz y se
  aparta en cuanto la persona se desplaza. Cada hablante tiene forma y color
  (círculo azul, cuadrado rojo, triángulo amarillo). Seleccionar un pasaje lo
  cita con su intervalo exacto («9:50-9:56») o copia el enlace a ese minuto.
  Subtítulos WebVTT generados de la transcripción; velocidad sin cambiar el
  tono; imagen dentro de imagen; posición recordada por documento. Teclas:
  espacio o K, J/L ±10 s, flechas ±5 s, Mayús+flechas por líneas, [ ] la
  velocidad, M, F, C, I, 0-9. En el móvil, dos toques a un lado saltan 10 s y
  deslizar sobre el vídeo lo recorre.
- Ficha editable en el sitio con la procedencia de cada campo (leído, Crossref,
  OpenAlex, tú) y su confianza; lo dudoso se marca en amarillo.
- En pantallas estrechas el panel (índice, figuras, ficha) es una hoja que sube.

## 8. Rendimiento y accesibilidad

Medido con `vite build` y Lighthouse (build de producción con la demostración):

| Medida | Valor |
|---|---|
| JS inicial del marco (gzip) | **132 KB** (presupuesto: 150) |
| CSS (gzip) | 15 KB (más 36 KB de DM Sans, precargada) |
| Rutas | un trozo por ruta (2-12 KB gzip cada una) |
| Clerk | solo si la instancia lo pide, en su trozo (18 KB + clerk-js) |
| Imprenta y pdf.js | solo al soltar un archivo, dentro de hilos |
| Lighthouse escritorio | rendimiento 100 · accesibilidad 100 · CLS 0 |
| Lighthouse móvil (4G lenta simulada) | rendimiento 89 · accesibilidad 100 · buenas prácticas 100 · TBT 0 ms · CLS 0 |

Cómo se llega ahí: una sola fuente web (DM Sans, latín, precargada),
iconos propios, menús y diálogos del marco cargados con la intención (al pasar
o enfocar) y en tiempo ocioso, la paleta precargada en ocioso, el marco pintado
en `index.html` antes del JavaScript, esqueletos con la geometría final y
virtualización en todas las listas largas (rejilla, lista, páginas, tramos).

Accesibilidad: contraste AA en ambos temas, foco visible rojo en todo, enlace
«Saltar al contenido», menús y diálogos con Radix (foco atrapado, Escape),
paleta como `combobox` con `aria-activedescendant`, chips con `aria-pressed`,
avisos en región `aria-live`, controles táctiles de 44 px en el móvil y
atajos que no interfieren con los campos de texto.

## 9. Texto y números

- Los pasajes se enseñan limpios (`lib/texto.ts`): sin marcas de Markdown, con el
  LaTeX de los artículos convertido en algo legible y con puntos suspensivos de
  imprenta. El resaltado de la API se escapa y solo pasan las `<mark>`.
- El verso y el teatro conservan sus saltos de línea. En las transcripciones, los
  turnos «**Nombre:**» se convierten en cambios de hablante.
- Los números siguen a la RAE (`lib/numero.ts`): coma decimal y, desde cinco
  cifras, millares con espacio fino que no se parte (10 000; 1284 sin separar).
- Las citas de las respuestas aceptan `[n]` y `[^n]`. Las viñetas pasan a raya de
  enumeración.
- La ficha muestra el año de la obra frente al de la edición, el título original,
  la traducción, el contenedor («A fondo (RTVE)»), la edición, la colección y
  «s. f. (h. 1650-1670, según el impresor)», cada campo con su fuente.

## 10. Sesión

`/config` decide: con clave publicable de Clerk y `requiereAutenticacion`, la
web carga Clerk (vestido con los tokens, en español) y pasa `getToken` al
cliente; sin ella (versión local) es un solo usuario sin cuenta. En la nube,
Ajustes muestra la `PricingTable` de Clerk Billing.

## 11. Cómo trabajar

```
pnpm --filter @scholaris/web dev            # http://localhost:5180 (proxy /api → :8787)
pnpm --filter @scholaris/web build
VITE_FUENTE=simulada pnpm --filter @scholaris/web build   # demostración estática
```

`predev` y `prebuild` copian a `public/pdfjs/` las fuentes, cmaps y wasm que
pdf.js pide en tiempo de ejecución. Las rutas son ficheros en `src/rutas/`
(TanStack Router genera `arbol-rutas.gen.ts`).

## 12. Capturas comparadas

En `capturas/restauracion/`:

- `antigua/` tiene la Scholaris de producción (solo navegación, con el usuario
  de prueba);
- `nueva/` tiene la restaurada;
- `lado-a-lado/` pone las mismas pantallas, a la misma anchura, una junto a
  la otra (Biblioteca, Buscar, Escribir, Cuadernos, Mapa, Corpus, Vigilantes y
  Ajustes, más tres en móvil).

## 14. Movimiento y bocetos a mano

Todo se mueve, y siempre con el mismo lenguaje que el relieve: lo que se pulsa
se hunde en un instante y, al soltarlo, sube con un muelle que se pasa un pelo;
las tarjetas se despegan del papel; lo que entra se asienta; las citas se
estampan.

- **Muelles** (`src/movimiento/muelle.ts`): `soltar`, `levantar`, `asentar` y
  `sello`, con rigidez y amortiguación. Los mismos valores, convertidos en
  curvas `linear()`, son los tokens `--muelle-*` y `--dur-*` de `tema.css` (con
  `cubic-bezier` de reserva). Utilidades: `.tactil` (pulsar y soltar), `.levanta`
  (la sombra grande ya pintada en `::after`, solo cambia su opacidad),
  `.cascada` con `--i`, `anim-sube`, `anim-sello`, `anim-dobla`, `anim-vuela`,
  `anim-florece`, `anim-menu` (desde el ancla de Radix, y con salida).
- **Entre pantallas** (`transiciones.ts`): View Transitions sobre el contenido
  (la barra lateral no se mueve); la portada de la Biblioteca viaja a la barra
  del lector y vuelve; un resultado de Buscar crece hasta la columna de lectura.
  Sin la API, el contenido sube con la Web Animations API. Los cambios de
  `?u=`/`?t=` no animan nada.
- **Ayudas**: `useFlip` (uno solo, también en la paleta), `Cifra` (cuentas que
  corren, accesibles), `hojear` (la hoja que se pasa al saltar de página),
  `Arrastrable` (el reproductor pequeño, con inercia, a cualquier esquina).
- **Bocetos** (`src/bocetos/`): dibujos escritos a mano, coordenada a
  coordenada, con el motor de la portada (`src/dibujo/`, compartido). Cada uno es
  un trozo diminuto y se dibuja solo al entrar en pantalla: primero el lápiz,
  luego la pluma, el color y las notas. Están en los estados vacíos, la primera
  vez, la prensa de la ingesta, el caracol cuando algo tarda, la zona de soltar,
  404, error y sin conexión, las claves de API, las invitaciones, el compañero de
  cada cabecera y las notas al margen que salen una sola vez. Para mirarlos:
  `pnpm exec tsx src/bocetos/mesa.ts lupa,llave /tmp/l.html --cuadricula`.
- **Reglas**: solo `transform` y `opacity` (las excepciones son de un solo
  disparo y pequeñas: el subrayado que se entinta y el trazo de los bocetos);
  con `prefers-reduced-motion` todo aparece ya en su estado final (los bocetos,
  terminados); ningún dato vive solo en el movimiento. El marco sigue por debajo
  de 150 KB: los bocetos, el motor y el arrastre van en sus trozos.

Capturas en `capturas/movimiento/` (escritorio y móvil, claro y oscuro).
