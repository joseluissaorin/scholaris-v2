/**
 * Importación de BibTeX / biblatex para el endpoint de importación.
 *
 * Más completo que el analizador de la versión anterior (import_bibtex.py):
 * llaves anidadas, comillas con llaves dentro, concatenación con #, macros
 * @string y meses predefinidos, @comment/@preamble ignorados, acentos LaTeX a
 * Unicode y nombres «Apellido, Nombre» / «Nombre von Apellido» / {Entidades}.
 */
import type { Autor, MetadatosDocumento } from '@scholaris/nucleo';

export interface EntradaBibtex {
  clave: string;
  /** Tipo de entrada en minúsculas: article, book, incollection… */
  tipo: string;
  metadatos: MetadatosDocumento;
  /** Todos los campos, ya decodificados. */
  campos: Record<string, string>;
}

export interface ImportacionBibtex {
  entradas: EntradaBibtex[];
  errores: Array<{ clave?: string; mensaje: string }>;
}

const MESES: Record<string, string> = { jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6', jul: '7', aug: '8', sep: '9', oct: '10', nov: '11', dec: '12' };

const ACENTOS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
};
const ESPECIALES: Record<string, string> = {
  ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', aa: 'å', AA: 'Å', i: 'ı', j: 'ȷ',
  textendash: '–', textemdash: '—', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“', textquotedblright: '”',
  guillemotleft: '«', guillemotright: '»', S: '§', P: '¶', dag: '†', ddag: '‡', copyright: '©', textregistered: '®', ldots: '…', dots: '…', textellipsis: '…',
  textsection: '§', textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textunderscore: '_', textbar: '|',
};

/** LaTeX → Unicode (lo habitual en ficheros .bib). */
export function latexAUnicode(s: string): string {
  let t = s;
  // \'{e}, {\'e}, \'e, \'{\i}
  t = t.replace(/\\([`'^"~=.uvHckrdb])\s*\{\s*\\?([A-Za-z])\s*\}|\\([`'^"~=.])\s*\\?([A-Za-z])|\\([uvHckrdb])\s+\\?([A-Za-z])/g, (_m, a1, l1, a2, l2, a3, l3) => {
    const acento = (a1 ?? a2 ?? a3) as string, letra = (l1 ?? l2 ?? l3) as string;
    const base = letra === 'i' && /^[`'^"~=]$/.test(acento) ? 'i' : letra;
    return (base + (ACENTOS[acento] ?? '')).normalize('NFC');
  });
  t = t.replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j|textendash|textemdash|textquoteleft|textquoteright|textquotedblleft|textquotedblright|guillemotleft|guillemotright|S|P|dag|ddag|copyright|textregistered|ldots|dots|textellipsis|textsection|textbackslash|textasciitilde|textasciicircum|textunderscore|textbar)\b(?:\{\})?\s?/g, (_m, c: string) => ESPECIALES[c] ?? '');
  // Formato: \emph{x}, \textit{x}… → x
  for (let i = 0; i < 3; i++) t = t.replace(/\\(?:emph|textit|textbf|textsc|textrm|textsf|texttt|mkbibquote|enquote|url|mbox|textup|textnormal)\s*\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\([&%$#_{}])/g, '$1')
    .replace(/---/g, '—').replace(/--/g, '–')
    .replace(/``/g, '“').replace(/''/g, '”')
    .replace(/(?<!\\)~/g, ' ')
    .replace(/\\,|\\ /g, ' ')
    .replace(/\\[a-zA-Z]+\s*/g, '') // órdenes desconocidas
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.normalize('NFC');
}

/** Parte por « and » en el nivel superior de llaves. */
function partirNombres(s: string): string[] {
  const salida: string[] = [];
  let prof = 0, actual = '';
  const palabras = s.split(/(\s+)/);
  for (const w of palabras) {
    for (const c of w) { if (c === '{') prof++; else if (c === '}') prof--; }
    if (prof === 0 && /^and$/i.test(w) && w === w.toLowerCase()) { salida.push(actual.trim()); actual = ''; continue; }
    actual += w;
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida.filter((x) => x && x.toLowerCase() !== 'others');
}

/** Un nombre BibTeX → Autor. Admite «Apellido, Nombre», «Apellido, Jr., Nombre», «Nombre von Apellido» y {Entidad}. */
export function nombreBibtex(crudo: string): Autor {
  const r = crudo.trim();
  if (/^\{.*\}$/.test(r) && !/^\{[^{}]*\}\s+\S/.test(r)) return { nombre: '', apellidos: latexAUnicode(r) };
  // Comas en el nivel superior.
  const partes: string[] = [];
  let prof = 0, actual = '';
  for (const c of r) {
    if (c === '{') prof++; else if (c === '}') prof--;
    if (c === ',' && prof === 0) { partes.push(actual); actual = ''; } else actual += c;
  }
  partes.push(actual);
  const p = partes.map((x) => latexAUnicode(x));
  if (p.length >= 3) return { nombre: p[2]!, apellidos: `${p[0]}, ${p[1]}`.replace(/,\s*$/, '') };
  if (p.length === 2) return { nombre: p[1]!, apellidos: p[0]! };
  // «Nombre von Apellido»: la partícula en minúscula abre el apellido.
  const tokens: string[] = [];
  prof = 0; actual = '';
  for (const c of r) {
    if (c === '{') prof++; else if (c === '}') prof--;
    if (/\s/.test(c) && prof === 0) { if (actual) tokens.push(actual); actual = ''; } else actual += c;
  }
  if (actual) tokens.push(actual);
  if (tokens.length === 1) return { nombre: '', apellidos: latexAUnicode(tokens[0]!) };
  let corte = tokens.findIndex((tk, i) => i > 0 && i < tokens.length - 1 && /^[a-z]/.test(tk));
  if (corte === -1) corte = tokens.length - 1;
  return { nombre: latexAUnicode(tokens.slice(0, corte).join(' ')), apellidos: latexAUnicode(tokens.slice(corte).join(' ')) };
}

const IDIOMAS: Record<string, string> = {
  spanish: 'es', castilian: 'es', english: 'en', american: 'en', british: 'en', french: 'fr', italian: 'it', latin: 'la', german: 'de', ngerman: 'de',
  portuguese: 'pt', catalan: 'ca', galician: 'gl', basque: 'eu', greek: 'el', russian: 'ru',
};

const TIPO_CSL: Record<string, string> = {
  article: 'article-journal', book: 'book', mvbook: 'book', inbook: 'chapter', incollection: 'chapter', inproceedings: 'paper-conference', conference: 'paper-conference',
  proceedings: 'book', collection: 'book', phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', techreport: 'report', report: 'report',
  online: 'webpage', www: 'webpage', misc: 'document', unpublished: 'manuscript', manual: 'book', booklet: 'book', video: 'motion_picture', audio: 'song',
  movie: 'motion_picture', music: 'song', dataset: 'dataset', artwork: 'graphic', periodical: 'periodical', patent: 'patent', software: 'software',
};

/** Lector con posición: valores de campo con llaves, comillas, números, macros y #. */
class Lector {
  i = 0;
  constructor(readonly s: string) {}
  espacios(): void { while (this.i < this.s.length && /\s/.test(this.s[this.i] as string)) this.i++; }
  llaves(): string {
    // Asume s[i] === '{'; devuelve el contenido sin las llaves exteriores.
    let prof = 0;
    const ini = this.i + 1;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') { this.i++; continue; }
      if (c === '{') prof++;
      else if (c === '}') { prof--; if (prof === 0) { this.i++; return this.s.slice(ini, this.i - 1); } }
    }
    throw new Error('llave sin cerrar');
  }
  comillas(): string {
    let prof = 0;
    const ini = ++this.i;
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') { this.i++; continue; }
      if (c === '{') prof++;
      else if (c === '}') prof--;
      else if (c === '"' && prof === 0) { this.i++; return this.s.slice(ini, this.i - 1); }
    }
    throw new Error('comillas sin cerrar');
  }
  identificador(): string {
    const m = this.s.slice(this.i).match(/^[^\s"#%'(),={}]+/);
    if (!m) return '';
    this.i += m[0].length;
    return m[0];
  }
  valor(macros: Map<string, string>): string {
    let salida = '';
    for (;;) {
      this.espacios();
      const c = this.s[this.i];
      if (c === '{') salida += this.llaves();
      else if (c === '"') salida += this.comillas();
      else {
        const id = this.identificador();
        if (!id) throw new Error(`valor inesperado cerca de «${this.s.slice(this.i, this.i + 20)}»`);
        salida += /^\d+$/.test(id) ? id : macros.get(id.toLowerCase()) ?? MESES[id.toLowerCase()] ?? id;
      }
      this.espacios();
      if (this.s[this.i] === '#') { this.i++; continue; }
      return salida;
    }
  }
}

function aMetadatos(tipo: string, c: Record<string, string>): MetadatosDocumento {
  const crudos = c as Record<string, string | undefined>;
  const dec = (k: string) => (crudos[k] !== undefined ? latexAUnicode(crudos[k]!) : undefined);
  const anioDe = (s?: string) => { const m = s?.match(/-?\d{3,4}/); return m ? Number(m[0]) : undefined; };
  const autores = crudos.author ? partirNombres(crudos.author).map(nombreBibtex) : [];
  const editores = crudos.editor ? partirNombres(crudos.editor).map(nombreBibtex) : [];
  const anio = anioDe(crudos.year) ?? anioDe(crudos.date);
  const anioOriginal = anioDe(crudos.origdate) ?? anioDe(crudos.origyear);
  let titulo = dec('title') ?? dec('booktitle') ?? '(sin título)';
  let subtitulo = dec('subtitle');
  if (!subtitulo && /^[^:]{3,}:\s+\S/.test(titulo) && !/^https?:/.test(titulo)) {
    const i = titulo.indexOf(':');
    subtitulo = titulo.slice(i + 1).trim();
    titulo = titulo.slice(0, i).trim();
  }
  const contenedor = tipo === 'article' ? dec('journaltitle') ?? dec('journal') : tipo === 'incollection' || tipo === 'inproceedings' || tipo === 'inbook' ? dec('booktitle') : dec('journal');
  const idioma = (dec('langid') ?? dec('language'))?.toLowerCase();
  const m: MetadatosDocumento = { titulo, autores };
  if (subtitulo) m.subtitulo = subtitulo;
  if (editores.length) m.editores = editores;
  if (anio !== undefined) m.anio = anio;
  if (anioOriginal !== undefined && anioOriginal !== anio) m.anioOriginal = anioOriginal;
  const editorial = dec('publisher') ?? dec('school') ?? dec('institution') ?? dec('organization');
  if (editorial) m.editorial = editorial;
  const lugar = dec('address') ?? dec('location');
  if (lugar) m.lugar = lugar;
  if (contenedor) m.revista = contenedor;
  if (crudos.volume) m.volumen = dec('volume')!;
  const numero = dec('number') ?? dec('issue');
  if (numero) m.numero = numero;
  if (crudos.pages) m.paginas = dec('pages')!.replace(/\s*[–—-]+\s*/, '-');
  if (crudos.doi) m.doi = dec('doi')!.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (crudos.isbn) m.isbn = dec('isbn')!;
  if (crudos.url) m.url = crudos.url.trim();
  if (idioma) m.idioma = IDIOMAS[idioma] ?? (idioma.length <= 3 ? idioma : idioma.slice(0, 2));
  m.tipoCSL = TIPO_CSL[tipo] ?? 'document';
  if (crudos.abstract) m.resumen = dec('abstract')!;
  m.procedencia = Object.fromEntries(Object.keys(m).filter((k) => k !== 'procedencia').map((k) => [k, { fuente: 'usuario' as const, confianza: 0.9 }]));
  return m;
}

/** Analiza un fichero .bib. Nunca lanza: los errores van en `errores`. */
export function importarBibtex(texto: string): ImportacionBibtex {
  const entradas: EntradaBibtex[] = [];
  const errores: ImportacionBibtex['errores'] = [];
  const macros = new Map<string, string>();
  const l = new Lector(texto.replace(/^﻿/, ''));
  while (l.i < l.s.length) {
    const arroba = l.s.indexOf('@', l.i);
    if (arroba === -1) break;
    l.i = arroba + 1;
    const tipo = l.identificador().toLowerCase();
    l.espacios();
    const abre = l.s[l.i];
    if (abre !== '{' && abre !== '(') continue; // una @ suelta (p. ej. un correo en un comentario)
    const cierra = abre === '{' ? '}' : ')';
    if (tipo === 'comment' || tipo === 'preamble') {
      try { if (abre === '{') l.llaves(); else l.i = l.s.indexOf(')', l.i) + 1; } catch { break; }
      continue;
    }
    l.i++;
    let clave: string | undefined;
    try {
      if (tipo === 'string') {
        l.espacios();
        const nombre = l.identificador().toLowerCase();
        l.espacios();
        if (l.s[l.i] !== '=') throw new Error('falta «=» en @string');
        l.i++;
        macros.set(nombre, l.valor(macros));
        l.espacios();
        if (l.s[l.i] === cierra) l.i++;
        continue;
      }
      l.espacios();
      const mClave = l.s.slice(l.i).match(/^([^,\s]*)\s*,/);
      if (!mClave) throw new Error('entrada sin clave');
      clave = mClave[1] as string;
      l.i += mClave[0].length;
      const campos: Record<string, string> = {};
      for (;;) {
        l.espacios();
        if (l.s[l.i] === cierra) { l.i++; break; }
        if (l.s[l.i] === ',') { l.i++; continue; }
        if (l.i >= l.s.length) throw new Error('fin de fichero dentro de la entrada');
        const nombre = l.identificador().toLowerCase();
        if (!nombre) throw new Error(`carácter inesperado «${l.s[l.i]}»`);
        l.espacios();
        if (l.s[l.i] !== '=') throw new Error(`falta «=» tras «${nombre}»`);
        l.i++;
        campos[nombre] = l.valor(macros).replace(/\s+/g, ' ').trim();
      }
      const decodificados = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, k === 'url' || k === 'doi' || k === 'file' ? v : latexAUnicode(v)]));
      entradas.push({ clave, tipo, metadatos: aMetadatos(tipo, campos), campos: decodificados });
    } catch (e) {
      errores.push({ ...(clave ? { clave } : {}), mensaje: `@${tipo}: ${(e as Error).message}` });
      // Salta a la siguiente entrada.
      const sig = l.s.indexOf('\n@', l.i);
      l.i = sig === -1 ? l.s.length : sig + 1;
    }
  }
  return { entradas, errores };
}
