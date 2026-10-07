/**
 * Fuentes abiertas, una función por catálogo. Cada una devuelve lo que sabe
 * en forma de `Hallazgo` y nunca lanza: sin red, sin resultado o con un
 * registro que no casa, devuelve null.
 *
 * Distinción clave: un catálogo de OBRAS (Wikidata, Open Library «work»,
 * Wikipedia) habla del año de la obra → `anioOriginal`; un registro de la
 * EDICIÓN (el ISBN impreso en el libro, el colofón) habla del año de la
 * edición → `anio`.
 */

import type { Autor, FuenteMetadato, MetadatosDocumento } from '@scholaris/nucleo';
import { normalizar, similitud } from '../texto.js';
import { autorDe, claveAutor } from '../pasos/metadatos/nombres.js';
import { mismoTitulo } from '../pasos/metadatos/identidad.js';
import type { Consultor } from './red.js';

/** Lo que el documento dice de sí mismo, para comprobar que un registro de catálogo es de esta obra y esta edición. */
export interface ObraLeida {
  titulo?: string;
  subtitulo?: string;
  tituloOriginal?: string;
  autores?: Autor[];
  /** Año de la edición que se tiene delante. */
  anio?: number;
}

export type CampoMeta = Exclude<keyof MetadatosDocumento, 'procedencia'>;

export interface Hallazgo {
  fuente: FuenteMetadato;
  /** Confianza base del hallazgo. */
  confianza: number;
  /** Confianza por campo cuando difiere de la base. */
  porCampo?: Partial<Record<CampoMeta, number>>;
  datos: Partial<MetadatosDocumento>;
  /** Registro de origen (URL o identificador), para la procedencia. */
  id?: string;
  /** Campos que este hallazgo deja sin valor (p. ej., el subtítulo «Entrevista a…» al poner el título del episodio). */
  anula?: CampoMeta[];
  /** Datos de control que no van a la ficha. */
  control?: { nacimientoAutor?: number; muerteAutor?: number; desde?: number; hasta?: number; autorQid?: string; articulo?: string; articuloEn?: string; forma?: string };
}

const anioDeFecha = (s: unknown): number | undefined => {
  const m = typeof s === 'string' ? /^[+-]?(\d{3,4})/.exec(s) : null;
  return m ? Number(m[1]) : undefined;
};

/** ¿Casan los títulos? Admite «Título: subtítulo» y artículos iniciales. */
export function titulosCasan(a: string | undefined, b: string | undefined, umbral = 0.85): boolean {
  if (!a || !b) return false;
  const x = normalizar(a), y = normalizar(b);
  if (!x || !y) return false;
  if (similitud(x, y) >= umbral) return true;
  const principal = (s: string) => s.split(/\s*[:.]\s+/)[0] ?? s;
  if (similitud(normalizar(principal(a)), normalizar(principal(b))) >= umbral && Math.min(x.length, y.length) >= 6) return true;
  return (x.startsWith(y) || y.startsWith(x)) && Math.min(x.length, y.length) >= 12;
}

/** ¿Algún autor en común? Sin autores en un lado, «quizá» (null). */
export function autoresCasan(a: Autor[] | undefined, b: Autor[] | undefined): boolean | null {
  if (!a?.length || !b?.length) return null;
  const ka = new Set(a.map((x) => claveAutor(x).split('|')[0]));
  return b.some((x) => ka.has(claveAutor(x).split('|')[0]));
}

// ---------------------------------------------------------------------------
// Open Library
// ---------------------------------------------------------------------------

interface DocOL { key?: string; title?: string; subtitle?: string; author_name?: string[]; first_publish_year?: number; publisher?: string[]; publish_place?: string[]; language?: string[] }
interface EdicionOL {
  title?: string; subtitle?: string; publishers?: string[]; publish_date?: string; publish_places?: string[]; edition_name?: string; series?: string[];
  translated_from?: Array<{ key?: string }>; translation_of?: string; contributions?: string[]; by_statement?: string; works?: Array<{ key?: string }>;
  languages?: Array<{ key?: string }>; key?: string;
}

const MARC_A_BCP: Record<string, string> = { eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', lat: 'la', cat: 'ca', rus: 'ru', grc: 'grc', gre: 'el', dut: 'nl', jpn: 'ja', chi: 'zh' };

/**
 * ¿El registro de un ISBN es de esta obra? Un ISBN impreso puede ser el del
 * original (en una traducción), el de otro volumen de la colección o el de otra
 * obra: si el título del registro no es el del documento, no se usa nada de él.
 */
function esLaMismaEdicion(doc: ObraLeida | undefined, titulo: string | undefined, subtitulo?: string): boolean {
  if (!doc?.titulo || !titulo) return true;
  const completo = subtitulo ? `${titulo}: ${subtitulo}` : titulo;
  return mismoTitulo(doc, titulo, 0.85) || mismoTitulo(doc, completo, 0.85);
}

/** Open Library por ISBN: la edición (año, editorial, lugar) y la obra (primer año), si son de este documento. */
export async function openLibraryPorIsbn(isbn: string, red: Consultor, idioma?: string, doc?: ObraLeida): Promise<Hallazgo[]> {
  const salida: Hallazgo[] = [];
  const [ed, busca] = await Promise.all([
    red.json<EdicionOL>(`https://openlibrary.org/isbn/${isbn}.json`),
    red.json<{ docs?: DocOL[] }>(`https://openlibrary.org/search.json?isbn=${isbn}&fields=key,title,subtitle,author_name,first_publish_year,language&limit=1`),
  ]);
  // El ISBN es de otra obra (o del original de una traducción): nada de este registro.
  if (ed?.title && !esLaMismaEdicion(doc, ed.title, ed.subtitle)) return [];
  if (ed && (ed.title || ed.publishers)) {
    const d: Partial<MetadatosDocumento> = { isbn };
    const anio = anioDeFecha(ed.publish_date?.match(/\d{4}/)?.[0]);
    if (anio) d.anio = anio;
    if (ed.publishers?.[0]) d.editorial = ed.publishers[0];
    if (ed.publish_places?.[0]) d.lugar = ed.publish_places[0].replace(/[\s[\]:;,]+$/g, '').replace(/^\[|\]$/g, '');
    if (ed.edition_name) d.edicion = ed.edition_name;
    if (ed.series?.[0]) d.coleccion = ed.series[0].replace(/\s*;\s*\d+\s*$/, '');
    if (ed.translation_of) d.tituloOriginal = ed.translation_of;
    const origen = ed.translated_from?.[0]?.key?.split('/').pop();
    if (origen && MARC_A_BCP[origen]) d.idiomaOriginal = MARC_A_BCP[origen];
    const trad = (ed.contributions ?? []).filter((x) => /translat|traduc/i.test(x)).map((x) => autorDe(x.replace(/\s*\(.*\)|,?\s*(translator|traductor|tr\.).*$/i, ''), idioma));
    if (trad.length) d.traductores = trad;
    salida.push({ fuente: 'openlibrary', confianza: 0.85, porCampo: { editorial: 0.8, lugar: 0.75, coleccion: 0.7 }, datos: d, id: `https://openlibrary.org${ed.key ?? `/isbn/${isbn}`}` });
  }
  const obra = busca?.docs?.[0];
  const autoresObra = (obra?.author_name ?? []).map((n) => autorDe(n, idioma));
  // La obra tiene que ser la misma (título y autor) y, antes del XIX, Open Library cataloga ediciones sueltas, no la primera.
  if (obra?.first_publish_year && esLaMismaEdicion(doc, obra.title, obra.subtitle) && autoresCasan(doc?.autores, autoresObra) !== false && obra.first_publish_year >= 1830) {
    const d: Partial<MetadatosDocumento> = { anioOriginal: obra.first_publish_year };
    if (autoresObra.length) d.autores = autoresObra;
    if (obra.title) d.titulo = obra.title;
    // first_publish_year es el mínimo de las ediciones que tiene catalogadas: bueno, no infalible.
    salida.push({ fuente: 'openlibrary', confianza: 0.7, datos: d, id: `https://openlibrary.org${obra.key ?? ''}` });
  }
  return salida;
}

/** Open Library por título y autor: solo el año de la obra. */
export async function openLibraryObra(titulo: string, autores: Autor[], red: Consultor, idioma?: string, leida: ObraLeida = {}): Promise<Hallazgo | null> {
  const autor = autores[0]?.apellidos ?? '';
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(titulo)}${autor ? `&author=${encodeURIComponent(autor)}` : ''}&fields=key,title,subtitle,author_name,first_publish_year,language&limit=5`;
  const j = await red.json<{ docs?: DocOL[] }>(url);
  for (const doc of j?.docs ?? []) {
    // El mismo título, no uno que trata de la obra o la contiene («Notes on…», «… y la crítica»).
    if (!doc.first_publish_year || !mismoTitulo({ ...leida, titulo, autores }, doc.title, 0.85)) continue;
    // Antes del XIX, Open Library cataloga ediciones concretas (una suelta de 1700), no la primera de la obra.
    if (doc.first_publish_year < 1830) continue;
    // La obra no puede ser posterior a la edición que se tiene delante.
    if (leida.anio !== undefined && doc.first_publish_year > leida.anio + 1) continue;
    const ext = (doc.author_name ?? []).map((n) => autorDe(n, idioma));
    const casa = autoresCasan(autores, ext);
    if (casa === false) continue;
    return { fuente: 'openlibrary', confianza: casa ? 0.72 : 0.55, datos: { anioOriginal: doc.first_publish_year }, id: `https://openlibrary.org${doc.key ?? ''}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Google Books (sin clave; con frecuencia sin cuota: es solo el último recurso)
// ---------------------------------------------------------------------------

export async function googleBooksPorIsbn(isbn: string, red: Consultor, idioma?: string, doc?: ObraLeida): Promise<Hallazgo | null> {
  const j = await red.json<{ items?: Array<{ id?: string; volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; language?: string } }> }>(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
  const v = j?.items?.[0]?.volumeInfo;
  if (!v || !esLaMismaEdicion(doc, v.title, v.subtitle)) return null;
  const d: Partial<MetadatosDocumento> = { isbn };
  const a = anioDeFecha(v.publishedDate);
  if (a) d.anio = a;
  if (v.publisher) d.editorial = v.publisher;
  if (v.title) d.titulo = v.title;
  if (v.authors?.length) d.autores = v.authors.map((n) => autorDe(n, idioma));
  return { fuente: 'googlebooks', confianza: 0.7, porCampo: { titulo: 0.6, autores: 0.6 }, datos: d, id: `https://books.google.com/books?id=${j?.items?.[0]?.id ?? ''}` };
}

// ---------------------------------------------------------------------------
// Wikidata (+ Wikipedia para «incluido en…»)
// ---------------------------------------------------------------------------

interface FilaSparql { [k: string]: { value: string } | undefined }

async function sparql(consulta: string, red: Consultor): Promise<FilaSparql[]> {
  const j = await red.json<{ results?: { bindings?: FilaSparql[] } }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(consulta)}`, { Accept: 'application/sparql-results+json' });
  return j?.results?.bindings ?? [];
}

const qid = (uri: string | undefined) => uri?.split('/').pop() ?? '';

export interface EntidadWikidata {
  id: string;
  etiqueta: string;
  descripcion?: string;
  anio?: number;
  inicio?: number;
  fin?: number;
  idioma?: string;
  autores: Array<{ id: string; nombre: string; nacimiento?: number; muerte?: number }>;
  parteDe?: { id: string; etiqueta: string; anio?: number };
  forma?: string;
  clase?: string;
  red?: string;
  propietarios: string[];
  presentadores: string[];
  articuloEs?: string;
  articuloEn?: string;
}

/** Busca entidades por nombre y trae lo que importa para fechar. */
export async function wikidataBuscar(texto: string, red: Consultor, idioma = 'es', limite = 6): Promise<EntidadWikidata[]> {
  const busca = await red.json<{ search?: Array<{ id: string; label?: string; description?: string }> }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=${idioma.slice(0, 2)}&uselang=${idioma.slice(0, 2)}&type=item&limit=${limite}&search=${encodeURIComponent(texto)}`,
  );
  // Las ediciones concretas («1978 edition of…») no son la obra.
  const ids = (busca?.search ?? []).filter((x) => !/\bedition of\b|^edici[óo]n de\b|\bversion of\b/i.test(x.description ?? '')).map((x) => x.id);
  if (!ids.length) return [];
  const descripciones = new Map((busca?.search ?? []).map((x) => [x.id, x.description]));
  const filas = await sparql(`SELECT ?item ?itemLabel ?fecha ?creado ?inicio ?fin ?lengua ?autor ?autorLabel ?nac ?muerte ?parte ?parteLabel ?fparte ?forma ?formaLabel ?clase ?claseLabel ?red ?redLabel ?dueno ?duenoLabel ?pres ?presLabel ?artEs ?artEn WHERE {
  VALUES ?item { ${ids.map((i) => `wd:${i}`).join(' ')} }
  OPTIONAL { ?item wdt:P577 ?fecha } OPTIONAL { ?item wdt:P571 ?creado }
  OPTIONAL { ?item wdt:P580 ?inicio } OPTIONAL { ?item wdt:P582 ?fin }
  OPTIONAL { ?item wdt:P407|wdt:P364 ?l . ?l wdt:P218 ?lengua }
  OPTIONAL { ?item wdt:P50 ?autor . OPTIONAL { ?autor wdt:P569 ?nac } OPTIONAL { ?autor wdt:P570 ?muerte } }
  OPTIONAL { ?item wdt:P361|wdt:P1433 ?parte . OPTIONAL { ?parte wdt:P577 ?fparte } }
  OPTIONAL { ?item wdt:P7937 ?forma } OPTIONAL { ?item wdt:P31 ?clase }
  OPTIONAL { ?item wdt:P449 ?red . OPTIONAL { ?red wdt:P127|wdt:P749 ?dueno } }
  OPTIONAL { ?item wdt:P371 ?pres }
  OPTIONAL { ?artEs schema:about ?item ; schema:isPartOf <https://es.wikipedia.org/> }
  OPTIONAL { ?artEn schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${idioma.slice(0, 2)},es,en". }
} LIMIT 400`, red);
  const porId = new Map<string, EntidadWikidata>();
  for (const f of filas) {
    const id = qid(f.item?.value);
    let e = porId.get(id);
    if (!e) {
      e = { id, etiqueta: f.itemLabel?.value ?? '', autores: [], propietarios: [], presentadores: [], ...(descripciones.get(id) ? { descripcion: descripciones.get(id) as string } : {}) };
      porId.set(id, e);
    }
    const anio = anioDeFecha(f.fecha?.value) ?? anioDeFecha(f.creado?.value);
    if (anio && (!e.anio || anio < e.anio)) e.anio = anio;
    const ini = anioDeFecha(f.inicio?.value), fin = anioDeFecha(f.fin?.value);
    if (ini) e.inicio = Math.min(e.inicio ?? ini, ini);
    if (fin) e.fin = Math.max(e.fin ?? fin, fin);
    if (f.lengua?.value) e.idioma ??= f.lengua.value;
    if (f.autor?.value && !e.autores.some((a) => a.id === qid(f.autor?.value))) {
      const nac = anioDeFecha(f.nac?.value), muerte = anioDeFecha(f.muerte?.value);
      e.autores.push({ id: qid(f.autor.value), nombre: f.autorLabel?.value ?? '', ...(nac ? { nacimiento: nac } : {}), ...(muerte ? { muerte } : {}) });
    }
    if (f.parte?.value && !e.parteDe) {
      const ap = anioDeFecha(f.fparte?.value);
      e.parteDe = { id: qid(f.parte.value), etiqueta: f.parteLabel?.value ?? '', ...(ap ? { anio: ap } : {}) };
    }
    if (f.formaLabel?.value) e.forma ??= f.formaLabel.value;
    if (f.claseLabel?.value) e.clase ??= f.claseLabel.value;
    if (f.redLabel?.value) e.red ??= f.redLabel.value;
    if (f.duenoLabel?.value && !e.propietarios.includes(f.duenoLabel.value)) e.propietarios.push(f.duenoLabel.value);
    if (f.presLabel?.value && !e.presentadores.includes(f.presLabel.value)) e.presentadores.push(f.presLabel.value);
    if (f.artEs?.value) e.articuloEs ??= f.artEs.value;
    if (f.artEn?.value) e.articuloEn ??= f.artEn.value;
  }
  return ids.map((i) => porId.get(i)).filter((x): x is EntidadWikidata => Boolean(x));
}

const ES_PROGRAMA = /programa|television|televisi[óo]n|tv |serie de televisi|talk show|radio|podcast|p[óo]dcast|show/i;
/** Lo que no es la obra aunque se llame igual: artículos y reseñas sobre ella, ediciones, tesis, desambiguaciones. */
const NO_ES_LA_OBRA = /scholarly (article|work)|journal article|art[íi]culo (cient[íi]fico|acad[ée]mico|de revista)|\breview\b|rese[ñn]a|version, edition|versi[óo]n, edici[óo]n|\bedition\b|\bedici[óo]n\b|doctoral thesis|\bthesis\b|\btesis\b|disambiguation|desambiguaci[óo]n|encyclopedi[ac] (article|entry)|art[íi]culo de enciclopedia/i;

/** La obra en Wikidata: año de la primera publicación, lengua original, contenedor. */
export async function wikidataObra(titulo: string, autores: Autor[], red: Consultor, idioma?: string, leida: ObraLeida = {}): Promise<Hallazgo | null> {
  const ents = await wikidataBuscar(titulo, red, idioma ?? 'es');
  for (const e of ents) {
    // El mismo título, no uno que trata de la obra o la contiene.
    if (!mismoTitulo({ ...leida, titulo, autores }, e.etiqueta, 0.85)) continue;
    if (ES_PROGRAMA.test(`${e.clase ?? ''} ${e.descripcion ?? ''}`)) continue;
    if (NO_ES_LA_OBRA.test(`${e.clase ?? ''} ${e.descripcion ?? ''}`)) continue;
    // La obra no puede ser posterior a la edición que se tiene delante.
    if (e.anio !== undefined && leida.anio !== undefined && e.anio > leida.anio + 1) continue;
    const ext = e.autores.map((a) => autorDe(a.nombre, idioma));
    const casa = autoresCasan(autores, ext);
    if (casa === false || (casa === null && !ext.length)) continue;
    const d: Partial<MetadatosDocumento> = {};
    if (e.anio) d.anioOriginal = e.anio;
    if (e.idioma) d.idiomaOriginal = e.idioma;
    if (e.parteDe?.etiqueta) d.contenedor = e.parteDe.etiqueta;
    const nac = Math.min(...e.autores.map((a) => a.nacimiento ?? Infinity));
    const muerte = Math.max(...e.autores.map((a) => a.muerte ?? -Infinity));
    return {
      fuente: 'wikidata', confianza: casa ? 0.88 : 0.6, datos: d, id: `https://www.wikidata.org/wiki/${e.id}`,
      control: {
        ...(Number.isFinite(nac) ? { nacimientoAutor: nac } : {}), ...(Number.isFinite(muerte) ? { muerteAutor: muerte } : {}),
        ...(e.autores[0] ? { autorQid: e.autores[0].id } : {}), ...(e.articuloEs ? { articulo: e.articuloEs } : {}), ...(e.articuloEn ? { articuloEn: e.articuloEn } : {}),
        ...(e.forma ? { forma: e.forma } : {}),
      },
    };
  }
  return null;
}

/**
 * «Fue publicado en 1959 e incluido en su colección Las armas secretas»: busca,
 * en la entradilla de Wikipedia, qué otra obra del MISMO autor la contiene.
 */
export async function wikipediaContenedor(articulo: string, autorQid: string, tituloObra: string, red: Consultor, autoresObra: Autor[] = []): Promise<Hallazgo | null> {
  const m = /^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/.exec(articulo);
  if (!m) return null;
  const [, lengua, pagina] = m;
  const [intro, obras] = await Promise.all([
    red.json<{ query?: { pages?: Record<string, { extract?: string }> } }>(`https://${lengua}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=${pagina}`),
    sparql(`SELECT ?w ?wLabel ?f WHERE { ?w wdt:P50 wd:${autorQid} . OPTIONAL { ?w wdt:P577 ?f } SERVICE wikibase:label { bd:serviceParam wikibase:language "${lengua},es,en". } } LIMIT 600`, red),
  ]);
  const texto = Object.values(intro?.query?.pages ?? {})[0]?.extract ?? '';
  if (!texto || !obras.length) return null;
  const t = normalizar(texto);
  const pista = /(incluid|recogid|publicad|aparecid|colecci|libro|volumen|antolog|included|collected|collection|published in|recueil|raccolta)/;
  const excluir = autoresObra.map((a) => normalizar(`${a.nombre} ${a.apellidos}`));
  let mejor: { etiqueta: string; anio?: number } | null = null;
  for (const f of obras) {
    const etiqueta = f.wLabel?.value ?? '';
    const n = normalizar(etiqueta);
    if (n.length < 4 || /^q\d+$/.test(n) || titulosCasan(etiqueta, tituloObra, 0.9)) continue;
    // Una «obra» que se llama como el autor (antologías sin título) no sirve.
    if (excluir.some((x) => x && (x === n || x.endsWith(n) || n.endsWith(x)))) continue;
    // En alguna aparición tiene que estar cerca de una palabra que hable de inclusión o publicación.
    let cerca = false;
    for (let pos = t.indexOf(n); pos >= 0 && !cerca; pos = t.indexOf(n, pos + 1)) cerca = pista.test(t.slice(Math.max(0, pos - 120), pos + n.length + 20));
    if (!cerca) continue;
    const anio = anioDeFecha(f.f?.value);
    const igual = mejor && normalizar(mejor.etiqueta) === n;
    if (igual && anio && (!mejor!.anio || anio < mejor!.anio)) mejor = { etiqueta, anio };
    else if (!mejor || (!igual && n.length > normalizar(mejor.etiqueta).length)) mejor = { etiqueta, ...(anio ? { anio } : {}) };
  }
  if (!mejor) return null;
  const d: Partial<MetadatosDocumento> = { contenedor: mejor.etiqueta };
  if (mejor.anio) d.anioOriginal = mejor.anio;
  const porCampo: Hallazgo['porCampo'] = { anioOriginal: 0.75 };
  // La primera edición del libro que la contiene (ficha de Wikipedia): editorial, año y sede de la editorial.
  const ficha = await fichaDeLibro(lengua as string, mejor.etiqueta, red);
  if (ficha?.anio && !d.anioOriginal) d.anioOriginal = ficha.anio;
  if (ficha?.editorial) {
    // Sin pruebas de la edición que se tiene delante, se cita la primera: confianza moderada (un colofón la pisa).
    d.editorial = ficha.editorial; porCampo.editorial = 0.7;
    if (ficha.lugar) { d.lugar = ficha.lugar; porCampo.lugar = 0.65; }
  }
  return { fuente: 'wikipedia', confianza: 0.8, porCampo, datos: d, id: articulo };
}

/** Ficha de libro de Wikipedia (sección 0): editorial, año de publicación y la sede de la editorial (Wikidata P159). */
export async function fichaDeLibro(lengua: string, titulo: string, red: Consultor): Promise<{ editorial?: string; anio?: number; lugar?: string } | null> {
  const j = await red.json<{ parse?: { wikitext?: { '*'?: string } } }>(`https://${lengua}.wikipedia.org/w/api.php?action=parse&prop=wikitext&section=0&redirects=1&format=json&page=${encodeURIComponent(titulo.replace(/ /g, '_'))}`);
  const w = j?.parse?.wikitext?.['*'];
  if (!w) return null;
  const campo = (...nombres: string[]) => {
    for (const n of nombres) {
      const m = new RegExp(String.raw`\|\s*${n}\s*=\s*([^\n|][^\n]*)`, 'i').exec(w);
      if (m && (m[1] as string).trim()) return (m[1] as string).trim();
    }
    return undefined;
  };
  const enlace = (v?: string) => (v ? /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(v) : null);
  const crudoEd = campo('editorial', 'publisher', 'éditeur', 'editore');
  const e = enlace(crudoEd);
  const editorial = (e ? (e[2] ?? e[1]) : crudoEd)?.replace(/\{\{[^}]*\}\}|<[^>]+>|\[\[|\]\]/g, '').trim();
  const anio = anioDeFecha((campo('fecha_publicacion', 'fecha de publicación', 'publicación', 'published', 'pub_date', 'release_date', 'first_published') ?? '').match(/\b(1[4-9]\d{2}|20\d{2})\b/)?.[1]);
  let lugar: string | undefined;
  if (e?.[1]) {
    const ent = await red.json<{ entities?: Record<string, { claims?: { P159?: Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }> } }> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=${lengua}wiki&titles=${encodeURIComponent(e[1].replace(/ /g, '_'))}&props=claims&format=json`);
    const sede = Object.values(ent?.entities ?? {})[0]?.claims?.P159?.[0]?.mainsnak?.datavalue?.value?.id;
    if (sede) {
      const l = await red.json<{ entities?: Record<string, { labels?: Record<string, { value?: string }> }> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${sede}&props=labels&languages=${lengua}|es|en&format=json`);
      const labels = l?.entities?.[sede]?.labels ?? {};
      lugar = labels[lengua]?.value ?? labels.es?.value ?? labels.en?.value;
    }
  }
  if (!editorial && !anio) return null;
  return { ...(editorial ? { editorial } : {}), ...(anio ? { anio } : {}), ...(lugar ? { lugar } : {}) };
}

/** Un programa de radio o televisión: cadena, presentador y años en antena. */
export async function wikidataPrograma(titulo: string, autores: Autor[], red: Consultor, idioma = 'es'): Promise<Hallazgo | null> {
  const ents = await wikidataBuscar(titulo, red, idioma);
  for (const e of ents) {
    if (!titulosCasan(titulo, e.etiqueta, 0.9)) continue;
    if (!ES_PROGRAMA.test(`${e.clase ?? ''} ${e.descripcion ?? ''}`)) continue;
    const presentadores = e.presentadores.map((p) => autorDe(p, 'es'));
    // Si el presentador no figura entre los autores (solo se oyó al invitado), vale igual, con menos confianza.
    const casa = autoresCasan(autores, presentadores);
    const d: Partial<MetadatosDocumento> = { contenedor: e.etiqueta, tipoCSL: 'broadcast' };
    // El dueño de la cadena («RTVE») antes que la cadena de hoy («La 1»): es quien emite en el archivo.
    const editorial = [...e.propietarios].sort((a, b) => a.length - b.length)[0] ?? e.red;
    if (editorial) d.editorial = editorial;
    if (presentadores.length) d.autores = presentadores;
    return {
      // Que es un programa de televisión y quién lo emite lo dice el catálogo con seguridad, aunque el reparto no case.
      fuente: 'wikidata', confianza: casa ? 0.9 : 0.75, porCampo: { tipoCSL: 0.9, contenedor: 0.9, editorial: 0.9 }, datos: d, id: `https://www.wikidata.org/wiki/${e.id}`,
      control: { ...(e.inicio ? { desde: e.inicio } : {}), ...(e.fin ? { hasta: e.fin } : {}) },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// arXiv y DataCite
// ---------------------------------------------------------------------------

/** arXiv por título: el identificador, si el título casa. */
export async function arxivPorTitulo(titulo: string, red: Consultor): Promise<string | null> {
  const limpio = titulo.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const xml = await red.texto(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`ti:"${limpio}"`)}&max_results=5`);
  if (!xml) return null;
  for (const entrada of xml.split('<entry>').slice(1)) {
    const t = /<title>([\s\S]*?)<\/title>/.exec(entrada)?.[1]?.replace(/\s+/g, ' ').trim();
    const id = /<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(?:v\d+)?<\/id>/.exec(entrada)?.[1];
    if (id && titulosCasan(titulo, t, 0.92)) return id;
  }
  return null;
}

interface AtributosDataCite {
  titles?: Array<{ title?: string }>; creators?: Array<{ name?: string; givenName?: string; familyName?: string; nameType?: string; nameIdentifiers?: Array<{ nameIdentifier?: string; nameIdentifierScheme?: string }> }>;
  publicationYear?: number; publisher?: string | { name?: string }; types?: { resourceTypeGeneral?: string; citeproc?: string }; url?: string; language?: string; doi?: string;
  descriptions?: Array<{ description?: string; descriptionType?: string }>;
}

const TIPOS_DATACITE: Record<string, string> = { Preprint: 'article', JournalArticle: 'article-journal', Book: 'book', BookChapter: 'chapter', ConferencePaper: 'paper-conference', Dissertation: 'thesis', Report: 'report', Dataset: 'dataset', Software: 'software', Audiovisual: 'motion_picture', Text: 'document' };

/** DataCite: DOIs que no son de Crossref (arXiv 10.48550, Zenodo, repositorios). */
export async function datacite(doi: string, red: Consultor): Promise<Hallazgo | null> {
  const j = await red.json<{ data?: { attributes?: AtributosDataCite } }>(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
  const a = j?.data?.attributes;
  if (!a) return null;
  const d: Partial<MetadatosDocumento> = { doi: doi.toLowerCase() };
  if (a.titles?.[0]?.title) d.titulo = a.titles[0].title;
  if (a.creators?.length) {
    d.autores = a.creators.map((c) => {
      const orcid = c.nameIdentifiers?.find((n) => /orcid/i.test(n.nameIdentifierScheme ?? ''))?.nameIdentifier?.replace(/^https?:\/\/orcid\.org\//, '');
      const base: Autor = c.nameType === 'Organizational' ? { nombre: '', apellidos: c.name ?? '' } : c.familyName ? { nombre: c.givenName ?? '', apellidos: c.familyName } : autorDe(c.name ?? '');
      return orcid ? { ...base, orcid } : base;
    });
  }
  if (a.publicationYear) d.anio = Number(a.publicationYear);
  const editorial = typeof a.publisher === 'string' ? a.publisher : a.publisher?.name;
  if (editorial) d.editorial = editorial;
  const tipo = a.types?.resourceTypeGeneral;
  if (tipo && TIPOS_DATACITE[tipo]) d.tipoCSL = TIPOS_DATACITE[tipo];
  if (a.url) d.url = a.url;
  // «Accepted at NeurIPS 2017», «ICML 2019»: el congreso donde salió el preprint.
  const notas = (a.descriptions ?? []).map((x) => x.description ?? '').join(' ');
  const congreso = /\b(NeurIPS|NIPS|ICML|ICLR|ACL|EMNLP|NAACL|EACL|COLING|CVPR|ICCV|ECCV|AAAI|IJCAI|KDD|SIGIR|WWW|CHI|INTERSPEECH|ICASSP)\s*'?(\d{4}|\d{2})\b/.exec(notas);
  if (congreso) { d.contenedor = `${congreso[1]} ${congreso[2]!.length === 2 ? `20${congreso[2]}` : congreso[2]}`; d.tipoCSL = 'paper-conference'; }
  return { fuente: 'datacite', confianza: 0.85, porCampo: { tipoCSL: 0.6, contenedor: 0.75 }, datos: d, id: `https://doi.org/${doi}` };
}

/** arXiv: identificador → hallazgo vía su DOI de DataCite (JSON, sin XML). */
export async function arxivPorId(id: string, red: Consultor): Promise<Hallazgo | null> {
  const h = await datacite(`10.48550/arxiv.${id.toLowerCase()}`, red);
  if (!h) return null;
  return { ...h, fuente: 'arxiv', datos: { ...h.datos, url: `https://arxiv.org/abs/${id}` }, id: `https://arxiv.org/abs/${id}` };
}

/** OpenAlex: ORCID de los autores de una obra con DOI. */
export async function openAlexOrcid(doi: string, red: Consultor): Promise<Map<string, string>> {
  const j = await red.json<{ authorships?: Array<{ author?: { display_name?: string; orcid?: string | null } }> }>(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(red.correo)}`);
  const m = new Map<string, string>();
  for (const a of j?.authorships ?? []) {
    if (!a.author?.orcid || !a.author.display_name) continue;
    m.set(claveAutor(autorDe(a.author.display_name)), a.author.orcid.replace(/^https?:\/\/orcid\.org\//, ''));
  }
  return m;
}

export { anioDeFecha };
