/**
 * HTML/XHTML → bloques. Sin DOMParser (no existe en los Web Workers): un
 * analizador tolerante propio, suficiente para la salida de mammoth, los
 * capítulos de un EPUB y el HTML corriente.
 */

import type { BloqueTexto, NotaTexto, TipoBloque } from '../tipos.js';

export interface Nodo {
  nombre: string; // '#texto' para texto
  attrs: Record<string, string>;
  hijos: Nodo[];
  texto?: string;
  padre?: Nodo;
}

const VACIOS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source', 'embed', 'param', 'track']);
const SE_CIERRAN_SOLOS: Record<string, string[]> = {
  p: ['p'],
  li: ['li'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  option: ['option'],
};
const CONTENEDORES = new Set(['ul', 'ol', 'table', 'tbody', 'thead', 'body', 'div', 'section', 'blockquote', 'dl', 'article', 'aside', '#raiz']);
const ABREN_BLOQUE = new Set(['div', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'aside', 'figure', 'dl']);

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', deg: '°', middot: '·',
  iexcl: '¡', iquest: '¿', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü', ccedil: 'ç', Ccedil: 'Ç',
  agrave: 'à', egrave: 'è', ograve: 'ò', acirc: 'â', ecirc: 'ê', ocirc: 'ô', szlig: 'ß', ouml: 'ö', auml: 'ä', euro: '€', sect: '§', para: '¶', times: '×',
};

export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

function leerAtributos(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) attrs[(m[1] as string).toLowerCase()] = decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/**
 * Analiza HTML o XML en un árbol tolerante. Nombres en minúsculas y sin prefijo
 * de espacio de nombres. Con `xml`, sin reglas de HTML (elementos vacíos,
 * cierres implícitos): para OPF, NCX, ODF y OOXML.
 */
export function analizarHtml(html: string, xml = false): Nodo {
  const raiz: Nodo = { nombre: '#raiz', attrs: {}, hijos: [] };
  let actual = raiz;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  const nombreDe = (n: string) => { const l = n.toLowerCase(); const i = l.indexOf(':'); return i >= 0 ? l.slice(i + 1) : l; };
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      actual.hijos.push({ nombre: '#texto', attrs: {}, hijos: [], texto: m[1], padre: actual });
    } else if (m[2]) {
      const n = nombreDe(m[2]);
      let p: Nodo | undefined = actual;
      while (p && p.nombre !== n) p = p.padre;
      if (p?.padre) actual = p.padre;
    } else if (m[3]) {
      const n = nombreDe(m[3]);
      const resto = m[4] ?? '';
      const autocierre = /\/\s*$/.test(resto);
      const cierra = xml ? undefined : SE_CIERRAN_SOLOS[n];
      if (cierra) {
        // Un <p>, <li> o <td> abierto se cierra al abrir otro igual.
        let p: Nodo | undefined = actual;
        while (p && !CONTENEDORES.has(p.nombre)) {
          if (cierra.includes(p.nombre)) { actual = p.padre ?? raiz; break; }
          p = p.padre;
        }
      }
      if (!xml && ABREN_BLOQUE.has(n)) {
        // Un bloque dentro de un <p> abierto lo cierra (HTML corriente).
        let p: Nodo | undefined = actual;
        while (p && !CONTENEDORES.has(p.nombre)) {
          if (p.nombre === 'p') { actual = p.padre ?? raiz; break; }
          p = p.padre;
        }
      }
      const nodo: Nodo = { nombre: n, attrs: leerAtributos(resto.replace(/\/\s*$/, '')), hijos: [], padre: actual };
      actual.hijos.push(nodo);
      if (!xml && (n === 'script' || n === 'style')) {
        const fin = html.toLowerCase().indexOf(`</${m[3].toLowerCase()}`, re.lastIndex);
        re.lastIndex = fin < 0 ? html.length : fin;
        continue;
      }
      if (!autocierre && (xml || !VACIOS.has(n))) actual = nodo;
    } else if (m[5] !== undefined) {
      actual.hijos.push({ nombre: '#texto', attrs: {}, hijos: [], texto: decodificarEntidades(m[5]), padre: actual });
    } else {
      actual.hijos.push({ nombre: '#texto', attrs: {}, hijos: [], texto: '<', padre: actual });
    }
  }
  return raiz;
}

export function buscar(n: Nodo, pred: (n: Nodo) => boolean): Nodo | null {
  if (pred(n)) return n;
  for (const h of n.hijos) {
    const r = buscar(h, pred);
    if (r) return r;
  }
  return null;
}

export function buscarTodos(n: Nodo, pred: (n: Nodo) => boolean, salida: Nodo[] = []): Nodo[] {
  if (pred(n)) salida.push(n);
  for (const h of n.hijos) buscarTodos(h, pred, salida);
  return salida;
}

export function textoPlano(n: Nodo): string {
  if (n.nombre === '#texto') return n.texto ?? '';
  if (n.nombre === 'br') return '\n';
  return n.hijos.map(textoPlano).join('');
}

// ---------------------------------------------------------------------------
// Árbol → bloques
// ---------------------------------------------------------------------------

const BLOQUES = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'table', 'blockquote', 'pre', 'section', 'article', 'aside', 'figure', 'header', 'footer', 'main', 'nav', 'body', 'html', 'li', 'hr', 'figcaption', 'dt', 'dd', 'address', 'center', 'tbody', 'thead']);

/** epub:type (sin prefijo tras el análisis: queda como atributo «epub:type») y role. */
const tipoEpub = (n: Nodo) => `${n.attrs['epub:type'] ?? n.attrs.type ?? ''} ${n.attrs.role ?? ''}`.toLowerCase();

function esSaltoPagina(n: Nodo): boolean {
  return /pagebreak/.test(tipoEpub(n));
}

function esNota(n: Nodo): boolean {
  const t = tipoEpub(n);
  if (/\b(footnote|endnote|rearnote|doc-footnote|doc-endnote)\b/.test(t)) return true;
  if (n.nombre === 'aside' && /\bnote\b/.test(t)) return true;
  const id = n.attrs.id ?? '';
  return n.nombre === 'li' && /^(footnote|endnote)-\d+$/.test(id);
}

function esLlamadaNota(n: Nodo): string | null {
  if (n.nombre !== 'a') return null;
  const href = n.attrs.href ?? '';
  if (!href.includes('#')) return null;
  const destino = href.replace(/^.*#/, '');
  if (/noteref/.test(tipoEpub(n)) || /^(footnote|endnote)-\d+$/.test(destino) || n.padre?.nombre === 'sup') return destino;
  return null;
}

export interface OpcionesBloques {
  /** Etiqueta de página inicial (EPUB: arrastra la del capítulo anterior). */
  impresa?: string | null;
  /** Mapa id → etiqueta (page-list del nav) para saltos sin título. */
  etiquetasPagina?: Map<string, string>;
  capitulo?: string;
  /** Ruta de títulos vigente al empezar (EPUB). */
  ruta?: string[];
  /** Desplazamiento del índice de bloque (EPUB: bloques de capítulos anteriores). */
  base?: number;
}

export interface ResultadoBloques {
  bloques: BloqueTexto[];
  notas: NotaTexto[];
  /** Saltos de página encontrados: etiqueta → índice (global) del bloque siguiente. */
  paginas: Array<{ etiqueta: string; bloque: number }>;
  impresa: string | null;
  ruta: string[];
  /** id de elemento → índice (global) de bloque, para resolver el nav del EPUB. */
  anclas: Map<string, number>;
}

/** Recorre el árbol y saca bloques con su ruta de títulos, notas y folios. */
export function bloquesDeArbol(raiz: Nodo, o: OpcionesBloques = {}): ResultadoBloques {
  const bloques: BloqueTexto[] = [];
  const notas: NotaTexto[] = [];
  const paginas: ResultadoBloques['paginas'] = [];
  const anclas = new Map<string, number>();
  const base = o.base ?? 0;
  let impresa: string | null = o.impresa ?? null;
  let ruta: string[] = [...(o.ruta ?? [])];
  const nivelesRuta: number[] = ruta.map((_, i) => i + 1);
  let parrafo = 0;
  let anclasPendientes: string[] = [];

  const saltoPagina = (n: Nodo) => {
    const id = n.attrs.id ?? '';
    const etiqueta = n.attrs.title || n.attrs['aria-label'] || textoPlano(n).trim() || o.etiquetasPagina?.get(id) || (/(\d+|[ivxlcdm]+)$/i.exec(id)?.[1] ?? '');
    if (etiqueta) {
      impresa = etiqueta.replace(/^(page|página|pág\.|p\.)\s*/i, '').trim();
      paginas.push({ etiqueta: impresa, bloque: base + bloques.length });
    }
  };

  /** Texto en línea en Markdown ligero; recoge llamadas a notas y saltos de página. */
  const enLinea = (n: Nodo, refs: string[]): string => {
    if (n.nombre === '#texto') return n.texto ?? '';
    if (n.attrs.id) anclasPendientes.push(n.attrs.id);
    if (esSaltoPagina(n)) { saltoPagina(n); return ''; }
    if (n.nombre === 'br') return '\n';
    if (n.nombre === 'img') return n.attrs.alt ? `[imagen: ${n.attrs.alt}]` : '';
    const llamada = esLlamadaNota(n);
    if (llamada) { refs.push(llamada); return `[^${llamada}]`; }
    const dentro = n.hijos.map((h) => enLinea(h, refs)).join('');
    if (n.nombre === 'sup' && /^\[\^[^\]]+\]$/.test(dentro.trim())) return dentro.trim();
    const t = dentro.trim();
    if (!t) return dentro;
    switch (n.nombre) {
      case 'em': case 'i': case 'cite': return envolver(dentro, '*');
      case 'strong': case 'b': return envolver(dentro, '**');
      case 'code': return '`' + t + '`';
      case 'a': {
        const href = n.attrs.href ?? '';
        return /^https?:/.test(href) && href !== t ? `[${t}](${href})` : dentro;
      }
      default: return dentro;
    }
  };

  const limpiar = (s: string) => s.replace(/[ \t\r\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const anadir = (tipo: TipoBloque, texto: string, refs: string[], extra: Partial<BloqueTexto> = {}) => {
    const t = limpiar(texto);
    if (!t) return;
    if (tipo === 'titulo') {
      const nivel = extra.nivel ?? 1;
      while (nivelesRuta.length && (nivelesRuta[nivelesRuta.length - 1] as number) >= nivel) { nivelesRuta.pop(); ruta.pop(); }
      nivelesRuta.push(nivel);
      ruta = [...ruta, t.replace(/\s+/g, ' ')];
      parrafo = 0;
    } else parrafo++;
    for (const a of anclasPendientes) anclas.set(a, base + bloques.length);
    anclasPendientes = [];
    bloques.push({
      tipo, texto: t, ruta: [...ruta], parrafo: tipo === 'titulo' ? 0 : parrafo, impresa,
      ...(refs.length ? { notas: [...refs] } : {}),
      ...(o.capitulo ? { capitulo: o.capitulo } : {}),
      ...extra,
    });
  };

  const tabla = (n: Nodo, refs: string[]): string => {
    const filas = buscarTodos(n, (x) => x.nombre === 'tr');
    const celdas = filas.map((f) => f.hijos.filter((c) => c.nombre === 'td' || c.nombre === 'th').map((c) => limpiar(enLinea(c, refs)).replace(/\|/g, '\\|').replace(/\n/g, ' ')));
    const ancho = Math.max(0, ...celdas.map((c) => c.length));
    if (!ancho) return '';
    const fila = (c: string[]) => '| ' + Array.from({ length: ancho }, (_, i) => c[i] ?? '').join(' | ') + ' |';
    return [fila(celdas[0] ?? []), '|' + ' --- |'.repeat(ancho), ...celdas.slice(1).map(fila)].join('\n');
  };

  const nota = (n: Nodo) => {
    const refs: string[] = [];
    const id = (n.attrs.id ?? `nota-${notas.length + 1}`).replace(/^#/, '');
    const texto = limpiar(enLinea(n, refs)).replace(/\s*\[\^[^\]]*\]\s*$/u, '').replace(/\s*[↑↩︎]+\s*$/u, '');
    if (texto) notas.push({ id, texto });
  };

  const lista = (n: Nodo, refs: string[], prof = 0): string => {
    const ordenada = n.nombre === 'ol';
    let i = Number(n.attrs.start ?? 1);
    const lineas: string[] = [];
    for (const li of n.hijos.filter((h) => h.nombre === 'li')) {
      if (esNota(li)) { nota(li); continue; }
      const propio = li.hijos.filter((h) => h.nombre !== 'ul' && h.nombre !== 'ol').map((h) => enLinea(h, refs)).join('');
      lineas.push(`${'  '.repeat(prof)}${ordenada ? `${i++}.` : '-'} ${limpiar(propio).replace(/\n+/g, ' ')}`);
      for (const sub of li.hijos.filter((h) => h.nombre === 'ul' || h.nombre === 'ol')) lineas.push(lista(sub, refs, prof + 1));
    }
    return lineas.filter((l) => l.trim()).join('\n');
  };

  const recorrer = (n: Nodo) => {
    let pendiente: Nodo[] = [];
    const vaciar = () => {
      if (!pendiente.length) return;
      const refs: string[] = [];
      const t = pendiente.map((h) => enLinea(h, refs)).join('');
      pendiente = [];
      anadir('parrafo', t, refs);
    };
    for (const h of n.hijos) {
      if (h.nombre === '#texto' || !BLOQUES.has(h.nombre)) {
        if (h.nombre === 'script' || h.nombre === 'style' || h.nombre === 'head' || h.nombre === 'title') continue;
        if (h.nombre !== '#texto' && esNota(h)) { vaciar(); nota(h); continue; }
        pendiente.push(h);
        continue;
      }
      vaciar();
      if (esNota(h)) { nota(h); continue; }
      if (h.attrs.id) anclasPendientes.push(h.attrs.id);
      if (esSaltoPagina(h)) { saltoPagina(h); continue; }
      const refs: string[] = [];
      const m = /^h([1-6])$/.exec(h.nombre);
      if (m) anadir('titulo', enLinea(h, refs).replace(/\n+/g, ' '), refs, { nivel: Number(m[1]) });
      else if (h.nombre === 'p' || h.nombre === 'figcaption' || h.nombre === 'dt' || h.nombre === 'dd' || h.nombre === 'address') {
        anadir('parrafo', enLinea(h, refs), refs);
      } else if (h.nombre === 'ul' || h.nombre === 'ol') {
        const items = h.hijos.filter((li) => li.nombre === 'li');
        if (items.length && items.every(esNota)) { for (const li of items) nota(li); continue; }
        anadir('lista', lista(h, refs), refs);
      } else if (h.nombre === 'table') anadir('tabla', tabla(h, refs), refs);
      else if (h.nombre === 'pre') anadir('codigo', '```\n' + textoPlano(h).replace(/\n+$/, '') + '\n```', refs);
      else if (h.nombre === 'blockquote') {
        if (h.hijos.some((x) => BLOQUES.has(x.nombre))) {
          const antes = bloques.length;
          recorrer(h);
          for (let i = antes; i < bloques.length; i++) if ((bloques[i] as BloqueTexto).tipo === 'parrafo') (bloques[i] as BloqueTexto).tipo = 'cita';
        } else anadir('cita', enLinea(h, refs), refs);
      } else if (h.nombre === 'hr' || h.nombre === 'nav') continue;
      else if (h.nombre === 'figure' && !h.hijos.some((x) => BLOQUES.has(x.nombre) && x.nombre !== 'figcaption')) {
        const img = buscar(h, (x) => x.nombre === 'img');
        const pie = buscar(h, (x) => x.nombre === 'figcaption');
        anadir('imagen', [img?.attrs.alt, pie ? textoPlano(pie) : ''].filter(Boolean).join('. ') || '[imagen]', refs);
      } else recorrer(h);
    }
    vaciar();
  };

  recorrer(raiz);
  return { bloques, notas, paginas, impresa, ruta, anclas };
}

function envolver(s: string, marca: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!m || !m[2]) return s;
  return `${m[1]}${marca}${m[2]}${marca}${m[3]}`;
}

/** Atajo: HTML → bloques. */
export function bloquesDeHtml(html: string, o: OpcionesBloques = {}): ResultadoBloques {
  const raiz = analizarHtml(html);
  const cuerpo = buscar(raiz, (n) => n.nombre === 'body') ?? raiz;
  return bloquesDeArbol(cuerpo, o);
}
