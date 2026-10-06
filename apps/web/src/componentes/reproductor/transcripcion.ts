/**
 * La transcripción como datos: palabras con su instante, turnos de palabra,
 * párrafos para pintar, líneas de subtítulo (WebVTT) y búsqueda. Todo puro:
 * se prueba sin navegador y se calcula una vez por documento.
 *
 * La API da unidades (tramos de ~50 s) con [t0, t1] y el texto, con los cambios
 * de hablante marcados como «**Nombre:**». Dentro del tramo, el instante de
 * cada palabra se estima repartiendo la duración por sílabas, con una pausa
 * después de cada coma y cada punto: se equivoca mucho menos que repartir por
 * letras, y nunca se sale del tramo.
 */
import type { UnidadVista } from '@scholaris/contrato';

export interface Palabra {
  texto: string;
  t0: number;
  t1: number;
  /** Índice del párrafo al que pertenece. */
  p: number;
  /** Índice del hablante en `hablantes`, o -1 si no se sabe. */
  h: number;
}

export interface Parrafo {
  /** Orden de la unidad (base 1, como en la web). */
  orden: number;
  t0: number;
  t1: number;
  h: number;
  /** El párrafo empieza un turno nuevo (se pinta el nombre). */
  turno: boolean;
  /** Palabras [desde, hasta). */
  desde: number;
  hasta: number;
}

export interface Turno { h: number; t0: number; t1: number }

export interface Linea { t0: number; t1: number; texto: string; h: number; desde: number; hasta: number }

export interface Transcripcion {
  palabras: Palabra[];
  /** t0 de cada palabra, para la búsqueda binaria (no se recorre nunca entera por fotograma). */
  inicios: Float64Array;
  parrafos: Parrafo[];
  /** Inicio de cada párrafo, también para búsqueda binaria. */
  iniciosParrafo: Float64Array;
  turnos: Turno[];
  iniciosTurno: Float64Array;
  hablantes: string[];
  /** Segundos hablados por cada hablante. */
  tiempoHablado: number[];
  lineas: Linea[];
  iniciosLinea: Float64Array;
}

const TURNO = /(\*\*[^*\n]{1,80}?:\*\*)/;
const ES_TURNO = /^\*\*([^*\n]+?):\*\*$/;

/** Sílabas aproximadas: grupos de vocales (al menos una). */
export function silabas(p: string): number {
  const g = p.toLowerCase().match(/[aeiouáéíóúüyàèìòùâêîôû]+/g);
  return Math.max(1, g?.length ?? Math.ceil(p.length / 3));
}

/** Peso temporal de una palabra: sus sílabas y la pausa que la sigue. */
export function peso(p: string): number {
  let w = silabas(p);
  if (/[.!?…»”"]$/.test(p)) w += 2.2;
  else if (/[,;:)—]$/.test(p)) w += 1;
  return w;
}

/** Último índice i con v[i] <= x (o -1). */
export function buscarIndice(v: ArrayLike<number>, x: number): number {
  let a = 0, b = v.length - 1, r = -1;
  while (a <= b) {
    const m = (a + b) >> 1;
    if (v[m]! <= x) { r = m; a = m + 1; } else b = m - 1;
  }
  return r;
}

/** La palabra que suena en t: la última que empezó, si aún no ha pasado mucho de su final. */
export function palabraEn(tr: Transcripcion, t: number): number {
  const i = buscarIndice(tr.inicios, t);
  if (i < 0) return -1;
  const w = tr.palabras[i]!;
  return t <= w.t1 + 1.5 ? i : -1;
}

export function parrafoEn(tr: Transcripcion, t: number): number {
  return Math.max(0, buscarIndice(tr.iniciosParrafo, t));
}

export function lineaEn(tr: Transcripcion, t: number): number {
  return buscarIndice(tr.iniciosLinea, t);
}

/** Construye la transcripción a partir de las unidades (en cualquier orden; solo las de tiempo). */
export function construirTranscripcion(unidades: UnidadVista[]): Transcripcion {
  const us = unidades.filter((u) => u.ancla.tipo === 'tiempo').sort((a, b) => a.orden - b.orden);
  const hablantes: string[] = [];
  const idHablante = (n: string | undefined): number => {
    if (!n) return -1;
    const limpio = n.replace(/\s+/g, ' ').trim();
    let i = hablantes.indexOf(limpio);
    if (i < 0) { hablantes.push(limpio); i = hablantes.length - 1; }
    return i;
  };

  const palabras: Palabra[] = [];
  const parrafos: Parrafo[] = [];
  let hPrevio = -2;

  for (const u of us) {
    if (u.ancla.tipo !== 'tiempo') continue;
    const { t0, t1 } = u.ancla;
    let h = idHablante(u.ancla.hablante);
    // Trozos del tramo: [hablante, palabras] cortados por las marcas de turno.
    const trozos: Array<{ h: number; marcado: boolean; ps: string[] }> = [];
    let marcado = false;
    for (const pieza of u.texto.replace(/\r/g, '').split(TURNO)) {
      const m = ES_TURNO.exec(pieza.trim());
      if (m) { h = idHablante(m[1]); marcado = true; continue; }
      // Los saltos de párrafo de la propia transcripción también abren párrafo.
      for (const bloque of pieza.split(/\n{2,}/)) {
        const ps = bloque.replace(/\*\*/g, '').split(/\s+/).filter(Boolean);
        if (ps.length) { trozos.push({ h, marcado, ps }); marcado = false; }
      }
    }
    const pesos = trozos.map((x) => x.ps.map(peso));
    const total = pesos.flat().reduce((a, b) => a + b, 0) || 1;
    const dur = Math.max(0, t1 - t0);
    let acum = 0;
    trozos.forEach((x, k) => {
      const desde = palabras.length;
      const p = parrafos.length;
      x.ps.forEach((texto, j) => {
        const a = t0 + (dur * acum) / total;
        acum += pesos[k]![j]!;
        palabras.push({ texto, t0: a, t1: t0 + (dur * acum) / total, p, h: x.h });
      });
      const turno = x.marcado || x.h !== hPrevio;
      parrafos.push({ orden: u.orden, t0: palabras[desde]!.t0, t1: palabras[palabras.length - 1]!.t1, h: x.h, turno, desde, hasta: palabras.length });
      hPrevio = x.h;
    });
  }

  // Turnos: párrafos seguidos del mismo hablante.
  const turnos: Turno[] = [];
  for (const p of parrafos) {
    const ult = turnos.at(-1);
    if (ult && ult.h === p.h && p.t0 - ult.t1 < 4) ult.t1 = Math.max(ult.t1, p.t1);
    else turnos.push({ h: p.h, t0: p.t0, t1: p.t1 });
  }
  const tiempoHablado = hablantes.map(() => 0);
  for (const t of turnos) if (t.h >= 0) tiempoHablado[t.h]! += t.t1 - t.t0;

  const lineas = construirLineas(palabras);
  return {
    palabras,
    inicios: Float64Array.from(palabras, (w) => w.t0),
    parrafos,
    iniciosParrafo: Float64Array.from(parrafos, (p) => p.t0),
    turnos, iniciosTurno: Float64Array.from(turnos, (t) => t.t0), hablantes, tiempoHablado,
    lineas,
    iniciosLinea: Float64Array.from(lineas, (l) => l.t0),
  };
}

/**
 * Líneas de subtítulo: hasta 84 caracteres (dos renglones de 42) o 6 s,
 * cortando antes en fin de frase, en cambio de hablante o en pausa larga.
 */
export function construirLineas(palabras: Palabra[], maxCar = 84, maxSeg = 6): Linea[] {
  const out: Linea[] = [];
  let desde = 0;
  const cerrar = (hasta: number) => {
    if (hasta <= desde) return;
    const ws = palabras.slice(desde, hasta);
    out.push({ t0: ws[0]!.t0, t1: ws.at(-1)!.t1, texto: ws.map((w) => w.texto).join(' '), h: ws[0]!.h, desde, hasta });
    desde = hasta;
  };
  for (let i = 0; i < palabras.length; i++) {
    const w = palabras[i]!;
    if (i > desde) {
      const previa = palabras[i - 1]!;
      const largo = palabras.slice(desde, i + 1).reduce((n, x) => n + x.texto.length + 1, 0);
      const cambio = w.h !== previa.h || w.p !== previa.p;
      const pausa = w.t0 - previa.t1 > 1.2;
      const finFrase = /[.!?…]$/.test(previa.texto) && largo > 30;
      if (cambio || pausa || finFrase || largo > maxCar || w.t1 - palabras[desde]!.t0 > maxSeg) cerrar(i);
    }
  }
  cerrar(palabras.length);
  return out;
}

const marcaVtt = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), x = Math.floor((ms % 60_000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
};

/** WebVTT con dos renglones equilibrados por línea y la voz del hablante (<v>). */
export function aVtt(tr: Pick<Transcripcion, 'lineas' | 'hablantes'>): string {
  const partes = ['WEBVTT', ''];
  tr.lineas.forEach((l, i) => {
    const siguiente = tr.lineas[i + 1];
    const fin = Math.max(l.t0 + 0.6, siguiente ? Math.min(l.t1 + 0.4, siguiente.t0) : l.t1 + 0.4);
    const texto = l.texto.length > 42 ? partirEnDos(l.texto) : l.texto;
    const voz = l.h >= 0 ? `<v ${tr.hablantes[l.h]!.replace(/[<>&]/g, '')}>` : '';
    partes.push(String(i + 1), `${marcaVtt(l.t0)} --> ${marcaVtt(fin)}`, voz + escaparVtt(texto), '');
  });
  return partes.join('\n');
}

function escaparVtt(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function partirEnDos(s: string): string {
  const mitad = s.length / 2;
  let mejor = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (mejor < 0 || Math.abs(i - mitad) < Math.abs(mejor - mitad))) mejor = i;
  return mejor < 0 ? s : `${s.slice(0, mejor)}\n${s.slice(mejor + 1)}`;
}

/** Normaliza para buscar: sin tildes, sin mayúsculas, sin signos. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Busca una frase (una o más palabras, sin distinguir tildes ni mayúsculas) y
 * devuelve el índice de la primera palabra de cada coincidencia y cuántas abarca.
 * La última palabra buscada puede ser un prefijo («Cortáz» encuentra «Cortázar»).
 */
export function buscarEnTranscripcion(palabras: Palabra[], consulta: string, max = 2000): Array<{ desde: number; largo: number }> {
  const qs = consulta.split(/\s+/).map(normalizar).filter(Boolean);
  if (!qs.length) return [];
  const norm = palabras.map((w) => normalizar(w.texto));
  const out: Array<{ desde: number; largo: number }> = [];
  for (let i = 0; i + qs.length <= norm.length && out.length < max; i++) {
    let ok = true;
    for (let j = 0; j < qs.length; j++) {
      const w = norm[i + j]!, q = qs[j]!;
      if (j === qs.length - 1 ? !w.startsWith(q) : w !== q) { ok = false; break; }
    }
    if (ok) out.push({ desde: i, largo: qs.length });
  }
  return out;
}

/** El pasaje [a, b] de palabras como texto y con su intervalo exacto. */
export function pasaje(tr: Transcripcion, a: number, b: number): { texto: string; t0: number; t1: number; h: number } {
  const [x, y] = a <= b ? [a, b] : [b, a];
  const ws = tr.palabras.slice(x, y + 1);
  return { texto: ws.map((w) => w.texto).join(' '), t0: ws[0]?.t0 ?? 0, t1: ws.at(-1)?.t1 ?? 0, h: ws[0]?.h ?? -1 };
}

/** Densidad del habla por cubos (palabras por segundo, 0-1): el «oscilograma» de reserva. */
export function densidad(tr: Transcripcion, duracion: number, cubos = 600): Float32Array {
  const out = new Float32Array(cubos);
  if (!duracion) return out;
  for (const w of tr.palabras) {
    const i = Math.min(cubos - 1, Math.floor((w.t0 / duracion) * cubos));
    out[i]! += silabas(w.texto);
  }
  let max = 0;
  for (const v of out) max = Math.max(max, v);
  if (max) for (let i = 0; i < cubos; i++) out[i] = Math.sqrt(out[i]! / max);
  return out;
}
