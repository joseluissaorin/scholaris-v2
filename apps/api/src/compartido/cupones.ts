/**
 * Cupones y concesiones de plan.
 *
 * Una concesión da un plan a una cuenta sin pasar por la pasarela de pago: la
 * pone el administrador a mano (origen «admin») o la deja un cupón canjeado
 * (origen «cupon»). El plan efectivo es el mejor entre el del token de Clerk y
 * el de las concesiones vigentes, así que una concesión nunca rebaja a nadie.
 *
 * Los códigos tienen la forma SCHO-XXXX-XXXX con un alfabeto sin caracteres que
 * se confundan al dictado (ni 0/O, ni 1/I/L, ni 5/S, ni 8/B) y salen de un
 * generador criptográfico sin sesgo. En la base de datos solo se guarda su
 * HMAC-SHA-256 con la clave maestra de la instancia: quien lea la tabla no
 * puede canjearlos. Por eso los códigos se ven una sola vez, al crear el lote.
 */
import type { Plan } from '@scholaris/contrato';

export const ALFABETO_CUPON = 'ACDEFGHJKMNPQRTUVWXY2346789';
export const PREFIJO_CUPON = 'SCHO';

const RANGO: Record<Plan, number> = { gratis: 0, pro: 1 };
export const rangoPlan = (p: Plan): number => RANGO[p] ?? 0;
export const mejorPlan = (a: Plan, b: Plan | null | undefined): Plan => (b && rangoPlan(b) > rangoPlan(a) ? b : a);
export const esPlan = (p: unknown): p is Plan => p === 'gratis' || p === 'pro';

/** Un carácter del alfabeto, por rechazo (sin el sesgo del módulo). */
function caracteres(n: number): string {
  const tope = 256 - (256 % ALFABETO_CUPON.length);
  let salida = '';
  while (salida.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) {
      if (b >= tope) continue;
      salida += ALFABETO_CUPON[b % ALFABETO_CUPON.length];
      if (salida.length === n) break;
    }
  }
  return salida;
}

/** SCHO-XXXX-XXXX (8 caracteres de 27: ~38 bits). */
export function nuevoCodigoCupon(): string {
  const c = caracteres(8);
  return `${PREFIJO_CUPON}-${c.slice(0, 4)}-${c.slice(4)}`;
}

/**
 * Forma canónica de lo que teclea una persona (minúsculas, espacios, guiones de
 * más o sin el prefijo). null si no puede ser un cupón.
 */
export function normalizarCodigoCupon(bruto: string): string | null {
  let limpio = String(bruto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (limpio.startsWith(PREFIJO_CUPON)) limpio = limpio.slice(PREFIJO_CUPON.length);
  if (limpio.length !== 8) return null;
  for (const ch of limpio) if (!ALFABETO_CUPON.includes(ch)) return null;
  return `${PREFIJO_CUPON}-${limpio.slice(0, 4)}-${limpio.slice(4)}`;
}

/** «SCHO-AB3D-••••»: lo que se puede enseñar de un cupón sin revelarlo. */
export const pistaCupon = (codigo: string): string => `${codigo.slice(0, 10)}••••`;

const claves = new Map<string, Promise<CryptoKey>>();
/** HMAC-SHA-256 del código canónico con la clave maestra, en hexadecimal. */
export async function huellaCupon(claveMaestra: string, codigo: string): Promise<string> {
  let k = claves.get(claveMaestra);
  if (!k) {
    k = crypto.subtle.importKey('raw', new TextEncoder().encode(`scholaris-cupones-v1:${claveMaestra}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    claves.set(claveMaestra, k);
  }
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', await k, new TextEncoder().encode(codigo)));
  return [...firma].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** CSV de un lote (con BOM para que Excel lea bien las tildes). */
export function csvCupones(filas: Array<{ codigo: string; plan: Plan; duracionDias: number | null; lote: string; nota: string | null }>): string {
  const celda = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lineas = ['codigo,plan,duracion,lote,nota'];
  for (const f of filas) lineas.push([f.codigo, f.plan, f.duracionDias ? `${f.duracionDias} días` : 'de por vida', f.lote, f.nota ?? ''].map(celda).join(','));
  return `﻿${lineas.join('\n')}\n`;
}
