/**
 * Conversión de reserva en el servidor, para lo que no pasa por la imprenta
 * del navegador (SDK, API, URLs). Produce un `PaqueteConversion` mínimo que la
 * ingesta sabe leer:
 *
 *   - web: se descarga la página, se guarda una copia fechada y se extrae el
 *     artículo en bloques (títulos, párrafos, listas, citas);
 *   - pdf: cada página se lee por visión con sub-PDF (no hay capa de texto en
 *     el servidor de Workers; en local la imprenta de Node lo hace mejor);
 *   - audio: el original entero como un único tramo.
 *
 * Lo demás (vídeo, EPUB, DOCX, presentaciones) necesita la imprenta: en la
 * nube se convierte en el navegador; en local, con `@scholaris/imprenta/node`.
 */
import { sha256, type TipoEntrada } from '@scholaris/nucleo';
import { abrirCortador, VERSION_PAQUETE, type BloqueTexto, type PaginaPdf, type PaqueteConversion } from '@scholaris/imprenta';
import { idYoutube, infoYoutube, MIME_YOUTUBE, tramosDe, bitrateMp3 } from './medios-url.js';

export class ErrorReserva extends Error {
  constructor(mensaje: string) { super(mensaje); this.name = 'ErrorReserva'; }
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' };

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

const limpiar = (html: string) => decodificar(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** Artículo de una página web en bloques, sin dependencias de DOM. */
export function extraerArticulo(html: string): { titulo?: string; autores?: string[]; fecha?: string; idioma?: string; bloques: BloqueTexto[] } {
  const meta = (n: string) => new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*content=["']([^"']+)`, 'i').exec(html)?.[1];
  const titulo = meta('og:title') ?? meta('citation_title') ?? (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ? limpiar(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)![1]!) : undefined);
  const autores = [...html.matchAll(/<meta[^>]+name=["'](?:citation_author|author)["'][^>]*content=["']([^"']+)/gi)].map((m) => decodificar(m[1]!));
  const fecha = meta('article:published_time') ?? meta('citation_publication_date') ?? meta('date');
  const idioma = /<html[^>]+lang=["']([a-zA-Z-]+)/i.exec(html)?.[1]?.slice(0, 2).toLowerCase();
  let cuerpo = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const articulo = /<article[\s\S]*?<\/article>/i.exec(cuerpo)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(cuerpo)?.[0];
  if (articulo && limpiar(articulo).length > 500) cuerpo = articulo;
  const bloques: BloqueTexto[] = [];
  const ruta: string[] = [];
  let parrafo = 0;
  for (const m of cuerpo.matchAll(/<(h[1-6]|p|li|blockquote|pre|td)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const etiqueta = m[1]!.toLowerCase();
    const texto = limpiar(m[2]!);
    if (texto.length < 2) continue;
    if (etiqueta[0] === 'h') {
      const nivel = Number(etiqueta[1]);
      ruta.splice(nivel - 1);
      ruta[nivel - 1] = texto;
      parrafo = 0;
      bloques.push({ tipo: 'titulo', nivel, texto, ruta: ruta.filter(Boolean), parrafo: 0 });
      continue;
    }
    parrafo++;
    bloques.push({ tipo: etiqueta === 'li' ? 'lista' : etiqueta === 'blockquote' ? 'cita' : etiqueta === 'pre' ? 'codigo' : 'parrafo', texto, ruta: ruta.filter(Boolean), parrafo });
  }
  if (!bloques.length) {
    for (const t of limpiar(cuerpo).split(/\n{1,}/).filter((x) => x.trim().length > 40)) bloques.push({ tipo: 'parrafo', texto: t, ruta: [], parrafo: ++parrafo });
  }
  return { ...(titulo ? { titulo } : {}), ...(autores.length ? { autores } : {}), ...(fecha ? { fecha } : {}), ...(idioma ? { idioma } : {}), bloques };
}

export interface EntradaReserva {
  tipo: TipoEntrada | string;
  nombre: string;
  mime: string;
  url?: string;
  /** Bytes del original (pdf, audio). */
  original?: Uint8Array;
  /** Ruta relativa del original dentro del prefijo («original.pdf»). */
  rutaOriginal?: string;
  /** Guarda la copia fechada de la web; devuelve la ruta relativa. */
  guardarCopia?(html: string): Promise<string>;
  fetch?: typeof fetch;
  /** Hay clave de Gemini para YouTube. */
  youtube?: boolean;
  /** Bytes del principio del original (para el bitrate de un MP3 sin cargarlo entero). */
  cabeza?: Uint8Array;
  /** Tamaño del original si no se pasa entero. */
  bytesOriginal?: number;
  duracion?: number;
}

export async function convertirEnServidor(e: EntradaReserva): Promise<PaqueteConversion> {
  const base = { version: VERSION_PAQUETE, avisos: [] as string[], entorno: 'node' as const, tiempos: {}, reserva: null };
  if (e.url && (e.tipo === 'web' || !e.original)) {
    if (idYoutube(e.url)) {
      if (!e.youtube) throw new ErrorReserva('Para traer vídeos de YouTube hace falta una clave de Gemini (en Ajustes → Claves).');
      const info = await infoYoutube(e.url, e.fetch ?? fetch);
      const tramos = tramosDe(info.duracion);
      const partes = tramos.map((t) => ({ id: `youtube:${t.t0}-${t.t1}`, clase: 'audio' as const, mime: MIME_YOUTUBE, bytes: 0, t0: t.t0, t1: t.t1 }));
      return {
        ...base, tipo: 'video',
        origen: { nombre: info.titulo ?? info.url, mime: MIME_YOUTUBE, bytes: 0, huella: await sha256(info.url) },
        // El canal es quien lo publica (editorial), no el autor; YouTube es el contenedor.
        metadatos: {
          ...(info.titulo ? { titulo: info.titulo } : {}), url: info.url, ...(info.idioma ? { idioma: info.idioma } : {}),
          autores: [], ...(info.canal ? { editorial: info.canal } : {}), contenedor: 'YouTube', tipoCSL: 'motion_picture',
          ...(info.fecha ? { fecha: info.fecha, anio: Number(info.fecha.slice(0, 4)) } : {}),
        },
        unidades: tramos.length,
        ...(info.duracion ? { duracion: info.duracion } : {}),
        contenido: {
          clase: 'medio', duracion: info.duracion ?? 0, video: null,
          audio: { muestreo: 0, canales: 0, formato: 'opus', mime: MIME_YOUTUBE, tramos: tramos.map((t, i) => ({ n: i + 1, t0: t.t0, t1: t.t1 || 1e7, propioDesde: t.t0, propioHasta: t.t1 || 1e7, parte: partes[i]!.id })) },
        },
        partes,
        avisos: info.duracion ? [] : ['No se conoce la duración del vídeo: se transcribe de una vez.'],
      };
    }
    const r = await (e.fetch ?? fetch)(e.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Scholaris/2; +https://scholaris.joseluissaorin.com)', accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' }, redirect: 'follow' });
    if (!r.ok) throw new ErrorReserva(`La página respondió con un error ${r.status}.`);
    const tipo = r.headers.get('content-type') ?? '';
    if (tipo.includes('application/pdf')) {
      const bytes = new Uint8Array(await r.arrayBuffer());
      return convertirEnServidor({ ...e, tipo: 'pdf', mime: 'application/pdf', original: bytes, url: undefined });
    }
    const html = await r.text();
    const a = extraerArticulo(html);
    if (!a.bloques.length) throw new ErrorReserva('No he encontrado texto que leer en esa página.');
    const copia = e.guardarCopia ? await e.guardarCopia(html) : undefined;
    const consultada = new Date().toISOString();
    return {
      ...base, tipo: 'web',
      origen: { nombre: e.url, mime: 'text/html', bytes: html.length, huella: await sha256(html) },
      metadatos: {
        ...(a.titulo ? { titulo: a.titulo } : {}), url: e.url, ...(a.idioma ? { idioma: a.idioma } : {}),
        ...(a.fecha && /^\d{4}/.test(a.fecha) ? { anio: Number(a.fecha.slice(0, 4)) } : {}),
        autores: (a.autores ?? []).map((n) => { const p = n.split(/\s+/); return { nombre: p.slice(0, -1).join(' '), apellidos: p.at(-1) ?? n }; }),
      },
      unidades: a.bloques.length,
      contenido: { clase: 'web', url: e.url, consultada, ...(copia ? { copia } : {}), bloques: a.bloques, esquema: a.bloques.filter((b) => b.tipo === 'titulo').map((b, i) => ({ titulo: b.texto, nivel: b.nivel ?? 1, fisica: null, bloque: i })) },
      partes: [],
    };
  }
  // Audio grande descargado (pódcast): se reparte en tramos por bytes sin cargarlo entero.
  if (!e.original && e.cabeza && e.bytesOriginal && (e.tipo === 'audio' || e.tipo === 'video' || /^(audio|video)\//.test(e.mime))) {
    const ruta = e.rutaOriginal ?? 'original';
    const kbps = /mpeg|mp3/.test(e.mime) ? bitrateMp3(e.cabeza) : null;
    const total = e.bytesOriginal;
    const origen = { nombre: e.nombre, mime: e.mime, bytes: total, huella: await sha256(e.cabeza) };
    const duracion = e.duracion ?? (kbps ? (total * 8) / (kbps * 1000) : 0);
    const trozo = kbps ? Math.floor(((kbps * 1000) / 8) * 600) : total;
    const tramos: Array<{ n: number; t0: number; t1: number; propioDesde: number; propioHasta: number; parte: string }> = [];
    const partes: PaqueteConversion['partes'] = [];
    for (let desde = 0, n = 1; desde < total; desde += trozo, n++) {
      const hasta = Math.min(total, desde + trozo) - 1;
      const t0 = kbps ? (desde * 8) / (kbps * 1000) : 0, t1 = kbps ? ((hasta + 1) * 8) / (kbps * 1000) : (duracion || 1e7);
      const id = trozo === total ? ruta : `${ruta}#bytes=${desde}-${hasta}`;
      tramos.push({ n, t0, t1, propioDesde: t0, propioHasta: t1, parte: id });
      partes.push({ id, clase: 'audio', mime: e.mime.startsWith('video/') ? e.mime : e.mime || 'audio/mpeg', bytes: hasta - desde + 1, t0, t1 });
    }
    return {
      ...base, tipo: e.mime.startsWith('video/') ? 'video' : 'audio', origen, metadatos: {}, unidades: tramos.length, ...(duracion ? { duracion } : {}),
      contenido: { clase: 'medio', duracion, video: null, audio: { muestreo: 0, canales: 0, formato: 'opus', mime: e.mime, tramos } },
      partes, avisos: kbps ? [] : ['Medio transcrito de una vez (sin trocear).'],
    };
  }
  if (!e.original) throw new ErrorReserva('Falta el original para convertirlo en el servidor.');
  const origen = { nombre: e.nombre, mime: e.mime, bytes: e.original.byteLength, huella: await sha256(e.original) };
  if (e.tipo === 'pdf' || e.tipo === 'pdf_escaneado' || e.mime === 'application/pdf') {
    const cortador = await abrirCortador(e.original);
    const paginas: PaginaPdf[] = Array.from({ length: cortador.paginas }, (_, i) => ({
      fisica: i + 1, ancho: 595, alto: 842, rotacion: 0, etiqueta: null, clase: 'pdf_escaneado',
      texto: { util: false, calidad: 0, origen: 'ninguno', caracteres: 0, basura: 0, palabrasRaras: 0, coberturaImagen: 1 },
      cuerpo: '', lineas: [], bloques: [], cabecera: [], pie: [], candidatosFolio: [], imagenes: [], ms: 0,
    }));
    return {
      ...base, tipo: 'pdf_escaneado', origen, metadatos: {}, unidades: paginas.length,
      contenido: { clase: 'pdf', paginas, esquema: [], etiquetas: null, mixto: false, paginasEscaneadas: paginas.map((p) => p.fisica), titulillos: { cabecera: [], pie: [] }, info: {}, xmp: null, cifrado: false },
      partes: [], avisos: ['Convertido en el servidor: todas las páginas se leen por visión.'],
    };
  }
  if (e.tipo === 'audio' || e.mime.startsWith('audio/')) {
    const ruta = e.rutaOriginal ?? 'original';
    return {
      ...base, tipo: 'audio', origen, metadatos: {}, unidades: 1,
      contenido: { clase: 'medio', duracion: 0, audio: { muestreo: 0, canales: 0, formato: 'opus', mime: e.mime, tramos: [{ n: 1, t0: 0, t1: 1e7, propioDesde: 0, propioHasta: 1e7, parte: ruta }] }, video: null },
      partes: [{ id: ruta, clase: 'audio', mime: e.mime, bytes: e.original.byteLength, t0: 0, t1: 1e7 }],
      avisos: ['Convertido en el servidor: el audio se transcribe entero, sin trocear.'],
    };
  }
  throw new ErrorReserva('Este tipo de fichero se convierte en el navegador: súbelo desde la aplicación web (o usa la versión local).');
}
