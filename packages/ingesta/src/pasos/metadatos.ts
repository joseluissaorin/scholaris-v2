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
 * 4. Fusión campo a campo, con procedencia y confianza por campo.
 */

import type { Autor, MetadatosDocumento, Redactor } from '@scholaris/nucleo';
import type { MetadatosIncrustados } from '@scholaris/imprenta';
import type { Http, Procedencia, UnidadLeida } from '../tipos.js';
import { normalizar, similitud } from '../texto.js';
import { nombreCompleto, partirAutores, separarNombre } from './autores.js';

type Fuente = NonNullable<MetadatosDocumento['procedencia']>[string]['fuente'];
type Campo = Exclude<keyof MetadatosDocumento, 'procedencia'>;

export interface Candidato {
  fuente: Fuente;
  /** Confianza base de la fuente. */
  confianza: number;
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
    anioOriginal: { type: 'integer', description: 'Año de la primera edición o de composición, si consta y difiere.' },
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

export function textoParaMetadatos(unidades: UnidadLeida[], maxCaracteres = 9000): string {
  const partes: string[] = [];
  let total = 0;
  for (const u of unidades) {
    if (u.vacia) continue;
    const etiqueta = u.ancla?.tipo === 'tiempo' ? `[${Math.round(u.t0 ?? 0)} s]` : `[página física ${u.fisica}]`;
    const bloque = `${etiqueta}\n${u.cabecera ? `(cabecera: ${u.cabecera})\n` : ''}${u.texto}`;
    partes.push(bloque.slice(0, maxCaracteres - total));
    total += bloque.length;
    if (total >= maxCaracteres) break;
  }
  return partes.join('\n\n');
}

export async function leerMetadatos(
  redactor: Redactor,
  entrada: { texto: string; nombreArchivo: string; ficha: MetadatosIncrustados; tipo: string; duracion?: number },
): Promise<Partial<MetadatosDocumento>> {
  const ficha = Object.entries(entrada.ficha).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');
  const r = await redactor.generar<Partial<MetadatosDocumento>>({
    sistema:
      'Eres un bibliotecario experto en catalogación. Extraes la ficha bibliográfica de un documento a partir de su principio. ' +
      'Reglas: no inventes nada que no esté en el texto o la ficha; deja fuera los campos que no consten. ' +
      'El nombre del archivo y la ficha del PDF suelen ser basura (nombres de archivo, «Microsoft Word - …», programas): úsalos solo si el texto los confirma. ' +
      'Autores: separa nombre y apellidos («C. S.» / «Lewis»; «Lope» / «de Vega Carpio»; «Joaquín» / «Soler Serrano»). En entrevistas y programas, el entrevistador y el entrevistado son autores. ' +
      'En un libro, el año es el de la edición que se tiene delante (página de créditos); el de la primera edición va en anioOriginal. ' +
      'En un artículo, revista, volumen, número y páginas si constan.',
    mensajes: [{
      rol: 'usuario',
      partes: [{ texto: `Tipo de entrada: ${entrada.tipo}${entrada.duracion ? ` (${Math.round(entrada.duracion / 60)} min)` : ''}\nNombre del archivo: ${entrada.nombreArchivo}\nFicha incrustada:\n${ficha || '(vacía)'}\n\nPrincipio del documento:\n${entrada.texto}` }],
    }],
    esquema: ESQUEMA_METADATOS as unknown as Record<string, unknown>,
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
  if (o.author?.length) r.autores = o.author.map((a) => (a.family ? { nombre: a.given ?? '', apellidos: a.family, ...(a.ORCID ? { orcid: a.ORCID.replace(/^https?:\/\/orcid\.org\//, '') } : {}) } : separarNombre(a.name ?? '')));
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
  authorships?: Array<{ author?: { display_name?: string; orcid?: string } }>;
  primary_location?: { source?: { display_name?: string; host_organization_name?: string } };
  biblio?: { volume?: string; issue?: string; first_page?: string; last_page?: string };
  relevance_score?: number;
}

function deOpenAlex(o: ObraOpenAlex): RegistroExterno {
  const r: RegistroExterno = { fuente: 'openalex' };
  const t = o.title ?? o.display_name;
  if (t) r.titulo = limpiarTitulo(t);
  if (o.authorships?.length) r.autores = o.authorships.map((a) => separarNombre(a.author?.display_name ?? '')).filter((a) => a.apellidos);
  if (o.publication_year) r.anio = o.publication_year;
  if (o.doi) r.doi = o.doi.replace(/^https?:\/\/doi\.org\//, '').toLowerCase();
  if (o.language) r.idioma = o.language;
  if (o.type) r.tipoCSL = o.type === 'article' ? 'article-journal' : o.type === 'book-chapter' ? 'chapter' : o.type;
  const fuente = o.primary_location?.source;
  if (fuente?.display_name && o.type === 'article') r.revista = fuente.display_name;
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

export async function verificar(
  base: Partial<MetadatosDocumento>,
  http: Http,
  correo?: string,
): Promise<{ registro: RegistroExterno | null; consultas: string[] }> {
  const consultas: string[] = [];
  const mailto = correo ? `&mailto=${encodeURIComponent(correo)}` : '';
  if (base.doi) {
    const url = `https://api.crossref.org/works/${encodeURIComponent(base.doi)}`;
    consultas.push(url);
    const j = (await pedir(http, url, correo)) as { message?: ObraCrossref } | null;
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
  const [jc, jo] = await Promise.all([pedir(http, urlC, correo), pedir(http, urlO, correo)]);
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

const CAMPOS: Campo[] = ['titulo', 'subtitulo', 'autores', 'editores', 'anio', 'anioOriginal', 'editorial', 'lugar', 'revista', 'volumen', 'numero', 'paginas', 'doi', 'isbn', 'url', 'idioma', 'tipoCSL', 'resumen'];

const vacio = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Fusiona candidatos campo a campo: gana el de más confianza. Los campos
 * bibliográficos de un registro externo verificado ganan a la lectura, salvo el
 * idioma (que manda la lectura del texto) y el año original.
 */
export function fusionarMetadatos(candidatos: Candidato[], nombreArchivo: string): MetadatosDocumento {
  const salida: Partial<MetadatosDocumento> = {};
  const procedencia: NonNullable<MetadatosDocumento['procedencia']> = {};
  for (const campo of CAMPOS) {
    let mejor: { v: unknown; fuente: Fuente; c: number } | null = null;
    for (const cand of candidatos) {
      const v = cand.datos[campo];
      if (vacio(v)) continue;
      let c = cand.confianza;
      if ((cand.fuente === 'crossref' || cand.fuente === 'openalex') && (campo === 'idioma' || campo === 'resumen')) c -= 0.3;
      if (campo === 'titulo' && esTituloBasura(v as string)) continue;
      if (!mejor || c > mejor.c) mejor = { v, fuente: cand.fuente, c };
    }
    if (mejor) {
      (salida as Record<string, unknown>)[campo] = mejor.v;
      procedencia[campo] = { fuente: mejor.fuente, confianza: Math.round(Math.max(0, Math.min(1, mejor.c)) * 100) / 100 };
    }
  }
  if (!salida.titulo) {
    salida.titulo = tituloDeArchivo(nombreArchivo) ?? nombreArchivo;
    procedencia.titulo = { fuente: 'pdf', confianza: 0.1 };
  }
  // Coherencia: el año original no puede ser posterior al de la edición.
  if (salida.anioOriginal && salida.anio && salida.anioOriginal >= salida.anio) delete salida.anioOriginal;
  if (salida.titulo) salida.titulo = limpiarTitulo(salida.titulo);
  return { titulo: salida.titulo, autores: salida.autores ?? [], ...salida, procedencia };
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
  /** Idioma mayoritario visto por el lector. */
  idiomaLectura?: string;
  usuario?: Partial<MetadatosDocumento>;
}

export async function pasoMetadatos(
  entrada: EntradaMetadatos,
  puertos: { redactor?: Redactor; http?: Http; correo?: string; reloj?: () => number },
  opciones: { sinVerificacion?: boolean } = {},
): Promise<{ metadatos: MetadatosDocumento; procedencia: Procedencia[] }> {
  const reloj = puertos.reloj ?? Date.now;
  const procedencia: Procedencia[] = [];
  const candidatos = candidatosLocales(entrada.ficha, entrada.nombreArchivo, entrada.epub);
  let lectura: Partial<MetadatosDocumento> = {};
  if (puertos.redactor) {
    const t = reloj();
    try {
      lectura = await leerMetadatos(puertos.redactor, { texto: textoParaMetadatos(entrada.unidades), nombreArchivo: entrada.nombreArchivo, ficha: entrada.ficha, tipo: entrada.tipo, ...(entrada.duracion ? { duracion: entrada.duracion } : {}) });
      lectura = normalizarLectura(lectura);
      procedencia.push({ fase: 'metadatos', proveedor: puertos.redactor.nombre, ms: reloj() - t, detalle: { campos: Object.keys(lectura) } });
    } catch (e) {
      procedencia.push({ fase: 'metadatos', proveedor: puertos.redactor.nombre, ms: reloj() - t, detalle: { error: String((e as Error)?.message ?? e).slice(0, 200) } });
    }
    candidatos.push({ fuente: 'lectura', confianza: 0.8, datos: lectura });
  }
  if (entrada.idiomaLectura) candidatos.push({ fuente: 'lectura', confianza: 0.85, datos: { idioma: entrada.idiomaLectura } });
  const provisional = fusionarMetadatos(candidatos, entrada.nombreArchivo);

  const medio = entrada.tipo === 'audio' || entrada.tipo === 'video';
  if (!opciones.sinVerificacion && !medio) {
    const t = reloj();
    const http: Http = puertos.http ?? ((url, init) => fetch(url, init as RequestInit));
    const { registro, consultas } = await verificar(provisional, http, puertos.correo);
    procedencia.push({ fase: 'metadatos', proveedor: registro?.fuente ?? 'verificacion', ms: reloj() - t, detalle: { consultas: consultas.length, encontrado: Boolean(registro), puntuacion: registro?.puntuacion ?? 0, titulo: registro?.titulo } });
    if (registro) {
      const { fuente, puntuacion, ...datos } = registro;
      // El registro externo no sabe del libro concreto: su año es el de la obra; si la lectura ve otra edición, manda la lectura.
      if (datos.anio && provisional.anio && Math.abs(datos.anio - provisional.anio) > 1 && provisional.tipoCSL === 'book') {
        if (!provisional.anioOriginal && datos.anio < provisional.anio) datos.anioOriginal = datos.anio;
        delete datos.anio;
      }
      candidatos.push({ fuente, confianza: 0.85 + 0.1 * Math.min(1, puntuacion ?? 0), datos });
    }
  }
  if (entrada.usuario) candidatos.push({ fuente: 'usuario', confianza: 1, datos: entrada.usuario });
  return { metadatos: fusionarMetadatos(candidatos, entrada.nombreArchivo), procedencia };
}

/** Repara la salida del Redactor: autores sin partir, años como texto, DOI con prefijo. */
export function normalizarLectura(l: Partial<MetadatosDocumento>): Partial<MetadatosDocumento> {
  const r: Partial<MetadatosDocumento> = { ...l };
  for (const k of Object.keys(r) as Campo[]) if (vacio(r[k])) delete r[k];
  if (r.autores) r.autores = r.autores.flatMap((a) => (a.nombre || !a.apellidos?.includes(' ') ? [a] : partirAutores(a.apellidos, r.idioma))).filter((a) => a.apellidos || a.nombre).map((a) => (a.apellidos ? a : separarNombre(a.nombre, r.idioma)));
  if (r.anio !== undefined) { const a = anioDe(r.anio); if (a) r.anio = a; else delete r.anio; }
  if (r.anioOriginal !== undefined) { const a = anioDe(r.anioOriginal); if (a) r.anioOriginal = a; else delete r.anioOriginal; }
  if (r.doi) { const d = limpiarDoi(r.doi); if (d) r.doi = d; else delete r.doi; }
  if (r.idioma) r.idioma = r.idioma.toLowerCase().slice(0, 5);
  if (r.titulo) r.titulo = limpiarTitulo(r.titulo);
  return r;
}
