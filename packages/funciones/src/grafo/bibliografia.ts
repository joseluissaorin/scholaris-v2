/**
 * Extracción de la bibliografía de un documento a partir de sus fragmentos:
 * se localiza la sección de referencias (por las secciones del SPDF, por la
 * ruta de títulos del fragmento o por una línea de cabecera) y se trocea en
 * entradas con DOI, año, título y apellidos. Todo determinista, sin modelos.
 */

import type { SQL } from '@scholaris/nucleo';
import { deJSON, num } from '../util.js';

export const RE_DOI = /\b10\.\d{4,9}\/[-._;()/:\p{L}\p{N}]+/giu;
const RE_ARXIV = /\barXiv:?\s?(\d{4}\.\d{4,5})(v\d+)?\b/i;
const RE_ANIO = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/;
const RE_ANIO_PARENTESIS = /\((1[5-9]\d{2}|20\d{2})[a-z]?(?:\s*\[[^\]]*\])?\)/;
const RE_APELLIDO = /(?:^|[\s;&(])(\p{Lu}[\p{L}'’-]{2,})(?=,|\s+\p{Lu}\.|\s+(?:y|and|et|und|e)\s)/gu;

/** Títulos de sección que abren una bibliografía (es, en, fr, de, it, pt, ca, la). */
export const RE_CABECERA_REFERENCIAS =
  /^\s*(?:#+\s*)?(?:\d+[.)]?\s*)?(?:references?|bibliography|works\s+cited|literature\s+cited|referencias(?:\s+bibliogr[áa]ficas)?|bibliograf[íi]a(?:\s+citada)?|obras\s+citadas|fuentes(?:\s+y\s+bibliograf[íi]a)?|r[ée]f[ée]rences(?:\s+bibliographiques)?|bibliographie|literaturverzeichnis|literatur|bibliografia|refer[êe]ncias|riferimenti\s+bibliografici)\s*:?\s*$/imu;

export interface EntradaBibliografica {
  texto: string;
  doi: string | null;
  titulo: string | null;
  autores: string[];
  anio: number | null;
  fragmento: string | null;
}

interface Trozo { fragmento: string; texto: string }

/** Fragmentos (en orden) que forman la sección de referencias de un documento. */
export async function trozosDeReferencias(sql: SQL, documento: string): Promise<Trozo[]> {
  const frags = await sql.ejecutar(
    `SELECT f.id, f.texto, f.seccion, u.orden AS orden_unidad FROM fragmentos f LEFT JOIN unidades u ON u.id = f.unidad
     WHERE f.documento = ? ORDER BY f.orden`,
    documento,
  );
  if (!frags.length) return [];
  // 1. Por la tabla de secciones.
  const secciones = await sql.ejecutar(
    `SELECT s.titulo, ud.orden AS desde, uh.orden AS hasta FROM secciones s
     LEFT JOIN unidades ud ON ud.id = s.unidad_desde LEFT JOIN unidades uh ON uh.id = s.unidad_hasta
     WHERE s.documento = ?`,
    documento,
  );
  for (const s of secciones) {
    if (!RE_CABECERA_REFERENCIAS.test(String(s.titulo ?? ''))) continue;
    const desde = num(s.desde, 0);
    const hasta = s.hasta === null || s.hasta === undefined ? Infinity : num(s.hasta);
    const trozos = frags.filter((f) => num(f.orden_unidad, -1) >= desde && num(f.orden_unidad, -1) <= hasta);
    if (trozos.length) return trozos.map((f) => ({ fragmento: String(f.id), texto: String(f.texto) }));
  }
  // 2. Por la ruta de títulos de cada fragmento.
  const porRuta = frags.filter((f) => deJSON<string[]>(f.seccion, []).some((t) => RE_CABECERA_REFERENCIAS.test(t)));
  if (porRuta.length) return porRuta.map((f) => ({ fragmento: String(f.id), texto: String(f.texto) }));
  // 3. Por una línea de cabecera dentro del texto: desde ahí hasta el final.
  for (let i = 0; i < frags.length; i++) {
    const t = String(frags[i]!.texto);
    const m = RE_CABECERA_REFERENCIAS.exec(t);
    if (!m) continue;
    const resto = t.slice(m.index + m[0].length);
    return [
      { fragmento: String(frags[i]!.id), texto: resto },
      ...frags.slice(i + 1).map((f) => ({ fragmento: String(f.id), texto: String(f.texto) })),
    ];
  }
  return [];
}

function limpiarDoi(d: string): string {
  return d.replace(/[.,;:)\]]+$/, '').toLowerCase();
}

/** Analiza una entrada suelta. */
export function analizarEntrada(texto: string, fragmento: string | null = null): EntradaBibliografica {
  const t = texto.replace(/\s+/g, ' ').trim();
  RE_DOI.lastIndex = 0;
  const doi = RE_DOI.exec(t);
  const arxiv = RE_ARXIV.exec(t);
  const anioP = RE_ANIO_PARENTESIS.exec(t);
  const anioM = anioP ?? RE_ANIO.exec(t);
  let titulo: string | null = null;
  const entreComillas = /[«“"]([^»”"]{8,300})[»”"]/.exec(t);
  if (entreComillas) titulo = entreComillas[1]!.trim();
  else if (anioM) {
    const tras = t.slice(anioM.index + anioM[0].length).replace(/^[\s.,):]+/, '');
    const fin = /[.?!](\s|$)/.exec(tras);
    titulo = (fin ? tras.slice(0, fin.index) : tras.slice(0, 200)).trim() || null;
  } else {
    // Sin año: el título suele ir tras los autores, entre el primer y el segundo punto.
    const partes = t.split(/\.\s+/);
    if (partes.length >= 2) titulo = partes[1]!.trim() || null;
  }
  if (titulo) titulo = titulo.replace(/^[*_]+|[*_]+$/g, '').replace(/[.,;:]+$/, '').trim() || null;
  const autores: string[] = [];
  RE_APELLIDO.lastIndex = 0;
  const cabeza = t.slice(0, anioM ? Math.max(anioM.index, 20) : 200);
  for (const m of cabeza.matchAll(RE_APELLIDO)) if (autores.length < 6 && !autores.includes(m[1]!)) autores.push(m[1]!);
  return {
    texto: t.slice(0, 1500),
    doi: doi ? limpiarDoi(doi[0]) : arxiv ? `arxiv:${arxiv[1]}` : null,
    titulo,
    autores,
    anio: anioM ? Number(anioM[1]) : null,
    fragmento,
  };
}

const RE_INICIO_ENTRADA = /^(?:\[\d+\]|\(\d+\)|\d{1,3}\.\s|\p{Lu}[\p{L}'’-]+,\s+(?:\p{Lu}|[A-Z]\.)|—{2,}|_{3,})/u;

/** Trocea el texto de la bibliografía en entradas. */
export function analizarBibliografia(trozos: Trozo[]): EntradaBibliografica[] {
  const entradas: EntradaBibliografica[] = [];
  for (const { fragmento, texto } of trozos) {
    const lineas = texto.replace(/\r/g, '').split('\n');
    let actual: string[] = [];
    const cerrar = () => {
      const bloque = actual.join(' ').replace(/^\s*(?:\[\d+\]|\(\d+\)|\d{1,3}\.)\s+/, '').trim();
      actual = [];
      if (bloque.length < 30) return;
      if (RE_CABECERA_REFERENCIAS.test(bloque)) return;
      entradas.push(analizarEntrada(bloque, fragmento));
    };
    for (const l of lineas) {
      const linea = l.trim();
      if (!linea) { cerrar(); continue; }
      if (RE_CABECERA_REFERENCIAS.test(linea)) { cerrar(); continue; }
      if (actual.length && RE_INICIO_ENTRADA.test(linea)) cerrar();
      actual.push(linea);
      // Una entrada desbocada es probablemente un párrafo: se corta.
      if (actual.join(' ').length > 2000) cerrar();
    }
    cerrar();
  }
  return entradas;
}

/** DOIs mencionados en cualquier parte del documento (fuera o dentro de la bibliografía). */
export async function doisEnTexto(sql: SQL, documento: string): Promise<Array<{ doi: string; fragmento: string }>> {
  const filas = await sql.ejecutar("SELECT id, texto FROM fragmentos WHERE documento = ? AND texto LIKE '%10.%/%' ORDER BY orden", documento);
  const salida: Array<{ doi: string; fragmento: string }> = [];
  for (const f of filas) {
    for (const m of String(f.texto).matchAll(RE_DOI)) salida.push({ doi: limpiarDoi(m[0]), fragmento: String(f.id) });
  }
  return salida;
}
