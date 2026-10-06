/** DOCX, ODT, RTF, HTML, Markdown, TXT y EPUB → bloques con ruta de títulos. */

import { strFromU8, unzipSync } from 'fflate';
import type { Contexto } from '../contexto.js';
import type { Deteccion } from '../detectar.js';
import { buscarDoi, partirAutores } from '../pdf/documento.js';
import type { ArchivoEntrada, ContenidoDocumento, EntradaEsquema, MetadatosIncrustados, OrigenArchivo, PaqueteConversion } from '../tipos.js';
import { VERSION_PAQUETE } from '../tipos.js';
import { convertirEpubSincrono } from './epub.js';
import { analizarHtml, bloquesDeArbol, buscar, buscarTodos, textoPlano, type ResultadoBloques } from './html.js';
import { bloquesDeMarkdown, bloquesDeOdt, bloquesDeRtf, bloquesDeTxt, decodificarTexto } from './texto.js';

/** Metadatos de docProps/core.xml (DOCX, XLSX, PPTX). */
export function metadatosOoxml(bytes: Uint8Array): MetadatosIncrustados {
  const m: MetadatosIncrustados = {};
  try {
    const zip = unzipSync(bytes, { filter: (f) => f.name === 'docProps/core.xml' });
    const core = zip['docProps/core.xml'];
    if (!core) return m;
    const arbol = analizarHtml(strFromU8(core), true);
    const campo = (n: string) => { const x = buscar(arbol, (y) => y.nombre === n); return x ? textoPlano(x).trim() : ''; };
    const titulo = campo('title'); if (titulo) m.titulo = titulo;
    const autor = campo('creator'); if (autor) m.autores = partirAutores(autor);
    const creado = campo('created'); if (creado) m.creado = creado;
    const modificado = campo('modified'); if (modificado) m.modificado = modificado;
    const claves = campo('keywords'); if (claves) m.palabrasClave = claves.split(/[;,]\s*/).filter(Boolean);
    const asunto = campo('subject') || campo('description'); if (asunto) m.resumen = asunto;
  } catch {
    /* sin metadatos */
  }
  return m;
}

/** Metadatos de un HTML: <title>, <meta name="author">, y las citation_* de Highwire/Google Scholar. */
export function metadatosHtml(html: string): MetadatosIncrustados {
  const arbol = analizarHtml(html.slice(0, 200_000));
  const m: MetadatosIncrustados = {};
  const metas = buscarTodos(arbol, (n) => n.nombre === 'meta');
  const meta = (nombre: string) => metas.filter((x) => (x.attrs.name ?? x.attrs.property ?? '').toLowerCase() === nombre).map((x) => x.attrs.content ?? '').filter(Boolean);
  const titulo = meta('citation_title')[0] ?? meta('dc.title')[0] ?? meta('og:title')[0] ?? (() => { const t = buscar(arbol, (n) => n.nombre === 'title'); return t ? textoPlano(t).trim() : undefined; })();
  if (titulo) m.titulo = titulo;
  const autores = meta('citation_author');
  if (autores.length) m.autores = autores.flatMap((a) => partirAutores(a));
  else if (meta('author')[0]) m.autores = partirAutores(meta('author')[0] as string);
  const fecha = meta('citation_publication_date')[0] ?? meta('citation_date')[0] ?? meta('dc.date')[0] ?? meta('article:published_time')[0];
  const anio = fecha ? /\d{4}/.exec(fecha)?.[0] : undefined;
  if (anio) m.anio = Number(anio);
  const doi = meta('citation_doi')[0] ?? meta('dc.identifier').find((x) => x.includes('10.'));
  if (doi) m.doi = doi.replace(/^doi:\s*/i, '');
  const revista = meta('citation_journal_title')[0]; if (revista) m.revista = revista;
  const idioma = buscar(arbol, (n) => n.nombre === 'html')?.attrs.lang; if (idioma) m.idioma = idioma;
  return m;
}

function esquemaDeBloques(r: ResultadoBloques): EntradaEsquema[] {
  return r.bloques.flatMap((b, i) => (b.tipo === 'titulo' ? [{ titulo: b.texto, nivel: b.nivel ?? 1, fisica: null, bloque: i }] : []));
}

async function docx(bytes: Uint8Array): Promise<{ r: ResultadoBloques; avisos: string[] }> {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const res = await mammoth.convertToHtml({ arrayBuffer: buf, buffer: bytes } as Parameters<typeof mammoth.convertToHtml>[0], {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Intense Quote'] => blockquote:fresh"],
    // Las imágenes no se incrustan (base64 enorme): solo su texto alternativo.
    convertImage: mammoth.images.imgElement((async (img: { altText?: string }) => ({ src: '', alt: img.altText ?? '' })) as never),
  } as Parameters<typeof mammoth.convertToHtml>[1]);
  const r = bloquesDeArbol(analizarHtml(res.value));
  return { r, avisos: res.messages.filter((m: { type: string }) => m.type === 'error').map((m: { message: string }) => m.message).slice(0, 5) };
}

export async function convertirDocumento(ctx: Contexto, archivo: ArchivoEntrada, d: Deteccion, origen: OrigenArchivo): Promise<PaqueteConversion> {
  await ctx.emitir({ tipo: 'inicio', entrada: d.tipo === 'epub' ? 'epub' : 'documento', origen, unidades: null, metadatos: {} });
  let contenido: ContenidoDocumento;
  let metadatos: MetadatosIncrustados = {};
  const b = archivo.bytes;
  const t = performance.now();
  const formato = d.formato;
  if (formato === 'epub') {
    const e = convertirEpubSincrono(b);
    contenido = e.contenido;
    metadatos = e.metadatos;
    for (const a of e.avisos) await ctx.aviso(a);
  } else {
    let r: ResultadoBloques;
    let f: ContenidoDocumento['formato'];
    if (formato === 'docx') {
      const x = await docx(b);
      r = x.r; f = 'docx';
      for (const a of x.avisos) await ctx.aviso(`mammoth: ${a}`);
      metadatos = metadatosOoxml(b);
    } else if (formato === 'odt') {
      const x = bloquesDeOdt(b); r = x; f = 'odt'; metadatos = x.metadatos;
    } else if (formato === 'rtf') {
      const x = bloquesDeRtf(decodificarTexto(b)); r = x; f = 'rtf'; metadatos = x.metadatos;
    } else if (formato === 'html') {
      const html = decodificarTexto(b);
      const raiz = analizarHtml(html);
      // Prefiere <article> o <main> si existen: fuera queda la navegación.
      const cuerpo = buscar(raiz, (n) => n.nombre === 'article') ?? buscar(raiz, (n) => n.nombre === 'main') ?? buscar(raiz, (n) => n.nombre === 'body') ?? raiz;
      r = bloquesDeArbol(cuerpo); f = 'html'; metadatos = metadatosHtml(html);
    } else if (formato === 'markdown') {
      const x = bloquesDeMarkdown(decodificarTexto(b)); r = x; f = 'markdown'; metadatos = x.metadatos;
    } else {
      r = bloquesDeTxt(decodificarTexto(b)); f = 'txt';
    }
    // Notas: el bloque que las llama.
    const llamadas = new Map<string, number>();
    r.bloques.forEach((bl, i) => bl.notas?.forEach((n) => { if (!llamadas.has(n)) llamadas.set(n, i); }));
    const notas = r.notas.map((n) => { const i = llamadas.get(n.id); return i === undefined ? n : { ...n, bloque: i }; });
    contenido = { clase: 'documento', formato: f, bloques: r.bloques, notas, esquema: esquemaDeBloques(r), paginasImpresas: [] };
    if (!metadatos.titulo) {
      const primero = r.bloques.find((x) => x.tipo === 'titulo');
      if (primero) metadatos.titulo = primero.texto.replace(/[*_`]/g, '');
    }
  }
  const doi = buscarDoi(contenido.bloques.slice(0, 40).map((x) => x.texto).join('\n'));
  if (doi) { metadatos.doiEnTexto = doi; metadatos.doi ??= doi; }
  ctx.tiempos.texto = Math.round(performance.now() - t);
  await ctx.emitir({ tipo: 'progreso', fase: 'texto', hechas: contenido.bloques.length, total: contenido.bloques.length });
  return {
    version: VERSION_PAQUETE,
    tipo: formato === 'epub' ? 'epub' : 'documento',
    origen,
    metadatos,
    unidades: contenido.bloques.length,
    contenido,
    partes: ctx.partes,
    reserva: null,
    avisos: ctx.avisos,
    entorno: ctx.plataforma.nombre,
    tiempos: ctx.cerrarTiempos(),
  };
}
