# @scholaris/contrato

El contrato HTTP entre `apps/web` y `apps/api` (y `apps/local`, que sirve la misma
API). Tipos de petición y respuesta de cada ruta, más el cliente tipado que usa la
web. Lo mantiene el agente de plataforma; la web solo lo consume.

Convenciones:
- Todas las rutas cuelgan de `/api/v2/…`.
- JSON en ambos sentidos; errores como `{ error: { codigo, mensaje } }` con mensaje
  en español correcto.
- Progreso y respuestas largas por WebSocket (`/api/v2/tiempo-real`) o SSE.
- Los binarios (páginas, miniaturas, medios) por URL firmada de lectura.
