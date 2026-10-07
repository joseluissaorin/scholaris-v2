/**
 * El pasaje relevante de un resultado: las oraciones completas de un fragmento
 * que de verdad responden a la consulta. Es lo que se ve en la tarjeta, lo que
 * copia «Cita», lo que subraya el lector y lo que devuelven la API v1, el MCP
 * y el SDK. Se define aquí, en un solo sitio.
 *
 * - Siempre oraciones enteras (ni a medias ni con «…»), de 1 a 3, con un tope
 *   de palabras. Una oración larguísima se parte por versos o por cláusulas
 *   (punto y coma, dos puntos), nunca por la mitad de una cláusula.
 * - Los desplazamientos [desde, hasta) son del texto CRUDO del fragmento (el que
 *   guarda la estantería, con sus marcas de hablante o de la OCR): el marcado se
 *   tapa con espacios de la misma longitud antes de segmentar, así que las
 *   posiciones valen tal cual para el original.
 * - El texto del pasaje es literal: el del fragmento, sin marcado y con los
 *   blancos plegados (los versos, separados por « / »). Nunca texto de un modelo.
 */
import type { Ancla } from './dominio.js';

export interface Pasaje {
  /** Texto literal del pasaje, tal como se cita. */
  texto: string;
  /** Desplazamientos [desde, hasta) dentro de `fragmento.texto`. */
  desde: number;
  hasta: number;
  /** Ancla de las oraciones del pasaje (su página o su segundo). Si falta, vale la del fragmento. */
  ancla?: Ancla;
  /** Si el pasaje cruza unidades: el ancla de la última. */
  anclaFin?: Ancla;
}

/** Una coincidencia de la consulta dentro del texto (posiciones del texto crudo). */
export interface Tramo { desde: number; hasta: number; termino?: string }

export interface Oracion {
  desde: number;
  hasta: number;
  /** Bloque: párrafo o turno de palabra. Un pasaje nunca cruza de bloque. */
  bloque: number;
  /** Título de Markdown («## …»): no se cita solo. */
  titulo?: boolean;
}

// ---------------------------------------------------------------------------
// La máscara: el marcado se tapa con espacios (misma longitud que el original)
// ---------------------------------------------------------------------------

const IMAGEN_OCR = /!\[[^\]\n]*\]\([^)\n]*\)/g;
const DIV_OCR = /<\/?div\b[^>\n]*>/gi;
const MARCA_HABLANTE = /\*\*([^*\n]{1,80}?):\*\*[ \t]*/g;
const CORTADA_INICIO = /^(\s*…\s*)?[^*\n]{0,80}?:\*\*[ \t]*/;
const CORTADA_FINAL = /[ \t]*\*\*[^*\n]{0,80}?(\s*…)?\s*$/;
const TITULO = /^([ \t]*#{1,6}[ \t]+)(.*)$/gm;

const blancos = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * El texto con el marcado tapado: imágenes y `<div>` de la OCR, marcas de
 * hablante (enteras o partidas por un corte), almohadillas de los títulos y
 * asteriscos sueltos. Devuelve también dónde empieza cada turno y cada título.
 */
export function enmascarar(crudo: string): { texto: string; turnos: number[]; titulos: Array<[number, number]> } {
  const turnos: number[] = [];
  const titulos: Array<[number, number]> = [];
  let m = crudo.replace(IMAGEN_OCR, blancos).replace(DIV_OCR, blancos);
  m = m.replace(MARCA_HABLANTE, (x: string, _n: string, en: number) => { turnos.push(en + x.length); return blancos(x); });
  m = m.replace(CORTADA_INICIO, (x: string, puntos?: string) => (puntos ?? '') + blancos(x.slice((puntos ?? '').length)));
  m = m.replace(CORTADA_FINAL, (x: string, puntos?: string) => (puntos ? blancos(x.slice(0, x.length - puntos.length)) + puntos : blancos(x)));
  m = m.replace(TITULO, (x: string, almohadillas: string, _resto: string, en: number) => { titulos.push([en, en + x.length]); return blancos(almohadillas) + x.slice(almohadillas.length); });
  m = m.replace(/\*+/g, blancos);
  return { texto: m, turnos, titulos };
}

// ---------------------------------------------------------------------------
// Oraciones
// ---------------------------------------------------------------------------

/** Abreviaturas que no cierran oración (en minúsculas y sin tildes, sin el punto final). */
const ABREVIATURAS = new Set((
  'sr sra srta sres srs sras dr dra dres drs d dna dn don ud uds vd vds v vv p pp pag pags cap caps vol vols num n no nro art arts ' +
  'cf cfr ej fig figs ed eds trad col cols t ts tom fol fols lib s ss sto sta stas stos st mr mrs ms mme mlle av avda prof profa lic ing ' +
  'arq excmo excma ilmo ilma rvdo rdo mons fr fray gral cnel tte vs ca aprox ib ibid id op cit al apdo dpto admon cia hnos ntra nra ntro ' +
  'vda esq pral izq dcha tel ref sig sigs ant lin cod coord dir pte vda ms mss cod a.c d.c a.m p.m e.g i.e etc.al'
).split(/\s+/));

const quitarTildes = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const TERMINAL = '.?!…';
const CIERRE = '»”"\'’)]';
const APERTURA = '—–-«"“‘\'(¿¡[';
const esMayuscula = (c: string | undefined) => !!c && /\p{Lu}/u.test(c);
const esBlanco = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' ';

/** ¿El punto en `i` es de una abreviatura («Sr.», «p.», «a. C.», una inicial)? */
function esAbreviatura(m: string, i: number): boolean {
  let a = i;
  while (a > 0 && /[\p{L}\p{N}.ª]/u.test(m[a - 1] as string)) a--;
  const palabra = m.slice(a, i);
  if (!palabra) return false;
  // Una inicial («J. L. Borges»): una sola letra mayúscula.
  if (/^\p{Lu}$/u.test(palabra)) return true;
  // «a. C.», «d. C.»
  if ((palabra === 'a' || palabra === 'd') && /^\s*C\./.test(m.slice(i + 1, i + 5))) return true;
  const llano = quitarTildes(palabra).replace(/ª/g, 'a');
  if (ABREVIATURAS.has(llano)) return true;
  // «a.C», «d.C», «i.e», «e.g»: letras separadas por puntos.
  return /^(\p{L}\.)+\p{L}$/u.test(palabra);
}

/** Bloques [desde, hasta) separados por párrafo, por turno de palabra o por título. */
function bloques(m: string, turnos: number[], titulos: Array<[number, number]>): Array<{ desde: number; hasta: number; titulo?: boolean }> {
  const cortes = new Set<number>([0, m.length]);
  for (const x of m.matchAll(/\n[ \t]*\n/g)) { cortes.add(x.index); cortes.add(x.index + x[0].length); }
  for (const t of turnos) cortes.add(t);
  for (const [a, b] of titulos) { cortes.add(a); cortes.add(b); }
  const orden = [...cortes].filter((x) => x >= 0 && x <= m.length).sort((a, b) => a - b);
  const salida: Array<{ desde: number; hasta: number; titulo?: boolean }> = [];
  for (let i = 0; i + 1 < orden.length; i++) {
    let a = orden[i] as number, b = orden[i + 1] as number;
    while (a < b && esBlanco(m[a])) a++;
    while (b > a && esBlanco(m[b - 1])) b--;
    if (b > a) salida.push({ desde: a, hasta: b, ...(titulos.some(([x, y]) => a >= x && b <= y) ? { titulo: true } : {}) });
  }
  return salida;
}

/** Oraciones de un tramo [desde, hasta) del texto enmascarado. */
function oracionesDeBloque(m: string, desde: number, hasta: number): Array<[number, number]> {
  const salida: Array<[number, number]> = [];
  let inicio = desde;
  for (let i = desde; i < hasta; i++) {
    const c = m[i] as string;
    if (!TERMINAL.includes(c)) continue;
    let j = i;
    while (j + 1 < hasta && TERMINAL.includes(m[j + 1] as string)) j++;
    let k = j;
    while (k + 1 < hasta && CIERRE.includes(m[k + 1] as string)) k++;
    if (k + 1 >= hasta) break;
    if (!esBlanco(m[k + 1])) { i = k; continue; }
    let n = k + 1;
    while (n < hasta && esBlanco(m[n])) n++;
    if (n >= hasta) break;
    // ¿Empieza ahí otra oración? Mayúscula, o una apertura de pregunta o exclamación.
    // Una raya seguida de minúscula es el inciso del narrador («—¿Vienes? —preguntó»): sigue la oración.
    let p = n, abre = false;
    while (p < hasta && (APERTURA.includes(m[p] as string) || (p > n && m[p] === ' '))) { if (m[p] === '¿' || m[p] === '¡') abre = true; p++; }
    if (!abre && !esMayuscula(m[p])) { i = k; continue; }
    if (c === '.' && j === i && esAbreviatura(m, i)) { i = k; continue; }
    salida.push([inicio, k + 1]);
    inicio = n;
    i = n - 1;
  }
  if (inicio < hasta) salida.push([inicio, hasta]);
  return salida;
}

/** Las oraciones de un texto crudo, con posiciones del crudo. */
export function oraciones(crudo: string): Oracion[] {
  const { texto: m, turnos, titulos } = enmascarar(crudo);
  return oracionesEnmascaradas(m, turnos, titulos);
}

function oracionesEnmascaradas(m: string, turnos: number[], titulos: Array<[number, number]>): Oracion[] {
  const salida: Oracion[] = [];
  bloques(m, turnos, titulos).forEach((b, n) => {
    if (b.titulo) { salida.push({ desde: b.desde, hasta: b.hasta, bloque: n, titulo: true }); return; }
    for (const [a, z] of oracionesDeBloque(m, b.desde, b.hasta)) salida.push({ desde: a, hasta: z, bloque: n });
  });
  return salida;
}

/** Partes de una oración demasiado larga: versos y, si no, cláusulas (tras «;» o «:»). */
function partirOracion(m: string, o: Oracion): Oracion[] {
  const cortes: number[] = [];
  const texto = m.slice(o.desde, o.hasta);
  const porLineas = texto.includes('\n');
  const re = porLineas ? /\n/g : /[;:](?=\s)/g;
  for (const x of texto.matchAll(re)) cortes.push(o.desde + x.index + 1);
  if (!cortes.length) return [o];
  const salida: Oracion[] = [];
  let a = o.desde;
  for (const c of [...cortes, o.hasta]) {
    let x = a, z = c;
    while (x < z && esBlanco(m[x])) x++;
    while (z > x && esBlanco(m[z - 1])) z--;
    if (z > x) salida.push({ desde: x, hasta: z, bloque: o.bloque });
    a = c;
  }
  return salida;
}

const contarPalabras = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** El texto que se cita de [desde, hasta): blancos plegados y los versos separados por « / ». */
export function textoDePasaje(m: string, desde: number, hasta: number): string {
  return m.slice(desde, hasta).replace(/[ \t]*\n[ \t]*(?:\n[ \t]*)*/g, ' / ').replace(/\s+/g, ' ').trim();
}

export interface OpcionesPasaje {
  /** La ventana que se ve en la tarjeta (el resaltado): el pasaje sale de ahí. */
  foco?: [number, number];
  /** Oraciones como mucho (3). */
  maxOraciones?: number;
  /** Palabras como mucho al juntar oraciones (70). */
  maxPalabras?: number;
  /** Por debajo de estas palabras, se añade la oración vecina aunque no tenga coincidencias (8). */
  minPalabras?: number;
  /** Una sola oración con más palabras que esto se parte por versos o cláusulas (110). */
  techo?: number;
}

/**
 * Elige el pasaje: la oración con más coincidencias (distintas, y luego en
 * total) dentro de la ventana que se ve, ampliada con sus vecinas del mismo
 * párrafo si también responden (o si es muy corta), sin pasar de 3 oraciones ni
 * del tope de palabras. Sin coincidencias (un acierto solo por sentido), la
 * primera oración entera de la ventana.
 */
export function elegirPasaje(crudo: string, tramos: Tramo[], opciones: OpcionesPasaje = {}): Pasaje {
  const { texto: m, turnos, titulos } = enmascarar(crudo);
  const maxOraciones = opciones.maxOraciones ?? 3;
  const maxPalabras = opciones.maxPalabras ?? 70;
  const minPalabras = opciones.minPalabras ?? 8;
  const techo = opciones.techo ?? 110;
  const todas = oracionesEnmascaradas(m, turnos, titulos);
  if (!todas.length) return { texto: '', desde: 0, hasta: 0 };
  const foco = opciones.foco ?? [0, m.length];

  const puntuar = (o: Oracion) => {
    if (o.titulo) return -1;
    const dentro = tramos.filter((t) => t.desde >= o.desde && t.hasta <= o.hasta);
    const distintos = new Set(dentro.map((t) => t.termino ?? m.slice(t.desde, t.hasta).toLowerCase())).size;
    return distintos + 0.25 * dentro.length;
  };
  const solape = (o: Oracion) => Math.max(0, Math.min(o.hasta, foco[1]) - Math.max(o.desde, foco[0]));

  const elegir = (lista: Oracion[], profundidad: number): [number, number] => {
    const pal = lista.map((o) => contarPalabras(m.slice(o.desde, o.hasta)));
    const pts = lista.map(puntuar);
    const enFoco = lista.map((o, i) => i).filter((i) => solape(lista[i] as Oracion) > 0 && !(lista[i] as Oracion).titulo);
    const candidatas = enFoco.length ? enFoco : lista.map((_, i) => i).filter((i) => !(lista[i] as Oracion).titulo);
    if (!candidatas.length) return [lista[0]!.desde, lista[0]!.hasta];
    let mejor = candidatas[0] as number;
    for (const i of candidatas) {
      const a = pts[i] as number, b = pts[mejor] as number;
      if (a > b || (a === b && a > 0 && solape(lista[i] as Oracion) > solape(lista[mejor] as Oracion))) mejor = i;
    }
    // Sin coincidencias: la primera oración que empieza dentro de la ventana (la que se lee primero).
    if ((pts[mejor] ?? 0) <= 0) mejor = candidatas.find((i) => (lista[i] as Oracion).desde >= foco[0]) ?? mejor;
    // Una oración enorme: se elige dentro de ella, por versos o cláusulas.
    if ((pal[mejor] ?? 0) > techo && profundidad === 0) {
      const partes = partirOracion(m, lista[mejor] as Oracion);
      if (partes.length > 1) return elegir(partes, 1);
    }
    let a = mejor, z = mejor, total = pal[mejor] ?? 0;
    const valida = (i: number) => i >= 0 && i < lista.length && !(lista[i] as Oracion).titulo && (lista[i] as Oracion).bloque === (lista[mejor] as Oracion).bloque;
    while (z - a + 1 < maxOraciones) {
      const opciones: number[] = [z + 1, a - 1].filter((i) => valida(i) && total + (pal[i] ?? 0) <= maxPalabras);
      if (!opciones.length) break;
      const conAciertos = opciones.filter((i) => (pts[i] ?? 0) > 0).sort((x, y) => (pts[y] ?? 0) - (pts[x] ?? 0));
      const siguiente = conAciertos[0] ?? (total < minPalabras && profundidad === 0 ? opciones[0] : undefined);
      if (siguiente === undefined) break;
      if (siguiente > z) z = siguiente; else a = siguiente;
      total += pal[siguiente] ?? 0;
    }
    return [(lista[a] as Oracion).desde, (lista[z] as Oracion).hasta];
  };

  const [desde, hasta] = elegir(todas, 0);
  return { texto: textoDePasaje(m, desde, hasta), desde, hasta };
}

// ---------------------------------------------------------------------------
// Ubicar un pasaje en otro texto (la página del lector, el resaltado, la unidad)
// ---------------------------------------------------------------------------

/** Letras y cifras plegadas (sin tildes ni mayúsculas) con su posición en el original. */
function esqueleto(texto: string): { s: string; pos: number[] } {
  let s = '';
  const pos: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i] as string;
    if (!/[\p{L}\p{N}]/u.test(c)) continue;
    const p = c === 'ſ' ? 's' : quitarTildes(c);
    s += p[0] ?? c;
    pos.push(i);
  }
  return { s, pos };
}

/**
 * Dónde está `aguja` dentro de `texto`, sin contar tildes, mayúsculas, blancos,
 * signos ni marcado (también con palabras partidas por guion a final de línea).
 * Devuelve [desde, hasta) en `texto`, con los signos de apertura y de cierre
 * de alrededor, o null. Si no está entera, prueba con su principio (`parcial`).
 */
export function ubicarPasaje(texto: string, aguja: string, opciones: { parcial?: boolean; desde?: number } = {}): [number, number] | null {
  const t = esqueleto(texto), a = esqueleto(aguja);
  if (!a.s) return null;
  const inicioEsq = opciones.desde ? t.pos.findIndex((p) => p >= (opciones.desde as number)) : 0;
  if (inicioEsq < 0) return null;
  let i = t.s.indexOf(a.s, Math.max(0, inicioEsq));
  let largo = a.s.length;
  if (i < 0 && opciones.parcial) {
    // El principio del pasaje (una página puede tener solo su arranque, o solo su final).
    for (let n = Math.min(a.s.length - 1, 400); n >= 24 && i < 0; n = Math.floor(n * 0.75)) {
      i = t.s.indexOf(a.s.slice(0, n), Math.max(0, inicioEsq));
      largo = n;
    }
  }
  if (i < 0) return null;
  let desde = t.pos[i] as number;
  let hasta = (t.pos[i + largo - 1] as number) + 1;
  while (desde > 0 && APERTURA.includes(texto[desde - 1] as string)) desde--;
  for (;;) {
    if (hasta < texto.length && (TERMINAL.includes(texto[hasta] as string) || CIERRE.includes(texto[hasta] as string))) { hasta++; continue; }
    // El signo con espacio delante (francés: « vivant ! »).
    let n = hasta;
    while (n < texto.length && (texto[n] === ' ' || texto[n] === '\u00a0' || texto[n] === '\u202f')) n++;
    if (n > hasta && n < texto.length && '?!;:'.includes(texto[n] as string) && (texto[n] === '?' || texto[n] === '!')) { hasta = n + 1; continue; }
    break;
  }
  return [desde, hasta];
}

/** ¿Cuántas letras del principio de `aguja` hay al final de `texto`? (para saber dónde se parte entre dos páginas). */
export function finalDePasajeEn(texto: string, aguja: string): number {
  const t = esqueleto(texto).s, a = esqueleto(aguja).s;
  for (let n = Math.min(a.length, t.length); n >= 12; n--) if (t.endsWith(a.slice(0, n))) return n;
  return 0;
}

/**
 * El trozo del pasaje que hay en una unidad (una página del lector): entero, su
 * principio (al final de la página: el pasaje sigue en la siguiente) o su final
 * (al principio de la página: venía de la anterior). Null si no está.
 */
export function ubicarPasajeEnUnidad(texto: string, aguja: string): { desde: number; hasta: number; parte: 'entero' | 'principio' | 'final' | 'medio' } | null {
  const entero = ubicarPasaje(texto, aguja);
  if (entero) return { desde: entero[0], hasta: entero[1], parte: 'entero' };
  const t = esqueleto(texto), a = esqueleto(aguja);
  if (t.s.length < 12 || a.s.length < 24) return null;
  // La unidad entera cae dentro del pasaje (un párrafo de en medio de un fragmento largo).
  if (t.s.length >= 24 && a.s.includes(t.s)) return { desde: t.pos[0] as number, hasta: texto.length, parte: 'medio' };
  // Su principio, al final de la página.
  const n = finalDePasajeEn(texto, aguja);
  if (n >= 12) {
    let desde = t.pos[t.s.length - n] as number;
    while (desde > 0 && APERTURA.includes(texto[desde - 1] as string)) desde--;
    return { desde, hasta: texto.length, parte: 'principio' };
  }
  // Su final, al principio de la página.
  for (let k = Math.min(a.s.length - 1, t.s.length); k >= 12; k--) {
    if (t.s.startsWith(a.s.slice(a.s.length - k))) {
      let hasta = (t.pos[k - 1] as number) + 1;
      while (hasta < texto.length && (TERMINAL.includes(texto[hasta] as string) || CIERRE.includes(texto[hasta] as string))) hasta++;
      return { desde: 0, hasta, parte: 'final' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// El ancla del pasaje: la página (o el segundo) de sus oraciones
// ---------------------------------------------------------------------------

/** Una unidad de la que puede salir el pasaje, como la guarda la estantería. */
export interface UnidadPasaje {
  orden: number;
  ancla: Ancla;
  texto: string;
  /** Audio y vídeo: instantes por palabra ({ v: 1, t0, cs: [inicio, duración, …] } en centésimas). */
  palabras?: { v: number; t0: number; cs: number[] } | null;
}

/** Instante [t0, t1] de las palabras [i, j] de una unidad con instantes por palabra. */
function instantes(u: UnidadPasaje, i: number, j: number): [number, number] | null {
  const p = u.palabras;
  if (!p || p.v !== 1 || !Array.isArray(p.cs) || p.cs.length < 2 * (j + 1)) return null;
  const a = p.t0 + (p.cs[2 * i] as number) / 100;
  const b = p.t0 + ((p.cs[2 * j] as number) + (p.cs[2 * j + 1] as number)) / 100;
  return [Math.round(a * 100) / 100, Math.round(b * 100) / 100];
}

/** Índice de la palabra (separadas por blancos, sin las marcas de hablante) que contiene la posición `pos`. */
function palabraEn(textoSinMarcas: string, pos: number): number {
  const antes = textoSinMarcas.slice(0, pos);
  const n = antes.split(/\s+/).filter(Boolean).length;
  return !antes || /\s$/.test(antes) ? n : Math.max(0, n - 1);
}

const sinMarcasHablante = (t: string) => t.replace(MARCA_HABLANTE, '').replace(/\*+/g, '');

/**
 * Pone al pasaje el ancla de sus propias oraciones, mirando el texto de las
 * unidades que cubre el fragmento (en orden):
 * - en un libro, la página donde empieza el pasaje y, si sigue en la siguiente,
 *   la de su final («pp. 20-21» solo si el pasaje de verdad cruza);
 * - en audio y vídeo, el segundo de su primera palabra y el de la última (con
 *   los instantes por palabra de la ingesta; sin ellos, el tramo donde está).
 * Sin unidades, o si no se encuentra, se queda con el ancla del fragmento.
 */
export function anclarPasaje(pasaje: Pasaje, fragmento: { ancla: Ancla; anclaFin?: Ancla }, unidades: UnidadPasaje[]): Pasaje {
  const salida: Pasaje = { ...pasaje };
  delete salida.ancla;
  delete salida.anclaFin;
  if (!unidades.length || !pasaje.texto) return salida;
  const tiempo = fragmento.ancla.tipo === 'tiempo';
  // Unidad donde empieza: la primera que contiene el pasaje entero, o su principio.
  let ui = -1, rango: [number, number] | null = null;
  for (let i = 0; i < unidades.length && ui < 0; i++) {
    const texto = tiempo ? sinMarcasHablante(unidades[i]!.texto) : unidades[i]!.texto;
    const r = ubicarPasaje(texto, pasaje.texto);
    if (r) { ui = i; rango = r; }
  }
  let fin = ui;
  if (ui < 0) {
    // El pasaje cruza: empieza al final de una unidad y acaba en la siguiente.
    for (let i = 0; i + 1 < unidades.length && ui < 0; i++) {
      const texto = tiempo ? sinMarcasHablante(unidades[i]!.texto) : unidades[i]!.texto;
      const n = finalDePasajeEn(texto, pasaje.texto);
      if (n > 0) {
        ui = i; fin = i + 1;
        const r = ubicarPasaje(texto, pasaje.texto, { parcial: true });
        rango = r ? [r[0], texto.length] : null;
      }
    }
  }
  if (ui < 0) return salida;
  const u0 = unidades[ui]!, u1 = unidades[fin]!;
  if (!tiempo) {
    salida.ancla = u0.ancla;
    if (fin !== ui) salida.anclaFin = u1.ancla;
    return salida;
  }
  // Audio y vídeo: el segundo de la primera palabra.
  const base = u0.ancla.tipo === 'tiempo' ? u0.ancla : null;
  if (!base) return salida;
  const texto0 = sinMarcasHablante(u0.texto);
  if (rango && fin === ui) {
    const i = palabraEn(texto0, rango[0]);
    const j = Math.max(i, palabraEn(texto0, rango[1] - 1));
    const t = instantes(u0, i, j);
    salida.ancla = t ? { ...base, t0: t[0], t1: t[1] } : { ...base };
  } else if (rango) {
    const i = palabraEn(texto0, rango[0]);
    const n = texto0.trim().split(/\s+/).length;
    const t = instantes(u0, i, n - 1);
    const fin1 = u1.ancla.tipo === 'tiempo' ? u1.ancla.t1 : base.t1;
    salida.ancla = t ? { ...base, t0: t[0], t1: fin1 } : { ...base, t1: fin1 };
  } else salida.ancla = { ...base };
  return salida;
}
