# Metadatos conscientes de la edición

La autocita necesita saber de cuándo es la obra y no solo de cuándo es el ejemplar. Una traducción de 2002 de un libro de 1975 piensa en 1975. Por eso la ficha distingue dos años: `anio` es el de la edición que se tiene delante y `anioOriginal` es el de la primera publicación de la obra. La lógica temporal de `@scholaris/citas` ya usa `anioOriginal ?? anio` (`autocita.ts`, `anioDe`), así que no hizo falta tocarla.

## Cómo se hace

1. **Lectura.** Un Redactor lee las primeras páginas y, ahora, también las últimas. Devuelve los campos de siempre más el título original, los traductores, la mención de edición, la colección, el contenedor y la lengua original.
2. **Créditos y colofón sin modelo** (`src/enriquecimiento/colofon.ts`). Solo se leen la primera página con texto y las que llevan señales de créditos, de modo que las referencias y el cuerpo quedan fuera. De ahí salen:
   - el ISBN con su dígito de control comprobado y el depósito legal;
   - los «©» (el más antiguo del original, en una traducción, da el año de la obra), «Título original», «Traducción del francés de…»;
   - «Primera edición» frente a «primera edición en esta colección» o «en español», «Esta edición», ediciones numeradas («vigesimonovena edición, 2001»), «Reprinted», «Canto edition 1994»;
   - el pie de imprenta antiguo («Con licencia: En Sevilla, en la Imprenta de la VIVDA de…»), aunque venga partido en varias líneas;
   - el sello de arXiv del margen (nunca una referencia) y el congreso del pie («NIPS 2017»).
3. **Catálogos abiertos** (`src/enriquecimiento/fuentes.ts`). Todos son gratuitos y sin clave. Las consultas llevan un User-Agent con contacto, tienen un plazo de 8 s y pasan por una caché que puede ser persistente.
   - Open Library por ISBN: la edición (año, editorial, lugar) y la obra (`first_publish_year`, solo a partir de 1830, porque antes cataloga ediciones sueltas).
   - Wikidata: año de la obra, lengua original y autor con nacimiento y muerte (un año anterior a que naciera el autor se descarta). En los programas de radio y televisión da la cadena, el presentador y los años en antena.
   - Wikipedia: en qué libro del mismo autor salió un cuento («incluido en su colección Las armas secretas»).
   - arXiv y DataCite: identificador y DOI de arXiv. El registro tiene que casar en título y autores aunque el identificador venga del PDF.
   - OpenAlex: ORCID de los autores. No se aplica a obras anteriores a 1990, porque OpenAlex le daba uno a C. S. Lewis.
   - Google Books queda como último recurso: sin clave suele responder 429.
4. **Impresos sin fecha** (`src/enriquecimiento/impresores.ts`). La horquilla de «s. f.» solo se pone si hay pruebas: los años de actividad del impresor según una ficha de autoridad comprobada (BNE) o Wikidata. En «Viuda de X» se usa como cota inferior la muerte de X. Se guarda en `sinFecha` con su fundamento y una confianza baja (0,6). `anio` se queda vacío.
5. **Fusión.** Se hace campo a campo, con fuente y confianza por campo (`procedencia`). Lo que editó el usuario gana siempre. Si dos fuentes independientes dan el mismo año de la obra, este se afianza. Si la obra sale posterior a la edición, cede el dato menos fiable. Los autores corporativos («RTVE», «Real Academia Española») van enteros, y las partículas y los dobles apellidos se respetan («de Vega Carpio», «Soler Serrano»).
6. **Refinado con el libro entero.** Al consolidar, `refinarConLibroEntero` vuelve a leer créditos y colofón con las 12 primeras y las 3 últimas páginas con texto. Solo repite el paso si aparecen pruebas nuevas (ISBN, pie de imprenta, ©…). El colofón del *Casamiento* está en la última página, no en las cinco primeras.

## Emisiones: el episodio, no el programa

En audio y vídeo la ficha es la del episodio (`fichaDeEmision` en `src/enriquecimiento/index.ts`):

- `contenedor` es el programa («A fondo») y `editorial`, quien lo emite («RTVE», sacado de Wikidata, que da la cadena, su dueño, el presentador y los años en antena);
- `titulo` es el del episodio en el catálogo de RTVE Play («Julio Cortázar», `src/enriquecimiento/rtve.ts`, API pública sin clave). Si no hay catálogo, es el nombre de los invitados, como hace RTVE, y el subtítulo «Entrevista a…» se quita;
- `autores` son los entrevistados y `entrevistadores`, quien pregunta (el presentador según Wikidata o la descripción del episodio: «Joaquín Soler Serrano entrevista al…»). En CSL va como `interviewer`;
- `anio` y `fecha` son los de la emisión del catálogo. Así salió un error real: la entrevista a Facundo Cabral se emitió el **2 de julio de 1978**, no en 1977 como decía la ficha anterior (la lectura lo sacaba del nombre del archivo, «serrano1977fondo»). La de Cortázar es del 20 de marzo de 1977;
- en un vídeo de una serie (3Blue1Brown), el capítulo es el título («Vectors») y la serie, el contenedor.

**Nada sin pruebas de la grabación.** En el preview, una entrevista a Facundo Cabral salió como «Entrevista a Alberto Cortez». El episodio del catálogo se elige ahora por lo que respalda la propia grabación:
- cuántas veces se nombra en la transcripción entera a la persona del título del episodio;
- si es uno de los hablantes con nombre (solo suma si además se le nombra, porque ese nombre también lo puso un modelo);
- si la duración cuadra con la del catálogo (entre el 40 % y el 115 %).

El mejor episodio tiene que sacarle al segundo al menos el triple; si no, no se asigna ninguno y el motivo queda en la procedencia. Un invitado que la transcripción no nombra se descarta, y el título que lo nombra también. El banco tiene este caso: la entrevista a Cabral subida como «A fondo - Alberto Cortez.mp4» sale «Facundo Cabral», 2-7-1978, con 303 puntos frente a 13.

Para rehacer solo la ficha de un documento ya leído, sin volver a leerlo: `POST /documentos/:id/metadatos/rehacer` (en el cliente, `documentos.rehacerMetadatos(id)`). Usa `rehacerFicha` y conserva lo que editó el usuario.

## Rehacer nunca empeora

`rehacerFicha` mezcla la ficha nueva con la que ya había, campo a campo (`noEmpeorar`):
- un valor nuevo sustituye al existente solo si trae más confianza, con un margen de 0,05;
- un campo sin procedencia (las fichas migradas de la v1) cuenta como 0,85, así que la lectura (0,8) nunca lo pisa, y un catálogo con pruebas (RTVE 0,92-0,95, Wikidata con autor 0,88 o más) sí;
- un campo vacío nunca borra uno lleno, y lo del usuario no se toca;
- un tipo genérico («document») sí se puede mejorar.

Hay dos excepciones, porque «no empeorar» no puede proteger un valor falso:
- Si la identidad cambia con pruebas fuertes (otro episodio u otro invitado, con el título de un catálogo de confianza 0,9 o más y sin ningún autor en común), los campos que dependen de ella se sustituyen en bloque: título, subtítulo, autores, entrevistadores, fecha, año, contenedor y URL.
- En audio y vídeo, un autor o entrevistador que la transcripción no nombra nunca no sobrevive.

Los autores se limpian siempre: la misma persona aparece una sola vez («Sanderson, Grant» y «Grant Sanderson (3Blue1Brown)» son la misma), y un canal («3Blue1Brown») nunca es un apellido, sino la editorial.

Además, ni una clave del almacén («original», «paquete») ni un título genérico («Entrevista», «Vídeo») valen como título. La ruta ya no pasa la clave del original como nombre de archivo. Esto salió de regresiones reales en producción (Iconologia titulada «original», Cela como «Entrevista», años y autores perdidos), que están reconstruidas en `test/rehacer.test.ts`. El banco mide también «rehecho sobre antes»: 54/55, y ningún campo empeora.

## Una reseña no es la obra

En producción, el capítulo I del *Quijote* (sin DOI) salió con el DOI 10.2307/3716615, *The Modern Language Review* 44 (4), p. 577, tipo `article-journal` y William J. Entwistle como primer autor. Era una reseña de 1949. En OpenAlex se titula igual que la novela y lleva a Cervantes como autor, detrás del reseñista. La verificación antigua se conformaba con un título casi igual y un apellido en común, y en un libro aceptaba otro año («una reedición»), así que puntuaba 0,93 sobre un umbral de 0,78. Además, la búsqueda de Crossref nunca había funcionado: pedía `language` en `select`, que no existe en `/works`, y Crossref rechazaba la consulta entera con un 400.

Ahora un registro de Crossref u OpenAlex solo entra si pasa todas estas reglas (`src/pasos/metadatos/identidad.ts`):

- **Título.** Similitud normalizada de al menos 0,9. Se rechaza el registro que contiene el título de la obra con algo delante («Notes on…», «Voces de Cervantes en…»), el que sigue sin separador («… y la crítica romántica»), el que añade otro subtítulo, el que lleva palabras de reseña, estudio, nota, edición ajena o fe de erratas que el documento no tiene («review», «reseña», «estudio», «edición de», «al cuidado de»…) y el que nombra al autor dentro del título («Cervantes, Miguel de: Don Quijote…»).
- **Autor.** El primer autor del registro tiene que estar en el documento y el primero del documento, en el registro. Así cae la reseña de JSTOR, donde el reseñista va primero. Los nombres de pila tienen que ser compatibles: «C. S.» no es «Cynthia» (OpenAlex le atribuye *The Discarded Image* a una Cynthia Lewis). Sin autores en un lado no hay pruebas, y el registro no entra.
- **Tipo.** Un libro no es un capítulo ni un artículo, y un capítulo no es un artículo de revista. Una obra anterior a 1850 nunca es un artículo, lea lo que lea el modelo. Las reseñas, las entradas de enciclopedia, las fe de erratas, los números de revista y los tipos «other» o «paratext» nunca son el documento.
- **Año.** Tiene que ser el de la edición que se tiene delante (±1). Sin año de la edición en el documento no hay pruebas, y un registro anterior a la propia obra se descarta.
- **Edición.** En libros y capítulos, si el documento muestra una editorial o un ISBN, el registro no puede traer otros.
- **DOI.** Si el documento muestra un DOI, se consulta ese en Crossref. Vale si el título se parece y los autores no chocan, o si casan el autor y el año. Si resuelve a otra obra (una referencia, la obra reseñada), se quita. Un DOI que el modelo dice leer y que no está en el texto ni en la ficha del archivo no cuenta como impreso. El lector de créditos ya no toma el DOI de los datos del artículo («Data Availability Statement: … Figshare»), y DataCite quita el DOI si resuelve a otra cosa.

Si un registro no pasa, no entra nada de él. El DOI, la revista, el volumen, el número y las páginas van en bloque: salen de las fuentes que dan ese mismo DOI (o, sin DOI, de la que da la revista) y solo pueden completarse con lo impreso en el propio documento, nunca con otro registro. La procedencia de la verificación guarda qué catálogos respondieron y los primeros rechazos con su motivo.

Con el mismo criterio se revisan los demás catálogos. Open Library por ISBN descarta el registro si su título no es el del documento (el ISBN del original en una traducción, el de otra obra) y no da años de obra anteriores a 1830. Open Library por título, Wikidata y Google Books piden el mismo título, sin reseñas ni estudios, y una obra que no sea posterior a la edición. Wikidata descarta además los artículos científicos, las reseñas, las ediciones, las tesis y las desambiguaciones. arXiv sin sello impreso solo da su DOI con el autor y el año confirmados. Ningún catálogo se consulta por un título sacado del nombre del archivo.

Al rehacer la ficha, el bloque de la publicación se queda o se va entero. Si la ficha anterior tenía campos de Crossref u OpenAlex y la verificación de ahora, con respuesta de esos catálogos, ya no confirma ese registro, esos campos no se protegen. Así se limpia una ficha estropeada como la del *Quijote*. Un DOI que figura en el texto del documento se respeta siempre. Sin respuesta de los catálogos no se quita nada.

Las pruebas (`test/identidad.test.ts`) usan respuestas reales de Crossref y OpenAlex grabadas el 7 de octubre de 2026 (`test/datos/catalogos-quijote-zipf.json`). Recogen el *Quijote* con cuatro lecturas posibles (capítulo con el año de la obra, libro sin año, sin tipo, libro con un año cualquiera), la ficha estropeada que se limpia al rehacer y un artículo con DOI (Corral, Boleda y Ferrer-i-Cancho, *PLoS ONE*, 2015, CC-BY). El artículo conserva su DOI impreso y lo recupera por búsqueda si no está impreso, pero no si el documento no muestra el año. Con el código anterior, la prueba del *Quijote* reproduce el fallo exacto.

## Resultados (banco, 6 de octubre de 2026)

```
pnpm --filter @scholaris/bench exec tsx src/metadatos.ts
```

«Antes» es la ficha que dejó en los SPDF del banco el paso anterior (lectura más verificación en Crossref y OpenAlex). Está congelada en `bench/resultados/metadatos/antes.json`, porque los `.sqlite` se reescriben al volver a ingerir. «Después» es el paso actual con el refinado, sobre el texto ya leído de esos mismos SPDF. Las fichas de referencia están hechas a mano en `bench/src/metadatos.ts`. Las de las emisiones están comprobadas en RTVE Play.

| Campo | Documentos | Antes | Después |
|---|---|---|---|
| autores (en emisiones, solo los entrevistados) | 7 | 7/7 | 7/7 |
| título (en emisiones, el del episodio) | 7 | 5/7 | 7/7 |
| año de la edición o de la emisión | 5 | 4/5 | 5/5 |
| año de la obra (el que usa la autocita) | 3 | 3/3 | 3/3 |
| editorial, impresor o cadena | 4 | 1/4 | 4/4 |
| lugar | 2 | 1/2 | 2/2 |
| tipo CSL | 6 | 5/6 | 6/6 |
| contenedor (libro, congreso, programa, serie) | 5 | 0/5 | 5/5 |
| identificador (arXiv/DOI) | 1 | 0/1 | 1/1 |
| idioma | 1 | 1/1 | 1/1 |
| partícula («Lope» / «de Vega…») | 1 | 1/1 | 1/1 |
| «s. f.» con horquilla y fundamento | 1 | 0/1 | 1/1 |
| entrevistador aparte (Soler Serrano) | 2 | 0/2 | 2/2 |
| sin el invitado falso (nombre de archivo engañoso) | 1 | 0/1 | 1/1 |
| **Total** | 52 | **28/52** | **52/52** |

Por documento:

- ***The Discarded Image*.** C. S. Lewis, Cambridge University Press, Cambridge, 1964. Según la página de créditos («First printed 1964 / Reprinted 1964»), la edición es la de 1964 y la obra también. Queda «reimpr. 1964» como mención de edición y se quita un ORCID falso que OpenAlex le daba a Lewis.
- ***Attention Is All You Need*.** 2017, *paper-conference*, contenedor «31st Conference on Neural Information Processing Systems (NIPS 2017)», `arxiv.org/abs/1706.03762` y DOI 10.48550/arxiv.1706.03762. Un primer intento cogía el arXiv de una referencia (1607.06450). Ahora solo vale el sello del margen y el registro tiene que casar.
- ***El perseguidor*.** Julio Cortázar, obra de 1959 (Wikidata y Open Library coinciden: confianza 0,95), *chapter* dentro de *Las armas secretas* (Wikipedia, entre las obras del mismo autor en Wikidata). Sin pruebas de la edición que se tiene delante, se cita la primera del libro: Editorial Sudamericana, Buenos Aires (ficha de Wikipedia y sede de la editorial en Wikidata, confianza 0,7).
- ***El casamiento en la muerte*.** Lope de Vega Carpio, suelta impresa en Sevilla por la Viuda de Francisco de Leefdael. Sin año, «s. f.» con horquilla 1729-1753 (BNE, autoridad XX4965433, «fl. 1729-1753?») y confianza 0,6. Open Library proponía «1700» como año de la obra: era una edición suelta y se descarta.
- ***A fondo*.** «Facundo Cabral» (2-7-1978) y «Julio Cortázar» (20-3-1977), las dos de RTVE, *broadcast*, contenedor «A fondo», con el entrevistado como autor y Joaquín Soler Serrano como entrevistador. Cada una lleva su dirección de RTVE Play.
- **3Blue1Brown.** «Vectors», contenedor «Essence of linear algebra», Grant Sanderson.

Con la red de casa y la caché vacía, cada documento tarda entre 1,1 y 5,9 s. El paso lanza en paralelo de 2 a 5 consultas a catálogos y una sola llamada al Redactor. Las emisiones se midieron cuatro veces seguidas, con el mismo resultado.

El 7 de octubre de 2026, con la frontera de identidad y con Crossref respondiendo por primera vez, el banco da lo mismo: 55/55 después y 54/55 al rehacer, sin ningún campo que empeore. Las búsquedas devuelven ahora muchos registros que tratan de las obras (estudios de *El perseguidor*, ediciones reseñadas de Lope, cinco copias de *Attention* fechadas en 2025, una «Cynthia Lewis» como autora de *The Discarded Image*) y todos se rechazan con su motivo, que queda en `informe.json`. Solo entra uno: el de OpenAlex para *The Discarded Image* (C. S. Lewis, 1964, Cambridge University Press), que confirma los valores que ya había.

## Límites y notas honestas

- Son 8 casos (7 documentos) y 52 comprobaciones. Las fichas de referencia las hice yo, y el código se afinó mirando estos mismos casos. Hacen falta más documentos (traducciones con ISBN, tesis, capítulos de libros colectivos) antes de dar la cifra por general. Las pruebas unitarias (`test/enriquecimiento.test.ts`) cubren además una traducción con «©», una edición Canto con ISBN y una edición numerada en palabras, con respuestas reales recortadas de los catálogos.
- OpenAlex sin clave agota un presupuesto diario por IP («Rate limit exceeded»); en Workers la IP es compartida. El paso sigue, pero sin esa fuente. Con una clave gratuita se evitaría.
- datos.bne.es, el CERL Thesaurus y DBLP bloquean a los clientes automáticos (403 y un reto anti-bots). Por eso los años de los impresores salen de una tabla corta con fichas de autoridad comprobadas, más Wikidata, que casi no tiene impresores antiguos. Cada entrada nueva de la tabla tiene que llevar su fuente.
- Solo RTVE tiene catálogo de episodios. En otras cadenas y en los pódcast, el título del episodio sale de la lectura o del nombre de los invitados, y el año, de la transcripción. YouTube sin clave no da metadatos.
- `@scholaris/citas` ya imprime el contenedor, los traductores, el título original, la horquilla de «s. f.» y, desde ahora, el entrevistador. Con «s. f.», la autocita no tiene año y se salta el análisis temporal. Podría usar `sinFecha.hasta` como cota.
