/**
 * Libros sintéticos para probar los folios: portada, preliminares en romanos,
 * cuerpo en arábigos, láminas sin numerar, lecturas que faltan, errores de OCR,
 * notas al pie, dobles páginas y foliación de libro antiguo.
 */

import { enteroARomano } from '../src/candidatos.js';
import type { PaginaFolio } from '../src/tipos.js';

export function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OpcionesLibro {
  semilla?: number;
  /** Páginas al principio sin numerar ni contar (cubierta, guardas). */
  cubierta?: number;
  /** Páginas de preliminares en romanos (las primeras `romanosSinNumero` no llevan el número impreso). */
  romanos?: number;
  romanosSinNumero?: number;
  /** Romanos en mayúsculas. */
  romanosMayusculas?: boolean;
  /** Páginas del cuerpo. */
  cuerpo?: number;
  /** Primer folio del cuerpo (artículos que empiezan en la 434). */
  primerFolio?: number;
  /** Láminas sin numerar ni contar, insertadas DESPUÉS de estas páginas del cuerpo (índice 0-based). */
  laminasTras?: number[];
  /** Cada cuántas páginas empieza capítulo (página sin número impreso). */
  capituloCada?: number;
  /** Probabilidad de que el número de una página numerada se vea. */
  lectura?: number;
  /** Probabilidad de error de OCR en un número visible (l por 1, una cifra cambiada). */
  errorOcr?: number;
  /** Probabilidad de una nota al pie con número suelto en la última línea. */
  notas?: number;
  /** Dónde va el número: pie, cabecera corrida o lo que diga el lector. */
  posicion?: 'pie' | 'cabecera' | 'lector' | 'texto';
  /** Doble página (dos páginas del libro por imagen). */
  doble?: boolean;
  /** Libro foliado: un número por hoja, solo en el recto. */
  foliacion?: boolean;
  /** Primer folio de un libro foliado tras los preliminares sin numerar. */
}

export interface LibroSintetico {
  paginas: PaginaFolio[];
  /** Folio verdadero de cada página física (null si no tiene). */
  verdad: Array<string | null>;
  /** Índices de las láminas. */
  laminas: number[];
}

const PALABRAS = 'la de que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros'.split(' ');

function parrafo(r: () => number, n: number): string {
  const s: string[] = [];
  for (let i = 0; i < n; i++) s.push(PALABRAS[Math.floor(r() * PALABRAS.length)] as string);
  return s.join(' ');
}

function texto(r: () => number, lineas = 30): string {
  const ls: string[] = [];
  for (let i = 0; i < lineas; i++) ls.push(parrafo(r, 9 + Math.floor(r() * 4)));
  return ls.join('\n');
}

function estropear(s: string, r: () => number): string {
  if (r() < 0.5 && s.includes('1')) return s.replace('1', r() < 0.5 ? 'l' : 'I');
  const i = Math.floor(r() * s.length);
  const c = s[i] as string;
  if (!/\d/.test(c)) return s;
  const d = (Number(c) + 1 + Math.floor(r() * 8)) % 10;
  return s.slice(0, i) + String(d) + s.slice(i + 1);
}

export function libroSintetico(o: OpcionesLibro = {}): LibroSintetico {
  const r = azar(o.semilla ?? 1);
  const cubierta = o.cubierta ?? 2;
  const romanos = o.romanos ?? 0;
  const romanosSinNumero = o.romanosSinNumero ?? Math.min(4, romanos);
  const cuerpo = o.cuerpo ?? 100;
  const lectura = o.lectura ?? 0.8;
  const errorOcr = o.errorOcr ?? 0;
  const notas = o.notas ?? 0;
  const posicion = o.posicion ?? 'pie';
  const capituloCada = o.capituloCada ?? 0;
  const laminasTras = new Set(o.laminasTras ?? []);
  const primerFolio = o.primerFolio ?? 1;

  // Secuencia de «hojas lógicas»: { folio visible, se imprime, es lámina }
  interface Hoja { verdad: string | null; impreso: boolean; texto: string; vacia: boolean; lamina: boolean; figuras: number }
  const hojas: Hoja[] = [];
  for (let i = 0; i < cubierta; i++) hojas.push({ verdad: null, impreso: false, texto: i === 0 ? 'TÍTULO DEL LIBRO\nAutor Apellido' : '', vacia: i > 0, lamina: false, figuras: 0 });
  for (let k = 1; k <= romanos; k++) {
    hojas.push({ verdad: enteroARomano(k, o.romanosMayusculas), impreso: k > romanosSinNumero, texto: texto(r, k <= romanosSinNumero ? 3 : 30), vacia: false, lamina: false, figuras: 0 });
  }
  if (o.foliacion) {
    for (let k = 0; k < cuerpo; k++) {
      const hoja = primerFolio + Math.floor(k / 2);
      const recto = k % 2 === 0;
      hojas.push({ verdad: `${hoja}${recto ? 'r' : 'v'}`, impreso: recto, texto: texto(r), vacia: false, lamina: false, figuras: 0 });
    }
  } else {
    for (let k = 0; k < cuerpo; k++) {
      const f = primerFolio + k;
      const inicioCapitulo = capituloCada > 0 && k % capituloCada === 0;
      hojas.push({ verdad: String(f), impreso: !inicioCapitulo, texto: (inicioCapitulo ? `CAPÍTULO ${enteroARomano(k / capituloCada + 1, true)}\n` : '') + texto(r), vacia: false, lamina: false, figuras: 0 });
      if (laminasTras.has(k)) hojas.push({ verdad: null, impreso: false, texto: 'Lámina: grabado', vacia: false, lamina: true, figuras: 1 });
    }
  }

  const paginas: PaginaFolio[] = [];
  const verdad: Array<string | null> = [];
  const laminas: number[] = [];
  const paso = o.doble ? 2 : 1;
  for (let h = 0; h < hojas.length; h += paso) {
    const a = hojas[h] as Hoja;
    const b = o.doble ? hojas[h + 1] : undefined;
    const fisica = paginas.length + 1;
    const p: PaginaFolio = { fisica, cabecera: '', pie: '', folio: null, texto: a.texto + (b ? `\n${b.texto}` : ''), vacia: a.vacia && (!b || b.vacia), confianza: 0.95, figuras: a.figuras ? [{ descripcion: 'grabado' }] : [] };
    const visible = a.impreso && a.verdad !== null && r() < lectura;
    let mostrado = a.verdad ?? '';
    if (o.foliacion) mostrado = mostrado.replace(/[rv]$/, '');
    if (visible && errorOcr > 0 && r() < errorOcr) mostrado = estropear(mostrado, r);
    if (visible) {
      if (o.doble && b?.verdad) {
        p.pie = `${mostrado}                                        ${b.verdad}`;
      } else if (posicion === 'pie') {
        p.pie = r() < 0.5 ? `— ${mostrado} —` : mostrado;
      } else if (posicion === 'cabecera') {
        p.cabecera = (fisica % 2 === 0) ? `${mostrado}   HISTORIA DE LAS IDEAS` : `El capítulo de turno   ${mostrado}`;
      } else if (posicion === 'lector') {
        p.folio = mostrado;
      } else {
        p.texto = `${p.texto}\n${mostrado}`;
      }
    }
    if (notas > 0 && a.verdad !== null && r() < notas) {
      // Llamadas sueltas y referencias que no son el folio.
      const n = 1 + Math.floor(r() * 9);
      p.texto = `${p.texto}\n${n}\n¹ Véase la p. ${Math.floor(r() * 400)}.`;
      if (r() < 0.3) p.cabecera = `${p.cabecera ?? ''} ${1500 + Math.floor(r() * 400)}`.trim();
    }
    paginas.push(p);
    verdad.push(a.verdad);
    if (a.lamina) laminas.push(paginas.length - 1);
  }
  return { paginas, verdad, laminas };
}

/** Proporción de páginas con folio verdadero que reciben exactamente ese folio. */
export function acierto(impresas: Array<string | null>, verdad: Array<string | null>): { acierto: number; errores: Array<[number, string | null, string | null]> } {
  let total = 0, bien = 0;
  const errores: Array<[number, string | null, string | null]> = [];
  verdad.forEach((v, i) => {
    if (v === null) {
      if (impresas[i] !== null) errores.push([i + 1, v, impresas[i] ?? null]);
      return;
    }
    total++;
    if (impresas[i] === v) bien++;
    else errores.push([i + 1, v, impresas[i] ?? null]);
  });
  return { acierto: total ? bien / total : 1, errores };
}
