# Convención de rutas

Cada grupo de rutas vive en `apps/api/src/rutas/<grupo>.ts` y exporta:

```ts
export function rutas<Grupo>(app: Hono<Entorno>): void
```

`Entorno` (en `apps/api/src/entorno.ts`) da acceso a los puertos ya montados
(`c.get('puertos')`: almacén, estantería del usuario, índice, inteligencia,
emisor, cola) y al usuario (`c.get('usuario')`). Las rutas no tocan Cloudflare
ni Node directamente: solo puertos. Así el mismo fichero sirve en el Worker y en
`apps/local`.

La lógica de dominio vive en `packages/*`; las rutas solo validan, llaman y
responden.
