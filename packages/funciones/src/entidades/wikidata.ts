/**
 * Enlace con Wikidata mediante la API pública `wbsearchentities` (gratuita,
 * sin clave). Cortés: una petición cada vez, con pausa, un User-Agent que dice
 * quién llama y caché permanente en la estantería (la misma consulta no sale
 * dos veces). Solo se enlaza una coincidencia exacta del nombre o de un alias
 * cuya descripción no contradiga el tipo.
 */

import type { SQL } from '@scholaris/nucleo';
import type { TipoEntidad } from '@scholaris/contrato';
import { ahora, deJSON, normalizarClave, num } from '../util.js';
import { claveEntidad, contextoMencion, descripcionCorroborada, palabrasSignificativas } from './normalizar.js';

export const AGENTE_WIKIDATA = 'Scholaris/2.0 (https://scholaris.app; jl@joseluissaorin.com)';
const API = 'https://www.wikidata.org/w/api.php';

export interface CandidatoWikidata {
  id: string;
  etiqueta: string;
  descripcion?: string;
  /** Texto con el que casó (etiqueta o alias). */
  coincide?: string;
}

/** Descripciones que delatan otro tipo de cosa. */
export const NO_ES: Partial<Record<TipoEntidad, RegExp>> = {
  persona: /\b(obra|edición|edition|written work|work by|escuela|school|biblioteca|library|museo|museum|calle|street|avenida|premio|award|fundación|foundation|apellido|nombre de pila|nombre propio|family name|surname|given name|male given|female given|película|film|álbum|album|canción|song|novela|novel|libro|book|ciudad|city|municipio|town|pueblo|village|país|country|río|river|banda|band|empresa|company|asteroide|asteroid|cráter|crater|género|genus|especie|species|barco|ship)\b/i,
  obra: /\b(apellido|family name|surname|given name|nombre de pila|ciudad|city|municipio|town|village|asteroide|asteroid|género|genus|especie|species)\b/i,
  lugar: /\b(apellido|family name|surname|given name|nombre de pila|película|film|álbum|album|canción|song|novela|novel|banda|band)\b/i,
  organizacion: /\b(apellido|family name|surname|given name|nombre de pila|canción|song|asteroide|asteroid)\b/i,
  evento: /\b(apellido|family name|surname|given name|nombre de pila)\b/i,
  concepto: /\b(apellido|family name|surname|given name|nombre de pila|película|film|álbum|album|canción|song|banda|band)\b/i,
};
export const DESAMBIGUACION = /desambiguaci|disambiguation|página de wikimedia|wikimedia (list|category)|categoría de wikimedia|lista de wikimedia/i;

export const FICCION = /personaje|character|ficticio|ficticia|fictional|ficción|fiction/i;
/** Lo que describe una obra: si la descripción no lo dice, no es la obra. */
const ES_OBRA = /novela|cuento|relato|libro|obra|ensayo|poema|poemario|película|film|álbum|album|canción|song|single|sencillo|artículo|article|paper|cuadro|pintura|painting|ópera|opera|comedia|tragedia|drama|teatro|play|novel|book|story|poem|essay|composición|composition|sinfonía|symphony|serie|series|revista|periódico|tratado|treatise|épica|epic|cantar|romance|manuscrito|texto|text|diálogo|dialogue|work|disco|pieza|piece|standard|tema musical/i;
/** Versiones de una obra que no son la obra: adaptaciones, traducciones, películas, discos. */
const DERIVADA = /película|film|movie|adaptaci|adaptation|traducci|translation|álbum|album|ópera|opera|serie de televisi|television|episodio|episode|videojuego|video game|cómic|comic|banda sonora|soundtrack|edición|edition/i;

/**
 * Lo que se sabe de una entidad por la biblioteca, para decidir entre
 * homónimos: los apellidos de los autores de los documentos donde aparece y de
 * las personas que la rodean, y los años de esos documentos.
 */
export interface PistasEntidad {
  apellidos: string[];
  anios: number[];
  /** Títulos de las obras con que aparece (para los personajes). */
  obras?: string[];
  /** Los pasajes donde se la menciona: una persona real solo se enlaza si confirman la descripción. */
  contexto?: string;
}

const contiene = (d: string, palabra: string) => palabra.length >= 3 && new RegExp(`(?<![\\p{L}])${palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(d);

/**
 * El candidato de Wikidata para un nombre, o nada (si hay duda, no se enlaza):
 *   - coincidencia exacta de etiqueta o alias, nunca una página de desambiguación;
 *   - personas reales: nunca un personaje; personajes de ficción: solo un
 *     personaje cuya descripción nombre la obra o al autor que conocemos;
 *   - obras: la descripción ha de decir que es una obra y nombrar a un autor
 *     de las pistas; se prefiere la que casa con el año y se descartan
 *     adaptaciones, traducciones y películas salvo que sean lo único que casa
 *     con el autor y el año;
 *   - con pistas para una persona, si alguna descripción las nombra, gana esa.
 */
export function elegirCandidato(nombre: string, tipo: TipoEntidad, cs: readonly CandidatoWikidata[], ficticia: boolean | null = false, pistas?: PistasEntidad): CandidatoWikidata | null {
  const clave = normalizarClave(nombre);
  // Las palabras del propio nombre no son pista («obra de Julio Cortázar» no prueba que sea Julio Cortázar).
  const propias = new Set(clave.split(' '));
  const apellidos = (pistas?.apellidos ?? []).map((a) => normalizarClave(a)).filter((a) => a.length >= 3 && (tipo !== 'persona' || !propias.has(a)));
  const obras = (pistas?.obras ?? []).map((a) => normalizarClave(a)).filter((a) => a.length >= 3);
  const validos: Array<{ c: CandidatoWikidata; puntos: number }> = [];
  for (const c of cs) {
    const exacta = normalizarClave(c.etiqueta) === clave || normalizarClave(c.coincide) === clave;
    if (!exacta) continue;
    const d = c.descripcion ?? '';
    // Sin descripción no hay forma de saber si es lo que buscamos.
    if (!d || DESAMBIGUACION.test(d)) continue;
    const dn = normalizarClave(d);
    const autor = apellidos.some((a) => contiene(dn, a));
    const anio = (pistas?.anios ?? []).some((x) => [x - 1, x, x + 1].some((y) => d.includes(String(y))));
    if (tipo === 'persona') {
      if (ficticia === null) return null;
      if (ficticia) {
        if (!FICCION.test(d)) continue;
        if (!(autor || obras.some((o) => contiene(dn, o)))) continue;
        validos.push({ c, puntos: 3 });
        continue;
      }
      if (FICCION.test(d) || NO_ES.persona!.test(d)) continue;
      // «Cantante estadounidense» no es el saxofonista del que hablan los textos.
      if (pistas?.contexto !== undefined && !autor && !descripcionCorroborada(d, pistas.contexto)) continue;
      validos.push({ c, puntos: (autor ? 2 : 0) + (anio ? 1 : 0) });
      continue;
    }
    if (/videojuego|video game/i.test(d) && tipo !== 'obra') continue;
    if (NO_ES[tipo]?.test(d)) continue;
    if (tipo === 'obra') {
      if (!ES_OBRA.test(d) || !autor) continue;
      validos.push({ c, puntos: 3 + (anio ? 2 : 0) - (DERIVADA.test(d) ? 3 : 0) });
      continue;
    }
    validos.push({ c, puntos: 0 });
  }
  if (!validos.length) return null;
  validos.sort((a, b) => b.puntos - a.puntos);
  const [mejor, segundo] = validos;
  // Una obra derivada que no casa con el año no basta.
  if (tipo === 'obra' && mejor!.puntos < 2) return null;
  // Varios homónimos sin nada que los distinga: solo vale el primero de Wikidata
  // (el más conocido) si también es el primero de la búsqueda; si no, hay duda.
  if (segundo && segundo.puntos === mejor!.puntos && mejor!.c !== cs[0]) return null;
  return mejor!.c;
}

/** Busca en Wikidata (o en la caché). */
export async function buscarWikidata(sql: SQL, nombre: string, idioma: string, f: typeof fetch): Promise<CandidatoWikidata[]> {
  const consulta = nombre.trim();
  const [cache] = await sql.ejecutar<{ respuesta: string }>('SELECT respuesta FROM entidades_wikidata WHERE consulta = ? AND idioma = ?', consulta, idioma);
  if (cache) return deJSON<CandidatoWikidata[]>(cache.respuesta, []);
  const url = `${API}?action=wbsearchentities&format=json&type=item&limit=7&language=${encodeURIComponent(idioma)}&uselang=${encodeURIComponent(idioma)}&search=${encodeURIComponent(consulta)}`;
  const r = await f(url, { headers: { 'user-agent': AGENTE_WIKIDATA, 'api-user-agent': AGENTE_WIKIDATA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Wikidata respondió ${r.status}`);
  const j = (await r.json()) as { search?: Array<{ id: string; label?: string; description?: string; match?: { text?: string } }> };
  const cs: CandidatoWikidata[] = (j.search ?? []).map((x) => ({
    id: x.id, etiqueta: x.label ?? '', ...(x.description ? { descripcion: x.description } : {}), ...(x.match?.text ? { coincide: x.match.text } : {}),
  }));
  await sql.ejecutar(
    'INSERT OR REPLACE INTO entidades_wikidata (consulta, idioma, respuesta, creada) VALUES (?, ?, ?, ?)',
    consulta, idioma, JSON.stringify(cs), ahora(),
  );
  return cs;
}

/**
 * La descripción de una entidad en el primer idioma de `idiomas` que la tenga (el de la
 * interfaz primero; el inglés, solo si no hay otra). La búsqueda la da en el idioma en
 * que se buscó, y al encontrar por la búsqueda inglesa salía «oldest son of Erasmus
 * Darwin…» en una interfaz española. Con caché: una sola petición por entidad.
 */
export async function descripcionWikidata(sql: SQL, qid: string, idiomas: string[], f: typeof fetch): Promise<string | null> {
  const clave = `descripcion:${qid}`, lenguas = idiomas.join('|');
  const [cache] = await sql.ejecutar<{ respuesta: string }>('SELECT respuesta FROM entidades_wikidata WHERE consulta = ? AND idioma = ?', clave, lenguas);
  if (cache) return deJSON<{ d: string | null }>(cache.respuesta, { d: null }).d;
  const url = `${API}?action=wbgetentities&format=json&props=descriptions&ids=${encodeURIComponent(qid)}&languages=${encodeURIComponent(lenguas)}`;
  const r = await f(url, { headers: { 'user-agent': AGENTE_WIKIDATA, 'api-user-agent': AGENTE_WIKIDATA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Wikidata respondió ${r.status}`);
  const j = (await r.json()) as { entities?: Record<string, { descriptions?: Record<string, { value?: string }> }> };
  const desc = j.entities?.[qid]?.descriptions ?? {};
  const d = idiomas.map((l) => desc[l]?.value?.trim()).find((x) => !!x) ?? null;
  await sql.ejecutar('INSERT OR REPLACE INTO entidades_wikidata (consulta, idioma, respuesta, creada) VALUES (?, ?, ?, ?)', clave, lenguas, JSON.stringify({ d }), ahora());
  return d;
}

export interface OpcionesWikidata {
  fetch?: typeof fetch;
  /** Consultas como mucho en esta pasada. */
  maximo?: number;
  /** Pausa entre peticiones a la red, en milisegundos. */
  pausa?: number;
  idiomas?: string[];
}

const ENLAZABLES: TipoEntidad[] = ['persona', 'obra', 'lugar', 'organizacion', 'evento'];

/**
 * Enlaza las entidades más presentes que aún no se han mirado. Las personas de
 * una sola palabra («Parker») no se buscan: son ambiguas por naturaleza.
 */
/** Las pistas de una entidad, sacadas de la estantería. */
export async function pistasDe(sql: SQL, id: string): Promise<PistasEntidad> {
  const docs = await sql.ejecutar<{ id: string; autores: string | null; anio: number | null; titulo: string | null; metadatos: string }>(
    'SELECT d.id, d.autores, d.anio, d.titulo, d.metadatos FROM documentos d WHERE d.id IN (SELECT DISTINCT documento FROM menciones WHERE entidad = ?)', id,
  );
  const apellidos = new Set<string>(), anios = new Set<number>(), obras = new Set<string>();
  for (const d of docs) {
    const m = deJSON<{ autores?: Array<{ apellidos?: string; nombre?: string }>; anio?: number; titulo?: string }>(d.metadatos, {});
    for (const a of m.autores ?? []) if (a.apellidos) apellidos.add(a.apellidos.split(/\s+/)[0]!);
    for (const a of String(d.autores ?? '').split(';')) { const x = a.trim().split(/\s+/).pop(); if (x) apellidos.add(x); }
    const anio = num(d.anio ?? m.anio, 0);
    if (anio) anios.add(anio);
    if (d.titulo ?? m.titulo) obras.add(String(d.titulo ?? m.titulo));
  }
  // Si es una obra que está en la biblioteca (un documento con su título), su autor y su año son la mejor pista.
  const [ent] = await sql.ejecutar<{ tipo: string; clave: string }>('SELECT tipo, clave FROM entidades WHERE id = ?', id);
  if (ent?.tipo === 'obra') {
    for (const d of await sql.ejecutar<{ titulo: string | null; autores: string | null; anio: number | null; metadatos: string }>('SELECT titulo, autores, anio, metadatos FROM documentos')) {
      if (!d.titulo || claveEntidad(d.titulo, 'obra') !== ent.clave) continue;
      const m = deJSON<{ autores?: Array<{ apellidos?: string }>; anio?: number; anioOriginal?: number }>(d.metadatos, {});
      for (const a of m.autores ?? []) if (a.apellidos) apellidos.add(a.apellidos.split(/\s+/)[0]!);
      const anio = num(m.anioOriginal ?? d.anio ?? m.anio, 0);
      if (anio) anios.add(anio);
    }
  }
  // Las personas reales y las obras que más la rodean.
  const vecinos = await sql.ejecutar<{ nombre: string; tipo: string; ficticia: number | null }>(
    `SELECT e.nombre, e.tipo, e.ficticia FROM (
       SELECT CASE WHEN a = ? THEN b ELSE a END AS otro, SUM(peso) AS peso FROM aristas_entidades WHERE a = ? OR b = ? GROUP BY otro ORDER BY peso DESC LIMIT 12
     ) v JOIN entidades e ON e.id = v.otro`,
    id, id, id,
  );
  for (const v of vecinos) {
    if (v.tipo === 'persona' && num(v.ficticia) !== 1) { const x = palabrasSignificativas(normalizarClave(v.nombre)).pop(); if (x) apellidos.add(x); }
    if (v.tipo === 'obra') obras.add(v.nombre);
  }
  return { apellidos: [...apellidos], anios: [...anios], obras: [...obras], contexto: await contextoDe(sql, id) };
}

/** Los pasajes donde aparece una entidad (unos pocos de cada documento), en un solo texto. */
export async function contextoDe(sql: SQL, id: string, porDocumento = 4, radio = 200): Promise<string> {
  const filas = await sql.ejecutar<{ documento: string; texto: string; ini: number; fin: number }>(
    `SELECT m.documento, f.texto, m.ini, m.fin FROM menciones m JOIN fragmentos f ON f.id = m.fragmento
      WHERE m.entidad = ? ORDER BY m.documento, m.orden LIMIT 200`, id,
  );
  const cuenta = new Map<string, number>();
  const trozos: string[] = [];
  for (const f of filas) {
    const n = cuenta.get(f.documento) ?? 0;
    if (n >= porDocumento) continue;
    cuenta.set(f.documento, n + 1);
    trozos.push(contextoMencion(f.texto, num(f.ini), num(f.fin), radio).replace(/[⟦⟧]/g, ''));
  }
  return trozos.join(' … ');
}

export async function enlazarWikidata(sql: SQL, o: OpcionesWikidata = {}): Promise<{ consultadas: number; enlazadas: number }> {
  const f = o.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!f) return { consultadas: 0, enlazadas: 0 };
  const maximo = o.maximo ?? 80, pausa = o.pausa ?? 120, idiomas = o.idiomas ?? ['es', 'en'];
  const filas = await sql.ejecutar<{ id: string; tipo: TipoEntidad; nombre: string; clave: string; descripcion: string | null; ficticia: number | null }>(
    `SELECT id, tipo, nombre, clave, descripcion, ficticia FROM entidades
      WHERE fusionada_en IS NULL AND wikidata IS NULL AND wikidata_visto = 0
        AND tipo IN (${ENLAZABLES.map(() => '?').join(', ')}) AND (n_menciones >= 2 OR n_documentos >= 2)
      ORDER BY n_documentos DESC, n_menciones DESC LIMIT ?`,
    ...ENLAZABLES, maximo * 2,
  );
  let consultadas = 0, enlazadas = 0;
  for (const e of filas) {
    if (consultadas >= maximo) break;
    // Personas de una sola palabra o sin saber si son reales: hay duda, no se buscan.
    if (e.tipo === 'persona' && (palabrasSignificativas(e.clave).length < 2 || e.ficticia === null || e.ficticia === undefined)) {
      await sql.ejecutar('UPDATE entidades SET wikidata_visto = 1 WHERE id = ?', e.id);
      continue;
    }
    let elegido: CandidatoWikidata | null = null;
    const ficticia = e.tipo === 'persona' ? num(e.ficticia) === 1 : false;
    const pistas = e.tipo === 'persona' || e.tipo === 'obra' ? await pistasDe(sql, e.id) : undefined;
    try {
      for (const idioma of idiomas) {
        const enCache = (await sql.ejecutar('SELECT 1 FROM entidades_wikidata WHERE consulta = ? AND idioma = ?', e.nombre.trim(), idioma)).length > 0;
        const cs = await buscarWikidata(sql, e.nombre, idioma, f);
        if (!enCache) {
          consultadas++;
          if (pausa) await new Promise((r) => setTimeout(r, pausa));
        }
        elegido = elegirCandidato(e.nombre, e.tipo, cs, ficticia, pistas);
        if (elegido) break;
      }
      // La descripción, en el idioma de la interfaz si Wikidata la tiene (si no, la de la búsqueda).
      if (elegido) {
        const d = await descripcionWikidata(sql, elegido.id, idiomas, f);
        consultadas++;
        if (d) elegido = { ...elegido, descripcion: d };
      }
    } catch {
      // Sin red o con Wikidata caído: se vuelve a intentar en otra pasada.
      break;
    }
    await sql.ejecutar(
      'UPDATE entidades SET wikidata_visto = 1, wikidata = ?, descripcion = COALESCE(?, descripcion), actualizada = ? WHERE id = ?',
      elegido?.id ?? null, elegido?.descripcion ?? null, ahora(), e.id,
    );
    if (elegido) enlazadas++;
  }
  // Las ya enlazadas antes de pedir la descripción en el idioma de la interfaz: se rehacen
  // una vez (la caché marca las ya miradas), dentro del mismo cupo de consultas.
  if (consultadas < maximo) {
    const viejas = await sql.ejecutar<{ id: string; wikidata: string }>(
      `SELECT id, wikidata FROM entidades e WHERE fusionada_en IS NULL AND wikidata IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM entidades_wikidata w WHERE w.consulta = 'descripcion:' || e.wikidata AND w.idioma = ?)
       ORDER BY n_documentos DESC, n_menciones DESC LIMIT ?`,
      idiomas.join('|'), maximo - consultadas,
    );
    for (const v of viejas) {
      let d: string | null;
      try { d = await descripcionWikidata(sql, v.wikidata, idiomas, f); } catch { break; }
      consultadas++;
      if (pausa) await new Promise((r) => setTimeout(r, pausa));
      if (d) await sql.ejecutar('UPDATE entidades SET descripcion = ?, actualizada = ? WHERE id = ?', d, ahora(), v.id);
    }
  }
  return { consultadas, enlazadas };
}
