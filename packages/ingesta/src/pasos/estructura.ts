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

/** Quita la numeración de un título («5.3 Optimizer» → «Optimizer», «IV. The Heavens» → «The Heavens»). */
const sinNumero = (t: string) => t.replace(/^\s*(chapter|cap[ií]tulo|part|parte|libro|book)?\s*([\dIVXLC]+[.)]?)+(\s*[.:—–-])?\s+/i, '').trim();

/** Ancla las entradas del índice al párrafo que mejor coincide en su página (o la siguiente), sin volver atrás. */
export function anclarIndice(indice: EntradaIndice[], unidades: UnidadLeida[]): Titulo[] {
  const porFisica = new Map(unidades.map((u) => [u.fisica, u]));
  const salida: Titulo[] = [];
  let ultimo = { unidad: -1, parrafo: -1 };
  const despues = (u: number, p: number) => u > ultimo.unidad || (u === ultimo.unidad && p > ultimo.parrafo);
  for (const e of indice) {
    if (e.fisica === null) continue;
    const titulo = sinNumero(e.titulo) || e.titulo;
    let mejor: Titulo | null = null, puntos = 0;
    for (const [f, limite] of [[e.fisica, 400], [e.fisica + 1, 6]] as const) {
      const u = porFisica.get(f);
      if (!u) continue;
      parrafosDeUnidad(u).slice(0, limite).forEach((p, i) => {
        if (!despues(u.orden, i)) return;
        const md = esTituloMarkdown(p);
        const limpio = sinNumero(md?.texto ?? p.slice(0, 300));
        // El título puede ir pegado al principio del párrafo («5.3 Optimizer We used…»).
        const s = Math.max(similitud(limpio, titulo), similitud(limpio.slice(0, titulo.length + 2), titulo) - 0.05) + (md || p.length < 120 ? 0.1 : 0);
        if (s > puntos) { puntos = s; mejor = { unidad: u.orden, parrafo: i, nivel: e.nivel, texto: e.titulo }; }
      });
      if (puntos >= 0.7) break;
    }
    const u = porFisica.get(e.fisica);
    let t: Titulo | null = mejor && puntos >= 0.6 ? mejor : u ? { unidad: u.orden, parrafo: 0, nivel: e.nivel, texto: e.titulo } : null;
    if (!t) continue;
    // «CHAPTER I» encima del título: la sección empieza en el rótulo.
    const un = unidades.find((x) => x.orden === (t as Titulo).unidad);
    if (un) {
      const ps = parrafosDeUnidad(un);
      while (t.parrafo > 0 && despues(t.unidad, t.parrafo - 1)) {
        const previo = esTituloMarkdown(ps[t.parrafo - 1] ?? '');
        if (!previo || previo.texto.split(/\s+/).length > 5) break;
        t = { ...t, parrafo: t.parrafo - 1 };
      }
    }
    if (!despues(t.unidad, t.parrafo)) t = { ...t, unidad: ultimo.unidad, parrafo: ultimo.parrafo };
    ultimo = { unidad: t.unidad, parrafo: t.parrafo };
    salida.push(t);
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
      const delTexto = titulosDelTexto(unidades).filter((x) => primero && (x.unidad > primero.unidad || (x.unidad === primero.unidad && x.parrafo > primero.parrafo))).filter((x) => !titulos.some((y) => similitud(x.texto, y.texto) > 0.8 || (x.unidad === y.unidad && x.parrafo >= y.parrafo - 2 && x.parrafo <= y.parrafo)));
      const base = Math.max(...niveles);
      if (delTexto.length && delTexto.length < unidades.length * 1.5) {
        // Los niveles que pone el lector cambian de una página a otra: todos, un nivel por debajo del índice.
        titulos.push(...delTexto.map((x) => ({ ...x, nivel: base + 1 })));
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

/**
 * Los titulillos (cabecera corrida: título del libro o del capítulo) a veces se
 * cuelan en el cuerpo como «## The Discarded Image». Se quitan los párrafos
 * cortos al principio o al final de la página, y los títulos, que repiten una
 * cabecera o pie vistos en al menos tres páginas.
 */
export function quitarTitulillos(unidades: UnidadLeida[]): number {
  const forma = (t: string) => normalizar(t).replace(/\b[\divxlcdm]+\b/g, '').replace(/\s+/g, ' ').trim();
  const cuenta = new Map<string, number>();
  for (const u of unidades) for (const z of [u.cabecera, u.pie]) for (const parte of z.split(/\s+\/\s+|\n/)) {
    const f = forma(parte);
    if (f.length >= 4) cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
  }
  const titulillos = new Set([...cuenta].filter(([, n]) => n >= 3).map(([f]) => f));
  if (!titulillos.size) return 0;
  let quitados = 0;
  for (const u of unidades) {
    const ps = partirParrafos(u.texto);
    const quedan = ps.filter((p, i) => {
      const t = esTituloMarkdown(p)?.texto ?? (p.length < 90 && (i === 0 || i === ps.length - 1) ? p : null);
      const fuera = t !== null && titulillos.has(forma(t));
      if (fuera) quitados++;
      return !fuera;
    });
    if (quedan.length !== ps.length) u.texto = quedan.join('\n\n');
  }
  return quitados;
}
