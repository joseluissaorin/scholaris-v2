/** Documentos seleccionados en la Biblioteca (para copiar o descargar su bibliografía). */
import { useSyncExternalStore } from 'react';

let seleccion: ReadonlySet<string> = new Set();
const oyentes = new Set<() => void>();
const emitir = () => oyentes.forEach((o) => o());

export function alternarSeleccion(id: string) {
  const s = new Set(seleccion);
  if (s.has(id)) s.delete(id); else s.add(id);
  seleccion = s; emitir();
}
export function ponerSeleccion(ids: string[]) { seleccion = new Set(ids); emitir(); }
export function limpiarSeleccion() { if (seleccion.size) { seleccion = new Set(); emitir(); } }
export function useSeleccion(): ReadonlySet<string> {
  return useSyncExternalStore((o) => { oyentes.add(o); return () => oyentes.delete(o); }, () => seleccion, () => seleccion);
}
