# Contribuir a Scholaris

Gracias por asomarte. Scholaris es código abierto (EUPL-1.2) y se agradece cualquier tamaño de ayuda: una errata, una traducción, un informe de error bien contado, un estilo de cita que falta o un documento raro que la imprenta no sabe leer.

Todo lo que pasa aquí se rige por el [código de conducta](CODE_OF_CONDUCT.md). Para vulnerabilidades, **no abras un issue**: sigue [SECURITY.md](SECURITY.md).

## Preparar el entorno

Requisitos: **Node.js 22 o superior** (el banco usa `node:sqlite`), **pnpm 10** (`corepack enable`) y, para el ejecutable de escritorio, **Bun**. Python 3.9+ solo si tocas el SDK.

```bash
git clone https://github.com/joseluissaorin/scholaris-v2 scholaris && cd scholaris
pnpm install
pnpm --filter @scholaris/web build      # la web que sirve la versión local
GEMINI_API_KEY=… pnpm dev:local          # http://localhost:8790
SCHOLARIS_API=http://localhost:8790 pnpm dev:web   # la web con recarga en caliente, contra la API local
```

## Cómo está hecho

- `packages/nucleo`: tipos y puertos (SQL, almacén, inteligencia). Ningún paquete de dominio importa APIs de Cloudflare ni de Node: todo pasa por puertos, y por eso la versión local es la misma aplicación y no una copia.
- `packages/imprenta` convierte cualquier cosa (PDF, EPUB, DOCX, audio, vídeo, web) en un paquete; `packages/ingesta` lo lee por pliegos, saca folios, metadatos, fragmentos y vectores; `packages/spdf` escribe y abre el formato SPDF; `packages/busqueda` busca (léxica, densa, visual, fusión y reordenador); `packages/citas` cita, verifica y da formato con CSL; `packages/funciones` añade entidades, grafo de citas, vigilantes…
- `apps/api` es la API (Hono) con dos montajes: Cloudflare (`src/cloudflare`) y el que usa `apps/local` (Node, SQLite y disco). `apps/web` es la web (React). `apps/escritorio` empaqueta la versión local en un solo ejecutable con Bun. `sdk/python` es el cliente de Python.
- `bench` es el banco de pruebas: ingesta real (`pnpm bench ingesta <archivo>`) y calidad de búsqueda y citas (`pnpm bench calidad`, véase [bench/calidad/RESULTADOS.md](bench/calidad/RESULTADOS.md)).

## El bucle de trabajo

1. Rama desde `main` con prefijo: `feat/…`, `fix/…`, `docs/…`.
2. La prueba va junto al cambio (Vitest en `test/` de cada paquete). Las pruebas no llaman a ninguna API de pago: usan proveedores falsos.
3. Antes de abrir el PR, esto tiene que estar en verde (es lo que corre la CI):

   ```bash
   pnpm typecheck && pnpm test && pnpm --filter @scholaris/web build
   ```

4. Si tocas la búsqueda, las citas o los folios, pasa el banco y pega la tabla en el PR: `GEMINI_API_KEY=… pnpm bench calidad --citas --no-anotar`. Un cambio que baja el nDCG@10 o que produce una sola cita inventada necesita una buena razón.
5. Si tocas algo que se ve, míralo en un navegador de verdad, en claro y en oscuro, y en un móvil.

## Las reglas de la casa

- **Nunca una cita inventada.** Cada cita sale de un fragmento que existe, con su ancla (página física, folio impreso, segundo), y se comprueba contra el texto antes de enseñarla.
- **El SPDF es el contrato.** Un cambio de forma sube la versión del esquema (`packages/spdf/esquema`) y trae su migración: lo que alguien exportó tiene que seguir abriéndose.
- **Español con tildes y eñes** en todo lo que lee una persona: interfaz, documentación, mensajes de error, correos. Los identificadores, claves JSON y rutas se quedan sin tilde. Ojo con los plurales en `-ciones`, que no la llevan.
- **La raya (—) no es un guion** ni lleva espacios a ambos lados: `el centro —que ya trabaja con esto— no cambia`.
- **Sin emojis** en la interfaz ni en la documentación.
- **Nada con derechos en el repositorio**: ni libros, ni capturas de páginas, ni transcripciones de entrevistas. Los documentos de prueba son de dominio público o tienen licencia libre; lo demás va a `bench/datos/`, que git ignora.
- Comentarios que expliquen **por qué**, no qué.

## Licencia de lo que aportes

Al abrir un PR aceptas que tu contribución se publique bajo la **EUPL-1.2**, la misma licencia del proyecto. No hace falta firmar ningún acuerdo aparte.
