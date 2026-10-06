/**
 * Paso de metadatos.
 *
 * 1. Candidatos sin red: la ficha del archivo (Info/XMP del PDF, OPF del EPUB),
 *    el nombre del archivo (solo si no es basura) y el DOI del texto.
 * 2. Lectura: un Redactor lee las primeras páginas (o el principio de la
 *    transcripción) y devuelve los campos en JSON.
 * 3. Verificación: Crossref por DOI; si no hay, búsqueda bibliográfica en
 *    Crossref y OpenAlex (gratis, sin clave). Solo se acepta un registro externo
 *    si el título coincide y el autor o el año también.
 * 4. Enriquecimiento consciente de la edición (../enriquecimiento): créditos y
 *    colofón, ISBN → Open Library, Wikidata y Wikipedia para la obra, arXiv,
 *    DataCite, programas de radio y televisión, impresores de impresos sin fecha.
 * 5. Fusión campo a campo, con procedencia y confianza por campo. Lo que editó
 *    el usuario no se toca nunca. `anio` = esta edición; `anioOriginal` = la obra.
 */

import type { Autor, FuenteMetadato, MetadatosDocumento, Redactor } from '@scholaris/nucleo';
import type { MetadatosIncrustados } from '@scholaris/imprenta';
import type { Http, Procedencia, UnidadLeida } from '../tipos.js';
import { normalizar, similitud } from '../texto.js';
import { nombreCompleto, partirAutores, separarNombre } from './autores.js';
import { conOrcid, crearConsultor, enriquecer, leerColofon, pruebasNuevas, type CacheConsultas, type Colofon, type Consultor } from '../enriquecimiento/index.js';
import { autorDe } from './metadatos/nombres.js';

export * from '../enriquecimiento/index.js';
export { autorDe, esEntidad, claveAutor } from './metadatos/nombres.js';

type Fuente = FuenteMetadato;
type Campo = Exclude<keyof MetadatosDocumento, 'procedencia'>;

export interface Candidato {
  fuente: Fuente;
  /** Confianza base de la fuente. */
  confianza: number;
  /** Confianza por campo, si difiere de la base. */
  porCampo?: Partial<Record<Campo, number>>;
  /** Campos que este candidato deja vacíos si tiene más confianza que el que los trae. */
  anula?: Campo[];
  datos: Partial<MetadatosDocumento>;
}

// ---------------------------------------------------------------------------
// Limpieza
// ---------------------------------------------------------------------------

/** ¿Este «título» es en realidad un nombre de archivo o basura de la ficha? */
export function esTituloBasura(t: string | undefined | null): boolean {
  if (!t) return true;
  const s = t.trim();
  if (s.length < 3) return true;
  if (/\.(pdf|docx?|epub|mobi|djvu|txt|mp[34]|m4a|wav|mov|tex|indd|qxd)$/i.test(s)) return true;
  if (/z[-_ ]?library|1lib|libgen|annas?[-_ ]archive|b-ok\.|dokumen\.pub|pdfdrive|epdf\.pub/i.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) || /^[0-9a-f]{16,}$/i.test(s)) return true;
  if (/^(microsoft word|untitled|sin título|document|documento|presentation|layout|copia de|scan|escaneo|img|dsc)[\s\d_-]*/i.test(s) && s.split(/\s+/).length <= 4) return true;
  if (/^microsoft word - /i.test(s)) return true;
  // Claves del almacén y títulos genéricos: «original», «paquete», «Entrevista», «Conferencia», «Vídeo».
  if (/^(original|paquete|archivo|fichero|file|blob|upload|subida|entrevista|interview|conferencia|charla|lecture|programa|episodio|episode|v[íi]deo|video|audio|grabaci[óo]n|recording|transcripci[óo]n|libro|book|art[íi]culo|article|texto|text|pdf)(\.\w{2,4})?$/i.test(s)) return true;
  if ((s.match(/_/g)?.length ?? 0) >= 2 && !s.includes(' ')) return true;
  if (/^[\d\s._-]+$/.test(s)) return true;
  return false;
}

/** Título a partir del nombre de archivo, solo como último recurso. */
export function tituloDeArchivo(nombre: string): string | null {
  const base = nombre.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').replace(/\s*\b(z library|1lib|libgen|sk)\b.*$/i, '').replace(/\s+/g, ' ').trim();
  if (!base || /^[0-9a-f-]{16,}$/i.test(base) || base.length < 4) return null;
  // «cortazar1959perseguidor» (clave de cita): no es un título.
  if (/^[a-z]+\d{4}[a-z]+$/i.test(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function limpiarTitulo(t: string): string {
  let s = t.replace(/\s+/g, ' ').replace(/^[\s"“'«]+|[\s"”'».,;:]+$/g, '').trim();
  // TODO EN MAYÚSCULAS → Tipo título conservando los artículos en minúscula.
  if (s.length > 6 && s === s.toUpperCase() && /\p{Lu}/u.test(s)) {
    const menores = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'to', 'for', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una', 'le', 'les', 'des', 'et', 'du']);
    s = s.toLowerCase().split(' ').map((w, i) => (i > 0 && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }
  return s;
}

export function anioDe(s: string | number | undefined | null): number | undefined {
  if (s === undefined || s === null) return undefined;
  const m = String(s).match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (!m) return undefined;
  const a = parseInt(m[1] as string, 10);
  return a >= 1000 && a <= new Date().getFullYear() + 1 ? a : undefined;
}

export const RE_DOI = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]{1,120})\b/i;
export function limpiarDoi(s: string | undefined | null): string | undefined {
  const m = s ? RE_DOI.exec(s) : null;
  return m ? (m[1] as string).replace(/[.,;)\]]+$/, '').toLowerCase() : undefined;
}

// ---------------------------------------------------------------------------
// Candidatos sin red
// ---------------------------------------------------------------------------

export function candidatosLocales(meta: MetadatosIncrustados, nombreArchivo: string, epub: boolean): Candidato[] {
  const salida: Candidato[] = [];
  const d: Partial<MetadatosDocumento> = {};
  if (meta.titulo && !esTituloBasura(meta.titulo)) d.titulo = limpiarTitulo(meta.titulo);
  if (meta.autores?.length) {
    // La imprenta puede traer los autores sin partir («Vaswani, Shazeer, Parmar»): se parten aquí.
    const autores: Autor[] = meta.autores.flatMap((a) => (a.nombre ? [a] : partirAutores(a.apellidos, meta.idioma)));
    if (autores.length && !autores.some((a) => esTituloBasura(nombreCompleto(a)) && nombreCompleto(a).length > 40)) d.autores = autores;
  }
  // La fecha de creación del PDF no es la de publicación: solo si es un EPUB (dc:date).
  if (epub && meta.anio) d.anio = meta.anio;
  for (const k of ['editorial', 'idioma', 'isbn', 'url', 'subtitulo', 'resumen'] as const) if (meta[k]) (d as Record<string, unknown>)[k] = meta[k];
  const doi = limpiarDoi(meta.doi) ?? limpiarDoi(meta.doiEnTexto) ?? limpiarDoi(meta.identificadores?.join(' '));
  if (doi) d.doi = doi;
  if (Object.keys(d).length) salida.push({ fuente: epub ? 'epub' : 'pdf', confianza: epub ? 0.85 : 0.6, datos: d });
  const t = tituloDeArchivo(nombreArchivo);
  if (t && !esTituloBasura(t)) salida.push({ fuente: 'pdf', confianza: 0.2, datos: { titulo: t } });
  return salida;
}

// ---------------------------------------------------------------------------
// Lectura con un Redactor
// ---------------------------------------------------------------------------

const ESQUEMA_METADATOS = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Título de la obra, sin subtítulo; tal como figura en la portada, en caja normal (no todo mayúsculas).' },
    subtitulo: { type: 'string' },
    autores: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, apellidos: { type: 'string' } }, required: ['nombre', 'apellidos'] } },
    editores: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, apellidos: { type: 'string' } }, required: ['nombre', 'apellidos'] } },
    anio: { type: 'integer', description: 'Año de ESTA edición o publicación.' },
    anioOriginal: { type: 'integer', description: 'Año de la primera publicación de la OBRA (primera edición, © del original en una traducción), si consta.' },
    tituloOriginal: { type: 'string', description: 'En una traducción, el título original tal como figura («Título original: …»).' },
    traductores: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, apellidos: { type: 'string' } }, required: ['nombre', 'apellidos'] } },
    entrevistadores: { type: 'array', description: 'En entrevistas y programas: quien pregunta o presenta.', items: { type: 'object', properties: { nombre: { type: 'string' }, apellidos: { type: 'string' } }, required: ['nombre', 'apellidos'] } },
    edicion: { type: 'string', description: 'Mención de edición si consta: «2.ª ed.», «edición crítica», «Canto edition».' },
    coleccion: { type: 'string', description: 'Colección o serie editorial, si consta.' },
    contenedor: { type: 'string', description: 'Obra que contiene a esta: libro de un cuento o capítulo, actas de un congreso, programa de una emisión.' },
    idiomaOriginal: { type: 'string', description: 'Lengua original (BCP-47) si es una traducción.' },
    editorial: { type: 'string' },
    lugar: { type: 'string' },
    revista: { type: 'string' },
    volumen: { type: 'string' },
    numero: { type: 'string' },
    paginas: { type: 'string' },
    doi: { type: 'string' },
    isbn: { type: 'string' },
    idioma: { type: 'string', description: 'Código BCP-47 del idioma del texto principal: es, en, fr, la…' },
    tipoCSL: { type: 'string', enum: ['book', 'article-journal', 'chapter', 'paper-conference', 'thesis', 'report', 'manuscript', 'interview', 'speech', 'broadcast', 'motion_picture', 'song', 'webpage', 'document'] },
    resumen: { type: 'string', description: 'Resumen de 1-3 frases en el idioma del documento.' },
  },
  required: ['titulo', 'autores', 'idioma', 'tipoCSL'],
} as const;

export function textoParaMetadatos(unidades: UnidadLeida[], maxCaracteres = 9000, ultimas: UnidadLeida[] = []): string {
  const llenas = unidades.filter((u) => !u.vacia);
  const medio = llenas.some((u) => u.ancla?.tipo === 'tiempo');
  const bloque = (u: UnidadLeida) => {
    if (u.ancla?.tipo === 'tiempo') {
      const t = Math.round(u.t0 ?? 0);
      return `[${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${u.hablante ? ` ${u.hablante}` : ''}]\n${u.texto}`;
    }
    return `[página física ${u.fisica}]\n${u.cabecera ? `(cabecera: ${u.cabecera})\n` : ''}${u.texto}`;
  };
  // En un medio, el principio puede ser una canción o una sintonía: se toman también
  // muestras del medio y del final, donde suelen decirse nombres y títulos.
  const elegidas = medio && llenas.length > 8
    ? [...llenas.slice(0, 5), llenas[Math.floor(llenas.length / 3)], llenas[Math.floor(llenas.length / 2)], llenas[Math.floor((2 * llenas.length) / 3)], ...llenas.slice(-2)].filter((u): u is UnidadLeida => Boolean(u))
    : llenas;
  const partes: string[] = [];
  let total = 0;
  const porPieza = medio ? Math.floor(maxCaracteres / Math.max(1, Math.min(elegidas.length, 10))) : maxCaracteres;
  for (const u of elegidas) {
    const b = bloque(u).slice(0, Math.min(porPieza, maxCaracteres - total));
    partes.push(b);
    total += b.length;
    if (total >= maxCaracteres) break;
  }
  // El colofón y los créditos finales («Acabose de imprimir…», «Con licencia…»).
  const vistas = new Set(elegidas.map((u) => u.fisica));
  const finales = ultimas.filter((u) => !u.vacia && !vistas.has(u.fisica)).slice(-2);
  if (finales.length) partes.push(`[final del documento]\n${finales.map((u) => `[página física ${u.fisica}]\n${u.texto.slice(-1200)}`).join('\n\n')}`);
  return partes.join('\n\n');
}

/** Señales de una página de créditos o de un colofón. */
const RE_CREDITOS = /ISBN|©|\(c\)\s*\d{4}|copyright|dep[óo]sito\s+legal|\bD\.\s?L\.|primera\s+edici[óo]n|\bedici[óo]n\s*:|esta\s+edici[óo]n|first\s+(?:published|printed)|reprinted|printed\s+in|impreso\s+en|impress?o|con\s+licencia|imprenta|t[íi]tulo\s+original|traducci[óo]n\s+(?:de|del)|translated\s+by|all\s+rights\s+reserved|todos\s+los\s+derechos|published\s+by|arXiv:\S+v\d+\s*\[|conference\s+on/i;

/**
 * Texto para leer créditos y colofón sin modelo: la primera página con texto
 * (portada, sello de arXiv, pie del congreso) y, de las 12 primeras y las 3
 * últimas con texto, solo las que tienen señales de créditos: así no se leen
 * como créditos las referencias ni el cuerpo.
 */
export function textoColofon(unidades: UnidadLeida[], ultimas: UnidadLeida[] = []): string {
  const llenas = unidades.filter((u) => !u.vacia && u.ancla?.tipo !== 'tiempo');
  const vistas = new Set(llenas.map((u) => u.fisica));
  const fin = ultimas.filter((u) => !u.vacia && !vistas.has(u.fisica)).slice(-3);
  const texto = (u: UnidadLeida) => [u.cabecera, u.texto, ...(u.notas ?? []), u.pie].filter(Boolean).join('\n');
  const elegidas = [...llenas.slice(0, 12), ...fin].filter((u, i) => i === 0 || RE_CREDITOS.test(texto(u)));
  return elegidas.map(texto).join('\n\n');
}

export async function leerMetadatos(
  redactor: Redactor,
  entrada: { texto: string; nombreArchivo: string; ficha: MetadatosIncrustados; tipo: string; duracion?: number },
): Promise<Partial<MetadatosDocumento> & { hablantes?: Array<{ etiqueta: string; nombre: string }> }> {
  const medio = entrada.tipo === 'audio' || entrada.tipo === 'video';
  const esquema = medio
    ? { ...ESQUEMA_METADATOS, properties: { ...ESQUEMA_METADATOS.properties, hablantes: { type: 'array', description: 'Quién es cada etiqueta de hablante (H0, H1…), solo si el texto lo deja claro.', items: { type: 'object', properties: { etiqueta: { type: 'string' }, nombre: { type: 'string' } }, required: ['etiqueta', 'nombre'] } } } }
    : ESQUEMA_METADATOS;
  const ficha = Object.entries(entrada.ficha).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  const r = await redactor.generar<Partial<MetadatosDocumento> & { hablantes?: Array<{ etiqueta: string; nombre: string }> }>({
    sistema:
      'Eres un bibliotecario experto en catalogación. Extraes la ficha bibliográfica de un documento a partir de su principio. ' +
      'Reglas: no inventes nada que no esté en el texto o la ficha; deja fuera los campos que no consten. ' +
      'El nombre del archivo y la ficha del PDF suelen ser basura (nombres de archivo, «Microsoft Word - …», programas): úsalos solo si el texto los confirma. ' +
      'Autores: separa nombre y apellidos («C. S.» / «Lewis»; «Lope» / «de Vega Carpio»; «Joaquín» / «Soler Serrano»). En entrevistas, los autores son los entrevistados y quien pregunta va en entrevistadores. ' +
      'En un libro, el año es el de la edición que se tiene delante (página de créditos: «Esta edición», «© 2002», «Reprinted»); el de la primera publicación de la obra va en anioOriginal («Primera edición: 1975», «© 1975 Éditions Gallimard» en una traducción). ' +
      'Lee la página de créditos y el colofón: ISBN, «Título original», «Traducción de…» (traductores), mención de edición, colección, lugar y editorial; en impresos antiguos, el pie de imprenta («En Sevilla, en la Imprenta de…»): lugar e impresor (en editorial). Si no hay año impreso, deja el año vacío. ' +
      'Un cuento, poema o ensayo suelto de un libro es «chapter» y el libro va en contenedor; una comedia suelta impresa es «book». ' +
      'Autores corporativos (una institución, una cadena) van enteros en apellidos con el nombre vacío. ' +
      'En un artículo, revista, volumen, número y páginas si constan. ' +
      'El nombre del archivo puede ser una clave de cita «apellidoAñoPalabra» (serrano1977fondo = Soler Serrano, 1977, «A fondo»): úsala como pista, no como título. ' +
      'En audio y vídeo de un programa (radio, televisión, pódcast): el programa va en contenedor («A fondo») y el título es el del episodio o la entrevista («Entrevista a Julio Cortázar»), nunca el de una canción que suene; ' +
      'autores = quien interviene o es entrevistado; entrevistadores = quien presenta o pregunta. En una conferencia, el título es el de la conferencia y el autor quien la da; ' +
      'En un vídeo de una serie o de un canal (YouTube, cursos): el título es el del capítulo («Vectors»), la serie va en contenedor («Essence of linear algebra») y el canal en editorial («3Blue1Brown»); no pongas el capítulo en subtítulo. ' +
      'di quién es cada etiqueta de hablante (H0, H1…) si se deduce del texto.',
    mensajes: [{
      rol: 'usuario',
      partes: [{ texto: `Tipo de entrada: ${entrada.tipo}${entrada.duracion ? ` (${Math.round(entrada.duracion / 60)} min)` : ''}\nNombre del archivo: ${entrada.nombreArchivo}\nFicha incrustada:\n${ficha || '(vacía)'}\n\nPrincipio (y final) del documento:\n${entrada.texto}` }],
    }],
    esquema: esquema as unknown as Record<string, unknown>,
    temperatura: 0,
    maxTokens: 1500,
    calidad: 'rapida',
  });
  return r.json ?? {};
}

// ---------------------------------------------------------------------------
// Verificación externa: Crossref y OpenAlex
// ---------------------------------------------------------------------------

export interface RegistroExterno extends Partial<MetadatosDocumento> {
  fuente: 'crossref' | 'openalex';
  puntuacion?: number;
}

const ua = (correo?: string) => ({ 'User-Agent': `Scholaris/2 (https://scholaris.joseluissaorin.com; mailto:${correo ?? 'jl@joseluissaorin.com'})` });

async function pedir(http: Http, url: string, correo?: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await http(url, { headers: ua(correo), signal: ctrl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

interface ObraCrossref {
  title?: string[]; subtitle?: string[]; author?: Array<{ given?: string; family?: string; name?: string; ORCID?: string }>;
  editor?: Array<{ given?: string; family?: string }>;
  issued?: { 'date-parts'?: number[][] }; 'published-print'?: { 'date-parts'?: number[][] };
  publisher?: string; 'publisher-location'?: string; 'container-title'?: string[]; volume?: string; issue?: string; page?: string;
  DOI?: string; ISBN?: string[]; type?: string; language?: string; URL?: string; score?: number;
}

const TIPOS_CROSSREF: Record<string, string> = { 'journal-article': 'article-journal', 'book-chapter': 'chapter', 'proceedings-article': 'paper-conference', book: 'book', monograph: 'book', 'edited-book': 'book', dissertation: 'thesis', report: 'report', 'posted-content': 'article' };

function deCrossref(o: ObraCrossref): RegistroExterno {
  const anio = o['published-print']?.['date-parts']?.[0]?.[0] ?? o.issued?.['date-parts']?.[0]?.[0];
  const r: RegistroExterno = { fuente: 'crossref' };
  if (o.title?.[0]) r.titulo = limpiarTitulo(o.title[0]);
  if (o.subtitle?.[0]) r.subtitulo = o.subtitle[0];
  if (o.author?.length) r.autores = o.author.map((a) => (a.family ? { nombre: a.given ?? '', apellidos: a.family, ...(a.ORCID ? { orcid: a.ORCID.replace(/^https?:\/\/orcid\.org\//, '') } : {}) } : autorDe(a.name ?? '')));
  if (o.editor?.length) r.editores = o.editor.filter((a) => a.family).map((a) => ({ nombre: a.given ?? '', apellidos: a.family as string }));
  if (anio) r.anio = anio;
  if (o.publisher) r.editorial = o.publisher;
  if (o['publisher-location']) r.lugar = o['publisher-location'];
  if (o['container-title']?.[0]) r.revista = o['container-title'][0];
  if (o.volume) r.volumen = o.volume;
  if (o.issue) r.numero = o.issue;
  if (o.page) r.paginas = o.page;
  if (o.DOI) r.doi = o.DOI.toLowerCase();
  if (o.ISBN?.[0]) r.isbn = o.ISBN[0];
  if (o.type) r.tipoCSL = TIPOS_CROSSREF[o.type] ?? o.type;
  if (o.language) r.idioma = o.language;
  return r;
}

interface ObraOpenAlex {
  title?: string; display_name?: string; publication_year?: number; doi?: string; language?: string; type?: string;
  authorships?: Array<{ author?: { display_name?: string; orcid?: string | null } }>;
  primary_location?: { source?: { display_name?: string; host_organization_name?: string } };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  relevance_score?: number;
}

const TIPOS_OPENALEX: Record<string, string> = { article: 'article-journal', 'book-chapter': 'chapter', 'conference-paper': 'paper-conference', preprint: 'article', dissertation: 'thesis', book: 'book', report: 'report', dataset: 'dataset', review: 'review', other: 'document' };

function deOpenAlex(o: ObraOpenAlex): RegistroExterno {
  const r: RegistroExterno = { fuente: 'openalex' };
  const t = o.title ?? o.display_name;
  if (t) r.titulo = limpiarTitulo(t);
  if (o.authorships?.length) {
    r.autores = o.authorships.map((a) => {
      const autor = autorDe(a.author?.display_name ?? '');
      const orcid = a.author?.orcid?.replace(/^https?:\/\/orcid\.org\//, '');
      return orcid ? { ...autor, orcid } : autor;
    }).filter((a) => a.apellidos);
  }
  if (o.publication_year) r.anio = o.publication_year;
  if (o.doi) r.doi = o.doi.replace(/^https?:\/\/doi\.org\//, '').toLowerCase();
  if (o.language) r.idioma = o.language;
  if (o.type) r.tipoCSL = TIPOS_OPENALEX[o.type] ?? o.type;
  const fuente = o.primary_location?.source;
  if (fuente?.display_name && (o.type === 'article' || o.type === 'conference-paper')) r.revista = fuente.display_name;
  if (fuente?.host_organization_name) r.editorial = fuente.host_organization_name;
  if (o.biblio?.volume) r.volumen = o.biblio.volume;
  if (o.biblio?.issue) r.numero = o.biblio.issue;
  if (o.biblio?.first_page) r.paginas = o.biblio.last_page ? `${o.biblio.first_page}-${o.biblio.last_page}` : o.biblio.first_page;
  return r;
}

/** ¿Pueden ser la misma persona? Compara iniciales y, si ambos traen nombres enteros, los nombres. */
export function nombresCompatibles(a: string, b: string): boolean {
  const fichas = (s: string) => normalizar(s.replace(/\./g, '. ')).split(' ').filter(Boolean);
  const x = fichas(a), y = fichas(b);
  if (!x.length || !y.length) return true;
  if (x.length !== y.length) {
    // «Ashish» frente a «A.»: vale; «C. S.» frente a «Cynthia»: no.
    return x.length === 1 && y.length === 1;
  }
  return x.every((t, i) => {
    const u = y[i] as string;
    if (t[0] !== u[0]) return false;
    return t.length === 1 || u.length === 1 || similitud(t, u) >= 0.8;
  });
}

/** ¿El registro externo es la misma obra? 0-1. Título casi igual y autor o año compatibles. */
export function coincidencia(lectura: Partial<MetadatosDocumento>, ext: Partial<MetadatosDocumento>): number {
  if (!lectura.titulo || !ext.titulo) return 0;
  const tl = normalizar(lectura.titulo), te = normalizar(ext.titulo);
  // El externo puede traer «Título: subtítulo» en el título.
  const st = Math.max(similitud(tl, te), te.startsWith(tl) && tl.length > 12 ? 0.95 : 0, tl.startsWith(te) && te.length > 12 ? 0.9 : 0);
  if (st < 0.8) return 0;
  const autoresL = lectura.autores ?? [], autoresE = ext.autores ?? [];
  const ultimo = (a: Autor) => normalizar(a.apellidos).split(' ').at(-1) ?? '';
  let autor = 0.5;
  if (autoresL.length && autoresE.length) {
    // Mismo apellido Y nombres compatibles («C. S.» ≠ «Cynthia»; «A.» = «Ashish»).
    autor = autoresL.some((a) => autoresE.some((b) => ultimo(a) === ultimo(b) && nombresCompatibles(a.nombre, b.nombre))) ? 1 : 0;
  }
  const anio = lectura.anio && ext.anio ? (Math.abs(lectura.anio - ext.anio) <= 1 ? 1 : 0.3) : 0.5;
  if (autor === 0) return 0;
  // Un artículo no cambia de año: si el registro dice otro, es otra cosa (o una copia basura
  // con DOI propio, que las hay a miles). En libros, una reedición sí puede cambiarlo.
  const libro = lectura.tipoCSL === 'book' || lectura.tipoCSL === 'chapter' || Boolean(lectura.isbn);
  if (lectura.anio && ext.anio && Math.abs(lectura.anio - ext.anio) > 1 && !libro) return 0;
  return st * 0.6 + autor * 0.3 + anio * 0.1;
}

/** Un consultor con la caché, la clave de OpenAlex y el correo de los puertos (uno por paso: comparte la caché en memoria). */
function consultorDe(puertos: PuertosMetadatos, http: Http) {
  return crearConsultor({ http, ...(puertos.correo ? { correo: puertos.correo } : {}), ...(puertos.cache ? { cache: puertos.cache } : {}), ...(puertos.claveOpenAlex ? { claveOpenAlex: puertos.claveOpenAlex } : {}) });
}

export async function verificar(
  base: Partial<MetadatosDocumento>,
  http: Http,
  correo?: string,
  consultor?: Consultor,
): Promise<{ registro: RegistroExterno | null; consultas: string[] }> {
  const consultas: string[] = [];
  const mailto = correo ? `&mailto=${encodeURIComponent(correo)}` : '';
  if (base.doi) {
    const url = `https://api.crossref.org/works/${encodeURIComponent(base.doi)}`;
    consultas.push(url);
    const j = (consultor ? await consultor.json(url) : await pedir(http, url, correo)) as { message?: ObraCrossref } | null;
    if (j?.message) {
      const r = deCrossref(j.message);
      // Con DOI, basta con que el título se parezca algo (el DOI manda).
      if (!base.titulo || similitud(base.titulo, r.titulo ?? '') > 0.5) return { registro: { ...r, puntuacion: 1 }, consultas };
    }
  }
  if (!base.titulo) return { registro: null, consultas };
  const autor = base.autores?.[0]?.apellidos ?? '';
  const q = encodeURIComponent(`${base.titulo} ${autor}`.trim());
  const urlC = `https://api.crossref.org/works?query.bibliographic=${q}&rows=5&select=title,subtitle,author,editor,issued,published-print,publisher,publisher-location,container-title,volume,issue,page,DOI,ISBN,type,language${mailto}`;
  const urlO = `https://api.openalex.org/works?search=${encodeURIComponent(base.titulo)}&per-page=5${mailto}`;
  consultas.push(urlC, urlO);
  const [jc, jo] = await Promise.all(consultor ? [consultor.json(urlC), consultor.json(urlO)] : [pedir(http, urlC, correo), pedir(http, urlO, correo)]);
  const candidatos: RegistroExterno[] = [
    ...(((jc as { message?: { items?: ObraCrossref[] } } | null)?.message?.items ?? []).map(deCrossref)),
    ...(((jo as { results?: ObraOpenAlex[] } | null)?.results ?? []).map(deOpenAlex)),
  ];
  let mejor: RegistroExterno | null = null, puntos = 0;
  for (const c of candidatos) {
    const p = coincidencia(base, c) + (c.fuente === 'crossref' && c.doi ? 0.01 : 0);
    if (p > puntos) { puntos = p; mejor = c; }
  }
  return { registro: mejor && puntos >= 0.78 ? { ...mejor, puntuacion: puntos } : null, consultas };
}

// ---------------------------------------------------------------------------
// Fusión
// ---------------------------------------------------------------------------

const CAMPOS: Campo[] = [
  'titulo', 'subtitulo', 'tituloOriginal', 'autores', 'editores', 'traductores', 'entrevistadores', 'anio', 'anioOriginal', 'fecha', 'sinFecha',
  'editorial', 'lugar', 'edicion', 'coleccion', 'contenedor', 'revista', 'volumen', 'numero', 'paginas', 'doi', 'isbn', 'url',
  'idioma', 'idiomaOriginal', 'tipoCSL', 'resumen',
];

const vacio = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const CATALOGOS = new Set<Fuente>(['crossref', 'openalex', 'openlibrary', 'wikidata', 'wikipedia', 'googlebooks', 'arxiv', 'datacite']);

/**
 * Fusiona candidatos campo a campo: gana el de más confianza. Los campos
 * bibliográficos de un registro externo verificado ganan a la lectura, salvo el
 * idioma (que manda la lectura del texto). Lo que puso el usuario gana siempre.
 */
export function fusionarMetadatos(candidatos: Candidato[], nombreArchivo: string): MetadatosDocumento {
  const salida: Partial<MetadatosDocumento> = {};
  const procedencia: NonNullable<MetadatosDocumento['procedencia']> = {};
  for (const campo of CAMPOS) {
    let mejor: { v: unknown; fuente: Fuente; c: number } | null = null;
    for (const cand of candidatos) {
      const v = cand.datos[campo];
      if (vacio(v)) continue;
      let c = cand.porCampo?.[campo] ?? cand.confianza;
      if (CATALOGOS.has(cand.fuente) && (campo === 'idioma' || campo === 'resumen')) c -= 0.3;
      if (campo === 'titulo' && esTituloBasura(v as string)) continue;
      // El usuario, por encima de todo (aunque otra fuente declare confianza 1).
      if (cand.fuente === 'usuario') c = 2;
      if (!mejor || c > mejor.c) mejor = { v, fuente: cand.fuente, c };
    }
    // Un candidato más fiable puede pedir que el campo quede vacío (nunca si lo puso el usuario).
    const anulado = mejor && mejor.fuente !== 'usuario' && candidatos.some((c) => c.anula?.includes(campo) && Math.max(c.confianza, ...Object.values(c.porCampo ?? {})) > mejor!.c);
    if (mejor && !anulado) {
      (salida as Record<string, unknown>)[campo] = mejor.v;
      procedencia[campo] = { fuente: mejor.fuente, confianza: Math.round(Math.max(0, Math.min(1, mejor.c)) * 100) / 100 };
    }
  }
  if (!salida.titulo) {
    salida.titulo = tituloDeArchivo(nombreArchivo) ?? nombreArchivo;
    procedencia.titulo = { fuente: 'pdf', confianza: 0.1 };
  }
  // Coherencia: la obra no puede ser posterior a la edición. Cede el de menos confianza (nunca el del usuario).
  if (salida.anioOriginal !== undefined && salida.anio !== undefined && salida.anioOriginal > salida.anio) {
    const co = procedencia.anioOriginal, ca = procedencia.anio;
    const quitarOriginal = co?.fuente !== 'usuario' && (ca?.fuente === 'usuario' || (co?.confianza ?? 0) <= (ca?.confianza ?? 0));
    if (quitarOriginal) { delete salida.anioOriginal; delete procedencia.anioOriginal; } else { delete salida.anio; delete procedencia.anio; }
  }
  // Lengua original igual a la del texto: no es una traducción.
  if (salida.idiomaOriginal && salida.idioma && salida.idiomaOriginal.slice(0, 2) === salida.idioma.slice(0, 2) && procedencia.idiomaOriginal?.fuente !== 'usuario') { delete salida.idiomaOriginal; delete procedencia.idiomaOriginal; }
  // ORCID existe desde 2012: en obras anteriores a 1990 es un error de desambiguación del catálogo (C. S. Lewis con ORCID).
  const anioObra = salida.anioOriginal ?? salida.anio;
  if (anioObra !== undefined && anioObra < 1990 && salida.autores?.some((a) => a.orcid) && procedencia.autores?.fuente !== 'usuario') {
    salida.autores = salida.autores.map(({ orcid: _o, ...a }) => a);
  }
    // Con año, la horquilla de «s. f.» sobra.
  if (salida.anio !== undefined && salida.sinFecha && procedencia.sinFecha?.fuente !== 'usuario') { delete salida.sinFecha; delete procedencia.sinFecha; }
  if (salida.titulo) salida.titulo = limpiarTitulo(salida.titulo);
  return { titulo: salida.titulo, autores: salida.autores ?? [], ...salida, procedencia };
}

/** Los campos que el usuario ya editó (según la procedencia): no se tocan al reprocesar. */
export function camposDeUsuario(m: Partial<MetadatosDocumento> | undefined): Partial<MetadatosDocumento> {
  if (!m?.procedencia) return {};
  const r: Partial<MetadatosDocumento> = {};
  for (const [k, p] of Object.entries(m.procedencia)) if (p.fuente === 'usuario' && k in m) (r as Record<string, unknown>)[k] = (m as Record<string, unknown>)[k];
  return r;
}

// ---------------------------------------------------------------------------
// El paso
// ---------------------------------------------------------------------------

export interface EntradaMetadatos {
  ficha: MetadatosIncrustados;
  nombreArchivo: string;
  tipo: string;
  epub: boolean;
  duracion?: number;
  unidades: UnidadLeida[];
  /** Últimas páginas (colofón, créditos finales), si ya están leídas. */
  ultimas?: UnidadLeida[];
  /** Idioma mayoritario visto por el lector. */
  idiomaLectura?: string;
  /** Campos puestos por el usuario: ganan siempre. */
  usuario?: Partial<MetadatosDocumento>;
}

export interface PuertosMetadatos {
  redactor?: Redactor;
  http?: Http;
  correo?: string;
  reloj?: () => number;
  /** Caché persistente de las consultas a catálogos. */
  cache?: CacheConsultas;
  /** Clave opcional de OpenAlex. */
  claveOpenAlex?: string;
}

export interface ResultadoMetadatos {
  metadatos: MetadatosDocumento;
  procedencia: Procedencia[];
  hablantes?: Record<string, string>;
  /** Lo que se leyó de créditos y colofón (para decidir si refinar con el libro entero). */
  colofon?: Colofon | null;
}

export async function pasoMetadatos(
  entrada: EntradaMetadatos,
  puertos: PuertosMetadatos,
  opciones: { sinVerificacion?: boolean } = {},
): Promise<ResultadoMetadatos> {
  const reloj = puertos.reloj ?? Date.now;
  let hablantes: Record<string, string> | undefined;
  const procedencia: Procedencia[] = [];
  const candidatos = candidatosLocales(entrada.ficha, entrada.nombreArchivo, entrada.epub);
  let lectura: Partial<MetadatosDocumento> = {};
  if (puertos.redactor) {
    const t = reloj();
    try {
      lectura = await leerMetadatos(puertos.redactor, { texto: textoParaMetadatos(entrada.unidades, 9000, entrada.ultimas), nombreArchivo: entrada.nombreArchivo, ficha: entrada.ficha, tipo: entrada.tipo, ...(entrada.duracion ? { duracion: entrada.duracion } : {}) });
      const conHablantes = lectura as typeof lectura & { hablantes?: Array<{ etiqueta: string; nombre: string }> };
      if (conHablantes.hablantes?.length) hablantes = Object.fromEntries(conHablantes.hablantes.filter((h) => h.etiqueta && h.nombre?.trim()).map((h) => [h.etiqueta.trim(), h.nombre.trim()]));
      delete conHablantes.hablantes;
      lectura = normalizarLectura(lectura);
      procedencia.push({ fase: 'metadatos', proveedor: puertos.redactor.nombre, ms: reloj() - t, detalle: { campos: Object.keys(lectura) } });
    } catch (e) {
      procedencia.push({ fase: 'metadatos', proveedor: puertos.redactor.nombre, ms: reloj() - t, detalle: { error: String((e as Error)?.message ?? e).slice(0, 200) } });
    }
    candidatos.push({ fuente: 'lectura', confianza: 0.8, datos: lectura });
  }
  if (entrada.idiomaLectura) candidatos.push({ fuente: 'lectura', confianza: 0.85, datos: { idioma: entrada.idiomaLectura } });
  const usuario = entrada.usuario && Object.keys(entrada.usuario).length ? entrada.usuario : null;
  // El usuario entra ya en la provisional: las búsquedas parten de su título y sus autores.
  const provisional = fusionarMetadatos(usuario ? [...candidatos, { fuente: 'usuario', confianza: 1, datos: usuario }] : candidatos, entrada.nombreArchivo);

  const medio = entrada.tipo === 'audio' || entrada.tipo === 'video';
  const http: Http = puertos.http ?? ((url, init) => fetch(url, init as RequestInit));
  if (!opciones.sinVerificacion && !medio) {
    const t = reloj();
    const { registro, consultas } = await verificar(provisional, http, puertos.correo, consultorDe(puertos, http));
    procedencia.push({ fase: 'metadatos', proveedor: registro?.fuente ?? 'verificacion', ms: reloj() - t, detalle: { consultas: consultas.length, encontrado: Boolean(registro), puntuacion: registro?.puntuacion ?? 0, titulo: registro?.titulo } });
    if (registro) {
      const { fuente, puntuacion, ...datos } = registro;
      // El registro externo no sabe del libro concreto: su año es el de la obra; si la lectura ve otra edición, manda la lectura.
      if (datos.anio && provisional.anio && Math.abs(datos.anio - provisional.anio) > 1 && provisional.tipoCSL === 'book') {
        if (!provisional.anioOriginal && datos.anio < provisional.anio) datos.anioOriginal = datos.anio;
        delete datos.anio;
      }
      // El título tal como figura en el documento manda sobre la forma del catálogo
      // («The discarded image : an introduction…» en minúsculas de biblioteca).
      if (datos.titulo && provisional.titulo && procedenciaLectura(provisional, 'titulo')) {
        const [principal, resto] = datos.titulo.split(/\s*:\s+/, 2);
        if (similitud(principal ?? '', provisional.titulo) >= 0.85 || normalizar(datos.titulo).startsWith(normalizar(provisional.titulo))) {
          delete datos.titulo;
          if (provisional.subtitulo || !resto) delete datos.subtitulo; else datos.subtitulo ??= resto;
        }
      }
      candidatos.push({ fuente, confianza: 0.85 + 0.1 * Math.min(1, puntuacion ?? 0), datos });
    }
  }

  // Enriquecimiento: edición (colofón, ISBN) y obra (Wikidata, Open Library, Wikipedia…).
  const t = reloj();
  const consultor = opciones.sinVerificacion ? null : consultorDe(puertos, http);
  const intermedia = fusionarMetadatos(usuario ? [...candidatos, { fuente: 'usuario', confianza: 1, datos: usuario }] : candidatos, entrada.nombreArchivo);
  let colofon: Colofon | null = null;
  let orcid = new Map<string, string>();
  try {
    // En un medio, las pruebas de la grabación: transcripción entera, hablantes con nombre (de la atribución, no de esta lectura) y duración.
    const nombrados = [...new Set(entrada.unidades.map((u) => u.hablante ?? '').filter((h) => h && !/^(H|SPEAKER_?|hablante\s*)\d+$/i.test(h)))];
    const grabacion = medio ? { texto: entrada.unidades.map((u) => u.texto).join(' '), hablantes: nombrados, ...(entrada.duracion ? { duracion: entrada.duracion } : {}) } : undefined;
    const r = await enriquecer({ base: intermedia, texto: medio ? '' : textoColofon(entrada.unidades, entrada.ultimas), tipo: entrada.tipo, ...(grabacion ? { grabacion } : {}) }, consultor);
    colofon = r.colofon;
    orcid = r.orcid;
    for (const h of r.hallazgos) candidatos.push({ fuente: h.fuente, confianza: h.confianza, ...(h.porCampo ? { porCampo: h.porCampo } : {}), ...(h.anula ? { anula: h.anula } : {}), datos: h.datos });
    procedencia.push({
      fase: 'metadatos', proveedor: 'enriquecimiento', ms: reloj() - t,
      detalle: { hallazgos: r.hallazgos.map((h) => ({ fuente: h.fuente, campos: Object.keys(h.datos), ...(h.id ? { id: h.id } : {}) })), consultas: consultor?.consultas.length ?? 0, avisos: r.avisos },
    });
  } catch (e) {
    procedencia.push({ fase: 'metadatos', proveedor: 'enriquecimiento', ms: reloj() - t, detalle: { error: String((e as Error)?.message ?? e).slice(0, 200) } });
  }

  if (usuario) candidatos.push({ fuente: 'usuario', confianza: 1, datos: usuario });
  const metadatos = fusionarMetadatos(candidatos, entrada.nombreArchivo);
  if (metadatos.procedencia?.autores?.fuente !== 'usuario' && (metadatos.anioOriginal ?? metadatos.anio ?? 9999) >= 1990) metadatos.autores = conOrcid(metadatos.autores, orcid);
  return { metadatos, procedencia, colofon, ...(hablantes && Object.keys(hablantes).length ? { hablantes } : {}) };
}

/**
 * Con el libro ya leído entero: si los créditos y el colofón (primeras 12 y
 * últimas 3 páginas) traen pruebas que no se vieron con las primeras páginas,
 * se repite el paso con ellas. Si no, devuelve el resultado tal cual.
 */
export async function refinarMetadatos(
  previo: ResultadoMetadatos,
  entrada: EntradaMetadatos & { todas: UnidadLeida[] },
  puertos: PuertosMetadatos,
  opciones: { sinVerificacion?: boolean } = {},
): Promise<ResultadoMetadatos> {
  const paginas = entrada.todas.filter((u) => u.ancla?.tipo !== 'tiempo');
  if (paginas.length <= entrada.unidades.length) return previo;
  const llenas = paginas.filter((u) => !u.vacia);
  const primeras = llenas.slice(0, 12);
  const ultimas = llenas.slice(-3);
  const ahora = leerColofon(textoColofon(primeras, ultimas));
  const tituloFlojo = (previo.metadatos.procedencia?.titulo?.confianza ?? 0) < 0.5;
  if (!pruebasNuevas(previo.colofon ?? null, ahora) && !tituloFlojo) return previo;
  const { todas: _todas, ...resto } = entrada;
  const r = await pasoMetadatos({ ...resto, unidades: primeras, ultimas }, puertos, opciones);
  return { ...r, procedencia: [...previo.procedencia, ...r.procedencia], ...(previo.hablantes && !r.hablantes ? { hablantes: previo.hablantes } : {}) };
}

/**
 * Para la consolidación: la ficha ya hecha con las primeras páginas y el libro
 * entero. Devuelve null si los créditos y el colofón no traen nada nuevo.
 */
export async function refinarConLibroEntero(
  meta: MetadatosDocumento,
  entrada: EntradaMetadatos & { todas: UnidadLeida[] },
  puertos: PuertosMetadatos,
  opciones: { sinVerificacion?: boolean } = {},
): Promise<ResultadoMetadatos | null> {
  if (entrada.tipo === 'audio' || entrada.tipo === 'video') return null;
  const previo: ResultadoMetadatos = { metadatos: meta, procedencia: [], colofon: leerColofon(textoColofon(entrada.unidades, entrada.ultimas)) };
  const r = await refinarMetadatos(previo, entrada, puertos, opciones);
  return r === previo ? null : r;
}

/** Una fila de la tabla `unidades` (SPDF o estantería) como unidad leída. */
export function unidadDeFila(f: Record<string, unknown>): UnidadLeida {
  const leer = <T>(v: unknown, def: T): T => { try { return typeof v === 'string' && v ? (JSON.parse(v) as T) : def; } catch { return def; } };
  const orden = Number(f.orden ?? 0);
  const ancla = leer<NonNullable<UnidadLeida['ancla']>>(f.ancla, { tipo: 'pagina', fisica: orden + 1, impresa: null, romana: false, origen: 'ninguno', confianza: 0 });
  const texto = String(f.texto ?? '');
  return {
    orden, fisica: ancla.tipo === 'pagina' ? ancla.fisica : orden + 1, texto, notas: leer<string[]>(f.notas, []), cabecera: String(f.cabecera ?? ''), pie: String(f.pie ?? ''),
    folioVisto: null, titulos: [], figuras: [], vacia: !texto.trim(), lector: String(f.lector ?? 'spdf'), confianza: Number(f.confianza ?? 1), ancla,
    ...(typeof f.t0 === 'number' ? { t0: f.t0 } : {}), ...(typeof f.t1 === 'number' ? { t1: f.t1 } : {}),
    ...(ancla.tipo === 'tiempo' && ancla.hablante ? { hablante: ancla.hablante } : {}),
  };
}

/**
 * Rehace SOLO la ficha de un documento ya leído (sin volver a leerlo): lectura
 * de las primeras páginas o de la transcripción, verificación, enriquecimiento
 * y refinado con el libro entero. Lo que editó el usuario se conserva.
 */
export async function rehacerFicha(
  previa: MetadatosDocumento,
  documento: { tipo: string; nombreArchivo: string; duracion?: number; unidades: UnidadLeida[] },
  puertos: PuertosMetadatos,
  opciones: { sinVerificacion?: boolean } = {},
): Promise<ResultadoMetadatos> {
  const medio = documento.tipo === 'audio' || documento.tipo === 'video';
  const usuario = camposDeUsuario(previa);
  // Un nombre de clave del almacén («original», «paquete.json») no es un nombre de archivo.
  const nombreArchivo = esTituloBasura(documento.nombreArchivo.replace(/\.[a-z0-9]{2,5}$/i, '')) ? '' : documento.nombreArchivo;
  const entrada: EntradaMetadatos = {
    ficha: {}, nombreArchivo, tipo: documento.tipo, epub: documento.tipo === 'epub',
    ...(documento.duracion ? { duracion: documento.duracion } : {}),
    unidades: medio ? documento.unidades : documento.unidades.slice(0, 5),
    ...(Object.keys(usuario).length ? { usuario } : {}),
  };
  let r = await pasoMetadatos(entrada, puertos, opciones);
  if (!medio) r = await refinarMetadatos(r, { ...entrada, todas: documento.unidades }, puertos, opciones);
  return { ...r, metadatos: noEmpeorar(previa, r.metadatos) };
}

/** Confianza que se le supone a un campo existente sin procedencia (fichas de la v1, importadas o editadas fuera). */
const CONFIANZA_PREVIA = 0.85;
/** Lo que tiene que ganar una fuente nueva para sustituir un valor existente. */
const MARGEN = 0.05;

/**
 * Rehacer nunca deja un campo peor de lo que estaba: un valor nuevo sustituye
 * al existente solo si trae más confianza (más el margen); un campo vacío
 * nunca borra uno lleno; un título basura nunca sustituye a nada; lo del
 * usuario no se toca. Los campos que se conservan guardan su procedencia.
 */
export function noEmpeorar(previa: MetadatosDocumento, nueva: MetadatosDocumento): MetadatosDocumento {
  const salida: MetadatosDocumento = { ...nueva, autores: nueva.autores ?? [] };
  const procedencia: NonNullable<MetadatosDocumento['procedencia']> = { ...(nueva.procedencia ?? {}) };
  const sustituidos = new Set<Campo>();
  for (const campo of CAMPOS) {
    const viejo = previa[campo];
    if (vacio(viejo)) continue;
    const pv = previa.procedencia?.[campo];
    // Un tipo genérico («document») no es un dato: cualquier tipo concreto con pruebas lo mejora.
    const generico = campo === 'tipoCSL' && viejo === 'document';
    const cv = pv?.fuente === 'usuario' ? Infinity : generico ? 0.5 : pv?.confianza ?? CONFIANZA_PREVIA;
    const nuevo = nueva[campo];
    const pn = nueva.procedencia?.[campo];
    const basura = campo === 'titulo' && (esTituloBasura(nuevo as string) || (pn?.confianza ?? 0) <= 0.2);
    const gana = !vacio(nuevo) && !basura && (pn?.confianza ?? 0) >= cv + MARGEN;
    if (gana) { if (JSON.stringify(nuevo) !== JSON.stringify(viejo)) sustituidos.add(campo); continue; }
    (salida as unknown as Record<string, unknown>)[campo] = viejo;
    if (pv) procedencia[campo] = pv; else delete procedencia[campo];
  }
  // El subtítulo va con su título: si el título cambió por uno más fiable y no trae subtítulo, el viejo sobra.
  if (sustituidos.has('titulo') && vacio(nueva.subtitulo) && previa.procedencia?.subtitulo?.fuente !== 'usuario') { delete salida.subtitulo; delete procedencia.subtitulo; }
  // Coherencia tras mezclar: con año, sobra la horquilla de «s. f.»; la obra no puede ser posterior a la edición.
  if (salida.anio !== undefined && salida.sinFecha && procedencia.sinFecha?.fuente !== 'usuario') { delete salida.sinFecha; delete procedencia.sinFecha; }
  if (salida.anioOriginal !== undefined && salida.anio !== undefined && salida.anioOriginal > salida.anio) {
    const co = procedencia.anioOriginal?.confianza ?? CONFIANZA_PREVIA, ca = procedencia.anio?.confianza ?? CONFIANZA_PREVIA;
    if (procedencia.anioOriginal?.fuente !== 'usuario' && (procedencia.anio?.fuente === 'usuario' || co <= ca)) { delete salida.anioOriginal; delete procedencia.anioOriginal; } else { delete salida.anio; delete procedencia.anio; }
  }
  return { ...salida, procedencia };
}

const procedenciaLectura = (m: MetadatosDocumento, campo: string) => m.procedencia?.[campo]?.fuente === 'lectura';

/** Repara la salida del Redactor: autores sin partir, años como texto, DOI con prefijo. */
export function normalizarLectura(l: Partial<MetadatosDocumento>): Partial<MetadatosDocumento> {
  const r: Partial<MetadatosDocumento> = { ...l };
  for (const k of Object.keys(r) as Campo[]) if (vacio(r[k])) delete r[k];
  const personas = (xs: Autor[]) => xs.flatMap((a) => (a.nombre || !a.apellidos?.includes(' ') ? [a] : partirAutores(a.apellidos, r.idioma)))
    .filter((a) => a.apellidos || a.nombre).map((a) => (a.apellidos ? a : autorDe(a.nombre, r.idioma)));
  if (r.autores) r.autores = personas(r.autores);
  if (r.traductores) r.traductores = personas(r.traductores);
  if (r.editores) r.editores = personas(r.editores);
  if (r.entrevistadores) r.entrevistadores = personas(r.entrevistadores);
  if (r.anio !== undefined) { const a = anioDe(r.anio); if (a) r.anio = a; else delete r.anio; }
  if (r.anioOriginal !== undefined) { const a = anioDe(r.anioOriginal); if (a) r.anioOriginal = a; else delete r.anioOriginal; }
  if (r.doi) { const d = limpiarDoi(r.doi); if (d) r.doi = d; else delete r.doi; }
  if (r.idioma) r.idioma = r.idioma.toLowerCase().slice(0, 5);
  if (r.idiomaOriginal) r.idiomaOriginal = r.idiomaOriginal.toLowerCase().slice(0, 5);
  if (r.idiomaOriginal && r.idiomaOriginal === r.idioma) delete r.idiomaOriginal;
  if (r.titulo) r.titulo = limpiarTitulo(r.titulo);
  if (r.tituloOriginal && r.titulo && normalizar(r.tituloOriginal) === normalizar(r.titulo)) delete r.tituloOriginal;
  // Un «resumen» de cuatro palabras es una lista de materias, no un resumen.
  if (r.resumen && r.resumen.split(/\s+/).length < 8) delete r.resumen;
  return r;
}
