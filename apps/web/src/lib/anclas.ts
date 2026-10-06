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
  /** Términos a resaltar. */
  q?: string;
}

export function anclaABusqueda(a: Ancla, extra: Pick<BusquedaLector, 'f' | 'q'> = {}): BusquedaLector {
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
  return { u: n(s.u), t: n(s.t), sec: t(s.sec), par: n(s.par), f: t(s.f), q: t(s.q) };
}
