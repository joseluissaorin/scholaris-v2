/**
 * Audio y vídeo: transcripción de los tramos en paralelo, unión sin duplicar el
 * solape y corte en tramos citables de 30-60 s que terminan en fin de frase.
 */

import { enParalelo, reintentar, type PalabraTranscrita, type Transcriptor } from '@scholaris/nucleo';
import type { FuentePaquete, Procedencia, TramoPlan, UnidadLeida } from '../tipos.js';
import { Cobertura } from '../cobertura.js';

export interface ResultadoTranscripcionTramo {
  n: number;
  idioma?: string;
  palabras: PalabraTranscrita[];
  /** Palabras del solape con el tramo anterior (sirven para casar las etiquetas de hablante). */
  solape?: PalabraTranscrita[];
  procedencia: Procedencia;
}

/** Transcribe un tramo y devuelve sus palabras en tiempo absoluto, solo las propias (sin solape). */
export async function transcribirTramo(
  tramo: TramoPlan,
  fuente: FuentePaquete,
  transcriptor: Transcriptor,
  opciones: { idioma?: string; pista?: string; reloj?: () => number; cobertura?: Cobertura } = {},
): Promise<ResultadoTranscripcionTramo> {
  const reloj = opciones.reloj ?? Date.now;
  const t = reloj();
  const audio = await fuente.parte(tramo.parte);
  if (!audio) throw new Error(`Falta el tramo de audio ${tramo.parte}`);
  const llamar = <T,>(fn: () => Promise<T>) => (opciones.cobertura ? opciones.cobertura.llamar(fn) : fn());
  const r = await reintentar(
    () => llamar(() => transcriptor.transcribir(
      { bytes: audio.bytes, mime: audio.mime, desplazamiento: tramo.t0 },
      { hablantes: true, ...(opciones.idioma ? { idioma: opciones.idioma } : {}), ...(opciones.pista ? { pista: opciones.pista } : {}) },
    )),
    { intentos: 3, base: 2000 },
  );
  let palabras = r.palabras.filter((p) => p.texto.trim());
  // ¿Tiempos relativos al tramo? Si caben todos en su duración y el tramo no empieza en 0, se desplazan.
  const dur = tramo.t1 - tramo.t0;
  const maxT = palabras.reduce((m, p) => Math.max(m, p.t1), 0);
  const minT = palabras.reduce((m, p) => Math.min(m, p.t0), Infinity);
  if (tramo.t0 > 1 && maxT <= dur + 2 && minT < tramo.t0 - 1) palabras = palabras.map((p) => ({ ...p, t0: p.t0 + tramo.t0, t1: p.t1 + tramo.t0 }));
  // Solo lo propio: el solape lo cuenta el tramo vecino (pero se guarda para casar hablantes).
  const solape = palabras.filter((p) => (p.t0 + p.t1) / 2 < tramo.propioDesde - 0.01);
  palabras = palabras.filter((p) => {
    const centro = (p.t0 + p.t1) / 2;
    return centro >= tramo.propioDesde - 0.01 && centro < tramo.propioHasta + 0.01;
  });
  return {
    n: tramo.n,
    ...(r.idioma ? { idioma: r.idioma } : {}),
    palabras,
    ...(solape.length ? { solape } : {}),
    procedencia: { fase: 'lectura', proveedor: transcriptor.nombre, ms: reloj() - t, detalle: { tramo: tramo.n, t0: tramo.t0, t1: tramo.t1, palabras: palabras.length } },
  };
}

export async function transcribirMedio(
  tramos: TramoPlan[],
  fuente: FuentePaquete,
  transcriptor: Transcriptor,
  concurrencia: number,
  opciones: { idioma?: string; pista?: string; reloj?: () => number; alTramo?: (r: ResultadoTranscripcionTramo) => void } = {},
): Promise<{ palabras: PalabraTranscrita[]; idioma?: string; procedencia: Procedencia[] }> {
  const cobertura = new Cobertura(45_000, 2, opciones.reloj);
  const res = await enParalelo(tramos, concurrencia, async (t) => {
    const r = await transcribirTramo(t, fuente, transcriptor, { ...opciones, cobertura });
    opciones.alTramo?.(r);
    return r;
  });
  casarHablantes(res);
  const palabras = res.flatMap((r) => r.palabras).sort((a, b) => a.t0 - b.t0);
  const idiomas = new Map<string, number>();
  for (const r of res) if (r.idioma) idiomas.set(r.idioma, (idiomas.get(r.idioma) ?? 0) + r.palabras.length);
  const idioma = [...idiomas].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { palabras, ...(idioma ? { idioma } : {}), procedencia: res.map((r) => r.procedencia) };
}

/**
 * Cada tramo se diariza por separado: su «hablante 1» no tiene por qué ser el del
 * tramo anterior. Se casan por las palabras del solape (las mismas palabras en
 * los dos tramos); lo que no se puede casar se renombra para no confundirlo.
 */
export function casarHablantes(tramos: Array<Pick<ResultadoTranscripcionTramo, 'n' | 'palabras' | 'solape'>>): void {
  const orden = [...tramos].sort((a, b) => a.n - b.n);
  for (let i = 1; i < orden.length; i++) {
    const previo = orden[i - 1] as (typeof orden)[number], actual = orden[i] as (typeof orden)[number];
    const votos = new Map<string, Map<string, number>>();
    for (const w of actual.solape ?? []) {
      if (!w.hablante) continue;
      const par = previo.palabras.find((p) => Math.abs(p.t0 - w.t0) < 0.6 && p.texto.toLowerCase().replace(/\W/g, '') === w.texto.toLowerCase().replace(/\W/g, ''));
      if (!par?.hablante) continue;
      const m = votos.get(w.hablante) ?? new Map<string, number>();
      m.set(par.hablante, (m.get(par.hablante) ?? 0) + 1);
      votos.set(w.hablante, m);
    }
    const mapa = new Map<string, string>();
    for (const [local, m] of votos) mapa.set(local, [...m].sort((a, b) => b[1] - a[1])[0]?.[0] as string);
    // Las etiquetas sin pareja se quedan como están si no chocan con una ya casada.
    const usadas = new Set(mapa.values());
    for (const w of actual.palabras) {
      if (!w.hablante) continue;
      if (mapa.has(w.hablante)) w.hablante = mapa.get(w.hablante);
      else if (usadas.has(w.hablante)) { const nueva = `${w.hablante}·${actual.n}`; mapa.set(w.hablante, nueva); w.hablante = nueva; }
      else mapa.set(w.hablante, w.hablante);
    }
  }
}

interface Frase { texto: string; t0: number; t1: number; hablante?: string }

/** Agrupa palabras en frases: puntuación final, o pausa larga si el ASR no puntúa. */
export function frasesDe(palabras: PalabraTranscrita[]): Frase[] {
  const frases: Frase[] = [];
  const puntua = palabras.some((p) => /[.!?]["»”)]*$/.test(p.texto));
  let actual: PalabraTranscrita[] = [];
  const cerrar = () => {
    if (!actual.length) return;
    const primera = actual[0] as PalabraTranscrita;
    const ultima = actual.at(-1) as PalabraTranscrita;
    const texto = actual.map((p) => p.texto.trim()).join(' ').replace(/\s+([,.;:!?…»”)])/g, '$1').replace(/([«“(¿¡])\s+/g, '$1');
    frases.push({ texto, t0: primera.t0, t1: ultima.t1, ...(primera.hablante ? { hablante: primera.hablante } : {}) });
    actual = [];
  };
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i] as PalabraTranscrita;
    const previa = actual.at(-1);
    if (previa && p.hablante !== undefined && previa.hablante !== p.hablante) cerrar();
    actual.push(p);
    const sig = palabras[i + 1];
    const pausa = sig ? sig.t0 - p.t1 : 0;
    if (puntua ? /[.!?…]["»”)]*$/.test(p.texto) : pausa > 0.7) cerrar();
    else if (pausa > 2.5) cerrar();
  }
  cerrar();
  return frases;
}

export interface OpcionesSegmentar { minimo?: number; objetivo?: number; maximo?: number }

/**
 * Corta la transcripción en unidades citables de 30-60 s en fin de frase. Se
 * prefiere cortar donde cambia el hablante una vez pasado el mínimo.
 */
export function segmentarTranscripcion(palabras: PalabraTranscrita[], opciones: OpcionesSegmentar = {}): UnidadLeida[] {
  const minimo = opciones.minimo ?? 30, objetivo = opciones.objetivo ?? 45, maximo = opciones.maximo ?? 60;
  const frases = frasesDe(palabras);
  const grupos: Frase[][] = [];
  let g: Frase[] = [];
  for (let i = 0; i < frases.length; i++) {
    const f = frases[i] as Frase;
    // Una frase que por sí sola desborda el máximo se queda sola.
    if (g.length) {
      const dur = f.t1 - (g[0] as Frase).t0;
      const cambio = f.hablante !== undefined && (g.at(-1) as Frase).hablante !== f.hablante;
      const actual = (g.at(-1) as Frase).t1 - (g[0] as Frase).t0;
      if (dur > maximo || (actual >= objetivo) || (cambio && actual >= minimo)) { grupos.push(g); g = []; }
    }
    g.push(f);
  }
  if (g.length) {
    const durG = (g.at(-1) as Frase).t1 - (g[0] as Frase).t0;
    const previo = grupos.at(-1);
    // Un resto corto se une al anterior si no se pasa mucho.
    if (previo && durG < minimo / 2 && (g.at(-1) as Frase).t1 - (previo[0] as Frase).t0 <= maximo * 1.25) previo.push(...g);
    else grupos.push(g);
  }
  return grupos.map((fr, i) => {
    const t0 = (fr[0] as Frase).t0, t1 = (fr.at(-1) as Frase).t1;
    const porHablante = new Map<string, number>();
    for (const f of fr) if (f.hablante) porHablante.set(f.hablante, (porHablante.get(f.hablante) ?? 0) + (f.t1 - f.t0));
    const hablante = [...porHablante].sort((a, b) => b[1] - a[1])[0]?.[0];
    const varios = porHablante.size > 1;
    // Texto: si hablan varios, cada turno con su etiqueta.
    const lineas: string[] = [];
    let turno: string | undefined;
    for (const f of fr) {
      if (varios && f.hablante !== turno) { lineas.push(`**${f.hablante ?? '?'}:** ${f.texto}`); turno = f.hablante; }
      else if (lineas.length) lineas[lineas.length - 1] += ' ' + f.texto;
      else lineas.push(f.texto);
    }
    return {
      orden: i,
      fisica: i + 1,
      texto: lineas.join('\n\n'),
      notas: [],
      cabecera: '',
      pie: '',
      folioVisto: null,
      titulos: [],
      figuras: [],
      vacia: false,
      lector: 'transcripcion',
      confianza: 0.9,
      t0,
      t1,
      ...(hablante ? { hablante } : {}),
      ancla: { tipo: 'tiempo', t0: redondear(t0), t1: redondear(t1), ...(hablante ? { hablante } : {}) },
    } satisfies UnidadLeida;
  });
}

const redondear = (x: number) => Math.round(x * 100) / 100;
