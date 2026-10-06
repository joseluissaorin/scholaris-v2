# Portada pública de Scholaris

## Para el orquestador: desplegar, por favor

La portada está lista y probada en local. **No la he desplegado.** Pido que se
despliegue con el Worker de siempre:

```
pnpm --filter @scholaris/api desplegar     # construye apps/web y hace wrangler deploy
```

No toca la configuración de Wrangler ni el Worker: la portada son estáticos
nuevos dentro de `apps/web/dist`. Después de desplegar, comprobar:

```
curl -sI https://scholaris-v2.jlsf2005.workers.dev/acerca      # 200, text/html (sin redirección)
curl -sI https://scholaris-v2.jlsf2005.workers.dev/en          # 200
curl -sI https://scholaris-v2.jlsf2005.workers.dev/portada/laminas/biblioteca-es.svg   # 200, image/svg+xml
curl -sI https://scholaris-v2.jlsf2005.workers.dev/portada/tarjeta-es.png              # 200 (tarjeta social)
```

y abrir «/» en una ventana privada: sin sesión de Clerk debe ir a `/acerca`
(o a `/en` si el navegador no está en español); «Empezar» lleva a `/?entrar`
(el inicio de sesión de Clerk) y «Probar sin cuenta», a `/?demostracion`.

## Qué es

- `/acerca` (castellano) y `/en` (inglés): un ensayo en ocho capítulos sobre el
  problema ético que Scholaris intenta resolver (encontrar sin sustituir el
  pensamiento), con capítulos a la manera cervantina («Capítulo primero, que
  trata de…»), glosas al margen, reclamos al pie de cada folio, foliación,
  rúbricas en versalitas rojas y un colofón en cul-de-lampe.
- Ocho dibujos **hechos a mano por coordenadas** en `dibujo/dibujos/*.ts`
  (manícula, inicial E, biblioteca en perspectiva con el cuadrado de Malévich al
  fondo, las máquinas que contestan, la constelación de una biblioteca, la
  tríada de Kandinski, el caracol con su libro y la manecilla del margen). El
  código solo pone la mano (el motor vive ahora en `apps/web/src/dibujo/`, compartido con la aplicación; `portada/dibujo/` lo reexporta): temblor, presión, charco de
  tinta, pasadas que no coinciden, lápiz de construcción, sombreados a medias.
  Deterministas (semilla por nombre), con pruebas en `dibujo/dibujo.test.ts`.
- Se dibujan solos al bajar (primero el lápiz, luego la tinta, al ritmo de una
  pluma); sin animación con `prefers-reduced-motion`, sin JavaScript y al
  imprimir.

## Cómo está hecha

- `pagina.ts` compone el HTML; `vite-portada.ts` lo sirve en `pnpm dev` y en
  `vite preview`, y al construir escribe `dist/acerca.html`, `dist/en.html` y
  `dist/portada/laminas/*.svg`. No carga React, ni el paquete de la aplicación,
  ni Clerk: el único JavaScript es un script en línea de 1,5 KB.
- El primer folio (titular, sol rojo, manícula) va dentro del HTML; las láminas
  de más abajo se piden un poco antes de llegar a la pantalla y se meten en
  línea para que la pluma pueda dibujarlas (cajas con su proporción exacta: cero
  saltos; con `<noscript>` se ven como imagen).
- DM Sans y la letra de mano (`mano.woff2`, «Nothing You Could Do», OFL,
  recortada a 12 KB) se cargan después del evento `load`.
- Primitivos: los restaurados en `packages/ui` (relieve, paleta café y crema,
  rojo #B83E33, tarjeta levantada, botón tinta y botón papel con DM Sans),
  copiados como variables CSS porque la portada no usa Tailwind.
- «/» sin sesión: un script al principio de `apps/web/index.html` redirige a
  `/acerca` o `/en` si no hay cookie de sesión de Clerk (`__session` o
  `__client_uat` distinto de 0), salvo `?entrar`, `?demostracion`, la
  demostración ya abierta y los anfitriones locales (localhost, 192.168.*,
  10.*, 100.*, *.local, *.ts.net), donde la versión de casa va directa a la
  Biblioteca.

Medido en local con brotli (como Cloudflare), Lighthouse móvil con 4G lenta
simulada: rendimiento 100, accesibilidad 100, buenas prácticas 100, SEO 100;
FCP 1,2 s, LCP 1,6 s, CLS 0, TBT 0 ms. Escritorio: LCP 0,5 s. El HTML pesa
18,5 KB comprimido.

## Propuestas para otros (no las he tocado)

- **Worker** (`apps/api/src/cloudflare/worker.ts`): si «/» se resolviera en el
  Worker (302 a `/acerca` cuando no hay cookie de Clerk), el visitante sin
  sesión se ahorraría las precargas del paquete de la app que el navegador
  lanza antes de que corra el script de redirección (se cancelan, pero gastan
  algo de red en 4G). Haría falta añadir «/» a `run_worker_first`.
- `apps/web/public/robots.txt` y `sitemap.xml` los he añadido yo (la SPA
  devolvía `index.html` para `/robots.txt`).
- La portada usa su propia copia de DM Sans (`/portada/dm-sans.woff2`) y del
  logo (`/portada/logo-96.webp`, `logo-192.webp`); si `/fuentes/dm-sans-latin.woff2`
  queda estable, se puede apuntar ahí para compartir caché con la aplicación.

## Para José Luis: dos datos que conviene que mires

- El espécimen del capítulo cuarto cita el *Quijote* de 1605 (Juan de la
  Cuesta) en **fol. 1r**, con ortografía modernizada. Estoy casi seguro de que
  el capítulo primero empieza en el folio 1 de la príncipe, pero esta página
  presume de no inventar citas: compruébalo (o Pepe) antes de darlo por bueno.
- En la constelación figura *Lo que hay* (2022) de Sara Torres.

## Cambiar un dibujo

```
pnpm exec tsx src/portada/dibujo/mesa-de-dibujo.ts manicula /tmp/lamina.html --cuadricula
```

abre la lámina sola con una cuadrícula de coordenadas para corregir trazos.
Las tarjetas sociales (`public/portada/tarjeta-{es,en}.png`) se rehacen con
`pnpm exec tsx src/portada/tarjeta.ts` cuando cambie el titular.
