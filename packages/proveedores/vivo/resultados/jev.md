
### Jev (TypeSafe)

| prueba | ms | usd | resultado |
|---|---|---|---|
| reordenar 4 pasajes (1 petición) | 358.122 | 0.00003 | 0.030, 0.940, 0.930, 0.030 (la buena es la 2.ª; la 3.ª contradice) |
| juez: 4 preguntas (si_no, eleccion×2, escala) | 289.966 | 0.00003 | {"respalda":{"tipo":"si_no","probabilidad":0.8},"relacion":{"tipo":"eleccion","probabilidades":{"APOYO_DIRECTO":0.99,"CONTRADICCION":0,"CONTEXTO":0.01},"eleccion":"APOYO_DIRECTO"},"folio":{"tipo":"eleccion","probabilidades":{"57":0.11,"142":0.88,"HISTORIA AGRARIA":0.01},"eleccion":"142"},"grado":{"tipo":"escala","valor":2.76,"probabilidades":[0,0.01,0.22,0.77]}} |