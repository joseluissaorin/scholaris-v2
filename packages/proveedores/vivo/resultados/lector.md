
### Lector Gemini: modelo × tamaño de pliego

| doc | lector | pliego | llamadas | muro s | lat. media s | s/página | proy. 300 p (s) | $/1000 p | tok sal./p | CER oro | F1 capa | folios | errores | vacías |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| attention | gemini-3.8-flash | 1 | 15 | 10.778 | 7.902 | 7.902 | 150.142 | 4.453 | 932 | — | 0.789 | 14/15 con folio | 0 | 2 |
| attention | gemini-3.1-flash-lite | 1 | 15 | 5.130 | 3.595 | 3.595 | 68.301 | 1.748 | 953 | — | 0.915 | 14/15 con folio | 0 | 0 |
| fax | gemini-3.8-flash | 1 | 1 | 5.233 | 5.233 | 5.233 | 99.428 | 2.970 | 537 | — | — | 0/1 con folio | 0 | 0 |
| fax | gemini-3.1-flash-lite | 1 | 1 | 2.418 | 2.418 | 2.418 | 45.948 | 1.225 | 604 | — | — | 1/1 con folio | 0 | 0 |

CER de la tubería antigua (Gemma-3-27B, SPDF v3) en la página de oro: 0.073