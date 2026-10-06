/** Qué es un archivo: por firma (bytes mágicos), luego por MIME y por extensión. */

import { unzipSync } from 'fflate';
import type { TipoEntrada } from '@scholaris/nucleo';

export type Formato =
  | 'pdf' | 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff' | 'heic' | 'bmp' | 'avif'
  | 'mp3' | 'wav' | 'm4a' | 'ogg' | 'flac' | 'aac' | 'webm_audio'
  | 'mp4' | 'mov' | 'webm' | 'mkv' | 'avi'
  | 'docx' | 'odt' | 'rtf' | 'html' | 'markdown' | 'txt' | 'epub'
  | 'pptx' | 'odp' | 'key'
  | 'xlsx' | 'xls' | 'ods' | 'csv' | 'tsv'
  | 'desconocido';

export interface Deteccion {
  formato: Formato;
  tipo: TipoEntrada;
  mime: string;
}

const MIMES: Record<Formato, string> = {
  pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  tiff: 'image/tiff', heic: 'image/heic', bmp: 'image/bmp', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', webm_audio: 'audio/webm',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', html: 'text/html',
  markdown: 'text/markdown', txt: 'text/plain', epub: 'application/epub+zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation', key: 'application/vnd.apple.keynote',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', csv: 'text/csv', tsv: 'text/tab-separated-values',
  desconocido: 'application/octet-stream',
};

const TIPOS: Record<Formato, TipoEntrada> = {
  pdf: 'pdf', jpeg: 'imagen', png: 'imagen', webp: 'imagen', gif: 'imagen', tiff: 'imagen', heic: 'imagen', bmp: 'imagen', avif: 'imagen',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio', aac: 'audio', webm_audio: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  docx: 'documento', odt: 'documento', rtf: 'documento', html: 'documento', markdown: 'documento', txt: 'documento', epub: 'epub',
  pptx: 'presentacion', odp: 'presentacion', key: 'presentacion',
  xlsx: 'hoja', xls: 'hoja', ods: 'hoja', csv: 'hoja', tsv: 'hoja',
  desconocido: 'documento',
};

const EXTENSIONES: Record<string, Formato> = {
  pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', tif: 'tiff', tiff: 'tiff', heic: 'heic', heif: 'heic', bmp: 'bmp', avif: 'avif',
  mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg', oga: 'ogg', opus: 'ogg', flac: 'flac', aac: 'aac', weba: 'webm_audio',
  mp4: 'mp4', m4v: 'mp4', mov: 'mov', webm: 'webm', mkv: 'mkv', avi: 'avi',
  docx: 'docx', odt: 'odt', rtf: 'rtf', html: 'html', htm: 'html', xhtml: 'html', md: 'markdown', markdown: 'markdown', txt: 'txt', text: 'txt', epub: 'epub',
  pptx: 'pptx', odp: 'odp', key: 'key',
  xlsx: 'xlsx', xlsm: 'xlsx', xls: 'xls', ods: 'ods', csv: 'csv', tsv: 'tsv',
};

function empieza(b: Uint8Array, firma: number[], desde = 0): boolean {
  return firma.every((v, i) => b[desde + i] === v);
}

function ascii(b: Uint8Array, desde: number, n: number): string {
  return String.fromCharCode(...b.subarray(desde, desde + n));
}

/** Mira dentro de un ZIP para distinguir DOCX, XLSX, PPTX, EPUB y ODF. */
function formatoZip(b: Uint8Array): Formato | null {
  // El mimetype de EPUB/ODF va sin comprimir al principio.
  const cabeza = ascii(b, 30, 60);
  if (cabeza.startsWith('mimetype')) {
    if (cabeza.includes('application/epub+zip')) return 'epub';
    if (cabeza.includes('opendocument.text')) return 'odt';
    if (cabeza.includes('opendocument.presentation')) return 'odp';
    if (cabeza.includes('opendocument.spreadsheet')) return 'ods';
  }
  try {
    const nombres: string[] = [];
    unzipSync(b, { filter: (f) => { nombres.push(f.name); return false; } });
    if (nombres.some((n) => n.startsWith('word/'))) return 'docx';
    if (nombres.some((n) => n.startsWith('xl/'))) return 'xlsx';
    if (nombres.some((n) => n.startsWith('ppt/'))) return 'pptx';
    if (nombres.includes('META-INF/container.xml')) return 'epub';
    if (nombres.some((n) => n.startsWith('Index/') || n.endsWith('.iwa'))) return 'key';
  } catch {
    /* ZIP roto */
  }
  return null;
}

export function detectar(bytes: Uint8Array, nombre: string, mime?: string): Deteccion {
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre)?.[1] ?? '').toLowerCase();
  let f: Formato | null = null;
  const b = bytes;
  if (ascii(b, 0, 1024).includes('%PDF-')) f = 'pdf';
  else if (empieza(b, [0xff, 0xd8, 0xff])) f = 'jpeg';
  else if (empieza(b, [0x89, 0x50, 0x4e, 0x47])) f = 'png';
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') f = 'webp';
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') f = 'wav';
  else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'AVI ') f = 'avi';
  else if (ascii(b, 0, 3) === 'GIF') f = 'gif';
  else if (ascii(b, 0, 2) === 'BM') f = 'bmp';
  else if (empieza(b, [0x49, 0x49, 0x2a, 0]) || empieza(b, [0x4d, 0x4d, 0, 0x2a])) f = 'tiff';
  else if (ascii(b, 0, 4) === 'OggS') f = 'ogg';
  else if (ascii(b, 0, 4) === 'fLaC') f = 'flac';
  else if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0 && ((b[1] ?? 0) & 0x06) !== 0)) f = 'mp3';
  else if (b[0] === 0xff && ((b[1] ?? 0) & 0xf6) === 0xf0) f = 'aac';
  else if (ascii(b, 4, 4) === 'ftyp') {
    const marca = ascii(b, 8, 4);
    if (/^hei|^mif1|^heix|^msf1/.test(marca)) f = 'heic';
    else if (/^avif/.test(marca)) f = 'avif';
    else if (/^qt/.test(marca)) f = 'mov';
    else if (/^M4A|^M4B/.test(marca) || ext === 'm4a') f = 'm4a';
    else f = 'mp4';
  } else if (empieza(b, [0x1a, 0x45, 0xdf, 0xa3])) f = ext === 'mkv' ? 'mkv' : (ext === 'weba' || mime?.startsWith('audio/')) ? 'webm_audio' : 'webm';
  else if (empieza(b, [0x50, 0x4b, 0x03, 0x04])) f = formatoZip(b);
  else if (ascii(b, 0, 5) === '{\\rtf') f = 'rtf';
  else if (empieza(b, [0xd0, 0xcf, 0x11, 0xe0])) f = ext === 'xls' ? 'xls' : null;

  if (!f && ext && EXTENSIONES[ext]) f = EXTENSIONES[ext] as Formato;
  if (!f && mime) {
    const porMime = (Object.entries(MIMES) as Array<[Formato, string]>).find(([, m]) => m === mime);
    if (porMime) f = porMime[0];
  }
  if (!f) {
    // ¿Texto? Mira si parece HTML o Markdown.
    const cabeza = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048)).trimStart().toLowerCase();
    if (cabeza.startsWith('<!doctype html') || cabeza.startsWith('<html') || cabeza.includes('<body')) f = 'html';
    else f = 'txt';
  }
  return { formato: f, tipo: TIPOS[f], mime: mime && mime !== 'application/octet-stream' ? mime : MIMES[f] };
}

/** Orden natural por nombre: «IMG_2.jpg» antes que «IMG_10.jpg». */
export function compararNombres(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
