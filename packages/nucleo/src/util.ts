/** Utilidades puras compartidas por todos los paquetes. */

/** Identificador corto ordenable en el tiempo (base36 + aleatorio). */
export function nuevoId(prefijo = ''): string {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of r) s += (b % 36).toString(36);
  return `${prefijo}${t}${s}`;
}

export async function sha256(datos: Uint8Array | ArrayBuffer | string): Promise<string> {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const h = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ejecuta `fn` sobre `items` con un máximo de `limite` tareas a la vez, conservando el orden. */
export async function enParalelo<T, R>(items: readonly T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(items.length);
  let siguiente = 0;
  const trabajadores = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, async () => {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      salida[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

/** Reintenta con espera exponencial y jitter. */
export async function reintentar<T>(fn: (intento: number) => Promise<T>, opciones: { intentos?: number; base?: number; esReintentable?: (e: unknown) => boolean } = {}): Promise<T> {
  const intentos = opciones.intentos ?? 5;
  const base = opciones.base ?? 500;
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn(i);
    } catch (e) {
      ultimo = e;
      if (opciones.esReintentable && !opciones.esReintentable(e)) throw e;
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, base * 2 ** i + Math.random() * base));
    }
  }
  throw ultimo;
}

const ROMANOS: Array<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

export function aRomano(n: number): string {
  let s = '';
  for (const [v, r] of ROMANOS) while (n >= v) { s += r; n -= v; }
  return s;
}

export function deRomano(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!/^[mdclxvi]+$/.test(t)) return null;
  const val: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const a = val[t[i] as string] as number;
    const b = i + 1 < t.length ? (val[t[i + 1] as string] as number) : 0;
    total += a < b ? -a : a;
  }
  return aRomano(total) === t ? total : null;
}

export function normalizarVector(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] as number) / n;
  return out;
}

/** Recorta un vector Matryoshka a `dims` y lo renormaliza. */
export function recortarVector(v: Float32Array, dims: number): Float32Array {
  return normalizarVector(v.length > dims ? v.subarray(0, dims) : v);
}

export function coseno(a: Float32Array, b: Float32Array): number {
  let p = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const x = a[i] as number, y = b[i] as number; p += x * y; na += x * x; nb += y * y; }
  return p / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export function vectorABytes(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export function bytesAVector(b: Uint8Array | ArrayBuffer): Float32Array {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
}

/** Fusión por rangos recíprocos (RRF). */
export function fusionarRangos(listas: Array<{ ids: string[]; peso?: number }>, k = 60): Map<string, number> {
  const puntos = new Map<string, number>();
  for (const { ids, peso = 1 } of listas) {
    ids.forEach((id, r) => puntos.set(id, (puntos.get(id) ?? 0) + peso / (k + r + 1)));
  }
  return puntos;
}
