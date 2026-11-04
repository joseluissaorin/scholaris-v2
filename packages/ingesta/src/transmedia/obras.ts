/**
 * La «obra» de cada documento tal como la ve la detección de relaciones: títulos
 * normalizados, autoría, traductores, lengua, medio y año. Normalizar es quitar
 * mayúsculas, tildes y puntuación: «El Lobo, El Bosque y El Hombre Nuevo» y «el
 * lobo el bosque y el hombre nuevo» son el mismo título.
 */
import type { Autor, Documento, SQL } from '@scholaris/nucleo';
import { leerDocumento } from '@scholaris/spdf';

export type Medio = 'texto' | 'video' | 'audio' | 'imagen';

export interface Obra {
  id: string;
  doc: Documento;
  titulo: string;
  /** Títulos normalizados por los que se la puede reconocer (título, título con subtítulo, título original). */
  titulos: string[];
  /** Nombres completos, para mostrar y comparar con Wikidata. */
  autores: string[];
  /** Apellidos tal como se escriben («Gutiérrez Alea»), para los rótulos. */
  firmas: string[];
  /** Apellidos normalizados de autores y editores. */
  apellidos: string[];
  traductores: string[];
  idioma: string;
  idiomaOriginal?: string;
  medio: Medio;
  anio?: number;
}

/** Minúsculas, sin diacríticos ni puntuación, con un espacio entre palabras. */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const nombre = (a: Autor) => [a.nombre, a.apellidos].filter(Boolean).join(' ').trim();
const apellidosDe = (as: readonly Autor[] | undefined) => (as ?? []).map((a) => normalizar(a.apellidos || a.nombre || '')).filter((x) => x.length >= 3);

export function medioDe(d: Pick<Documento, 'tipo'>): Medio {
  return d.tipo === 'video' ? 'video' : d.tipo === 'audio' ? 'audio' : d.tipo === 'imagen' ? 'imagen' : 'texto';
}

/** Lengua en dos letras («es-ES» → «es»). */
export const lengua = (x: string | undefined) => (x ?? '').toLowerCase().slice(0, 2);

export function obraDe(d: Documento): Obra {
  const m = d.metadatos;
  const titulos = [m.titulo, m.subtitulo ? `${m.titulo} ${m.subtitulo}` : '', m.tituloOriginal ?? '']
    .map((t) => normalizar(t ?? '')).filter((t, i, a) => t.length >= 3 && a.indexOf(t) === i);
  const anio = m.anioOriginal ?? m.anio;
  return {
    id: d.id, doc: d, titulo: m.titulo ?? '', titulos,
    autores: (m.autores ?? []).map(nombre).filter(Boolean),
    firmas: (m.autores ?? []).map((a) => (a.apellidos || a.nombre || '').trim()).filter(Boolean),
    apellidos: [...new Set([...apellidosDe(m.autores), ...apellidosDe(m.editores)])],
    traductores: (m.traductores ?? []).map(nombre).filter(Boolean),
    idioma: lengua(m.idioma), ...(m.idiomaOriginal ? { idiomaOriginal: lengua(m.idiomaOriginal) } : {}),
    medio: medioDe(d), ...(anio ? { anio } : {}),
  };
}

export async function leerObra(sql: SQL, id: string): Promise<Obra | null> {
  const d = await leerDocumento(sql, id);
  return d ? obraDe(d) : null;
}

/** Los documentos listos de la biblioteca (para comparar uno con todos). */
export async function obrasDeLaBiblioteca(sql: SQL, ids?: readonly string[]): Promise<Obra[]> {
  const filas = await sql.ejecutar<{ id: string }>("SELECT id FROM documentos WHERE estado = 'listo' ORDER BY creado");
  const quiero = ids ? new Set(ids) : null;
  const salida: Obra[] = [];
  for (const f of filas) {
    const id = String(f.id);
    if (quiero && !quiero.has(id)) continue;
    const o = await leerObra(sql, id);
    if (o) salida.push(o);
  }
  return salida;
}

/** «Fresa y chocolate» (Gutiérrez Alea, 1993): para las notas y los prompts. */
export function rotulo(o: Obra): string {
  const quien = o.firmas.length > 2 ? `${o.firmas[0]} et al.` : o.firmas.join(' y ');
  return `«${o.titulo}»${quien || o.anio ? ` (${[quien, o.anio].filter(Boolean).join(', ')})` : ''}`;
}

/** Qué clase de obra es, en español, para las notas. */
export function claseDeObra(o: Obra): string {
  const t = o.doc.metadatos.tipoCSL ?? '';
  if (o.medio === 'video') return /broadcast|episode/.test(t) ? 'el programa' : 'la película';
  if (o.medio === 'audio') return /song|musical/.test(t) ? 'la grabación' : 'el audio';
  if (/article/.test(t)) return 'el artículo';
  if (/chapter/.test(t)) return 'el capítulo';
  const c = normalizar(`${o.doc.metadatos.coleccion ?? ''} ${o.doc.metadatos.resumen ?? ''}`);
  if (/\bcuento\b|\brelato\b/.test(c)) return 'el cuento';
  if (/\bnovela\b/.test(c)) return 'la novela';
  return 'el texto';
}
