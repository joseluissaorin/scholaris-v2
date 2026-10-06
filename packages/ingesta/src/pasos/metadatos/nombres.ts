/**
 * Nombres de persona y de entidad para la ficha: autores corporativos
 * («RTVE», «Real Academia Española», «Google Brain»), partículas («de Vega»,
 * «van», «von») y dobles apellidos hispánicos («Soler Serrano»). Puro.
 */

import type { Autor } from '@scholaris/nucleo';
import { separarNombre } from '../autores.js';

const PALABRAS_ENTIDAD = /\b(universi(?:dad|ty|té|tà|tät)|press|prensa|editorial|editores|ediciones|éditions|verlag|instituto?|institute|institut|academ(?:ia|y|ie)|asociaci[óo]n|association|society|sociedad|fundaci[óo]n|foundation|ministerio|ministry|consejo|council|comisi[óo]n|commission|organi[sz]ation|organizaci[óo]n|naciones unidas|united nations|biblioteca|library|museo|museum|grupo|group|centro|center|centre|departamento|department|laboratori?o|laboratory|corporation|inc\.?|ltd\.?|s\.\s?a\.|s\.\s?l\.|gmbh|radiotelevisi[óo]n|televisi[óo]n|television|broadcasting|rtve|tve|bbc|unesco|oecd|ocde|who|oms|google|microsoft|openai|deepmind|meta ai|ibm)\b/i;

/** ¿Es una entidad y no una persona? */
export function esEntidad(nombre: string): boolean {
  const s = nombre.trim();
  if (!s) return false;
  if (PALABRAS_ENTIDAD.test(s)) return true;
  // Siglas en mayúsculas («RTVE», «CSIC», «UNESCO»), no iniciales («C. S.»).
  return /^[A-Z]{2,8}$/.test(s);
}

/** Idiomas en los que «Nombre Apellido1 Apellido2» es lo normal. */
const DOBLE_APELLIDO = new Set(['es', 'pt', 'ca', 'gl']);

/**
 * Persona o entidad a partir de un nombre completo. Las entidades van enteras
 * en `apellidos` con `nombre` vacío (CSL las imprime como literal).
 */
export function autorDe(completo: string, idioma?: string): Autor {
  const s = completo.replace(/\s+/g, ' ').trim();
  if (esEntidad(s)) return { nombre: '', apellidos: s };
  return separarNombre(s, idioma && DOBLE_APELLIDO.has(idioma.slice(0, 2)) ? idioma.slice(0, 2) : idioma);
}

/** Clave para comparar personas: último apellido sin tildes y primera inicial. */
export function claveAutor(a: Autor): string {
  const sin = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const apellidos = sin(a.apellidos).replace(/^(de|del|de la|van|von|der|di|da|le|la)\s+/, '').split(/\s+/).filter(Boolean);
  return `${apellidos[0] ?? ''}|${sin(a.nombre).charAt(0)}`;
}

/** ¿Parece un canal o una marca y no una persona? («3Blue1Brown», «Veritasium», «TED-Ed»). */
export function esCanal(nombre: string): boolean {
  const s = nombre.trim().replace(/^\(|\)$/g, '');
  if (!s || /\s/.test(s)) return esEntidad(s);
  // Una sola palabra con cifras o mayúsculas en medio, o una sigla: no es un nombre de persona.
  return /\d/.test(s) || (s.match(/\p{Ll}\p{Lu}/gu)?.length ?? 0) >= 2 || /^[A-Z]{2,8}$/.test(s) || (/-/.test(s) && /\p{Lu}.*-.*\p{Lu}/u.test(s));
}

/** Quita lo que va entre paréntesis en un nombre («Grant Sanderson (3Blue1Brown)») y lo devuelve aparte. */
export function sinParentesis(a: Autor): { autor: Autor; aparte: string[] } {
  const aparte: string[] = [];
  const limpiar = (s: string) => s.replace(/\s*\(([^)]*)\)\s*/g, (_m, x: string) => { if (x.trim()) aparte.push(x.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  const nombre = limpiar(a.nombre ?? ''), apellidos = limpiar(a.apellidos ?? '');
  if (!apellidos && nombre) return { autor: { ...autorDe(nombre), ...(a.orcid ? { orcid: a.orcid } : {}) }, aparte };
  return { autor: { ...a, nombre, apellidos }, aparte };
}

const fichasDe = (a: Autor) => `${a.nombre} ${a.apellidos}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !['de', 'del', 'la', 'van', 'von', 'y'].includes(w));

/** ¿La misma persona escrita de dos maneras? («Sanderson, Grant» / «Grant Sanderson»; «Lope de Vega» / «Lope de Vega Carpio»). */
export function mismaPersonaNombre(a: Autor, b: Autor): boolean {
  const x = fichasDe(a), y = fichasDe(b);
  if (!x.length || !y.length) return false;
  const [corta, larga] = x.length <= y.length ? [x, y] : [y, x];
  return corta.every((w) => larga.includes(w) || (w.length === 1 && larga.some((v) => v.startsWith(w))));
}

/**
 * Autores limpios: sin paréntesis, sin duplicados de la misma persona (se
 * queda la forma más completa) y sin canales ni la editorial como persona
 * cuando hay personas de verdad. Devuelve también los canales apartados.
 */
export function limpiarAutores(autores: Autor[], contexto: { editorial?: string; contenedor?: string } = {}): { autores: Autor[]; canales: string[] } {
  const canales: string[] = [];
  const salida: Autor[] = [];
  for (const original of autores) {
    const { autor, aparte } = sinParentesis(original);
    for (const x of aparte) if (esCanal(x)) canales.push(x);
    if (!autor.apellidos && !autor.nombre) continue;
    const completo = `${autor.nombre} ${autor.apellidos}`.trim();
    const igualA = (s?: string) => Boolean(s) && completo.toLowerCase() === (s as string).trim().toLowerCase();
    if (!autor.nombre && (esCanal(autor.apellidos) || igualA(contexto.editorial) || igualA(contexto.contenedor))) { canales.push(autor.apellidos); continue; }
    const i = salida.findIndex((y) => mismaPersonaNombre(y, autor));
    if (i < 0) salida.push(autor);
    else if (fichasDe(autor).length > fichasDe(salida[i] as Autor).length || (autor.orcid && !salida[i]!.orcid)) salida[i] = { ...autor, ...(salida[i]!.orcid && !autor.orcid ? { orcid: salida[i]!.orcid } : {}) };
  }
  // Si no queda ninguna persona, el canal es el autor (corporativo): mejor eso que nada.
  if (!salida.length && canales.length) return { autores: [{ nombre: '', apellidos: canales[0] as string }], canales: canales.slice(1) };
  return { autores: salida, canales: [...new Set(canales)] };
}
