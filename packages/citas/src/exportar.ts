/** Exportación de referencias: BibTeX (biblatex), RIS, CSL-JSON y bibliografías en cualquier estilo. */
import type { Autor } from '@scholaris/nucleo';
import { aItemCSL, tipoCSLPorDefecto, type DocumentoCitable, type ItemCSL } from './csl/mapeo.js';
import { MotorCitas } from './csl/motor.js';

export type FormatoReferencias = 'bibtex' | 'ris' | 'csl-json';

function ascii(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l');
}

const VACIAS_CLAVE = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'the', 'a', 'an', 'le', 'les', 'il', 'lo', 'de', 'del', 'of', 'der', 'die', 'das']);

/** Claves BibTeX únicas: apellido + año + primera palabra del título («foucault1975vigilar»). */
export function clavesBibtex(documentos: DocumentoCitable[]): Map<string, string> {
  const usadas = new Map<string, number>();
  const salida = new Map<string, string>();
  for (const d of documentos) {
    const m = d.metadatos;
    const autor = ascii(m.autores[0]?.apellidos ?? m.editores?.[0]?.apellidos ?? 'anonimo').toLowerCase().replace(/[^a-z]/g, '') || 'anonimo';
    const palabra = ascii(m.titulo).toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 2 && !VACIAS_CLAVE.has(w)) ?? '';
    const base = `${autor}${m.anioOriginal ?? m.anio ?? ''}${palabra}`;
    const n = usadas.get(base) ?? 0;
    usadas.set(base, n + 1);
    salida.set(d.id, n ? `${base}${String.fromCharCode(97 + n)}` : base);
  }
  return salida;
}

function escaparBib(s: string): string {
  return s.replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
}

function nombresBib(as: Autor[]): string {
  return as.map((a) => (a.nombre ? `${escaparBib(a.apellidos)}, ${escaparBib(a.nombre)}` : `{${escaparBib(a.apellidos)}}`)).join(' and ');
}

const TIPO_BIB: Record<string, string> = {
  book: 'book', 'article-journal': 'article', article: 'article', 'article-magazine': 'article', 'article-newspaper': 'article', chapter: 'incollection',
  'paper-conference': 'inproceedings', thesis: 'thesis', report: 'report', webpage: 'online', 'post-weblog': 'online', interview: 'misc', speech: 'misc',
  motion_picture: 'video', song: 'audio', broadcast: 'audio', dataset: 'dataset', graphic: 'artwork', manuscript: 'unpublished',
};

const IDIOMA_BIB: Record<string, string> = { es: 'spanish', en: 'english', fr: 'french', it: 'italian', la: 'latin', de: 'german', pt: 'portuguese', ca: 'catalan' };

/** BibTeX en sabor biblatex (origdate, langid, @online…), legible también por BibTeX clásico. */
export function aBibtex(documentos: DocumentoCitable[]): string {
  const claves = clavesBibtex(documentos);
  return documentos.map((d) => {
    const m = d.metadatos;
    const tipo = TIPO_BIB[tipoCSLPorDefecto(d.tipo, m)] ?? 'misc';
    const campos: Array<[string, string | undefined]> = [
      ['author', m.autores.length ? nombresBib(m.autores) : undefined],
      ['editor', m.editores?.length ? nombresBib(m.editores) : undefined],
      ['title', `{${escaparBib(m.titulo)}}`],
      ['subtitle', m.subtitulo ? escaparBib(m.subtitulo) : undefined],
      [tipo === 'article' ? 'journaltitle' : tipo === 'incollection' || tipo === 'inproceedings' ? 'booktitle' : 'series', m.revista ? escaparBib(m.revista) : undefined],
      ['year', m.anio !== undefined ? String(m.anio) : m.anioOriginal !== undefined ? String(m.anioOriginal) : undefined],
      ['origdate', m.anioOriginal !== undefined && m.anioOriginal !== m.anio ? String(m.anioOriginal) : undefined],
      ['publisher', m.editorial ? escaparBib(m.editorial) : undefined],
      ['address', m.lugar ? escaparBib(m.lugar) : undefined],
      ['volume', m.volumen],
      ['number', m.numero],
      ['pages', m.paginas?.replace(/\s*[-–—]\s*/, '--')],
      ['doi', m.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')],
      ['isbn', m.isbn],
      ['url', m.url],
      ['langid', m.idioma ? IDIOMA_BIB[m.idioma.slice(0, 2)] ?? m.idioma : undefined],
      ['abstract', m.resumen ? escaparBib(m.resumen) : undefined],
    ];
    const cuerpo = campos.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
    return `@${tipo}{${claves.get(d.id)},\n${cuerpo}\n}`;
  }).join('\n\n') + '\n';
}

const TIPO_RIS: Record<string, string> = {
  book: 'BOOK', 'article-journal': 'JOUR', article: 'JOUR', 'article-magazine': 'MGZN', 'article-newspaper': 'NEWS', chapter: 'CHAP', 'paper-conference': 'CPAPER',
  thesis: 'THES', report: 'RPRT', webpage: 'ELEC', interview: 'SOUND', speech: 'SOUND', song: 'SOUND', broadcast: 'SOUND', motion_picture: 'VIDEO',
  dataset: 'DATA', graphic: 'ART', manuscript: 'MANSCPT',
};

/** RIS (Zotero, EndNote, Mendeley). */
export function aRIS(documentos: DocumentoCitable[]): string {
  return documentos.map((d) => {
    const m = d.metadatos;
    const l: string[] = [`TY  - ${TIPO_RIS[tipoCSLPorDefecto(d.tipo, m)] ?? 'GEN'}`];
    for (const a of m.autores) l.push(`AU  - ${a.apellidos}${a.nombre ? `, ${a.nombre}` : ''}`);
    for (const a of m.editores ?? []) l.push(`A2  - ${a.apellidos}${a.nombre ? `, ${a.nombre}` : ''}`);
    l.push(`TI  - ${m.subtitulo ? `${m.titulo}: ${m.subtitulo}` : m.titulo}`);
    if (m.revista) l.push(`T2  - ${m.revista}`);
    if (m.anio !== undefined) l.push(`PY  - ${m.anio}`);
    if (m.anioOriginal !== undefined && m.anioOriginal !== m.anio) l.push(`Y2  - ${m.anioOriginal}`);
    if (m.editorial) l.push(`PB  - ${m.editorial}`);
    if (m.lugar) l.push(`CY  - ${m.lugar}`);
    if (m.volumen) l.push(`VL  - ${m.volumen}`);
    if (m.numero) l.push(`IS  - ${m.numero}`);
    if (m.paginas) { const [sp, ep] = m.paginas.split(/\s*[-–—]+\s*/); if (sp) l.push(`SP  - ${sp}`); if (ep) l.push(`EP  - ${ep}`); }
    if (m.doi) l.push(`DO  - ${m.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`);
    if (m.isbn) l.push(`SN  - ${m.isbn}`);
    if (m.url) l.push(`UR  - ${m.url}`);
    if (m.idioma) l.push(`LA  - ${m.idioma}`);
    if (m.resumen) l.push(`AB  - ${m.resumen.replace(/\s+/g, ' ')}`);
    l.push(`ID  - ${d.id}`, 'ER  - ');
    return l.join('\r\n');
  }).join('\r\n\r\n') + '\r\n';
}

export function aCSLJSON(documentos: DocumentoCitable[]): ItemCSL[] {
  return documentos.map((d) => aItemCSL(d));
}

export function exportarReferencias(documentos: DocumentoCitable[], formato: FormatoReferencias): string {
  switch (formato) {
    case 'bibtex': return aBibtex(documentos);
    case 'ris': return aRIS(documentos);
    case 'csl-json': return JSON.stringify(aCSLJSON(documentos), null, 2);
  }
}

/** Bibliografía de unos documentos en cualquier estilo. */
export async function bibliografia(documentos: DocumentoCitable[], opciones: { estilo?: string; idioma?: string; formato?: 'texto' | 'html' | 'markdown' } = {}): Promise<{ estilo: string; entradas: string[]; html: string }> {
  const motor = await MotorCitas.crear({ estilo: opciones.estilo ?? 'apa', idioma: opciones.idioma ?? 'es-ES', documentos });
  const ids = documentos.map((d) => d.id);
  const html = motor.bibliografia(ids, 'html');
  const entradas = opciones.formato === 'html' ? html : motor.bibliografia(ids, opciones.formato ?? 'texto');
  return { estilo: motor.estilo, entradas, html: `<div class="csl-bib-body">\n${html.join('\n')}\n</div>` };
}

/** Referencia completa de un documento (la entrada de bibliografía). */
export async function citaDocumento(doc: DocumentoCitable, opciones: { estilo?: string; idioma?: string } = {}): Promise<{ texto: string; html: string }> {
  const motor = await MotorCitas.crear({ estilo: opciones.estilo ?? 'apa', idioma: opciones.idioma ?? 'es-ES', documentos: [doc] });
  return { texto: motor.bibliografia([doc.id], 'texto')[0] ?? '', html: motor.bibliografia([doc.id], 'html')[0] ?? '' };
}
