/**
 * Ganchos de React sobre el motor y los datos del reproductor.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DetalleDocumento, UnidadVista } from '@scholaris/contrato';
import { api } from '../../datos/api';
import { q } from '../../datos/consultas';
import { tiempoACadena } from '../../lib/formato';
import { motor, type Instantanea } from './motor';
import { buscarIndice, construirTranscripcion, type Transcripcion } from './transcripcion';

export function useMotor(): Instantanea {
  const m = motor();
  return useSyncExternalStore(m.suscribir, m.instantanea, m.instantanea);
}

/** Escribe el tiempo en un nodo sin pasar por React (cada fotograma, si cambia el segundo). */
export function useRelojDom(ref: React.RefObject<HTMLElement | null>, formato: (t: number) => string = tiempoACadena) {
  useEffect(() => {
    let previo = '';
    return motor().escucharTiempo((t) => {
      const s = formato(t);
      if (s !== previo && ref.current) { ref.current.textContent = s; previo = s; }
    });
  }, [ref, formato]);
}

/** El segundo actual como estado de React, con la resolución pedida (para la URL, el índice…). */
export function useSegundo(cada = 1): number {
  const [s, setS] = useState(() => Math.floor(motor().tiempo() / cada) * cada);
  useEffect(() => motor().escucharTiempo((t) => setS(Math.floor(t / cada) * cada)), [cada]);
  return s;
}

const POR_PETICION = 100;

/**
 * La transcripción entera: todas las unidades en peticiones de 100, en
 * paralelo (un vídeo de dos horas son dos peticiones). Se rehace si el
 * documento cambia (más unidades leídas durante la ingesta).
 */
export function useTranscripcion(doc: DetalleDocumento) {
  const consulta = useQuery({
    queryKey: ['transcripcion', doc.id, doc.unidades, doc.actualizado],
    queryFn: async (): Promise<UnidadVista[]> => {
      const n = Math.max(1, doc.unidades);
      const tandas = Array.from({ length: Math.ceil(n / POR_PETICION) }, (_, i) => api().documentos.unidades(doc.id, i * POR_PETICION, Math.min(n, (i + 1) * POR_PETICION) - 1));
      const todas = (await Promise.all(tandas)).flat();
      return todas.map((u) => ({ ...u, orden: u.orden + 1 }));
    },
    staleTime: 5 * 60_000,
    placeholderData: (previa) => previa,
  });
  const transcripcion = useMemo<Transcripcion | null>(() => (consulta.data ? construirTranscripcion(consulta.data) : null), [consulta.data]);
  return { transcripcion, unidades: consulta.data, cargando: consulta.isPending, error: consulta.isError };
}

export interface Fotogramas { t: Float64Array; url: string[]; descripcion: (string | undefined)[] }

/** Los fotogramas clave de la ingesta (las «figuras» de un vídeo), para la vista previa al recorrer la línea. */
export function useFotogramas(doc: DetalleDocumento): Fotogramas | null {
  const { data } = useQuery({ ...q.figuras(doc.id), enabled: doc.tipo === 'video' });
  return useMemo(() => {
    const fs = (data ?? []).filter((f) => f.ancla.tipo === 'tiempo' && f.imagenUrl).sort((a, b) => (a.ancla as { t0: number }).t0 - (b.ancla as { t0: number }).t0);
    if (!fs.length) return null;
    return { t: Float64Array.from(fs, (f) => (f.ancla as { t0: number }).t0), url: fs.map((f) => f.imagenUrl), descripcion: fs.map((f) => f.descripcion) };
  }, [data]);
}

export function fotogramaEn(f: Fotogramas, t: number): number {
  return Math.max(0, buscarIndice(f.t, t));
}

/** ¿Pide la persona menos movimiento? */
export function useMenosMovimiento(): boolean {
  const [v, setV] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const f = () => setV(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return v;
}

export const menosMovimiento = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
