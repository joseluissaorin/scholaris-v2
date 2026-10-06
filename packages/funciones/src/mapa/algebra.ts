/**
 * Álgebra para el mapa de conceptos, sin dependencias y sobre Float32Array
 * planos (fila × columna), para que quepa en la memoria de un Durable Object:
 * reducción de dimensiones (recorte Matryoshka o proyección aleatoria), PCA por
 * iteración de subespacio, k-medias++ y muestreo estratificado.
 */

import { aleatorio } from '../util.js';

/** Cómo se reducen los vectores originales antes de agrupar (se guarda para reducir igual las consultas). */
export interface Reduccion {
  modo: 'recorte' | 'proyeccion';
  origen: number;
  dims: number;
  semilla: number;
}

/** Matriz de proyección gaussiana determinista (origen × dims), escalada por 1/√dims. */
function matrizProyeccion(r: Reduccion): Float32Array {
  const azar = aleatorio(r.semilla);
  const m = new Float32Array(r.origen * r.dims);
  const escala = 1 / Math.sqrt(r.dims);
  for (let i = 0; i < m.length; i += 2) {
    // Box-Muller: dos normales por iteración.
    const u = Math.max(azar(), 1e-12), v = azar();
    const rad = Math.sqrt(-2 * Math.log(u));
    m[i] = rad * Math.cos(2 * Math.PI * v) * escala;
    if (i + 1 < m.length) m[i + 1] = rad * Math.sin(2 * Math.PI * v) * escala;
  }
  return m;
}

const cacheProyecciones = new Map<string, Float32Array>();

/** Reduce un vector a `r.dims` y lo normaliza (L2). Escribe en `salida` si se da. */
export function reducir(v: Float32Array, r: Reduccion, salida = new Float32Array(r.dims)): Float32Array {
  if (r.modo === 'recorte' || r.origen <= r.dims) {
    const n = Math.min(r.dims, v.length);
    for (let i = 0; i < n; i++) salida[i] = v[i]!;
    for (let i = n; i < r.dims; i++) salida[i] = 0;
  } else {
    const clave = `${r.origen}:${r.dims}:${r.semilla}`;
    let m = cacheProyecciones.get(clave);
    if (!m) { m = matrizProyeccion(r); cacheProyecciones.set(clave, m); }
    salida.fill(0);
    const n = Math.min(v.length, r.origen);
    for (let i = 0; i < n; i++) {
      const x = v[i]!;
      if (x === 0) continue;
      const base = i * r.dims;
      for (let j = 0; j < r.dims; j++) salida[j]! += x * m[base + j]!;
    }
  }
  let s = 0;
  for (let i = 0; i < r.dims; i++) s += salida[i]! * salida[i]!;
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < r.dims; i++) salida[i]! /= s;
  return salida;
}

/** Elige la reducción: recorte si el modelo es Matryoshka (Gemini, Jina, Voyage), proyección si no. */
export function elegirReduccion(espacio: { id: string; modelo?: string; dims: number }, dims = 256): Reduccion {
  const nombre = `${espacio.id} ${espacio.modelo ?? ''}`.toLowerCase();
  const matryoshka = /gemini|matryoshka|jina|voyage|nomic|qwen3-embedding|text-embedding-3/.test(nombre);
  const d = Math.min(dims, espacio.dims);
  return { modo: matryoshka || espacio.dims <= d ? 'recorte' : 'proyeccion', origen: espacio.dims, dims: d, semilla: 1729 };
}

// ---------------------------------------------------------------------------
// PCA
// ---------------------------------------------------------------------------

export interface ModeloPCA {
  media: Float32Array;
  /** Componentes (m × d), filas ortonormales, en orden de varianza decreciente. */
  componentes: Float32Array;
  m: number;
  d: number;
  varianzas: Float64Array;
}

/** Ortonormaliza las columnas de Q (d × m) con Gram-Schmidt modificado. */
function ortonormalizar(Q: Float64Array, d: number, m: number, azar: () => number) {
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < j; k++) {
      let p = 0;
      for (let i = 0; i < d; i++) p += Q[i * m + j]! * Q[i * m + k]!;
      for (let i = 0; i < d; i++) Q[i * m + j]! -= p * Q[i * m + k]!;
    }
    let n = 0;
    for (let i = 0; i < d; i++) n += Q[i * m + j]! ** 2;
    n = Math.sqrt(n);
    if (n < 1e-10) {
      for (let i = 0; i < d; i++) Q[i * m + j] = azar() - 0.5;
      j--;
      continue;
    }
    for (let i = 0; i < d; i++) Q[i * m + j]! /= n;
  }
}

/**
 * PCA sobre una muestra (covarianza explícita d × d + iteración de subespacio).
 * Con d = 256 y una muestra de 3000 filas tarda unas décimas.
 */
export function ajustarPCA(X: Float32Array, n: number, d: number, m: number, opciones: { muestra?: number; semilla?: number; iteraciones?: number } = {}): ModeloPCA {
  const azar = aleatorio(opciones.semilla ?? 7);
  m = Math.max(1, Math.min(m, d, n));
  const s = Math.min(n, opciones.muestra ?? 3000);
  const paso = n / s;
  const filas: number[] = [];
  for (let i = 0; i < s; i++) filas.push(Math.floor(i * paso));
  const media = new Float32Array(d);
  for (const f of filas) for (let j = 0; j < d; j++) media[j]! += X[f * d + j]!;
  for (let j = 0; j < d; j++) media[j]! /= s;
  // Covarianza (triángulo superior y espejo).
  const C = new Float64Array(d * d);
  const fila = new Float64Array(d);
  for (const f of filas) {
    for (let j = 0; j < d; j++) fila[j] = X[f * d + j]! - media[j]!;
    for (let a = 0; a < d; a++) {
      const xa = fila[a]!;
      if (xa === 0) continue;
      const base = a * d;
      for (let b = a; b < d; b++) C[base + b]! += xa * fila[b]!;
    }
  }
  for (let a = 0; a < d; a++) for (let b = a; b < d; b++) { const v = C[a * d + b]! / Math.max(1, s - 1); C[a * d + b] = v; C[b * d + a] = v; }
  // Iteración de subespacio.
  let Q = new Float64Array(d * m);
  for (let i = 0; i < Q.length; i++) Q[i] = azar() - 0.5;
  ortonormalizar(Q, d, m, azar);
  const Z = new Float64Array(d * m);
  for (let it = 0; it < (opciones.iteraciones ?? 10); it++) {
    Z.fill(0);
    for (let a = 0; a < d; a++) {
      const base = a * d;
      for (let b = 0; b < d; b++) {
        const c = C[base + b]!;
        if (c === 0) continue;
        const qb = b * m;
        const za = a * m;
        for (let j = 0; j < m; j++) Z[za + j]! += c * Q[qb + j]!;
      }
    }
    Q.set(Z);
    ortonormalizar(Q, d, m, azar);
  }
  // Rayleigh para ordenar por varianza.
  const varianzas = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    let r = 0;
    for (let a = 0; a < d; a++) {
      let cq = 0;
      for (let b = 0; b < d; b++) cq += C[a * d + b]! * Q[b * m + j]!;
      r += Q[a * m + j]! * cq;
    }
    varianzas[j] = r;
  }
  const orden = [...Array(m).keys()].sort((x, y) => varianzas[y]! - varianzas[x]!);
  const componentes = new Float32Array(m * d);
  const vOrd = new Float64Array(m);
  orden.forEach((j, k) => {
    vOrd[k] = varianzas[j]!;
    for (let a = 0; a < d; a++) componentes[k * d + a] = Q[a * m + j]!;
  });
  return { media, componentes, m, d, varianzas: vOrd };
}

/** Proyecta todas las filas sobre las componentes: n × m. */
export function proyectarPCA(X: Float32Array, n: number, modelo: ModeloPCA): Float32Array {
  const { d, m, media, componentes } = modelo;
  const Y = new Float32Array(n * m);
  const fila = new Float32Array(d);
  for (let i = 0; i < n; i++) {
    const base = i * d;
    for (let j = 0; j < d; j++) fila[j] = X[base + j]! - media[j]!;
    for (let k = 0; k < m; k++) {
      const c = k * d;
      let s = 0;
      for (let j = 0; j < d; j++) s += fila[j]! * componentes[c + j]!;
      Y[i * m + k] = s;
    }
  }
  return Y;
}

// ---------------------------------------------------------------------------
// k-medias
// ---------------------------------------------------------------------------

export function dist2(A: Float32Array, i: number, B: Float32Array, j: number, d: number): number {
  let s = 0;
  const a = i * d, b = j * d;
  for (let k = 0; k < d; k++) { const t = A[a + k]! - B[b + k]!; s += t * t; }
  return s;
}

/** Número de grupos según el tamaño (la heurística del Scholaris anterior). */
export function elegirK(n: number): number {
  if (n < 50) return Math.max(2, Math.floor(n / 5));
  return Math.max(4, Math.min(48, Math.floor(Math.sqrt(n / 50))));
}

export interface ResultadoKMedias {
  etiquetas: Int32Array;
  centroides: Float32Array;
  k: number;
  inercia: number;
  iteraciones: number;
}

/** k-medias++ (inicio sobre una muestra) + Lloyd. */
export function kMedias(Y: Float32Array, n: number, d: number, k: number, opciones: { semilla?: number; maxIter?: number } = {}): ResultadoKMedias {
  const azar = aleatorio(opciones.semilla ?? 42);
  k = Math.max(1, Math.min(k, n));
  const centroides = new Float32Array(k * d);
  // k-medias++ sobre una muestra de hasta 4000 puntos.
  const s = Math.min(n, 4000);
  const muestra = Array.from({ length: s }, (_, i) => Math.floor((i * n) / s));
  const primero = muestra[Math.floor(azar() * s)]!;
  centroides.set(Y.subarray(primero * d, primero * d + d), 0);
  const mejor = new Float64Array(s).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < s; i++) {
      const dd = dist2(Y, muestra[i]!, centroides, c - 1, d);
      if (dd < mejor[i]!) mejor[i] = dd;
      total += mejor[i]!;
    }
    let r = azar() * total;
    let elegido = muestra[s - 1]!;
    for (let i = 0; i < s; i++) { r -= mejor[i]!; if (r <= 0) { elegido = muestra[i]!; break; } }
    centroides.set(Y.subarray(elegido * d, elegido * d + d), c * d);
  }
  const etiquetas = new Int32Array(n).fill(-1);
  const sumas = new Float64Array(k * d);
  const tamanos = new Int32Array(k);
  const distancias = new Float64Array(n);
  let inercia = 0;
  let it = 0;
  const maxIter = opciones.maxIter ?? 30;
  for (; it < maxIter; it++) {
    let cambios = 0;
    inercia = 0;
    for (let i = 0; i < n; i++) {
      let mj = 0, md = Infinity;
      for (let c = 0; c < k; c++) {
        const dd = dist2(Y, i, centroides, c, d);
        if (dd < md) { md = dd; mj = c; }
      }
      distancias[i] = md;
      inercia += md;
      if (etiquetas[i] !== mj) { etiquetas[i] = mj; cambios++; }
    }
    if (cambios === 0 && it > 0) break;
    sumas.fill(0);
    tamanos.fill(0);
    for (let i = 0; i < n; i++) {
      const c = etiquetas[i]!;
      tamanos[c]!++;
      const b = i * d, cb = c * d;
      for (let j = 0; j < d; j++) sumas[cb + j]! += Y[b + j]!;
    }
    for (let c = 0; c < k; c++) {
      if (tamanos[c] === 0) {
        // Grupo vacío: se lleva el punto peor servido.
        let peor = 0;
        for (let i = 1; i < n; i++) if (distancias[i]! > distancias[peor]!) peor = i;
        centroides.set(Y.subarray(peor * d, peor * d + d), c * d);
        distancias[peor] = 0;
        continue;
      }
      for (let j = 0; j < d; j++) centroides[c * d + j] = sumas[c * d + j]! / tamanos[c]!;
    }
    if (cambios <= n * 0.0005) { it++; break; }
  }
  return { etiquetas, centroides, k, inercia, iteraciones: it };
}

/** Muestra estratificada por grupo, proporcional a su tamaño (mínimo dos por grupo). */
export function muestraEstratificada(etiquetas: Int32Array, k: number, maximo: number, semilla = 42): Int32Array {
  const n = etiquetas.length;
  if (n <= maximo) return Int32Array.from({ length: n }, (_, i) => i);
  const azar = aleatorio(semilla);
  const porGrupo: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) porGrupo[etiquetas[i]!]!.push(i);
  const salida: number[] = [];
  for (const g of porGrupo) {
    const cuota = Math.min(g.length, Math.max(2, Math.round((maximo * g.length) / n)));
    for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [g[i], g[j]] = [g[j]!, g[i]!]; }
    salida.push(...g.slice(0, cuota));
  }
  // Por el redondeo de las cuotas puede pasarse un poco del máximo: no importa.
  salida.sort((a, b) => a - b);
  return Int32Array.from(salida);
}
