/**
 * Elección de las lecturas buenas: entre todos los candidatos de todas las
 * páginas, la cadena más larga y coherente de folios.
 *
 * Es una programación dinámica sobre las páginas (como un Viterbi con saltos):
 * cada eslabón es (página, candidato) y dos eslabones consecutivos puntúan según
 * cuadren (el folio avanza lo mismo que las páginas), salten una lámina sin
 * numerar (avanza menos), falte una hoja en el escaneo (avanza algo más) o pasen
 * de romanos a arábigos (la numeración vuelve a empezar). Los candidatos que no
 * encajan (notas al pie, años, números de capítulo, errores de OCR) quedan fuera
 * de la cadena sin necesidad de reglas para cada caso.
 *
 * Con las puntuaciones hacia delante y hacia atrás se sabe además cuánto margen
 * tiene cada decisión: las páginas con poco margen son las que se preguntan al juez.
 */

import type { Candidato } from './tipos.js';

export interface OpcionesSecuencia {
  /** Avance del folio por página física: 1 (simple), 2 (doble página), 0,5 (foliación: solo el recto). */
  paso: number;
  /** Distancia máxima, en páginas, entre dos lecturas encadenadas. */
  ventana?: number;
}

export interface Eslabon {
  /** Índice 0-based de la página dentro de la lista. */
  pagina: number;
  candidato: number;
}

export interface ResultadoSecuencia {
  /** Candidato elegido por página (índice en su lista) o null. */
  elegidos: Array<number | null>;
  /** Margen de la decisión en cada página con candidatos (más alto = más seguro). */
  margenes: Array<number | null>;
  /** Puntuación total de la mejor cadena. */
  total: number;
  /** Puntuación de la mejor cadena que pasa por cada candidato (para el juez). */
  puntuaciones: number[][];
  /** Apoyo de cada elegido: cuántos vecinos en la cadena cuadran exactamente con él (0-2). */
  apoyos: Array<number>;
}

// Puntuaciones de enlace. Las de láminas y hojas que faltan son negativas a
// propósito: una lectura solo entra en la cadena si cuadra con sus vecinas; un
// número mal leído entre dos buenas (que «cuadraría» como lámina por un lado y
// como hoja que falta por el otro) suma menos que saltárselo.
const CUADRA = 1.0;
const ROMPE = -3.0;

/** Puntuación de encadenar `a` (página j) con `b` (página i > j). */
export function enlace(a: Candidato, b: Candidato, distancia: number, paso: number): number {
  if (a.romana === b.romana) {
    const esperado = a.valor + paso * distancia;
    const dif = b.valor - esperado;
    if (Math.abs(dif) < 1e-9) return CUADRA;
    if (dif < 0) {
      // Avanza menos que las páginas: láminas o páginas sin contar entre medias.
      const laminas = -dif / paso;
      if (Number.isInteger(Math.round(laminas * 1000) / 1000) && laminas <= Math.min(4, distancia - 1)) return -0.9 - 0.1 * laminas;
      return ROMPE;
    }
    // Avanza más: faltan hojas en el escaneo.
    if (dif <= 2 * Math.max(1, paso)) return -1.0;
    return ROMPE;
  }
  if (a.romana && !b.romana) {
    // Fin de los preliminares: los arábigos empiezan (en 1) en algún punto entre ambas.
    return b.valor <= 1 + paso * distancia ? 0.3 : -1.0;
  }
  // De arábigos a romanos: casi nunca.
  return ROMPE;
}

export function elegirSecuencia(candidatos: Candidato[][], opciones: OpcionesSecuencia): ResultadoSecuencia {
  const n = candidatos.length;
  const ventana = opciones.ventana ?? 150;
  const paso = opciones.paso;
  const adelante: number[][] = candidatos.map((cs) => cs.map(() => 0));
  const atras: number[][] = candidatos.map((cs) => cs.map(() => 0));
  const previo: Array<Array<Eslabon | null>> = candidatos.map((cs) => cs.map(() => null));

  for (let i = 0; i < n; i++) {
    const ci = candidatos[i] as Candidato[];
    for (let a = 0; a < ci.length; a++) {
      const ca = ci[a] as Candidato;
      let mejor = 0;
      let desde: Eslabon | null = null;
      for (let j = Math.max(0, i - ventana); j < i; j++) {
        const cj = candidatos[j] as Candidato[];
        for (let b = 0; b < cj.length; b++) {
          const v = (adelante[j] as number[])[b] as number + enlace(cj[b] as Candidato, ca, i - j, paso);
          if (v > mejor) { mejor = v; desde = { pagina: j, candidato: b }; }
        }
      }
      (adelante[i] as number[])[a] = ca.peso + mejor;
      (previo[i] as Array<Eslabon | null>)[a] = desde;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const ci = candidatos[i] as Candidato[];
    for (let a = 0; a < ci.length; a++) {
      const ca = ci[a] as Candidato;
      let mejor = 0;
      for (let k = i + 1; k <= Math.min(n - 1, i + ventana); k++) {
        const ck = candidatos[k] as Candidato[];
        for (let b = 0; b < ck.length; b++) {
          const v = enlace(ca, ck[b] as Candidato, k - i, paso) + (ck[b] as Candidato).peso + ((atras[k] as number[])[b] as number);
          if (v > mejor) mejor = v;
        }
      }
      (atras[i] as number[])[a] = mejor;
    }
  }

  // Mejor final de cadena
  let total = 0;
  let fin: Eslabon | null = null;
  const puntuaciones = candidatos.map((cs, i) => cs.map((_, a) => ((adelante[i] as number[])[a] as number) + ((atras[i] as number[])[a] as number)));
  for (let i = 0; i < n; i++) {
    const ci = candidatos[i] as Candidato[];
    for (let a = 0; a < ci.length; a++) {
      const v = (adelante[i] as number[])[a] as number;
      if (v > total) { total = v; fin = { pagina: i, candidato: a }; }
    }
  }
  const elegidos: Array<number | null> = new Array(n).fill(null);
  const cadena: Eslabon[] = [];
  for (let e = fin; e; e = (previo[e.pagina] as Array<Eslabon | null>)[e.candidato] ?? null) {
    elegidos[e.pagina] = e.candidato;
    cadena.unshift(e);
  }

  // Apoyo: vecinos de la cadena que cuadran exactamente.
  const apoyos = new Array<number>(n).fill(0);
  for (let k = 0; k < cadena.length; k++) {
    const e = cadena[k] as Eslabon;
    const c = (candidatos[e.pagina] as Candidato[])[e.candidato] as Candidato;
    const ant = cadena[k - 1], sig = cadena[k + 1];
    // Cuadrar exactamente o marcar una transición romanos → arábigos plausible cuenta como apoyo.
    if (ant && enlace((candidatos[ant.pagina] as Candidato[])[ant.candidato] as Candidato, c, e.pagina - ant.pagina, paso) > 0) apoyos[e.pagina]! += 1;
    if (sig && enlace(c, (candidatos[sig.pagina] as Candidato[])[sig.candidato] as Candidato, sig.pagina - e.pagina, paso) > 0) apoyos[e.pagina]! += 1;
  }

  // Márgenes
  const margenes: Array<number | null> = candidatos.map((cs, i) => {
    if (!cs.length) return null;
    const p = puntuaciones[i] as number[];
    const el = elegidos[i];
    if (el === null || el === undefined) {
      // Nadie elegido: margen = cuánto le falta al mejor candidato para entrar.
      return total - Math.max(...p);
    }
    const otros = p.filter((_, a) => a !== el);
    return otros.length ? (p[el] as number) - Math.max(...otros) : (p[el] as number);
  });

  return { elegidos, margenes, total, puntuaciones, apoyos };
}

/**
 * Estima el paso (simple, doble página o foliación) a partir de los pares de
 * candidatos fiables cercanos: cuánto avanza el folio por página física.
 */
export function estimarPaso(candidatos: Candidato[][]): { paso: number; votos: Record<string, number> } {
  const votos: Record<string, number> = { '1': 0, '2': 0, '0.5': 0 };
  const n = candidatos.length;
  for (let i = 0; i < n; i++) {
    for (const a of candidatos[i] as Candidato[]) {
      if (a.peso < 0.5) continue;
      for (let d = 1; d <= 4 && i + d < n; d++) {
        for (const b of candidatos[i + d] as Candidato[]) {
          if (b.peso < 0.5 || b.romana !== a.romana) continue;
          const r = (b.valor - a.valor) / d;
          for (const p of [1, 2, 0.5]) if (Math.abs(r - p) < 1e-9) votos[String(p)] = (votos[String(p)] ?? 0) + Math.min(a.peso, b.peso);
        }
      }
    }
  }
  // Las dobles páginas también se reconocen por los candidatos con número a la derecha.
  for (const cs of candidatos) for (const c of cs) if (c.derecha !== undefined && c.peso >= 0.5) votos['2'] = (votos['2'] ?? 0) + 0.5;
  let paso = 1;
  const v1 = votos['1'] ?? 0, v2 = votos['2'] ?? 0, v05 = votos['0.5'] ?? 0;
  if (v2 > v1 * 1.5 && v2 >= 2) paso = 2;
  else if (v05 > v1 * 1.5 && v05 >= 2) paso = 0.5;
  return { paso, votos };
}
