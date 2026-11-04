/**
 * Un ancla convertida en parámetros del lector y de vuelta. Así cualquier
 * resultado, cita o tarjeta abre el lector en el lugar exacto y el enlace se
 * puede copiar y compartir.
 */
import { enmascarar, textoDePasaje, type Ancla, type AnclaMaterial, type Region } from '@scholaris/nucleo';

export interface BusquedaLector {
  /** Orden de la unidad (página física, diapositiva, tramo). */
  u?: number;
  /** Segundo exacto (audio y vídeo). */
  t?: number;
  /** Sección (EPUB, documentos, web) y párrafo dentro de ella. */
  sec?: string;
  par?: number;
  /** Fragmento a resaltar. */
  f?: string;
  /** El pasaje que se subraya: [pd, ph) en el texto crudo del fragmento `f`. */
  pd?: number;
  ph?: number;
  /** Términos a resaltar. */
  q?: string;
  /** Se llegó desde una búsqueda: cuál era (para recorrer sus resultados y volver) y en qué resultado se está (desde 0). */
  rb?: ContextoBusqueda;
  ri?: number;
  /**
   * El ancla material (una prueba de Investigar), siempre de la unidad de llegada (`u`, o la
   * del segundo `t` en audio y vídeo):
   * - `cr`: «inicio-fin», los caracteres [inicio, fin) en puntos de código NFC del texto de la unidad;
   * - `rg`: «x,y,w,h», la región en fracciones 0-1 de la imagen de la unidad (página o fotograma);
   * - `it`: el segundo del fotograma al que se refiere la región (vídeo).
   */
  cr?: string;
  rg?: string;
  it?: number;
  /** En un vídeo, la vista de la derecha: la película plano a plano en lugar de la transcripción. */
  v?: 'pelicula';
}

/** Una búsqueda de pasajes, tal como la guarda la URL de Buscar. */
export interface ContextoBusqueda {
  q: string;
  grupo?: string;
  col?: string;
  doc?: string;
  desde?: number;
  hasta?: number;
  cruzada?: boolean;
  alcance?: 'seguidas' | 'todo';
}

export function validarContexto(v: unknown): ContextoBusqueda | undefined {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return undefined; } }
  if (!o || typeof o !== 'object') return undefined;
  const x = o as Record<string, unknown>;
  if (typeof x.q !== 'string' || !x.q) return undefined;
  const t = (k: string) => (typeof x[k] === 'string' && x[k] ? x[k] as string : undefined);
  const n = (k: string) => (Number.isFinite(Number(x[k])) && x[k] ? Number(x[k]) : undefined);
  const c: ContextoBusqueda = { q: x.q };
  const g = t('grupo'), col = t('col'), doc = t('doc'), d = n('desde'), h = n('hasta');
  if (g) c.grupo = g;
  if (col) c.col = col;
  if (doc) c.doc = doc;
  if (d) c.desde = d;
  if (h) c.hasta = h;
  if (x.cruzada === true || x.cruzada === 'true') c.cruzada = true;
  if (x.alcance === 'seguidas' || x.alcance === 'todo') c.alcance = x.alcance;
  return c;
}

export function anclaABusqueda(a: Ancla, extra: Pick<BusquedaLector, 'f' | 'q' | 'pd' | 'ph' | 'rb' | 'ri'> = {}): BusquedaLector {
  switch (a.tipo) {
    case 'pagina': return { u: a.fisica, ...extra };
    // Con una décima: el lector abre en la palabra exacta, no en la anterior.
    case 'tiempo': return { t: Math.floor(a.t0 * 10) / 10, ...extra };
    case 'diapositiva': return { u: a.n, ...extra };
    case 'seccion': case 'web': return { sec: a.ruta.at(-1) ?? '', par: a.parrafo, ...extra };
    case 'hoja': return { u: Math.floor((a.filaDesde - 1) / 50) + 1, ...extra };
    default: return { ...extra };
  }
}

export function validarBusquedaLector(s: Record<string, unknown>): BusquedaLector {
  const n = (v: unknown) => (v === undefined || v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);
  const t = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const cr = cadenaACaracteres(s.cr), rg = cadenaARegion(s.rg), it = n(s.it);
  const b: BusquedaLector = {
    u: n(s.u), t: n(s.t), sec: t(s.sec), par: n(s.par), f: t(s.f), pd: n(s.pd), ph: n(s.ph), q: t(s.q), rb: validarContexto(s.rb), ri: n(s.ri),
    // Lo que no se entienda se cae sin romper el enlace: el lector abre en la unidad, sin marca.
    cr: cr ? caracteresACadena(cr) : undefined, rg: rg ? regionACadena(rg) : undefined, it: it != null && it >= 0 ? it : undefined,
    v: s.v === 'pelicula' ? 'pelicula' : undefined,
  };
  // Sin claves vacías: la URL queda limpia.
  for (const k of Object.keys(b) as Array<keyof BusquedaLector>) if (b[k] === undefined) delete b[k];
  return b;
}

// ---------------------------------------------------------------------------
// El ancla material en la URL (?cr=&rg=&it=)
// ---------------------------------------------------------------------------

/** [inicio, fin) → «inicio-fin». */
export function caracteresACadena(c: readonly [number, number]): string {
  return `${c[0]}-${c[1]}`;
}

/** «inicio-fin» → [inicio, fin), o nada si no es un tramo válido (enteros, 0 ≤ inicio < fin). */
export function cadenaACaracteres(v: unknown): [number, number] | undefined {
  if (typeof v !== 'string') return undefined;
  const m = /^(\d{1,9})-(\d{1,9})$/.exec(v.trim());
  if (!m) return undefined;
  const a = Number(m[1]), b = Number(m[2]);
  return b > a ? [a, b] : undefined;
}

const fraccion = (x: number) => String(Math.round(Math.min(1, Math.max(0, x)) * 10_000) / 10_000);

/** {x, y, w, h} → «x,y,w,h», con cuatro decimales como mucho (una décima de píxel en una página de 1000). */
export function regionACadena(r: Region): string {
  return [r.x, r.y, r.w, r.h].map(fraccion).join(',');
}

/** «x,y,w,h» → región dentro de la imagen (recortada a 0-1), o nada si no tiene superficie. */
export function cadenaARegion(v: unknown): Region | undefined {
  if (typeof v !== 'string') return undefined;
  const p = v.split(',').map((x) => Number(x.trim()));
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return undefined;
  const x = Math.min(1, Math.max(0, p[0]!)), y = Math.min(1, Math.max(0, p[1]!));
  const w = Math.min(1 - x, Math.max(0, p[2]!)), h = Math.min(1 - y, Math.max(0, p[3]!));
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  return w > 0.001 && h > 0.001 ? { x: r4(x), y: r4(y), w: r4(w), h: r4(h) } : undefined;
}

/** El ancla material de llegada, tal como la trae la URL (o nada si no trae ninguna). */
export interface MaterialLector {
  caracteres?: [number, number];
  region?: Region;
  instante?: number;
}

export function materialDeBusqueda(b: Pick<BusquedaLector, 'cr' | 'rg' | 'it'>): MaterialLector | null {
  const caracteres = cadenaACaracteres(b.cr), region = cadenaARegion(b.rg);
  if (!caracteres && !region) return null;
  return { ...(caracteres ? { caracteres } : {}), ...(region ? { region } : {}), ...(region && b.it != null ? { instante: b.it } : {}) };
}

/** Lo mínimo que hace falta de una prueba para abrirla en el lector. */
export interface PruebaAbrible {
  ancla: AnclaMaterial;
  /** Orden de la unidad en la API (desde 0), por si el ancla no dice dónde abrir. */
  orden?: number;
}

/**
 * Los parámetros del lector para una prueba (una evidencia de Investigar): la
 * página o el segundo, y, si los hay, los caracteres y la región. En vídeo con
 * región se abre en el fotograma (`instante`); sin ella, al principio del tramo.
 */
export function busquedaDePrueba(p: PruebaAbrible): BusquedaLector {
  const a = p.ancla;
  const b = anclaABusqueda(a);
  if (a.tipo === 'tiempo' && a.region && a.instante != null) b.t = Math.floor(a.instante * 10) / 10;
  // La web numera desde 1 (la página física 1 es la unidad 1).
  if (b.u == null && b.t == null && b.sec == null && p.orden != null && p.orden >= 0) b.u = p.orden + 1;
  if (a.caracteres) { const c = cadenaACaracteres(caracteresACadena(a.caracteres)); if (c) b.cr = caracteresACadena(c); }
  if (a.region) {
    const r = cadenaARegion(regionACadena(a.region));
    if (r) {
      b.rg = regionACadena(r);
      if (a.instante != null) b.it = Math.round(a.instante * 100) / 100;
    }
  }
  return b;
}

/**
 * El texto que señalan unos caracteres [inicio, fin) de una unidad (puntos de
 * código NFC), sin marcado y con los blancos plegados, listo para el subrayado
 * del lector, que lo busca en el texto pintado. Vacío si el tramo no cabe.
 */
export function textoDeCaracteres(textoUnidad: string, [inicio, fin]: readonly [number, number]): string {
  const nfc = textoUnidad.normalize('NFC');
  // De puntos de código a unidades UTF-16 (lo que cuentan slice y la máscara).
  let cp = 0, desde = -1, hasta = -1, i = 0;
  for (const ch of nfc) {
    if (cp === inicio) desde = i;
    if (cp === fin) { hasta = i; break; }
    i += ch.length;
    cp++;
  }
  if (desde < 0 && cp === inicio) desde = i;
  // Un final que se pasa del texto se queda en su último carácter.
  if (hasta < 0 && desde >= 0) hasta = nfc.length;
  if (desde < 0 || hasta <= desde) return '';
  return textoDePasaje(enmascarar(nfc).texto, desde, hasta);
}
