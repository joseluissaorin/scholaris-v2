# Banco de comprensión

El código del banco (cliente de cada modo, juez, puntuación e informe) está en
`bench/src/comprension/`. Las preguntas no están en este repositorio: citan obras con
derechos de autor (el cuento «El lobo, el bosque y el hombre nuevo» de Senel Paz y los
diálogos de *Fresa y chocolate*) y el repositorio es público.

El banco vive en `bench/datos/comprension/banco/` (ignorado por git) o en la carpeta que
indique `SCHOLARIS_BANCO_COMPRENSION`. Son tres ficheros:

- `preguntas.json`: las preguntas, con su rúbrica de puntos anclados (página o tramo de
  tiempo, cita literal o lo que se ve y se oye) y sus trampas. El formato está en
  `bench/src/comprension/tipos.ts`.
- `verificaciones.json`: el registro de cada comprobación visual (modelos, recortes y
  veredictos).
- `calibracion.json`: la nota manual con la que se eligió el juez.

Uso: `pnpm bench comprension --modo responder|investigar`, `pnpm bench comprension
validar` y `pnpm bench comprension calibrar`. Los informes van a `bench/resultados/`,
que también queda fuera de git.
