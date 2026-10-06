# Política de seguridad

## Divulgación responsable

Si encuentras una vulnerabilidad en Scholaris, por favor no abras un issue público. Hay dos canales privados:

- **Avisos de seguridad de GitHub** (canal preferente): pestaña *Security* del repositorio, «Report a vulnerability».
- **jl@joseluissaorin.com**, si prefieres el correo o no tienes cuenta de GitHub.

Nos comprometemos a acusar recibo en 72 horas como mucho, a publicar una corrección o mitigación en un plazo objetivo de 30 días para lo crítico y a acreditar el descubrimiento en las notas de la versión si lo deseas.

## Ámbito

Están en ámbito la API (`apps/api`), la web (`apps/web`), la versión local (`apps/local`), el ejecutable de escritorio (`apps/escritorio`), los paquetes (`packages/*`), el SDK de Python (`sdk/python`) y las configuraciones de despliegue de referencia (`deploy/docker`, `deploy/cloudflare`). Interesa en especial todo lo que permita leer la biblioteca de otra persona, saltarse un enlace con contraseña, inyectar contenido en el lector o en las respuestas, o hacer que un SPDF malicioso ejecute algo al abrirse.

Quedan fuera las vulnerabilidades ya publicadas en dependencias (se actualizan por CI), la denegación de servicio volumétrica y la ingeniería social. La instancia alojada (scholaris.joseluissaorin.com) está en ámbito, pero no hagas pruebas que lean datos ajenos ni que degraden el servicio: con una cuenta tuya basta.

## Versiones con soporte

Scholaris se desarrolla en `main`. Las correcciones salen en la rama principal, en la instancia alojada y en la siguiente versión etiquetada (imagen Docker y ejecutables).
