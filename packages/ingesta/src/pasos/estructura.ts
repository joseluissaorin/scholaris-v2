/**
 * Paso de estructura: las secciones del documento.
 *
 * Con índice del PDF (marcadores) o del EPUB, manda el índice: cada entrada se
 * ancla al párrafo de su página que mejor coincide con el título. Sin índice,
 * los títulos que marcó el lector (# en Markdown) o la capa (cuerpo de letra).
 * Los titulillos repetidos no son secciones.
 */

import { nuevoId } from '@scholaris/nucleo';
import type { Procedencia, Seccion, UnidadLeida } from '../tipos.js';
import { esTituloMarkdown, normalizar, partirParrafos, similitud } from '../texto.js';

export interface EntradaIndice { titulo: string; nivel: number; fisica: number | null }

/** Párrafos de una unidad, tal como los ve el troceador (misma función para los dos). */
export function parrafosDeUnidad(u: UnidadLeida): string[] {
  return partirParrafos(u.texto);
}

interface Titulo { unidad: number; parrafo: number; nivel: number; texto: string }

/** Títulos que aparecen en el texto leído, sin titulillos repetidos ni falsos títulos. */
export function titulosDelTexto(unidades: UnidadLeida[]): Titulo[] {
  const todos: Titulo[] = [];
  for (const u of unidades) {
    parrafosDeUnidad(u).forEach((p, i) => {
      const t = esTituloMarkdown(p);
      if (t && t.texto.length >= 2 && t.texto.split(/\s+/).length <= 20) todos.push({ unidad: u.orden, parrafo: i, nivel: t.nivel, texto: t.texto });
    });
  }
  // Un «título» que se repite en muchas páginas es un titulillo.
  const veces = new Map<string, number>();
  for (const t of todos) veces.set(normalizar(t.texto), (veces.get(normalizar(t.texto)) ?? 0) + 1);
  const limite = Math.max(3, unidades.length * 0.05);
  // Títulos que son solo un número o un folio: fuera.
  return todos.filter((t) => (veces.get(normalizar(t.texto)) ?? 0) < limite && !/^[\divxlcdm.\s]+$/i.test(t.texto));
}

/** Ajusta los niveles para que sean consecutivos (1, 2, 3…) sin huecos. */
function compactarNiveles(ts: Titulo[]): Titulo[] {
  const niveles = [...new Set(ts.map((t) => t.nivel))].sort((a, b) => a - b);
  const mapa = new Map(niveles.map((n, i) => [n, i + 1]));
  return ts.map((t) => ({ ...t, nivel: mapa.get(t.nivel) ?? t.nivel }));
}

export function construirSecciones(titulos: Titulo[], totalUnidades: number): Seccion[] {
  const ordenados = [...titulos].sort((a, b) => a.unidad - b.unidad || a.parrafo - b.parrafo);
  const secciones: Seccion[] = [];
  const pila: Seccion[] = [];
  for (const t of ordenados) {
    while (pila.length && (pila.at(-1) as Seccion).nivel >= t.nivel) pila.pop();
    const s: Seccion = { id: nuevoId('sc'), padre: pila.at(-1)?.id ?? null, nivel: t.nivel, titulo: t.texto, desde: { unidad: t.unidad, parrafo: t.parrafo }, hasta: totalUnidades - 1 };
    secciones.push(s);
    pila.push(s);
  }
  // Cada sección acaba donde empieza la siguiente de su nivel o superior.
  for (let i = 0; i < secciones.length; i++) {
    const s = secciones[i] as Seccion;
    const sig = secciones.slice(i + 1).find((x) => x.nivel <= s.nivel);
    if (sig) s.hasta = sig.desde.parrafo === 0 ? Math.max(s.desde.unidad, sig.desde.unidad - 1) : sig.desde.unidad;
  }
  return secciones;
}

/** Ancla las entradas del índice al párrafo que mejor coincide en su página (o la siguiente). */
export function anclarIndice(indice: EntradaIndice[], unidades: UnidadLeida[]): Titulo[] {
  const porFisica = new Map(unidades.map((u) => [u.fisica, u]));
  const salida: Titulo[] = [];
  for (const e of indice) {
    if (e.fisica === null) continue;
    let mejor: Titulo | null = null, puntos = 0;
    for (const f of [e.fisica, e.fisica + 1]) {
      const u = porFisica.get(f);
      if (!u) continue;
      parrafosDeUnidad(u).slice(0, 12).forEach((p, i) => {
        const limpio = esTituloMarkdown(p)?.texto ?? p.slice(0, 200);
        const s = similitud(limpio, e.titulo) + (esTituloMarkdown(p) ? 0.1 : 0);
        if (s > puntos) { puntos = s; mejor = { unidad: u.orden, parrafo: i, nivel: e.nivel, texto: e.titulo }; }
      });
      if (puntos >= 0.75) break;
    }
    const u = porFisica.get(e.fisica);
    if (mejor && puntos >= 0.6) salida.push(mejor);
    else if (u) salida.push({ unidad: u.orden, parrafo: 0, nivel: e.nivel, texto: e.titulo });
  }
  return salida;
}

export function pasoEstructura(
  unidades: UnidadLeida[],
  indice: EntradaIndice[] | undefined,
  opciones: { reloj?: () => number } = {},
): { secciones: Seccion[]; procedencia: Procedencia } {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const util = (indice ?? []).filter((e) => e.fisica !== null && e.titulo.trim());
  let titulos: Titulo[];
  let fuente: string;
  if (util.length >= 2) {
    titulos = anclarIndice(util, unidades);
    fuente = 'indice';
    // Si el índice solo tiene un nivel, los títulos del texto que caen dentro aportan el segundo.
    const niveles = new Set(util.map((e) => e.nivel));
    if (niveles.size === 1) {
      const primero = titulos.reduce((m, y) => (y.unidad < m.unidad || (y.unidad === m.unidad && y.parrafo < m.parrafo) ? y : m), titulos[0] as Titulo);
      const delTexto = titulosDelTexto(unidades).filter((x) => primero && (x.unidad > primero.unidad || (x.unidad === primero.unidad && x.parrafo > primero.parrafo))).filter((x) => !titulos.some((y) => similitud(x.texto, y.texto) > 0.8 || (x.unidad === y.unidad && x.parrafo === y.parrafo)));
      const base = Math.max(...niveles);
      if (delTexto.length && delTexto.length < unidades.length * 1.5) {
        const minNivel = Math.min(...delTexto.map((x) => x.nivel));
        titulos.push(...delTexto.map((x) => ({ ...x, nivel: base + 1 + (x.nivel - minNivel) })));
        fuente = 'indice+texto';
      }
    }
  } else {
    titulos = compactarNiveles(titulosDelTexto(unidades));
    fuente = 'texto';
  }
  const secciones = construirSecciones(titulos, unidades.length);
  return { secciones, procedencia: { fase: 'estructura', proveedor: fuente, ms: reloj() - t, detalle: { secciones: secciones.length, fuente } } };
}

/** Ruta de títulos de una sección (de la raíz a ella). */
export function rutaDe(seccion: Seccion | undefined, porId: Map<string, Seccion>): string[] {
  const ruta: string[] = [];
  let s = seccion;
  while (s) { ruta.unshift(s.titulo); s = s.padre ? porId.get(s.padre) : undefined; }
  return ruta;
}
