/**
 * Enlace con Wikidata mediante la API pública `wbsearchentities` (gratuita,
 * sin clave). Cortés: una petición cada vez, con pausa, un User-Agent que dice
 * quién llama y caché permanente en la estantería (la misma consulta no sale
 * dos veces). Solo se enlaza una coincidencia exacta del nombre o de un alias
 * cuya descripción no contradiga el tipo.
 */

import type { SQL } from '@scholaris/nucleo';
import type { TipoEntidad } from '@scholaris/contrato';
import { ahora, deJSON, normalizarClave } from '../util.js';
import { palabrasSignificativas } from './normalizar.js';
import { DESCRIPCION_FICCION } from './resolver.js';

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
const NO_ES: Partial<Record<TipoEntidad, RegExp>> = {
  persona: /\b(apellido|nombre de pila|nombre propio|family name|surname|given name|male given|female given|película|film|álbum|album|canción|song|novela|novel|libro|book|ciudad|city|municipio|town|pueblo|village|país|country|río|river|banda|band|empresa|company|asteroide|asteroid|cráter|crater|género|genus|especie|species|barco|ship)\b/i,
  obra: /\b(apellido|family name|surname|given name|nombre de pila|ciudad|city|municipio|town|village|asteroide|asteroid|género|genus|especie|species)\b/i,
  lugar: /\b(apellido|family name|surname|given name|nombre de pila|película|film|álbum|album|canción|song|novela|novel|banda|band)\b/i,
  organizacion: /\b(apellido|family name|surname|given name|nombre de pila|canción|song|asteroide|asteroid)\b/i,
  evento: /\b(apellido|family name|surname|given name|nombre de pila)\b/i,
  concepto: /\b(apellido|family name|surname|given name|nombre de pila|película|film|álbum|album|canción|song|banda|band)\b/i,
};
const DESAMBIGUACION = /desambiguaci|disambiguation|página de wikimedia|wikimedia (list|category)|categoría de wikimedia|lista de wikimedia/i;

const FICCION = /personaje|character|ficticio|ficticia|fictional|ficción|fiction/i;
/** Lo que describe una obra: si la descripción no lo dice, no es la obra. */
const ES_OBRA = /novela|cuento|relato|libro|obra|ensayo|poema|poemario|película|film|álbum|album|canción|song|single|sencillo|artículo|article|paper|cuadro|pintura|painting|ópera|opera|comedia|tragedia|drama|teatro|play|novel|book|story|poem|essay|composición|composition|sinfonía|symphony|serie|series|revista|periódico|tratado|treatise|épica|epic|cantar|romance|manuscrito|texto|text|diálogo|dialogue|work|disco|pieza|piece|standard|tema musical/i;

/**
 * El candidato de Wikidata para un nombre, o nada. Los personajes de ficción
 * no se enlazan; las personas reales, nunca con personajes; las obras, solo
 * con algo cuya descripción diga que es una obra.
 */
export function elegirCandidato(nombre: string, tipo: TipoEntidad, cs: readonly CandidatoWikidata[], ficticia = false): CandidatoWikidata | null {
  const clave = normalizarClave(nombre);
  for (const c of cs) {
    const exacta = normalizarClave(c.etiqueta) === clave || normalizarClave(c.coincide) === clave;
    if (!exacta) continue;
    const d = c.descripcion ?? '';
    if (DESAMBIGUACION.test(d)) continue;
    // Los personajes de ficción no se enlazan: los homónimos en Wikidata son casi siempre otros.
    if (tipo === 'persona' && ficticia) return null;
    if (/videojuego|video game/i.test(d) && tipo !== 'obra') continue;
    if (NO_ES[tipo]?.test(d) || (tipo === 'persona' && FICCION.test(d))) continue;
    if (tipo === 'obra' && !ES_OBRA.test(d)) continue;
    // Sin descripción no hay forma de saber si es lo que buscamos.
    if (!d) continue;
    return c;
  }
  return null;
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
export async function enlazarWikidata(sql: SQL, o: OpcionesWikidata = {}): Promise<{ consultadas: number; enlazadas: number }> {
  const f = o.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!f) return { consultadas: 0, enlazadas: 0 };
  const maximo = o.maximo ?? 80, pausa = o.pausa ?? 120, idiomas = o.idiomas ?? ['es', 'en'];
  const filas = await sql.ejecutar<{ id: string; tipo: TipoEntidad; nombre: string; clave: string; descripcion: string | null }>(
    `SELECT id, tipo, nombre, clave, descripcion FROM entidades
      WHERE fusionada_en IS NULL AND wikidata IS NULL AND wikidata_visto = 0
        AND tipo IN (${ENLAZABLES.map(() => '?').join(', ')}) AND (n_menciones >= 2 OR n_documentos >= 2)
      ORDER BY n_documentos DESC, n_menciones DESC LIMIT ?`,
    ...ENLAZABLES, maximo * 2,
  );
  let consultadas = 0, enlazadas = 0;
  for (const e of filas) {
    if (consultadas >= maximo) break;
    if (e.descripcion === DESCRIPCION_FICCION || (e.tipo === 'persona' && palabrasSignificativas(e.clave).length < 2)) {
      await sql.ejecutar('UPDATE entidades SET wikidata_visto = 1 WHERE id = ?', e.id);
      continue;
    }
    let elegido: CandidatoWikidata | null = null;
    try {
      for (const idioma of idiomas) {
        const enCache = (await sql.ejecutar('SELECT 1 FROM entidades_wikidata WHERE consulta = ? AND idioma = ?', e.nombre.trim(), idioma)).length > 0;
        const cs = await buscarWikidata(sql, e.nombre, idioma, f);
        if (!enCache) {
          consultadas++;
          if (pausa) await new Promise((r) => setTimeout(r, pausa));
        }
        elegido = elegirCandidato(e.nombre, e.tipo, cs, e.descripcion === DESCRIPCION_FICCION);
        if (elegido) break;
      }
    } catch {
      // Sin red o con Wikidata caído: se vuelve a intentar en otra pasada.
      break;
    }
    await sql.ejecutar(
      'UPDATE entidades SET wikidata_visto = 1, wikidata = COALESCE(?, wikidata), descripcion = COALESCE(?, descripcion), actualizada = ? WHERE id = ?',
      elegido?.id ?? null, elegido?.descripcion ?? null, ahora(), e.id,
    );
    if (elegido) enlazadas++;
  }
  return { consultadas, enlazadas };
}
