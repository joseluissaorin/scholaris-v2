/**
 * Las investigaciones en curso y las últimas hechas, fuera de React.
 *
 * Una investigación tarda minutos y cuesta dinero: no puede depender de que su
 * pantalla siga montada. Aquí sigue leyendo sus eventos aunque se abra el lector
 * desde una prueba, y al volver (atrás) se encuentra tal cual, terminada o aún
 * en marcha. Las terminadas se guardan también en la sesión del navegador: una
 * recarga de la página las enseña sin investigar otra vez.
 *
 * Nada se lanza solo: solo `lanzarInvestigacion`, que llama la pantalla cuando
 * la persona pulsa «Investigar».
 */
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { Filtros } from '@scholaris/nucleo';
import type { Investigar } from '@scholaris/contrato';
import { api } from './api';
import { aplicarEvento, estadoInicial, type EstadoInvestigacion } from '../lib/investigacion';

const MAXIMO = 6;
const EN_SESION = 3;
const CLAVE_SESION = 'scholaris:investigaciones';

const estados = new Map<string, EstadoInvestigacion>();
const enCurso = new Set<string>();
const oyentes = new Set<() => void>();

/** Lo que identifica una investigación: la pregunta, la profundidad y los filtros (en orden estable). */
export function claveInvestigacion(p: Pick<Investigar, 'pregunta' | 'profundidad' | 'filtros'>): string {
  const f = p.filtros ?? {};
  const filtros = Object.fromEntries(Object.entries(f as Filtros).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([p.pregunta.trim(), p.profundidad ?? 'normal', filtros]);
}

// Muchos eventos seguidos (el texto llega a trozos): se avisa a la pantalla una vez por fotograma.
let avisoPendiente = false;
function avisar() {
  if (avisoPendiente) return;
  avisoPendiente = true;
  const hecho = () => { avisoPendiente = false; for (const o of oyentes) o(); };
  if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) requestAnimationFrame(hecho);
  else setTimeout(hecho, 16);
}

function poner(clave: string, e: EstadoInvestigacion) {
  // La más reciente, al final; las viejas que ya no corren se olvidan.
  estados.delete(clave);
  estados.set(clave, e);
  for (const k of estados.keys()) {
    if (estados.size <= MAXIMO) break;
    if (!enCurso.has(k) && k !== clave) estados.delete(k);
  }
  avisar();
}

function leerSesion(): Array<[string, EstadoInvestigacion]> {
  try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION) ?? '[]') as Array<[string, EstadoInvestigacion]>; } catch { return []; }
}

function guardarEnSesion(clave: string, e: EstadoInvestigacion) {
  try {
    const lista = leerSesion().filter(([k]) => k !== clave);
    lista.push([clave, e]);
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify(lista.slice(-EN_SESION)));
  } catch { /* sin almacenamiento o lleno: la investigación sigue en memoria */ }
}

/** La investigación de esa clave: en memoria o, si se recargó la página, la guardada en la sesión. */
export function investigacionGuardada(clave: string): EstadoInvestigacion | undefined {
  const e = estados.get(clave);
  if (e) return e;
  const guardada = leerSesion().find(([k]) => k === clave)?.[1];
  if (guardada) estados.set(clave, guardada);
  return guardada;
}

export function enMarcha(clave: string): boolean {
  return enCurso.has(clave);
}

/**
 * Empieza una investigación (o devuelve la que ya corre con la misma clave). Al
 * terminar, refresca el historial y los cuadernos, que el servidor ha tocado.
 */
export function lanzarInvestigacion(p: Investigar, qc?: QueryClient): string {
  const clave = claveInvestigacion(p);
  if (enCurso.has(clave)) return clave;
  enCurso.add(clave);
  poner(clave, estadoInicial(p.pregunta));
  void (async () => {
    try {
      for await (const ev of api().busqueda.investigar(p)) {
        poner(clave, aplicarEvento(estados.get(clave) ?? estadoInicial(p.pregunta), ev));
      }
      const e = estados.get(clave);
      if (e && e.fase !== 'hecho' && e.fase !== 'error') poner(clave, aplicarEvento(e, { tipo: 'error', mensaje: 'La investigación se cortó antes de terminar.' }));
    } catch (err) {
      const e = estados.get(clave) ?? estadoInicial(p.pregunta);
      poner(clave, aplicarEvento(e, { tipo: 'error', mensaje: err instanceof Error && err.message ? err.message : 'No se pudo investigar.' }));
    } finally {
      enCurso.delete(clave);
      const e = estados.get(clave);
      if (e?.fase === 'hecho') guardarEnSesion(clave, e);
      avisar();
      if (qc) {
        void qc.invalidateQueries({ queryKey: ['historial'] });
        void qc.invalidateQueries({ queryKey: ['cuadernos'] });
      }
    }
  })();
  return clave;
}

/** Olvida una investigación terminada (para volver a lanzarla con la misma clave). */
export function olvidarInvestigacion(clave: string) {
  if (enCurso.has(clave)) return;
  estados.delete(clave);
  try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(leerSesion().filter(([k]) => k !== clave))); } catch { /* nada */ }
  avisar();
}

function suscribir(o: () => void) {
  oyentes.add(o);
  return () => { oyentes.delete(o); };
}

/** El estado de una investigación, vivo: la pantalla se repinta con cada evento (una vez por fotograma). */
export function useInvestigacion(clave: string | null): EstadoInvestigacion | undefined {
  return useSyncExternalStore(suscribir, () => (clave ? investigacionGuardada(clave) : undefined), () => undefined);
}
