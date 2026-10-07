# Banco de la interfaz web

Medido el 7 de octubre de 2026 desde el Mac de José Luis, con la red de casa y Chrome sin cabeza (playwright-core, `--mute-audio`). La app se midió en la instancia de pruebas (https://scholaris-v2.jlsf2005.workers.dev) con la cuenta de pruebas de Clerk dev, y las páginas públicas y Lighthouse también en producción. «Antes» es el commit 390cb1f; «después», d39c880, desplegado en las dos instancias.

Cada cifra es la mediana de 3 a 5 ejecuciones. Los tiempos de la app se toman con el reloj de la propia página, desde el `pointerdown` (o desde el inicio de la navegación) hasta que la pantalla tiene su contenido de verdad: la biblioteca con sus documentos, el lector con la imagen de la página o más de 300 caracteres de texto, y la sección con su título y sin esqueletos. Los guiones de medida están en `/tmp/auditoria` y no se versionan (llevan el inicio de sesión de la cuenta de pruebas).

## Lo principal

| Qué | Antes | Después |
|---|---|---|
| `/auth/yo`, `/ajustes`, `/bibliotecas`, `/claves`, `/invitaciones`, `/notificaciones` (API) | 680-830 ms cada una | **50-75 ms** |
| Primera visita a Ajustes | 823 ms | **237 ms** |
| Búsqueda completa en la API (orden definitivo, SSE) | 640-900 ms | **510-560 ms** |
| Búsqueda completa en la interfaz (de Intro a resultados sin «buscando») | 1141 ms | **916 ms** |
| Tras teclear el código de Clerk: barra y armazón | 1,7 s | 1,6 s |
| Tras teclear el código de Clerk: biblioteca con documentos | ~3,3 s | **~2,0 s** |
| CLS del lector de libros en el móvil (390 px) | **0,466** | **0,000** |
| Infracciones de axe-core (38 pantallas) | 17 | 0 |
| Fotogramas con la barra lateral a la derecha o sin barra al cambiar de sección | 0 | 0 |

El salto de la API venía de las cuentas en D1: cada petición creaba su `Cuentas` y repetía el esquema entero, unos 30 viajes a D1 en fila. Pasaba en cualquier ruta que tocara D1, también en la cuota de cada búsqueda. Ahora el esquema se comprueba una vez por aislamiento y en un solo lote, y las cuatro lecturas de las cuotas van a la vez.

## Todas las medidas

| Medida | Antes | Después |
|---|---|---|
| Portada `/` (sin sesión, pruebas): TTFB / LCP | 83 / 136 ms | 78 / 136 ms |
| `/acerca`: TTFB / LCP | 93 / 136 ms | 90 / 136 ms |
| `/en`: TTFB / LCP | 82 / 136 ms | 84 / 136 ms |
| Producción `/`, `/acerca`, `/en`: TTFB / LCP | | 74 / 120, 90 / 136 y 82 / 136 ms |
| Lighthouse `/` y `/en` en producción (rendimiento, accesibilidad, buenas prácticas, SEO) | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| Lighthouse `/` y `/en`: FCP, LCP, TBT y CLS (móvil simulado) | 1,0 s, 1,0 s, 0 ms, 0 | 1,0 s, 1,0 s, 0 ms, 0 |
| Arranque en frío con sesión hasta la biblioteca con documentos | 1400 ms | 1355 ms |
| Recarga (visita repetida) hasta la biblioteca con documentos | ~850 ms | ~835 ms |
| Cambio de sección por la barra (mediana de 9 cambios) | 49 ms | 27 ms |
| Lector en caliente, primera apertura: libro, escaneo y vídeo | 267, 297 y 213 ms | 79, 428* y 202 ms |
| Lector en caliente, apertura repetida | 27-50 ms | 29-50 ms |
| Lector en frío (enlace directo, contexto nuevo): libro, escaneo y vídeo | 971, 1411 y 1149 ms | 976, 1195 y 1108 ms |
| Búsqueda, primer orden en la API (vía léxica) | 72-311 ms | 61-264 ms |
| JS inicial (gzip) | 151,7 KB en 31 ficheros | 150,1 KB en 25 ficheros |
| CSS inicial (gzip) | 22,7 KB | 22,8 KB |
| Trozo de Clerk (`sesion-clerk`, gzip) | 19,6 KB | 20,7 KB (la localización completa) |
| Lector (`lector._id`, gzip) | 31,8 KB | 31,8 KB |
| Todo el JS (gzip, 121-127 ficheros) | 1,52 MB | 1,52 MB |

\* Ruido: es la primera apertura de la tanda y depende de si la miniatura ya estaba en la caché. Las repetidas están igual.

Las medidas antiguas que daba el banco (Playwright esperando a que las tarjetas dejen de moverse) inflaban la apertura del lector a unos 950 ms. Con el reloj de la página, desde el clic hasta el contenido, el lector en caliente tarda 25-50 ms; lo que se ve después es la transición de 500 ms, que es intencionada.

## Qué manda ahora

- **Clerk.** En frío, el SDK está listo a los 710-770 ms: `clerk-js`, su interfaz y `/v1/environment` y `/v1/client` contra la instancia de desarrollo. Los dos guiones se pedían uno tras otro y ahora se precargan a la vez (unos 40 ms menos hasta pedir `/v1/client`). La configuración guardada de la última visita se probó y se quitó: medida, no adelantaba nada (850 ms con ella y sin ella) y escondía el aviso de «sin servidor». En producción Clerk tiene su propio dominio y debería ir algo más rápido.
- **Búsqueda.** De los ~520 ms del servidor, unos 230 son Vectorize y unos 270 el reordenador. El primer orden (léxico) llega en 60-80 ms y la interfaz lo pinta en cuanto llega.
- **Lector en frío.** Es Clerk más 200-400 ms: el documento, el primer bloque y la primera imagen, todo en paralelo.

## La auditoría de la interfaz

Se recorrieron con capturas 31 pantallas en el escritorio y 7 en el móvil: biblioteca en rejilla y en lista; lector de libro, escaneo, libro con OCR antiguo, vídeo, audio y YouTube; el SPDF entero; Buscar, resultados, Preguntar, vigilantes e historial; Escribir y Cuadernos; las seis pestañas de Explorar; las cuatro de Ajustes; Invitaciones; Administración; y los enlaces rotos (recibir, lote, ruta y documento inexistentes). En cada una se pasaron axe-core y el CLS. Lo arreglado:

1. Un documento inexistente quitaba la barra lateral y decía «Algo se ha torcido» con «Reintentar». Ahora es el 404 de la casa, dentro del marco y sin reintento. Todos los errores y «no existe» de las secciones se pintan dentro del marco.
2. Un lote inexistente se quedaba en esqueleto para siempre.
3. En Perspectivas, si una columna no tenía datos o fallaba, quedaban tres títulos sin nada. Ahora cada columna tiene su estado vacío y su error con «Reintentar».
4. El límite de ritmo (429) dejaba columnas en blanco al moverse deprisa. El cliente espera lo que pide `Retry-After` y repite, hasta dos veces y como mucho 12 s.
5. En el lector del móvil, la primera página empujaba a las siguientes al medirse (CLS de 0,47). La altura estimada sale ahora del texto y del ancho real.
6. En el mapa de Explorar, los rótulos de los bordes se cortaban («Teatro clásico y épica hispáni»). Ahora se anclan dentro de la lámina.
7. En Ajustes, la cuenta enseñaba el id interno (`user_3KJv…`) y en el móvil lo montaba sobre el botón. Ahora enseña el nombre de la sesión o el correo, y el texto se parte.
8. La tabla de planes de Clerk salía con «Active», «Billed monthly» y «Renews…». Se completan las ~50 cadenas de facturación que la localización española de Clerk deja en inglés.
9. En Corpus, las décadas salían como «1950s-N» y el idioma como «desconocido» en minúscula. Ahora son «1950-59» y «Sin determinar».
10. En la biblioteca, mientras llegaba la lista, la cabecera decía «0 documentos · 0 colecciones · 0 páginas». Ahora es un esqueleto.
11. En Buscar y Preguntar, «Hace poco» repetía la misma consulta cuatro veces. Ya no hay repetidas.
12. En un enlace caducado el motivo repetía el titular («Este enlace ya no funciona. Este enlace ya no funciona: …»).
13. Accesibilidad: el botón «Copiar referencia» y los hablantes tenían un nombre accesible distinto del texto visible; los dos `aside` de la barra no tenían nombre; el SPDF entero tenía un `<main>` dentro de otro; en Privacidad un `h3` iba sin `h2`; y el titular de los estados vacíos es ahora un `h2`, que nunca salta niveles (era la última infracción, en el enlace caducado).
14. En la ficha, el idioma y el tipo de obra salían en crudo («es», «chapter»). Ahora salen con su nombre («Español», «Capítulo»); el idioma, con `Intl.DisplayNames`, también en Corpus y en la búsqueda en todas las lenguas.
15. Los temas del mapa salían sin tildes («Teatro aureo»). La instrucción del modelo exige la ortografía del español y una red barata pone las tildes que falten, también en los mapas ya hechos.
16. Las descripciones de Wikidata de Personas y obras se piden en español y el inglés queda de reserva; las ya enlazadas se corrigen en la siguiente pasada de enlaces.

## Lo que queda (fuera de la web)

- Los nombres y descripciones de los planes de Clerk Billing están en inglés en la instancia de desarrollo («Free», «All the features of Scholaris unlocked.»). Se cambian en el panel de Clerk, no en el código. En producción conviene comprobarlo con una cuenta real.
- La búsqueda definitiva depende de Vectorize y del reordenador. Para bajar de ~500 ms habría que reordenar menos candidatos o cachear la consulta vectorizada.
