/**
 * Lo que Wikidata sabe de la obra de cada documento, para la detección de
 * relaciones: P144 («basada en»), P4969 («obra derivada»), P629 («edición de»),
 * P747 («tiene edición»), P655 (traductor), P58 (guionista), P50 (autor), P57
 * (director), P170 (creador), P1877 («según una obra de»), P407/P364 (lengua) y
 * P577 (fecha). Es contexto externo: cada prueba lleva la URL del dato.
 *
 * Cortés con la API pública (una petición cada vez, con agente que dice quién
 * llama) y con caché en la estantería (tabla `entidades_wikidata` de las
 * funciones, con claves propias «transmedia:…»): la misma consulta no sale dos veces.
 */
import type { SQL } from '@scholaris/nucleo';
import { AGENTE } from '../comprension/reparto.js';
import { lengua, normalizar, type Obra } from './obras.js';

const API = 'https://www.wikidata.org/w/api.php';

export const PROPIEDADES = ['P31', 'P144', 'P4969', 'P629', 'P747', 'P655', 'P58', 'P50', 'P57', 'P170', 'P1877', 'P407', 'P364', 'P577'] as const;
type Propiedad = (typeof PROPIEDADES)[number];

/** Nombre de cada propiedad, para las notas legibles. */
export const NOMBRE_PROPIEDAD: Record<Propiedad, string> = {
  P31: 'instancia de', P144: 'basada en', P4969: 'obra derivada', P629: 'edición o traducción de', P747: 'tiene edición o traducción',
  P655: 'traductor', P58: 'guionista', P50: 'autor', P57: 'director', P170: 'creador', P1877: 'según una obra de', P407: 'lengua', P364: 'lengua original', P577: 'fecha de publicación',
};

export interface ObraWikidata {
  qid: string;
  etiqueta: string;
  descripcion?: string;
  /** Valores de cada propiedad: QIDs (o el año, en P577). */
  claims: Partial<Record<Propiedad, string[]>>;
  /** Etiquetas de las personas que aparecen en los claims (autor, guionista, traductor…). */
  personas: Record<string, string>;
}

interface Busqueda { id: string; label?: string; description?: string; match?: { type?: string; text?: string } }
interface EntidadWd { id: string; labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }

async function cache<T>(sql: SQL, consulta: string, idioma: string, fn: () => Promise<T>): Promise<T> {
  try {
    const [f] = await sql.ejecutar<{ respuesta: string }>('SELECT respuesta FROM entidades_wikidata WHERE consulta = ? AND idioma = ?', consulta, idioma);
    if (f) return JSON.parse(String(f.respuesta)) as T;
  } catch { /* sin el esquema de las funciones: sin caché */ }
  const r = await fn();
  try {
    await sql.ejecutar('INSERT OR REPLACE INTO entidades_wikidata (consulta, idioma, respuesta, creada) VALUES (?, ?, ?, ?)', consulta, idioma, JSON.stringify(r), new Date().toISOString());
  } catch { /* sin caché */ }
  return r;
}

async function pedir<T>(f: typeof fetch, params: Record<string, string>): Promise<T> {
  const r = await f(`${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'user-agent': AGENTE, 'api-user-agent': AGENTE } });
  if (!r.ok) throw new Error(`Wikidata respondió ${r.status}`);
  return (await r.json()) as T;
}

function valores(e: EntidadWd, p: Propiedad): string[] {
  const salida: string[] = [];
  for (const c of e.claims?.[p] ?? []) {
    const v = c.mainsnak?.datavalue?.value as { id?: string; time?: string } | undefined;
    if (v?.id) salida.push(v.id);
    else if (v?.time) { const m = /([+-]\d{4})/.exec(v.time); if (m) salida.push(String(Number(m[1]))); }
  }
  return salida;
}

async function entidades(f: typeof fetch, sql: SQL, ids: string[], idiomas: string[]): Promise<Map<string, EntidadWd>> {
  const salida = new Map<string, EntidadWd>();
  for (const id of [...new Set(ids)]) {
    const e = await cache(sql, `transmedia:entidad:${id}`, 'wd', async () => {
      const r = await pedir<{ entities?: Record<string, EntidadWd> }>(f, { action: 'wbgetentities', ids: id, props: 'labels|descriptions|claims', languages: [...new Set([...idiomas, 'es', 'en'])].join('|') });
      const x = r.entities?.[id];
      if (!x) return null;
      // Solo lo que hace falta: etiquetas, descripciones y las propiedades de la lista.
      const claims: EntidadWd['claims'] = {};
      for (const p of PROPIEDADES) if (x.claims?.[p]) claims[p] = x.claims[p]!.map((c) => ({ mainsnak: { datavalue: { value: c.mainsnak?.datavalue?.value } } }));
      return { id: x.id, labels: x.labels ?? {}, descriptions: x.descriptions ?? {}, claims } as EntidadWd;
    });
    if (e) salida.set(id, e);
  }
  return salida;
}

const etiqueta = (e: EntidadWd | undefined, idiomas: string[]) => {
  for (const l of idiomas) { const v = e?.labels?.[l]?.value; if (v) return v; }
  return Object.values(e?.labels ?? {})[0]?.value ?? '';
};
const descripcion = (e: EntidadWd | undefined, idiomas: string[]) => {
  for (const l of idiomas) { const v = e?.descriptions?.[l]?.value; if (v) return v; }
  return Object.values(e?.descriptions ?? {})[0]?.value;
};

/** Lo que dice la descripción de un candidato sobre su medio. */
const PELICULA = /pel[ií]cula|film|movie|serie|documental|documentary|cortometraje|largometraje|telefilm/i;
const AUDIO = /[áa]lbum|album|canci[oó]n|song|podcast|programa de radio|radio|disco|single|sencillo|grabaci/i;
const TEXTO = /cuento|relato|novela|libro|obra|poema|poemario|ensayo|short story|novel|book|story|poem|essay|edici[oó]n|edition|traducci[oó]n|translation|play|drama|tragedia|comedia|teatro|art[ií]culo|article|tratado|treatise|cr[oó]nica|novella|nouvelle|racconto|romanzo|libro de|written work|literary work/i;

/**
 * La obra de un documento en Wikidata: busca el título (en la lengua del documento
 * y en inglés), se queda con los candidatos cuyo título casa exacto y cuya
 * descripción no contradice el medio, y puntúa por autoría y año. Si hay duda, nada.
 */
export async function obraWikidata(f: typeof fetch, sql: SQL, o: Obra): Promise<ObraWikidata | null> {
  if (!o.titulo.trim()) return null;
  const idiomas = [...new Set([o.idioma || 'es', 'es', 'en'])];
  const vistos = new Map<string, Busqueda>();
  for (const l of [o.idioma || 'es', 'en']) {
    const r = await cache(sql, `transmedia:buscar:${normalizar(o.titulo)}`, l, async () => {
      const x = await pedir<{ search?: Busqueda[] }>(f, { action: 'wbsearchentities', search: o.titulo, language: l, uselang: l, type: 'item', limit: '12' });
      return (x.search ?? []).map((c) => ({ id: c.id, label: c.label, description: c.description, match: c.match }));
    });
    for (const c of r) if (!vistos.has(c.id)) vistos.set(c.id, c);
  }
  const titulo = normalizar(o.titulo);
  const exactos = [...vistos.values()].filter((c) => normalizar(c.match?.text ?? c.label ?? '') === titulo || normalizar(c.label ?? '') === titulo);
  const delMedio = exactos.filter((c) => {
    const d = c.description ?? '';
    if (!d) return true;
    if (o.medio === 'video') return PELICULA.test(d);
    if (o.medio === 'audio') return AUDIO.test(d) || TEXTO.test(d);
    return TEXTO.test(d) && !PELICULA.test(d);
  }).slice(0, 6);
  if (!delMedio.length) return null;
  const datos = await entidades(f, sql, delMedio.map((c) => c.id), idiomas);
  // Las personas de los candidatos (autor, director, guionista, creador), para casar con la autoría.
  const personasIds = [...new Set([...datos.values()].flatMap((e) => (['P50', 'P57', 'P58', 'P170', 'P655'] as const).flatMap((p) => valores(e, p))))].slice(0, 30);
  const personas = await entidades(f, sql, personasIds, idiomas);
  let mejor: { c: Busqueda; e: EntidadWd; puntos: number } | null = null;
  for (const c of delMedio) {
    const e = datos.get(c.id);
    if (!e) continue;
    let puntos = 1;
    const desc = normalizar(c.description ?? '');
    const nombres = (['P50', 'P57', 'P58', 'P170'] as const).flatMap((p) => valores(e, p)).map((q) => normalizar(etiqueta(personas.get(q), idiomas)));
    if (o.apellidos.some((a) => desc.split(' ').includes(a.split(' ').slice(-1)[0]!) || nombres.some((n) => n.includes(a)))) puntos += 3;
    else if (o.apellidos.length && nombres.length) puntos -= 1;
    const anio = Number(valores(e, 'P577')[0] ?? NaN);
    const anios = [o.doc.metadatos.anio, o.doc.metadatos.anioOriginal].filter((x): x is number => typeof x === 'number');
    if (!Number.isNaN(anio) && anios.length) puntos += anios.some((x) => Math.abs(x - anio) <= 1) ? 2 : -2;
    if (!mejor || puntos > mejor.puntos) mejor = { c, e, puntos };
  }
  if (!mejor || mejor.puntos < 2) return null;
  const claims: ObraWikidata['claims'] = {};
  for (const p of PROPIEDADES) { const v = valores(mejor.e, p); if (v.length) claims[p] = v; }
  const nombresPersonas: Record<string, string> = {};
  for (const p of ['P50', 'P57', 'P58', 'P170', 'P655'] as const) for (const q of claims[p] ?? []) nombresPersonas[q] = etiqueta(personas.get(q), idiomas) || q;
  return {
    qid: mejor.e.id, etiqueta: etiqueta(mejor.e, idiomas) || o.titulo, ...(descripcion(mejor.e, idiomas) ? { descripcion: descripcion(mejor.e, idiomas)! } : {}),
    claims, personas: nombresPersonas,
  };
}

/** La URL de un dato de Wikidata (para el ancla de la prueba). */
export const urlWikidata = (qid: string, p?: string) => `https://www.wikidata.org/wiki/${qid}${p ? `#${p}` : ''}`;

/** ¿Son la misma lengua? (P407/P364 en Wikidata frente a la del documento: Q1321 español, Q1860 inglés…). */
export const LENGUAS_WIKIDATA: Record<string, string> = { Q1321: 'es', Q1860: 'en', Q150: 'fr', Q652: 'it', Q188: 'de', Q5146: 'pt', Q397: 'la', Q7026: 'ca', Q9288: 'he', Q13955: 'ar', Q7737: 'ru' };
export const lenguaDe = (w: ObraWikidata | null, o: Obra) => lengua(o.idioma) || LENGUAS_WIKIDATA[(w?.claims.P407 ?? w?.claims.P364 ?? [])[0] ?? ''] || '';
