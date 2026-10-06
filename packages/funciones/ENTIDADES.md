# El grafo de entidades de la biblioteca

Personas, obras, lugares, organizaciones, conceptos, acontecimientos y fechas que aparecen en todos los documentos del usuario. Cada mención guarda su ancla (página impresa o segundo exacto), de modo que se puede ir de «Cortázar» a «Charlie Parker» y de ahí a «El perseguidor» sabiendo dónde lo dice cada texto.

Código en `src/entidades/`, rutas en `src/rutas/entidades.ts`, tipos en `packages/contrato/src/funciones.ts` (sección «Entidades»), web en `apps/web/src/rutas/explorar.entidades.tsx` y `apps/web/src/componentes/lector/entidades.tsx`, banco en `bench/src/entidades.ts`.

## Cómo funciona

1. **Lotes.** Los fragmentos del documento se agrupan en lotes deterministas de unos 48 000 caracteres (unos 13 000 tokens). El mismo documento da siempre los mismos lotes.
2. **Una llamada por lote** al redactor rápido (Gemini Flash-Lite), que no devuelve menciones sino la lista de entidades distintas en formato compacto, una línea por entidad: `p|Julio Cortázar|Cortázar`. Con objetos JSON la salida era seis veces más larga (2300 tokens por lote frente a 360) y la salida es lo caro. El tipo `q` marca a los personajes de ficción.
3. **Las menciones se localizan aquí**, buscando las formas en el texto de cada fragmento del lote, con límites de palabra Unicode, mayúsculas en los nombres propios, sin solapes (gana la forma más larga) y sin contar la etiqueta del hablante de las transcripciones (`**Joaquín Soler Serrano:**`). Así cada mención tiene fragmento, desplazamiento y ancla exactos.
4. **Pasada sin coste por todo el documento.** El redactor ve cada lote por separado y a veces calla en un lote lo que nombró en otro; las formas específicas (mayúscula inicial y dos palabras o cinco letras, sin dueño ambiguo) se buscan en todos los fragmentos.
5. **Resolución en toda la biblioteca.** Una entidad es un par (tipo, clave sin tildes ni artículos), así que «Cortázar» y «Cortazar» caen juntas por construcción. Después se fusiona por el mismo Wikidata, por una forma de varias palabras que es el nombre de otra, por un apellido suelto que encaja con una sola persona del mismo documento («Parker» → «Charlie Parker») y por nombres que solo difieren en los intermedios. La que pierde queda con `fusionada_en` y su id sigue resolviendo.
6. **Wikidata.** API pública `wbsearchentities`, una petición cada vez con pausa, User-Agent `Scholaris/2.0 (…; jl@joseluissaorin.com)`, caché permanente en `entidades_wikidata`. Solo se enlaza una coincidencia exacta de etiqueta o alias con una descripción compatible con el tipo (una obra ha de describirse como obra; una persona real nunca enlaza con un personaje). No se buscan las personas de una sola palabra ni los personajes de ficción.
7. **Aristas.** Coapariciones por documento, ponderadas por la cercanía: en el mismo fragmento, 0,4 + 0,6 · e^(−d/400) con d los caracteres entre las dos menciones; en fragmentos contiguos, 0,15. El peso global es la suma.
8. **Relaciones con nombre.** Una sola llamada por documento para las 14 aristas más fuertes: el redactor escribe la frase que afirma el pasaje («Rayuela es un libro de Julio Cortázar») y solo se guarda si nombra a las dos entidades.

## Trabajo de fondo

- **Cuándo.** `alIngerirDocumento` (el enganche que la plataforma ya llama tras cada ingesta, en segundo plano) lo lanza al final, después del grafo de citas y los vigilantes. `alBorrarDocumento` borra las menciones y aristas del documento y recuenta.
- **Idempotente.** Si el trabajo está hecho y la huella de los fragmentos no ha cambiado, no se repite. Con `forzar`, se rehace y deja lo mismo.
- **Reanudable.** Cada lote terminado se apunta en `entidades_trabajos.hechos` en la misma transacción que sus menciones. Un trabajo «en marcha» sin latido durante tres minutos se da por muerto y lo recogen `GET /entidades/estado` (en segundo plano), `POST /entidades/reanudar` y el barrido del cron diario de vigilantes. Si la ingesta cambia los fragmentos, se empieza de cero.
- **La biblioteca anterior.** Los documentos que ya estaban no se leen solos (cuesta dinero): la web ofrece «Reconocer en toda la biblioteca» (`POST /entidades/reanudar { todos: true }`).

## Tablas

`entidades`, `menciones`, `aristas_entidades` (por documento, a < b), `entidades_relaciones`, `entidades_trabajos` y `entidades_wikidata`, en `esquemaFunciones`. El esquema se aplica de forma reparable: quita los índices que ocupen el nombre de una tabla, crea tablas antes que índices y añade las columnas que falten (`COLUMNAS_TARDIAS`). `test/esquema.test.ts` lo aplica dos veces sobre la misma base y sobre una base a medio crear; todo cambio de esquema pasa por esa prueba.

## Rutas

| Ruta | Devuelve |
|---|---|
| `GET /entidades?q=&tipo=&documento=&limite=&cursor=` | `Pagina<Entidad>` (busca por cualquier forma, sin tildes) |
| `GET /entidades/:id` | `FichaEntidad`: menciones agrupadas por documento con ancla, folio y pasaje, y vecinos |
| `GET /entidades/:id/menciones?documento=` | `Pagina<MencionEntidad>` |
| `GET /entidades/:id/vecinos?saltos=1\|2` | `VecindarioEntidad` (para dibujar) |
| `GET /entidades/:id/linea` | `LineaTemporalEntidad` (por la fecha del pasaje o el año del documento) |
| `GET /entidades/camino?desde=&hasta=` | `CaminoEntidades`: búsqueda en anchura por los dos extremos, el más fuerte de los más cortos, con el pasaje de cada salto |
| `GET /entidades/documentos/:documento` | las entidades principales del documento y el estado de la extracción |
| `GET /entidades/documentos/:documento/lector` | formas y unidades para resaltar en el lector |
| `POST /entidades/documentos/:documento/extraer { forzar? }` | `ExtraccionEntidades` (202 en segundo plano) |
| `GET /entidades/estado` · `POST /entidades/reanudar` | estado de todos los trabajos; reanudar |

La plataforma monta el grupo `entidades` en `apps/api/src/rutas/funciones.ts` (en `GRUPOS`).

## Banco con datos reales (6 de octubre de 2026)

Seis documentos de `bench/datos/salida`, con Gemini 3.5 Flash-Lite y Wikidata reales (`pnpm --filter @scholaris/bench exec tsx src/entidades.ts`):

| Documento | Unidades | Lotes | Entidades | Menciones | Tokens (entrada / salida) | Coste | Tiempo |
|---|---|---|---|---|---|---|---|
| A fondo, Cortázar (vídeo, 1977) | 157 tramos | 3 | 115 | 379 | 30 261 / 2105 | 0,0100 $ | 23 s |
| A fondo, Facundo Cabral (vídeo) | 67 tramos | 1 | 82 | 155 | 13 170 / 1323 | 0,0073 $ | 15 s |
| El perseguidor (1959) | 37 págs. | 3 | 90 | 816 | 31 263 / 1714 | 0,0093 $ | 19 s |
| The Discarded Image (1964) | 245 págs. | 8 | 339 | 1362 | 98 569 / 6133 | 0,0264 $ | 57 s |
| El casamiento en la muerte (Lope) | 43 págs. | 2 | 97 | 692 | 29 525 / 2201 | 0,0122 $ | 39 s |
| Attention Is All You Need | 15 págs. | 2 | 43 | 100 | 12 044 / 1041 | 0,0040 $ | 30 s |

- **Coste.** The Discarded Image (245 páginas, 374 000 caracteres) cuesta 0,026 $, es decir, **0,032 $ por 300 páginas**, por debajo del objetivo de 0,05 $. Con objetos JSON y lotes de 20 000 caracteres costaba 0,156 $; la salida compacta y los lotes grandes lo dividieron por seis. Toda la biblioteca: 24 llamadas, 0,069 $. En libros cortos pesa el mínimo de una llamada más la de relaciones (unos 0,08 $ por 300 páginas en proporción, pero menos de 0,013 $ por libro).
- **Totales.** 738 entidades activas (519 personas, 92 lugares, 90 obras, 23 organizaciones, 9 conceptos…), 3504 menciones, 10 226 aristas, 24 fusiones, 264 entidades enlazadas con Wikidata (324 consultas, todas en caché para la siguiente vez) y 39 relaciones con nombre.
- **Charlie Parker** queda enlazado con Wikidata (Q103767, «saxofonista estadounidense (1920-1955)») y sus menciones en la entrevista abren el vídeo en 1:06:56 («…se llama Johnny Carter, pero que me parece que en la realidad se llamó ⟦Charlie Parker⟧») y en 1:08:45 («…leí la biografía de ⟦Charlie Parker⟧, a quien yo admiraba inmensamente como músico»). Sus vecinos: Johnny Carter, Julio Cortázar, El perseguidor, La montaña mágica, Thomas Mann, Rayuela.
- **De la entrevista a la novela.** `camino(Charlie Parker → Dédée)` = Charlie Parker → Johnny Carter (A fondo, 1:06:56) → Dédée (El perseguidor, p. 1, «Johnny y Dédée viven en un hotel de la rue Lagrange»). Johnny Carter, Julio Cortázar, París, México, Buenos Aires, Borges o Louis Armstrong aparecen en dos o tres documentos.
- **Relaciones leídas en los textos** (muestra): «Rayuela es un libro de Julio Cortázar», «Julio Cortázar estuvo de niño en Barcelona», «Julio Cortázar publicó un libro en Alianza Editorial», «Facundo Cabral es el muchacho de Tandil», «Johnny y Dédée viven en un hotel de la rue Lagrange».
- **Fusiones** (muestra): Aristotle → Aristóteles, Thomas Aquinas → Tomás de Aquino, El paraíso perdido → Paradise Lost, Lydgate → John Lydgate, tribunal Russell → Tribunal Bertrand Russell.

## Límites conocidos

- La dedicatoria de El perseguidor, «In memorial de CH.P.», no la resuelve Flash-Lite (una vez propuso «Juan Carlos Paz»): Charlie Parker solo aparece escrito en la entrevista, y el puente con la novela es Johnny Carter. Pedir «resolver iniciales» con más insistencia hacía inventar.
- Wikidata con homónimos: Johnny Carter queda enlazado con un cantante estadounidense cuando el redactor no lo marca como personaje (se desenlaza solo si algún documento lo marca con `q`). En Attention, «Wall Street Journal» sale como lugar (es un corpus del artículo). Las personas de una sola palabra (Platón, Boecio) no se buscan en Wikidata a propósito.
- Las primeras fusiones del banco fueron demasiado generosas («Dédée» dentro de Johnny Carter, «Horace» dentro de Horace Walpole): ahora el nombre de pila suelto no fusiona y una forma de una sola palabra solo arrastra entidades residuales (tres menciones o menos). Quedan errores como «Claudian» → «Claudius».
- En el lector se resaltan las entidades del texto de las páginas; las transcripciones de audio y vídeo (palabra a palabra) aún no.
- La demostración sin API (`src/datos/simulada`) no responde `/entidades`.
