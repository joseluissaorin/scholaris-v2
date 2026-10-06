/**
 * Revisión de la transcripción: segunda escucha de lo que suena a error.
 *
 * 1. Cribado: el Redactor lee la transcripción por ventanas y señala las frases
 *    con errores probables de reconocimiento (palabras que no existen o no
 *    encajan, gramática imposible, nombres propios mal oídos). Las vacilaciones
 *    y repeticiones del habla («eh», «pero pero») NO son errores.
 * 2. Segunda escucha: cada tramo de audio con frases señaladas se vuelve a
 *    transcribir con Gemini (audio + ficha + hablantes + nombres propios del
 *    documento), entero, para que el modelo tenga el contexto de la conversación.
 * 3. Alineación: el texto nuevo se alinea palabra a palabra con el antiguo
 *    (distancia de edición); solo se sustituyen las frases señaladas, y cada
 *    palabra nueva hereda el instante exacto de la antigua con la que casa (las
 *    insertadas se interpolan). Los instantes por palabra se conservan.
 */

import { enParalelo, reintentar, type MetadatosDocumento, type PalabraTranscrita, type Redactor } from '@scholaris/nucleo';
import type { FuentePaquete, Procedencia, TramoPlan } from '../tipos.js';
import { normalizar } from '../texto.js';
import { nombreCompleto } from './autores.js';
import { frasesIndexadas, type FraseIndexada } from './hablantes.js';

export interface CambioTranscripcion {
  t0: number;
  t1: number;
  hablante?: string;
  antes: string;
  despues: string;
  motivo: string;
}

/** Palabras [desde, hasta) sustituidas por `nuevas` (con sus instantes). */
export interface Reemplazo { desde: number; hasta: number; nuevas: PalabraTranscrita[] }

/**
 * Aplica los reemplazos sobre unas palabras con los MISMOS índices que las que se
 * revisaron (por ejemplo, ya con los hablantes con nombre): las nuevas toman el
 * hablante de la primera palabra que sustituyen. Así revisión y atribución de
 * hablantes pueden ir a la vez.
 */
export function aplicarReemplazos(palabras: PalabraTranscrita[], reemplazos: Reemplazo[]): PalabraTranscrita[] {
  const por = new Map(reemplazos.map((r) => [r.desde, r]));
  const salida: PalabraTranscrita[] = [];
  for (let i = 0; i < palabras.length;) {
    const r = por.get(i);
    if (r) {
      const h = palabras[i]?.hablante;
      salida.push(...r.nuevas.map((w) => ({ ...w, ...(h ? { hablante: h } : {}) })));
      i = r.hasta;
    } else { salida.push(palabras[i] as PalabraTranscrita); i++; }
  }
  return salida;
}

export interface OpcionesRevision {
  /** Frases por ventana de cribado. */
  ventana?: number;
  concurrencia?: number;
  /** Nombres propios del documento (títulos de obras, personas, lugares). */
  nombres?: string[];
  reloj?: () => number;
}

const reloj2 = (t: number) => { const s = Math.round(t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** 1. Cribado: índices de frase sospechosos, con el motivo. */
export async function cribarFrases(frases: FraseIndexada[], meta: MetadatosDocumento, redactor: Redactor, opciones: OpcionesRevision = {}): Promise<Map<number, string>> {
  const tam = opciones.ventana ?? 60;
  const ventanas: FraseIndexada[][] = [];
  for (let i = 0; i < frases.length; i += tam) ventanas.push(frases.slice(i, i + tam));
  const nombres = (opciones.nombres ?? []).slice(0, 60).join(', ');
  const salida = new Map<number, string>();
  await enParalelo(ventanas, opciones.concurrencia ?? 8, async (v) => {
    try {
      const r = await reintentar(() => redactor.generar<{ sospechosas: Array<{ n: number; motivo: string }> }>({
        sistema:
          'Revisas transcripciones automáticas de grabaciones habladas. Señalas SOLO las frases con un error probable del reconocimiento de voz: ' +
          'una palabra que no existe o no encaja con lo que se está diciendo, una concordancia o una sintaxis imposibles en un hablante nativo, ' +
          'un nombre propio mal oído, una frase partida o sin sentido. NO son errores las vacilaciones, muletillas y repeticiones del habla espontánea ' +
          '(«eh», «hm», «pero pero», «de de»), ni las frases que el hablante deja a medias por una interrupción. Ante la duda, no la señales.',
        mensajes: [{
          rol: 'usuario',
          partes: [{ texto: `Grabación: «${meta.titulo}»${meta.autores.length ? `, con ${meta.autores.map(nombreCompleto).join(', ')}` : ''}${meta.anio ? ` (${meta.anio})` : ''}.\n${nombres ? `Nombres propios del documento: ${nombres}.\n` : ''}\nFrases (n [tiempo] texto):\n${v.map((f) => `${f.n} [${reloj2(f.t0)}] ${f.texto}`).join('\n')}` }],
        }],
        esquema: { type: 'object', properties: { sospechosas: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, motivo: { type: 'string' } }, required: ['n', 'motivo'] } } }, required: ['sospechosas'] },
        temperatura: 0,
        maxTokens: 2000,
        calidad: 'alta',
      }), { intentos: 2, base: 1500 });
      const enVentana = new Set(v.map((f) => f.n));
      for (const s of r.json?.sospechosas ?? []) if (enVentana.has(s.n)) salida.set(s.n, s.motivo);
    } catch { /* sin cribado en esta ventana: se queda como está */ }
  });
  return salida;
}

/** Fichas normalizadas para alinear (sin tildes: «Está» y «Esta» casan). */
const clave = (w: string) => normalizar(w).replace(/\s+/g, '');
/** Para decidir si algo cambió, las tildes sí cuentan («Está» ≠ «Esta»). */
const exacta = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Alinea dos secuencias de palabras (distancia de edición). Devuelve, para cada
 * palabra nueva, el índice de la antigua con la que casa (o -1 si es insertada).
 */
export function alinear(antiguas: string[], nuevas: string[]): number[] {
  const a = antiguas.map(clave), b = nuevas.map(clave);
  const n = a.length, m = b.length;
  const d = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) d[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) d[at(0, j)] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sust = (d[at(i - 1, j - 1)] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      d[at(i, j)] = Math.min(sust, (d[at(i - 1, j)] as number) + 1, (d[at(i, j - 1)] as number) + 1);
    }
  }
  const casa = new Array<number>(m).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const actual = d[at(i, j)] as number;
    if (actual === (d[at(i - 1, j - 1)] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)) { casa[j - 1] = i - 1; i--; j--; }
    else if (actual === (d[at(i - 1, j)] as number) + 1) i--;
    else j--;
  }
  return casa;
}

/**
 * Sustituye las palabras antiguas [desde, hasta) por las nuevas que se alinean
 * con ellas, con instantes heredados o interpolados. Devuelve null si el
 * tramo nuevo no se puede casar con seguridad.
 */
export function sustituir(palabras: PalabraTranscrita[], desde: number, hasta: number, nuevas: string[], casa: number[], baseAntigua: number, usadas: Set<number> = new Set()): PalabraTranscrita[] | null {
  // Nuevas palabras que caen dentro de la frase: las casadas con [desde, hasta) y las insertadas entre ellas.
  const dentro = casa.map((k, j) => ({ j, k: k < 0 ? -1 : k + baseAntigua })).filter((x) => x.k >= desde && x.k < hasta);
  if (!dentro.length) return null;
  const j0 = (dentro[0] as { j: number }).j, j1 = (dentro.at(-1) as { j: number }).j;
  // Insertadas justo antes de la primera o después de la última, si las anteriores/siguientes casadas quedan fuera.
  let a = j0, b = j1;
  while (a > 0 && casa[a - 1] === -1 && !usadas.has(a - 1)) a--;
  while (b < nuevas.length - 1 && casa[b + 1] === -1 && !usadas.has(b + 1)) b++;
  const tramo = Array.from({ length: b - a + 1 }, (_, i) => a + i).filter((j) => !usadas.has(j));
  const largo = hasta - desde;
  if (!tramo.length || tramo.length > largo * 2 + 3 || tramo.length < largo / 2 - 1) return null;
  // Que no se pierda texto: al menos el 85 % de las palabras antiguas tiene que casar con alguna nueva.
  const casadas = new Set(tramo.map((j) => (casa[j] as number) + baseAntigua).filter((k) => k >= desde && k < hasta));
  if (casadas.size < largo * 0.85) return null;
  for (const j of tramo) usadas.add(j);
  const hablante = palabras[desde]?.hablante;
  const salida: PalabraTranscrita[] = [];
  const t0Frase = (palabras[desde] as PalabraTranscrita).t0, t1Frase = (palabras[hasta - 1] as PalabraTranscrita).t1;
  for (const j of tramo) {
    const k = casa[j] as number;
    const vieja = k >= 0 && k + baseAntigua >= desde && k + baseAntigua < hasta ? palabras[k + baseAntigua] : undefined;
    salida.push({ texto: nuevas[j] as string, t0: vieja?.t0 ?? NaN, t1: vieja?.t1 ?? NaN, ...(hablante ? { hablante } : {}) });
  }
  // Interpolar las insertadas entre sus vecinas con instante.
  for (let i = 0; i < salida.length; i++) {
    const w = salida[i] as PalabraTranscrita;
    if (!Number.isNaN(w.t0)) continue;
    let p = i - 1; while (p >= 0 && Number.isNaN((salida[p] as PalabraTranscrita).t1)) p--;
    let q = i + 1; while (q < salida.length && Number.isNaN((salida[q] as PalabraTranscrita).t0)) q++;
    const izq = p >= 0 ? (salida[p] as PalabraTranscrita).t1 : t0Frase;
    const der = q < salida.length ? (salida[q] as PalabraTranscrita).t0 : t1Frase;
    const huecos = q - p - 1;
    const paso = Math.max(0, der - izq) / Math.max(1, huecos);
    for (let r = p + 1; r < q; r++) {
      const x = salida[r] as PalabraTranscrita;
      x.t0 = izq + paso * (r - p - 1);
      x.t1 = izq + paso * (r - p);
    }
    i = q - 1;
  }
  return salida;
}

/** 2. Segunda escucha de un tramo entero con Gemini y contexto. */
export async function reescuchar(audio: { bytes: Uint8Array; mime: string }, meta: MetadatosDocumento, hablantes: string[], nombres: string[], redactor: Redactor): Promise<string> {
  const r = await reintentar(() => redactor.generar<{ texto: string }>({
    sistema: 'Transcribes audio palabra por palabra (verbatim), en el idioma original, incluidas las vacilaciones («eh», «hm») y las repeticiones. No resumes, no corriges el estilo, no añades nada.',
    mensajes: [{
      rol: 'usuario',
      partes: [
        { texto: `Grabación: «${meta.titulo}»${meta.autores.length ? `, con ${meta.autores.map(nombreCompleto).join(', ')}` : ''}${meta.anio ? ` (${meta.anio})` : ''}.${hablantes.length ? ` Hablan: ${hablantes.join(', ')}.` : ''}${nombres.length ? `\nNombres propios que pueden aparecer: ${nombres.slice(0, 60).join(', ')}.` : ''}\nTranscribe TODO este audio, de principio a fin, sin indicar quién habla.` },
        { bytes: audio.bytes, mime: audio.mime },
      ],
    }],
    esquema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
    temperatura: 0,
    maxTokens: 16_000,
    calidad: 'alta',
  }), { intentos: 2, base: 2000 });
  return r.json?.texto ?? '';
}

/** Nombres propios del documento: los de la ficha y los que la transcripción escribe con mayúscula a mitad de frase. */
export function nombresPropios(meta: MetadatosDocumento, palabras: PalabraTranscrita[]): string[] {
  const cuenta = new Map<string, number>();
  for (let i = 1; i < palabras.length; i++) {
    const w = (palabras[i] as PalabraTranscrita).texto.replace(/[^\p{L}\p{N}'-]/gu, '');
    const previa = (palabras[i - 1] as PalabraTranscrita).texto;
    if (/^\p{Lu}\p{Ll}{2,}/u.test(w) && !/[.!?…:]$/.test(previa)) cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  }
  const ficha = [meta.titulo, ...meta.autores.map(nombreCompleto), meta.editorial ?? '', meta.revista ?? ''].filter(Boolean) as string[];
  return [...ficha, ...[...cuenta].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w)].slice(0, 80);
}

export async function revisarTranscripcion(
  palabras: PalabraTranscrita[],
  tramos: TramoPlan[],
  fuente: FuentePaquete,
  meta: MetadatosDocumento,
  redactor: Redactor,
  opciones: OpcionesRevision = {},
): Promise<{ palabras: PalabraTranscrita[]; reemplazos: Reemplazo[]; cambios: CambioTranscripcion[]; procedencia: Procedencia }> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const frases = frasesIndexadas(palabras);
  const nombres = opciones.nombres ?? nombresPropios(meta, palabras);
  const sospechosas = await cribarFrases(frases, meta, redactor, { ...opciones, nombres });
  // Tramos con alguna frase sospechosa.
  const porTramo = new Map<TramoPlan, FraseIndexada[]>();
  for (const f of frases) {
    if (!sospechosas.has(f.n)) continue;
    const tr = tramos.find((x) => f.t0 >= x.propioDesde - 0.01 && f.t0 < x.propioHasta + 0.01) ?? tramos.find((x) => f.t0 >= x.t0 && f.t0 < x.t1);
    if (tr) porTramo.set(tr, [...(porTramo.get(tr) ?? []), f]);
  }
  const hablantes = [...new Set(palabras.map((w) => w.hablante).filter((h): h is string => Boolean(h) && !/^H\d/.test(h as string)))];
  const reemplazos = new Map<number, { hasta: number; nuevas: PalabraTranscrita[]; frase: FraseIndexada; despues: string }>();
  let reescuchados = 0, fallidos = 0;
  await enParalelo([...porTramo], opciones.concurrencia ?? 8, async ([tr, fs]) => {
    try {
      const audio = await fuente.parte(tr.parte);
      if (!audio) return;
      const texto = await reescuchar(audio, meta, hablantes, nombres, redactor);
      reescuchados++;
      const nuevas = texto.split(/\s+/).filter(Boolean);
      // Palabras antiguas del tramo (las propias, para casar con lo que se oyó).
      const indices = palabras.map((w, i) => ({ w, i })).filter(({ w }) => w.t0 >= tr.t0 - 0.01 && w.t1 <= tr.t1 + 0.5);
      if (!indices.length || !nuevas.length) return;
      const base = (indices[0] as { i: number }).i;
      const casa = alinear(indices.map((x) => x.w.texto), nuevas);
      const usadas = new Set<number>();
      for (const f of fs) {
        const r = sustituir(palabras, f.desde, f.hasta, nuevas, casa, base, usadas);
        if (!r) continue;
        const despues = r.map((w) => w.texto).join(' ');
        if (exacta(despues) === exacta(f.texto)) continue;
        reemplazos.set(f.desde, { hasta: f.hasta, nuevas: r, frase: f, despues });
      }
    } catch { fallidos++; }
  });
  const lista: Reemplazo[] = [...reemplazos].sort((x, y) => x[0] - y[0]).map(([desde, r]) => ({ desde, hasta: r.hasta, nuevas: r.nuevas }));
  const cambios: CambioTranscripcion[] = [...reemplazos].sort((x, y) => x[0] - y[0]).map(([, r]) => ({ t0: r.frase.t0, t1: r.frase.t1, ...(r.frase.etiqueta ? { hablante: r.frase.etiqueta } : {}), antes: r.frase.texto, despues: r.despues, motivo: sospechosas.get(r.frase.n) ?? '' }));
  return {
    palabras: aplicarReemplazos(palabras, lista),
    reemplazos: lista,
    cambios,
    procedencia: { fase: 'lectura', proveedor: `revision:${redactor.nombre}`, ms: reloj() - t, detalle: { frases: frases.length, sospechosas: sospechosas.size, tramos: porTramo.size, reescuchados, fallidos, cambios: cambios.length } },
  };
}
