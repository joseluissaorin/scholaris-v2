/**
 * FLIP: cuando una lista cambia de orden, cada elemento (marcado con
 * `data-flip`) se anima desde su sitio anterior al nuevo con un transform. Si
 * el orden cambia poco, el movimiento es corto y casi imperceptible. Con
 * `prefers-reduced-motion`, nada se mueve.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

export function useFlip(contenedor: RefObject<HTMLElement | null>, firma: string) {
  const antes = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const raiz = contenedor.current;
    if (!raiz) return;
    const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ahora = new Map<string, number>();
    raiz.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const id = el.dataset.flip!;
      const y = el.getBoundingClientRect().top;
      ahora.set(id, y);
      const previo = antes.current.get(id);
      if (quieto || previo == null) return;
      const d = previo - y;
      if (Math.abs(d) < 1) return;
      el.animate([{ transform: `translateY(${d}px)` }, { transform: 'translateY(0)' }], {
        duration: Math.min(420, 180 + Math.abs(d) * 0.15), easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      });
    });
    antes.current = ahora;
  }, [contenedor, firma]);
}
