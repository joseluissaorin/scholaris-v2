# Notas de proveedores para el orquestador

No he tocado `@scholaris/nucleo`. Lo que sigue son aclaraciones de cómo lo
interpreto y peticiones por si queréis subirlo al contrato.

1. **`PaginaLeida.fisica` es absoluta.** El comentario dice «índice físico de la
   página dentro del pliego, desde 1», pero como `leerPliego` recibe
   `primeraFisica`, todos los lectores devuelven `primeraFisica + i` (coincide con
   la lectura relativa cuando `primeraFisica = 1`). Propuesta: cambiar el
   comentario a «Índice físico absoluto (primeraFisica + posición en el pliego)».

2. **Procedencia del lector.** La cascada (`cascadaLectores`) añade a cada
   página `lector: string` (quién la leyó al final) e `intentos?: string[]` (por
   qué lectores pasó). Es una propiedad extra, compatible con el tipo. Propuesta:
   añadir `lector?: string` a `PaginaLeida` para que la ingesta lo lleve a
   `Unidad.lector` sin conversión.

3. **Coste.** Los puertos no devuelven uso; cada fábrica acepta `onUso` y
   `contador` (`ContadorUso`), y `crearInteligencia(env, { onUso })` devuelve la
   `Inteligencia` con `contador`. Si se quiere en el contrato: `Inteligencia.contador?`.

4. **`Inteligencia.lector` ya es una cascada.** `lectoresReserva` queda vacío
   para que nadie repita la cascada por fuera.

5. **Transcripción de audio largo.** Whisper en Workers AI admite ~25 MB por
   llamada; el transcriptor trocea solo los WAV PCM. Para mp3/m4a/opus largos, la
   imprenta del navegador debe mandar tramos de ≤ 10 min con `desplazamiento`
   (o WAV). Gemini Transcribe admite hasta 30 min con marcas por palabra y sube a
   la Files API lo que pase de 18 MB.
