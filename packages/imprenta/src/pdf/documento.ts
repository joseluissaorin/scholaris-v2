/**
 * Lo que el PDF dice de sí mismo: ficha Info, XMP, marcadores (/Outlines),
 * etiquetas de página (/PageLabels) y el DOI que aparezca en el texto.
 */

import type { Autor } from '@scholaris/nucleo';
import type { EntradaEsquema, MetadatosIncrustados } from '../tipos.js';

/** «D:20240410211143Z» o «D:20100715143156+02'00'» → ISO. */
export function fechaPdf(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s.trim());
  if (!m) return undefined;
  const [, a, mes = '01', d = '01', h = '00', mi = '00', se = '00', z, zh, zm] = m;
  let zona = 'Z';
  if (z === '+' || z === '-') zona = `${z}${zh ?? '00'}:${zm ?? '00'}`;
  const iso = `${a}-${mes}-${d}T${h}:${mi}:${se}${zona}`;
  return Number.isNaN(Date.parse(iso)) ? `${a}-${mes}-${d}` : iso;
}

/** Títulos que no son títulos: nombres de archivo, plantillas, rellenos. */
export function tituloBasura(t: string): boolean {
  const s = t.trim();
  if (s.length < 2) return true;
  if (/_{3,}|^untitled|^sin t[ií]tulo|^microsoft (word|powerpoint)|^document\d*$|^doc\d+|\.(docx?|pdf|tex|dvi|indd|qxd|rtf|odt)$/i.test(s)) return true;
  if (/^[\w-]+\.\w{2,4}$/.test(s)) return true;
  return false;
}

/** «C. S. Lewis», «Lewis, C. S.», «A; B», «A and B», «A & B» → autores. */
export function partirAutores(s: string): Autor[] {
  const limpio = s.replace(/\s+/g, ' ').trim();
  if (!limpio) return [];
  let partes = limpio.split(/\s*;\s*|\s+(?:and|y|&|et|und)\s+/i);
  if (partes.length === 1 && (limpio.match(/,/g)?.length ?? 0) >= 2) partes = limpio.split(/\s*,\s*/);
  return partes.filter(Boolean).map((p) => {
    if (p.includes(',')) {
      const [ap, ...resto] = p.split(',');
      return { nombre: resto.join(',').trim(), apellidos: (ap ?? '').trim() };
    }
    const trozos = p.trim().split(' ');
    if (trozos.length === 1) return { nombre: '', apellidos: trozos[0] as string };
    return { nombre: trozos.slice(0, -1).join(' '), apellidos: trozos[trozos.length - 1] as string };
  });
}

const RE_DOI = /\b(10\.\d{4,9}\/[^\s"<>()[\]{}]+)/i;

export function buscarDoi(texto: string): string | undefined {
  const m = RE_DOI.exec(texto);
  if (!m) return undefined;
  return (m[1] as string).replace(/[.,;:]+$/, '');
}

export interface FichaPdf {
  metadatos: MetadatosIncrustados;
  info: Record<string, string>;
  xmp: Record<string, string> | null;
  version?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function leerFicha(doc: any): Promise<FichaPdf> {
  const md = await doc.getMetadata().catch(() => null);
  const info: Record<string, string> = {};
  for (const [k, v] of Object.entries((md?.info ?? {}) as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') info[k] = String(v);
    else if (v instanceof Map) for (const [k2, v2] of v) info[`${k}.${k2}`] = String(v2);
    else if (typeof v === 'object' && 'name' in (v as object)) info[k] = String((v as { name: unknown }).name);
  }
  let xmp: Record<string, string> | null = null;
  if (md?.metadata) {
    xmp = {};
    try {
      for (const [k, v] of md.metadata as Iterable<[string, unknown]>) xmp[k] = Array.isArray(v) ? v.join('; ') : String(v);
    } catch {
      /* XMP ilegible */
    }
  }
  const m: MetadatosIncrustados = { autores: [] };
  const titulo = (xmp?.['dc:title'] ?? info.Title ?? '').replace(/\s*\$[a-z]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (titulo && !tituloBasura(titulo)) {
    const [t, ...sub] = titulo.split(/\s+:\s+/);
    m.titulo = (t as string).trim();
    if (sub.length) m.subtitulo = sub.join(': ').trim();
    m.procedencia = { titulo: { fuente: 'pdf', confianza: 0.6 } };
  }
  const autor = xmp?.['dc:creator'] ?? info.Author;
  if (autor && !tituloBasura(autor)) {
    m.autores = partirAutores(autor);
    m.procedencia = { ...m.procedencia, autores: { fuente: 'pdf', confianza: 0.5 } };
  }
  const creado = fechaPdf(info.CreationDate) ?? xmp?.['xmp:createdate'] ?? xmp?.['xap:createdate'];
  const modificado = fechaPdf(info.ModDate) ?? xmp?.['xmp:modifydate'] ?? xmp?.['xap:modifydate'];
  if (creado) m.creado = creado;
  if (modificado) m.modificado = modificado;
  if (info.Producer) m.productor = info.Producer;
  if (info.Creator) m.creador = info.Creator;
  if (info.Subject && !tituloBasura(info.Subject)) m.resumen = info.Subject;
  if (info.Keywords) m.palabrasClave = info.Keywords.split(/[;,]\s*/).map((s) => s.trim()).filter(Boolean);
  const doi = xmp?.['prism:doi'] ?? xmp?.['pdfx:doi'] ?? buscarDoi(`${xmp?.['dc:identifier'] ?? ''} ${info.Subject ?? ''}`);
  if (doi) {
    m.doi = doi.replace(/^doi:\s*/i, '');
    m.procedencia = { ...m.procedencia, doi: { fuente: 'pdf', confianza: 0.9 } };
  }
  if (info.Language) m.idioma = info.Language;
  const version = info.PDFFormatVersion;
  return { metadatos: m, info, xmp, ...(version ? { version } : {}) };
}

interface NodoOutline { title: string; dest: unknown; items?: NodoOutline[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function leerEsquema(doc: any): Promise<EntradaEsquema[]> {
  const raiz: NodoOutline[] | null = await doc.getOutline().catch(() => null);
  if (!raiz) return [];
  const salida: EntradaEsquema[] = [];
  const resolver = async (dest: unknown): Promise<number | null> => {
    try {
      let d = dest;
      if (typeof d === 'string') d = await doc.getDestination(d);
      if (!Array.isArray(d) || !d.length) return null;
      const ref = d[0];
      if (typeof ref === 'number') return ref + 1;
      return (await doc.getPageIndex(ref)) + 1;
    } catch {
      return null;
    }
  };
  const recorrer = async (nodos: NodoOutline[], nivel: number) => {
    for (const n of nodos) {
      const titulo = (n.title ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      // Acciones de visor («Print», «Exit») sin destino: no son secciones.
      const fisica = n.dest ? await resolver(n.dest) : null;
      if (titulo && (fisica !== null || n.items?.length)) salida.push({ titulo, nivel, fisica });
      if (n.items?.length) await recorrer(n.items, nivel + 1);
    }
  };
  await recorrer(raiz, 1);
  return salida;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function leerEtiquetas(doc: any): Promise<Array<string | null> | null> {
  const e: Array<string | null> | null = await doc.getPageLabels().catch(() => null);
  if (!e || !e.length) return null;
  return e.map((s) => (s === '' ? null : s));
}
