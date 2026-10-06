/**
 * Página de créditos y colofón, leídos sin modelo: ISBN, depósito legal,
 * «© 1975 Éditions Gallimard», «Título original», «Traducción de…», «Primera
 * edición: …», «Esta edición: …», «First published 1964», «Reprinted 1964»,
 * «Con licencia: En Sevilla, en la Imprenta de…», DOI, arXiv, congreso.
 *
 * Todo lo que sale de aquí está impreso en el propio libro: es la mejor prueba
 * de la edición que se tiene delante. Puro.
 */

import { isbnsDelTexto } from './isbn.js';

export interface Colofon {
  isbns: string[];
  depositoLegal?: string;
  copyright: Array<{ anio: number; titular?: string; traduccion?: boolean }>;
  /** Primera edición de la obra («First published», «Primera edición»), no «en esta colección». */
  primeraEdicion?: number;
  /** Año de la edición que se tiene delante («Esta edición», «Segunda edición: 1987», «This edition published»). */
  estaEdicion?: number;
  /** Primera edición en esta editorial o colección (es la de esta edición, no la de la obra). */
  primeraEnEsta?: number;
  reimpresiones: number[];
  /** Mención de edición legible: «2.ª ed.», «Canto edition», «reimpr. 2002». */
  edicion?: string;
  tituloOriginal?: string;
  idiomaOriginal?: string;
  traductores: string[];
  editorial?: string;
  lugar?: string;
  impresor?: string;
  coleccion?: string;
  doi?: string;
  arxiv?: string;
  /** «31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA». */
  congreso?: { nombre: string; anio?: number; lugar?: string };
}

const ANIO = String.raw`(1[4-9]\d{2}|20\d{2})`;
const anio = (s: string | undefined) => (s ? Number(s) : undefined);

const ORDINALES: Record<string, number> = {
  primera: 1, segunda: 2, tercera: 3, cuarta: 4, quinta: 5, sexta: 6, 'séptima': 7, septima: 7, octava: 8, novena: 9, 'décima': 10, decima: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  'première': 1, premiere: 1, seconde: 2, deuxième: 2, troisième: 3, prima: 1, seconda: 2, terza: 3,
};

const IDIOMAS: Record<string, string> = {
  'francés': 'fr', frances: 'fr', 'inglés': 'en', ingles: 'en', 'alemán': 'de', aleman: 'de', italiano: 'it', 'portugués': 'pt', portugues: 'pt',
  ruso: 'ru', 'latín': 'la', latin: 'la', griego: 'grc', 'catalán': 'ca', catalan: 'ca', 'japonés': 'ja', chino: 'zh', 'árabe': 'ar', arabe: 'ar', 'neerlandés': 'nl', sueco: 'sv', polaco: 'pl',
  french: 'fr', english: 'en', german: 'de', italian: 'it', spanish: 'es', portuguese: 'pt', russian: 'ru', greek: 'grc', 'español': 'es', castellano: 'es',
  anglais: 'en', allemand: 'de', espagnol: 'es', italien: 'it',
};

/** «VIVDA de FRANCISCO LEEFDAEL» → «Viuda de Francisco Leefdael» (u/v de la imprenta antigua). */
export function nombreDeImprenta(s: string): string {
  const menores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el']);
  return s.replace(/\s+/g, ' ').trim().split(' ').map((w, i) => {
    let p = w;
    if (p === p.toUpperCase() && /\p{L}{2}/u.test(p)) {
      // En mayúsculas de imprenta, V vale por U entre consonante y vocal o al final («VIVDA», «LVIS»).
      p = p.replace(/(?<=[^AEIOUÁÉÍÓÚ\s])V(?=[^AEIOUÁÉÍÓÚ]|$)/g, 'U').replace(/(?<=[AEIOU])V(?=[^AEIOUÁÉÍÓÚ\s])/g, 'U');
      p = p.toLowerCase();
      if (i === 0 || !menores.has(p)) p = p.charAt(0).toUpperCase() + p.slice(1);
    }
    return p;
  }).join(' ').replace(/[\s,.;:]+$/, '');
}

/** «CAMBRIDGE UNIVERSITY PRESS» → «Cambridge University Press». Solo si viene todo en mayúsculas. */
export function tipoTitulo(s: string): string {
  if (s !== s.toUpperCase() || !/\p{L}{3}/u.test(s)) return s;
  const menores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'el', 'of', 'the', 'and', 'at', 'for']);
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    .replace(/\b(Usa|Uk|Unam|Csic|Rtve|Tve|Bbc|Mit)\b/g, (x) => x.toUpperCase());
}

function limpiarPersona(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^(?:el|la|los|las|d\.|don|doña)\s+/i, '').replace(/[\s,.;:]+$/, '').trim();
}

/** Lee los créditos y el colofón de un texto (primeras y últimas páginas juntas). */
export function leerColofon(texto: string): Colofon {
  const t = texto.replace(/\*+/g, '').replace(/[ \t]+/g, ' ');
  const c: Colofon = { isbns: isbnsDelTexto(t), copyright: [], reimpresiones: [], traductores: [] };

  const dl = /\b(?:D\.\s?L\.|Dep[óo]sito\s+legal)\s*:?\s*([A-Z]{1,2}[\s.-]?\d{1,6}[\s.-]?(?:\d{4}|\d{2}))\b/i.exec(t);
  if (dl) c.depositoLegal = (dl[1] as string).replace(/\s+/g, ' ').toUpperCase();

  // ©: «© 1975 Éditions Gallimard», «© Siglo XXI Editores, 1976», «Copyright © 1964 by…», «© de la traducción: X, 2002».
  for (const m of t.matchAll(new RegExp(String.raw`(?:©|\(c\)|copyright)\s*(?:©\s*)?(de la (?:traducción|edición)[^:\n]*:?\s*|for the translation\s*)?(?:${ANIO}\s*(?:,|by|por|de)?\s*([^\n©]{2,80})|([^\n©\d]{2,80}?),?\s*${ANIO})`, 'gi'))) {
    const a = anio(m[2] ?? m[5]);
    if (!a) continue;
    const titular = (m[3] ?? m[4] ?? '').replace(/^(?:by|por)\s+/i, '').replace(/[.,;]\s*(?:all rights|todos los derechos|reservados|derechos).*$/i, '').replace(/[\s,.;]+$/, '').trim();
    const traduccion = Boolean(m[1]) || /traducci[óo]n|translation/i.test(titular);
    c.copyright.push({ anio: a, ...(titular && !/^\d+$/.test(titular) ? { titular } : {}), ...(traduccion ? { traduccion: true } : {}) });
  }

  // Primera edición de la obra / en esta colección.
  for (const m of t.matchAll(new RegExp(String.raw`(?:primera\s+edici[óo]n|1\.?\s?[ªa]\s+edici[óo]n|first\s+(?:published|printed|edition|publication)|premi[eè]re\s+[ée]dition|prima\s+edizione|published\s+in\s+(?:great britain|the united states|the usa)\s+in)([^\n:]{0,60}?)[:,.]?\s*(?:in\s+|en\s+|in\s+the\s+year\s+)?(?:\p{L}+\s+(?:de\s+)?)?${ANIO}`, 'giu'))) {
    const resto = (m[1] ?? '').toLowerCase();
    const a = anio(m[2]);
    if (!a) continue;
    if (/esta|this|cette|questa|colecci[óo]n|collection|collana|serie|bolsillo|paperback|rústica|austral|editorial|edition\s+in|en\s+(?:español|castellano|lengua)|in\s+english|en\s+fran[çc]ais|traducci/i.test(resto)) c.primeraEnEsta ??= a;
    else c.primeraEdicion = Math.min(c.primeraEdicion ?? a, a);
  }

  // Esta edición, ediciones numeradas y reimpresiones.
  let mejorNumero = 0;
  for (const m of t.matchAll(new RegExp(String.raw`(?:^|[\n.;,])\s*(?:(esta\s+edici[óo]n|this\s+edition(?:\s+(?:first\s+)?published)?|cette\s+[ée]dition|questa\s+edizione)|(\p{L}+|\d+\.?\s?[ªa]?)\s+(edici[óo]n|edition|[ée]dition|edizione|reimpresi[óo]n|reprint(?:ed)?|impression|printing|ristampa))([^\n:]{0,40}?)[:,.]?\s*(?:in\s+|en\s+)?(?:\p{L}+\s+(?:de\s+)?)?${ANIO}`, 'giu'))) {
    const a = anio(m[5]);
    if (!a) continue;
    if (m[1]) { c.estaEdicion = a; continue; }
    const ordinal = (m[2] ?? '').toLowerCase().replace(/(?<=\d)[.\sªa]+$/, '').replace(/\s+$/, '');
    // «vigesimonovena», «undécima»…: una edición posterior a la décima, sin calcular el número.
    const n = ORDINALES[ordinal] ?? (/^\d+$/.test(ordinal) ? Number(ordinal) : /^(?:und|duod|d[ée]cimo|vig[ée]sim|trig[ée]sim|cuadrag[ée]sim)\p{L}*(?:a|o)$/u.test(ordinal) ? 99 : undefined);
    const tipo = (m[3] ?? '').toLowerCase();
    if (/reimpres|reprint|impression|printing|ristampa/.test(tipo)) { c.reimpresiones.push(a); continue; }
    if (/esta|this|colecci|collection/.test((m[4] ?? '').toLowerCase())) { c.primeraEnEsta ??= a; continue; }
    if (n && n > 1 && n >= mejorNumero) {
      mejorNumero = n;
      c.estaEdicion = Math.max(c.estaEdicion ?? a, a);
      const etiqueta = n === 99 ? `${(m[2] as string).toLowerCase()} ed.` : /edici/.test(tipo) ? `${n}.ª ed.` : `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} ed.`;
      c.edicion = etiqueta;
    }
  }
  for (const m of t.matchAll(new RegExp(String.raw`\b(?:reprinted|reimpreso|reimpresión|réimpression|ristampa)\s*:?\s*((?:${ANIO}[\s,y&and]*)+)`, 'gi'))) {
    for (const a of (m[1] as string).matchAll(/\b(1[4-9]\d{2}|20\d{2})\b/g)) c.reimpresiones.push(Number(a[1]));
  }
  c.reimpresiones = [...new Set(c.reimpresiones)].sort((a, b) => a - b);
  if (!c.edicion && c.reimpresiones.length) c.edicion = `reimpr. ${c.reimpresiones.at(-1)}`;
  const nombrada = new RegExp(String.raw`\b(Canto|Penguin Classics|Oxford World's Classics|Folio|Austral|Letras Hisp[áa]nicas|Cl[áa]sicos Castalia)\s+(?:edition|edici[óo]n)\b[:,]?\s*(?:published\s+)?(?:in\s+)?${ANIO}?`, 'i').exec(t);
  if (nombrada) {
    c.edicion = `${nombrada[1]} edition`;
    if (nombrada[2]) c.estaEdicion = Math.max(c.estaEdicion ?? 0, Number(nombrada[2]));
  }

  // Título original y traducción.
  const to = /\b(?:t[íi]tulo\s+(?:del\s+)?original|original(?:ly)?\s+(?:title|published\s+as)|titre\s+original|titolo\s+originale)\s*:?\s*([^\n]{2,120})/i.exec(t);
  if (to) {
    let s = (to[1] as string).replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*(?:©|\(c\)|traducci[óo]n|translated|publicado|published|primera|first).*$/i, '').replace(/[\s,.;:]+$/, '').replace(/^[«"“']|[»"”']$/g, '');
    if (s.length >= 2) c.tituloOriginal = s;
  }
  for (const m of t.matchAll(/(?<!de\s+la\s+|for\s+the\s+)\b(?:traducci[óo]n(?:\s+del?\s+(\p{L}+))?(?:\s+y\s+notas)?\s*(?:de|:)|traducido\s+(?:del?\s+(\p{L}+)\s+)?por|translated\s+(?:from\s+the\s+(\p{L}+)\s+)?by|traduit\s+(?:de\s+l['’](\p{L}+)\s+)?par|tradotto\s+da|traduzione\s+di)\s+([\p{Lu}][\p{L}.' -]{2,80}?)(?=[\n,;]|\s+y\s+[\p{Lu}]|\s+and\s+[\p{Lu}]|$)/gimu)) {
    const idioma = (m[1] ?? m[2] ?? m[3] ?? m[4])?.toLowerCase();
    if (idioma && IDIOMAS[idioma]) c.idiomaOriginal ??= IDIOMAS[idioma];
    const nombre = limpiarPersona(m[5] as string);
    if (nombre && nombre.split(' ').length <= 6 && !c.traductores.includes(nombre)) c.traductores.push(nombre);
  }

  // Editorial y lugar en libros modernos.
  const pub = /\b(?:published\s+by|publicado\s+por|edita|editado\s+por|publié\s+par)\s*:?\s*([^\n]{3,100})/i.exec(t);
  if (pub) {
    const s = (pub[1] as string).replace(/^the\s+syndics\s+of\s+the\s+/i, '').replace(/\s+/g, ' ').trim();
    const [ed, lugar] = s.split(/\s*,\s*/, 2);
    if (ed && !/^\d/.test(ed)) c.editorial = tipoTitulo(ed.replace(/[\s.;:]+$/, ''));
    if (lugar && /^\p{Lu}\p{L}+$/u.test(lugar)) c.lugar = lugar;
  }

  // Pie de imprenta antiguo: «Con licencia: En Sevilla, en la Imprenta de la Viuda de…», «Impresso en Madrid por…».
  const pie = /\b(?:con\s+licencia\s*[:.,]?\s*)?(?:en|impress?o\s+en|impresso\s+en)\s+([\p{Lu}][\p{L}]+(?:\s+de\s+[\p{Lu}][\p{L}]+)?)\s*[,:]\s*(?:en\s+la\s+(?:imprenta|oficina)\s+de|en\s+casa\s+de|por)\s+(?:la\s+)?([^,\n.]{4,90})/iu.exec(t);
  if (pie && /licencia|impress?o|imprenta|oficina|casa de/i.test(pie[0])) {
    c.lugar ??= nombreDeImprenta(pie[1] as string);
    c.impresor = nombreDeImprenta((pie[2] as string).replace(/^la\s+/i, ''));
  }

  const col = /\b(?:colecci[óo]n|collection|collana|serie|series)\s*[:«"“]\s*([^»"”\n]{3,60})/i.exec(t);
  if (col) c.coleccion = (col[1] as string).replace(/[\s,.;]+$/, '').trim();

  // Solo un DOI rotulado («DOI: 10…», «https://doi.org/10…») y al principio: los de la bibliografía son de otras obras.
  const doi = /\b(?:doi\s*[:.]?\s*|doi\.org\/)(10\.\d{4,9}\/[-._;()/:A-Z0-9]{1,120})\b/i.exec(t.slice(0, 4000));
  if (doi) c.doi = (doi[1] as string).replace(/[.,;)\]]+$/, '').toLowerCase();
  // El sello de arXiv en el margen («arXiv:1706.03762v7 [cs.CL] 2 Aug 2023»), no una referencia («arXiv:1607.06450, 2016»).
  const ax = /\barXiv\s*:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})v\d+\s*\[[a-z-]+(?:\.[A-Za-z]{2})?\]/i.exec(t);
  if (ax) c.arxiv = ax[1] as string;

  const cg = /\b(\d{1,3}(?:st|nd|rd|th)\s+(?:Annual\s+)?(?:Conference|Meeting|Symposium|Workshop)\s+on\s+[^\n(]{4,100}?)\s*\(([A-Za-z]{2,12}\s*(\d{4}))\)\s*(?:,\s*([^\n.]{3,60}))?/.exec(t);
  if (cg) c.congreso = { nombre: `${(cg[1] as string).trim()} (${cg[2]})`, ...(cg[3] ? { anio: Number(cg[3]) } : {}), ...(cg[4] ? { lugar: (cg[4] as string).trim() } : {}) };
  return c;
}

/**
 * Años de la edición y de la obra según el colofón.
 * - `anio`: «Esta edición» > edición numerada > primera en esta colección > © del editor > primera edición.
 * - `anioOriginal`: «Primera edición» de la obra, o el © más antiguo si es una traducción.
 */
export function aniosDelColofon(c: Colofon): { anio?: number; anioOriginal?: number; confianzaAnio: number } {
  const traduccion = Boolean(c.tituloOriginal || c.traductores.length || c.copyright.some((x) => x.traduccion));
  const derechos = c.copyright.filter((x) => !x.traduccion).map((x) => x.anio);
  // En una traducción, «Primera edición» suele ser la de la traducción: manda el © más antiguo del original.
  const original = traduccion && derechos.length ? Math.min(...derechos, ...(c.primeraEdicion ? [c.primeraEdicion] : [])) : c.primeraEdicion;
  let anio = c.estaEdicion ?? c.primeraEnEsta;
  let confianzaAnio = anio ? 0.95 : 0;
  if (!anio && traduccion) {
    const deTraduccion = c.copyright.filter((x) => x.traduccion).map((x) => x.anio);
    const ultimo = [...deTraduccion, ...derechos].sort((a, b) => b - a)[0];
    if (ultimo && ultimo !== original) { anio = ultimo; confianzaAnio = 0.85; }
  }
  if (!anio && c.primeraEdicion) { anio = c.primeraEdicion; confianzaAnio = 0.9; }
  if (!anio && derechos.length) { anio = Math.max(...derechos); confianzaAnio = 0.8; }
  return { ...(anio ? { anio } : {}), ...(original ? { anioOriginal: original } : {}), confianzaAnio };
}
