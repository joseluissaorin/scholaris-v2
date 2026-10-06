/**
 * La vista previa local: las páginas que la imprenta del navegador ya ha
 * impreso (imagen y capa de texto), guardadas en memoria y ligadas al
 * documento. El lector las enseña mientras el servidor todavía lee, así la
 * página 1 se puede leer en un segundo en lugar de esperar a toda la ingesta.
 */
import { useSyncExternalStore } from 'react';

export interface PaginaPrevia {
  fisica: number;
  /** Folio impreso si el PDF lo trae (/PageLabels) o la imprenta lo ve en el pie. */
  impresa: string | null;
  texto: string;
  imagenUrl?: string;
}

const previas = new Map<string, Map<number, PaginaPrevia>>();
const oyentes = new Set<() => void>();
let version = 0;
let pendiente = false;
/** Avisos agrupados por fotograma: cientos de páginas no provocan cientos de repintados. */
const emitir = () => {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => { pendiente = false; version++; oyentes.forEach((o) => o()); });
};

export function anotarPagina(documento: string, fisica: number, cambio: Partial<PaginaPrevia>) {
  let m = previas.get(documento);
  if (!m) { m = new Map(); previas.set(documento, m); }
  const previa = m.get(fisica) ?? { fisica, impresa: null, texto: '' };
  m.set(fisica, { ...previa, ...cambio });
  emitir();
}

export function paginaPrevia(documento: string, fisica: number): PaginaPrevia | undefined {
  return previas.get(documento)?.get(fisica);
}

export function cuantasPrevias(documento: string): number {
  return previas.get(documento)?.size ?? 0;
}

export function olvidarPrevia(documento: string) {
  const m = previas.get(documento);
  m?.forEach((p) => p.imagenUrl && URL.revokeObjectURL(p.imagenUrl));
  previas.delete(documento);
  emitir();
}

/** Se vuelve a pintar cuando llegan páginas nuevas. */
export function usePrevia(documento: string): number {
  useSyncExternalStore((o) => { oyentes.add(o); return () => oyentes.delete(o); }, () => version, () => 0);
  return cuantasPrevias(documento);
}
