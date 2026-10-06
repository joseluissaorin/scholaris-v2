/** Nombres de autor: partir listas y separar nombre y apellidos. Puro. */

import type { Autor } from '@scholaris/nucleo';

const PARTICULAS = new Set(['de', 'del', 'della', 'di', 'da', 'das', 'dos', 'do', 'van', 'von', 'der', 'den', 'le', 'la', 'du', 'des', 'y', 'e', 'ten', 'ter', 'al', 'el', 'bin', 'ibn', 'st.', 'saint', 'mac']);
const SUFIJOS = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv']);
const IDIOMAS_DOBLE_APELLIDO = new Set(['es', 'pt', 'ca', 'gl']);

const capitalizar = (s: string) => (s === s.toUpperCase() && s.length > 3 ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : s);

/** «Foucault, Michel» · «Michel Foucault» · «C. S. Lewis» · «Lope de Vega Carpio» · «Joaquín Soler Serrano». */
export function separarNombre(completo: string, idioma?: string): Autor {
  let s = completo.replace(/\s+/g, ' ').replace(/[*†‡§\d¹²³⁴⁵⁶⁷⁸⁹⁰]+$/u, '').trim();
  s = capitalizar(s);
  if (s.includes(',')) {
    const [apellidos, nombre] = s.split(',', 2).map((x) => x.trim());
    if (nombre && !SUFIJOS.has(nombre.toLowerCase())) return { nombre, apellidos: apellidos ?? '' };
    s = s.replace(/,.*$/, '');
  }
  const t = s.split(' ').filter(Boolean);
  if (t.length === 1) return { nombre: '', apellidos: t[0] as string };
  // Partícula: el apellido empieza en ella («Lope | de Vega Carpio», «Ludwig | van Beethoven»).
  const p = t.findIndex((x, i) => i > 0 && PARTICULAS.has(x.toLowerCase()) && i < t.length - 1);
  if (p > 0) return { nombre: t.slice(0, p).join(' '), apellidos: t.slice(p).join(' ') };
  let corte = t.length - 1;
  if (SUFIJOS.has((t.at(-1) as string).toLowerCase()) && t.length > 2) corte = t.length - 2;
  // Doble apellido en español y portugués, si el penúltimo no es una inicial.
  if (t.length >= 3 && idioma && IDIOMAS_DOBLE_APELLIDO.has(idioma) && !/^\p{L}\.$/u.test(t[t.length - 2] as string)) corte = t.length - 2;
  return { nombre: t.slice(0, corte).join(' '), apellidos: t.slice(corte).join(' ') };
}

/**
 * Parte una cadena de autores: «A, B and C», «A; B», «Apellido, N.; Apellido, N.»,
 * «A y B», «A & B». Detecta el formato «Apellido, Nombre, Apellido, Nombre».
 */
export function partirAutores(s: string, idioma?: string): Autor[] {
  const limpio = s.replace(/\s+/g, ' ').replace(/^(by|por|de)\s+/i, '').trim();
  if (!limpio) return [];
  let piezas: string[];
  if (limpio.includes(';')) piezas = limpio.split(';');
  else {
    const base = limpio.replace(/,?\s+(and|y|e|et|und|&)\s+/gi, ', ');
    const comas = base.split(',').map((x) => x.trim()).filter(Boolean);
    const inicial = (c: string) => /^(\p{Lu}\.\s?-?)+$/u.test(c);
    const palabraSola = (c: string) => !c.includes(' ') || c.split(' ').every((w) => PARTICULAS.has(w.toLowerCase()) || /^\p{Lu}/u.test(w)) && c.split(' ').length <= 2;
    // «Lewis, C. S.» o «Foucault, Michel»: un solo autor en forma invertida.
    if (comas.length === 2 && !(comas[0] as string).includes(' ') && (inicial(comas[1] as string) || /^\p{Lu}\p{Ll}+$/u.test(comas[1] as string)) && !/\s(and|y|&)\s/i.test(limpio)) {
      piezas = [`${comas[0]}, ${comas[1]}`];
    } else if (comas.length >= 4 && comas.length % 2 === 0 && comas.every((c, i) => (i % 2 === 1 ? inicial(c) : palabraSola(c) && !inicial(c)))) {
      // «Vaswani, A., Shazeer, N.»: pares apellido-iniciales.
      piezas = [];
      for (let i = 0; i < comas.length; i += 2) piezas.push(`${comas[i]}, ${comas[i + 1]}`);
    } else piezas = comas;
  }
  const vistos = new Set<string>();
  const salida: Autor[] = [];
  for (const p of piezas.map((x) => x.trim()).filter((x) => x.length > 1 && !/^(et al\.?|others|otros)$/i.test(x))) {
    const a = separarNombre(p, idioma);
    const clave = `${a.nombre}|${a.apellidos}`.toLowerCase();
    if (!vistos.has(clave) && a.apellidos) { vistos.add(clave); salida.push(a); }
  }
  return salida;
}

export const nombreCompleto = (a: Autor) => [a.nombre, a.apellidos].filter(Boolean).join(' ');
