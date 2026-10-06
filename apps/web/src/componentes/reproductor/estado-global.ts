/**
 * Lo único del reproductor que necesita el marco de la aplicación: si hay que
 * enseñar el reproductor pequeño. Pesa unas líneas, así el marco no carga el
 * motor hasta que alguien abre un audio o un vídeo.
 */
import { useSyncExternalStore } from 'react';

let mini = false;
const oyentes = new Set<() => void>();

export function ponerMini(v: boolean) {
  if (v === mini) return;
  mini = v;
  for (const o of oyentes) o();
}

export function useHayMini(): boolean {
  return useSyncExternalStore((o) => { oyentes.add(o); return () => oyentes.delete(o); }, () => mini, () => false);
}
