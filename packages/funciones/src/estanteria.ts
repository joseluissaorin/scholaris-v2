/** Lecturas comunes sobre la estantería (esquema SPDF 4.0). */

import { anclaACita, type Ancla, type MetadatosDocumento, type SQL, type TipoEntrada } from '@scholaris/nucleo';
import { deJSON, marcas, num, numONulo, texto } from './util.js';

export interface DocumentoBreve {
  id: string;
  tipo: TipoEntrada;
  titulo: string;
  autores: string[];
  anio: number | null;
  idioma: string | null;
  doi: string | null;
  metadatos: MetadatosDocumento;
}

function filaADocumento(f: Record<string, unknown>): DocumentoBreve {
  const m = deJSON<MetadatosDocumento>(f.metadatos, { titulo: '', autores: [] });
  const autores = (m.autores ?? []).map((a) => [a.nombre, a.apellidos].filter(Boolean).join(' ').trim()).filter(Boolean);
  return {
    id: String(f.id),
    tipo: String(f.tipo) as TipoEntrada,
    titulo: texto(f.titulo) ?? m.titulo ?? '',
    autores: autores.length ? autores : (texto(f.autores) ?? '').split(';').map((s) => s.trim()).filter(Boolean),
    anio: numONulo(f.anio) ?? m.anio ?? null,
    idioma: texto(f.idioma) ?? m.idioma ?? null,
    doi: m.doi ? m.doi.trim().toLowerCase() : null,
    metadatos: m,
  };
}

/** Documentos de la estantería; si se pasan ids, solo esos (en lotes). */
export async function leerDocumentos(sql: SQL, ids?: readonly string[]): Promise<Map<string, DocumentoBreve>> {
  const salida = new Map<string, DocumentoBreve>();
  const columnas = 'id, tipo, metadatos, titulo, autores, anio, idioma';
  if (!ids) {
    for (const f of await sql.ejecutar(`SELECT ${columnas} FROM documentos`)) {
      const d = filaADocumento(f);
      salida.set(d.id, d);
    }
    return salida;
  }
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 90) {
    const lote = unicos.slice(i, i + 90);
    for (const f of await sql.ejecutar(`SELECT ${columnas} FROM documentos WHERE id IN (${marcas(lote.length)})`, ...lote)) {
      const d = filaADocumento(f);
      salida.set(d.id, d);
    }
  }
  return salida;
}

/** Apellido del primer autor (o del autor único), para citas cortas. */
export function apellidoPrincipal(doc: Pick<DocumentoBreve, 'metadatos' | 'autores'>): string {
  const a = doc.metadatos.autores?.[0];
  if (a?.apellidos) return a.apellidos;
  const nombre = doc.autores[0] ?? '';
  const partes = nombre.split(/\s+/);
  return partes[partes.length - 1] ?? '';
}

/** «Foucault 1975, p. 23», «Foucault y Deleuze 1972, 12:04», «Arendt et al. 1958, diap. 7». */
export function citaCorta(doc: DocumentoBreve, ancla?: Ancla | null, anclaFin?: Ancla | null): string {
  const autores = doc.metadatos.autores ?? [];
  let quien: string;
  if (autores.length >= 3) quien = `${apellidoPrincipal(doc)} et al.`;
  else if (autores.length === 2) quien = `${autores[0]!.apellidos || autores[0]!.nombre} y ${autores[1]!.apellidos || autores[1]!.nombre}`;
  else quien = apellidoPrincipal(doc) || doc.titulo || 'Sin autor';
  const anio = doc.anio ?? 's. f.';
  const donde = ancla ? anclaACita(ancla, anclaFin ?? undefined) : '';
  return donde ? `${quien} ${anio}, ${donde}` : `${quien} ${anio}`;
}

export interface FragmentoLeido {
  id: string;
  documento: string;
  unidad: string;
  orden: number;
  texto: string;
  contexto: string;
  seccion: string[];
  ancla: Ancla;
  anclaFin: Ancla | null;
}

export function filaAFragmento(f: Record<string, unknown>): FragmentoLeido {
  return {
    id: String(f.id),
    documento: String(f.documento),
    unidad: String(f.unidad),
    orden: num(f.orden),
    texto: String(f.texto ?? ''),
    contexto: String(f.contexto ?? ''),
    seccion: deJSON<string[]>(f.seccion, []),
    ancla: deJSON<Ancla>(f.ancla, { tipo: 'imagen' }),
    anclaFin: deJSON<Ancla | null>(f.ancla_fin, null),
  };
}

export const COLUMNAS_FRAGMENTO = 'id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin';

export async function leerFragmentos(sql: SQL, ids: readonly string[]): Promise<Map<string, FragmentoLeido>> {
  const salida = new Map<string, FragmentoLeido>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 90) {
    const lote = unicos.slice(i, i + 90);
    for (const f of await sql.ejecutar(`SELECT ${COLUMNAS_FRAGMENTO} FROM fragmentos WHERE id IN (${marcas(lote.length)})`, ...lote)) {
      const fr = filaAFragmento(f);
      salida.set(fr.id, fr);
    }
  }
  return salida;
}
