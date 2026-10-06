/** Formatos de texto sencillos: decodificación, Markdown, TXT, RTF y ODT. */

import { strFromU8, unzipSync } from 'fflate';
import type { BloqueTexto, MetadatosIncrustados, NotaTexto } from '../tipos.js';
import { analizarHtml, bloquesDeArbol, buscar, buscarTodos, textoPlano, type Nodo, type ResultadoBloques } from './html.js';
import { partirAutores } from '../pdf/documento.js';

/** UTF-8 si es válido; si no, UTF-16 por BOM o Windows-1252. */
export function decodificarTexto(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

// ---------------------------------------------------------------------------
// Constructor de bloques compartido (Markdown, TXT, RTF)
// ---------------------------------------------------------------------------

class Montador {
  bloques: BloqueTexto[] = [];
  notas: NotaTexto[] = [];
  private ruta: string[] = [];
  private niveles: number[] = [];
  private parrafo = 0;

  anadir(tipo: BloqueTexto['tipo'], texto: string, nivel?: number) {
    const t = texto.trim();
    if (!t) return;
    if (tipo === 'titulo') {
      const n = nivel ?? 1;
      while (this.niveles.length && (this.niveles[this.niveles.length - 1] as number) >= n) { this.niveles.pop(); this.ruta.pop(); }
      this.niveles.push(n);
      this.ruta.push(t);
      this.parrafo = 0;
    } else this.parrafo++;
    const notas = [...t.matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1] as string);
    this.bloques.push({ tipo, texto: t, ruta: [...this.ruta], parrafo: tipo === 'titulo' ? 0 : this.parrafo, ...(nivel ? { nivel } : {}), ...(notas.length ? { notas } : {}) });
  }

  resultado(): ResultadoBloques {
    return { bloques: this.bloques, notas: this.notas, paginas: [], impresa: null, ruta: this.ruta, anclas: new Map() };
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function bloquesDeMarkdown(md: string): ResultadoBloques & { metadatos: MetadatosIncrustados } {
  const m = new Montador();
  const metadatos: MetadatosIncrustados = {};
  let lineas = md.replace(/\r\n?/g, '\n').split('\n');
  // Front matter YAML.
  if (lineas[0]?.trim() === '---') {
    const fin = lineas.indexOf('---', 1);
    if (fin > 0) {
      for (const l of lineas.slice(1, fin)) {
        const kv = /^(\w+):\s*(.+)$/.exec(l);
        if (!kv) continue;
        const v = (kv[2] as string).replace(/^["']|["']$/g, '');
        if (kv[1] === 'title') metadatos.titulo = v;
        else if (kv[1] === 'author') metadatos.autores = partirAutores(v);
        else if (kv[1] === 'date') { const a = /\d{4}/.exec(v); if (a) metadatos.anio = Number(a[0]); }
        else if (kv[1] === 'lang') metadatos.idioma = v;
      }
      lineas = lineas.slice(fin + 1);
    }
  }
  let i = 0;
  let parrafo: string[] = [];
  const cerrar = () => { if (parrafo.length) m.anadir('parrafo', parrafo.join(' ')); parrafo = []; };
  while (i < lineas.length) {
    const l = lineas[i] as string;
    const sig = lineas[i + 1] ?? '';
    let r: RegExpExecArray | null;
    if (!l.trim()) { cerrar(); i++; continue; }
    if ((r = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { cerrar(); m.anadir('titulo', r[2] as string, (r[1] as string).length); i++; continue; }
    if (parrafo.length === 0 && l.trim() && /^(=+|-+)\s*$/.test(sig) && !/^\s*[-*+]\s/.test(l)) { m.anadir('titulo', l, sig.trim()[0] === '=' ? 1 : 2); i += 2; continue; }
    if ((r = /^(```|~~~)/.exec(l))) {
      cerrar();
      const valla = r[1] as string;
      const cuerpo: string[] = [];
      i++;
      while (i < lineas.length && !(lineas[i] as string).startsWith(valla)) cuerpo.push(lineas[i++] as string);
      i++;
      m.anadir('codigo', '```\n' + cuerpo.join('\n') + '\n```');
      continue;
    }
    if ((r = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(l))) {
      cerrar();
      const texto = [r[2] as string];
      i++;
      while (i < lineas.length && /^\s{2,}\S/.test(lineas[i] as string)) texto.push((lineas[i++] as string).trim());
      m.notas.push({ id: r[1] as string, texto: texto.join(' ') });
      continue;
    }
    if (/^\s*>/.test(l)) {
      cerrar();
      const cuerpo: string[] = [];
      while (i < lineas.length && /^\s*>/.test(lineas[i] as string)) cuerpo.push((lineas[i++] as string).replace(/^\s*>\s?/, ''));
      m.anadir('cita', cuerpo.join(' '));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      cerrar();
      const cuerpo: string[] = [];
      while (i < lineas.length && ((lineas[i] as string).trim() === '' ? /^\s*([-*+]|\d+[.)])\s+/.test(lineas[i + 1] ?? '') : /^\s*([-*+]|\d+[.)])\s+|^\s{2,}\S/.test(lineas[i] as string))) {
        if ((lineas[i] as string).trim()) cuerpo.push(lineas[i] as string);
        i++;
      }
      m.anadir('lista', cuerpo.join('\n'));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(sig)) {
      cerrar();
      const cuerpo: string[] = [];
      while (i < lineas.length && /^\s*\|/.test(lineas[i] as string)) cuerpo.push((lineas[i++] as string).trim());
      m.anadir('tabla', cuerpo.join('\n'));
      continue;
    }
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(l)) { cerrar(); i++; continue; }
    parrafo.push(l.trim());
    i++;
  }
  cerrar();
  if (!metadatos.titulo) {
    const t = m.bloques.find((b) => b.tipo === 'titulo' && b.nivel === 1);
    if (t) metadatos.titulo = t.texto;
  }
  return { ...m.resultado(), metadatos };
}

// ---------------------------------------------------------------------------
// TXT
// ---------------------------------------------------------------------------

export function bloquesDeTxt(txt: string): ResultadoBloques {
  const m = new Montador();
  const t = txt.replace(/\r\n?/g, '\n');
  const conBlancos = /\n\s*\n/.test(t);
  const trozos = conBlancos ? t.split(/\n\s*\n/) : t.split('\n');
  for (const tr of trozos) {
    const limpio = tr.split('\n').map((l) => l.trim()).join(' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2');
    // Línea corta en mayúsculas o «CAPÍTULO X»: título.
    if (limpio.length < 80 && (/^(cap[ií]tulo|chapter|parte|part|libro|book)\b/i.test(limpio) || (/^[^a-zà-ÿ]+$/.test(limpio) && /\p{Lu}{3}/u.test(limpio)))) m.anadir('titulo', limpio, 1);
    else m.anadir('parrafo', limpio);
  }
  return m.resultado();
}

// ---------------------------------------------------------------------------
// RTF
// ---------------------------------------------------------------------------

const DESTINOS_IGNORADOS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable', 'pict', 'object', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'filetbl', 'revtbl', 'pgdsctbl', 'operator', 'nonshppict', 'fldinst', 'bkmkstart', 'bkmkend', 'pnseclvl', 'pntext', 'pntxta', 'pntxtb', 'listtext']);

export function bloquesDeRtf(rtf: string): ResultadoBloques & { metadatos: MetadatosIncrustados } {
  const m = new Montador();
  const metadatos: MetadatosIncrustados = {};
  interface Estado { ignorar: boolean; destino: string; uc: number; nivel: number | null }
  const pila: Estado[] = [];
  let estado: Estado = { ignorar: false, destino: '', uc: 1, nivel: null };
  let parrafo = '';
  let nivelParrafo: number | null = null;
  let nota = '';
  let notas = 0;
  const info: Record<string, string> = {};
  let saltar = 0;
  const salida = (s: string) => {
    if (estado.ignorar) return;
    if (saltar > 0) { saltar -= s.length; return; }
    if (estado.destino === 'footnote') nota += s;
    else if (['title', 'author', 'subject', 'keywords'].includes(estado.destino)) info[estado.destino] = (info[estado.destino] ?? '') + s;
    else parrafo += s;
  };
  const finParrafo = () => {
    if (estado.destino === 'footnote') { nota += '\n'; return; }
    if (nivelParrafo !== null) m.anadir('titulo', parrafo, nivelParrafo + 1);
    else m.anadir('parrafo', parrafo);
    parrafo = '';
  };
  const re = /\\([a-z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|([^\\{}\r\n]+)/gi;
  let r: RegExpExecArray | null;
  let primeroDeGrupo = false;
  const cp1252 = new TextDecoder('windows-1252');
  while ((r = re.exec(rtf))) {
    if (r[5] === '{') { pila.push(estado); estado = { ...estado }; primeroDeGrupo = true; continue; }
    if (r[5] === '}') {
      if (estado.destino === 'footnote' && !(pila[pila.length - 1]?.destino === 'footnote')) {
        notas++;
        const id = `rtf-${notas}`;
        parrafo += `[^${id}]`;
        m.notas.push({ id, texto: nota.trim().replace(/\s+/g, ' ') });
        nota = '';
      }
      estado = pila.pop() ?? estado;
      primeroDeGrupo = false;
      continue;
    }
    if (r[1]) {
      const palabra = r[1];
      const param = r[2] !== undefined ? Number(r[2]) : null;
      if (primeroDeGrupo && (DESTINOS_IGNORADOS.has(palabra))) estado.ignorar = true;
      else if (palabra === 'footnote') estado.destino = 'footnote';
      else if (['title', 'author', 'subject', 'keywords'].includes(palabra)) estado.destino = palabra;
      else if (palabra === 'info') estado.destino = 'info';
      else if (palabra === 'par') finParrafo();
      else if (palabra === 'line') salida('\n');
      else if (palabra === 'pard') nivelParrafo = null;
      else if (palabra === 'outlinelevel' && param !== null) nivelParrafo = param;
      else if (palabra === 'tab') salida(' ');
      else if (palabra === 'emdash') salida('—');
      else if (palabra === 'endash') salida('–');
      else if (palabra === 'lquote') salida('‘');
      else if (palabra === 'rquote') salida('’');
      else if (palabra === 'ldblquote') salida('“');
      else if (palabra === 'rdblquote') salida('”');
      else if (palabra === 'bullet') salida('•');
      else if (palabra === 'uc' && param !== null) estado.uc = param;
      else if (palabra === 'u' && param !== null) { salida(String.fromCharCode(param < 0 ? param + 65536 : param)); saltar = estado.uc; }
      primeroDeGrupo = false;
      continue;
    }
    if (r[3]) {
      if (saltar > 0) { saltar--; continue; }
      salida(cp1252.decode(new Uint8Array([parseInt(r[3], 16)])));
      primeroDeGrupo = false;
      continue;
    }
    if (r[4]) {
      if (r[4] === '*' && primeroDeGrupo) { estado.ignorar = true; continue; }
      if (r[4] === '~') salida(' ');
      else if (r[4] === '-') { /* guion opcional */ } else if (r[4] === '_') salida('‑');
      else if ('\\{}'.includes(r[4])) salida(r[4]);
      else if (r[4] === '\n' || r[4] === '\r') finParrafo();
      primeroDeGrupo = false;
      continue;
    }
    if (r[6]) { salida(r[6]); primeroDeGrupo = false; }
  }
  if (parrafo.trim()) finParrafo();
  if (info.title) metadatos.titulo = info.title.trim();
  if (info.author) metadatos.autores = partirAutores(info.author.trim());
  if (info.keywords) metadatos.palabrasClave = info.keywords.split(/[;,]\s*/).filter(Boolean);
  return { ...m.resultado(), metadatos };
}

// ---------------------------------------------------------------------------
// ODT (OpenDocument): content.xml → árbol HTML equivalente
// ---------------------------------------------------------------------------

function odfAHtml(n: Nodo, notas: Nodo[]): Nodo {
  const nuevo = (nombre: string, hijos: Nodo[], attrs: Record<string, string> = {}): Nodo => ({ nombre, attrs, hijos });
  const hijos = () => n.hijos.map((h) => odfAHtml(h, notas));
  switch (n.nombre) {
    case '#texto': return n;
    case 'h': return nuevo(`h${Math.min(6, Number(n.attrs['text:outline-level'] ?? n.attrs['outline-level'] ?? 1))}`, hijos());
    case 'p': return nuevo('p', hijos());
    case 'list': return nuevo('ul', hijos());
    case 'list-item': return nuevo('li', hijos());
    case 'table': return nuevo('table', hijos());
    case 'table-row': return nuevo('tr', hijos());
    case 'table-cell': return nuevo('td', hijos());
    case 's': return { nombre: '#texto', attrs: {}, hijos: [], texto: ' '.repeat(Number(n.attrs['text:c'] ?? 1)) };
    case 'tab': return { nombre: '#texto', attrs: {}, hijos: [], texto: ' ' };
    case 'line-break': return nuevo('br', []);
    case 'note': {
      const id = n.attrs['text:id'] ?? `odt-${notas.length + 1}`;
      const cuerpo = buscar(n, (x) => x.nombre === 'note-body');
      notas.push(nuevo('aside', cuerpo ? cuerpo.hijos.map((h) => odfAHtml(h, notas)) : [], { 'epub:type': 'footnote', id }));
      return nuevo('sup', [nuevo('a', [{ nombre: '#texto', attrs: {}, hijos: [], texto: id }], { href: `#${id}` })]);
    }
    case 'span': return nuevo('span', hijos());
    case 'a': return nuevo('a', hijos(), { href: n.attrs['xlink:href'] ?? n.attrs.href ?? '' });
    case 'sequence-decls': case 'tracked-changes': case 'soft-page-break': return nuevo('span', []);
    default: return nuevo('div', hijos());
  }
}

export function bloquesDeOdt(bytes: Uint8Array): ResultadoBloques & { metadatos: MetadatosIncrustados } {
  const zip = unzipSync(bytes, { filter: (f) => f.name === 'content.xml' || f.name === 'meta.xml' });
  const contenido = zip['content.xml'];
  if (!contenido) throw new Error('ODT sin content.xml');
  const arbol = analizarHtml(strFromU8(contenido));
  const texto = buscar(arbol, (n) => n.nombre === 'text' && n.padre?.nombre === 'body') ?? arbol;
  const notas: Nodo[] = [];
  const html: Nodo = { nombre: 'div', attrs: {}, hijos: texto.hijos.map((h) => odfAHtml(h, notas)) };
  // Los <p>/<h> dentro de <span> (secciones) se aplanan solos: bloquesDeArbol recorre lo que no reconoce.
  html.hijos.push(...notas);
  const res = bloquesDeArbol(html);
  const metadatos: MetadatosIncrustados = {};
  if (zip['meta.xml']) {
    const meta = analizarHtml(strFromU8(zip['meta.xml']));
    const t = buscar(meta, (n) => n.nombre === 'title');
    const c = buscar(meta, (n) => n.nombre === 'initial-creator') ?? buscar(meta, (n) => n.nombre === 'creator');
    const f = buscar(meta, (n) => n.nombre === 'creation-date');
    if (t) metadatos.titulo = textoPlano(t).trim();
    if (c) metadatos.autores = partirAutores(textoPlano(c).trim());
    if (f) metadatos.creado = textoPlano(f).trim();
  }
  void buscarTodos;
  return { ...res, metadatos };
}
