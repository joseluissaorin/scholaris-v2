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
