/** De los tipos de Scholaris a CSL-JSON: documentos → ítems, anclas → localizadores. */
import type { Ancla, Autor, Documento, MetadatosDocumento } from '@scholaris/nucleo';
import { tiempoACadena } from '@scholaris/nucleo';

export type DocumentoCitable = Pick<Documento, 'id' | 'tipo' | 'metadatos'>;

export interface NombreCSL { family?: string; given?: string; literal?: string }
export interface FechaCSL { 'date-parts': number[][] }

/** Ítem CSL-JSON (subconjunto que usamos). */
export interface ItemCSL {
  id: string;
  type: string;
  title?: string;
  'title-short'?: string;
  author?: NombreCSL[];
  editor?: NombreCSL[];
  issued?: FechaCSL;
  'original-date'?: FechaCSL;
  publisher?: string;
  'publisher-place'?: string;
  'container-title'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  ISBN?: string;
  URL?: string;
  language?: string;
  abstract?: string;
  accessed?: FechaCSL;
  [campo: string]: unknown;
}

function nombre(a: Autor): NombreCSL {
  if (!a.nombre && a.apellidos) return /\s/.test(a.apellidos) && !/,/.test(a.apellidos) ? { literal: a.apellidos } : { family: a.apellidos };
  return { family: a.apellidos, given: a.nombre };
}

/** Tipo CSL por defecto según el tipo de entrada. */
export function tipoCSLPorDefecto(tipo: Documento['tipo'], m: MetadatosDocumento): string {
  if (m.tipoCSL) return m.tipoCSL;
  if (m.revista) return 'article-journal';
  switch (tipo) {
    case 'audio': return 'speech';
    case 'video': return 'motion_picture';
    case 'web': return 'webpage';
    case 'presentacion': return 'speech';
    case 'hoja': return 'dataset';
    case 'imagen': case 'fotos': return 'graphic';
    default: return 'book';
  }
}

/** «Sin fecha» según la lengua de la cita. */
const SIN_FECHA: Record<string, string> = { es: 's. f.', en: 'n.d.', fr: 's. d.', it: 's.d.', de: 'o. J.', pt: 's.d.', ca: 's. d.' };

/** Fecha ISO («1977-03-20», «1977-03») → partes CSL; null si no se entiende. */
function partesFecha(iso: string): number[] | null {
  const m = /^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(iso.trim());
  if (!m) return null;
  return [Number(m[1]), ...(m[2] ? [Number(m[2])] : []), ...(m[3] ? [Number(m[3])] : [])];
}

/**
 * MetadatosDocumento → ítem CSL-JSON. `idioma` (el de la cita) solo afecta a
 * lo que CSL no traduce solo: el «s. f.» con horquilla de los impresos sin año.
 */
export function aItemCSL(doc: DocumentoCitable, idioma = 'es'): ItemCSL {
  const m = doc.metadatos;
  const item: ItemCSL = { id: doc.id, type: tipoCSLPorDefecto(doc.tipo, m) };
  item.title = m.subtitulo ? `${m.titulo}: ${m.subtitulo}` : m.titulo;
  if (m.subtitulo) item['title-short'] = m.titulo;
  if (m.tituloOriginal && m.tituloOriginal !== m.titulo) item['original-title'] = m.tituloOriginal;
  if (m.autores.length) item.author = m.autores.map(nombre);
  if (m.editores?.length) item.editor = m.editores.map(nombre);
  if (m.traductores?.length) item.translator = m.traductores.map(nombre);
  if (m.entrevistadores?.length) item.interviewer = m.entrevistadores.map(nombre);
  const fecha = m.fecha ? partesFecha(m.fecha) : null;
  if (fecha && (m.anio === undefined || fecha[0] === m.anio)) item.issued = { 'date-parts': [fecha] };
  else if (m.anio !== undefined) item.issued = { 'date-parts': [[m.anio]] };
  else if (m.anioOriginal !== undefined) item.issued = { 'date-parts': [[m.anioOriginal]] };
  else if (m.sinFecha && (m.sinFecha.desde !== undefined || m.sinFecha.hasta !== undefined)) {
    // Sin año impreso pero con horquilla documentada: «s. f. [1700-1760]», entre corchetes por ser inferida.
    const corto = idioma.slice(0, 2).toLowerCase();
    const sf = SIN_FECHA[corto] ?? SIN_FECHA.es!;
    const guion = corto === 'es' ? '-' : '–';
    const { desde, hasta } = m.sinFecha;
    const rango = desde !== undefined && hasta !== undefined ? (desde === hasta ? `${desde}` : `${desde}${guion}${hasta}`)
      : desde !== undefined ? `${corto === 'es' ? 'después de' : corto === 'en' ? 'after' : '>'} ${desde}` : `${corto === 'es' ? 'antes de' : corto === 'en' ? 'before' : '<'} ${hasta}`;
    item.issued = { literal: `${sf} [${rango}]` } as unknown as FechaCSL;
  }
  if (m.anioOriginal !== undefined && m.anio !== undefined && m.anioOriginal !== m.anio) item['original-date'] = { 'date-parts': [[m.anioOriginal]] };
  if (m.editorial) item.publisher = m.editorial;
  if (m.lugar) item['publisher-place'] = m.lugar;
  // Contenedor: la revista de un artículo, el libro de un capítulo o cuento, el programa de una emisión.
  if (m.revista) item['container-title'] = m.revista;
  else if (m.contenedor && m.contenedor !== m.titulo) item['container-title'] = m.contenedor;
  if (m.edicion) item.edition = m.edicion;
  if (m.coleccion) item['collection-title'] = m.coleccion;
  if (m.volumen) item.volume = m.volumen;
  if (m.numero) item.issue = m.numero;
  if (m.paginas) item.page = m.paginas;
  if (m.doi) item.DOI = m.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (m.isbn) item.ISBN = m.isbn;
  if (m.url) item.URL = m.url;
  if (m.idioma) item.language = m.idioma;
  if (m.resumen) item.abstract = m.resumen;
  return item;
}

export interface Localizador {
  locator?: string;
  label?: string;
  /** Para anclas sin etiqueta CSL (diapositivas, hojas): texto detrás de la cita. */
  suffix?: string;
}

const ETIQUETAS: Record<string, { diap: string; filas: string; parr: string }> = {
  es: { diap: 'diap.', filas: 'filas', parr: 'párr.' },
  en: { diap: 'slide', filas: 'rows', parr: 'para.' },
  fr: { diap: 'diapo.', filas: 'lignes', parr: 'para.' },
  it: { diap: 'diapositiva', filas: 'righe', parr: 'par.' },
};

/** Ancla (y ancla final) → localizador CSL. El folio es el impreso; si no lo hay, la página física entre corchetes. */
export function localizador(ancla: Ancla | undefined, fin?: Ancla, idioma = 'es'): Localizador {
  if (!ancla) return {};
  const e = ETIQUETAS[idioma.slice(0, 2)] ?? ETIQUETAS.es!;
  // Intervalos: guion en español (DPD), semirraya en el resto.
  const guion = idioma.startsWith('es') ? '-' : '–';
  switch (ancla.tipo) {
    case 'pagina': {
      const a = ancla.impresa ?? `[${ancla.fisica}]`;
      const b = fin?.tipo === 'pagina' ? fin.impresa ?? `[${fin.fisica}]` : undefined;
      return { locator: b && b !== a ? `${a}${guion}${b}` : a, label: 'page' };
    }
    case 'tiempo': {
      const t = tiempoACadena(ancla.t0);
      const f = fin?.tipo === 'tiempo' ? tiempoACadena(fin.t1) : undefined;
      return { locator: f && f !== t ? `${t}${guion}${f}` : t, label: 'timestamp' };
    }
    case 'seccion':
      if (ancla.impresa) return { locator: ancla.impresa, label: 'page' };
      return { locator: String(ancla.parrafo), label: 'paragraph' };
    case 'web':
      return { locator: String(ancla.parrafo), label: 'paragraph' };
    case 'diapositiva':
      return { suffix: `, ${e.diap} ${ancla.n}` };
    case 'hoja':
      return { suffix: `, ${ancla.hoja}, ${e.filas} ${ancla.filaDesde}-${ancla.filaHasta}` };
    case 'imagen':
      return {};
  }
}
