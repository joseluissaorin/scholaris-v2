/**
 * La demostración en vídeo: un solo sitio para sus datos, que leen la portada
 * (la sección, el JSON-LD y el gemelo .md), /saber, llms.txt y el sitemap.
 *
 * Los MP4 pasan de 25 MB, el límite de los estáticos de Workers: viven en R2
 * (publico/demo/…) y los sirve el Worker en /demo/… con Range (ver
 * apps/api/src/cloudflare/demo.ts). El póster y los .vtt son estáticos de
 * apps/web/public/portada/demo/. Los nombres llevan la versión: si se vuelve a
 * montar el vídeo, se sube con otra versión y se cambia aquí.
 */
import type { Lengua } from './dibujo/boceto';

export interface CapituloVideo {
  /** Segundo en que empieza. */
  t: number;
  es: string;
  en: string;
}

export const VIDEO = {
  mp4: '/demo/scholaris-demo-v1-1080.mp4',
  mp4Movil: '/demo/scholaris-demo-v1-720.mp4',
  poster: '/portada/demo/scholaris-demo-v1-poster.webp',
  subtitulos: '/portada/demo/scholaris-demo-v1-en.vtt',
  capitulosVtt: '/portada/demo/scholaris-demo-v1-chapters-en.vtt',
  /** ISO 8601, para schema.org. */
  duracion: 'PT8M43S',
  segundos: 523,
  reloj: '8:43',
  publicado: '2026-10-07',
  ancho: 1920,
  alto: 1080,
  /** Megabytes de cada versión (para el enlace de descarga y llms.txt). */
  mb: { 1080: 69, 720: 46 },
  capitulos: [
    { t: 0, es: 'Prólogo, la mano que señala', en: 'Prologue, the pointing hand' },
    { t: 45.7, es: 'Cualquier cosa entra', en: 'Anything goes in' },
    { t: 115.5, es: 'La página impresa', en: 'The printed page' },
    { t: 206.8, es: 'El segundo exacto', en: 'The exact second' },
    { t: 276.5, es: 'Una búsqueda para todo', en: 'One search, everything' },
    { t: 325, es: 'Preguntar y comprobar', en: 'Ask, and check' },
    { t: 360.8, es: 'Escribir de memoria', en: 'Write from memory' },
    { t: 398.2, es: 'La forma de una biblioteca', en: 'The shape of a library' },
    { t: 433.5, es: 'Compartida', en: 'Shared' },
    { t: 454.2, es: 'Fuera de la ventana', en: 'Outside the window' },
    { t: 497.7, es: 'Coda', en: 'Coda' },
  ] satisfies CapituloVideo[],
} as const;

export interface TextosVideo {
  /** Título del vídeo (schema.org, sitemap, llms.txt). */
  nombre: string;
  /** Descripción larga (schema.org, sitemap, llms.txt, /saber). */
  descripcion: string;
  folio: string;
  numero: string;
  rubrica: string;
  entradilla: string;
  /** La monoespaciada bajo el título: duración y lengua. */
  dato: string;
  /** La nota a mano junto a la manícula. */
  nota: string;
  /** El enlace desde el héroe. */
  ver: string;
  capitulos: string;
  descargar: string;
  /** Texto para quien no puede reproducir vídeo. */
  sinVideo: string;
}

export const TEXTOS_VIDEO: Record<Lengua, TextosVideo> = {
  es: {
    nombre: 'Scholaris, una demostración',
    descripcion:
      'Ocho minutos y medio de Scholaris trabajando con una biblioteca de verdad: una comedia de Lope de Vega impresa en Sevilla hacia 1700, un artículo sobre la corrección del OCR antiguo, una lectura de Bécquer en LibriVox y dos horas de Cortázar en televisión. Se ve el folio impreso y el segundo exacto, la búsqueda en todo a la vez, las respuestas con cada nota comprobada, cómo propone citas para un párrafo escrito de memoria, el mapa de la biblioteca, las colecciones compartidas, la API, el servidor MCP y la versión local. En inglés, con subtítulos en inglés.',
    folio: 'fol. 1v',
    numero: 'Lámina en movimiento,',
    rubrica: 'que enseña a Scholaris trabajando, de la primera hoja a la última cita',
    entradilla:
      'Una comedia de Lope impresa hacia 1700, un artículo, una lectura de Bécquer y dos horas de Cortázar en televisión entran a la vez, y en ocho minutos se ve lo que cuenta esta portada: el folio impreso, el segundo exacto, la búsqueda, las respuestas con su nota y la cita comprobada.',
    dato: '8:43 · en inglés, con subtítulos',
    nota: 'mírala trabajar',
    ver: 'Ver la demostración (8 min)',
    capitulos: 'Capítulos del vídeo',
    descargar: 'Descargar el MP4',
    sinVideo: 'Tu navegador no reproduce este vídeo; puedes descargarlo en MP4.',
  },
  en: {
    nombre: 'Scholaris, a demonstration',
    descripcion:
      'Eight and a half minutes of Scholaris at work on a real library: a Lope de Vega comedia printed in Seville around 1700, a paper on correcting old OCR, a LibriVox reading of Bécquer and two hours of Cortázar on Spanish television. It shows the printed folio and the exact second, one search across everything, answers with every note checked, citations proposed for a paragraph written from memory, the shape of the library, shared collections, the API, the MCP server and the local version. In English, with English subtitles.',
    folio: 'fol. 1v',
    numero: 'A moving plate,',
    rubrica: 'which shows Scholaris at work, from the first leaf to the last citation',
    entradilla:
      'A Lope de Vega comedia printed around 1700, a paper, a reading of Bécquer and two hours of Cortázar on Spanish television go in together, and in eight minutes you see what this page talks about: the printed folio, the exact second, the search, answers with their notes and the checked citation.',
    dato: '8:43 · English, subtitled',
    nota: 'watch it work',
    ver: 'Watch the demo (8 min)',
    capitulos: 'Chapters',
    descargar: 'Download the MP4',
    sinVideo: 'Your browser cannot play this video; you can download it as an MP4.',
  },
};

/** 45.7 → «0:45». */
export function reloj(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 45.7 → «PT45S», para los Clip de schema.org. */
export const isoSegundos = (t: number) => `PT${Math.floor(t)}S`;

/** El vídeo contado en Markdown: para el gemelo de la portada, /saber y llms.txt. */
export function videoMd(l: Lengua, origen: string, pagina: string): string {
  const t = TEXTOS_VIDEO[l];
  const mb = (n: number) => (n ? ` (${n} MB)` : '');
  const lineas = [
    t.descripcion,
    '',
    l === 'es'
      ? `- [Verlo en la portada](${origen}${pagina}#demostracion)`
      : `- [Watch it on the front page](${origen}${pagina}#demostracion)`,
    `- [MP4 1080p${mb(VIDEO.mb[1080])}](${origen}${VIDEO.mp4})`,
    `- [MP4 720p${mb(VIDEO.mb[720])}](${origen}${VIDEO.mp4Movil})`,
    l === 'es' ? `- [Subtítulos en inglés (WebVTT)](${origen}${VIDEO.subtitulos})` : `- [English subtitles (WebVTT)](${origen}${VIDEO.subtitulos})`,
    l === 'es' ? `- Duración: ${VIDEO.reloj}. Publicado el ${VIDEO.publicado}.` : `- Length: ${VIDEO.reloj}. Published ${VIDEO.publicado}.`,
    '',
    l === 'es' ? 'Capítulos:' : 'Chapters:',
    '',
    ...VIDEO.capitulos.map((c) => `- ${reloj(c.t)} ${c[l]}${l === 'es' && c.es !== c.en ? ` (*${c.en}*)` : ''}`),
  ];
  return lineas.join('\n');
}
