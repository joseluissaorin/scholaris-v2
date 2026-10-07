# Dependencias versionadas en el repositorio

## `spdf-format-0.1.0.tgz`

La biblioteca de referencia en TypeScript del formato abierto SPDF 5.0
(<https://spdf.joseluissaorin.com>), con licencia MIT OR Apache-2.0. Scholaris la usa en
`apps/api` para exportar un documento como SPDF 5.0 (`GET /api/v2/documentos/:id/spdf?version=5`
y `GET /api/v1/documentos/:id/spdf`) y para importar ficheros 5.0
(`compartido/spdf50.ts`). La estantería sigue guardando SPDF 4.1.

Todavía no está publicada en npm, así que va aquí como tarball, para que el build sea
reproducible: `pnpm-lock.yaml` guarda su suma de integridad y `pnpm install --frozen-lockfile`
falla si el fichero cambia.

### De dónde sale

Es `npm pack` de la carpeta `js/` del repositorio de SPDF (`github.com/joseluissaorin/spdf`),
con `dist/` ya compilado. Para regenerarlo con una versión nueva:

```sh
cd <repo spdf>/js
npm ci && npm run typecheck && npm test && npm run build
npm pack --pack-destination <repo scholaris>/vendor     # spdf-format-<versión>.tgz
```

Después, en `apps/api/package.json`, apuntar `"spdf-format"` al tarball nuevo
(`file:../../vendor/spdf-format-<versión>.tgz`), ejecutar `pnpm install`, pasar
`pnpm -r typecheck` y las pruebas de `apps/api`, y borrar el tarball anterior. Nunca se
sobrescribe un tarball con el mismo nombre: la suma del lockfile dejaría de cuadrar.

### Cuando esté publicada en npm

1. En `apps/api/package.json`, cambiar
   `"spdf-format": "file:../../vendor/spdf-format-0.1.0.tgz"` por `"spdf-format": "^0.1.0"`
   (o la versión publicada que toque).
2. `pnpm install` (actualiza `pnpm-lock.yaml` con el paquete del registro).
3. `pnpm -r typecheck`, `pnpm --filter @scholaris/api test` y el build de la web.
4. Borrar `vendor/spdf-format-*.tgz` y esta sección.

El código no cambia: importa `spdf-format/core` y `spdf-format/wasm`, que son las mismas
entradas en el tarball y en npm.
