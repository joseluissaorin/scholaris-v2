/** Utilidades pequeñas de la comprensión. */
import type { Segmento } from '@scholaris/nucleo';
import type { Material } from './material.js';

/** Huella síncrona de 64 bits (dos FNV-1a), en base 36: ids deterministas sin choques prácticos. */
export function huella(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** Posición comparable de un punto del texto: orden de unidad y carácter. */
export const posicion = (orden: number, caracter = 0) => orden * 1e7 + caracter;

/**
 * Localizador de segmentos: el más hondo que contiene una posición de texto
 * (unidad y carácter) o un instante.
 */
export function localizadorSegmentos(m: Material, segmentos: readonly Segmento[]) {
  const tramos = segmentos.map((s) => {
    const d = m.porId.get(s.unidadDesde)?.orden ?? 0, h = m.porId.get(s.unidadHasta)?.orden ?? d;
    const t = s.ancla.tipo === 'tiempo' ? [s.ancla.t0, s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1] as const : null;
    return {
      id: s.id, nivel: s.nivel, plano: s.tipo === 'plano', t,
      ini: posicion(d, s.ancla.caracteres?.[0] ?? 0), fin: posicion(h, s.anclaFin?.caracteres?.[1] ?? 9e6),
    };
  }).sort((a, b) => b.nivel - a.nivel);
  return {
    enTexto(orden: number, caracter: number): string | undefined {
      const p = posicion(orden, caracter);
      return tramos.find((x) => !x.plano && x.ini <= p && p < x.fin)?.id;
    },
    enTiempo(t: number, o: { planos?: boolean } = {}): string | undefined {
      return tramos.find((x) => x.t && (o.planos || !x.plano) && x.t[0] <= t && t < x.t[1])?.id;
    },
  };
}

/** Una promesa con tiempo máximo: si no llega, error (la promesa sigue, pero ya no bloquea a nadie). */
export function conLimite<T>(p: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, no) => { reloj = setTimeout(() => no(new Error(mensaje)), ms); })]).finally(() => { if (reloj !== undefined) clearTimeout(reloj); });
}
