# Notas de la imprenta para el orquestador

- No hace falta tocar `@scholaris/nucleo`: el contrato propio está en
  `packages/imprenta/src/tipos.ts` (`PaqueteConversion`, `EventoConversion`).
- He añadido la dependencia `pdf-lib` a `@scholaris/imprenta`: el
  `pnpm-lock.yaml` de la raíz ha cambiado y no lo he confirmado yo (lo tocan
  también otros agentes).
- `packages/imprenta/tsconfig.json` añade `"types": ["node"]` porque la parte
  de Node (`src/node/`) usa `node:*`; el resto del código no depende de Node.
- La web (`apps/web`) tiene que copiar `node_modules/pdfjs-dist/{standard_fonts,cmaps,wasm}`
  a `public/pdfjs/` para que pdf.js pinte fuentes no incrustadas, CJK y JPEG 2000.
- El servidor de reserva (Container) debe atender `paquete.reserva.tareas`:
  `imagenes_diapositivas`, `decodificar_audio`, `fotogramas`, `decodificar_imagenes`,
  `conversion_completa` (ODP, Keynote) y `web`. La plataforma Node de la imprenta
  (`@scholaris/imprenta/node`) ya resuelve las dos de medios con ffmpeg.
