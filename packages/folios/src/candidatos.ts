/**
 * Candidatos a folio: los números que el código encuentra en la cabecera, el
 * pie, los bordes del texto y lo que dijo el lector. Se generan con generosidad
 * (mejor un candidato de más que uno de menos): la consistencia de la secuencia
 * y, si hace falta, el juez deciden después cuál es el bueno.
 *
 * Reglas heredadas de `pdf_processor._extract_text_page_numbers` (v3): números
 * sueltos en la primera y la última línea, decoraciones («— 23 —», «·12·»),
 * ruido de OCR con espacios («1 3») y romanos con notación sustractiva válida.
 * Añadidas: «p. 23», «pág. 23», «fol. 12v», números al principio o al final de
 * una cabecera corrida («23 THE DISCARDED IMAGE»), errores de OCR («l23», «8I»),
 * dobles páginas («12 … 13»), exclusión de años y de «Capítulo IV», «Núm. 184».
 */

import type { Candidato, FuenteCandidato, PaginaFolio } from './tipos.js';

/** Romano válido (notación sustractiva estricta): rechaza «LDI», «MIM», «IIII». */
export const ROMANO_ESTRICTO = /^(?=[ivxlcdm])m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i;

const VALORES_ROMANOS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Romano → entero; 0 si no es un romano válido. */
export function romanoAEntero(s: string): number {
  const t = s.trim().toLowerCase();
  if (!ROMANO_ESTRICTO.test(t)) return 0;
  let total = 0, previo = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const v = VALORES_ROMANOS[t[i] as string] ?? 0;
    total += v < previo ? -v : v;
    previo = Math.max(previo, v);
  }
  return total;
}

const ROMANOS: Array<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

export function enteroARomano(n: number, mayusculas = false): string {
  if (n <= 0 || n > 3999) return String(n);
  let s = '';
  for (const [v, r] of ROMANOS) while (n >= v) { s += r; n -= v; }
  return mayusculas ? s.toUpperCase() : s;
}

// ---------------------------------------------------------------------------
// Limpieza de líneas
// ---------------------------------------------------------------------------

/** Quita HTML, Markdown e imágenes, y colapsa espacios. */
export function limpiarLinea(linea: string): string {
  return linea
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // imágenes Markdown
    .replace(/<[^>]+>/g, ' ')                 // HTML
    .replace(/^\s*#+\s*/, '')                 // títulos Markdown
    .replace(/[*_`]+/g, ' ')                  // énfasis
    .replace(/\s+/g, ' ')
    .trim();
}

/** Líneas útiles de un bloque de texto (sin separadores ni restos de maquetación). */
export function lineasUtiles(texto: string | undefined | null): string[] {
  if (!texto) return [];
  return texto
    .split(/\r?\n/)
    .map(limpiarLinea)
    .filter((l) => l && !/^[-=_*~\s]{3,}$/.test(l) && !/^\|?[\s|:-]*\|?$/.test(l));
}

// ---------------------------------------------------------------------------
// Fichas (tokens)
// ---------------------------------------------------------------------------

const DECORACION_BORDE = /^[\s\-–—~.,:;*·•_=|[\](){}<>«»‹›"'“”‘’/\\]+|[\s\-–—~.,:;*·•_=|[\](){}<>«»‹›"'“”‘’/\\]+$/g;

/** Palabras tras las que un número NO es un folio: «Capítulo IV», «Núm. 184», «Vol. 2». */
const PALABRA_NO_FOLIO = /^(?:cap[íi]tulo|cap|chapter|chap|chapitre|capitolo|kapitel|part|parte|partie|teil|libro|book|livre|tomo|vol|volumen|volume|band|acto|act|jornada|canto|escena|scene|secci[óo]n|section|art|art[íi]culo|lecci[óo]n|tema|n[ºo°]|no|n[úu]m|num|n[úu]mero|number|nummer|fig|figura|figure|tabla|table|tab|l[áa]m|l[áa]mina|plate|ed|edici[óo]n|edition|año|year|anno|isbn|issn|doi|tel|telephone|tel[ée]fono)\.?$/i;

/** Palabras que introducen un folio: «p. 23», «pág. 23», «fol. 12v». */
const PALABRA_FOLIO = /^(?:p|pp|p[áa]g|p[áa]gs|p[áa]gina|page|pg|seite|s|fol|f|folio|fº|f°|fo)\.?$/i;

interface Lectura {
  valor: number;
  romana: boolean;
  mayusculas: boolean;
  corregido: boolean;
  lado?: 'r' | 'v';
}

/** Interpreta una ficha como número de página. */
export function leerFicha(fichaCruda: string, opciones: { romanos?: boolean; corregirOcr?: boolean } = {}): Lectura | null {
  const ficha = fichaCruda.replace(DECORACION_BORDE, '');
  if (!ficha || ficha.length > 9) return null;
  let m = /^(\d{1,4})$/.exec(ficha);
  if (m) return { valor: Number(m[1]), romana: false, mayusculas: false, corregido: false };
  m = /^(\d{1,4})([rv])$/i.exec(ficha);
  if (m) return { valor: Number(m[1]), romana: false, mayusculas: false, corregido: false, lado: (m[2] as string).toLowerCase() as 'r' | 'v' };
  if (opciones.corregirOcr !== false && /\d/.test(ficha) && /^[\dlIO|o]{2,4}$/.test(ficha)) {
    const arreglada = ficha.replace(/[lI|]/g, '1').replace(/[Oo]/g, '0');
    if (/^\d+$/.test(arreglada)) return { valor: Number(arreglada), romana: false, mayusculas: false, corregido: true };
  }
  if (opciones.romanos !== false && ROMANO_ESTRICTO.test(ficha)) {
    const minus = ficha === ficha.toLowerCase();
    const mayus = ficha === ficha.toUpperCase();
    if (!minus && !mayus) return null; // «Vi», «Mix»: palabras, no números
    const v = romanoAEntero(ficha);
    if (v > 0) return { valor: v, romana: true, mayusculas: mayus, corregido: false };
  }
  return null;
}

const esAnio = (l: Lectura) => !l.romana && l.valor >= 1400 && l.valor <= 2099;

// ---------------------------------------------------------------------------
// Extracción
// ---------------------------------------------------------------------------

const PESO_BASE: Record<FuenteCandidato, number> = {
  lector: 0.9,
  pie: 0.9,
  cabecera: 0.85,
  'texto-fin': 0.6,
  'texto-inicio': 0.5,
  juez: 1,
};

function candidato(l: Lectura, texto: string, fuente: FuenteCandidato, peso: number, extra: Partial<Candidato> = {}): Candidato {
  let p = peso;
  if (l.corregido) p *= 0.8;
  if (esAnio(l) && fuente !== 'lector') p *= 0.4;
  if (l.romana && l.valor > 60) p *= 0.6; // los preliminares rara vez pasan de lx
  const c: Candidato = {
    valor: l.valor,
    romana: l.romana,
    mayusculas: l.mayusculas,
    texto: texto.trim(),
    fuente,
    peso: Math.round(Math.min(1, p) * 1000) / 1000,
    corregido: l.corregido,
    ...extra,
  };
  if (l.lado) c.lado = l.lado;
  return c;
}

/** Candidatos de una línea de cabecera o pie (o del borde del texto). */
export function candidatosDeLinea(linea: string, fuente: FuenteCandidato): Candidato[] {
  const base = PESO_BASE[fuente];
  const enTexto = fuente === 'texto-inicio' || fuente === 'texto-fin';
  const l = limpiarLinea(linea);
  if (!l) return [];
  // Notas al pie y llamadas: «¹ Pt. 1, 2», «² Boethius…»
  if (/^[¹²³⁴⁵⁶⁷⁸⁹⁰]/.test(l)) return [];
  const salida: Candidato[] = [];

  // 1. La línea entera es un número (con decoraciones): «— 23 —», «xiv», «[23]».
  const entera = leerFicha(l);
  if (entera) return [candidato(entera, l, fuente, base)];

  const fichas = l.split(/\s+/).filter(Boolean);
  const limpias = fichas.map((f) => f.replace(DECORACION_BORDE, '')).filter(Boolean);

  // 2. Dígitos separados por el OCR: «1 3», «1·2».
  if (limpias.length >= 2 && limpias.length <= 3 && limpias.every((f) => /^\d$/.test(f))) {
    const unido = Number(limpias.join(''));
    salida.push(candidato({ valor: unido, romana: false, mayusculas: false, corregido: true }, l, fuente, base * 0.85));
  }
  const conPunto = /^[\s\-–—~.*·•]*(\d)[·.](\d)[\s\-–—~.*·•]*$/.exec(l);
  if (conPunto) salida.push(candidato({ valor: Number(`${conPunto[1]}${conPunto[2]}`), romana: false, mayusculas: false, corregido: true }, l, fuente, base * 0.8));

  // 3. Doble página: «12 13», «12 … 13» (dos números consecutivos en los extremos).
  if (limpias.length >= 2) {
    const a = leerFicha(limpias[0] as string, { romanos: false });
    const b = leerFicha(limpias[limpias.length - 1] as string, { romanos: false });
    if (a && b && !a.romana && !b.romana && b.valor === a.valor + 1 && !esAnio(a)) {
      salida.push(candidato(a, l, fuente, base * 0.75, { derecha: b.valor }));
    }
  }

  // 4. Marcadores explícitos: «p. 23», «pág. 23», «fol. 12v» (solo en cabecera/pie/lector:
  //    en el cuerpo son referencias de notas: «Boethius, p. 154»).
  if (!enTexto) {
    for (let i = 0; i < limpias.length - 1; i++) {
      if (PALABRA_FOLIO.test(fichas[i] as string) || PALABRA_FOLIO.test(limpias[i] as string)) {
        const lec = leerFicha(limpias[i + 1] as string);
        if (lec) salida.push(candidato(lec, l, fuente, base * 1.0));
      }
    }
  }

  // 5. Cabecera o pie corridos: el número al principio o al final de una línea corta
  //    («23 THE DISCARDED IMAGE», «Reservations 17»), o cualquier número de una línea
  //    muy corta con marcas del impresor («2 17 LDI», «65 | LDI»).
  const corta = limpias.length <= 8 && l.length <= 90;
  const muyCorta = limpias.length <= 4 && l.length <= 40;
  if (corta) {
    limpias.forEach((f, i) => {
      const extremo = i === 0 || i === limpias.length - 1;
      if (!extremo && !muyCorta) return;
      const previa = i > 0 ? (fichas[i - 1] as string) : '';
      if (previa && (PALABRA_NO_FOLIO.test(previa) || PALABRA_NO_FOLIO.test(previa.replace(DECORACION_BORDE, '')))) return;
      if (previa && PALABRA_FOLIO.test(previa) && !enTexto) return; // ya contado en 4
      // Romanos en medio de una línea son casi siempre palabras («di», «mi»).
      const lec = leerFicha(f, { romanos: extremo });
      if (!lec) return;
      // Un romano de una sola letra mayúscula dentro de una línea con texto es una palabra («I», «A»).
      if (lec.romana && f.length === 1 && lec.mayusculas) return;
      // En el cuerpo del texto, solo números (no romanos) y solo en líneas muy cortas.
      if (enTexto && (!muyCorta || (lec.romana && limpias.length > 1))) return;
      const peso = base * (extremo ? 0.8 : 0.6);
      salida.push(candidato(lec, l, fuente, peso));
    });
  }
  return salida;
}

/** Une candidatos repetidos (mismo valor y tipo): se queda con el de más peso y lo refuerza. */
export function fusionarCandidatos(lista: Candidato[]): Candidato[] {
  const porClave = new Map<string, Candidato[]>();
  for (const c of lista) {
    const k = `${c.romana ? 'r' : 'a'}${c.valor}${c.lado ?? ''}${c.derecha ?? ''}`;
    const g = porClave.get(k);
    if (g) g.push(c); else porClave.set(k, [c]);
  }
  const salida: Candidato[] = [];
  for (const g of porClave.values()) {
    g.sort((a, b) => b.peso - a.peso);
    const mejor = { ...(g[0] as Candidato) };
    const fuentes = new Set(g.map((c) => c.fuente));
    if (fuentes.size > 1) mejor.peso = Math.min(1, Math.round((mejor.peso + 0.05 * (fuentes.size - 1)) * 1000) / 1000);
    salida.push(mejor);
  }
  return salida.sort((a, b) => b.peso - a.peso || a.valor - b.valor);
}

/**
 * Todos los números candidatos de una página: lo que dijo el lector, la
 * cabecera, el pie y las primeras y últimas líneas del cuerpo.
 */
export function extraerCandidatos(pagina: PaginaFolio): Candidato[] {
  const lista: Candidato[] = [];
  if (pagina.folio && pagina.folio.trim()) {
    const conf = typeof pagina.confianza === 'number' && pagina.confianza > 0 ? Math.min(1, 0.6 + 0.4 * pagina.confianza) : 1;
    for (const c of candidatosDeLinea(pagina.folio, 'lector')) lista.push({ ...c, peso: Math.round(c.peso * conf * 1000) / 1000 });
  }
  const cab = lineasUtiles(pagina.cabecera);
  const pie = lineasUtiles(pagina.pie);
  for (const l of cab) lista.push(...candidatosDeLinea(l, 'cabecera'));
  for (const l of pie) lista.push(...candidatosDeLinea(l, 'pie'));
  const cuerpo = lineasUtiles(pagina.texto);
  if (cuerpo.length) {
    const inicio = cuerpo.slice(0, 2);
    const fin = cuerpo.length > 2 ? cuerpo.slice(-3) : cuerpo.slice(inicio.length);
    for (const l of inicio) lista.push(...candidatosDeLinea(l, 'texto-inicio'));
    for (const l of fin) lista.push(...candidatosDeLinea(l, 'texto-fin'));
  }
  return fusionarCandidatos(lista);
}

/** Cadena impresa de un candidato («23», «xiv», «XIV», «12r»). */
export function textoDeCandidato(c: Pick<Candidato, 'valor' | 'romana' | 'mayusculas' | 'lado'>): string {
  const base = c.romana ? enteroARomano(c.valor, c.mayusculas) : String(c.valor);
  return c.lado ? `${base}${c.lado}` : base;
}
