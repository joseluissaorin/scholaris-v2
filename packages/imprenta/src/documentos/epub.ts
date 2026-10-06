/**
 * EPUB: se abre el ZIP en el navegador, se sigue el lomo (spine) del OPF, se
 * lee el índice (nav de EPUB 3 o NCX de EPUB 2) y, sobre todo, la lista de
 * páginas del libro impreso (page-list / epub:type="pagebreak"), que da el
 * folio en papel de cada párrafo.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { BloqueTexto, ContenidoDocumento, EntradaEsquema, MetadatosIncrustados, NotaTexto } from '../tipos.js';
import { partirAutores } from '../pdf/documento.js';
import { analizarHtml, bloquesDeArbol, buscar, buscarTodos, textoPlano, type Nodo } from './html.js';

export function resolverRuta(base: string, rel: string): string {
  const sinFrag = rel.split('#')[0] ?? '';
  let r: string;
  try { r = decodeURIComponent(sinFrag); } catch { r = sinFrag; }
  if (r.startsWith('/')) return r.slice(1);
  const partes = base.split('/').slice(0, -1);
  for (const p of r.split('/')) {
    if (p === '..') partes.pop();
    else if (p !== '.' && p !== '') partes.push(p);
  }
  return partes.join('/');
}

function fragmento(href: string): string | null {
  const i = href.indexOf('#');
  return i >= 0 ? href.slice(i + 1) : null;
}

interface EntradaNav { titulo: string; href: string; nivel: number }

function leerNavXhtml(arbol: Nodo, base: string): { toc: EntradaNav[]; paginas: EntradaNav[] } {
  const navs = buscarTodos(arbol, (n) => n.nombre === 'nav');
  const deLista = (ol: Nodo | null, nivel: number, salida: EntradaNav[]) => {
    if (!ol) return;
    for (const li of ol.hijos.filter((h) => h.nombre === 'li')) {
      const a = li.hijos.find((h) => h.nombre === 'a' || h.nombre === 'span');
      if (a) {
        const href = a.attrs.href ? `${resolverRuta(base, a.attrs.href)}${fragmento(a.attrs.href) ? '#' + fragmento(a.attrs.href) : ''}` : '';
        salida.push({ titulo: textoPlano(a).replace(/\s+/g, ' ').trim(), href, nivel });
      }
      deLista(li.hijos.find((h) => h.nombre === 'ol') ?? null, nivel + 1, salida);
    }
  };
  const toc: EntradaNav[] = [], paginas: EntradaNav[] = [];
  for (const nav of navs) {
    const tipo = `${nav.attrs['epub:type'] ?? ''} ${nav.attrs.role ?? ''}`;
    const ol = buscar(nav, (n) => n.nombre === 'ol');
    if (/page-list|doc-pagelist/.test(tipo)) deLista(ol, 1, paginas);
    else if (/\btoc\b|doc-toc/.test(tipo) && !toc.length) deLista(ol, 1, toc);
  }
  return { toc, paginas };
}

function leerNcx(arbol: Nodo, base: string): { toc: EntradaNav[]; paginas: EntradaNav[] } {
  const toc: EntradaNav[] = [];
  const recorrer = (n: Nodo, nivel: number) => {
    for (const p of n.hijos.filter((h) => h.nombre === 'navpoint')) {
      const etiqueta = buscar(p, (x) => x.nombre === 'navlabel');
      const c = p.hijos.find((x) => x.nombre === 'content');
      const src = c?.attrs.src ?? '';
      toc.push({ titulo: etiqueta ? textoPlano(etiqueta).replace(/\s+/g, ' ').trim() : '', href: `${resolverRuta(base, src)}${fragmento(src) ? '#' + fragmento(src) : ''}`, nivel });
      recorrer(p, nivel + 1);
    }
  };
  const mapa = buscar(arbol, (n) => n.nombre === 'navmap');
  if (mapa) recorrer(mapa, 1);
  const paginas = buscarTodos(arbol, (n) => n.nombre === 'pagetarget').map((p) => {
    const etiqueta = buscar(p, (x) => x.nombre === 'navlabel');
    const src = p.hijos.find((x) => x.nombre === 'content')?.attrs.src ?? '';
    return { titulo: (p.attrs.value || (etiqueta ? textoPlano(etiqueta).trim() : '')).trim(), href: `${resolverRuta(base, src)}${fragmento(src) ? '#' + fragmento(src) : ''}`, nivel: 1 };
  });
  return { toc, paginas };
}

export function convertirEpubSincrono(bytes: Uint8Array): { contenido: ContenidoDocumento; metadatos: MetadatosIncrustados; avisos: string[] } {
  const zip = unzipSync(bytes);
  const avisos: string[] = [];
  const leer = (ruta: string): string | null => {
    const b = zip[ruta] ?? zip[Object.keys(zip).find((k) => k.toLowerCase() === ruta.toLowerCase()) ?? ''];
    return b ? strFromU8(b) : null;
  };
  const contenedor = leer('META-INF/container.xml');
  const rutaOpf = contenedor ? buscar(analizarHtml(contenedor, true), (n) => n.nombre === 'rootfile')?.attrs['full-path'] : Object.keys(zip).find((k) => k.endsWith('.opf'));
  if (!rutaOpf) throw new Error('EPUB sin OPF');
  const opf = analizarHtml(leer(rutaOpf) ?? '', true);

  // --- Metadatos (dc:*) ---
  const md = buscar(opf, (n) => n.nombre === 'metadata');
  const dc = (nombre: string) => (md ? buscarTodos(md, (n) => n.nombre === nombre).map((n) => ({ n, t: textoPlano(n).replace(/\s+/g, ' ').trim() })).filter((x) => x.t) : []);
  const metadatos: MetadatosIncrustados = { autores: [] };
  const titulo = dc('title')[0]?.t;
  if (titulo) {
    const [t, ...sub] = titulo.split(/\s*:\s+/);
    metadatos.titulo = t as string;
    if (sub.length) metadatos.subtitulo = sub.join(': ');
  }
  // Los «refines» de EPUB 3 dicen el papel (aut, edt, trl…).
  const papeles = new Map<string, string>();
  if (md) for (const m of buscarTodos(md, (n) => n.nombre === 'meta' && n.attrs.property === 'role')) papeles.set((m.attrs.refines ?? '').replace('#', ''), textoPlano(m).trim());
  for (const { n, t } of dc('creator')) {
    const papel = n.attrs['opf:role'] || n.attrs.role || papeles.get(n.attrs.id ?? '') || 'aut';
    const orden = n.attrs['opf:file-as'] ?? n.attrs['file-as'];
    const autor = partirAutores(orden && orden.includes(',') ? orden : t)[0];
    if (!autor) continue;
    if (papel === 'edt') (metadatos.editores ??= []).push(autor);
    else if (papel === 'aut') (metadatos.autores ??= []).push(autor);
  }
  const fecha = dc('date')[0]?.t;
  const anio = fecha ? /\d{4}/.exec(fecha)?.[0] : undefined;
  if (anio) metadatos.anio = Number(anio);
  const idioma = dc('language')[0]?.t;
  if (idioma) metadatos.idioma = idioma;
  const editorial = dc('publisher')[0]?.t;
  if (editorial) metadatos.editorial = editorial;
  const descripcion = dc('description')[0]?.t;
  if (descripcion) metadatos.resumen = descripcion.replace(/<[^>]+>/g, '');
  const ids = dc('identifier').map((x) => x.t);
  if (ids.length) metadatos.identificadores = ids;
  const isbn = ids.map((i) => i.replace(/^urn:isbn:|^isbn:?\s*/i, '').replace(/[-\s]/g, '')).find((i) => /^(97[89])?\d{9}[\dX]$/i.test(i));
  if (isbn) metadatos.isbn = isbn;
  const doi = ids.map((i) => /10\.\d{4,9}\/\S+/.exec(i)?.[0]).find(Boolean);
  if (doi) metadatos.doi = doi;
  metadatos.procedencia = Object.fromEntries(['titulo', 'autores', 'anio', 'idioma', 'editorial', 'isbn'].filter((k) => k in metadatos).map((k) => [k, { fuente: 'epub' as const, confianza: 0.85 }]));
  metadatos.tipoCSL = 'book';

  // --- Manifiesto y lomo ---
  const manifiesto = new Map<string, { href: string; tipo: string; props: string }>();
  for (const it of buscarTodos(opf, (n) => n.nombre === 'item')) manifiesto.set(it.attrs.id ?? '', { href: resolverRuta(rutaOpf, it.attrs.href ?? ''), tipo: it.attrs['media-type'] ?? '', props: it.attrs.properties ?? '' });
  const spine = buscar(opf, (n) => n.nombre === 'spine');
  const lomo = (spine ? spine.hijos.filter((h) => h.nombre === 'itemref') : []).map((r) => manifiesto.get(r.attrs.idref ?? '')).filter((x): x is { href: string; tipo: string; props: string } => Boolean(x) && /html|xml/.test(x!.tipo));

  // --- Índice y lista de páginas ---
  let nav: { toc: EntradaNav[]; paginas: EntradaNav[] } = { toc: [], paginas: [] };
  const itemNav = [...manifiesto.values()].find((m) => /\bnav\b/.test(m.props));
  if (itemNav) nav = leerNavXhtml(analizarHtml(leer(itemNav.href) ?? '', true), itemNav.href);
  const idNcx = spine?.attrs.toc;
  const itemNcx = (idNcx && manifiesto.get(idNcx)) || [...manifiesto.values()].find((m) => m.tipo === 'application/x-dtbncx+xml');
  if (itemNcx && (!nav.toc.length || !nav.paginas.length)) {
    const ncx = leerNcx(analizarHtml(leer(itemNcx.href) ?? '', true), itemNcx.href);
    if (!nav.toc.length) nav.toc = ncx.toc;
    if (!nav.paginas.length) nav.paginas = ncx.paginas;
  }
  // id → etiqueta, por archivo, para los saltos de página sin título.
  const etiquetasPorArchivo = new Map<string, Map<string, string>>();
  for (const p of nav.paginas) {
    const [archivo, id] = p.href.split('#');
    if (!archivo || !id) continue;
    if (!etiquetasPorArchivo.has(archivo)) etiquetasPorArchivo.set(archivo, new Map());
    etiquetasPorArchivo.get(archivo)?.set(id, p.titulo);
  }
  const tituloToc = new Map<string, string>();
  for (const t of nav.toc) { const f = t.href.split('#')[0] ?? ''; if (!tituloToc.has(f)) tituloToc.set(f, t.titulo); }

  // --- Capítulos ---
  const bloques: BloqueTexto[] = [];
  const notas: NotaTexto[] = [];
  const paginasImpresas: ContenidoDocumento['paginasImpresas'] = [];
  const anclas = new Map<string, number>();
  const lomoSalida: NonNullable<ContenidoDocumento['lomo']> = [];
  let impresa: string | null = null;
  for (const cap of lomo) {
    const html = leer(cap.href);
    if (html === null) { avisos.push(`Falta en el ZIP: ${cap.href}`); continue; }
    const arbol = analizarHtml(html);
    const cuerpo = buscar(arbol, (n) => n.nombre === 'body') ?? arbol;
    const desde = bloques.length;
    anclas.set(cap.href, desde);
    const tituloCap = tituloToc.get(cap.href);
    const r = bloquesDeArbol(cuerpo, {
      impresa,
      etiquetasPagina: etiquetasPorArchivo.get(cap.href) ?? new Map(),
      capitulo: cap.href,
      base: desde,
      ruta: [],
    });
    // Si el capítulo no empieza con un título, toma el del índice como ruta.
    if (tituloCap && r.bloques[0]?.tipo !== 'titulo') for (const b of r.bloques) if (!b.ruta.length) b.ruta = [tituloCap];
    for (const [id, i] of r.anclas) anclas.set(`${cap.href}#${id}`, i);
    bloques.push(...r.bloques);
    notas.push(...r.notas.map((n) => ({ ...n, id: n.id })));
    paginasImpresas.push(...r.paginas);
    impresa = r.impresa;
    lomoSalida.push({ href: cap.href, ...(tituloCap ? { titulo: tituloCap } : {}), desde });
  }

  // page-list con anclas que no son pagebreak: se resuelven ahora.
  if (nav.paginas.length && !paginasImpresas.length) {
    for (const p of nav.paginas) {
      const i = anclas.get(p.href) ?? anclas.get(p.href.split('#')[0] ?? '');
      if (i !== undefined && p.titulo) paginasImpresas.push({ etiqueta: p.titulo, bloque: i });
    }
    paginasImpresas.sort((a, b) => a.bloque - b.bloque);
    let k = -1;
    for (let i = 0; i < bloques.length; i++) {
      while (k + 1 < paginasImpresas.length && (paginasImpresas[k + 1] as { bloque: number }).bloque <= i) k++;
      (bloques[i] as BloqueTexto).impresa = k >= 0 ? (paginasImpresas[k] as { etiqueta: string }).etiqueta : null;
    }
  }
  if (!nav.paginas.length && !paginasImpresas.length) avisos.push('El EPUB no trae lista de páginas del libro impreso: se citará por capítulo y párrafo.');

  // Notas: localiza el bloque que las llama.
  const llamadas = new Map<string, number>();
  bloques.forEach((b, i) => b.notas?.forEach((n) => { if (!llamadas.has(n)) llamadas.set(n, i); }));
  for (const n of notas) { const i = llamadas.get(n.id); if (i !== undefined) n.bloque = i; }

  const esquema: EntradaEsquema[] = nav.toc.map((t) => {
    const i = anclas.get(t.href) ?? anclas.get(t.href.split('#')[0] ?? '');
    return { titulo: t.titulo, nivel: t.nivel, fisica: null, ...(i !== undefined ? { bloque: i } : {}), href: t.href };
  });

  return {
    contenido: { clase: 'documento', formato: 'epub', bloques, notas, esquema, paginasImpresas, lomo: lomoSalida },
    metadatos,
    avisos,
  };
}
