
### Embebedor Gemini Embedding 2 @1536

| prueba | dims | ms | resultado |
|---|---|---|---|
| texto (4 doc + 3 consultas) | 1536 | 723.096 | 0,2,3 |
| imagen de la p. 10 del Casamiento | 1536 | 1041.750 | coseno con consultas: 0.370, 0.328, 0.560 (la 3.ª es la suya) |
| PDF de 1 página (Attention, p. 3) | 1536 | 926.698 | coseno con «transformer…»: 0.571, con «IRA»: 0.313 |
| audio 60 s (3b1b, vectores) | 1536 | 1221.067 | coseno con «what is a vector»: 0.714, con «IRA»: 0.379 |
| lote de 300 fragmentos (~150 tokens) | 1536 | 1883.786 | 159 fragmentos/s |

Recuperación de texto (mejor documento por consulta; esperado 0,2,3): [{"consulta":"¿Cuántos campesinos asentó el IRA?","mejor":0,"puntuaciones":[0.772,0.537,0.466,0.507]},{"consulta":"transformer architecture without recurrence","mejor":2,"puntuaciones":[0.479,0.48,0.811,0.519]},{"consulta":"versos de amor y celos en una comedia del Siglo de Oro","mejor":3,"puntuaciones":[0.458,0.509,0.479,0.693]}]

Coste total de la sección: $0.00786 (36803 tokens)