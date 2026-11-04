/**
 * Quién interpreta a quién (docs/COMPRENSION.md, paso 4): el reparto de una obra
 * audiovisual en Wikidata, P161 («miembro del reparto») con sus calificadores
 * P453 («papel», un elemento) y P4633 («nombre del papel», una cadena).
 *
 * Es contexto externo: lo que diga Wikidata no se presenta como si lo dijera la
 * obra, pero sirve para unir actor y personaje en el grafo de la biblioteca.
 */
import type { Documento } from '@scholaris/nucleo';

export const AGENTE = 'Scholaris/2.0 (https://scholaris.joseluissaorin.com; jl@joseluissaorin.com)';
const API = 'https://www.wikidata.org/w/api.php';

export interface PapelWikidata {
  actor: { qid: string; nombre: string };
  personaje?: { qid?: string; nombre: string };
}

interface Afirmacion {
  mainsnak?: { datavalue?: { value?: { id?: string } | string } };
  qualifiers?: Record<string, Array<{ datavalue?: { value?: { id?: string } | string } }>>;
}
interface EntidadWd {
  id: string;
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Afirmacion[]>;
}

/** Caché de respuestas de Wikidata (la plataforma usa la tabla `entidades_wikidata` de las funciones). */
export interface CacheWikidata {
  leer(clave: string): Promise<string | null>;
  guardar(clave: string, valor: string): Promise<void>;
}

/** Cada petición a Wikidata, como mucho esto: desde Workers a veces no contesta o tarda. */
export const ESPERA_WIKIDATA_MS = 8_000;

async function pedir<T>(f: typeof fetch, params: Record<string, string>, cache?: CacheWikidata | null): Promise<T> {
  const consulta = new URLSearchParams({ format: 'json', origin: '*', ...params }).toString();
  const clave = `wd:${consulta}`;
  const guardada = await cache?.leer(clave).catch(() => null);
  if (guardada) return JSON.parse(guardada) as T;
  // Agente propio (Wikimedia rechaza o frena las peticiones sin él) y tiempo acotado: nunca bloquea el paso.
  const r = await f(`${API}?${consulta}`, { headers: { 'user-agent': AGENTE, 'api-user-agent': AGENTE }, signal: AbortSignal.timeout(ESPERA_WIKIDATA_MS) });
  if (!r.ok) throw new Error(`Wikidata respondió ${r.status}`);
  const texto = await r.text();
  const json = JSON.parse(texto) as T;
  await cache?.guardar(clave, texto.slice(0, 200_000)).catch(() => undefined);
  return json;
}

const etiqueta = (e: EntidadWd | undefined, idiomas: string[]) => {
  for (const l of idiomas) { const v = e?.labels?.[l]?.value; if (v) return v; }
  return Object.values(e?.labels ?? {})[0]?.value;
};

async function entidades(f: typeof fetch, ids: string[], props: string, idiomas: string[], cache?: CacheWikidata | null): Promise<Map<string, EntidadWd>> {
  const salida = new Map<string, EntidadWd>();
  for (let i = 0; i < ids.length; i += 50) {
    const r = await pedir<{ entities?: Record<string, EntidadWd> }>(f, { action: 'wbgetentities', ids: ids.slice(i, i + 50).join('|'), props, languages: idiomas.join('|') }, cache);
    for (const [k, v] of Object.entries(r.entities ?? {})) salida.set(k, v);
  }
  return salida;
}

const ANIO = (e: EntidadWd) => {
  const v = e.claims?.P577?.[0]?.mainsnak?.datavalue?.value as { time?: string } | undefined;
  const m = /([+-]\d{4})/.exec(v?.time ?? '');
  return m ? Number(m[1]) : undefined;
};

/** Busca la obra audiovisual en Wikidata por título y año (y, si hace falta, por director). */
export async function buscarObraAudiovisual(f: typeof fetch, doc: Pick<Documento, 'metadatos'>, cache?: CacheWikidata | null): Promise<string | null> {
  const titulo = doc.metadatos.titulo?.trim();
  if (!titulo) return null;
  const idioma = doc.metadatos.idioma?.slice(0, 2) || 'es';
  const r = await pedir<{ search?: Array<{ id: string; description?: string }> }>(f, { action: 'wbsearchentities', search: titulo, language: idioma, uselang: idioma, type: 'item', limit: '10' }, cache);
  const candidatas = (r.search ?? []).filter((c) => /pel[ií]cula|film|movie|serie|documental|cortometraje|largometraje/i.test(c.description ?? ''));
  if (!candidatas.length) return null;
  const datos = await entidades(f, candidatas.map((c) => c.id), 'claims', [idioma, 'en'], cache);
  const anio = doc.metadatos.anio;
  const apellidos = (doc.metadatos.autores ?? []).map((a) => (a.apellidos || a.nombre || '').toLowerCase()).filter(Boolean);
  let mejor: { id: string; puntos: number } | null = null;
  for (const c of candidatas) {
    const e = datos.get(c.id);
    if (!e?.claims?.P161) continue;
    let puntos = 1;
    const a = ANIO(e);
    if (anio && a) puntos += Math.abs(a - anio) <= 1 ? 3 : -3;
    if (apellidos.length && apellidos.some((x) => (c.description ?? '').toLowerCase().includes(x))) puntos += 2;
    if (!mejor || puntos > mejor.puntos) mejor = { id: c.id, puntos };
  }
  return mejor && mejor.puntos > 0 ? mejor.id : null;
}

/** El reparto con los papeles de una obra (P161 + P453/P4633). */
export async function repartoWikidata(f: typeof fetch, qid: string, idiomas = ['es', 'en'], cache?: CacheWikidata | null): Promise<PapelWikidata[]> {
  const obra = (await entidades(f, [qid], 'claims', idiomas, cache)).get(qid);
  const reparto = obra?.claims?.P161 ?? [];
  const filas: Array<{ actor: string; papel?: string; nombrePapel?: string }> = [];
  for (const a of reparto) {
    const actor = (a.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id;
    if (!actor) continue;
    const papeles = (a.qualifiers?.P453 ?? []).map((q) => (q.datavalue?.value as { id?: string } | undefined)?.id).filter((x): x is string => !!x);
    const nombres = (a.qualifiers?.P4633 ?? []).map((q) => q.datavalue?.value).filter((x): x is string => typeof x === 'string');
    if (!papeles.length && !nombres.length) filas.push({ actor });
    papeles.forEach((p, i) => filas.push({ actor, papel: p, ...(nombres[i] ? { nombrePapel: nombres[i] } : {}) }));
    if (!papeles.length) for (const n of nombres) filas.push({ actor, nombrePapel: n });
  }
  const ids = [...new Set(filas.flatMap((x) => [x.actor, ...(x.papel ? [x.papel] : [])]))];
  const nombres = await entidades(f, ids, 'labels', idiomas, cache);
  return filas.map((x) => {
    const actor = { qid: x.actor, nombre: etiqueta(nombres.get(x.actor), idiomas) ?? x.actor };
    const nombrePapel = x.nombrePapel ?? (x.papel ? etiqueta(nombres.get(x.papel), idiomas) : undefined);
    return nombrePapel ? { actor, personaje: { ...(x.papel ? { qid: x.papel } : {}), nombre: nombrePapel } } : { actor };
  });
}
