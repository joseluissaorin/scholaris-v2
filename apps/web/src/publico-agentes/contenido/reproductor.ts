import type { Pagina } from './tipos';
import { notaOjo } from '../../bocetos/dibujos/nota-ojo';

export const reproductor: Pagina = {
  clave: 'reproductor',
  rutas: { es: '/saber/reproductor', en: '/en/knowledge/media-player' },
  boceto: notaOjo,
  es: {
    titulo: 'Entrevistas, clases y vídeos citables al segundo',
    corto: 'Audio y vídeo',
    descripcion: 'Transcripción palabra a palabra con quién habla, tramos citables de 30 a 60 segundos, fotogramas buscables y un reproductor con la transcripción sincronizada donde se cita seleccionando el texto.',
    md: `## La transcripción

El audio se transcribe en tramos de diez minutos con dos segundos de solape. Cuando hay clave de Gemini, transcribe Gemini Transcribe, que distingue hablantes; si falla, Whisper (large-v3-turbo, en Workers AI). Después, un modelo identifica el reparto (quién habla y en qué papel: entrevistador, invitado, presentadora) y asigna cada frase a una persona con nombre, lo que corrige las etiquetas que no coinciden de un tramo a otro. En dos entrevistas del banco, la atribución fue correcta en 20 de 21 turnos y en 23 de 23.

El texto se parte en **tramos citables** de 30 a 60 segundos (45 de media) que acaban en final de frase. Cada tramo es una unidad con su ancla de tiempo y su hablante, y se guardan además los tiempos de cada palabra.

## Los fotogramas

En los vídeos se toma un fotograma en cada cambio de escena y, si no hay cambios, uno cada 20 segundos (nunca más de uno cada 10). Los fotogramas se describen y se vectorizan, de modo que se puede buscar «la pizarra con el diagrama» y llegar al segundo exacto.

## YouTube, Vimeo y pódcast

Un vídeo de YouTube no se descarga: Gemini lo ve desde su dirección, a trozos de diez minutos, y el título y el canal salen de su ficha pública. De Vimeo se toma el fichero descargable más pequeño; de un pódcast, el audio que anuncia su RSS.

## El reproductor

- Línea de tiempo con los turnos de cada hablante, los capítulos y una vista previa del fotograma al pasar por encima.
- Transcripción sincronizada que resalta la palabra que suena; un clic en una palabra salta a ese momento.
- Para citar, se selecciona el texto: la cita sale con su intervalo exacto («12:04-12:40»).
- Un reproductor pequeño sigue sonando mientras navegas por el resto de la aplicación.

## Lo que hemos medido

Una entrevista en vídeo de 54 minutos quedó lista en 45 segundos (0,41 $), y una de dos horas, en 70 segundos (0,94 $); transcribir cuesta unos 0,005 $ por minuto. En la primera Scholaris, la misma entrevista de 54 minutos tardaba tres horas y 39 minutos. Todas las cifras y sus condiciones están en [Rendimiento](/saber/rendimiento).

## Lo que falta

Los tiempos de cada palabra se estiman dentro de cada segmento, no se miden uno a uno. Algunos vídeos con códecs poco comunes aún no se convierten a un formato que todos los navegadores reproduzcan.
`,
  },
  en: {
    titulo: 'Interviews, lectures and videos you can cite to the second',
    corto: 'Audio and video',
    descripcion: 'Word-by-word transcription with who is speaking, citable stretches of 30 to 60 seconds, searchable video frames, and a player with a synchronised transcript where you cite by selecting the text.',
    md: `## The transcript

Audio is transcribed in ten-minute stretches with a two-second overlap. When there is a Gemini key, Gemini Transcribe does it, telling speakers apart; if it fails, Whisper (large-v3-turbo, on Workers AI). Then a model identifies the cast (who speaks and in what role: interviewer, guest, host) and assigns every sentence to a named person, which fixes labels that do not match from one stretch to the next. In two interviews from the benchmark, attribution was right in 20 of 21 turns and in 23 of 23.

The text is cut into **citable stretches** of 30 to 60 seconds (45 on average) that end at a sentence boundary. Each stretch is a unit with its time anchor and speaker, and per-word timings are stored too.

## Frames

In videos a frame is taken at every scene change and, if nothing changes, one every 20 seconds (never more than one every 10). Frames are described and vectorised, so you can search for "the blackboard with the diagram" and land on the exact second.

## YouTube, Vimeo and podcasts

A YouTube video is not downloaded: Gemini watches it from its address, ten minutes at a time, and the title and channel come from its public record. From Vimeo the smallest downloadable file is taken; from a podcast, the audio its RSS announces.

## The player

- A timeline with each speaker's turns, the chapters and a frame preview on hover.
- A synchronised transcript that highlights the word being spoken; click a word to jump there.
- To cite, select the text: the citation comes with its exact interval ("12:04-12:40").
- A small player keeps playing while you move around the rest of the app.

## What we measured

A 54-minute video interview was ready in 45 seconds ($0.41), and a two-hour one in 70 seconds ($0.94); transcription costs about $0.005 a minute. In the first Scholaris, the same 54-minute interview took three hours and 39 minutes. All figures and their conditions are in [Performance](/en/knowledge/performance).

## What is missing

Per-word timings are estimated within each segment, not measured one by one. Some videos with uncommon codecs are not yet converted to a format every browser can play.
`,
  },
};
