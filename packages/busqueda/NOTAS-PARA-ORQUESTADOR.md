# Notas para el orquestador (búsqueda, medida con bench/calidad)

Los números salen de `bench/calidad/RESULTADOS.md` (183 consultas, 8 879 juicios 0-3 de dos jueces con árbitro). nDCG@10 del buscador: 0,698 antes, 0,889 ahora.

## Cambios de comportamiento que ven las apps

- **`comprender` es `false` por defecto.** Las expansiones del redactor (paráfrasis, HyDE, traducciones) no mejoran nada con Gemini Embedding 2, que ya busca entre lenguas, y la segunda ronda de vectores alarga la búsqueda. Para recuperar el comportamiento anterior: `buscar(q, { comprender: true })` o `new Buscador(puertos, { ajustes: { comprender: true } })`. `/busqueda/multilingue` llama a `comprender()` explícitamente y sigue funcionando.
- **`fundirContiguos` es `false` por defecto.** Fundir dejaba el vecino peor y bajaba Recall@20 de 0,82 a 0,66.
- **Sin repetidos al hidratar**: mismo fragmento, mismo documento + ancla + texto, o el mismo texto en otro documento (libro subido dos veces). `sinRepetidos` de `apps/api/src/rutas/busqueda.ts` se puede quitar o dejar como red de seguridad: ya no recorta la lista por debajo de `k`.
- **Citas literales**: los pasajes que contienen la frase van primero y detrás los afines por sentido (un vector de consulta, sin modelo ni reordenador).
- **`alPreliminar(resultados)`** en `OpcionesBusqueda`: el orden de la fusión antes de reordenar (a los ~350 ms). La API puede mandarlo por SSE y sustituirlo cuando llegue el definitivo; es la única forma de bajar de 600 ms percibidos con Jev en serie.

## Para otros paquetes

- **Ingesta: los vectores de página no ayudan a buscar texto.** La vía visual sola da nDCG 0,20, y con peso 0,3 restaba en las consultas de texto (0,723 frente a 0,751 sin reordenar sobre Attention, El perseguidor y Lewis). El buscador ya solo los usa en consultas de intención «visual». Conviene mantener `vistaPaginas: 'utiles'` (escaneados, fotos, diapositivas, páginas con figuras). Si hace falta ahorrar, se podrían quitar también en los escaneados de texto corrido; con este banco no se puede medir porque no hay consultas visuales sobre escaneados.
- **Ingesta: la línea de contexto** pesa 0,35 en BM25 y va dentro del vector del fragmento; no la he podido medir sin reingerir. No hay motivo para quitarla.
- **Proveedores: Jev con 10 pasajes por petición** (en paralelo) en vez de 24 ahorra unos 70 ms por llamada suelta con la misma calidad (`crearJev(...).reordenador({ pasajesPorPeticion: 10 })` en `crearInteligencia`). No lo he tocado porque el paquete no es mío.
- **Proveedores: reordenadores de Workers AI.** bge-m3 (0,770) y bge-reranker-base (0,758) son peores que no reordenar (0,771) en esta biblioteca; no conviene usarlos como reserva de Jev. Mejor sin reordenar si Jev falla.
- **Citas: `fundirRangos`** solo une páginas consecutivas con un pasaje verificado cada una; con un hueco van como citas separadas («pp. 10-11», «p. 13»). Arreglado también que el rango se quedara en la primera página cuando el mejor pasaje era el último. Banco de citas: precisión 95,0 %, exhaustividad 96,7 %, 0 inventadas.
- **Folios**: la sobrecubierta de Lewis sale como «dj A», «dj B», «dj C» y las guardas en blanco del final del Casamiento (págs. físicas 39-43) reciben folios deducidos 33-37. Ambas deberían ser `null`. Son los 8 fallos de 64 en `folios.json`.

## Latencia

p50 ~650 ms en la red de casa = vector de la consulta (~360 ms) + Jev (~300 ms). Ya van en paralelo con la vía léxica; lo denso y Jev no se pueden solapar. Sin reordenar: ~350 ms y nDCG 0,818. La caché de vectores de consulta ya existe en memoria (`cacheVectores`); una caché compartida en KV ayudaría solo con consultas repetidas.
