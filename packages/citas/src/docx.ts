/**
 * DOCX: leer el texto y escribir las citas conservando el formato.
 *
 * Se descomprime con fflate y se edita word/document.xml a mano, run a run: la
 * cita se inserta partiendo el run donde acaba la afirmación y copiando sus
 * propiedades (fuente, tamaño, color…), de modo que nada más del documento
 * cambia. En estilos de notas se crean notas al pie de Word de verdad
 * (word/footnotes.xml, relación y tipo de contenido si no existían). La
 * bibliografía se añade al final del cuerpo, antes del sectPr.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import type { DocumentoCitable } from './csl/mapeo.js';
import { MotorCitas } from './csl/motor.js';
import { htmlATramos, type Tramo } from './csl/html.js';
import { agrupar, tituloBibliografia, type CitaAInsertar, type OpcionesInsercion } from './insertar.js';

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

interface NodoTexto {
  /** Posición en el XML del contenido de <w:t>. */
  xmlInicio: number;
  xmlFin: number;
  /** Desplazamiento del texto decodificado dentro del párrafo. */
  desde: number;
  texto: string;
  /** Posición XML de cada carácter decodificado (y una más al final). */
  mapa: number[];
  /** <w:rPr> del run, tal cual ('' si no tiene). */
  rPr: string;
  virtual?: false;
}
/** Tabulador o salto: ocupa un carácter; `xmlPos` es el final de su etiqueta. */
interface NodoVirtual { virtual: true; desde: number; texto: string; xmlPos: number; rPr: string }

interface ParrafoDocx {
  desde: number; // en el texto completo
  texto: string;
  nodos: Array<NodoTexto | NodoVirtual>;
  /** Posición XML de </w:p> (o del propio <w:p/>). */
  cierre: number;
  autocerrado: boolean;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(xml: string, base: number): { texto: string; mapa: number[] } {
  let texto = '';
  const mapa: number[] = [];
  for (let i = 0; i < xml.length;) {
    if (xml[i] === '&') {
      const fin = xml.indexOf(';', i);
      const e = xml.slice(i + 1, fin);
      const c = e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? '';
      for (const u of c.split('')) { mapa.push(base + i); texto += u; }
      i = fin + 1;
    } else { mapa.push(base + i); texto += xml[i]; i++; }
  }
  mapa.push(base + xml.length);
  return { texto, mapa };
}

export function escaparXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nombreEtiqueta(tag: string): string { return tag.match(/^<\/?([\w:]+)/)?.[1] ?? ''; }

/** Recorre document.xml y devuelve los párrafos con su mapa de posiciones. */
function analizar(xml: string): { parrafos: ParrafoDocx[]; texto: string } {
  const terminados: Array<Omit<ParrafoDocx, 'desde'>> = [];
  const pila: Array<{ nodos: Array<NodoTexto | NodoVirtual>; texto: string }> = [];
  let enRun = false, rPrInicio = -1, rPr = '', enT = -1, ignorar = 0;
  const re = /<[^>]+>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[0], pos = m.index, nombre = nombreEtiqueta(tag), cierre = tag[1] === '/', auto = tag.endsWith('/>');
    const p = pila[pila.length - 1];
    if (nombre === 'w:p') {
      if (auto) terminados.push({ texto: '', nodos: [], cierre: pos, autocerrado: true });
      else if (!cierre) pila.push({ nodos: [], texto: '' });
      else { const q = pila.pop(); if (q) terminados.push({ ...q, cierre: pos, autocerrado: false }); }
      continue;
    }
    if (nombre === 'w:r') {
      if (!cierre && !auto) { enRun = true; rPr = ''; rPrInicio = -1; } else if (cierre) enRun = false;
      continue;
    }
    if (nombre === 'w:rPr' && enRun && enT === -1) {
      if (auto) rPr = tag;
      else if (!cierre) rPrInicio = pos;
      else if (rPrInicio !== -1) { rPr = xml.slice(rPrInicio, pos + tag.length); rPrInicio = -1; }
      continue;
    }
    if (nombre === 'w:del' || nombre === 'w:instrText' || nombre === 'w:delText') {
      if (!auto) ignorar += cierre ? -1 : 1;
      continue;
    }
    if (!p || !enRun || ignorar > 0) continue;
    if (nombre === 'w:t') {
      if (auto) continue;
      if (!cierre) enT = pos + tag.length;
      else if (enT !== -1) {
        const { texto, mapa } = decodificar(xml.slice(enT, pos), enT);
        p.nodos.push({ xmlInicio: enT, xmlFin: pos, desde: p.texto.length, texto, mapa, rPr });
        p.texto += texto;
        enT = -1;
      }
    } else if (nombre === 'w:tab' || nombre === 'w:br' || nombre === 'w:cr') {
      const t = nombre === 'w:tab' ? '\t' : '\n';
      p.nodos.push({ virtual: true, desde: p.texto.length, texto: t, xmlPos: pos + tag.length, rPr });
      p.texto += t;
    } else if (nombre === 'w:noBreakHyphen') {
      p.nodos.push({ virtual: true, desde: p.texto.length, texto: '‑', xmlPos: pos + tag.length, rPr });
      p.texto += '‑';
    }
  }
  const parrafos: ParrafoDocx[] = [];
  let desde = 0;
  for (const q of terminados) { parrafos.push({ ...q, desde }); desde += q.texto.length + 2; }
  return { parrafos, texto: parrafos.map((q) => q.texto).join('\n\n') };
}

function abrir(bytes: Uint8Array): Unzipped {
  const z = unzipSync(bytes);
  if (!z['word/document.xml']) throw new Error('No es un DOCX: falta word/document.xml.');
  return z;
}

/** Texto de un DOCX (párrafos separados por una línea en blanco) y sus párrafos. */
export function leerDocx(bytes: Uint8Array): { texto: string; parrafos: string[] } {
  const { parrafos, texto } = analizar(strFromU8(abrir(bytes)['word/document.xml']!));
  return { texto, parrafos: parrafos.map((p) => p.texto) };
}

/** Texto de un fichero de usuario: DOCX, TXT, Markdown o HTML. */
export function extraerTexto(bytes: Uint8Array, mime: string): { texto: string; parrafos: string[] } {
  const m = mime.toLowerCase();
  if (m.includes('wordprocessingml') || m.endsWith('/docx') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return leerDocx(bytes);
  let texto = new TextDecoder('utf-8').decode(bytes).replace(/\r\n?/g, '\n');
  if (m.includes('html')) {
    texto = texto.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
  } else if (!m.startsWith('text/') && !m.includes('markdown') && !m.includes('json')) {
    throw new Error(`Formato no admitido para extraer texto: ${mime}. Los PDF se leen con la ingesta (SPDF).`);
  }
  return { texto, parrafos: texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) };
}

// ---------------------------------------------------------------------------
// Propiedades de run
// ---------------------------------------------------------------------------

const ORDEN_RPR = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint',
  'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect',
  'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'];

/** Hijos de primer nivel de un <w:rPr>…</w:rPr>. */
function hijos(rPr: string): Array<{ nombre: string; xml: string }> {
  const dentro = rPr.replace(/^<w:rPr[^>]*\/?>/, '').replace(/<\/w:rPr>$/, '');
  const salida: Array<{ nombre: string; xml: string }> = [];
  const re = /<([\w:]+)[^>]*?(\/>|>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dentro))) {
    const nombre = m[1] as string;
    if (m[2] === '/>') { salida.push({ nombre, xml: m[0] }); continue; }
    const fin = dentro.indexOf(`</${nombre}>`, re.lastIndex);
    const hasta = fin === -1 ? re.lastIndex : fin + nombre.length + 3;
    salida.push({ nombre, xml: dentro.slice(m.index, hasta) });
    re.lastIndex = hasta;
  }
  return salida;
}

/** rPr del run original con el formato del tramo (cursiva, negrita…) en el orden del esquema. */
export function combinarRPr(base: string, t: Omit<Tramo, 'texto'>, extra: Record<string, string> = {}): string {
  const mapa = new Map<string, string>();
  for (const h of hijos(base)) if (h.nombre !== 'w:rPrChange' && h.nombre !== 'w:vertAlign') mapa.set(h.nombre, h.xml);
  const fijar = (n: string, v: boolean | undefined) => { if (v === true) mapa.set(n, `<${n}/>`); else if (v === false) mapa.set(n, `<${n} w:val="0"/>`); };
  fijar('w:i', t.cursiva); fijar('w:iCs', t.cursiva);
  fijar('w:b', t.negrita); fijar('w:bCs', t.negrita);
  fijar('w:smallCaps', t.versalitas);
  if (t.superindice) mapa.set('w:vertAlign', '<w:vertAlign w:val="superscript"/>');
  else if (t.subindice) mapa.set('w:vertAlign', '<w:vertAlign w:val="subscript"/>');
  for (const [n, x] of Object.entries(extra)) mapa.set(n, x);
  if (!mapa.size) return '';
  const ordenados = ORDEN_RPR.filter((n) => mapa.has(n)).map((n) => mapa.get(n)!);
  const resto = [...mapa.entries()].filter(([n]) => !ORDEN_RPR.includes(n)).map(([, x]) => x);
  return `<w:rPr>${ordenados.join('')}${resto.join('')}</w:rPr>`;
}

function runsDeTramos(tramos: Tramo[], rPr: string): string {
  return tramos.map((t) => `<w:r>${combinarRPr(rPr, t)}<w:t xml:space="preserve">${escaparXml(t.texto)}</w:t></w:r>`).join('');
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL_NOTAS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const TIPO_NOTAS = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';

function idDeEstilo(estilos: string, nombres: string[], ids: string[]): string | null {
  for (const id of ids) if (estilos.includes(`w:styleId="${id}"`)) return id;
  for (const n of nombres) {
    const m = estilos.match(new RegExp(`<w:style\\b[^>]*w:styleId="([^"]+)"[^>]*>(?:(?!</w:style>)[\\s\\S])*?<w:name w:val="${n}"`, 'i'));
    if (m) return m[1] as string;
  }
  return null;
}

/** Punto de inserción en el XML para un desplazamiento dentro del párrafo. */
function localizar(p: ParrafoDocx, k: number): { tipo: 'texto'; nodo: NodoTexto; xml: number } | { tipo: 'entre'; xml: number; rPr: string } {
  // El carácter anterior manda: la cita sigue a la afirmación.
  for (let i = p.nodos.length - 1; i >= 0; i--) {
    const n = p.nodos[i]!;
    if (n.desde < k && k <= n.desde + n.texto.length) {
      if (n.virtual) return { tipo: 'entre', xml: n.xmlPos, rPr: n.rPr };
      return { tipo: 'texto', nodo: n, xml: n.mapa[k - n.desde]! };
    }
  }
  const primero = p.nodos.find((n) => !n.virtual) as NodoTexto | undefined;
  if (k === 0 && primero) return { tipo: 'texto', nodo: primero, xml: primero.xmlInicio };
  return { tipo: 'entre', xml: p.cierre, rPr: (p.nodos[p.nodos.length - 1]?.rPr) ?? '' };
}

export interface OpcionesDocx extends OpcionesInsercion {
  /** Notas al pie de Word (por defecto: sí en estilos de notas, no en los demás). */
  notasAlPie?: boolean;
}

/**
 * Inserta citas en un DOCX. Las posiciones (`desde`, `hasta`) se refieren al
 * texto que devuelve `leerDocx` / `extraerTexto` del mismo fichero.
 */
export async function insertarCitasDocx(bytes: Uint8Array, citas: CitaAInsertar[], documentos: DocumentoCitable[], opciones: OpcionesDocx = {}): Promise<{ docx: Uint8Array; avisos: string[] }> {
  const z = abrir(bytes);
  const avisos: string[] = [];
  let xml = strFromU8(z['word/document.xml']!);
  const { parrafos, texto } = analizar(xml);
  const motor = await MotorCitas.crear({ estilo: opciones.estilo ?? 'apa', idioma: opciones.idioma ?? 'es-ES', documentos });
  const notas = opciones.notasAlPie ?? motor.esNotas;
  const modo = motor.esNotas ? 'nota' : 'autor-fecha';
  const grupos = agrupar(texto, citas, modo);
  const { citas: htmls } = motor.citar(grupos.map((g) => g.elementos), 'html');
  const estilos = z['word/styles.xml'] ? strFromU8(z['word/styles.xml']) : '';

  // Notas al pie: fichero, relación y tipo de contenido.
  let notasXml = z['word/footnotes.xml'] ? strFromU8(z['word/footnotes.xml']) : '';
  let siguienteNota = 1;
  if (notas && grupos.length) {
    if (!notasXml) {
      notasXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
        + '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
        + '</w:footnotes>';
      const rels = strFromU8(z['word/_rels/document.xml.rels'] ?? strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'));
      if (!rels.includes(REL_NOTAS)) z['word/_rels/document.xml.rels'] = strToU8(rels.replace('</Relationships>', `<Relationship Id="rIdScholarisNotas" Type="${REL_NOTAS}" Target="footnotes.xml"/></Relationships>`));
      const tipos = strFromU8(z['[Content_Types].xml']!);
      if (!tipos.includes('/word/footnotes.xml')) z['[Content_Types].xml'] = strToU8(tipos.replace('</Types>', `<Override PartName="/word/footnotes.xml" ContentType="${TIPO_NOTAS}"/></Types>`));
    }
    const ids = [...notasXml.matchAll(/<w:footnote\b[^>]*w:id="(-?\d+)"/g)].map((m) => Number(m[1]));
    siguienteNota = Math.max(0, ...ids) + 1;
  }
  const estiloRefNota = notas ? idDeEstilo(estilos, ['footnote reference'], ['FootnoteReference', 'Refdenotaalpie']) : null;
  const estiloTextoNota = notas ? idDeEstilo(estilos, ['footnote text'], ['FootnoteText', 'Textonotapie']) : null;
  const nuevasNotas: string[] = [];

  // Ediciones en el XML: (posición, borrar, insertar), aplicadas de atrás adelante.
  const ediciones: Array<{ pos: number; borrar: number; texto: string }> = [];
  const parrafoDe = (k: number) => parrafos.find((p) => k >= p.desde && k <= p.desde + p.texto.length);
  grupos.forEach((g, i) => {
    const p = parrafoDe(g.punto);
    if (!p) { avisos.push(`No se encontró el párrafo de la cita ${i + 1}.`); return; }
    const loc = localizar(p, g.punto - p.desde);
    const rPr = loc.tipo === 'texto' ? loc.nodo.rPr : loc.rPr;
    let runs: string;
    if (notas) {
      const id = siguienteNota++;
      const rRef = combinarRPr(rPr, { superindice: true }, estiloRefNota ? { 'w:rStyle': `<w:rStyle w:val="${estiloRefNota}"/>` } : {});
      runs = `<w:r>${rRef}<w:footnoteReference w:id="${id}"/></w:r>`;
      const tramos = htmlATramosSeguro(htmls[i] ?? '');
      nuevasNotas.push(`<w:footnote w:id="${id}"><w:p>${estiloTextoNota ? `<w:pPr><w:pStyle w:val="${estiloTextoNota}"/></w:pPr>` : ''}`
        + `<w:r><w:rPr>${estiloRefNota ? `<w:rStyle w:val="${estiloRefNota}"/>` : ''}<w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>`
        + `<w:r><w:t xml:space="preserve"> </w:t></w:r>${runsDeTramos(tramos, '')}</w:p></w:footnote>`);
    } else {
      const tramos = htmlATramosSeguro(htmls[i] ?? '');
      if (tramos[0]) tramos[0] = { ...tramos[0], texto: ' ' + tramos[0].texto };
      runs = runsDeTramos(tramos, rPr);
    }
    if (loc.tipo === 'texto') {
      const conT = loc.nodo.rPr;
      ediciones.push({ pos: loc.xml, borrar: 0, texto: `</w:t></w:r>${runs}<w:r>${conT}<w:t xml:space="preserve">` });
    } else {
      ediciones.push({ pos: loc.xml, borrar: 0, texto: loc.xml === p.cierre ? runs : `</w:r>${runs}<w:r>${rPr}` });
    }
    // Reescritura (aplicación de marco): solo si la afirmación vive en un único <w:t>.
    if (g.reescritura) {
      const a = localizar(p, g.desde - p.desde + 1), b = localizar(p, g.corte - p.desde);
      if (a.tipo === 'texto' && b.tipo === 'texto' && a.nodo === b.nodo) {
        const ini = a.nodo.mapa[g.desde - p.desde - a.nodo.desde]!;
        ediciones.push({ pos: ini, borrar: b.xml - ini, texto: escaparXml(g.reescritura) });
      } else avisos.push(`La reescritura de la cita ${i + 1} cruza varios tramos con formato: se deja el texto original.`);
    }
  });
  ediciones.sort((a, b) => b.pos - a.pos || b.borrar - a.borrar);
  for (const e of ediciones) xml = xml.slice(0, e.pos) + e.texto + xml.slice(e.pos + e.borrar);

  // Bibliografía al final del cuerpo.
  if (opciones.bibliografia !== false && grupos.length) {
    const entradas = motor.bibliografiaTramos(undefined, grupos.map((g) => g.elementos));
    if (entradas.length) {
      const titulo = opciones.tituloBibliografia ?? tituloBibliografia(motor.idioma, motor.estilo);
      const estiloTitulo = idDeEstilo(estilos, ['heading 1'], ['Heading1', 'Ttulo1', 'Titre1', 'Titolo1']);
      const cab = estiloTitulo
        ? `<w:p><w:pPr><w:pStyle w:val="${estiloTitulo}"/></w:pPr><w:r><w:t xml:space="preserve">${escaparXml(titulo)}</w:t></w:r></w:p>`
        : `<w:p><w:pPr><w:spacing w:before="480" w:after="240"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${escaparXml(titulo)}</w:t></w:r></w:p>`;
      const sangria = motor.esNumerico ? '<w:ind w:left="567" w:hanging="567"/>' : '<w:ind w:left="720" w:hanging="720"/>';
      const ps = entradas.map((t) => `<w:p><w:pPr><w:spacing w:after="120"/>${sangria}</w:pPr>${runsDeTramos(t, '')}</w:p>`).join('');
      const finCuerpo = xml.lastIndexOf('</w:body>');
      const sect = xml.lastIndexOf('<w:sectPr', finCuerpo);
      const punto = sect !== -1 && xml.lastIndexOf('</w:p>', finCuerpo) < sect ? sect : finCuerpo;
      xml = xml.slice(0, punto) + cab + ps + xml.slice(punto);
    }
  }
  z['word/document.xml'] = strToU8(xml);
  if (nuevasNotas.length) z['word/footnotes.xml'] = strToU8(notasXml.replace('</w:footnotes>', nuevasNotas.join('') + '</w:footnotes>'));
  return { docx: zipSync(z, { level: 6 }), avisos };
}

function htmlATramosSeguro(html: string): Tramo[] { return html ? htmlATramos(html) : []; }
