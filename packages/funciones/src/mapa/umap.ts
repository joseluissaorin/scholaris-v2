/**
 * UMAP ligero en TypeScript para dibujar el mapa en 2D.
 *
 * - Vecinos: búsqueda aproximada tipo IVF usando los grupos de k-medias como
 *   celdas (cada punto mira su grupo y los grupos vecinos más cercanos).
 * - Pesos difusos de UMAP (ρ, σ por búsqueda binaria) y simetrización.
 * - Optimización por descenso estocástico con muestreo negativo, partiendo de
 *   las dos primeras componentes principales (estable entre construcciones).
 */

import { aleatorio } from '../util.js';
import { dist2 } from './algebra.js';

export interface OpcionesUMAP {
  vecinos?: number;
  epocas?: number;
  distanciaMinima?: number;
  negativos?: number;
  semilla?: number;
  /** Grupos vecinos que se exploran además del propio. */
  sondas?: number;
  /** Máximo de candidatos por grupo explorado. */
  maxPorGrupo?: number;
}

/** Vecinos aproximados de cada punto: devuelve índices y distancias (n × K). */
export function vecinosAproximados(
  Y: Float32Array,
  n: number,
  d: number,
  etiquetas: Int32Array,
  centroides: Float32Array,
  k: number,
  K: number,
  o: { sondas?: number; maxPorGrupo?: number; semilla?: number } = {},
): { indices: Int32Array; distancias: Float32Array } {
  const azar = aleatorio(o.semilla ?? 3);
  const sondas = Math.min(k - 1, o.sondas ?? 2);
  const maxPorGrupo = o.maxPorGrupo ?? 1500;
  const miembros: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) miembros[etiquetas[i]!]!.push(i);
  for (const g of miembros) {
    if (g.length > maxPorGrupo) {
      for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [g[i], g[j]] = [g[j]!, g[i]!]; }
      g.length = maxPorGrupo;
    }
  }
  // Grupos más cercanos a cada grupo (por centroides).
  const cercanos: number[][] = [];
  for (let c = 0; c < k; c++) {
    const ds: Array<[number, number]> = [];
    for (let e = 0; e < k; e++) if (e !== c) ds.push([dist2(centroides, c, centroides, e, d), e]);
    ds.sort((a, b) => a[0] - b[0]);
    cercanos.push(ds.slice(0, sondas).map((x) => x[1]));
  }
  const indices = new Int32Array(n * K).fill(-1);
  const distancias = new Float32Array(n * K).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const c = etiquetas[i]!;
    const base = i * K;
    let peor = Infinity; // distancia del K-ésimo actual (Infinity mientras no esté lleno)
    let llenos = 0;
    const explorar = (lista: number[]) => {
      for (const j of lista) {
        if (j === i) continue;
        const dd = dist2(Y, i, Y, j, d);
        if (llenos < K) {
          // Inserción ordenada.
          let p = llenos++;
          while (p > 0 && distancias[base + p - 1]! > dd) { distancias[base + p] = distancias[base + p - 1]!; indices[base + p] = indices[base + p - 1]!; p--; }
          distancias[base + p] = dd; indices[base + p] = j;
          if (llenos === K) peor = distancias[base + K - 1]!;
        } else if (dd < peor) {
          let p = K - 1;
          while (p > 0 && distancias[base + p - 1]! > dd) { distancias[base + p] = distancias[base + p - 1]!; indices[base + p] = indices[base + p - 1]!; p--; }
          distancias[base + p] = dd; indices[base + p] = j;
          peor = distancias[base + K - 1]!;
        }
      }
    };
    explorar(miembros[c]!);
    for (const e of cercanos[c]!) explorar(miembros[e]!);
    for (let t = 0; t < K; t++) distancias[base + t] = Math.sqrt(distancias[base + t]!);
  }
  return { indices, distancias };
}

/** Parámetros a, b de la curva de UMAP para una distancia mínima (ajuste por mínimos cuadrados en malla). */
export function parametrosCurva(distanciaMinima: number, extension = 1): { a: number; b: number } {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < 300; i++) {
    const x = (i / 299) * extension * 3;
    xs.push(x);
    ys.push(x < distanciaMinima ? 1 : Math.exp(-(x - distanciaMinima) / extension));
  }
  let mejor = { a: 1.577, b: 0.895, e: Infinity };
  for (let a = 0.5; a <= 3; a += 0.05) {
    for (let b = 0.5; b <= 1.5; b += 0.02) {
      let e = 0;
      for (let i = 0; i < xs.length; i++) { const y = 1 / (1 + a * xs[i]! ** (2 * b)); e += (y - ys[i]!) ** 2; }
      if (e < mejor.e) mejor = { a, b, e };
    }
  }
  return { a: mejor.a, b: mejor.b };
}

/** Grafo difuso de UMAP, simetrizado: aristas (i, j, peso). */
export function grafoDifuso(indices: Int32Array, distancias: Float32Array, n: number, K: number) {
  const objetivo = Math.log2(K);
  const pesos = new Map<number, number>(); // clave i * n + j con i < j
  const filas: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) {
    const base = i * K;
    let rho = 0;
    for (let t = 0; t < K; t++) { const dd = distancias[base + t]!; if (indices[base + t]! >= 0 && dd > 0) { rho = dd; break; } }
    let lo = 0, hi = Infinity, sigma = 1;
    for (let iter = 0; iter < 64; iter++) {
      let s = 0;
      for (let t = 0; t < K; t++) {
        if (indices[base + t]! < 0) continue;
        const dd = distancias[base + t]! - rho;
        s += dd > 0 ? Math.exp(-dd / sigma) : 1;
      }
      if (Math.abs(s - objetivo) < 1e-5) break;
      if (s > objetivo) { hi = sigma; sigma = (lo + hi) / 2; }
      else { lo = sigma; sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2; }
    }
    for (let t = 0; t < K; t++) {
      const j = indices[base + t]!;
      if (j < 0) continue;
      const dd = distancias[base + t]! - rho;
      filas[i]!.set(j, dd > 0 ? Math.exp(-dd / sigma) : 1);
    }
  }
  for (let i = 0; i < n; i++) {
    for (const [j, w] of filas[i]!) {
      const a = Math.min(i, j), b = Math.max(i, j);
      const clave = a * n + b;
      if (pesos.has(clave)) continue;
      const w2 = filas[j]!.get(i) ?? 0;
      pesos.set(clave, w + w2 - w * w2);
    }
  }
  const origen = new Int32Array(pesos.size), destino = new Int32Array(pesos.size), peso = new Float32Array(pesos.size);
  let e = 0;
  for (const [clave, w] of pesos) { origen[e] = Math.floor(clave / n); destino[e] = clave % n; peso[e] = w; e++; }
  return { origen, destino, peso };
}

/** Optimiza la disposición 2D (modifica `xy`, n × 2). */
export function optimizarDisposicion(
  xy: Float32Array,
  n: number,
  grafo: { origen: Int32Array; destino: Int32Array; peso: Float32Array },
  o: OpcionesUMAP = {},
): void {
  const { a, b } = parametrosCurva(o.distanciaMinima ?? 0.1);
  const epocas = o.epocas ?? (n > 10000 ? 120 : 200);
  const negativos = o.negativos ?? 5;
  const azar = aleatorio(o.semilla ?? 11);
  const E = grafo.peso.length;
  let pmax = 0;
  for (let e = 0; e < E; e++) pmax = Math.max(pmax, grafo.peso[e]!);
  const cada = new Float32Array(E); // épocas por muestra
  const siguiente = new Float32Array(E);
  for (let e = 0; e < E; e++) {
    const w = grafo.peso[e]! / (pmax || 1);
    cada[e] = w > 0 ? 1 / w : Infinity;
    siguiente[e] = cada[e]!;
  }
  const recortar = (x: number) => (x > 4 ? 4 : x < -4 ? -4 : x);
  for (let ep = 0; ep < epocas; ep++) {
    const alfa = 1 - ep / epocas;
    for (let e = 0; e < E; e++) {
      if (siguiente[e]! > ep + 1) continue;
      siguiente[e]! += cada[e]!;
      const i = grafo.origen[e]!, j = grafo.destino[e]!;
      // Atracción (en los dos sentidos: el grafo está simetrizado).
      let dx = xy[2 * i]! - xy[2 * j]!, dy = xy[2 * i + 1]! - xy[2 * j + 1]!;
      let d2 = dx * dx + dy * dy;
      if (d2 > 0) {
        const g = (-2 * a * b * d2 ** (b - 1)) / (a * d2 ** b + 1);
        const gx = recortar(g * dx) * alfa, gy = recortar(g * dy) * alfa;
        xy[2 * i]! += gx; xy[2 * i + 1]! += gy;
        xy[2 * j]! -= gx; xy[2 * j + 1]! -= gy;
      }
      // Repulsión con muestras negativas.
      for (let r = 0; r < negativos; r++) {
        const m = Math.floor(azar() * n);
        if (m === i) continue;
        dx = xy[2 * i]! - xy[2 * m]!; dy = xy[2 * i + 1]! - xy[2 * m + 1]!;
        d2 = dx * dx + dy * dy;
        const g = d2 > 0 ? (2 * b) / ((0.001 + d2) * (a * d2 ** b + 1)) : 0;
        xy[2 * i]! += (g > 0 ? recortar(g * dx) : 4) * alfa;
        xy[2 * i + 1]! += (g > 0 ? recortar(g * dy) : 4) * alfa;
      }
    }
  }
}

/** Escala la disposición a [-1, 1] conservando la proporción. */
export function normalizarDisposicion(xy: Float32Array, n: number): void {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xy[2 * i]!, y = xy[2 * i + 1]!;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const s = Math.max(maxx - minx, maxy - miny) / 2 || 1;
  for (let i = 0; i < n; i++) { xy[2 * i] = (xy[2 * i]! - cx) / s; xy[2 * i + 1] = (xy[2 * i + 1]! - cy) / s; }
}
