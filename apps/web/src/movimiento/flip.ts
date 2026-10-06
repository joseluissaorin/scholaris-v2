/**
 * FLIP, uno solo para toda la web: cuando una lista cambia (otro orden, otros
 * elementos), cada elemento marcado con `data-flip="<id>"` viaja con un
 * transform desde donde estaba a donde está, con el muelle de asentar; los que
 * llegan nuevos suben del papel uno tras otro y los que se quedan no se mueven.
 * Un cambio pequeño de orden da un movimiento corto, casi imperceptible. Con
 * `prefers-reduced-motion`, nada se mueve.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { curva } from './muelle';
import { quieto } from './preferencias';

export interface OpcionesFlip {
  /** Los que aparecen por primera vez suben del papel (por defecto, sí, salvo en el primer pintado). */
  entrada?: boolean;
  /** Retraso entre entradas consecutivas, en ms. */
  escalon?: number;
}

export function useFlip(contenedor: RefObject<HTMLElement | null>, firma: string, opciones: OpcionesFlip = {}) {
  const antes = useRef<Map<string, DOMRect> | null>(null);
  const { entrada = true, escalon = 32 } = opciones;
  useLayoutEffect(() => {
    const raiz = contenedor.current;
    if (!raiz) return;
    const previo = antes.current;
    const ahora = new Map<string, DOMRect>();
    const elementos = [...raiz.querySelectorAll<HTMLElement>('[data-flip]')];
    for (const el of elementos) ahora.set(el.dataset.flip!, el.getBoundingClientRect());
    antes.current = ahora;
    if (!previo || quieto()) return;
    const { curva: c, duracion } = curva('asentar');
    let nuevos = 0;
    for (const el of elementos) {
      const r = ahora.get(el.dataset.flip!)!;
      const a = previo.get(el.dataset.flip!);
      if (!a) {
        if (!entrada) continue;
        el.animate([{ opacity: 0, transform: 'translateY(12px) scale(0.985)' }, { opacity: 1, transform: 'none' }], {
          duration: duracion, easing: c, delay: Math.min(nuevos++, 12) * escalon, fill: 'backwards',
        });
        continue;
      }
      const dx = a.left - r.left, dy = a.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: Math.min(duracion, 260 + Math.hypot(dx, dy) * 0.6), easing: c,
      });
    }
  }, [contenedor, firma, entrada, escalon]);
}
