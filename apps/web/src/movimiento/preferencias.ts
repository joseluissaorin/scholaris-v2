/**
 * ¿Se puede mover? Con `prefers-reduced-motion: reduce` nada se anima: todo
 * aparece ya en su sitio y en su estado final (la información nunca depende
 * del movimiento).
 */
import { useSyncExternalStore } from 'react';

const consulta = typeof window !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function quieto(): boolean {
  return consulta?.matches ?? true;
}

export function useQuieto(): boolean {
  return useSyncExternalStore(
    (o) => { consulta?.addEventListener('change', o); return () => consulta?.removeEventListener('change', o); },
    quieto,
    () => true,
  );
}

/** El índice de un hijo en una cascada (`.cascada > *` lee `--i`). */
export const escalon = (i: number) => ({ ['--i' as string]: i }) as React.CSSProperties;
