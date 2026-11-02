# Conversor del servidor (Cloudflare Container)

Convierte en el servidor lo que llega sin el paquete del navegador (SDK, API,
importaciones, enlaces de pódcast): PDF con capa de texto e imágenes de página,
vídeo y audio con ffmpeg, EPUB, DOCX y diapositivas con su imagen (LibreOffice).
Es `apps/local/src/conversor.ts` (la imprenta de Node) dentro de una imagen.

Protocolo: `POST /convertir?nombre=…&mime=…[&tipo=…]` con el fichero en el cuerpo;
responde tramas binarias (`apps/api/src/compartido/tramas.ts`): una por parte y una
última `{tipo:'fin', paquete}`. El Workflow guarda cada parte en R2 según llega.

## Construir y subir la imagen

Hace falta Docker (amd64). En el servidor de casa se hizo así:

    docker build --platform linux/amd64 --provenance=false --sbom=false \
      -f deploy/contenedor/Dockerfile -t scholaris-conversor:<etiqueta> .
    # credenciales temporales del registro (token con «Workers Containers Write»):
    #   POST /accounts/<cuenta>/containers/registries/registry.cloudflare.com/credentials
    #   {"expiration_minutes":30,"permissions":["push","pull"]}
    docker login registry.cloudflare.com -u <usuario> --password-stdin
    docker tag scholaris-conversor:<etiqueta> registry.cloudflare.com/<cuenta>/scholaris-conversor:<etiqueta>
    docker push registry.cloudflare.com/<cuenta>/scholaris-conversor:<etiqueta>

Con Node y Docker en la misma máquina basta `npx wrangler containers push`.
`--provenance=false` es necesario: el registro rechaza los manifiestos de atestación.

## Activarlo

En `deploy/cloudflare/wrangler.jsonc`: el bloque `containers` con la imagen, el
Durable Object `CONVERSOR` (clase `Conversor`, migración v2) y la variable
`CONVERSOR_ACTIVO = "1"`. Sin ella, el Workflow usa la conversión de reserva mínima
(PDF por visión, audio de una pieza).

En local o en Docker Compose se usa con `SCHOLARIS_CONVERSOR_URL=http://conversor:8080`.

## Coste

Cada instancia `standard-4` reserva 12 GiB y se paga mientras está encendida:
unos 0,11 $ por hora, 2,70 $ al día. En octubre de 2026 esto costó 200 $ por dejar
sin cerrar la respuesta tras la trama `fin`: la librería daba la petición por no
terminada y no dormía la instancia. Por eso:

- `leerTramas` y el cliente del conversor cierran siempre la respuesta.
- `sleepAfter` es de 3 minutos.
- Las instancias se despiertan de una en una (`instanciaLibre`); la segunda solo si
  la primera está trabajando.
- `Conversor.alarm` para la instancia si lleva 45 minutos sin peticiones nuevas.

Para comprobar que duerme: `npx wrangler containers instances <id de la aplicación>`
(el id sale de `npx wrangler containers list`) unos minutos después de una ingesta.
