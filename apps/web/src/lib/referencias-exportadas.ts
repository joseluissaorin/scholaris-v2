/**
 * Exportaciones de gestores de referencias (BibTeX, BibLaTeX, RIS; Zotero,
 * Mendeley, JabRef…) para llenar una biblioteca: cada entrada da metadatos y,
 * si los tiene, la ruta de sus ficheros adjuntos (la carpeta «files/» o
 * «storage/» que Zotero exporta junto al .bib) o un enlace.
 */
import type { MetadatosDocumento } from '@scholaris/nucleo';

export interface EntradaReferencia {
  clave: string;
  metadatos: Partial<MetadatosDocumento>;
  /** Rutas de los adjuntos tal y como vienen («files/123/Foucault - Vigilar.pdf»). */
  ficheros: string[];
  url?: string;
}

type Autor = { nombre: string; apellidos: string };

function autor(s: string): Autor {
  const t = s.replace(/[{}]/g, '').trim();
  if (t.includes(',')) {
    const [ap, no] = t.split(',', 2);
    return { apellidos: (ap ?? '').trim(), nombre: (no ?? '').trim() };
  }
  const partes = t.split(/\s+/);
  return { apellidos: partes.pop() ?? '', nombre: partes.join(' ') };
}

/** LaTeX mínimo de los .bib: acentos y llaves. */
function delatex(s: string): string {
  const acentos: Record<string, string> = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', c: '̧' };
  return s
    .replace(/\\([`'^"~c])\s*\{?\\?([a-zA-Z])\}?/g, (_, a: string, l: string) => (l + (acentos[a] ?? '')).normalize('NFC'))
    .replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/--/g, '–')
    .replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** Lee un .bib (BibTeX o BibLaTeX). */
export function leerBibtex(texto: string): EntradaReferencia[] {
  const salida: EntradaReferencia[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const tipo = m[1]!.toLowerCase();
    if (tipo === 'comment' || tipo === 'string' || tipo === 'preamble') continue;
    // El cuerpo hasta la llave que cierra la entrada.
    let i = re.lastIndex;
    let prof = 1;
    const ini = i;
    while (i < texto.length && prof > 0) {
      const ch = texto[i]!;
      if (ch === '{') prof++;
      else if (ch === '}') prof--;
      i++;
    }
    const cuerpo = texto.slice(ini, i - 1);
    re.lastIndex = i;
    const campos: Record<string, string> = {};
    let j = 0;
    while (j < cuerpo.length) {
      const mc = /\s*([\w-]+)\s*=\s*/y;
      mc.lastIndex = j;
      const c = mc.exec(cuerpo);
      if (!c) { j++; continue; }
      j = mc.lastIndex;
      let valor = '';
      if (cuerpo[j] === '{') {
        let p = 1; j++;
        const desde = j;
        while (j < cuerpo.length && p > 0) { if (cuerpo[j] === '{') p++; else if (cuerpo[j] === '}') p--; j++; }
        valor = cuerpo.slice(desde, j - 1);
      } else if (cuerpo[j] === '"') {
        const fin = cuerpo.indexOf('"', j + 1);
        valor = cuerpo.slice(j + 1, fin < 0 ? undefined : fin);
        j = fin < 0 ? cuerpo.length : fin + 1;
      } else {
        const fin = cuerpo.indexOf(',', j);
        valor = cuerpo.slice(j, fin < 0 ? undefined : fin).trim();
        j = fin < 0 ? cuerpo.length : fin;
      }
      campos[c[1]!.toLowerCase()] = valor;
    }
    const m2: Partial<MetadatosDocumento> = {};
    if (campos.title) m2.titulo = delatex(campos.title);
    const autores = campos.author ?? campos.editor;
    if (autores) m2.autores = autores.split(/\s+and\s+/i).map((a) => autor(delatex(a))) as MetadatosDocumento['autores'];
    const anio = Number.parseInt((campos.year ?? campos.date ?? '').slice(0, 4), 10);
    if (anio > 0) m2.anio = anio;
    if (campos.doi) (m2 as Record<string, unknown>).doi = campos.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    if (campos.language || campos.langid) m2.idioma = (campos.language ?? campos.langid ?? '').slice(0, 2).toLowerCase();
    // Zotero: file = {Título:files/123/nombre.pdf:application/pdf;…}; JabRef: :ruta:PDF.
    const ficheros = (campos.file ?? '').split(/;(?![^{]*\})/).map((f) => {
      const partes = f.split(':');
      return (partes.length >= 3 ? partes.slice(1, -1).join(':') : partes.length === 2 ? partes[0]! : f).replace(/\\:/g, ':').trim();
    }).filter((f) => /\.\w{2,5}$/.test(f));
    const e: EntradaReferencia = { clave: m[2] ?? '', metadatos: m2, ficheros };
    const url = campos.url ?? (campos.doi ? `https://doi.org/${campos.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : undefined);
    if (url) e.url = url;
    salida.push(e);
  }
  return salida;
}

/** Lee un .ris. */
export function leerRis(texto: string): EntradaReferencia[] {
  const salida: EntradaReferencia[] = [];
  let actual: { campos: Record<string, string[]> } | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  - ?(.*)$/.exec(linea);
    if (!m) continue;
    const [, k, v] = m as unknown as [string, string, string];
    if (k === 'TY') { actual = { campos: {} }; continue; }
    if (!actual) continue;
    if (k === 'ER') {
      const c = actual.campos;
      const md: Partial<MetadatosDocumento> = {};
      const titulo = c.TI?.[0] ?? c.T1?.[0];
      if (titulo) md.titulo = titulo.trim();
      const autores = [...(c.AU ?? []), ...(c.A1 ?? [])];
      if (autores.length) md.autores = autores.map(autor) as MetadatosDocumento['autores'];
      const anio = Number.parseInt((c.PY?.[0] ?? c.Y1?.[0] ?? c.DA?.[0] ?? '').slice(0, 4), 10);
      if (anio > 0) md.anio = anio;
      if (c.DO?.[0]) (md as Record<string, unknown>).doi = c.DO[0];
      if (c.LA?.[0]) md.idioma = c.LA[0].slice(0, 2).toLowerCase();
      const e: EntradaReferencia = { clave: c.ID?.[0] ?? '', metadatos: md, ficheros: [...(c.L1 ?? []), ...(c.L4 ?? [])].map((f) => f.replace(/^file:\/\//, '')) };
      const url = c.UR?.[0] ?? (c.DO?.[0] ? `https://doi.org/${c.DO[0]}` : undefined);
      if (url) e.url = url;
      salida.push(e);
      actual = null;
      continue;
    }
    (actual.campos[k] ??= []).push(v);
  }
  return salida;
}

export function leerReferencias(nombre: string, texto: string): EntradaReferencia[] {
  return /\.ris$/i.test(nombre) ? leerRis(texto) : leerBibtex(texto);
}

/** «files/123/Foucault - Vigilar.pdf» → «foucault - vigilar.pdf» (para emparejar con lo soltado). */
export const nombreBase = (ruta: string) => (ruta.split(/[\\/]/).pop() ?? ruta).normalize('NFC').toLowerCase();
