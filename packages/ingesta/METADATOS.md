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

## Resultados (banco, 6 de octubre de 2026)

```
pnpm --filter @scholaris/bench exec tsx src/metadatos.ts
```

«Antes» es la ficha que dejó en los SPDF del banco el paso anterior (lectura más verificación en Crossref y OpenAlex). Está congelada en `bench/resultados/metadatos/antes.json`, porque los `.sqlite` se reescriben al volver a ingerir. «Después» es el paso actual con el refinado, sobre el texto ya leído de esos mismos SPDF. Las fichas de referencia están hechas a mano en `bench/src/metadatos.ts`.

| Campo | Documentos | Antes | Después |
|---|---|---|---|
| autores | 6 | 6/6 | 6/6 |
| título | 4 | 4/4 | 4/4 |
| año de la edición | 5 | 5/5 | 5/5 |
| año de la obra (el que usa la autocita) | 3 | 3/3 | 3/3 |
| editorial o impresor | 4 | 1/4 | 4/4 |
| lugar | 2 | 1/2 | 2/2 |
| tipo CSL | 6 | 5/6 | 6/6 |
| contenedor (libro, congreso, programa) | 4 | 0/4 | 4/4 |
| identificador (arXiv/DOI) | 1 | 0/1 | 1/1 |
| idioma | 1 | 1/1 | 1/1 |
| partícula («Lope» / «de Vega…») | 1 | 1/1 | 1/1 |
| «s. f.» con horquilla y fundamento | 1 | 0/1 | 1/1 |
| entrevistador (Soler Serrano) | 2 | 2/2 | 2/2 |
| **Total** | 40 | **29/40** | **40/40** |

Por documento:

- ***The Discarded Image*.** C. S. Lewis, Cambridge University Press, Cambridge, 1964. Según la página de créditos («First printed 1964 / Reprinted 1964»), la edición es la de 1964 y la obra también. Queda «reimpr. 1964» como mención de edición y se quita el ORCID falso de Lewis.
- ***Attention Is All You Need*.** 2017, *paper-conference*, contenedor «31st Conference on Neural Information Processing Systems (NIPS 2017)», `arxiv.org/abs/1706.03762` y DOI 10.48550/arxiv.1706.03762. Un primer intento cogía el arXiv de una referencia (1607.06450). Ahora solo vale el sello del margen y el registro tiene que casar.
- ***El perseguidor*.** Julio Cortázar, obra de 1959 (Wikidata y Open Library coinciden: confianza 0,95), *chapter* dentro de *Las armas secretas* (Wikipedia, entre las obras del mismo autor en Wikidata).
- ***El casamiento en la muerte*.** Lope de Vega Carpio, suelta impresa en Sevilla por la Viuda de Francisco de Leefdael. Sin año, «s. f.» con horquilla 1729-1753 (BNE, autoridad XX4965433, «fl. 1729-1753?») y confianza 0,6. Open Library proponía «1700» como año de la obra: era una edición suelta y se descarta.
- ***A fondo* (Cabral y Cortázar).** Emisión de RTVE de 1977, *broadcast*, contenedor «A fondo», con Joaquín Soler Serrano. Wikidata confirma que el programa estuvo en antena desde 1976 y que lo presentaba él. Si falta en el reparto, se añade sin quitar al invitado.

Con la red de casa y la caché vacía, cada documento tarda entre 1,4 y 5,9 s. El paso lanza en paralelo de 2 a 5 consultas a catálogos y una sola llamada al Redactor.

## Límites y notas honestas

- Son 6 documentos y 40 comprobaciones. Las fichas de referencia las hice yo, y el código se afinó mirando estos mismos casos. Hacen falta más documentos (traducciones con ISBN, tesis, capítulos de libros colectivos) antes de dar la cifra por general. Las pruebas unitarias (`test/enriquecimiento.test.ts`) cubren además una traducción con «©», una edición Canto con ISBN y una edición numerada en palabras, con respuestas reales recortadas de los catálogos.
- datos.bne.es y el CERL Thesaurus bloquean a los clientes automáticos (403 y un reto anti-bots). Por eso los años de los impresores salen de una tabla corta con fichas de autoridad comprobadas, más Wikidata, que casi no tiene impresores antiguos. Cada entrada nueva de la tabla tiene que llevar su fuente.
- La fecha exacta de cada emisión de *A fondo* no está en Wikidata. El año sigue saliendo de la lectura de la transcripción, y Wikidata solo comprueba que caiga dentro de los años en antena.
- `@scholaris/citas` todavía no imprime `contenedor`, `traductores`, `tituloOriginal` ni la horquilla de `sinFecha`. Están en el tipo (`MetadatosDocumento`), pero `csl/mapeo.ts` es de otro paquete. Además, con «s. f.» la autocita no tiene año y se salta el análisis temporal. Podría usar `sinFecha.hasta` como cota.
