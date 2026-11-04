/**
 * Ventanas de escucha y de visionado, marcas de tiempo y la transcripción de
 * cada ventana a partir de las unidades (texto con «**Nombre:**» y el instante
 * de cada palabra).
 */
import { instantesDePalabras } from '@scholaris/spdf';
import type { UnidadMedio } from './tipos.js';

export interface Ventana {
  /** Clave estable: «t0-t1» en décimas de segundo. */
  id: string;
  t0: number;
  t1: number;
  /** Tramo del que esta ventana es dueña al fusionar: los de todas tilan [0, duración). */
  propioDesde: number;
  propioHasta: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function ventana(t0: number, t1: number, propioDesde: number, propioHasta: number): Ventana {
  return { id: `${Math.round(t0 * 10)}-${Math.round(t1 * 10)}`, t0: r1(t0), t1: r1(t1), propioDesde: r1(propioDesde), propioHasta: r1(propioHasta) };
}

/**
 * Ventanas de `largo` segundos con `solape` segundos de solape. Cada una es dueña
 * de su tramo hasta la mitad de los solapes. Un resto final de menos de un
 * cuarto de ventana se suma a la última en vez de ir solo.
 */
export function ventanasDe(duracion: number, largo = 480, solape = 30): Ventana[] {
  if (!(duracion > 0)) return [];
  const paso = Math.max(30, largo - solape);
  const inicios: number[] = [0];
  while (inicios.at(-1)! + largo < duracion) inicios.push(inicios.at(-1)! + paso);
  if (inicios.length > 1 && duracion - inicios.at(-1)! < largo / 4 + solape) inicios.pop();
  return inicios.map((t0, i) => {
    const ultima = i === inicios.length - 1;
    const t1 = ultima ? duracion : t0 + largo;
    return ventana(t0, t1, i === 0 ? 0 : t0 + solape / 2, ultima ? duracion : t1 - solape / 2);
  });
}

/** Parte una ventana en dos (cuando la salida no cabe), con el mismo solape y los tramos propios repartidos. */
export function partirVentana(v: Ventana, solape = 30): [Ventana, Ventana] {
  const medio = (v.t0 + v.t1) / 2;
  return [
    ventana(v.t0, Math.min(v.t1, medio + solape / 2), v.propioDesde, medio),
    ventana(Math.max(v.t0, medio - solape / 2), v.t1, medio, v.propioHasta),
  ];
}

/** 3725.4 → «1:02:05.4». */
export function marca(s: number, decimas = true): string {
  const t = Math.max(0, s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const seg = t % 60;
  const ss = decimas ? (Math.floor(seg * 10) / 10).toFixed(1).padStart(4, '0') : String(Math.floor(seg)).padStart(2, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

/** «1:02:05.4», «02:05», «125.5», «125.5s» o un número → segundos. NaN si no se entiende. */
export function aSegundos(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return NaN;
  const s = x.trim().replace(/s$/, '');
  if (!s) return NaN;
  if (!s.includes(':')) return Number(s);
  const partes = s.split(':').map((p) => Number(p.replace(',', '.')));
  if (partes.some((p) => !Number.isFinite(p))) return NaN;
  return partes.reduce((a, p) => a * 60 + p, 0);
}

// ---------------------------------------------------------------------------
// Transcripción
// ---------------------------------------------------------------------------

export interface Turno {
  t0: number;
  t1: number;
  hablante?: string;
  texto: string;
}

const MARCA_TURNO = /\*\*([^*\n]{1,80}?):\*\*/g;

/**
 * Las frases de las unidades con su instante: cada «**Nombre:**» cambia de
 * hablante, y cada frase toma el instante de su primera palabra. Sin palabras,
 * el tiempo de la unidad se reparte por longitud.
 */
export function turnosDe(unidades: UnidadMedio[]): Turno[] {
  const out: Turno[] = [];
  for (const u of unidades) {
    const instantes = u.palabras ? instantesDePalabras(u.palabras) : null;
    // Trozos [hablante, texto] según las marcas.
    const trozos: Array<{ hablante?: string; texto: string }> = [];
    let ultimo = 0;
    let hablante = u.hablante;
    const vistos = [...u.texto.matchAll(MARCA_TURNO)];
    if (!vistos.length || vistos[0]!.index! > 0) trozos.push({ ...(vistos.length ? {} : hablante ? { hablante } : {}), texto: u.texto.slice(0, vistos[0]?.index ?? u.texto.length) });
    for (const [i, m] of vistos.entries()) {
      hablante = m[1]!.trim();
      ultimo = m.index! + m[0].length;
      trozos.push({ hablante, texto: u.texto.slice(ultimo, vistos[i + 1]?.index ?? u.texto.length) });
    }
    const totalPalabras = trozos.reduce((n, t) => n + t.texto.split(/\s+/).filter(Boolean).length, 0);
    let k = 0;
    const instante = (i: number): [number, number] => {
      if (instantes && instantes[i]) return instantes[i]!;
      const d = (u.t1 - u.t0) / Math.max(1, totalPalabras);
      return [u.t0 + i * d, u.t0 + (i + 1) * d];
    };
    for (const t of trozos) {
      const palabras = t.texto.split(/\s+/).filter(Boolean);
      if (!palabras.length) continue;
      // Frases: corte tras . ? ! … (sin partir números ni abreviaturas de una letra).
      let frase: string[] = [];
      let inicioFrase = k;
      const cerrar = (fin: number) => {
        if (!frase.length) return;
        const a = instante(inicioFrase), b = instante(fin - 1);
        out.push({ t0: r1(a[0]), t1: r1(Math.max(a[0], b[1])), ...(t.hablante ? { hablante: t.hablante } : {}), texto: frase.join(' ') });
        frase = [];
      };
      for (const p of palabras) {
        frase.push(p);
        k++;
        if (/[.?!…]["»”)]?$/.test(p) && !/^[A-ZÁÉÍÓÚÑ]\.$/.test(p)) { cerrar(k); inicioFrase = k; }
      }
      cerrar(k);
      inicioFrase = k;
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/** La transcripción de una ventana, una frase por línea: «[0:16:02.3] Diego: …». */
export function transcripcionDeVentana(turnos: Turno[], t0: number, t1: number, maxCaracteres = 40_000): string {
  const lineas: string[] = [];
  let n = 0;
  for (const t of turnos) {
    if (t.t1 < t0 || t.t0 > t1) continue;
    const l = `[${marca(t.t0)}] ${t.hablante ? `${t.hablante}: ` : ''}${t.texto}`;
    n += l.length + 1;
    if (n > maxCaracteres) { lineas.push('[…]'); break; }
    lineas.push(l);
  }
  return lineas.join('\n');
}

/** Los hablantes de la transcripción, del que más habla al que menos (sin «H1», «Rótulo» ni similares). */
export function hablantesDe(turnos: Turno[]): string[] {
  const n = new Map<string, number>();
  for (const t of turnos) if (t.hablante && !/^(H\d+|hablante\s*\d+|r[óo]tulo|speaker\s*\d+|desconocid[oa]|voz)$/i.test(t.hablante)) n.set(t.hablante, (n.get(t.hablante) ?? 0) + t.texto.length);
  return [...n].sort((a, b) => b[1] - a[1]).map(([h]) => h);
}
