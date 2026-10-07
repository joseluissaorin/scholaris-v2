/**
 * Un ancla convertida en parámetros del lector y de vuelta. Así cualquier
 * resultado, cita o tarjeta abre el lector en el lugar exacto y el enlace se
 * puede copiar y compartir.
 */
import type { Ancla } from '@scholaris/nucleo';

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
  const b: BusquedaLector = { u: n(s.u), t: n(s.t), sec: t(s.sec), par: n(s.par), f: t(s.f), pd: n(s.pd), ph: n(s.ph), q: t(s.q), rb: validarContexto(s.rb), ri: n(s.ri) };
  // Sin claves vacías: la URL queda limpia.
  for (const k of Object.keys(b) as Array<keyof BusquedaLector>) if (b[k] === undefined) delete b[k];
  return b;
}
