/** Utilidades internas de las funciones: errores, JSON, fechas, SQL. */

import type { SQL, ValorSQL } from '@scholaris/nucleo';

/** Error de dominio con código y estado HTTP; el mensaje va en español correcto. */
export class ErrorFunciones extends Error {
  constructor(
    public readonly codigo: string,
    mensaje: string,
    public readonly estado = 400,
  ) {
    super(mensaje);
    this.name = 'ErrorFunciones';
  }
}

export const noEncontrado = (que: string) => new ErrorFunciones('no_encontrado', `No existe ${que}.`, 404);

export function ahora(): string {
  return new Date().toISOString();
}

export function haceDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

export function aJSON(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

export function deJSON<T>(s: unknown, porDefecto: T): T {
  if (typeof s !== 'string' || !s) return porDefecto;
  try {
    return JSON.parse(s) as T;
  } catch {
    return porDefecto;
  }
}

export function num(v: unknown, porDefecto = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return porDefecto;
}

export function numONulo(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

export function texto(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

export function bool(v: unknown): boolean {
  return v === 1 || v === true || v === '1' || v === 1n;
}

/** Una fila como mucho. */
export async function una<T = Record<string, ValorSQL>>(sql: SQL, consulta: string, ...p: ValorSQL[]): Promise<T | null> {
  const filas = await sql.ejecutar<T>(consulta, ...p);
  return filas[0] ?? null;
}

/** Convierte un blob de SQL (Uint8Array, ArrayBuffer o Buffer) en bytes. */
export function aBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

/**
 * Escapa una consulta de usuario para FTS5: cada palabra entre comillas, con
 * prefijo en la última, para que nunca falle por sintaxis.
 */
export function consultaFTS(q: string, prefijo = true): string {
  const palabras = q.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!palabras.length) return '';
  return palabras
    .slice(0, 32)
    .map((p, i) => `"${p.replace(/"/g, '""')}"${prefijo && i === palabras.length - 1 ? '*' : ''}`)
    .join(' ');
}

/** Igual que `consultaFTS` pero une los términos con OR (para recuperación amplia). */
export function consultaFTSAmplia(q: string): string {
  const palabras = [...new Set((q.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).filter((p) => p.length > 1))];
  return palabras.slice(0, 32).map((p) => `"${p.replace(/"/g, '""')}"`).join(' OR ');
}

/** Recorta a `n` caracteres sin partir palabras, con puntos suspensivos. */
export function recortar(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const corte = t.slice(0, n);
  const ultimo = corte.lastIndexOf(' ');
  return (ultimo > n * 0.6 ? corte.slice(0, ultimo) : corte).replace(/[\s,;:.]+$/, '') + '…';
}

export function limitar(v: unknown, min: number, max: number, porDefecto: number): number {
  const n = num(v, porDefecto);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function aleatorio(semilla = 42): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marcas de placeholders `?` para una lista IN (…). */
export function marcas(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Normaliza un título o una cadena para compararla: minúsculas, sin diacríticos ni puntuación. */
export function normalizarClave(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cede el hilo de vez en cuando en bucles largos (para no bloquear el Durable Object). */
export const ceder = () => new Promise<void>((r) => setTimeout(r, 0));
