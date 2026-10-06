# Capa de ortografía modernizada: resultados

Medido el 6 de octubre de 2026 con `bench/src/medir-normalizacion.ts`:

```
pnpm --filter @scholaris/bench exec tsx src/medir-normalizacion.ts
```

## Cómo se mide

- **Antes**: la base del banco devuelta exactamente a SPDF 4.0, sin la columna `texto_busqueda` y con el índice FTS5 de tres columnas reconstruido. El banco ya genera los SPDF en 4.1, así que el «antes» hay que reconstruirlo; leer el fichero tal cual daba un 100 % de exhaustividad que ya incluía la capa.
- **Después**: esa misma copia migrada con `aplicarEsquema`, la migración automática que hace también el Durable Object al abrir la estantería.
- Mismo motor (node:sqlite) y mismo buscador en los dos casos.
- **Verdad**: para cada consulta en grafía moderna, una expresión regular escrita a mano con todas las grafías de esa palabra que aparecen en el texto fiel (por ejemplo, `a[sſf]s?i|ansi|así` para «así»). La exhaustividad y la precisión se calculan con `buscarTexto` en modo «todas»; las dos últimas columnas cuentan los pasajes relevantes entre los diez primeros del `Buscador` con solo la vía léxica. «n/d» significa que la búsqueda no devolvió nada.
- Otros agentes regeneran los SPDF del banco durante el día, así que las cifras pueden moverse unas décimas entre ejecuciones; el orden de magnitud no cambia.

## Lope, «El casamiento en la muerte» (68 fragmentos, grafía del siglo XVIII)

Los 68 fragmentos reciben capa (la época se detecta por documento: el SPDF no trae año). La migración tarda 18 ms y la base pasa de 2,15 a 2,31 MB (+8 %).

| Consulta | Relevantes | Exhaustividad antes | después | Precisión antes | después | Relevantes en el top 10 (buscador) antes | después |
|---|---:|---:|---:|---:|---:|---:|---:|
| así | 29 | 0 % | 100 % | n/d | 100 % | 0 | 10 |
| corazón | 5 | 100 % | 100 % | 100 % | 100 % | 4 | 4 |
| mujer | 5 | 0 % | 100 % | n/d | 100 % | 0 | 5 |
| mujeres | 1 | 0 % | 100 % | n/d | 100 % | 0 | 1 |
| honra | 2 | 100 % | 100 % | 67 % | 67 % | 2 | 2 |
| cuando | 24 | 0 % | 100 % | n/d | 100 % | 0 | 10 |
| cual | 7 | 0 % | 100 % | 0 % | 88 % | 0 | 5 |
| cuántos | 4 | 0 % | 100 % | n/d | 50 % | 0 | 4 |
| dijo | 3 | 0 % | 100 % | n/d | 100 % | 0 | 3 |
| haber | 3 | 33 % | 100 % | 100 % | 100 % | 1 | 2 |
| caballeros | 12 | 67 % | 100 % | 80 % | 57 % | 7 | 7 |
| banderas | 8 | 63 % | 100 % | 100 % | 100 % | 3 | 5 |
| ejército | 2 | 0 % | 100 % | 0 % | 50 % | 0 | 1 |
| cajas | 8 | 0 % | 100 % | n/d | 100 % | 0 | 7 |
| prisión | 6 | 67 % | 100 % | 100 % | 100 % | 3 | 4 |
| cristiano | 3 | 0 % | 100 % | 0 % | 75 % | 0 | 3 |
| vasallos | 2 | 0 % | 100 % | n/d | 100 % | 0 | 2 |
| lejos | 3 | 0 % | 100 % | n/d | 25 % | 0 | 3 |
| reino | 8 | 63 % | 100 % | 100 % | 80 % | 5 | 8 |
| fe | 3 | 0 % | 100 % | 0 % | 43 % | 0 | 2 |
| acero | 4 | 0 % | 100 % | n/d | 100 % | 0 | 4 |
| Jimena | 5 | 0 % | 100 % | n/d | 100 % | 0 | 4 |
| pasó | 11 | 0 % | 100 % | n/d | 100 % | 0 | 9 |
| que | 65 | 100 % | 100 % | 100 % | 100 % | 10 | 10 |
| así es la muerte | 8 | 0 % | 100 % | n/d | 44 % | 4 | 5 |
| mi padre en prisión | 6 | 67 % | 100 % | 100 % | 100 % | 4 | 4 |
| banderas del ejército | 2 | 0 % | 100 % | n/d | 100 % | 1 | 1 |
| padre | 26 | 100 % | 100 % | 93 % | 93 % | 10 | 10 |
| muerte | 16 | 100 % | 100 % | 37 % | 37 % | 9 | 9 |
| sangre | 13 | 100 % | 100 % | 100 % | 100 % | 10 | 10 |

**Exhaustividad media por consulta: del 32 % al 100 %. Por pasaje: del 52 % al 100 %.** Las tres últimas consultas son de control (palabras que no cambiaron de grafía) y no se mueven.

La precisión baja en algunas consultas porque la clave junta formas vecinas: «cuántos» trae también «cuanto», «caballeros» trae «caballero», «lejos» trae «dejo». Casi siempre son pasajes que un filólogo querría ver. La de «muerte» y «así es la muerte» ya era baja antes: el modo «todas» también casa «muertes», y ahí «es» y «la» no se tratan como vacías. En el buscador real, los aciertos entre los diez primeros nunca bajan.

## Documentos modernos: sin regresión

Para cada documento se hicieron 50 consultas: las 25 palabras de cinco o más letras más frecuentes del propio texto, 10 pares de ellas y 15 genéricas («mujer», «honra», «así es la muerte», «hecho», «attention heads», «angels»…). Se comparan los diez primeros resultados de la vía léxica antes y después.

| Documento | Idioma | Fragmentos | Con capa | Consultas | Top 10 idéntico | Bytes antes → después |
|---|---|---:|---:|---:|---:|---:|
| cortazar-afondo | es | 157 | 0 | 50 | 50 | 13402112 → 13410304 |
| cortazar1959persegui | es | 87 | 0 | 50 | 50 | 2007040 → 2015232 |
| serrano | es | 67 | 0 | 50 | 50 | 4571136 → 4579328 |
| attention_2017 | en | 36 | 0 | 50 | 50 | 974848 → 983040 |
| discarded | en | 291 | 0 | 50 | 50 | 9994240 → 10010624 |

Ningún documento moderno recibe capa (`texto_busqueda = ''`), así que su índice no crece; solo aparece una página más, la del índice parcial. Las 250 búsquedas devuelven exactamente lo mismo, porque las variantes antiguas de la consulta se buscan solo en `texto_busqueda`, que en un texto moderno está vacía.

## Velocidad (M-series, Node 22)

| Texto | Normalización (en caliente) | `textoBusqueda` con detección de época |
|---|---:|---:|
| Lope, 1,7 MB | 37 MB/s | 13 MB/s |
| Latín, 0,35 MB | 70 MB/s | 51 MB/s |
| Prosa moderna en castellano | 36 MB/s | 32 MB/s |

Una prueba unitaria exige más de 5 MB/s.

## Decisiones

- **Clave en lugar de grafía moderna.** El texto y la consulta se reducen a la misma clave ortográfico-fonética: b/v, h muda, g/j y c/z ante e/i, qu+a/o como cu, y vocálica como i, consonantes dobles, rr tras n/l/s, n como m ante p/b, ſ como s y las abreviaturas con tilde o macrón desarrolladas. Así no hay que adivinar en qué sentido iba cada alternancia («Vanderas» y «banderas», «auer» y «haber», «honrra» y «honra»). Lo que cambió de forma va en listas: x como j en «dixo», «caxas» o «roxo», «fee», «agora», «mesmo», «truxo», contracciones como «desta», f- inicial como h-, grecismos en ch y latinismos.
- **Las dos columnas en FTS5.** El texto fiel sigue en la columna 0: resaltado, frases literales entre comillas y citas. `texto_busqueda` va la última, con peso BM25 de 0,9, y las variantes antiguas de la consulta se buscan solo en ella.
- **Época por documento.** Por año (`anioOriginal` o `anio`) o por las señales del texto (ſ, q̃, acentos graves castellanos, ç, -sse, palabras-testigo). Si un facsímil lleva año moderno, manda el texto. En el banco no hubo ningún falso positivo entre unos 800 fragmentos modernos.
- **Latín, siempre.** u/v, i/j, æ y œ como e, y como i, -cio como -tio, michi y nichil. Los enclíticos -que, -ne y -ve van como tokens aparte. Las raíces nominal y verbal de Schinke (de tres letras o más) se añaden al final del texto para no romper las frases.
- **Francés e italiano antiguos**, con reglas básicas: estoit como était, roy como roi, s muda, huomo como uomo, -tione como -zione, ct y pt como tt.

## Límites conocidos

- La ſ que el OCR leyó como f solo se repara en contextos seguros: f ante s, m, p, c, q o t (con excepciones como «nafta» u «oftalmo»), -rfe final y una lista corta. «refulta» se queda sin arreglar.
- La fusión b/v y la h muda acercan pares como «hecho» y «echo» dentro de los textos antiguos; en los modernos no, porque no tienen capa.
- Si cambian las reglas (`VERSION_NORMALIZACION`), hay que recalcular la capa: basta con `UPDATE fragmentos SET texto_busqueda = NULL` y volver a abrir la base.
