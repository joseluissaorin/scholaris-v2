/**
 * Las fuentes del banco: las unidades de cada documento tal como las guarda
 * Scholaris, para resolver un ancla a su contenido (el texto de una página o la
 * transcripción de un tramo) y decidir si una cita dice lo que se le atribuye.
 *
 * Se piden a la API una vez y se guardan en bench/datos/comprension/fuentes
 * (fuera del repositorio: es material con derechos).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ancla } from '@scholaris/nucleo';

export interface UnidadFuente {
  orden: number;
  etiqueta: string;
  ancla: Ancla;
  texto: string;
}

export interface DocumentoFuente {
  id: string;
  titulo: string;
  tipo: string;
  /** Segundos, en audio y vídeo. */
  duracion?: number;
  unidades: UnidadFuente[];
}

/** Lo que dice la fuente en un ancla. */
export interface ContenidoAncla {
  /** El ancla existe en el documento (página dentro del rango, tramo dentro de la duración). */
  existe: boolean;
  texto: string;
  /** Etiquetas de las unidades que se han juntado. */
  unidades: string[];
  /** Tramo de vídeo o audio sin transcripción (silencio, música, imagen sola). */
  sinTexto?: boolean;
}

export interface Fuentes {
  documento(id: string): DocumentoFuente | undefined;
  contenido(documento: string, ancla: Ancla, fin?: Ancla): ContenidoAncla;
  /** Añade documentos (los que cita una respuesta y no están en el banco). */
  anadir(docs: DocumentoFuente[]): void;
}

/** Margen (s) al juntar los tramos de transcripción que tocan un ancla de tiempo. */
export const MARGEN_TIEMPO = 3;

export function crearFuentes(docs: DocumentoFuente[]): Fuentes {
  const porId = new Map(docs.map((d) => [d.id, d]));
  return {
    documento: (id) => porId.get(id),
    anadir: (nuevos) => { for (const d of nuevos) porId.set(d.id, d); },
    contenido(documento, ancla, fin) {
      const d = porId.get(documento);
      if (!d) return { existe: false, texto: '', unidades: [] };
      return contenidoDe(d, ancla, fin);
    },
  };
}

export function contenidoDe(d: DocumentoFuente, ancla: Ancla, fin?: Ancla): ContenidoAncla {
  if (ancla.tipo === 'pagina') {
    const desde = ancla.fisica;
    const hasta = fin && fin.tipo === 'pagina' ? Math.max(fin.fisica, desde) : desde;
    const us = d.unidades.filter((u) => u.ancla.tipo === 'pagina' && u.ancla.fisica >= desde && u.ancla.fisica <= hasta);
    return { existe: us.length > 0, texto: us.map((u) => u.texto).join('\n\n'), unidades: us.map((u) => u.etiqueta) };
  }
  if (ancla.tipo === 'tiempo') {
    const t0 = ancla.t0;
    const t1 = fin && fin.tipo === 'tiempo' ? Math.max(fin.t1, t0) : Math.max(ancla.t1, t0);
    const duracion = d.duracion ?? Math.max(0, ...d.unidades.map((u) => (u.ancla.tipo === 'tiempo' ? u.ancla.t1 : 0)));
    const existe = t0 >= 0 && t0 <= duracion + 1;
    const us = d.unidades.filter((u) => u.ancla.tipo === 'tiempo' && u.ancla.t1 >= t0 - MARGEN_TIEMPO && u.ancla.t0 <= t1 + MARGEN_TIEMPO);
    return { existe, texto: us.map((u) => `[${u.etiqueta}] ${u.texto}`).join('\n\n'), unidades: us.map((u) => u.etiqueta), sinTexto: existe && us.length === 0 };
  }
  // Otras anclas (sección, diapositiva…): se compara por igualdad de la parte que las identifica.
  const clave = JSON.stringify(ancla);
  const us = d.unidades.filter((u) => JSON.stringify(u.ancla) === clave);
  return { existe: us.length > 0, texto: us.map((u) => u.texto).join('\n\n'), unidades: us.map((u) => u.etiqueta) };
}

// ---------------------------------------------------------------------------
// Descarga y caché
// ---------------------------------------------------------------------------

export interface LectorApi {
  documento(id: string): Promise<{ id: string; titulo?: string; tipo: string; unidades?: number; duracion?: number }>;
  unidades(id: string, desde: number, hasta: number): Promise<Array<{ orden: number; etiqueta: string; ancla: Ancla; texto: string }>>;
}

export async function cargarFuentes(api: LectorApi, ids: string[], dir: string, refrescar = false): Promise<Fuentes> {
  return crearFuentes(await descargar(api, ids, dir, refrescar));
}

/**
 * Completa las fuentes con los documentos que cita una respuesta y no están en el banco
 * (otro libro de la biblioteca). Un documento que la API no encuentra no se añade: sus
 * citas quedarán como inventadas.
 */
export async function completarFuentes(f: Fuentes, api: LectorApi, ids: string[], dir: string): Promise<void> {
  const faltan = [...new Set(ids)].filter((id) => !f.documento(id));
  for (const id of faltan) {
    try { f.anadir(await descargar(api, [id], dir)); } catch { /* no existe: se queda fuera */ }
  }
}

async function descargar(api: LectorApi, ids: string[], dir: string, refrescar = false): Promise<DocumentoFuente[]> {
  mkdirSync(dir, { recursive: true });
  const docs: DocumentoFuente[] = [];
  for (const id of ids) {
    const ruta = join(dir, `${id}.json`);
    if (!refrescar && existsSync(ruta)) { docs.push(JSON.parse(readFileSync(ruta, 'utf8')) as DocumentoFuente); continue; }
    const d = await api.documento(id);
    const total = d.unidades ?? 0;
    const unidades: UnidadFuente[] = [];
    // La API entrega como mucho 100 unidades por petición.
    for (let desde = 0; desde < total; desde += 100) {
      const lote = await api.unidades(id, desde, Math.min(total - 1, desde + 99));
      for (const u of lote) unidades.push({ orden: u.orden, etiqueta: u.etiqueta, ancla: u.ancla, texto: u.texto });
    }
    const doc: DocumentoFuente = { id, titulo: d.titulo ?? id, tipo: d.tipo, ...(d.duracion ? { duracion: d.duracion } : {}), unidades };
    writeFileSync(ruta, JSON.stringify(doc));
    docs.push(doc);
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Comparación de textos
// ---------------------------------------------------------------------------

/** Minúsculas, sin tildes, sin puntuación ni marcas de hablante, espacios simples. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/\*\*[^*]{1,40}:\*\*/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Longitud de la subsecuencia común más larga de dos listas de palabras. */
function lcs(a: string[], b: string[]): number {
  const fila = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j] as number;
      fila[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(arriba, fila[j - 1] as number);
      diagonal = arriba;
    }
  }
  return fila[b.length] as number;
}

/**
 * ¿Está la cita en el texto? Tolera erratas de OCR o de transcripción, palabras
 * repetidas y etiquetas intercaladas: basta con que una ventana del texto contenga,
 * en orden, una proporción alta de las palabras de la cita (por defecto el 80 %).
 */
export function contieneCita(texto: string, cita: string, umbral = 0.8): boolean {
  const t = normalizar(texto);
  const c = normalizar(cita);
  if (!c) return true;
  if (t.includes(c)) return true;
  const palabras = c.split(' ');
  const tokens = t.split(' ');
  const inicio = new Set(palabras.slice(0, 3));
  const ancho = Math.ceil(palabras.length * 1.5) + 4;
  let mejor = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!inicio.has(tokens[i] as string)) continue;
    mejor = Math.max(mejor, lcs(palabras, tokens.slice(i, i + ancho)) / palabras.length);
    if (mejor >= umbral) return true;
  }
  return false;
}
