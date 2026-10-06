# Scholaris · diseño de la web

La web de Scholaris v2: una biblioteca donde se suelta cualquier archivo, se lee
y cada cita apunta a la página impresa o al segundo exacto. Este documento
explica el sistema visual, la arquitectura de la interfaz y por qué es así.

## 1. La idea: una imprenta, no un panel de control

Scholaris trabaja con libros, y el usuario es alguien que lee y cita. La
interfaz se piensa como un taller de imprenta: papel cálido, tinta de café,
tres tintas Bauhaus que se usan con cuentagotas, Georgia para leer y para
mandar, y una monoespaciada que susurra los datos (folios, marcas de tiempo,
cifras). La pieza que distingue a Scholaris de cualquier otro gestor de PDF es
**el folio**: «p. 145», «12:04», «diap. 7». Por eso el folio tiene su propio
componente y aparece en todas partes con la misma forma (una raya roja y la
cifra en monoespaciada).

Doctrina de composición (Estética Saorín): una sola cosa enorme por pantalla
(el titular del lugar), una sola forma geométrica que muerde el borde (cuarto
de círculo rojo en Biblioteca, círculo azul en Buscar, triángulo amarillo en
Escribir, cuadrado girado en Explorar), retícula que se nota, grano de papel
muy fino. Nada de degradados, nada de sombras genéricas, nada de iconos de
librería: los iconos están dibujados para el sistema.

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

Definidos en `packages/ui/src/tema.css` como variables CSS y expuestos a
Tailwind v4 con `@theme inline` (utilidades `bg-papel`, `text-tinta`,
`border-filete`, `text-rojo`…). El tema oscuro cambia las variables bajo
`.oscuro`; se aplica en `index.html` antes del primer pintado, sin parpadeo.

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `papel` | `#F3EEE3` | `#1A1511` | fondo, nunca blanco puro |
| `hoja` | `#FAF7F0` | `#231C17` | superficies (tarjetas, campos) |
| `hondo` | `#E9E2D2` | `#120E0B` | huecos, pistas, esqueletos |
| `filete` / `filete-fuerte` | `#D9CFBD` / `#B9AA92` | `#3B3029` / `#5B4B3F` | líneas finas y bordes |
| `tinta` | `#22160F` | `#EFE6D6` | texto, botón principal |
| `tinta-2` | `#4F3C2F` | `#CBBBA6` | texto secundario |
| `apagado` | `#75614F` | `#A39079` | rótulos (contraste 5:1 sobre papel) |
| `rojo` | `#B8321C` | `#E7644A` | la acción («+»), el folio, lo activo |
| `azul` | `#23457A` | `#8FA9DC` | contrapunto excepcional |
| `amarillo` | `#E2A52A` | `#ECBB52` | alertas, aceptado, el lápiz que subraya |

Tipografía: Georgia para todo lo que se lee y se pulsa; `ui-monospace` para los
datos (`.rotulo`: 11 px, mayúsculas, espaciado 0,08 em). Los titulares usan
`.titular` (interletraje −0,035 em, interlineado 0,92). La lectura (`.lectura`)
va a 17 px con interlineado 1,62, partición silábica y sangría de párrafo como
en un libro; el tamaño se ajusta en Apariencia. Cero bytes de fuentes web.

Radios mínimos (3, 6 y 10 px), dos sombras («hoja» y «flota»), una curva de
animación (`--ease-imprenta`). Todas las animaciones se anulan con
`prefers-reduced-motion`.

## 4. Componentes (uno de cada)

`packages/ui` exporta exactamente un componente por función:

| Componente | Notas |
|---|---|
| `Boton` | variantes `tinta` (principal), `rojo` (la acción de la pantalla), `linea`, `fantasma`; tamaños `p`, `m`, `g`; `cargando`, `soloIcono`, `comoHijo` (aspecto de botón sobre un enlace del enrutador) |
| `Campo`, `AreaTexto`, `Selector`, `Etiquetado` | un solo estilo de campo; `tam="g"` es la caja grande de búsqueda; `Etiquetado` enlaza `label`, `id` y `aria-describedby` |
| `Tarjeta` | la hoja sobre el papel; `viva` reacciona al puntero |
| `Chip` | filtro conmutable (`aria-pressed`) o etiqueta con ✕ |
| `Folio` | el ancla de cita; `dudoso` cuando el folio se dedujo con poca confianza |
| `Rotulo`, `Filete`, `Teclas` | la monoespaciada, la regla de imprenta, las teclas |
| `Esqueleto`, `EsqueletoTexto`, `BarraAvance` | nunca un spinner: esqueletos con la forma de lo que viene, y una línea roja arriba mientras se navega |
| `Vacio` | el estado vacío: forma Bauhaus grande, titular, una frase, una acción |
| `Dialogo` | solo para lo irreversible (borrar la cuenta, borrar todo) |
| `MenuRaiz/…` | menús de Radix con el mismo vestido |
| `Interruptor`, `Consejo` | Radix Switch y Tooltip |
| `avisar`, `conDeshacer`, `Tostadora` | el único canal de avisos; **deshacer en lugar de confirmar** |
| `Icono` | 58 trazados propios de trazo fino y geometría Bauhaus |

Regla de borrado: lo que se puede deshacer no pide confirmación. Borrar un
documento, una tarjeta, un vigilante, una búsqueda del historial o revocar una
clave lo quita de la vista al instante y ofrece «Deshacer» durante 7 s; la
petición al servidor solo sale si nadie deshace.

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
- Audio y vídeo: reproductor arriba, transcripción palabra a palabra; cada marca
  de tiempo y cada palabra saltan a su instante; «Seguir la voz» se suelta al
  desplazarse a mano. Espacio reproduce, flechas saltan 10 s.
- Ficha editable en el sitio con la procedencia de cada campo (leído, Crossref,
  OpenAlex, tú) y su confianza; lo dudoso se marca en amarillo.
- En pantallas estrechas el panel (índice, figuras, ficha) es una hoja que sube.

## 8. Rendimiento y accesibilidad

Medido con `vite build` y Lighthouse (build de producción con la demostración):

| Medida | Valor |
|---|---|
| JS inicial del marco (gzip) | **127 KB** (presupuesto: 150) |
| CSS (gzip) | 11 KB |
| Rutas | un trozo por ruta (2-12 KB gzip cada una) |
| Clerk | solo si la instancia lo pide, en su trozo (18 KB + clerk-js) |
| Imprenta y pdf.js | solo al soltar un archivo, dentro de hilos |
| Lighthouse escritorio | rendimiento 100 · accesibilidad 100 · buenas prácticas 100 · CLS 0 |
| Lighthouse móvil (4G lenta simulada) | rendimiento 93 · accesibilidad 100 · buenas prácticas 100 · TBT 0 ms · CLS 0 |

Cómo se llega ahí: Georgia y la monoespaciada del sistema (cero fuentes),
iconos propios, menús y diálogos del marco cargados con la intención (al pasar
o enfocar) y en tiempo ocioso, la paleta precargada en ocioso, el marco pintado
en `index.html` antes del JavaScript, esqueletos con la geometría final y
virtualización en todas las listas largas (rejilla, lista, páginas, tramos).

Accesibilidad: contraste AA en ambos temas, foco visible rojo en todo, enlace
«Saltar al contenido», menús y diálogos con Radix (foco atrapado, Escape),
paleta como `combobox` con `aria-activedescendant`, chips con `aria-pressed`,
avisos en región `aria-live`, controles táctiles de 44 px en el móvil y
atajos que no interfieren con los campos de texto.

## 9. Sesión

`/config` decide: con clave publicable de Clerk y `requiereAutenticacion`, la
web carga Clerk (vestido con los tokens, en español) y pasa `getToken` al
cliente; sin ella (versión local) es un solo usuario sin cuenta. En la nube,
Ajustes muestra la `PricingTable` de Clerk Billing.

## 10. Cómo trabajar

```
pnpm --filter @scholaris/web dev            # http://localhost:5180 (proxy /api → :8787)
pnpm --filter @scholaris/web build
VITE_FUENTE=simulada pnpm --filter @scholaris/web build   # demostración estática
```

`predev` y `prebuild` copian a `public/pdfjs/` las fuentes, cmaps y wasm que
pdf.js pide en tiempo de ejecución. Las rutas son ficheros en `src/rutas/`
(TanStack Router genera `arbol-rutas.gen.ts`).
