/**
 * ¿Es este registro externo (Crossref, OpenAlex, un catálogo) la MISMA obra y
 * la misma publicación que el documento? Puro, sin red.
 *
 * Una ficha equivocada contamina todas las citas, así que se exige mucho:
 * - título casi igual, y no un título que CONTIENE el de la obra porque trata
 *   de ella («A review of…», «Notes on…», «Voces de Cervantes en Don Quijote»);
 * - el primer autor del registro está en el documento y el primero del
 *   documento está en el registro (en las reseñas de JSTOR el reseñista va
 *   primero y el autor reseñado detrás: «Entwistle, Cervantes…»);
 * - tipo coherente (un libro o un capítulo no es un artículo de revista);
 * - año de la edición que se tiene delante (±1), no solo el de la obra;
 * - si el documento muestra un DOI, el registro no puede traer otro.
 *
 * Origen: el capítulo I del Quijote salió con el DOI y la revista de una
 * reseña de 1949 en The Modern Language Review (OpenAlex, 10.2307/3716615).
 */

import type { Autor, MetadatosDocumento } from '@scholaris/nucleo';
import { normalizar, similitud } from '../../texto.js';

/** Campos de la publicación: van juntos y de la misma fuente, o no van. */
export const BLOQUE_PUBLICACION = ['doi', 'revista', 'volumen', 'numero', 'paginas'] as const;

const ARTICULOS = new Set(['the', 'a', 'an', 'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'le', 'les', 'l', 'il', 'i', 'gli', 'der', 'die', 'das', 'o', 'os', 'as']);

/** Palabras que delatan un texto SOBRE la obra (reseña, estudio, nota, edición ajena, fe de erratas). */
const SOBRE_LA_OBRA = [
  'review', 'reviews', 'reviewed', 'resena', 'resenas', 'recension', 'recensione', 'compte rendu', 'comptes rendus', 'besprechung', 'rezension',
  'notes on', 'note on', 'notas sobre', 'nota sobre', 'notas a', 'apuntes sobre', 'comentario', 'comentarios', 'commentary', 'comments on', 'comment on', 'commento',
  'estudio', 'estudios', 'study', 'studies', 'etude', 'etudes', 'studi', 'essays on', 'essay on', 'ensayo sobre', 'ensayos sobre',
  'a proposito', 'en torno a', 'acerca de', 'sobre', 'about',
  'lectura de', 'lecturas de', 'relectura', 'reading', 'readings', 'approach', 'approaches', 'aproximacion', 'aproximaciones', 'perspectivas', 'perspectives',
  'reception', 'recepcion', 'influence', 'influencia', 'critica de', 'critique', 'analisis', 'analysis', 'guide to', 'guia de', 'companion', 'handbook',
  'translated by', 'translation of', 'traduccion de', 'traducido por', 'edited by', 'ed by', 'edicion de', 'al cuidado de', 'prologo de', 'introduction by', 'with an introduction',
  'erratum', 'errata', 'corrigendum', 'correction', 'retraction', 'retracted', 'reply to', 'response to', 'respuesta a', 'rejoinder', 'obituary', 'in memoriam', 'necrologica',
  'bibliografia', 'bibliography', 'concordance', 'concordancia', 'adaptacion', 'adaptation',
];
const RE_SOBRE = new RegExp(`(?:^| )(${SOBRE_LA_OBRA.map((p) => p.replace(/ /g, ' ')).join('|')})(?= |$)`, 'g');

const sinEtiquetas = (s: string) => s.replace(/<[^>]+>/g, ' ');
const sinArticulo = (n: string) => {
  const ws = n.split(' ');
  return ws.length > 1 && ARTICULOS.has(ws[0] as string) ? ws.slice(1).join(' ') : n;
};
/** La parte principal de un título (antes de «:», «. », « - », «|»…). */
const principal = (s: string) => sinEtiquetas(s).split(/\s*[:;|]\s*|\.\s+|\s+[-–—]\s+|[?!]\s+/)[0] ?? s;

export interface ComparacionTitulo {
  puntuacion: number;
  motivo?: string;
  /** Rechazo por la forma (trata de la obra, otro título que contiene este), no por parecido: ningún umbral lo admite. */
  estructural?: boolean;
}

/**
 * Compara el título del documento con el de un registro. 0-1; por debajo de
 * 0,9 no es la misma obra. Rechaza el registro que contiene el título de la
 * obra con algo delante («Notes on X») o con un añadido que no es un
 * subtítulo, y el que trae palabras de reseña o estudio que el documento no
 * tiene.
 */
export function compararTitulos(doc: { titulo?: string; subtitulo?: string; autores?: Autor[] }, candidato: string | undefined): ComparacionTitulo {
  if (!doc.titulo || !candidato) return { puntuacion: 0, motivo: 'sin título' };
  const crudo = sinEtiquetas(candidato);
  const nd = sinArticulo(normalizar(doc.titulo));
  const nc = sinArticulo(normalizar(crudo));
  if (!nd || !nc) return { puntuacion: 0, motivo: 'sin título' };
  const completo = normalizar(`${doc.titulo} ${doc.subtitulo ?? ''}`);
  // Palabras de reseña, estudio, nota o edición ajena que el documento no lleva.
  const marcas = [...` ${nc} `.matchAll(RE_SOBRE)].map((m) => m[1] as string).filter((m) => !` ${completo} `.includes(` ${m} `));
  if (marcas.length) return { puntuacion: 0, estructural: true, motivo: `el registro trata de la obra («${marcas[0]}»)` };
  // El apellido del autor dentro del título del registro y no en el del documento: «Cervantes, Miguel de: Don Quijote…».
  const apellidoDentro = (doc.autores ?? []).flatMap(apellidosDe).find((a) => a.length >= 4 && ` ${nc} `.includes(` ${a} `) && !` ${completo} `.includes(` ${a} `));
  if (apellidoDentro) return { puntuacion: 0, estructural: true, motivo: `el título del registro nombra al autor («${apellidoDentro}»): trata de la obra` };
  if (nd === nc) return { puntuacion: 1 };
  const subtitulo = doc.subtitulo ? normalizar(doc.subtitulo) : '';
  // Contención por palabras enteras («art» no está en «heart»).
  const dentro = (largo: string, corto: string) => ` ${largo} `.indexOf(` ${corto} `);
  const iC = dentro(nc, nd);
  if (iC >= 0) {
    if (nc.slice(0, iC).trim()) return { puntuacion: 0, estructural: true, motivo: 'el título del registro contiene el de la obra con algo delante: trata de ella' };
    // «Título: subtítulo» en el registro. Solo si el añadido va tras un separador y, si el documento tiene subtítulo, es ese.
    if (!separadoTras(crudo, nd)) return { puntuacion: 0, estructural: true, motivo: 'el título del registro sigue después del de la obra: es otro título' };
    const resto = nc.slice(iC + nd.length).trim();
    if (subtitulo && similitud(resto, subtitulo) < 0.8 && !resto.startsWith(subtitulo) && !subtitulo.startsWith(resto)) return { puntuacion: 0, estructural: true, motivo: 'otro subtítulo' };
    return { puntuacion: subtitulo ? 0.97 : 0.92 };
  }
  const iD = dentro(nd, nc);
  if (iD >= 0) {
    if (nd.slice(0, iD).trim()) return { puntuacion: 0, estructural: true, motivo: 'el título de la obra contiene el del registro con algo delante: es otro título' };
    if (!separadoTras(doc.titulo, nc)) return { puntuacion: 0, estructural: true, motivo: 'el título de la obra sigue después del del registro: es otro título' };
    return { puntuacion: 0.92 };
  }
  // Ni uno contiene al otro: parecido de verdad (erratas, mayúsculas, «&»/«and»), entero o con el subtítulo.
  const s = Math.max(similitud(nd, nc), subtitulo ? similitud(completo, normalizar(crudo)) : 0);
  if (s >= 0.9) {
    // Mismo principio y distinto subtítulo («Attention is all you need: utilizing attention in…»): no.
    const pd = normalizar(principal(doc.titulo)), pc = normalizar(principal(crudo));
    if (pd && pc && pd !== pc && similitud(pd, pc) < 0.9) return { puntuacion: 0, estructural: true, motivo: 'otro título principal' };
    return { puntuacion: s };
  }
  return { puntuacion: s, motivo: `títulos distintos (${s.toFixed(2)})` };
}

/** ¿En el título original, lo que va después de `inicio` empieza con un separador de subtítulo? */
function separadoTras(original: string, inicio: string): boolean {
  const palabras = inicio.split(' ').length;
  // Se recorre el original palabra a palabra (normalizada) hasta cubrir `inicio` y se mira qué sigue.
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  let vistas = 0, fin = 0;
  const texto = sinEtiquetas(original);
  const primero = normalizar(texto).split(' ')[0] ?? '';
  // Si el original empieza por un artículo que `inicio` no lleva, se salta.
  const saltar = ARTICULOS.has(primero) && !inicio.startsWith(`${primero} `) ? 1 : 0;
  while ((m = re.exec(texto))) {
    vistas++;
    if (vistas === palabras + saltar) { fin = m.index + m[0].length; break; }
  }
  if (!fin) return false;
  return /^\s*([:;.|?!]|[-–—]\s|\()/.test(texto.slice(fin));
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'van', 'von', 'der', 'den', 'di', 'da', 'du', 'le', 'y', 'e', 'st', 'mc']);

/** Apellidos significativos, normalizados («de Cervantes Saavedra» → cervantes, saavedra). */
function apellidosDe(a: Autor): string[] {
  const base = a.apellidos || a.nombre || '';
  return normalizar(base).split(' ').filter((w) => w.length >= 2 && !PARTICULAS.has(w));
}

/**
 * ¿Pueden ser el mismo nombre de pila? «Ashish» y «A.», «C. S.» y «Clive
 * Staples», «Niki» y «Niki Jitendra» sí; «C. S.» y «Cynthia» no (dos iniciales
 * no son un solo nombre), ni «Julio» y «Javier».
 */
export function nombresDePilaCompatibles(a: string, b: string): boolean {
  const fichas = (s: string) => normalizar(s.replace(/\./g, '. ')).split(' ').filter((w) => w && !PARTICULAS.has(w));
  const x = fichas(a), y = fichas(b);
  if (!x.length || !y.length) return true;
  const [corta, larga] = x.length <= y.length ? [x, y] : [y, x];
  if (corta.length < larga.length && larga.every((t) => t.length === 1) && corta.some((t) => t.length > 1)) return false;
  return corta.every((t, i) => {
    const u = larga[i] as string;
    return t[0] === u[0] && (t.length === 1 || u.length === 1 || similitud(t, u) >= 0.8);
  });
}

/** ¿La misma persona? Un apellido significativo en común y nombres de pila compatibles. */
export function mismaPersonaCatalogo(a: Autor, b: Autor): boolean {
  const x = apellidosDe(a), y = new Set(apellidosDe(b));
  if (!x.length || !y.size || !x.some((w) => y.has(w))) return false;
  return nombresDePilaCompatibles(a.nombre ?? '', b.nombre ?? '');
}

export interface Veredicto { casa: boolean | null; motivo?: string }

/**
 * Autores: el primero del registro está entre los del documento y el primero
 * del documento está en el registro. Sin autores en algún lado, no hay
 * pruebas (null).
 */
export function compararAutores(doc: Autor[] | undefined, cand: Autor[] | undefined): Veredicto {
  const d = (doc ?? []).filter((a) => a.apellidos || a.nombre), c = (cand ?? []).filter((a) => a.apellidos || a.nombre);
  if (!d.length || !c.length) return { casa: null, motivo: d.length ? 'el registro no trae autores' : 'el documento no muestra autores' };
  const primeroDelRegistro = d.some((a) => mismaPersonaCatalogo(a, c[0] as Autor));
  const primeroDelDocumento = c.some((b) => mismaPersonaCatalogo(d[0] as Autor, b));
  if (primeroDelRegistro && primeroDelDocumento) return { casa: true };
  if (d.some((a) => c.some((b) => mismaPersonaCatalogo(a, b)))) return { casa: false, motivo: `el primer autor del registro (${c[0]!.apellidos}) no es del documento: ¿una reseña?` };
  return { casa: false, motivo: 'ningún autor en común' };
}

const FAMILIA: Record<string, string> = {
  book: 'libro', chapter: 'parte', 'article-journal': 'articulo', article: 'articulo', 'article-magazine': 'articulo', 'article-newspaper': 'prensa',
  'paper-conference': 'congreso', thesis: 'tesis', report: 'informe', manuscript: 'manuscrito', webpage: 'web', broadcast: 'emision', interview: 'emision',
  motion_picture: 'emision', speech: 'emision', song: 'emision',
};
const COMPATIBLES: Record<string, string[]> = {
  libro: ['libro'], parte: ['parte', 'congreso'], articulo: ['articulo', 'congreso', 'informe'], congreso: ['congreso', 'articulo', 'parte'],
  tesis: ['tesis'], informe: ['informe', 'articulo'], prensa: ['prensa'], manuscrito: ['manuscrito'], web: ['web'], emision: ['emision'],
};
/** Tipos de registro que nunca son el documento: reseñas, entradas de enciclopedia, fe de erratas, números de revista… */
const NUNCA = /^(review|review-book|peer-review|reference-entry|paratext|erratum|retraction|letter|editorial|dataset|component|grant|standard|journal|journal-issue|journal-volume|proceedings|proceedings-series|book-set|book-series|book-track|report-series|report-component|database|other|supplementary-materials|libguides)$/;

/** Tipos coherentes: un libro o un capítulo no es un artículo de revista; una reseña no es nunca el documento. */
export function compararTipos(doc: Partial<MetadatosDocumento>, cand: { tipoCSL?: string }): Veredicto {
  const tc = cand.tipoCSL;
  if (tc && NUNCA.test(tc)) return { casa: false, motivo: `el registro es de tipo «${tc}»` };
  const fd = doc.tipoCSL ? FAMILIA[doc.tipoCSL] : undefined, fc = tc ? FAMILIA[tc] : undefined;
  const anioObra = doc.anioOriginal ?? doc.anio;
  // Una obra antigua no es un artículo de revista ni de congreso, lea lo que lea el modelo.
  if (anioObra !== undefined && anioObra < 1850 && (fc === 'articulo' || fc === 'congreso')) return { casa: false, motivo: `una obra de ${anioObra} no es un artículo` };
  if (!fd || !fc) return { casa: null };
  return COMPATIBLES[fd]?.includes(fc) ? { casa: true } : { casa: false, motivo: `tipos incompatibles (${doc.tipoCSL} / ${tc})` };
}

/**
 * Año: el registro tiene que ser de la edición que se tiene delante (±1). Sin
 * año de la edición en el documento no hay pruebas (null); un registro
 * anterior a la propia obra es otra cosa (false).
 */
export function compararAnios(doc: Partial<MetadatosDocumento>, anios: Array<number | undefined>): Veredicto {
  const xs = anios.filter((a): a is number => typeof a === 'number' && a > 0);
  if (!xs.length) return { casa: null, motivo: 'el registro no trae año' };
  if (doc.anioOriginal !== undefined && xs.every((a) => a < doc.anioOriginal! - 1)) return { casa: false, motivo: `el registro (${xs[0]}) es anterior a la obra (${doc.anioOriginal})` };
  if (doc.anio === undefined) return { casa: null, motivo: 'el documento no muestra el año de la edición' };
  return xs.some((a) => Math.abs(a - doc.anio!) <= 1) ? { casa: true } : { casa: false, motivo: `otro año (${xs[0]} frente a ${doc.anio})` };
}

const RELLENO_EDITORIAL = new Set(['press', 'university', 'universidad', 'universite', 'universita', 'editorial', 'editoriales', 'editores', 'ediciones', 'edicions', 'editions', 'editrice', 'edizioni', 'publishing', 'publishers', 'publisher', 'publications', 'books', 'verlag', 'inc', 'ltd', 'llc', 'sa', 'sl', 'gmbh', 'co', 'company', 'group', 'grupo', 'the', 'of', 'and', 'de', 'del', 'la', 'el', 'y', 'e', 'et', 'und', 'media', 'science', 'business', 'limited', 'ebooks']);
const fichasEditorial = (s: string) => new Set(normalizar(s).split(' ').filter((w) => w.length >= 3 && !RELLENO_EDITORIAL.has(w)));

/** Editorial e ISBN (solo en libros y capítulos): si el documento los muestra, el registro no puede traer otros. */
export function compararEdicion(doc: Partial<MetadatosDocumento>, cand: Partial<MetadatosDocumento> & { isbns?: string[] }): Veredicto {
  const fc = cand.tipoCSL ? FAMILIA[cand.tipoCSL] : undefined;
  if (fc !== 'libro' && fc !== 'parte') return { casa: null };
  const limpio = (s: string) => s.replace(/[^0-9xX]/g, '').toUpperCase();
  const isbns = (cand.isbns ?? (cand.isbn ? [cand.isbn] : [])).map(limpio);
  if (doc.isbn && isbns.length && !isbns.includes(limpio(doc.isbn))) return { casa: false, motivo: 'otro ISBN: otra edición' };
  if (doc.editorial && cand.editorial) {
    const a = fichasEditorial(doc.editorial), b = fichasEditorial(cand.editorial);
    if (a.size && b.size && ![...a].some((w) => b.has(w))) return { casa: false, motivo: `otra editorial (${cand.editorial}): otra edición` };
  }
  return { casa: null };
}

export interface Evaluacion { acepta: boolean; puntuacion: number; motivo?: string }

/**
 * La frontera de identidad. Un registro solo se acepta si título, autor y año
 * casan con alta confianza, el tipo es coherente y no contradice el DOI, la
 * editorial ni el ISBN que muestra el documento. Si no, no se acepta nada de
 * él: ni DOI ni revista ni volumen (nunca a medias).
 */
export function evaluarCandidato(doc: Partial<MetadatosDocumento>, cand: Partial<MetadatosDocumento> & { anios?: number[]; isbns?: string[] }): Evaluacion {
  const rechazo = (motivo: string, puntuacion = 0): Evaluacion => ({ acepta: false, puntuacion, motivo });
  const t = compararTitulos(doc, cand.titulo);
  if (t.puntuacion < 0.9) return rechazo(t.motivo ?? 'títulos distintos', t.puntuacion);
  const tipo = compararTipos(doc, cand);
  if (tipo.casa === false) return rechazo(tipo.motivo as string);
  const autores = compararAutores(doc.autores, cand.autores);
  if (autores.casa !== true) return rechazo(autores.motivo ?? 'autores sin pruebas');
  const anio = compararAnios(doc, cand.anios ?? [cand.anio]);
  if (anio.casa !== true) return rechazo(anio.motivo ?? 'año sin pruebas');
  const edicion = compararEdicion(doc, cand);
  if (edicion.casa === false) return rechazo(edicion.motivo as string);
  if (doc.doi && cand.doi && doc.doi.toLowerCase() !== cand.doi.toLowerCase()) return rechazo('otro DOI que el que muestra el documento');
  return { acepta: true, puntuacion: Math.round((0.6 * t.puntuacion + 0.4) * 1000) / 1000 };
}

/**
 * Para los catálogos de obras (Wikidata, Open Library, Google Books): ¿el
 * título es el de la obra? Misma regla que con Crossref (sin reseñas ni
 * estudios ni títulos que contienen el de la obra), con un umbral propio.
 */
export function mismoTitulo(doc: { titulo?: string; subtitulo?: string; autores?: Autor[] } | string | undefined, cand: string | undefined, umbral = 0.9): boolean {
  const d = typeof doc === 'string' ? { titulo: doc } : doc ?? {};
  const t = compararTitulos(d, cand);
  // Un umbral más bajo admite un parecido algo menor, nunca un título que trata de la obra o que la contiene.
  return !t.estructural && t.puntuacion >= umbral;
}

/**
 * Un DOI que muestra el propio documento (impreso o en la ficha del PDF) y que
 * Crossref resuelve: ¿es de este documento o de otro (una referencia, la obra
 * reseñada)? El DOI impreso es una prueba fuerte, así que basta con que el
 * título se parezca y no choquen los autores, o con autor y año.
 */
export function casaConDoiImpreso(doc: Partial<MetadatosDocumento>, reg: Partial<MetadatosDocumento> & { anios?: number[] }): Evaluacion {
  const t = doc.titulo && reg.titulo ? compararTitulos(doc, reg.titulo) : null;
  const tituloCasa = !t || (!t.estructural && t.puntuacion >= 0.6) || similitud(principal(doc.titulo as string), principal(reg.titulo as string)) >= 0.75;
  const d = doc.autores ?? [], c = reg.autores ?? [];
  const algunAutor = d.length && c.length ? d.some((a) => c.some((b) => mismaPersonaCatalogo(a, b))) : null;
  const anio = compararAnios(doc, reg.anios ?? [reg.anio]).casa;
  if ((tituloCasa && algunAutor !== false) || (algunAutor === true && anio === true)) return { acepta: true, puntuacion: 1 };
  return { acepta: false, puntuacion: 0, motivo: !tituloCasa ? `el DOI es de otra obra («${reg.titulo ?? '?'}»)` : 'el DOI es de otra obra (ningún autor en común)' };
}

/** ¿El DOI figura en el texto del documento? (Un DOI que el modelo «lee» y no está en el texto no es un DOI impreso.) */
export function doiEnTexto(doi: string, textos: Array<string | undefined | null>): boolean {
  const d = doi.toLowerCase().replace(/\s+/g, '');
  if (!d) return false;
  const crudo = textos.filter(Boolean).join('\n').toLowerCase();
  // Tal cual, sin espacios y sin el guion de fin de línea («10.1017/CBO97805116-\n05390»).
  return [crudo, crudo.replace(/\s+/g, ''), crudo.replace(/-\s*\n\s*/g, '').replace(/\s+/g, '')].some((t) => t.includes(d));
}
