/**
 * Acciones globales que cualquier pantalla puede disparar: abrir la paleta,
 * pedir archivos, pegar un enlace. Un bus mínimo, sin estado compartido de más.
 */
import { useSyncExternalStore } from 'react';

type Accion = 'paleta' | 'archivos' | 'camara' | 'enlace' | 'spdf';
const oyentes = new Map<Accion, Set<() => void>>();

export function disparar(a: Accion) {
  oyentes.get(a)?.forEach((o) => o());
}

export function alDisparar(a: Accion, o: () => void) {
  if (!oyentes.has(a)) oyentes.set(a, new Set());
  oyentes.get(a)!.add(o);
  return () => { oyentes.get(a)!.delete(o); };
}

/** Biblioteca a la que van las subidas (la que se esté mirando). */
let bibliotecaActiva: string | undefined;
export const ponerBibliotecaActiva = (b?: string) => { bibliotecaActiva = b; };
export const obtenerBibliotecaActiva = () => bibliotecaActiva;

/** Tema: claro, oscuro o el del sistema. Se aplica antes del primer pintado (ver index.html). */
export type Tema = 'claro' | 'oscuro' | 'sistema';
const oyentesTema = new Set<() => void>();
export function temaActual(): Tema {
  try { return (localStorage.getItem('scholaris.tema') as Tema) || 'sistema'; } catch { return 'sistema'; }
}
export function ponerTema(t: Tema) {
  try { localStorage.setItem('scholaris.tema', t); } catch { /* sin almacenamiento */ }
  const oscuro = t === 'oscuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('oscuro', oscuro);
  oyentesTema.forEach((o) => o());
}
export function useTema(): Tema {
  return useSyncExternalStore((o) => { oyentesTema.add(o); return () => oyentesTema.delete(o); }, temaActual, () => 'sistema');
}
export const esOscuro = () => document.documentElement.classList.contains('oscuro');

/** Preferencias de lectura locales (no viajan al servidor). */
export function preferencia<T extends string = string>(clave: string, defecto: NoInfer<T>): T {
  try { return (localStorage.getItem(`scholaris.${clave}`) as T) || defecto; } catch { return defecto; }
}
export function ponerPreferencia(clave: string, valor: string) {
  try { localStorage.setItem(`scholaris.${clave}`, valor); } catch { /* sin almacenamiento */ }
}

/** Documentos abiertos hace poco (para la paleta). */
export function recientes(): string[] {
  try { return JSON.parse(localStorage.getItem('scholaris.recientes') ?? '[]') as string[]; } catch { return []; }
}
export function anotarReciente(id: string) {
  try { localStorage.setItem('scholaris.recientes', JSON.stringify([id, ...recientes().filter((x) => x !== id)].slice(0, 8))); } catch { /* sin almacenamiento */ }
}
