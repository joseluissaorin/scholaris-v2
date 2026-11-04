/**
 * Revisión de la transcripción de un medio con la percepción (NOTAS.md, «La
 * transcripción»): lo que el transcriptor se dejó, los tiempos rotos y quién
 * dice cada frase.
 *
 * 1. Cobertura. Se comparan los tramos con sonido en la banda de la voz (del
 *    conversor, `proxy.voz.json`) con lo transcrito. Lo que suena y no tiene
 *    palabras es un hueco. También se marcan las palabras con el tiempo roto:
 *    duración de 0 a 0,02 s, amontonadas.
 * 2. Huecos. Se vuelven a transcribir en subventanas cortas (75 s como máximo)
 *    con el modelo mirando el proxy. Si falla, entra la reserva (Whisper) con el
 *    audio de ese tramo.
 * 3. Hablantes y tiempos. Por ventanas de 8 min, el modelo ve y oye cada frase
 *    numerada y dice quién la dice, si se le ve hablar y, si la marca está mal,
 *    cuándo se dice de verdad.
 *
 * El resultado son correcciones tipadas (`CorreccionTranscripcion`), que la
 * ingesta aplica con `aplicarCorrecciones`. Todo se graba: repetirlo no cuesta.
 */
import { enParalelo, sha256, type Evidencia, type PercepcionMedio, type PersonaPercibida, type Transcriptor } from '@scholaris/nucleo';
import { instantesDePalabras, type PalabrasTiempo } from '@scholaris/spdf';
import { normalNombre, Unificador, repartoInicial } from './reparto.js';
import type { AlmacenTrabajo, CostePercepcion, FicheroModelo, Mirada, UnidadMedio, Vidente } from './tipos.js';
import { aSegundos, hablantesDe, marca, turnosDe, ventanasDe, type Ventana } from './ventanas.js';

export const VERSION_REVISION = 'revision-1';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface Tramo {
  t0: number;
  t1: number;
}

/** Una palabra de la transcripción y su sitio: la unidad (su orden) y su índice entre las palabras de la unidad. */
export interface PalabraUbicada {
  unidad: number;
  i: number;
  texto: string;
  t0: number;
  t1: number;
  hablante?: string;
}

/** Una frase de la transcripción: palabras [desde, hasta) de una unidad, de un mismo hablante. */
export interface FraseUbicada {
  n: number;
  unidad: number;
  palabras: [number, number];
  t0: number;
  t1: number;
  hablante?: string;
  texto: string;
}

export interface Hueco extends Tramo {
  /** `sin_texto`: suena y no hay palabras. `tiempos_rotos`: hay palabras, pero sus instantes no valen. */
  motivo: 'sin_texto' | 'tiempos_rotos';
  /** Segundos con sonido dentro del hueco. */
  activo: number;
}

/** Lo que se oye en un tramo: una frase con su hablante. */
export interface SegmentoOido {
  t0: number;
  t1: number;
  hablante?: string;
  texto: string;
  /** Se le ve hablar en el plano. */
  enCuadro?: boolean;
}

/**
 * Una corrección que la ingesta puede aplicar a sus unidades. `unidad` es el
 * orden de la unidad; `palabras`, el rango [desde, hasta) de sus palabras (las
 * del texto sin las marcas «**Nombre:**», como en `unidades.palabras`).
 */
export type CorreccionTranscripcion =
  /** Lo que faltaba (o, con `reemplaza`, las unidades con el tiempo roto, que se sustituyen por lo que se oye en su tramo). */
  | { tipo: 'hueco'; t0: number; t1: number; segmentos: SegmentoOido[]; reemplaza?: number[]; fuente: string; confianza: number }
  | { tipo: 'hablante'; unidad: number; palabras: [number, number]; t0: number; t1: number; texto: string; de?: string; a: string; enCuadro?: boolean; confianza: number; fuente: string; evidencia?: Evidencia }
  | { tipo: 'desfase'; unidad: number; palabras: [number, number]; texto: string; de: number; a: number; confianza: number; fuente: string };

export interface CoberturaTranscripcion {
  /** Segundos con sonido en la banda de la voz (o la duración, si no hay mapa de actividad). */
  activo: number;
  /** Segundos con sonido cubiertos por palabras con instante válido. */
  cubierto: number;
  huecos: Hueco[];
  /** Palabras con el instante roto (duración ≤ 0,02 s). */
  palabrasRotas: number;
  palabras: number;
}

export interface RevisionTranscripcion {
  documento: string;
  version: string;
  modelo: string;
  cobertura: CoberturaTranscripcion;
  correcciones: CorreccionTranscripcion[];
  avisos: string[];
  coste: CostePercepcion;
}

// ---------------------------------------------------------------------------
// Palabras y frases
// ---------------------------------------------------------------------------

const MARCA_TURNO = /\*\*([^*\n]{1,80}?):\*\*/g;

/** Las palabras de una unidad con su hablante (por las marcas «**Nombre:**») y su instante. */
export function palabrasDeUnidad(u: UnidadMedio, orden: number): PalabraUbicada[] {
  const instantes = u.palabras ? instantesDePalabras(u.palabras) : null;
  const trozos: Array<{ hablante?: string; texto: string }> = [];
  const marcas = [...u.texto.matchAll(MARCA_TURNO)];
  if (!marcas.length) trozos.push({ ...(u.hablante ? { hablante: u.hablante } : {}), texto: u.texto });
  else {
    if (marcas[0]!.index! > 0) trozos.push({ texto: u.texto.slice(0, marcas[0]!.index) });
    marcas.forEach((m, k) => trozos.push({ hablante: m[1]!.trim(), texto: u.texto.slice(m.index! + m[0].length, marcas[k + 1]?.index ?? u.texto.length) }));
  }
  const total = trozos.reduce((n, t) => n + t.texto.split(/\s+/).filter(Boolean).length, 0);
  const out: PalabraUbicada[] = [];
  for (const t of trozos) {
    for (const texto of t.texto.split(/\s+/).filter(Boolean)) {
      const i = out.length;
      const [a, b] = instantes?.[i] ?? [u.t0 + ((u.t1 - u.t0) * i) / Math.max(1, total), u.t0 + ((u.t1 - u.t0) * (i + 1)) / Math.max(1, total)];
      out.push({ unidad: orden, i, texto, t0: a, t1: b, ...(t.hablante ? { hablante: t.hablante } : {}) });
    }
  }
  return out;
}

export function palabrasDeUnidades(unidades: UnidadMedio[]): PalabraUbicada[] {
  return unidades.flatMap((u, k) => palabrasDeUnidad(u, u.orden ?? k));
}

const ROTA = 0.02;
export const esRota = (p: { t0: number; t1: number }) => p.t1 - p.t0 <= ROTA;

/** Frases: se corta en fin de frase, en cambio de hablante y en cambio de unidad. El instante sale de sus palabras con tiempo válido. */
export function frasesUbicadas(palabras: PalabraUbicada[]): FraseUbicada[] {
  const out: FraseUbicada[] = [];
  let actual: PalabraUbicada[] = [];
  const cerrar = () => {
    if (!actual.length) return;
    const validas = actual.filter((p) => !esRota(p));
    const ref = validas.length ? validas : actual;
    const p0 = actual[0]!;
    out.push({
      n: out.length, unidad: p0.unidad, palabras: [p0.i, actual.at(-1)!.i + 1],
      t0: Math.min(...ref.map((p) => p.t0)), t1: Math.max(...ref.map((p) => p.t1)),
      ...(p0.hablante ? { hablante: p0.hablante } : {}), texto: actual.map((p) => p.texto).join(' '),
    });
    actual = [];
  };
  for (const p of palabras) {
    const ult = actual.at(-1);
    if (ult && (ult.unidad !== p.unidad || ult.hablante !== p.hablante)) cerrar();
    actual.push(p);
    if (/[.?!…]["»”)]?$/.test(p.texto) && actual.length > 1) cerrar();
  }
  cerrar();
  return out;
}

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------

function unir(tramos: Tramo[], hueco = 0): Tramo[] {
  const xs = [...tramos].filter((t) => t.t1 > t.t0).sort((a, b) => a.t0 - b.t0);
  const out: Tramo[] = [];
  for (const t of xs) {
    const u = out.at(-1);
    if (u && t.t0 <= u.t1 + hueco) u.t1 = Math.max(u.t1, t.t1);
    else out.push({ ...t });
  }
  return out;
}

/** a − b (tramos ordenados y sin solapes). */
function restar(a: Tramo[], b: Tramo[]): Tramo[] {
  const out: Tramo[] = [];
  for (const x of a) {
    let t = x.t0;
    for (const y of b) {
      if (y.t1 <= t || y.t0 >= x.t1) continue;
      if (y.t0 > t) out.push({ t0: t, t1: y.t0 });
      t = Math.max(t, y.t1);
    }
    if (t < x.t1) out.push({ t0: t, t1: x.t1 });
  }
  return out;
}

const longitud = (ts: Tramo[]) => ts.reduce((s, t) => s + t.t1 - t.t0, 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Lo que suena y no está transcrito. Con el mapa de actividad, los tramos con
 * sonido sin palabras a menos de `margen` s (de `minHueco` s o más); sin él, los
 * silencios de transcripción de más de `minSinActividad` s. Las palabras con el
 * tiempo roto marcan su unidad entera como hueco de `tiempos_rotos`.
 */
export function coberturaTranscripcion(
  unidades: UnidadMedio[],
  o: { duracion: number; actividad?: Array<[number, number]>; margen?: number; minHueco?: number; minSinActividad?: number; minRotas?: number },
): CoberturaTranscripcion {
  const margen = o.margen ?? 1.2;
  const palabras = palabrasDeUnidades(unidades);
  const validas = palabras.filter((p) => !esRota(p));
  const cubierto = unir(validas.map((p) => ({ t0: Math.max(0, p.t0 - margen), t1: Math.min(o.duracion, p.t1 + margen) })));
  const actividad = o.actividad ? unir(o.actividad.map(([t0, t1]) => ({ t0, t1 }))) : [{ t0: 0, t1: o.duracion }];
  const minHueco = o.actividad ? (o.minHueco ?? 3) : (o.minSinActividad ?? 25);
  const sinTexto = unir(restar(actividad, cubierto), 3).filter((t) => t.t1 - t.t0 >= minHueco);
  const huecos: Hueco[] = sinTexto.map((t) => ({ t0: r2(t.t0), t1: r2(t.t1), motivo: 'sin_texto', activo: r2(longitud(restar(actividad, [{ t0: 0, t1: t.t0 }, { t0: t.t1, t1: o.duracion }]))) }));
  // Tiempos rotos: unidades con varias palabras amontonadas en un instante.
  const minRotas = o.minRotas ?? 3;
  unidades.forEach((u, k) => {
    const ps = palabras.filter((p) => p.unidad === (u.orden ?? k));
    const rotas = ps.filter(esRota).length;
    if (rotas >= minRotas && rotas >= ps.length * 0.25) huecos.push({ t0: r2(u.t0), t1: r2(Math.max(u.t1, u.t0 + 1)), motivo: 'tiempos_rotos', activo: r2(u.t1 - u.t0) });
  });
  huecos.sort((a, b) => a.t0 - b.t0);
  return {
    activo: r2(longitud(actividad)), cubierto: r2(longitud(actividad) - longitud(restar(actividad, cubierto))),
    huecos, palabrasRotas: palabras.length - validas.length, palabras: palabras.length,
  };
}

// ---------------------------------------------------------------------------
// Transcribir un tramo viendo el proxy
// ---------------------------------------------------------------------------

const T = { type: 'string', description: 'Marca H:MM:SS.s contada desde el principio de la obra completa.' };

export const ESQUEMA_OIDO = {
  type: 'object',
  properties: {
    segmentos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          inicio: T, fin: T,
          hablante: { type: 'string', description: 'Nombre del reparto si se le reconoce por la voz o porque se le ve hablar; si no, una descripción breve. «Canción» para la letra de una canción.' },
          enCuadro: { type: 'boolean', description: 'Se le ve mover los labios en el plano mientras lo dice.' },
          texto: { type: 'string', description: 'Lo que se dice, literal, en su idioma.' },
        },
        required: ['inicio', 'fin', 'texto'],
      },
    },
  },
  required: ['segmentos'],
};

function lineaReparto(p: PersonaPercibida): string {
  const extra = [p.actor ? `interpretado por ${p.actor}` : '', p.descripcionVisual ?? '', p.voz ? `voz: ${p.voz}` : ''].filter(Boolean);
  return `- ${p.nombre}${extra.length ? `: ${extra.join('; ')}` : ''}`;
}

/** Transcribe lo que se dice en [t0, t1] mirando el proxy (marcas absolutas, hablante por voz e imagen). */
export async function transcribirConVideo(
  vidente: Vidente, fuente: FicheroModelo, tramo: Tramo,
  o: { reparto: PersonaPercibida[]; ficha?: string; idioma?: string; modelo?: string; contexto?: string },
): Promise<{ segmentos: SegmentoOido[]; mirada: Mirada }> {
  const texto = [
    o.ficha ? `Obra: ${o.ficha}.` : '',
    `Transcribe literalmente todo lo que se dice entre ${marca(tramo.t0)} y ${marca(tramo.t1)}, en su idioma, sin traducir ni resumir: una frase por segmento (como mucho unos ocho segundos), con marcas H:MM:SS.s contadas desde el principio de la obra completa.`,
    'Si se canta, transcribe la letra con hablante «Canción». Si en el tramo no se habla, devuelve una lista vacía. No inventes: si algo no se entiende, déjalo fuera.',
    o.reparto.length ? `Reparto conocido (usa estos nombres):\n${o.reparto.map(lineaReparto).join('\n')}` : '',
    o.contexto ? `Lo transcrito justo antes y después, para orientarte (no lo repitas):\n${o.contexto}` : '',
  ].filter(Boolean).join('\n\n');
  const m = await vidente.mirar({
    fuente, desde: tramo.t0, hasta: tramo.t1, sistema: 'Eres un transcriptor profesional de cine y vídeo: oyes cada palabra y ves quién habla.', texto,
    esquema: ESQUEMA_OIDO, temperatura: 0, maxTokens: 8192, ...(o.modelo ? { modelo: o.modelo } : {}),
  });
  if (m.json === undefined) throw new Error(`Salida cortada o JSON ilegible del modelo (${m.fin ?? '¿?'})`);
  const crudos = ((m.json as { segmentos?: unknown[] }).segmentos ?? []) as Array<Record<string, unknown>>;
  let segs = crudos.flatMap((s) => {
    const a = aSegundos(s.inicio), b = aSegundos(s.fin), tx = typeof s.texto === 'string' ? s.texto.trim() : '';
    if (!Number.isFinite(a) || !tx) return [];
    return [{ t0: a, t1: Number.isFinite(b) && b > a ? b : a + Math.max(0.6, tx.split(/\s+/).length * 0.35), texto: tx, ...(typeof s.hablante === 'string' && s.hablante.trim() ? { hablante: s.hablante.trim() } : {}), ...(typeof s.enCuadro === 'boolean' ? { enCuadro: s.enCuadro } : {}) }];
  });
  // Marcas desde el inicio del tramo: todas caben en su duración y el tramo empieza lejos del cero.
  const dur = tramo.t1 - tramo.t0;
  if (tramo.t0 > 30 && segs.length && segs.every((s) => s.t1 <= dur + 5) && segs.some((s) => s.t0 < tramo.t0 - 10)) segs = segs.map((s) => ({ ...s, t0: s.t0 + tramo.t0, t1: s.t1 + tramo.t0 }));
  segs = segs.filter((s) => s.t1 >= tramo.t0 - 1 && s.t0 <= tramo.t1 + 1).map((s) => ({ ...s, t0: r2(Math.max(tramo.t0, s.t0)), t1: r2(Math.min(tramo.t1, s.t1)) }));
  return { segmentos: segs.sort((a, b) => a.t0 - b.t0), mirada: m };
}

// ---------------------------------------------------------------------------
// Hablantes y tiempos por ventanas
// ---------------------------------------------------------------------------

export const ESQUEMA_HABLANTES = {
  type: 'object',
  properties: {
    frases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'Número de la frase.' },
          hablante: { type: 'string', description: 'Quién la dice de verdad (nombre del reparto o descripción breve).' },
          enCuadro: { type: 'string', enum: ['si', 'no', 'no_se_sabe'], description: '«si» si se le ve decirla (labios), «no» si habla fuera de cuadro.' },
          inicio: { ...T, description: 'Solo si la frase se dice a más de dos segundos de su marca: cuándo empieza de verdad (H:MM:SS.s desde el principio de la obra).' },
          noSeOye: { type: 'boolean', description: 'La frase no se dice en este fragmento.' },
        },
        required: ['n', 'hablante', 'enCuadro'],
      },
    },
  },
  required: ['frases'],
};

/** Revisa quién dice cada frase (y cuándo) en una ventana. Devuelve las correcciones. */
export async function revisarHablantesVentana(
  vidente: Vidente, fuente: FicheroModelo, v: Ventana, frases: FraseUbicada[],
  o: { reparto: PersonaPercibida[]; ficha?: string; modelo?: string; unificador: Unificador; documento?: string },
): Promise<{ correcciones: CorreccionTranscripcion[]; mirada: Mirada; crudo: unknown }> {
  const lineas = frases.map((f) => `[${f.n}] ${marca(f.t0)} ${f.hablante ?? '¿?'}: ${f.texto}`);
  const texto = [
    o.ficha ? `Obra: ${o.ficha}.` : '',
    `Fragmento de ${marca(v.t0)} a ${marca(v.t1)}. Abajo, las frases de la transcripción automática de este fragmento, numeradas, con su marca y el hablante que les puso la diarización (que a veces se equivoca).`,
    'Para cada frase, mirando y escuchando el vídeo: quién la dice de verdad (por la voz, por quién mueve los labios en el plano y por el sentido de la conversación), si se le ve decirla y, solo si su marca está desplazada más de dos segundos, cuándo empieza de verdad. Si una frase no se dice en el fragmento, márcala con «noSeOye».',
    o.reparto.length ? `Reparto:\n${o.reparto.map(lineaReparto).join('\n')}` : '',
    `Frases:\n${lineas.join('\n')}`,
  ].filter(Boolean).join('\n\n');
  const m = await vidente.mirar({
    fuente, desde: v.t0, hasta: v.t1, sistema: 'Eres un analista de cine que identifica quién dice cada frase de un diálogo.', texto,
    esquema: ESQUEMA_HABLANTES, temperatura: 0, maxTokens: 16_384, ...(o.modelo ? { modelo: o.modelo } : {}),
  });
  if (m.json === undefined) throw new Error(`Salida cortada o JSON ilegible del modelo (${m.fin ?? '¿?'})`);
  const porN = new Map(frases.map((f) => [f.n, f]));
  const correcciones: CorreccionTranscripcion[] = [];
  for (const r of ((m.json as { frases?: unknown[] }).frases ?? []) as Array<Record<string, unknown>>) {
    const f = porN.get(Number(r.n));
    if (!f || r.noSeOye === true || typeof r.hablante !== 'string' || !r.hablante.trim()) continue;
    const a = o.unificador.canonico(r.hablante);
    const de = f.hablante ? o.unificador.canonico(f.hablante) : undefined;
    const enCuadro = r.enCuadro === 'si' ? true : r.enCuadro === 'no' ? false : undefined;
    if (!de || normalNombre(a) !== normalNombre(de)) {
      correcciones.push({
        tipo: 'hablante', unidad: f.unidad, palabras: f.palabras, t0: f.t0, t1: f.t1, texto: f.texto, ...(f.hablante ? { de: f.hablante } : {}), a,
        ...(enCuadro !== undefined ? { enCuadro } : {}), confianza: enCuadro ? 0.9 : 0.7, fuente: m.modelo,
        ...(o.documento ? { evidencia: { documento: o.documento, ancla: { tipo: 'tiempo', t0: f.t0, t1: f.t1, hablante: a }, cita: f.texto, modo: 'video' } } : {}),
      });
    }
    const inicio = aSegundos(r.inicio);
    if (Number.isFinite(inicio) && Math.abs(inicio - f.t0) > 2 && inicio >= v.t0 - 1 && inicio <= v.t1 + 1) {
      correcciones.push({ tipo: 'desfase', unidad: f.unidad, palabras: f.palabras, texto: f.texto, de: r2(f.t0), a: r2(inicio), confianza: 0.7, fuente: m.modelo });
    }
  }
  return { correcciones, mirada: m, crudo: m.json };
}

// ---------------------------------------------------------------------------
// La revisión entera
// ---------------------------------------------------------------------------

export interface PuertosRevision {
  vidente: Vidente;
  fuente(opciones?: { renovar?: boolean }): Promise<FicheroModelo>;
  trabajo: AlmacenTrabajo;
  /** Reserva para los huecos: un transcriptor (Whisper) y el audio de un tramo. */
  reserva?: { transcriptor: Transcriptor; audio(t0: number, t1: number): Promise<{ bytes: Uint8Array; mime: string; desplazamiento: number } | null> };
  alProgreso?(p: { fase: 'huecos' | 'hablantes'; hechas: number; total: number; usd: number }): void | Promise<void>;
}

export interface OpcionesRevisionTranscripcion {
  documento: string;
  duracion: number;
  unidades: UnidadMedio[];
  /** Tramos con sonido en la banda de la voz (`proxy.voz.json`). Sin ellos, solo se ven los silencios largos. */
  actividad?: Array<[number, number]>;
  reparto?: PersonaPercibida[];
  ficha?: string;
  idioma?: string;
  /** Modelo de los huecos y de los hablantes (por defecto, el del vidente). */
  modelo?: string;
  modeloHablantes?: string;
  /** Subventanas de los huecos (75 s) y ventanas de los hablantes (480 s, solape 30 s). */
  subventana?: number;
  largo?: number;
  solape?: number;
  huecos?: boolean;
  hablantes?: boolean;
  concurrencia?: number;
  prefijoTrabajo?: string;
}

/** Las subventanas de los huecos: los cercanos se juntan, y cada trozo, de `max` s como mucho y con 2 s de margen. */
export function subventanasDe(huecos: Tramo[], duracion: number, max = 75): Tramo[] {
  const juntos = unir(huecos.map((h) => ({ t0: Math.max(0, h.t0 - 2), t1: Math.min(duracion, h.t1 + 2) })), 8);
  const out: Tramo[] = [];
  for (const h of juntos) {
    const n = Math.max(1, Math.ceil((h.t1 - h.t0) / max));
    const paso = (h.t1 - h.t0) / n;
    for (let k = 0; k < n; k++) out.push({ t0: r2(h.t0 + k * paso), t1: r2(h.t0 + (k + 1) * paso) });
  }
  return out;
}

const normal = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** ¿Este segmento ya está en la transcripción (mismas palabras, cerca en el tiempo)? */
function yaEsta(s: SegmentoOido, palabras: PalabraUbicada[]): boolean {
  const cerca = palabras.filter((p) => p.t1 >= s.t0 - 3 && p.t0 <= s.t1 + 3).map((p) => normal(p.texto)).join(' ');
  const ws = normal(s.texto).split(' ').filter((w) => w.length > 2);
  if (!ws.length) return true;
  return ws.filter((w) => cerca.includes(w)).length / ws.length >= 0.7;
}

export async function revisarTranscripcionConVideo(p: PuertosRevision, o: OpcionesRevisionTranscripcion): Promise<RevisionTranscripcion> {
  const turnos = turnosDe(o.unidades);
  const reparto = repartoInicial(o.reparto, hablantesDe(turnos)).slice(0, 30);
  const unificador = new Unificador(reparto);
  const modelo = o.modelo ?? p.vidente.nombre.replace(/^[^:]*:/, '');
  const modeloHablantes = o.modeloHablantes ?? modelo;
  const huella = (await sha256(JSON.stringify([VERSION_REVISION, modelo, modeloHablantes]))).slice(0, 12);
  const prefijo = `${o.prefijoTrabajo ?? 'revision/'}${huella}/`;
  const coste: CostePercepcion = { usd: 0, llamadas: 0, tokensEntrada: 0, tokensSalida: 0, ms: 0, grabadas: 0 };
  const avisos: string[] = [];
  const cobertura = coberturaTranscripcion(o.unidades, { duracion: o.duracion, ...(o.actividad ? { actividad: o.actividad } : {}) });
  const palabras = palabrasDeUnidades(o.unidades);
  const correcciones: CorreccionTranscripcion[] = [];

  let fichero: Promise<FicheroModelo> | null = null;
  const fuente = (renovar = false) => {
    if (!fichero || renovar) { fichero = p.fuente(renovar ? { renovar: true } : undefined); fichero.catch(() => { fichero = null; }); }
    return fichero;
  };
  const contar = (m: Mirada) => { coste.usd += m.usd ?? 0; coste.llamadas++; coste.tokensEntrada += m.tokensEntrada; coste.tokensSalida += m.tokensSalida; coste.ms += m.ms; };
  /** Una llamada grabada: si ya se hizo, se devuelve lo guardado. */
  async function grabada<T>(clave: string, fn: () => Promise<{ valor: T; mirada?: Mirada }>): Promise<T> {
    const g = await p.trabajo.leer(`${prefijo}${clave}`).catch(() => null);
    if (g) { try { coste.grabadas++; return (JSON.parse(g) as { valor: T }).valor; } catch { /* se repite */ } }
    let ultimo: unknown = null;
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await fn();
        if (r.mirada) contar(r.mirada);
        await p.trabajo.escribir(`${prefijo}${clave}`, JSON.stringify({ valor: r.valor, modelo: r.mirada?.modelo, usd: r.mirada?.usd ?? 0, fecha: new Date().toISOString() }));
        return r.valor;
      } catch (e) {
        ultimo = e;
        if (/HTTP (403|404)|NOT_FOUND|PERMISSION_DENIED/i.test(String((e as Error)?.message))) await fuente(true).catch(() => undefined);
      }
    }
    throw ultimo;
  }

  // 2. Huecos, en subventanas cortas. Las unidades con el tiempo roto se sustituyen por lo que se oye en su tramo.
  if (o.huecos !== false && cobertura.huecos.length) {
    const subs = subventanasDe(cobertura.huecos, o.duracion, o.subventana ?? 75);
    const oidos: Array<{ s: Tramo; segmentos: SegmentoOido[]; origen: string }> = [];
    let hechas = 0;
    await enParalelo(subs, o.concurrencia ?? 6, async (s) => {
      const contexto = turnos.filter((t) => t.t1 >= s.t0 - 15 && t.t0 <= s.t1 + 15).map((t) => `[${marca(t.t0)}] ${t.hablante ? `${t.hablante}: ` : ''}${t.texto}`).join('\n');
      try {
        const segmentos = await grabada(`hueco-${Math.round(s.t0 * 10)}-${Math.round(s.t1 * 10)}.json`, async () => {
          const r = await transcribirConVideo(p.vidente, await fuente(), s, { reparto, ...(o.ficha ? { ficha: o.ficha } : {}), ...(o.idioma ? { idioma: o.idioma } : {}), modelo, ...(contexto ? { contexto } : {}) });
          return { valor: r.segmentos, mirada: r.mirada };
        });
        oidos.push({ s, segmentos, origen: modelo });
      } catch (e) {
        // Reserva: Whisper con el audio del tramo.
        let hecho = false;
        if (p.reserva) {
          try {
            const audio = await p.reserva.audio(s.t0, s.t1);
            if (audio) {
              const t = await p.reserva.transcriptor.transcribir(audio, { ...(o.idioma ? { idioma: o.idioma } : {}) });
              oidos.push({ s, segmentos: segmentosDePalabras(t.palabras.filter((w) => w.t0 >= s.t0 - 0.5 && w.t1 <= s.t1 + 0.5)), origen: p.reserva.transcriptor.nombre });
              hecho = true;
            }
          } catch (e2) { e = e2; }
        }
        if (!hecho) avisos.push(`Hueco ${Math.round(s.t0)}-${Math.round(s.t1)} s sin transcribir: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      }
      await p.alProgreso?.({ fase: 'huecos', hechas: ++hechas, total: subs.length, usd: coste.usd });
    });
    const rotas = new Set(cobertura.huecos.filter((h) => h.motivo === 'tiempos_rotos').map((h) => palabras.find((w) => w.t0 >= h.t0 - 0.01 && w.t1 <= h.t1 + 0.01)?.unidad).filter((x): x is number => x !== undefined));
    const usados = new Set<SegmentoOido>();
    const canonico = (x: SegmentoOido) => ({ ...x, ...(x.hablante ? { hablante: unificador.canonico(x.hablante) } : {}) });
    // Unidades con el tiempo roto: se sustituyen por lo oído en su tramo, si se oyó algo.
    unidades: for (const orden of rotas) {
      const u = o.unidades.find((x, k) => (x.orden ?? k) === orden);
      if (!u) continue unidades;
      const dentro = oidos.flatMap((x) => x.segmentos.map((seg) => ({ seg, origen: x.origen }))).filter(({ seg }) => seg.t0 < u.t1 + 1 && seg.t1 > u.t0 - 1);
      if (!dentro.length) continue;
      for (const d of dentro) usados.add(d.seg);
      correcciones.push({ tipo: 'hueco', t0: r2(u.t0), t1: r2(u.t1), segmentos: dentro.map((d) => canonico(d.seg)).sort((a, b) => a.t0 - b.t0), reemplaza: [orden], fuente: dentro[0]!.origen, confianza: 0.8 });
    }
    // Lo demás: lo que no estaba.
    const validas = palabras.filter((w) => !esRota(w) && !rotas.has(w.unidad));
    for (const x of oidos.sort((a, b) => a.s.t0 - b.s.t0)) {
      const nuevos = x.segmentos.filter((seg) => !usados.has(seg) && !yaEsta(seg, validas));
      if (nuevos.length) correcciones.push({ tipo: 'hueco', t0: x.s.t0, t1: x.s.t1, segmentos: nuevos.map(canonico), fuente: x.origen, confianza: x.origen === modelo ? 0.85 : 0.75 });
    }
  }

  // 3. Hablantes y tiempos, por ventanas.
  if (o.hablantes !== false) {
    const frases = frasesUbicadas(palabras);
    const ventanas = ventanasDe(o.duracion, o.largo ?? 480, o.solape ?? 30);
    let hechas = 0;
    await enParalelo(ventanas, o.concurrencia ?? 4, async (v, k) => {
      const propias = frases.filter((f) => { const c = (f.t0 + f.t1) / 2; return c >= v.propioDesde && (c < v.propioHasta || k === ventanas.length - 1); });
      if (propias.length) {
        try {
          const cs = await grabada(`hablantes-${v.id}.json`, async () => {
            const r = await revisarHablantesVentana(p.vidente, await fuente(), v, propias, { reparto, ...(o.ficha ? { ficha: o.ficha } : {}), modelo: modeloHablantes, unificador, documento: o.documento });
            return { valor: r.correcciones, mirada: r.mirada };
          });
          correcciones.push(...cs);
        } catch (e) { avisos.push(`No se pudieron revisar los hablantes de ${Math.round(v.t0)}-${Math.round(v.t1)} s: ${String((e as Error)?.message ?? e).slice(0, 160)}`); }
      }
      await p.alProgreso?.({ fase: 'hablantes', hechas: ++hechas, total: ventanas.length, usd: coste.usd });
    });
  }

  correcciones.sort((a, b) => (('t0' in a ? a.t0 : a.de) - ('t0' in b ? b.t0 : b.de)));
  return { documento: o.documento, version: VERSION_REVISION, modelo: [...new Set([modelo, modeloHablantes])].join('+'), cobertura, correcciones, avisos, coste };
}

/** Palabras de un transcriptor → segmentos (se corta en pausas de más de 0,8 s o en cambio de hablante). */
export function segmentosDePalabras(ps: Array<{ texto: string; t0: number; t1: number; hablante?: string }>): SegmentoOido[] {
  const out: SegmentoOido[] = [];
  for (const w of ps) {
    const u = out.at(-1);
    if (u && w.t0 - u.t1 <= 0.8 && u.hablante === w.hablante && !/[.?!…]$/.test(u.texto)) { u.texto += ` ${w.texto}`; u.t1 = w.t1; }
    else out.push({ t0: w.t0, t1: w.t1, texto: w.texto, ...(w.hablante ? { hablante: w.hablante } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aplicar las correcciones
// ---------------------------------------------------------------------------

function compactas(ws: Array<{ t0: number; t1: number }>): PalabrasTiempo {
  const t0 = Math.min(...ws.map((w) => w.t0));
  const base = Math.round(t0 * 100);
  return { v: 1, t0: base / 100, cs: ws.flatMap((w) => [Math.max(0, Math.round(w.t0 * 100) - base), Math.max(0, Math.round((w.t1 - w.t0) * 100))]) };
}

function textoConMarcas(ws: Array<{ texto: string; hablante?: string }>): string {
  const partes: string[] = [];
  let actual: string | undefined;
  let linea: string[] = [];
  const algunHablante = ws.some((w) => w.hablante);
  const cerrar = () => { if (linea.length) partes.push(algunHablante && actual ? `**${actual}:** ${linea.join(' ')}` : linea.join(' ')); linea = []; };
  for (const w of ws) {
    if (w.hablante !== actual) { cerrar(); actual = w.hablante; }
    linea.push(w.texto);
  }
  cerrar();
  return partes.join('\n\n');
}

/** Reparte el tiempo de un segmento entre sus palabras según su longitud. */
function palabrasDeSegmento(s: SegmentoOido): Array<{ texto: string; t0: number; t1: number; hablante?: string }> {
  const ps = s.texto.split(/\s+/).filter(Boolean);
  const total = ps.reduce((n, p) => n + p.length + 1, 0);
  let t = s.t0;
  return ps.map((texto) => {
    const d = ((s.t1 - s.t0) * (texto.length + 1)) / total;
    const w = { texto, t0: r2(t), t1: r2(t + d), ...(s.hablante ? { hablante: s.hablante } : {}) };
    t += d;
    return w;
  });
}

/**
 * Aplica las correcciones a las unidades y devuelve las nuevas, en orden: los
 * hablantes cambian sus marcas «**Nombre:**», los desfases mueven las palabras y
 * cada hueco es una unidad nueva. Las unidades sin cambios salen tal cual.
 * Solo se aplican las de confianza ≥ `minConfianza` (0,7 por defecto).
 */
export function aplicarCorrecciones(unidades: UnidadMedio[], correcciones: CorreccionTranscripcion[], opciones: { minConfianza?: number } = {}): UnidadMedio[] {
  const min = opciones.minConfianza ?? 0.7;
  const validas = correcciones.filter((c) => c.confianza >= min);
  const reemplazadas = new Set(validas.flatMap((c) => (c.tipo === 'hueco' ? c.reemplaza ?? [] : [])));
  const out: UnidadMedio[] = unidades.filter((u, k) => !reemplazadas.has(u.orden ?? k)).map((u) => {
    const orden = u.orden ?? unidades.indexOf(u);
    const propias = validas.filter((c) => c.tipo !== 'hueco' && c.unidad === orden);
    if (!propias.length) return u;
    const ws = palabrasDeUnidad(u, orden).map((w) => ({ ...w }));
    for (const c of propias) {
      if (c.tipo === 'hueco') continue;
      const [a, b] = c.palabras;
      for (const w of ws.slice(a, b)) {
        if (c.tipo === 'hablante') w.hablante = c.a;
        else { const d = c.a - c.de; w.t0 = r2(w.t0 + d); w.t1 = r2(w.t1 + d); }
      }
    }
    if (!ws.length) return u;
    const texto = propias.some((c) => c.tipo === 'hablante') ? textoConMarcas(ws) : u.texto;
    const t0 = Math.min(...ws.map((w) => w.t0)), t1 = Math.max(...ws.map((w) => w.t1));
    const hablante = ws.at(-1)?.hablante ?? u.hablante;
    return { ...u, texto, t0: r2(Math.min(t0, propias.some((c) => c.tipo === 'desfase') ? t0 : u.t0)), t1: r2(Math.max(t1, propias.some((c) => c.tipo === 'desfase') ? t1 : u.t1)), ...(hablante ? { hablante } : {}), palabras: compactas(ws) };
  });
  // Lo que ya está (también tras mover un desfase) no se añade dos veces.
  const yaPuestas = out.flatMap((u, k) => palabrasDeUnidad(u, u.orden ?? k));
  for (const c of validas) {
    if (c.tipo !== 'hueco' || !c.segmentos.length) continue;
    const ws = c.segmentos.filter((s) => c.reemplaza?.length || !yaEsta(s, yaPuestas)).flatMap(palabrasDeSegmento);
    if (!ws.length) continue;
    out.push({ texto: textoConMarcas(ws), t0: r2(ws[0]!.t0), t1: r2(ws.at(-1)!.t1), ...(ws.at(-1)?.hablante ? { hablante: ws.at(-1)!.hablante! } : {}), palabras: compactas(ws) });
  }
  return out.sort((a, b) => a.t0 - b.t0).map((u, i) => ({ ...u, orden: i }));
}

/**
 * Pone en las frases clave de una percepción el hablante de la transcripción
 * revisada: cada frase se casa con la frase de la transcripción más parecida a
 * menos de 4 s. Sirve para una percepción hecha antes de revisar la
 * transcripción (sus hablantes venían de las etiquetas equivocadas).
 */
export function hablantesDeDialogos(p: PercepcionMedio, unidades: UnidadMedio[]): { percepcion: PercepcionMedio; cambios: number } {
  const frases = frasesUbicadas(palabrasDeUnidades(unidades)).filter((f) => f.hablante);
  const u = new Unificador(p.reparto);
  const parecido = (a: string, b: string) => {
    const x = normal(a).split(' ').filter((w) => w.length > 2), y = new Set(normal(b).split(' '));
    return x.length ? x.filter((w) => y.has(w)).length / x.length : 0;
  };
  let cambios = 0;
  const escenas = p.escenas.map((e) => ({
    ...e,
    dialogoClave: e.dialogoClave.map((d) => {
      // La frase clave puede abarcar varias frases de la transcripción: se busca la que más se le parece.
      let mejor: FraseUbicada | null = null, nota = 0;
      for (const f of frases) {
        if (f.t1 < d.t - 4 || f.t0 > d.t + 6) continue;
        const n = Math.max(parecido(d.texto, f.texto), parecido(f.texto, d.texto) * 0.9);
        if (n > nota) { nota = n; mejor = f; }
      }
      if (!mejor || nota < 0.6) return d;
      const h = u.canonico(mejor.hablante!);
      if (d.hablante && normalNombre(d.hablante) === normalNombre(h)) return d;
      cambios++;
      return { ...d, hablante: h };
    }),
  }));
  return { percepcion: { ...p, escenas }, cambios };
}
