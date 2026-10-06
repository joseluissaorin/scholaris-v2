# Banco de calidad de búsqueda y citas (público)

Mide la búsqueda (`packages/busqueda`), la autocita y la verificación (`packages/citas`) y los folios impresos sobre una biblioteca pequeña que cualquiera puede reproducir: todo es de dominio público o tiene licencia libre (`corpus.json` dice de dónde sale cada cosa).

- *El casamiento en la muerte y hechos de Bernardo del Carpio*, de Lope de Vega: una comedia suelta impresa en Sevilla hacia 1700, escaneada, con grafía antigua (q̃, ſ, u por v) y folios propios. Dominio público. El SPDF publicado lleva el texto leído, las anclas y los vectores, pero no las imágenes del escaneado.
- *OCR Error Post-Correction with LLMs in Historical Documents: No Free Lunches* (Kanerva, Ledins, Käpyaho y Ginter, arXiv:2502.01205, 2025): un artículo digital en inglés. CC BY 4.0.
- *El monte de las ánimas*, de Gustavo Adolfo Bécquer, en la lectura de Elena del Valle para LibriVox (19 min de audio). Dominio público.

```
pnpm bench calidad estanteria         # monta la estantería con los SPDF de bench/calidad/fuentes (sin ingerir nada)
pnpm bench calidad                    # ejecuta el banco y anota aquí (--latencia --citas --minimo ndcg=0.85,inventadas=0)
pnpm bench calidad experimentos <g>   # barridos: vias, rrf, pesos, lexica, lexexp, reordenar, rapidez, unidad, contiguos, expansiones, vista
pnpm bench calidad revisar            # confirmar o corregir juicios a mano
```

Hace falta `GEMINI_API_KEY` (los vectores de las consultas); con `TYPESAFE_API_KEY` se mide también el reordenador Jev, que es el de producción. Las claves se leen del entorno o de `~/.claude/.secrets/{gemini,openrouter,typesafe}.env`. Lo que se regenera (estantería, cachés, pool) va a `bench/datos/calidad-publica/`, fuera de git.

## El juego

- **66 consultas** (`consultas.json`): 21 sobre la comedia escritas y revisadas a mano en el banco grande (conceptuales, factuales, literales, de grafía antigua, entre lenguas, de filtro y de «ir a la página N»); 40 propuestas por Gemini leyendo el artículo y la transcripción entera, revisadas; y 5 escritas a mano (entre documentos, con filtro de autor o año y de página).
- **Juicios «plata»** (`juicios.json`): pooling con nueve sistemas y dos jueces con la misma rúbrica 0-3 (Gemini Flash y DeepSeek por OpenRouter); si discrepan en 2 puntos o cruzan la frontera de «relevante», decide Gemini Pro. Las consultas de página se juzgan por regla. Costó 1,5 $.
- **Citas** (`citas.json`): 19 afirmaciones como las de un trabajo, 13 con respaldo y 6 negativas (contradichas o ajenas). Una cita es **inventada** si su fragmento no existe, es de otro documento, su rango de páginas no cubre el del fragmento o su evidencia no está literalmente en el pasaje.
- **Folios** (`folios.json`): 21 páginas de la comedia comprobadas a ojo sobre la imagen.

Métricas: nDCG@10 con ganancia 2^nota − 1; Recall@20 y MRR con «relevante» = nota ≥ 2. Lo no juzgado cuenta como 0.

Para ampliar el juego: ingiere el documento (`pnpm bench ingesta <archivo> --etiqueta x`), añádelo a `corpus.json`, copia su SPDF sin la tabla `blobs` a `fuentes/` si su licencia lo permite, y luego `estanteria --actualizar`, `proponer --solo Corto`, revisa las propuestas, `pool`, `juzgar`, `citas-proponer` y `citas-juzgar`.

El banco grande con el que se ajustó el buscador (183 consultas, 8 879 juicios, libros y entrevistas con derechos) no se publica: su resumen está en [`bench/RESULTADOS-banco-privado.md`](../RESULTADOS-banco-privado.md) y se ejecuta con `SCHOLARIS_BANCO=privado` si se tiene `bench/datos/calidad/juego/`.

<!-- ultimo -->
## Última ejecución

2026-10-06 20:34, `37767e1`, banco público inicial. Estantería `4d8238fcb21a`, 66 consultas, 2387 juicios.
Sistema principal: nDCG@10 **0.899**, Recall@20 **0.950**, MRR **0.960**.

| Sistema | nDCG@10 | Recall@20 | MRR | ms p50 / p95 (con caché) | m$ por consulta | top-10 juzgado | repetidos |
|---|---|---|---|---|---|---|---|
| antes | 0.697 | 0.648 | 0.919 | 45 / 72 | 0.000 | 100.0 % | 0 |
| lexica | 0.599 | 0.740 | 0.739 | 13 / 18 | 0.000 | 100.0 % | 0 |
| densa | 0.781 | 0.889 | 0.856 | 10 / 14 | 0.000 | 100.0 % | 0 |
| visual | 0.222 | 0.213 | 0.262 | 5 / 9 | 0.000 | 100.0 % | 0 |
| hibrida | 0.807 | 0.904 | 0.899 | 9 / 12 | 0.000 | 100.0 % | 0 |
| hibrida+comp | 0.808 | 0.899 | 0.897 | 18 / 21 | 0.000 | 100.0 % | 0 |
| hibrida+jev | 0.899 | 0.950 | 0.960 | 11 / 15 | 0.000 | 100.0 % | 0 |
| completa | 0.897 | 0.952 | 0.962 | 19 / 23 | 0.000 | 100.0 % | 0 |
| produccion | 0.899 | 0.950 | 0.960 | 10 / 14 | 0.000 | 100.0 % | 0 |

### nDCG@10 por clase de consulta

| Clase (n) | antes | lexica | densa | visual | hibrida | hibrida+comp | hibrida+jev | completa | produccion |
|---|---|---|---|---|---|---|---|---|---|
| todas (66) | 0.697 | 0.599 | 0.781 | 0.222 | 0.807 | 0.808 | 0.899 | 0.897 | 0.899 |
| autor (2) | 0.649 | 0.661 | 0.829 | 0.099 | 0.829 | 0.838 | 0.891 | 0.961 | 0.891 |
| conceptual (15) | 0.684 | 0.597 | 0.771 | 0.201 | 0.762 | 0.742 | 0.883 | 0.863 | 0.883 |
| cruzada (2) | 0.816 | 0.690 | 0.638 | 0.586 | 0.700 | 0.675 | 0.714 | 0.813 | 0.714 |
| en (24) | 0.719 | 0.525 | 0.793 | 0.262 | 0.792 | 0.802 | 0.907 | 0.903 | 0.907 |
| es (42) | 0.684 | 0.641 | 0.775 | 0.200 | 0.815 | 0.811 | 0.894 | 0.893 | 0.894 |
| factual (14) | 0.720 | 0.744 | 0.860 | 0.175 | 0.856 | 0.845 | 0.891 | 0.890 | 0.891 |
| filtro (3) | 0.713 | 0.679 | 0.825 | 0.219 | 0.818 | 0.839 | 0.910 | 0.949 | 0.910 |
| grafia (6) | 0.609 | 0.592 | 0.603 | 0.280 | 0.698 | 0.663 | 0.734 | 0.765 | 0.734 |
| interlingue (13) | 0.665 | 0.366 | 0.719 | 0.242 | 0.675 | 0.715 | 0.902 | 0.891 | 0.902 |
| literal (12) | 0.729 | 0.517 | 0.735 | 0.158 | 0.897 | 0.894 | 0.937 | 0.937 | 0.937 |
| medio (4) | 0.496 | 0.689 | 0.855 | 0.000 | 0.845 | 0.879 | 0.890 | 0.882 | 0.890 |
| pagina (3) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |

### Latencia real (sin cachés, en serie, produccion)

p50 **689 ms**, p95 847 ms, media 654 ms; 0.459 m$ por consulta. Mediana por fase: comprension 0, lexicaA 1, vectorizacionA 349, vectoresA 350, fusion 0, hidratacion 2, reordenacion 319, total 689, lexica 1, densa 351.

### Folios

21 de 21 exactos (11 de 11 con el número impreso a la vista).

### Citas

19 afirmaciones. Precisión **100.0 %**, exhaustividad **100.0 %**, citas inventadas **0**, citas en afirmaciones sin respaldo 0, veredicto de verificación correcto 100.0 %. 768 ms y 5.96 m$ por afirmación.

## Historial (sistema principal)

| Fecha | Commit | nDCG@10 | Recall@20 | MRR | Latencia p50 / p95 | Citas P / R / inventadas | Folios | Nota |
|---|---|---|---|---|---|---|---|---|
| 2026-10-06 20:34 | 37767e1 | 0.899 | 0.950 | 0.960 | 689 / 847 | 100.0 / 100.0 / 0 | 21/21 | banco público inicial |
