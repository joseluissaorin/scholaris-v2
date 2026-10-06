/** Utilidades de las rutas de usuario. */
import type { Context } from 'hono';
import type { Ancla, MetadatosDocumento } from '@scholaris/nucleo';
import { anclaACita } from '@scholaris/nucleo';
import type { Entorno } from '../entorno.js';
import type { PuertosUsuario } from '../puertos.js';
import { fallo } from '../compartido/errores.js';

export type Ctx = Context<Entorno>;

export const puertos = (c: Ctx): PuertosUsuario => c.get('puertos');

export function entero(v: string | undefined, def: number, min = -Infinity, max = Infinity): number {
  if (v === undefined || v === '') return def;
  const x = Number.parseInt(v, 10);
  if (!Number.isFinite(x)) fallo('peticion_invalida', `«${v}» no es un número entero.`);
  return Math.min(max, Math.max(min, x));
}

export function etiquetaAncla(a: Ancla, fin?: Ancla): string {
  try { return anclaACita(a, fin); } catch { return ''; }
}

/** «(Foucault, 1975, p. 23)» a partir de metadatos y ancla. */
export function citaCorta(m: Pick<MetadatosDocumento, 'autores' | 'anio' | 'titulo'> | undefined, a: Ancla, fin?: Ancla): string {
  const autores = m?.autores ?? [];
  const quien = autores.length === 0 ? (m?.titulo ? `«${m.titulo.slice(0, 40)}»` : 's. a.')
    : autores.length === 1 ? (autores[0]!.apellidos || autores[0]!.nombre)
    : autores.length === 2 ? `${autores[0]!.apellidos || autores[0]!.nombre} y ${autores[1]!.apellidos || autores[1]!.nombre}`
    : `${autores[0]!.apellidos || autores[0]!.nombre} et al.`;
  const partes = [quien, m?.anio ? String(m.anio) : 's. f.'];
  const et = etiquetaAncla(a, fin);
  if (et && a.tipo !== 'imagen') partes.push(et);
  return `(${partes.join(', ')})`;
}

export function json<T>(v: unknown, def: T): T {
  if (typeof v !== 'string' || !v) return (v as T) ?? def;
  try { return JSON.parse(v) as T; } catch { return def; }
}

/** Comprueba un alcance si la petición viene con clave de API. */
export function exigirEscritura(c: Ctx): void {
  const u = c.get('usuario');
  if (u.via === 'clave_api' && !u.alcances?.includes('escritura')) fallo('prohibido', 'Esta clave de API es de solo lectura.');
}

/** Cursor opaco = desplazamiento en base36. */
export const cursorADesplazamiento = (cursor?: string) => (cursor ? Number.parseInt(cursor, 36) || 0 : 0);
export const desplazamientoACursor = (d: number) => d.toString(36);

export const extension = (nombre: string) => (/\.([a-z0-9]{1,8})$/i.exec(nombre)?.[1] ?? '').toLowerCase();

/** Parámetro de ruta obligatorio. */
export function prm(c: Ctx, k: string): string {
  const v = c.req.param(k);
  if (v === undefined || v === '') fallo('peticion_invalida', `Falta el parámetro «${k}».`);
  return v;
}

/**
 * Clave completa en el almacén de un binario de un documento. La ingesta
 * guarda las rutas relativas al documento («paginas/0001.jpg»); las importadas
 * y los originales ya llevan el prefijo «u/<usuario>/d/<documento>/».
 */
export function claveDe(usuario: string, documento: string, clave: string): string {
  return clave.startsWith('u/') ? clave : `u/${usuario}/d/${documento}/${clave.replace(/^\/+/, '')}`;
}
