# Banco privado de calidad de búsqueda y citas

> Este es el resumen del banco grande con el que se ajustó el buscador. Sus documentos (libros y entrevistas con derechos de autor) y sus juicios, que citan pasajes de esos documentos, no se publican; viven en `bench/datos/calidad/juego/`, fuera de git, y se ejecutan con `SCHOLARIS_BANCO=privado pnpm bench calidad`. El banco que cualquiera puede reproducir está en [`bench/calidad`](calidad/RESULTADOS.md).

Mide la búsqueda (`packages/busqueda`), la autocita y la verificación (`packages/citas`) y los folios impresos sobre una biblioteca real: los SPDF 4 de *The Discarded Image* (245 págs., EN), *Attention Is All You Need* (EN), *El perseguidor* (ES), *El casamiento en la muerte* (escaneado del XVII), las entrevistas de *A fondo* con Facundo Cabral (54 min) y Julio Cortázar (2 h), el corto de 3Blue1Brown, su audio y la carta escaneada de Slerexe.

```
pnpm bench calidad                    # ejecuta todo y anota aquí (--latencia --citas --minimo ndcg=0.85,inventadas=0,latencia=700)
pnpm bench calidad experimentos <g>   # barridos: vias, rrf, pesos, lexica, lexexp, reordenar, rapidez, unidad, contiguos, expansiones, vista
pnpm bench calidad revisar            # confirmar o corregir juicios a mano (--dudosos, --relevantes, --consulta q012, --muestra 30)
pnpm bench calidad estanteria [--actualizar] · remapear · pool · juzgar · citas-proponer · citas-juzgar
```

## El juego

- **183 consultas** (`consultas.json`): 133 en español, 43 en inglés, 3 en latín; 49 entre lenguas, 49 conceptuales, 33 factuales, 32 citas literales, 18 sobre lo que se dice en audio o vídeo, 10 de grafía antigua o latín, 10 entre documentos, 10 con filtro de autor o época, 10 de «ir a la página N» y 4 visuales. Gemini propuso un borrador por documento leyendo el texto entero; lo revisé, reescribí 23 consultas demasiado calcadas del texto, comprobé que las 32 frases literales están de verdad en la biblioteca (tres no lo estaban y se corrigieron) y añadí a mano las cruzadas, las de filtro, las de página y las visuales.
- **Juicios «plata»** (`juicios.json`, 8 879 pares): por *pooling*, la unión de los 20 primeros de nueve sistemas (cada vía sola, la fusión, con y sin comprensión, con y sin reordenador, el buscador de antes y el actual). Cada par lo juzgan dos modelos con la misma rúbrica 0-3: Gemini 3.8 Flash y DeepSeek V4 Pro (OpenRouter). Si discrepan 2 puntos o cruzan la frontera de «relevante» (1 frente a 2), decide Gemini Pro viendo los dos motivos; si no, la nota es la media. Acuerdo entre los dos jueces: 82 % exacto, 99 % a ±1, 95 % en relevante/no relevante. Revisé a mano una muestra estratificada de 30 juicios: estoy de acuerdo con 29. Las consultas de página se juzgan por regla (los fragmentos que cubren la página pedida). Costó unos 7 $.
- **Citas** (`citas.json`): 41 afirmaciones escritas como en un trabajo: 30 con respaldo (oro ampliado con el pool y los dos jueces) y 11 negativas (contradichas por el documento o ajenas a la biblioteca). Una propuesta decía «entre Saint-Michel y Odéon» y el texto dice «Odéon y Saint-Germain-des-Prés»; los jueces la rechazaron con razón y la corregí. Una cita es **inventada** si su fragmento no existe, es de otro documento, su rango de páginas no cubre el del fragmento o su evidencia no está literalmente en el pasaje.
- **Folios** (`folios.json`): 64 páginas comprobadas a ojo sobre la imagen (cabecera y pie): romanos, portadas, blancos, sobrecubierta, guardas y contratapas.

La estantería se congela en `bench/datos/calidad/fuentes` (los SPDF de `bench/datos/salida` se reescriben con cada ingesta). Si se actualiza, `remapear` lleva los juicios a los fragmentos nuevos por la huella del texto y `pool` + `juzgar` completan solo los pares nuevos.

Métricas: nDCG@10 con ganancia 2^nota − 1; Recall@20 y MRR con «relevante» = nota ≥ 2. Lo no juzgado cuenta como 0 (la columna «top-10 juzgado» avisa si el pool se queda corto).

## Lo que se cambió con estos datos

| Cambio | Efecto medido aislado en nDCG@10 (no se suman) | Por qué |
|---|---|---|
| Buscador de antes (k = 60, léxica 0,8, vectores de página 0,3, fundir contiguos, 0,85 por unidad, comprensión, Jev 0,7) | 0,698 | |
| Sin fundir fragmentos contiguos | +0,07 | Al fundir, se quedaba el vecino peor; Recall@20 de 0,66 a 0,82 |
| k de la fusión 10 en vez de 60 | +0,05 | Con listas cortas y buenas, k = 60 aplana la diferencia entre el 1.º y el 20.º |
| Léxica a 0,35 y solo con la consulta original | +0,01 | La densa sola (0,80) ganaba a cualquier fusión con la léxica a 0,8; la léxica sigue salvando las citas literales y la grafía antigua |
| Vectores de página fuera de las consultas de texto | +0,01 | La vía visual sola da 0,20; en Attention, El perseguidor y Lewis restaba (0,723 frente a 0,751 sin reordenar) |
| Cita literal: los pasajes exactos primero y detrás los afines | +0,04 | El pasaje exacto ya salía 1.º (MRR 1), pero la lista se quedaba en 1-2 resultados |
| Jev con peso 0,8 | +0,07 | Jev es el mejor reordenador medido; ver abajo |
| Sin comprensión por defecto | +0,02 | Las expansiones (paráfrasis, HyDE, traducciones) no mejoran: Gemini Embedding 2 ya busca entre lenguas (entre lenguas 0,90 con y sin traducciones) y la segunda ronda de vectores alarga la búsqueda |
| **Buscador actual** | **0,889** | Recall@20 0,617 → 0,906; MRR 0,926 → 0,980 |

**Reordenadores** (sobre la mejor fusión, 0,771 sin reordenar): Jev 0,835 (peso 0,9), 0,832 (0,7); Flash-Lite por lista 0,788 y ~1 s; bge-m3 de Workers AI 0,770 (0,5) y peor con más peso; bge-reranker-base 0,758. Solo Jev compensa su latencia (~290 ms). Partir sus 30 pasajes en peticiones de 10 en paralelo ahorra unos 70 ms en llamadas sueltas; recortar los pasajes a 1 000 caracteres o reordenar 15-20 en vez de 30 apenas cambia la latencia y baja el nDCG.

**Latencia** (red de casa, sin cachés, consultas en serie): p50 ~650 ms = vector de la consulta con Gemini (~360 ms) + Jev (~300 ms), que no se pueden solapar: Jev necesita los candidatos densos. Sin reordenar, p50 ~350 ms con nDCG 0,818. `alPreliminar` entrega el orden de la fusión antes de reordenar, para pintar resultados a los ~350 ms y sustituirlos al llegar los definitivos. Las citas literales siguen sin modelo (FTS + un vector).

**Pendiente de revisar a mano**: `pnpm bench calidad revisar --dudosos` (los 1594 juicios con árbitro o discrepancia) y `--relevantes` en las consultas de grafía.
