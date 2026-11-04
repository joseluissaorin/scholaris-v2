/**
 * Anclaje material: lo que dice el modelo («u: 12, cita: "…"») pasa a ser una
 * prueba con su sitio exacto. La cita se busca en el texto de la unidad y se
 * guarda la de verdad (la del material, no la que escribió el modelo), con sus
 * `caracteres` en puntos de código NFC. En los medios, el tramo se estrecha a
 * las palabras citadas cuando se conocen sus instantes.
 *
 * Una cita que no se encuentra no es una prueba: no se guarda (principio 1 del
 * contrato), y se cuenta para la procedencia.
 */
import type { AnclaMaterial, Evidencia, ModoEvidencia } from '@scholaris/nucleo';
import type { Material, UnidadMaterial, VozPercibida } from './material.js';
import { instantes } from './material.js';
import type { RefModelo } from './tipos.js';

// ---------------------------------------------------------------------------
// Normalización para comparar (con mapa a las posiciones originales)
// ---------------------------------------------------------------------------

interface Normalizado {
  /** Solo letras y cifras en minúscula y sin diacríticos, con un espacio entre palabras. */
  texto: string;
  /** Para cada posición de `texto`, el índice UTF-16 del original de donde sale. */
  origen: number[];
}

const MARCA = /^[\p{M}]$/u;

function normalizar(original: string): Normalizado {
  const salida: string[] = [];
  const origen: number[] = [];
  let espacio = true;
  let i = 0;
  for (const cp of original) {
    const base = cp.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of base) {
      if (/[\p{L}\p{N}]/u.test(c)) {
        // Un carácter astral ocupa dos posiciones UTF-16: las dos apuntan a su origen.
        salida.push(c); for (let k = 0; k < c.length; k++) origen.push(i); espacio = false;
      } else if (!MARCA.test(c) && !espacio) {
        salida.push(' '); origen.push(i); espacio = true;
      }
    }
    i += cp.length;
  }
  if (salida.at(-1) === ' ') { salida.pop(); origen.pop(); }
  return { texto: salida.join(''), origen };
}

/** Índice UTF-16 → índice de punto de código. */
function aPuntosDeCodigo(texto: string, utf16: number): number {
  let n = 0;
  for (let i = 0; i < utf16 && i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
    n++;
  }
  return n;
}

/** Fin (exclusivo) en UTF-16 del carácter que empieza en `i`. */
function finDeCaracter(texto: string, i: number): number {
  const c = texto.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff ? i + 2 : i + 1;
}

export interface CitaLocalizada {
  /** [inicio, fin) en puntos de código NFC del texto de la unidad. */
  caracteres: [number, number];
  /** El pasaje tal como está en el material. */
  literal: string;
  exacta: boolean;
}

const cacheNormal = new WeakMap<object, Map<string, Normalizado>>();
function normalDe(u: { texto: string }): Normalizado {
  let m = cacheNormal.get(u);
  if (!m) { m = new Map(); cacheNormal.set(u, m); }
  let n = m.get(u.texto);
  if (!n) { n = normalizar(u.texto); m.set(u.texto, n); }
  return n;
}

function rango(texto: string, n: Normalizado, ini: number, fin: number): CitaLocalizada {
  const a = n.origen[ini] ?? 0;
  const ultimo = n.origen[Math.max(ini, fin - 1)] ?? a;
  const b = finDeCaracter(texto, ultimo);
  return { caracteres: [aPuntosDeCodigo(texto, a), aPuntosDeCodigo(texto, b)], literal: texto.slice(a, b), exacta: true };
}

/**
 * Busca una cita en el texto de una unidad. Primero entera (sin mayúsculas,
 * tildes ni puntuación, que el modelo a veces arregla); si no, por ventanas de
 * palabras (el OCR deja erratas que el modelo corrige al citar).
 */
export function localizarCita(unidad: { texto: string }, cita: string): CitaLocalizada | null {
  const texto = unidad.texto;
  const n = normalDe(unidad);
  const q = normalizar(cita.normalize('NFC').replace(/\[…\]|\.\.\.|…/g, ' ')).texto;
  if (q.length < 3 || !n.texto) return null;
  const i = n.texto.indexOf(q);
  if (i >= 0) return rango(texto, n, i, i + q.length);

  // Por ventanas: la primera y la última que casen dan el tramo.
  const palabras = q.split(' ');
  if (palabras.length < 3) return null;
  const tam = Math.min(5, Math.max(3, Math.floor(palabras.length / 3)));
  const ventanas: Array<{ pos: number; offset: number; largo: number }> = [];
  let offset = 0;
  for (let k = 0; k + tam <= palabras.length; k++) {
    const v = palabras.slice(k, k + tam).join(' ');
    const pos = n.texto.indexOf(v, ventanas.at(-1)?.pos ?? 0);
    if (pos >= 0) ventanas.push({ pos, offset, largo: v.length });
    offset += (palabras[k]?.length ?? 0) + 1;
  }
  // Hacen falta pruebas suficientes: al menos un tercio de las ventanas.
  const posibles = palabras.length - tam + 1;
  if (!ventanas.length || ventanas.length < Math.max(1, Math.ceil(posibles / 3))) return null;
  const primera = ventanas[0]!, ultima = ventanas.at(-1)!;
  const ini = Math.max(0, primera.pos - primera.offset);
  const finEstimado = ultima.pos + ultima.largo + Math.max(0, q.length - (ultima.offset + ultima.largo));
  const fin = Math.min(n.texto.length, Math.max(ini + 1, finEstimado));
  if (fin - ini > q.length * 1.6 + 20) return null;
  return { ...rango(texto, n, ini, fin), exacta: false };
}

// ---------------------------------------------------------------------------
// Medios: tiempo de un tramo de caracteres
// ---------------------------------------------------------------------------

const TURNO = /\*\*[^*\n]{1,60}:\*\*/g;

/** Palabras de una unidad (sin las marcas de turno) con su posición en puntos de código. */
function palabrasConPosicion(texto: string): Array<[number, number]> {
  const marcas: Array<[number, number]> = [...texto.matchAll(TURNO)].map((m) => [m.index!, m.index! + m[0].length]);
  const salida: Array<[number, number]> = [];
  for (const m of texto.matchAll(/\S+/g)) {
    const a = m.index!, b = a + m[0].length;
    if (marcas.some(([x, y]) => a >= x && b <= y)) continue;
    salida.push([aPuntosDeCodigo(texto, a), aPuntosDeCodigo(texto, b)]);
  }
  return salida;
}

/** El tramo de tiempo que cubren unos caracteres de una unidad (si hay instantes por palabra). */
export function tramoDeCaracteres(u: UnidadMaterial, caracteres: [number, number]): [number, number] | null {
  const ts = instantes(u);
  if (!ts?.length || u.t0 === undefined) return null;
  const ps = palabrasConPosicion(u.texto);
  if (!ps.length) return null;
  const idx = (cp: number) => {
    const k = ps.findIndex(([, b]) => b > cp);
    return k < 0 ? ps.length - 1 : k;
  };
  let a = idx(caracteres[0]), b = idx(Math.max(caracteres[0], caracteres[1] - 1));
  if (ps.length !== ts.length) {
    // Recuento distinto (la transcripción se revisó): reparto proporcional.
    const f = ts.length / ps.length;
    a = Math.floor(a * f); b = Math.min(ts.length - 1, Math.floor(b * f));
  }
  const t0 = ts[Math.min(a, ts.length - 1)]![0], t1 = ts[Math.min(b, ts.length - 1)]![1];
  return t1 >= t0 ? [t0, t1] : null;
}

/** Quién habla en una posición de una unidad de tiempo (la última marca «**Nombre:**» antes). */
export function hablanteEn(u: UnidadMaterial, cp: number): string | undefined {
  let quien: string | undefined = u.ancla.tipo === 'tiempo' ? u.ancla.hablante : undefined;
  for (const m of u.texto.matchAll(TURNO)) {
    if (aPuntosDeCodigo(u.texto, m.index!) > cp) break;
    quien = m[0].slice(2, -3).trim();
  }
  return quien;
}

// ---------------------------------------------------------------------------
// De la referencia del modelo a la evidencia
// ---------------------------------------------------------------------------

export function modoDe(m: Material): ModoEvidencia {
  return m.documento.tipo === 'video' ? 'video' : m.documento.tipo === 'audio' ? 'audio' : 'texto';
}

const palabrasDe = (s: string) => new Set(s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * El hablante que dio la percepción para lo que se dice en [t0, t1] (y, si se da,
 * con ese texto): la línea de diálogo percibida más cercana que comparta al menos
 * la mitad de las palabras. Las etiquetas de la transcripción a veces se cruzan.
 */
export function hablantePercibido(voces: readonly VozPercibida[] | undefined, t0: number, t1: number, texto?: string): string | undefined {
  if (!voces?.length) return undefined;
  const q = texto ? palabrasDe(texto) : null;
  let mejor: { v: VozPercibida; d: number } | null = null;
  for (const v of voces) {
    if (v.t < t0 - 2 || v.t > t1 + 2) continue;
    if (q && q.size) {
      const w = palabrasDe(v.texto);
      const comunes = [...q].filter((x) => w.has(x)).length;
      if (comunes < Math.min(q.size, w.size) / 2) continue;
    }
    const d = Math.abs(v.t - (t0 + t1) / 2);
    if (!mejor || d < mejor.d) mejor = { v, d };
  }
  return mejor?.v.hablante;
}

/** El ancla material de un tramo de caracteres de una unidad (con el hablante de la percepción si lo hay). */
export function anclaDe(u: UnidadMaterial, caracteres?: [number, number], voces?: readonly VozPercibida[]): AnclaMaterial {
  if (u.ancla.tipo === 'tiempo') {
    const tramo = caracteres ? tramoDeCaracteres(u, caracteres) : null;
    const etiquetado = caracteres ? hablanteEn(u, caracteres[0]) : u.ancla.hablante;
    const t0 = tramo?.[0] ?? u.ancla.t0, t1 = tramo?.[1] ?? u.ancla.t1;
    const hablante = (caracteres ? hablantePercibido(voces, t0, t1, textoDeCaracteres(u, caracteres)) : undefined) ?? etiquetado;
    return {
      tipo: 'tiempo', t0: tramo?.[0] ?? u.ancla.t0, t1: tramo?.[1] ?? u.ancla.t1,
      ...(hablante ? { hablante } : {}), ...(caracteres ? { caracteres } : {}),
    };
  }
  return { ...u.ancla, ...(caracteres ? { caracteres } : {}) };
}

export interface ResultadoAnclaje {
  evidencias: Evidencia[];
  /** Citas que no aparecen en el material: no se guardan. */
  descartadas: number;
}

/**
 * Convierte las referencias del modelo en evidencias. Busca la cita en la unidad
 * dicha, en sus vecinas y, si hace falta, en todo el documento (los modelos a
 * veces se equivocan de página por una).
 */
export function anclarReferencias(m: Material, refs: readonly RefModelo[] | undefined, o: { maximo?: number } = {}): ResultadoAnclaje {
  const evidencias: Evidencia[] = [];
  let descartadas = 0;
  const vistas = new Set<string>();
  for (const r of refs ?? []) {
    const e = anclarReferencia(m, r);
    if (!e) { descartadas++; continue; }
    const clave = JSON.stringify([e.unidad, e.figura, e.ancla.caracteres]);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    evidencias.push(e);
    if (o.maximo && evidencias.length >= o.maximo) break;
  }
  return { evidencias, descartadas };
}

export function anclarReferencia(m: Material, r: RefModelo): Evidencia | null {
  const documento = m.documento.id;
  if (r.f !== undefined && r.f !== null && !r.cita) {
    const f = m.fotogramas.find((x) => x.n === r.f);
    if (!f) return null;
    return {
      documento, modo: 'video', figura: f.id, unidad: f.unidad,
      ancla: { tipo: 'tiempo', t0: f.t, t1: f.t, instante: f.t },
      cita: (r.apoya ?? f.descripcion).slice(0, 400),
    };
  }
  const cita = (r.cita ?? '').trim();
  const u = r.u !== undefined && r.u !== null ? m.porOrden.get(r.u) : undefined;
  if (!cita && !u && m.medio && typeof r.t === 'number' && r.apoya) {
    // Lo que se ve en un instante (de la percepción): el fotograma de ese segundo.
    const cerca = m.unidades.find((x) => x.t0 !== undefined && x.t1 !== undefined && r.t! >= x.t0 && r.t! < x.t1);
    return {
      documento, modo: 'video', ancla: { tipo: 'tiempo', t0: r.t, t1: r.t, instante: r.t }, cita: r.apoya.slice(0, 400),
      ...(cerca ? { unidad: cerca.id } : {}),
    };
  }
  if (!cita) {
    if (!u) return null;
    const ancla = anclaDe(u);
    if (r.t !== undefined && ancla.tipo === 'tiempo' && r.t >= ancla.t0 - 1 && r.t <= ancla.t1 + 1) ancla.instante = r.t;
    return { documento, modo: modoDe(m), unidad: u.id, ancla, ...(r.apoya ? { cita: r.apoya.slice(0, 400) } : {}) };
  }
  const candidatas: UnidadMaterial[] = [];
  if (u) {
    candidatas.push(u);
    for (const d of [1, -1, 2, -2]) { const v = m.porOrden.get(u.orden + d); if (v) candidatas.push(v); }
  }
  for (const x of m.unidades) if (!candidatas.includes(x)) candidatas.push(x);
  for (const c of candidatas) {
    const loc = localizarCita(c, cita);
    if (!loc) continue;
    return { documento, modo: modoDe(m), unidad: c.id, ancla: anclaDe(c, loc.caracteres, m.voces), cita: loc.literal };
  }
  return null;
}

/** Busca todas las apariciones de unas formas literales en una unidad (palabra entera, sin solapes). */
export function buscarFormasEnUnidad(u: UnidadMaterial, formas: readonly string[], o: { mayusculas?: boolean } = {}): Array<{ caracteres: [number, number]; literal: string; forma: string }> {
  const salida: Array<{ caracteres: [number, number]; literal: string; forma: string; a: number; b: number }> = [];
  const ordenadas = [...new Set(formas.map((f) => f.trim()).filter((f) => f.length >= 2))].sort((a, b) => b.length - a.length);
  for (const forma of ordenadas) {
    const patron = new RegExp(`(?<![\\p{L}\\p{N}])${forma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, o.mayusculas === false ? 'giu' : 'gu');
    for (const x of u.texto.matchAll(patron)) {
      const a = x.index!, b = a + x[0].length;
      if (salida.some((s) => a < s.b && b > s.a)) continue;
      salida.push({ caracteres: [aPuntosDeCodigo(u.texto, a), aPuntosDeCodigo(u.texto, b)], literal: x[0], forma, a, b });
    }
  }
  return salida.sort((x, y) => x.a - y.a).map(({ caracteres, literal, forma }) => ({ caracteres, literal, forma }));
}

/** El texto de unos caracteres (puntos de código) de una unidad. */
export function textoDeCaracteres(u: { texto: string }, c: [number, number]): string {
  return Array.from(u.texto).slice(c[0], c[1]).join('');
}

/**
 * La prosa, sin las marcas del material que a veces deja el modelo («⟦U15⟧»,
 * «⟦F81 · 14:20⟧»): se cambian por su localizador humano («p. 14», «14:20»).
 */
export function limpiarProsa(texto: string, m: Pick<Material, 'porOrden' | 'fotogramas'>): string {
  if (!texto.includes('⟦')) return texto;
  return texto
    .replace(/⟦\s*([UF])(\d+)(?:\s*·\s*([^⟧]*))?⟧/g, (_x, k: string, n: string, et?: string) => {
      if (et?.trim()) return et.trim();
      if (k === 'U') return m.porOrden.get(Number(n))?.etiqueta ?? '';
      const f = m.fotogramas.find((x) => x.n === Number(n));
      return f ? etiquetaDeTiempo(f.t) : '';
    })
    .replace(/\(\s*(?:[,;]\s*)*\)/g, '')
    .replace(/\(\s*[,;]\s*/g, '(').replace(/\s*[,;]\s*\)/g, ')')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function etiquetaDeTiempo(t: number): string {
  const s = Math.floor(t), h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
