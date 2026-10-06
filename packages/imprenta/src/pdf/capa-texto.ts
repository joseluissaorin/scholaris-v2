/**
 * La capa de texto de una página: diagnóstico (¿sirve o hay que leerla con
 * visión?), líneas, bloques, zonas de cabecera y pie, candidatos a folio.
 * Funciones puras: corren igual en un trabajador que en el hilo principal.
 */

import { deRomano } from '@scholaris/nucleo';
import type { BloqueCapa, CandidatoFolio, DiagnosticoTexto, LineaTexto } from '../tipos.js';
import type { ItemCrudo } from './pagina-cruda.js';

/** Zona de cabecera y de pie: 8 % superior e inferior. */
export const ZONA = 0.08;

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

const BASURA = /[\p{Cc}\p{Co}\p{Cn}\p{Cs}�]/u;
const LETRA = /\p{L}/u;
/** Signos que el OCR siembra cuando no entiende la letra: «ma~ fuerza», «Rold\\n». */
const SIMBOLOS_OCR = /[~\\{}|^¦¬■□▪►]/u;
const VOCAL = /[aeiouyáéíóúàèìòùâêîôûäëïöüæœåøаеиоуыэюяёαεηιουω]/iu;

function esPalabraRara(token: string): boolean {
  const t = token.replace(/^[«»"'“”‘’()[\]¿?¡!.,;:—–-]+|[«»"'“”‘’()[\]¿?¡!.,;:—–-]+$/gu, '');
  if (!t) return false;
  if (/^\d+([.,:/-]\d+)*%?$/.test(t)) return false; // números, fechas
  if (/^[ivxlcdm]+$/i.test(t)) return false; // romanos
  if (!LETRA.test(t)) return t.length > 2; // ristras de símbolos
  // Letras y dígitos mezclados dentro de una palabra: «AJtI1EN».
  if (/\p{L}\d|\d\p{L}/u.test(t) && !/^\d+(st|nd|rd|th|º|ª|o|a|er|e)$/i.test(t)) return true;
  // Puntuación incrustada que no es guion ni apóstrofo.
  if (/\p{L}[^\p{L}\p{M}'’\-·.]+\p{L}/u.test(t)) return true;
  // Mayúsculas y minúsculas alternadas: «tHe», «AJtI».
  if (/\p{Ll}\p{Lu}\p{Ll}|\p{Lu}\p{Ll}\p{Lu}\p{Ll}?/u.test(t) && !/^(Mc|Mac|De|Di|La|Le|O’|O')/.test(t)) return true;
  // Palabras largas sin vocales (vale para lenguas con alfabeto latino, griego y cirílico).
  if (t.length >= 5 && /^[\p{Script=Latin}]+$/u.test(t) && !VOCAL.test(t)) return true;
  return false;
}

/** ¿Sirve la capa de texto? Heurística barata y sin modelo. */
export function diagnosticar(items: ItemCrudo[], cobertura: number): DiagnosticoTexto {
  let caracteres = 0, basura = 0, simbolos = 0;
  const partes: string[] = [];
  for (const it of items) {
    partes.push(it.s);
    for (const c of it.s) {
      if (c === ' ' || c === '\n' || c === '\t') continue;
      caracteres++;
      if (BASURA.test(c)) basura++;
      else if (SIMBOLOS_OCR.test(c)) simbolos++;
    }
  }
  const tokens = partes.join(' ').split(/\s+/).filter(Boolean);
  let raras = 0, sueltas = 0;
  for (const t of tokens) {
    if (esPalabraRara(t)) raras++;
    if (t.length === 1 && LETRA.test(t) && !/^[aeoyuiAEOYUIáàéóòú]$/u.test(t)) sueltas++;
  }
  const n = Math.max(1, tokens.length);
  const fBasura = caracteres ? basura / caracteres : 0;
  const fRaras = raras / n;
  const fSueltas = sueltas / n;
  const origen: DiagnosticoTexto['origen'] = caracteres === 0 ? 'ninguno' : cobertura >= 0.85 ? 'ocr' : 'digital';
  // Penaliza basura con fuerza, palabras raras y letras sueltas (OCR deshecho) con menos.
  const fSimbolos = caracteres ? simbolos / caracteres : 0;
  let calidad = 1 - 4 * fBasura - 2.2 * fRaras - 0.8 * Math.max(0, fSueltas - 0.05) - 10 * fSimbolos;
  if (caracteres < 40) calidad -= 0.3 * (1 - caracteres / 40);
  calidad = Math.max(0, Math.min(1, calidad));
  // Una capa OCR tiene que ser muy buena para fiarse de ella (y una página
  // escaneada con poquísimo texto es una lámina o una portada: mejor visión).
  const umbral = origen === 'ocr' ? 0.9 : 0.6;
  const util = caracteres >= (origen === 'ocr' ? 200 : 25) && calidad >= umbral;
  return {
    util,
    calidad: Math.round(calidad * 1000) / 1000,
    origen,
    caracteres,
    basura: Math.round(fBasura * 1000) / 1000,
    palabrasRaras: Math.round(fRaras * 1000) / 1000,
    coberturaImagen: Math.round(cobertura * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Líneas y bloques
// ---------------------------------------------------------------------------

interface Segmento {
  items: ItemCrudo[];
  x0: number; x1: number; y0: number; y1: number;
  base: number;
  tam: number;
  orden: number;
}

function mediana(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}

function unirItems(items: ItemCrudo[], anchoPagina: number): string {
  let s = '';
  let prev: ItemCrudo | null = null;
  for (const it of items) {
    if (prev) {
      const hueco = (it.x - (prev.x + prev.w)) * anchoPagina;
      const necesitaEspacio = hueco > 0.18 * Math.min(it.tam, prev.tam);
      if (necesitaEspacio && !/\s$/.test(s) && !/^\s/.test(it.s)) s += ' ';
    }
    s += it.s;
    prev = it;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Agrupa los trozos en líneas (por línea base) y parte cada línea en
 * segmentos cuando hay un hueco grande (columnas).
 */
function segmentar(items: ItemCrudo[], anchoPagina: number, altoPagina: number): Segmento[] {
  const utiles = items.filter((i) => !i.rot && i.s.trim() !== '' && i.w >= 0 && i.h > 0);
  // Ordena por línea base y luego por x.
  const conBase = utiles.map((it, orden) => ({ it, base: it.y + it.h * 0.8, orden }));
  conBase.sort((a, b) => a.base - b.base || a.it.x - b.it.x);
  const filas: Array<typeof conBase> = [];
  for (const e of conBase) {
    const fila = filas[filas.length - 1];
    const ref = fila?.[0];
    if (fila && ref && Math.abs(e.base - ref.base) * altoPagina < 0.45 * Math.max(e.it.tam, ref.it.tam)) fila.push(e);
    else filas.push([e]);
  }
  const segmentos: Segmento[] = [];
  for (const fila of filas) {
    fila.sort((a, b) => a.it.x - b.it.x);
    let actual: typeof fila = [];
    const cerrar = () => {
      if (!actual.length) return;
      const its = actual.map((e) => e.it);
      segmentos.push({
        items: its,
        x0: Math.min(...its.map((i) => i.x)),
        x1: Math.max(...its.map((i) => i.x + i.w)),
        y0: Math.min(...its.map((i) => i.y)),
        y1: Math.max(...its.map((i) => i.y + i.h)),
        base: mediana(actual.map((e) => e.base)),
        tam: mediana(its.map((i) => i.tam)),
        orden: Math.min(...actual.map((e) => e.orden)),
      });
      actual = [];
    };
    for (const e of fila) {
      const ultimo = actual[actual.length - 1];
      if (ultimo) {
        const hueco = (e.it.x - (ultimo.it.x + ultimo.it.w)) * anchoPagina;
        if (hueco > 1.6 * Math.max(e.it.tam, ultimo.it.tam)) cerrar();
      }
      actual.push(e);
    }
    cerrar();
  }
  return segmentos;
}

function aLinea(s: Segmento, anchoPagina: number, bloque: number): LineaTexto {
  return {
    texto: unirItems(s.items, anchoPagina),
    x: redondear(s.x0), y: redondear(s.y0), w: redondear(s.x1 - s.x0), h: redondear(s.y1 - s.y0),
    tam: Math.round(s.tam * 10) / 10,
    bloque,
  };
}

function redondear(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Une las líneas de un bloque resolviendo los guiones de fin de línea. */
export function unirLineas(lineas: string[]): string {
  let s = '';
  for (const l of lineas) {
    if (!s) { s = l; continue; }
    if (/\p{L}-$/u.test(s) && /^\p{Ll}/u.test(l)) s = s.slice(0, -1) + l;
    else s += ' ' + l;
  }
  return s;
}

const RE_FOLIO = /^(?:[-–—]\s*)?(\d{1,4}|[ivxlcdm]{1,8})(?:\s*[-–—])?$/i;

function candidatosDeLinea(l: LineaTexto, zona: 'cabecera' | 'pie', items: ItemCrudo[], anchoPagina: number): CandidatoFolio[] {
  const salida: CandidatoFolio[] = [];
  // Trabaja por item para saber la posición; si un item lleva varios tokens, los reparte por proporción.
  const deLinea = items.filter((i) => i.x >= l.x - 0.002 && i.x + i.w <= l.x + l.w + 0.002 && i.y >= l.y - 0.01 && i.y + i.h <= l.y + l.h + 0.01);
  for (const it of deLinea) {
    const total = it.s.length || 1;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(it.s))) {
      const token = m[0].replace(/^[([{]+|[)\]}.,;:]+$/g, '');
      const f = RE_FOLIO.exec(token);
      if (!f) continue;
      const nucleo = f[1] as string;
      const arabigo = /^\d+$/.test(nucleo);
      const valor = arabigo ? Number(nucleo) : deRomano(nucleo);
      if (!arabigo && valor === null) continue;
      const x = it.x + (it.w * m.index) / total;
      const w = (it.w * m[0].length) / total;
      const centro = x + w / 2;
      salida.push({
        texto: nucleo,
        zona,
        lado: centro < 0.38 ? 'izquierda' : centro > 0.62 ? 'derecha' : 'centro',
        romano: !arabigo,
        valor,
        region: { x: redondear(x), y: redondear(it.y), w: redondear(w), h: redondear(it.h) },
      });
    }
  }
  void anchoPagina;
  return salida;
}

interface Caja { x0: number; x1: number; y0: number; y1: number }

/** Huecos de la proyección de las cajas sobre un eje: [inicio, fin] de cada hueco. */
function huecos<T extends Caja>(cajas: T[], eje: 'x' | 'y'): Array<{ a: number; b: number }> {
  const iv = cajas.map((c) => (eje === 'x' ? [c.x0, c.x1] : [c.y0, c.y1]) as [number, number]).sort((p, q) => p[0] - q[0]);
  const salida: Array<{ a: number; b: number }> = [];
  let fin = iv[0]?.[1] ?? 0;
  for (const [i0, i1] of iv.slice(1)) {
    if (i0 > fin) salida.push({ a: fin, b: i0 });
    fin = Math.max(fin, i1);
  }
  return salida;
}

export function cortarXY<T extends Caja>(cajas: T[]): T[] {
  if (cajas.length <= 1) return cajas;
  const hy = huecos(cajas, 'y').sort((p, q) => (q.b - q.a) - (p.b - p.a))[0];
  const hx = huecos(cajas, 'x').sort((p, q) => (q.b - q.a) - (p.b - p.a))[0];
  const gy = hy ? hy.b - hy.a : 0;
  const gx = hx ? hx.b - hx.a : 0;
  if (hx && gx >= 0.015 && gy < 0.02) {
    const corte = (hx.a + hx.b) / 2;
    return [...cortarXY(cajas.filter((c) => c.x1 <= corte)), ...cortarXY(cajas.filter((c) => c.x1 > corte))];
  }
  if (hy && gy > 0) {
    const corte = (hy.a + hy.b) / 2;
    return [...cortarXY(cajas.filter((c) => c.y1 <= corte)), ...cortarXY(cajas.filter((c) => c.y1 > corte))];
  }
  if (hx && gx > 0) {
    const corte = (hx.a + hx.b) / 2;
    return [...cortarXY(cajas.filter((c) => c.x1 <= corte)), ...cortarXY(cajas.filter((c) => c.x1 > corte))];
  }
  return [...cajas].sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
}

export interface CapaPagina {
  lineas: LineaTexto[];
  bloques: BloqueCapa[];
  cabecera: LineaTexto[];
  pie: LineaTexto[];
  candidatosFolio: CandidatoFolio[];
  cuerpo: string;
}

/** Construye líneas, bloques, zonas y candidatos a folio a partir de los trozos crudos. */
export function construirCapa(items: ItemCrudo[], anchoPagina: number, altoPagina: number): CapaPagina {
  const segs = segmentar(items, anchoPagina, altoPagina);
  let cab: Segmento[] = [], pie: Segmento[] = [];
  const cuerpo: Segmento[] = [];
  for (const s of segs) {
    if (s.y1 <= ZONA + 0.005) cab.push(s);
    else if (s.y0 >= 1 - ZONA - 0.005) pie.push(s);
    else cuerpo.push(s);
  }
  // Una línea en la zona que sigue al cuerpo sin hueco (mismo cuerpo de letra,
  // misma columna) es texto que se metió en el margen, no cabecera ni pie.
  const pegada = (s: Segmento, otros: Segmento[], abajo: boolean) => otros.some((o) => {
    const alto = (s.y1 - s.y0) * altoPagina;
    const hueco = (abajo ? s.y0 - o.y1 : o.y0 - s.y1) * altoPagina;
    const solape = Math.min(o.x1, s.x1) - Math.max(o.x0, s.x0);
    return hueco > -0.3 * alto && hueco < 0.8 * alto && solape > 0.3 * Math.min(o.x1 - o.x0, s.x1 - s.x0) && Math.abs(o.tam - s.tam) < 0.15 * o.tam && (s.x1 - s.x0) > 0.25;
  });
  for (const s of [...pie].sort((a, b) => a.y0 - b.y0)) if (pegada(s, cuerpo, true)) cuerpo.push(s);
  for (const s of [...cab].sort((a, b) => b.y0 - a.y0)) if (pegada(s, cuerpo, false)) cuerpo.push(s);
  pie = pie.filter((s) => !cuerpo.includes(s));
  cab = cab.filter((s) => !cuerpo.includes(s));

  // Bloques: un segmento se une al bloque abierto si solapa en horizontal, está
  // cerca en vertical y tiene un cuerpo de letra parecido.
  interface BloqueTmp { segs: Segmento[]; x0: number; x1: number; y0: number; y1: number; tam: number }
  const bloques: BloqueTmp[] = [];
  const porY = [...cuerpo].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const s of porY) {
    const altoLinea = (s.y1 - s.y0) * altoPagina;
    let elegido: BloqueTmp | null = null;
    for (let i = bloques.length - 1; i >= 0; i--) {
      const b = bloques[i] as BloqueTmp;
      const solape = Math.min(b.x1, s.x1) - Math.max(b.x0, s.x0);
      const minAncho = Math.min(b.x1 - b.x0, s.x1 - s.x0);
      const hueco = (s.y0 - b.y1) * altoPagina;
      const proporcion = Math.max(b.tam, s.tam) / Math.max(0.1, Math.min(b.tam, s.tam));
      if (solape > 0.5 * minAncho && hueco < 0.9 * altoLinea && hueco > -0.6 * altoLinea && proporcion < 1.25) { elegido = b; break; }
    }
    if (elegido) {
      elegido.segs.push(s);
      elegido.x0 = Math.min(elegido.x0, s.x0); elegido.x1 = Math.max(elegido.x1, s.x1);
      elegido.y1 = Math.max(elegido.y1, s.y1);
      elegido.tam = mediana(elegido.segs.map((g) => g.tam));
    } else bloques.push({ segs: [s], x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, tam: s.tam });
  }

  // Orden de lectura: corte XY recursivo. Un hueco vertical ancho (medianil)
  // parte en columnas; un hueco horizontal claro parte en franjas.
  const ordenados = cortarXY(bloques);

  const lineas: LineaTexto[] = [];
  const bloquesSalida: BloqueCapa[] = [];
  for (const b of ordenados) {
    const idx = bloquesSalida.length;
    const ls = b.segs.sort((a, c) => a.y0 - c.y0).map((s) => aLinea(s, anchoPagina, idx));
    const desde = lineas.length;
    lineas.push(...ls);
    bloquesSalida.push({
      x: redondear(b.x0), y: redondear(b.y0), w: redondear(b.x1 - b.x0), h: redondear(b.y1 - b.y0),
      lineas: ls.map((_, i) => desde + i),
      texto: unirLineas(ls.map((l) => l.texto)),
      tam: Math.round(b.tam * 10) / 10,
    });
  }
  const lCab = cab.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((s) => aLinea(s, anchoPagina, -1));
  const lPie = pie.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((s) => aLinea(s, anchoPagina, -1));
  const candidatos = [
    ...lCab.flatMap((l) => candidatosDeLinea(l, 'cabecera', items, anchoPagina)),
    ...lPie.flatMap((l) => candidatosDeLinea(l, 'pie', items, anchoPagina)),
  ];
  return {
    lineas,
    bloques: bloquesSalida,
    cabecera: lCab,
    pie: lPie,
    candidatosFolio: candidatos,
    cuerpo: bloquesSalida.map((b) => b.texto).join('\n\n'),
  };
}

/** Texto de una línea sin números, para detectar titulillos repetidos. */
export function claveTitulillo(texto: string): string {
  return texto.toLowerCase().replace(/[\divxlcdm]+\b/gi, (m) => (/^\d+$|^[ivxlcdm]+$/i.test(m) ? '' : m)).replace(/[^\p{L}]+/gu, ' ').trim();
}

/**
 * Titulillos: textos de cabecera o pie que se repiten en al menos el 3 % de las
 * páginas (y en 3 como mínimo), sin contar los números.
 */
export function detectarTitulillos(zonas: Array<LineaTexto[]>): string[] {
  const cuenta = new Map<string, { n: number; ejemplo: string }>();
  for (const lineas of zonas) {
    const vistas = new Set<string>();
    for (const l of lineas) {
      const k = claveTitulillo(l.texto);
      if (k.length < 3 || vistas.has(k)) continue;
      vistas.add(k);
      const c = cuenta.get(k) ?? { n: 0, ejemplo: l.texto };
      c.n++;
      cuenta.set(k, c);
    }
  }
  const minimo = Math.max(3, Math.ceil(zonas.length * 0.03));
  return [...cuenta.values()].filter((c) => c.n >= minimo).sort((a, b) => b.n - a.n).map((c) => c.ejemplo);
}
