/**
 * Medios por URL: YouTube (Gemini lo ve directamente por su URL, sin
 * descargar nada), Vimeo y pódcast (se baja el audio o el vídeo al almacén si
 * hay un enlace directo).
 *
 * Los tramos de YouTube y los trozos de MP3 son «partes virtuales» del paquete:
 *   youtube:<t0>-<t1>          → el transcriptor llama a Gemini con la URL y ese intervalo
 *   <ruta>#bytes=<desde>-<hasta> → se lee ese rango del original en el almacén
 */
import { crearGemini, MODELOS_GEMINI, type ConfigGemini } from '@scholaris/proveedores';
import type { PalabraTranscrita, Transcripcion, Transcriptor } from '@scholaris/nucleo';

export const MIME_YOUTUBE = 'application/x-youtube';
const TRAMO = 600; // segundos por tramo

export function idYoutube(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(u.pathname);
      return m?.[1] ?? null;
    }
  } catch { /* no es URL */ }
  return null;
}

export const esVimeo = (url: string) => { try { return /(^|\.)vimeo\.com$/.test(new URL(url).hostname); } catch { return false; } };

export interface InfoYoutube {
  id: string; url: string; titulo?: string; canal?: string; duracion?: number; idioma?: string;
  /** Fecha de publicación (AAAA-MM-DD). */
  fecha?: string; descripcion?: string; miniatura?: string;
}

const NAVEGADOR = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/**
 * Datos del vídeo. Primero la API del reproductor de YouTube (la que usa su
 * propia web: duración, canal, fecha, descripción), que responde también desde
 * Cloudflare; luego oEmbed y la página (con el consentimiento ya dado, que si
 * no YouTube devuelve su aviso de cookies y no hay duración).
 */
export async function infoYoutube(url: string, f: typeof fetch = fetch): Promise<InfoYoutube> {
  const id = idYoutube(url);
  if (!id) throw new Error('No es una URL de YouTube válida.');
  const canonica = `https://www.youtube.com/watch?v=${id}`;
  const info: InfoYoutube = { id, url: canonica, miniatura: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  // Desde Cloudflare, el cliente «WEB» pide confirmar que no es un robot; el de la web móvil responde.
  for (const client of [{ clientName: 'MWEB', clientVersion: '2.20251001.00.00', hl: 'en', gl: 'US' }, { clientName: 'WEB', clientVersion: '2.20251001.00.00', hl: 'en', gl: 'US' }]) {
    if (info.duracion) break;
    try {
      const r = await f('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': NAVEGADOR },
        body: JSON.stringify({ videoId: id, context: { client } }),
      });
      if (r.ok) {
        const j = (await r.json()) as {
          videoDetails?: { title?: string; author?: string; lengthSeconds?: string; shortDescription?: string };
          microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string } };
        };
        const v = j.videoDetails ?? {};
        if (v.title) info.titulo = v.title;
        if (v.author) info.canal = v.author;
        if (v.lengthSeconds && Number(v.lengthSeconds) > 0) info.duracion = Number(v.lengthSeconds);
        if (v.shortDescription) info.descripcion = v.shortDescription.slice(0, 2000);
        const fecha = j.microformat?.playerMicroformatRenderer?.publishDate ?? j.microformat?.playerMicroformatRenderer?.uploadDate;
        if (fecha && /^\d{4}-\d{2}-\d{2}/.test(fecha)) info.fecha = fecha.slice(0, 10);
      }
    } catch { /* sin la API del reproductor con este cliente */ }
  }
  if (!info.titulo || !info.canal) {
    try {
      const o = await f(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonica)}`);
      if (o.ok) {
        const j = (await o.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        if (j.title) info.titulo ??= j.title;
        if (j.author_name) info.canal ??= j.author_name;
        if (j.thumbnail_url) info.miniatura = j.thumbnail_url;
      }
    } catch { /* sin oEmbed */ }
  }
  if (!info.duracion || !info.fecha || !info.idioma) {
    try {
      const p = await f(canonica, { headers: { 'accept-language': 'en;q=0.8', 'user-agent': NAVEGADOR, cookie: 'SOCS=CAI; CONSENT=YES+cb' } });
      if (p.ok) {
        const html = await p.text();
        const d = /"lengthSeconds":"(\d+)"/.exec(html)?.[1];
        if (!info.duracion && d) info.duracion = Number(d);
        const fecha = /"publishDate":"(\d{4}-\d{2}-\d{2})/.exec(html)?.[1] ?? /itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
        if (!info.fecha && fecha) info.fecha = fecha;
        // Solo el idioma del audio: el de la página es el de la interfaz, no el del vídeo.
        const idioma = /"defaultAudioLanguage":"([a-zA-Z-]+)"/.exec(html)?.[1];
        if (idioma) info.idioma = idioma.slice(0, 2).toLowerCase();
      }
    } catch { /* sin página */ }
  }
  // «Título | Canal» → «Título».
  if (info.titulo && info.canal) info.titulo = info.titulo.replace(new RegExp(`\\s*[|·–—-]\\s*${info.canal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '').trim() || info.titulo;
  return info;
}

/** Tramos de [0, duración) de diez minutos (uno solo si no se sabe la duración). */
export function tramosDe(duracion?: number): Array<{ t0: number; t1: number }> {
  if (!duracion || duracion <= 0) return [{ t0: 0, t1: 0 }];
  const out: Array<{ t0: number; t1: number }> = [];
  for (let t = 0; t < duracion; t += TRAMO) out.push({ t0: t, t1: Math.min(duracion, t + TRAMO) });
  return out;
}

const ESQUEMA = {
  type: 'object',
  properties: {
    idioma: { type: 'string', description: 'Código BCP-47 del idioma hablado (o del texto en pantalla si no se habla).' },
    segmentos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          inicio: { type: 'string', description: 'Marca de inicio H:MM:SS.s desde el principio del vídeo completo.' },
          fin: { type: 'string', description: 'Marca de fin H:MM:SS.s.' },
          hablante: { type: 'string', description: 'Nombre o papel de quien habla; «Rótulo» si es texto en pantalla que nadie lee en voz alta.' },
          texto: { type: 'string' },
        },
        required: ['inicio', 'fin', 'texto'],
      },
    },
  },
  required: ['segmentos'],
};

const aSegundos = (s: string) => s.split(':').map(Number).reduce((a, x) => a * 60 + (Number.isFinite(x) ? x : 0), 0);
const marca = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Las palabras de un segmento con su instante: Gemini da el segmento (una frase
 * corta) y el tiempo se reparte entre sus palabras según su longitud. Para el
 * karaoke y las citas al segundo basta; el segmento sigue siendo exacto.
 */
export function palabrasDeSegmento(s: { t0: number; t1: number; texto: string; hablante?: string }): PalabraTranscrita[] {
  const ps = s.texto.split(/\s+/).filter(Boolean);
  if (!ps.length) return [];
  const dur = Math.max(0.3, s.t1 - s.t0);
  const pesos = ps.map((p) => p.length + 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  let t = s.t0;
  return ps.map((texto, i) => {
    const d = (dur * pesos[i]!) / total;
    const w: PalabraTranscrita = { texto, t0: Math.round(t * 100) / 100, t1: Math.round((t + d) * 100) / 100, ...(s.hablante ? { hablante: s.hablante } : {}) };
    t += d;
    return w;
  });
}

/** Transcribe un tramo de un vídeo de YouTube con Gemini, sin descargarlo: lo que se dice y, si no se dice, lo que se lee en pantalla. */
export async function transcribirYoutube(cfg: ConfigGemini, url: string, t0: number, t1: number, opciones: { idioma?: string; pista?: string } = {}): Promise<Transcripcion> {
  const g = crearGemini({ ...cfg, timeoutMs: Math.max(cfg.timeoutMs ?? 0, 600_000), intentos: cfg.intentos ?? 3 });
  const parteVideo: Record<string, unknown> = { fileData: { fileUri: url, mimeType: 'video/*' } };
  if (t1 > t0) parteVideo.videoMetadata = { startOffset: `${Math.floor(t0)}s`, endOffset: `${Math.ceil(t1)}s` };
  const intervalo = t1 > t0 ? ` Transcribe SOLO el intervalo de ${marca(t0)} a ${marca(t1)}.` : '';
  const instrucciones = `Transcribe literalmente todo lo que se dice en este vídeo, en su idioma original, sin traducir ni resumir.${intervalo} ` +
    'Divide en segmentos cortos (una frase, como mucho unos ocho segundos), con marcas H:MM:SS.s contadas desde el principio del vídeo completo y el nombre o papel del hablante si se distingue. ' +
    'Además, el texto que aparece escrito en pantalla y que nadie lee en voz alta (rótulos, citas, títulos, explicaciones) es parte del contenido: transcríbelo también, cuando aparece, como segmento con hablante «Rótulo». ' +
    'Ignora los créditos repetitivos y los logotipos. ' +
    `Si en el intervalo no se habla ni hay texto en pantalla, devuelve una lista vacía.${opciones.idioma ? ` Idioma probable: ${opciones.idioma}.` : ''}${opciones.pista ? ` Pista: ${opciones.pista}.` : ''}`;
  const { texto } = await g.generar(MODELOS_GEMINI.redactorAlto, {
    contents: [{ role: 'user', parts: [parteVideo, { text: instrucciones }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ESQUEMA, maxOutputTokens: 65536 },
  }, 'transcribir');
  let j: { idioma?: string; segmentos?: Array<{ inicio: string; fin: string; hablante?: string; texto: string }> };
  try { j = JSON.parse(texto); } catch { j = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)); }
  let segs = (j.segmentos ?? []).filter((s) => s.texto?.trim()).map((s) => ({ t0: aSegundos(s.inicio), t1: aSegundos(s.fin), hablante: s.hablante?.trim() || undefined, texto: s.texto.trim() }));
  // Si el modelo contó desde el inicio del tramo, se desplaza.
  if (t0 > 1 && segs.length && segs.every((s) => s.t1 <= t1 - t0 + 5) && segs[0]!.t0 < t0 - 5) segs = segs.map((s) => ({ ...s, t0: s.t0 + t0, t1: s.t1 + t0 }));
  // En orden, dentro del tramo y sin solaparse (el siguiente empieza donde acaba el anterior como pronto).
  segs.sort((a, b) => a.t0 - b.t0);
  const fin = t1 > t0 ? t1 : Infinity;
  const limpios: typeof segs = [];
  for (const s of segs) {
    const a = Math.max(s.t0, t0, limpios.at(-1)?.t1 ?? 0);
    const b = Math.min(Math.max(s.t1, a + 0.4), fin);
    if (b > a) limpios.push({ ...s, t0: a, t1: b });
  }
  const palabras = limpios.flatMap((s) => palabrasDeSegmento(s as { t0: number; t1: number; texto: string; hablante?: string }));
  return { ...(j.idioma ? { idioma: j.idioma.slice(0, 2) } : {}), palabras, texto: limpios.map((s) => s.texto).join(' ') };
}

/** Un transcriptor que, para las partes de YouTube, llama a Gemini con la URL. */
export function transcriptorConYoutube(t: Transcriptor, cfg: ConfigGemini | undefined): Transcriptor {
  if (!cfg) return t;
  return {
    nombre: t.nombre,
    async transcribir(audio, opciones) {
      if (audio.mime !== MIME_YOUTUBE) return t.transcribir(audio, opciones);
      const { url, t0, t1 } = JSON.parse(new TextDecoder().decode(audio.bytes)) as { url: string; t0: number; t1: number };
      return transcribirYoutube(cfg, url, t0, t1, { ...(opciones?.idioma ? { idioma: opciones.idioma } : {}), ...(opciones?.pista ? { pista: opciones.pista } : {}) });
    },
  };
}

// ---------------------------------------------------------------------------
// Vimeo, pódcast y enlaces directos
// ---------------------------------------------------------------------------

export interface MedioEncontrado { url: string; mime?: string; titulo?: string; autor?: string; duracion?: number }

const ES_MEDIO = /^(audio|video)\//;

/** Encuentra el fichero de audio o vídeo detrás de una URL (directa, página de episodio, feed RSS, Vimeo). */
export async function encontrarMedio(url: string, f: typeof fetch = fetch): Promise<MedioEncontrado | null> {
  if (esVimeo(url)) {
    const id = /vimeo\.com\/(?:video\/)?(\d+)/.exec(url)?.[1];
    if (!id) return null;
    const info: MedioEncontrado = { url: '' };
    try {
      const o = await f(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
      if (o.ok) { const j = (await o.json()) as { title?: string; author_name?: string; duration?: number }; info.titulo = j.title; info.autor = j.author_name; info.duracion = j.duration; }
    } catch { /* sin oEmbed */ }
    try {
      const c = await f(`https://player.vimeo.com/video/${id}/config`, { headers: { referer: url } });
      if (c.ok) {
        const j = (await c.json()) as { request?: { files?: { progressive?: Array<{ url: string; width?: number; mime?: string }> } } };
        const prog = (j.request?.files?.progressive ?? []).sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
        if (prog) return { ...info, url: prog.url, mime: prog.mime ?? 'video/mp4' };
      }
    } catch { /* sin config */ }
    return null;
  }
  const r = await f(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Scholaris/2)', accept: '*/*' }, redirect: 'follow' });
  const tipo = (r.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (ES_MEDIO.test(tipo) || /\.(mp3|m4a|aac|ogg|opus|wav|flac|mp4|webm|mov)(\?|$)/i.test(new URL(r.url).pathname)) {
    await r.body?.cancel();
    return { url: r.url, mime: ES_MEDIO.test(tipo) ? tipo : undefined };
  }
  const texto = await r.text();
  const abs = (u: string) => new URL(u.replace(/&amp;/g, '&'), r.url).toString();
  if (/xml|rss/.test(tipo) || /^\s*<\?xml|<rss/i.test(texto.slice(0, 500))) {
    const enc = /<enclosure[^>]+url=["']([^"']+)["'][^>]*?(?:type=["']([^"']+)["'])?/i.exec(texto);
    const titulo = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(texto)?.[1];
    return enc ? { url: abs(enc[1]!), ...(enc[2] ? { mime: enc[2] } : {}), ...(titulo ? { titulo: titulo.trim() } : {}) } : null;
  }
  const meta = (p: string) => new RegExp(`<meta[^>]+property=["']${p}["'][^>]*content=["']([^"']+)`, 'i').exec(texto)?.[1];
  const candidato = meta('og:audio:secure_url') ?? meta('og:audio') ?? meta('og:video:secure_url') ?? meta('og:video:url') ?? meta('og:video')
    ?? /<(?:audio|source)[^>]+src=["']([^"']+\.(?:mp3|m4a|aac|ogg|opus|mp4|webm)[^"']*)["']/i.exec(texto)?.[1]
    ?? /href=["']([^"']+\.(?:mp3|m4a)(?:\?[^"']*)?)["']/i.exec(texto)?.[1];
  if (!candidato) return null;
  const titulo = meta('og:title') ?? /<title[^>]*>([^<]*)<\/title>/i.exec(texto)?.[1];
  return { url: abs(candidato), ...(titulo ? { titulo: titulo.trim() } : {}) };
}

/** Bitrate (kbps) del primer marco MPEG de un MP3, para repartirlo en tramos por bytes. */
export function bitrateMp3(b: Uint8Array): number | null {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + (((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f));
  const TABLA_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const TABLA_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  for (; i < b.length - 4; i++) {
    if (b[i] !== 0xff || (b[i + 1]! & 0xe0) !== 0xe0) continue;
    const version = (b[i + 1]! >> 3) & 3; // 3 = MPEG1
    const capa = (b[i + 1]! >> 1) & 3; // 1 = Layer III
    const idx = (b[i + 2]! >> 4) & 15;
    if (capa !== 1 || idx === 0 || idx === 15) continue;
    return (version === 3 ? TABLA_V1_L3 : TABLA_V2_L3)[idx] ?? null;
  }
  return null;
}
