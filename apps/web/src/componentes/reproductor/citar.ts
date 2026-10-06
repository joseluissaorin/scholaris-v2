/**
 * Seleccionar un pasaje de la transcripción lo convierte en una cita con su
 * intervalo exacto: la primera palabra da t0 y la última t1.
 */
import { useEffect, useState, type RefObject } from 'react';
import type { Ancla } from '@scholaris/nucleo';
import type { Seleccion } from '../lector/seleccion';
import { pasaje, type Transcripcion } from './transcripcion';

/** Las palabras [a, b] que toca la selección dentro del contenedor (o null). */
export function palabrasSeleccionadas(contenedor: HTMLElement, s: Selection): [number, number] | null {
  if (s.isCollapsed || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!contenedor.contains(r.commonAncestorContainer)) return null;
  let a = -1, b = -1;
  for (const n of contenedor.querySelectorAll<HTMLElement>('[data-w]')) {
    if (!r.intersectsNode(n.firstChild ?? n)) continue;
    // Una palabra tocada solo por su último carácter al empezar (o el primero al acabar) no cuenta.
    const k = Number(n.dataset.w);
    if (a < 0 || k < a) a = k;
    if (k > b) b = k;
  }
  return a >= 0 ? [a, b] : null;
}

export function useSeleccionTranscripcion(contenedor: RefObject<HTMLElement | null>, tr: Transcripcion | null) {
  const [sel, setSel] = useState<(Seleccion & { t0: number; t1: number }) | null>(null);
  useEffect(() => {
    if (!tr) return;
    let h = 0;
    const leer = () => {
      cancelAnimationFrame(h);
      h = requestAnimationFrame(() => {
        const s = document.getSelection();
        const c = contenedor.current;
        if (!s || !c) { setSel(null); return; }
        const rango = palabrasSeleccionadas(c, s);
        if (!rango) { setSel(null); return; }
        const [a, b] = rango;
        const x = pasaje(tr, a, b);
        const hablante = x.h >= 0 ? tr.hablantes[x.h] : undefined;
        const ancla: Ancla = { tipo: 'tiempo', t0: x.t0, t1: x.t1, ...(hablante ? { hablante } : {}) };
        const fin: Ancla | undefined = Math.floor(x.t1) > Math.floor(x.t0) ? { tipo: 'tiempo', t0: x.t0, t1: x.t1 } : undefined;
        const caja = s.getRangeAt(0).getBoundingClientRect();
        const orden = tr.parrafos[tr.palabras[a]!.p]!.orden;
        setSel({ texto: x.texto, ancla, ...(fin ? { fin } : {}), orden, rect: { x: caja.left, y: caja.top, w: caja.width }, t0: x.t0, t1: x.t1 });
      });
    };
    document.addEventListener('selectionchange', leer);
    window.addEventListener('scroll', leer, { passive: true });
    return () => { document.removeEventListener('selectionchange', leer); window.removeEventListener('scroll', leer); cancelAnimationFrame(h); };
  }, [contenedor, tr]);
  return [sel, () => { document.getSelection()?.removeAllRanges(); setSel(null); }] as const;
}

/** El enlace a un instante del documento (se abre en el lector, en ese segundo). */
export function enlaceAlMinuto(documento: string, t: number): string {
  return `${location.origin}/lector/${encodeURIComponent(documento)}?t=${Math.floor(t)}`;
}
