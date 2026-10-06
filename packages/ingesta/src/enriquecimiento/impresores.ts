/**
 * Impresos sin fecha («s. f.»): una horquilla plausible SOLO si hay pruebas.
 *
 * La prueba es el pie de imprenta: los años de actividad del impresor. Primero
 * una tabla corta con fichas de autoridad comprobadas (BNE); después, Wikidata
 * (periodo de actividad, o nacimiento y muerte). En «Viuda de X» la muerte de X
 * es la cota inferior. Todo se guarda como incierto.
 */

import { normalizar } from '../texto.js';
import { anioDeFecha, wikidataBuscar } from './fuentes.js';
import type { Consultor } from './red.js';

export interface ActividadImpresor {
  nombre: string;
  lugar?: string;
  desde?: number;
  hasta?: number;
  fundamento: string;
  confianza: number;
}

/** Fichas comprobadas a mano (añadir solo con fuente). */
const TABLA: Array<{ patron: RegExp } & ActividadImpresor> = [
  {
    patron: /viuda\s+de\s+francisco\s+(?:de\s+)?leefdael/i,
    nombre: 'Viuda de Francisco de Leefdael', lugar: 'Sevilla', desde: 1729, hasta: 1753,
    fundamento: 'Imprenta de la Viuda de Francisco de Leefdael, Sevilla, Casa del Correo Viejo; activa h. 1729-1753 (BNE, autoridad XX4965433: «fl. 1729-1753?»)',
    confianza: 0.6,
  },
  {
    patron: /^(?!.*viuda).*francisco\s+(?:de\s+)?leefdael/i,
    nombre: 'Francisco de Leefdael', lugar: 'Sevilla', desde: 1701, hasta: 1728,
    fundamento: 'Francisco de Leefdael, impresor en Sevilla, m. 1728 (BNE, autoridad XX1351271: «1669-1728»)',
    confianza: 0.55,
  },
];

const PERSONA_IMPRESOR = /impresor|printer|tipógrafo|typographer|editor|librero|bookseller|imprenta|printing/i;

/** Años de actividad del impresor de un pie de imprenta. */
export async function actividadImpresor(impresor: string, red: Consultor | null): Promise<ActividadImpresor | null> {
  for (const f of TABLA) if (f.patron.test(impresor)) { const { patron: _p, ...r } = f; return r; }
  if (!red) return null;
  const viuda = /^(?:la\s+)?viuda\s+de\s+(.+)$/i.exec(impresor.trim());
  const herederos = /^(?:los\s+)?herederos\s+de\s+(.+)$/i.exec(impresor.trim());
  const persona = (viuda?.[1] ?? herederos?.[1] ?? impresor).replace(/^(?:la\s+)?imprenta\s+de\s+/i, '').trim();
  const ents = await wikidataBuscar(persona, red, 'es', 5);
  const e = ents.find((x) => normalizar(x.etiqueta).replace(/\bde\b/g, '').replace(/\s+/g, ' ') === normalizar(persona).replace(/\bde\b/g, '').replace(/\s+/g, ' ') && PERSONA_IMPRESOR.test(x.descripcion ?? ''));
  if (!e) return null;
  // wikidataBuscar no trae nacimiento ni muerte de la entidad buscada: se piden aparte.
  const j = await red.json<{ results?: { bindings?: Array<Record<string, { value: string } | undefined>> } }>(
    `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(`SELECT ?nac ?muerte ?ini ?fin ?flor WHERE { OPTIONAL { wd:${e.id} wdt:P569 ?nac } OPTIONAL { wd:${e.id} wdt:P570 ?muerte } OPTIONAL { wd:${e.id} wdt:P2031 ?ini } OPTIONAL { wd:${e.id} wdt:P2032 ?fin } OPTIONAL { wd:${e.id} wdt:P1317 ?flor } } LIMIT 5`)}`,
    { Accept: 'application/sparql-results+json' },
  );
  const fila = j?.results?.bindings?.[0] ?? {};
  const nac = anioDeFecha(fila.nac?.value), muerte = anioDeFecha(fila.muerte?.value);
  const ini = anioDeFecha(fila.ini?.value) ?? anioDeFecha(fila.flor?.value), fin = anioDeFecha(fila.fin?.value);
  if (viuda || herederos) {
    if (!muerte) return null;
    return { nombre: impresor, desde: muerte, fundamento: `${viuda ? 'Viuda' : 'Herederos'} de ${e.etiqueta}, que murió en ${muerte} (Wikidata ${e.id})`, confianza: 0.45 };
  }
  const desde = ini ?? (nac ? nac + 18 : undefined), hasta = fin ?? muerte;
  if (!desde && !hasta) return null;
  return { nombre: e.etiqueta, ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), fundamento: `${e.etiqueta}, actividad según Wikidata ${e.id}`, confianza: ini || fin ? 0.5 : 0.4 };
}
