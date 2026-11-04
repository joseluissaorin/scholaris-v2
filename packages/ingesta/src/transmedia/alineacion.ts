/**
 * Alineación de una relación (docs/COMPRENSION.md, «Relaciones y alineaciones»):
 *
 * 1. Gruesa: los segmentos de una obra frente a los de la otra (escenas de la
 *    película ↔ escenas del cuento), con lo que se añade y lo que se suprime.
 * 2. Fina: dentro de cada correspondencia gruesa, pasaje ↔ pasaje (un diálogo, una
 *    descripción, un plano) con el ancla material de los dos lados: caracteres en
 *    el texto; tramo, instante y región en el vídeo.
 *
 * Cada correspondencia lleva su tipo (equivalente, traducido, condensado,
 * ampliado, transformado, reordenado, añadido, suprimido, alusión) y una nota
 * analítica de qué cambia y con qué efecto, con el vocabulario de los estudios de
 * adaptación o de traducción. Las citas se comprueban contra el material: lo que
 * no está no se guarda como prueba. Nunca se afirma una ausencia a partir de un
 * hueco de la transcripción.
 *
 * El lado A es siempre el origen de la relación (la obra derivada: la película,
 * la traducción) y el B, el destino (la obra de partida).
 *
 * Memoria acotada: la gruesa trabaja con la estructura, los resúmenes y la ficha
 * global de las dos obras; cada grupo fino, con el texto de sus segmentos (cargado
 * en un tramo) y la percepción condensada de sus escenas. Nunca las dos obras enteras.
 */
import type { Alineacion, LadoAlineacion, Region, Relacion, Segmento, TipoCorrespondencia } from '@scholaris/nucleo';
import { anclarReferencia } from '../comprension/anclaje.js';
import type { Material } from '../comprension/material.js';
import { llamar } from '../comprension/modelo.js';
import type { ModeloComprension, UsoModelo } from '../comprension/tipos.js';
import { posicion } from '../comprension/util.js';
import { cabeceraObra, cobertura, idCortoDe, limpiarMarcas, textoMarcado, type MaterialObra } from './material.js';
import { normalizar, rotulo } from './obras.js';
import type { AlineacionModelo, CorrespondenciaGruesa, LadoModelo } from './tipos.js';

export const TIPOS_CORRESPONDENCIA: readonly TipoCorrespondencia[] = ['equivalente', 'traducido', 'condensado', 'ampliado', 'transformado', 'reordenado', 'anadido', 'suprimido', 'alusion'];

const tiempo = (x: number) => {
  const s = Math.floor(x), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Instrucciones
// ---------------------------------------------------------------------------

const VOCABULARIO: Partial<Record<Relacion['tipo'], string>> = {
  adaptacion_de: `Vocabulario de los estudios de adaptación (Genette, Hutcheon, Stam, Sánchez Noriega, Wolf): transposición, hipotexto e hipertexto, condensación y amplificación, supresión, adición, desplazamiento, fusión y desdoblamiento de personajes, transfocalización (cambio del punto de vista), transmotivación (cambio de los motivos), transvalorización (cambio de los valores), transposición diegética (de tiempo o de lugar), dramatización de lo narrado, visualización de lo que el texto cuenta, paso del discurso narrativo (narrador, estilo indirecto, monólogo interior) a la imagen, al diálogo y a la voz en off, y equivalencias medio a medio (lo que la prosa hace con la palabra y la película con el encuadre, el montaje o el sonido). Para el lado audiovisual, el análisis fílmico: escala de plano, angulación, movimiento, composición y quién domina el encuadre, montaje (plano y contraplano, elipsis, raccord), sonido diegético o extradiegético.`,
  version_de: `Vocabulario de la crítica textual y de los estudios de reescritura: variante, refundición, ampliación, supresión, desplazamiento, cambio de final, cambio de punto de vista.`,
  traduccion_de: `Vocabulario de los estudios de traducción (Vinay y Darbelnet, Venuti, Berman, Newmark): traducción literal, transposición (cambio de categoría gramatical), modulación (cambio de punto de vista), equivalencia, adaptación cultural, préstamo y calco, compensación, explicitación e implicitación, omisión y adición, domesticación y extranjerización, ennoblecimiento, empobrecimiento cualitativo o cuantitativo, destrucción de ritmos, de redes significantes o de los vernáculos.`,
  edicion_de: `Vocabulario de la crítica textual y la ecdótica: variante, lección, enmienda, errata, adición o supresión de autor o de editor, cambio de puntuación o de grafía, reordenación, paratexto.`,
};

const TIPOS_EXPLICADOS = `Tipos de correspondencia (A es la obra derivada; B, la de partida):
- equivalente: A conserva lo de B casi tal cual (en otro medio, con los mismos hechos o las mismas palabras).
- traducido: A dice lo mismo que B en otra lengua (solo en traducciones).
- condensado: A reduce o resume lo de B.
- ampliado: A desarrolla lo que en B es breve o solo se menciona.
- transformado: A cambia lo de B (otro objeto, otro sentido, otro personaje, otro desenlace).
- reordenado: A lo pone en otro lugar de la secuencia.
- anadido: está en A y no en B (lado b vacío).
- suprimido: está en B y no en A (lado a vacío).
- alusion: A alude a B de forma indirecta (una cita, un guiño).`;

function sistema(rel: Relacion, a: MaterialObra, b: MaterialObra, tarea: string): string {
  return `Eres un especialista en literatura comparada y en estudios de adaptación y de traducción. Comparas dos obras de una biblioteca académica que cita con página y segundo exactos: ${rotulo(a.o)} (obra A, la derivada) y ${rotulo(b.o)} (obra B, la de partida). Relación: A ${rel.tipo.replace('_de', ' de').replace('_', ' ')} B.

Material: de cada obra llegan su ficha, su estructura con el resumen de cada segmento y, cuando hace falta, el texto de unos segmentos, troceado en unidades citables. Las de A van marcadas «⟦A12 · …⟧» y las de B «⟦B3 · …⟧»; el número tras la letra es el que pones en «u». Los segmentos tienen ids cortos («a52», «b3»).

${TIPOS_EXPLICADOS}

${VOCABULARIO[rel.tipo] ?? VOCABULARIO.adaptacion_de!}

Anclaje (obligatorio):
- Cada lado lleva su prueba. En un texto: «u» y una «cita» LITERAL copiada carácter a carácter de esa unidad (de 4 a 30 palabras), sin puntos suspensivos ni arreglos; si el pasaje es largo, añade «u_fin» y «cita_fin» con las últimas palabras. En un medio: si hay diálogo, «u» y «cita» literal de la transcripción; si lo que corresponde es visual o sonoro, «t0» y «t1» en segundos (dentro de la escena), «t» con el instante más significativo y «que» con lo que se ve u oye (plano, encuadre, objeto, gesto, música), tomado de la percepción.
- No cites lo que no está. No inventes segundos fuera de las escenas indicadas.
- Ausencias: en un texto completo se pueden afirmar. En un medio, una ausencia de diálogo solo se afirma si la transcripción de ese tramo está completa; si hay huecos, lo que no está en la transcripción puede estar en la película. Lo visual se juzga por la percepción.
- Las marcas «⟦A12 · …⟧» no van en las notas: si hace falta, el localizador humano («p. 14», «1:02:03»).

Notas: en español impecable (tildes, eñes, ¿ y ¡ de apertura), registro académico, de una a tres frases: qué cambia y con qué efecto (no repitas el contenido de los dos lados). Incisos con comas o paréntesis; la raya, si se usa, a la española (pegada al inciso: —así—), nunca con espacios a los dos lados. Sin emojis ni markdown.

Tarea: ${tarea}`;
}

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const LADO = {
  type: 'object',
  properties: {
    u: { type: 'integer', description: 'Unidad (el número tras la letra).' },
    cita: { type: 'string', description: 'Cita literal de esa unidad (4-30 palabras).' },
    u_fin: { type: 'integer' },
    cita_fin: { type: 'string', description: 'Últimas palabras literales del pasaje, si es largo.' },
    t0: { type: 'number', description: 'En un medio, inicio del tramo en segundos.' },
    t1: { type: 'number' },
    t: { type: 'number', description: 'Instante más significativo.' },
    que: { type: 'string', description: 'Lo que se ve u oye, si no hay diálogo que citar.' },
  },
};

export const ESQUEMA_GRUESA = {
  type: 'object',
  properties: {
    correspondencias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          a: { type: 'array', items: { type: 'string' }, description: 'Ids de los segmentos de A (vacío si se suprime).' },
          b: { type: 'array', items: { type: 'string' }, description: 'Ids de los segmentos de B (vacío si se añade).' },
          tipo: { type: 'string', enum: [...TIPOS_CORRESPONDENCIA] },
          nota: { type: 'string', description: 'Qué cambia y con qué efecto (una o dos frases).' },
          confianza: { type: 'number' },
        },
        required: ['a', 'b', 'tipo', 'nota', 'confianza'],
      },
    },
  },
  required: ['correspondencias'],
};

export const ESQUEMA_FINA = {
  type: 'object',
  properties: {
    alineaciones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: [...TIPOS_CORRESPONDENCIA] },
          a: LADO,
          b: LADO,
          nota: { type: 'string' },
          confianza: { type: 'number' },
        },
        required: ['tipo', 'nota', 'confianza'],
      },
    },
  },
  required: ['alineaciones'],
};

// ---------------------------------------------------------------------------
// La cabecera común (lo estable va delante: la caché implícita lo aprovecha)
// ---------------------------------------------------------------------------

/** Lo que va delante en todas las llamadas de una relación: las dos cabeceras (sin el texto de las obras). */
export function prefijoRelacion(rel: Relacion, a: MaterialObra, b: MaterialObra, o: { global?: boolean } = {}): { texto: string } {
  return { texto: [`Relación: ${rotulo(a.o)} (A) ${rel.tipo} ${rotulo(b.o)} (B).${rel.nota ? ` ${rel.nota}` : ''}`, cabeceraObra(a, o), cabeceraObra(b, o)].join('\n\n') };
}

// ---------------------------------------------------------------------------
// Gruesa
// ---------------------------------------------------------------------------

export async function alineacionGruesa(
  rel: Relacion, a: MaterialObra, b: MaterialObra, modelo: ModeloComprension, acumulado: { uso: UsoModelo }, o: { prefijo: string; calidad: 'alta' | 'rapida'; limiteMs?: number },
): Promise<CorrespondenciaGruesa[]> {
  const r = await llamar<{ correspondencias: Array<{ a?: string[]; b?: string[]; tipo: TipoCorrespondencia; nota: string; confianza?: number }> }>(modelo, {
    sistema: sistema(rel, a, b, `alineación gruesa. Con la estructura de las dos obras, el resumen de cada segmento, sus fichas globales y la percepción escena a escena, di qué segmentos de A corresponden a qué segmentos de B. Cada segmento narrativo de A y de B tiene que aparecer al menos una vez: si no tiene correspondencia, va solo (añadido o suprimido). Un segmento puede corresponder a varios del otro lado (una escena que condensa dos capítulos, un capítulo repartido en tres escenas, un pasaje que la otra obra lleva a otro lugar). Los paratextos (portada, créditos, colofón) no se alinean. La nota dice qué cambia y con qué efecto.`),
    partes: [{ texto: o.prefijo }, { texto: 'Haz la alineación gruesa con los ids de los segmentos. Responde solo con el JSON.' }],
    esquema: ESQUEMA_GRUESA, calidad: o.calidad, maxTokens: 24_000, operacion: 'transmedia:gruesa', ...(o.limiteMs ? { limiteMs: o.limiteMs } : {}),
  }, acumulado);
  const ida = new Set(a.hojas.map((s) => idCortoDe('A', s))), idb = new Set(b.hojas.map((s) => idCortoDe('B', s)));
  const salida: CorrespondenciaGruesa[] = [];
  for (const c of r.correspondencias ?? []) {
    const xa = (c.a ?? []).map((x) => x.trim().toLowerCase()).filter((x) => ida.has(x));
    const xb = (c.b ?? []).map((x) => x.trim().toLowerCase()).filter((x) => idb.has(x));
    if (!xa.length && !xb.length) continue;
    let tipo: TipoCorrespondencia = TIPOS_CORRESPONDENCIA.includes(c.tipo) ? c.tipo : 'transformado';
    if (!xb.length) tipo = 'anadido';
    else if (!xa.length) tipo = 'suprimido';
    else if (tipo === 'anadido' || tipo === 'suprimido') tipo = 'transformado';
    salida.push({ a: xa, b: xb, tipo, nota: limpiarMarcas(c.nota ?? '', a, b), confianza: Math.max(0, Math.min(1, c.confianza ?? 0.7)) });
  }
  return salida;
}

/** Sin modelo: la correspondencia gruesa por orden y proporción (las dos obras en paralelo). */
export function alineacionGruesaProporcional(a: MaterialObra, b: MaterialObra): CorrespondenciaGruesa[] {
  const pos = (mo: MaterialObra) => {
    const total = Math.max(1, mo.indice.length);
    return mo.hojas.map((s) => ({ s, x: ((mo.porId.get(s.unidadDesde)?.orden ?? 0) + (mo.porId.get(s.unidadHasta)?.orden ?? 0)) / 2 / total }));
  };
  const pa = pos(a), pb = pos(b);
  const salida: CorrespondenciaGruesa[] = [];
  for (const y of pb) {
    const cerca = [...pa].sort((p, q) => Math.abs(p.x - y.x) - Math.abs(q.x - y.x))[0];
    if (cerca) salida.push({ a: [idCortoDe('A', cerca.s)], b: [idCortoDe('B', y.s)], tipo: 'equivalente', nota: 'Correspondencia aproximada por la posición en las dos obras (sin modelo).', confianza: 0.3 });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Anclar un lado
// ---------------------------------------------------------------------------

/** El tramo (en segundos) de un segmento de un medio. */
function tramoDe(s: Segmento): [number, number] | null {
  if (s.ancla.tipo !== 'tiempo') return null;
  return [s.ancla.t0, s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1];
}

/** La región de quien (o lo que) nombra «que» en el plano percibido del instante `t`. */
function regionEn(mo: MaterialObra, t: number, que: string): { region: Region; instante: number } | null {
  if (!que) return null;
  const plano = mo.planos.find((p) => p.t0 <= t && t < p.t1);
  if (!plano) return null;
  const q = ` ${normalizar(que)} `;
  // Gana quien (o lo que) tenga más palabras de su nombre en la descripción: «la copa de helado de Diego» es la copa.
  let mejor: { loc: (typeof plano.locs)[number]; puntos: number } | null = null;
  for (const loc of plano.locs) {
    const puntos = normalizar(loc.nombre).split(' ').filter((w) => w.length >= 3 && q.includes(` ${w} `)).length;
    if (puntos && (!mejor || puntos > mejor.puntos)) mejor = { loc, puntos };
  }
  return mejor ? { region: mejor.loc.region, instante: mejor.loc.instante ?? t } : null;
}

/** El segmento más hondo (sin planos) que contiene una posición de texto o un instante. */
export function segmentoEn(mo: MaterialObra, ancla: LadoAlineacion['ancla'], unidad?: string): string | undefined {
  if (mo.provisionales) return undefined;
  const hondos = [...mo.segmentos].sort((x, y) => y.nivel - x.nivel);
  if (ancla.tipo === 'tiempo') {
    const t = ancla.instante ?? ancla.t0;
    return hondos.find((s) => { const r = tramoDe(s); return r && r[0] <= t && t < r[1]; })?.id;
  }
  const u = unidad ? mo.porId.get(unidad) : undefined;
  if (!u) return undefined;
  const p = posicion(u.orden, ancla.caracteres?.[0] ?? 0);
  return hondos.find((s) => {
    const d = mo.porId.get(s.unidadDesde)?.orden ?? 0, h = mo.porId.get(s.unidadHasta)?.orden ?? d;
    return posicion(d, s.ancla.caracteres?.[0] ?? 0) <= p && p < posicion(h, s.anclaFin?.caracteres?.[1] ?? 9e6);
  })?.id;
}

export interface LadoAnclado {
  lado: LadoAlineacion;
  /** La prueba es la cita literal encontrada (o el tramo validado), no el segmento de reserva. */
  exacto: boolean;
  /** Lo que dice o muestra ese lado (la cita literal o lo que se ve), para la ficha de la relación. */
  literal?: string;
}

/** El lado de la alineación a partir de lo que dijo el modelo; si no se puede anclar, null. `m` es el tramo cargado. */
export function anclarLado(mo: MaterialObra, m: Material, l: LadoModelo | undefined, segmentosDelGrupo: readonly Segmento[]): LadoAnclado | null {
  if (!l) return null;
  const documento = mo.documento.id;
  if (l.cita?.trim()) {
    const ev = anclarReferencia(m, { ...(l.u !== undefined ? { u: l.u } : {}), cita: l.cita });
    if (ev) {
      const lado: LadoAlineacion = { documento, ancla: ev.ancla };
      if (l.cita_fin?.trim()) {
        const fin = anclarReferencia(m, { u: l.u_fin ?? l.u ?? 0, cita: l.cita_fin });
        const u0 = mo.porId.get(ev.unidad ?? '')?.orden ?? 0, u1 = mo.porId.get(fin?.unidad ?? '')?.orden ?? -1;
        if (fin && (u1 > u0 || (u1 === u0 && (fin.ancla.caracteres?.[0] ?? 0) >= (ev.ancla.caracteres?.[1] ?? 0)))) lado.anclaFin = fin.ancla;
      }
      if (lado.ancla.tipo === 'tiempo' && typeof l.t === 'number' && l.t >= lado.ancla.t0 - 2 && l.t <= lado.ancla.t1 + 2) lado.ancla = { ...lado.ancla, instante: l.t };
      const seg = segmentoEn(mo, lado.ancla, ev.unidad);
      if (seg) lado.segmento = seg;
      return { lado, exacto: true, ...(ev.cita ? { literal: ev.cita.slice(0, 300) } : {}) };
    }
  }
  if (mo.medio && typeof l.t0 === 'number') {
    const dur = mo.documento.duracion ?? Number.MAX_SAFE_INTEGER;
    let t0 = Math.max(0, l.t0), t1 = Math.min(dur, typeof l.t1 === 'number' && l.t1 > t0 ? l.t1 : t0 + 4);
    // Un tramo fuera de las escenas del grupo (con margen) no se cree: se recorta a la escena que toca o se descarta.
    const tramos = segmentosDelGrupo.map(tramoDe).filter((x): x is [number, number] => !!x);
    if (tramos.length) {
      const toca = tramos.find(([x, y]) => t0 < y + 20 && t1 > x - 20);
      if (!toca) return null;
      t0 = Math.max(t0, toca[0] - 20); t1 = Math.min(t1, toca[1] + 20);
    }
    const instante = typeof l.t === 'number' && l.t >= t0 && l.t <= t1 ? l.t : (t0 + t1) / 2;
    const r = regionEn(mo, instante, l.que ?? '');
    const ancla: LadoAlineacion['ancla'] = { tipo: 'tiempo', t0: Math.round(t0 * 10) / 10, t1: Math.round(t1 * 10) / 10, instante: Math.round((r?.instante ?? instante) * 10) / 10, ...(r ? { region: r.region } : {}) };
    const lado: LadoAlineacion = { documento, ancla };
    const seg = segmentoEn(mo, ancla);
    if (seg) lado.segmento = seg;
    return { lado, exacto: true, ...(l.que ? { literal: `(lo que se ve) ${l.que.slice(0, 280)}` } : {}) };
  }
  if (typeof l.u === 'number' && mo.porOrden.has(l.u) && !l.cita?.trim()) {
    const u = mo.porOrden.get(l.u)!;
    const lado: LadoAlineacion = { documento, ancla: u.ancla };
    const seg = segmentoEn(mo, u.ancla, u.id);
    if (seg) lado.segmento = seg;
    return { lado, exacto: false };
  }
  return null;
}

/** El lado de un grupo de segmentos (alineación gruesa o reserva de una fina que no se pudo anclar). */
export function ladoDeSegmentos(mo: MaterialObra, segs: readonly Segmento[]): LadoAlineacion | undefined {
  if (!segs.length) return undefined;
  const orden = [...segs].sort((x, y) => x.orden - y.orden);
  const a = orden[0]!, z = orden.at(-1)!;
  const lado: LadoAlineacion = { documento: mo.documento.id, ancla: a.ancla };
  const fin = z.anclaFin ?? z.ancla;
  if (a.ancla.tipo === 'tiempo' && fin.tipo === 'tiempo') lado.ancla = { ...a.ancla, t1: fin.t1 };
  else if (z !== a || z.anclaFin) lado.anclaFin = fin;
  if (!mo.provisionales && segs.length === 1) lado.segmento = a.id;
  return lado;
}

// ---------------------------------------------------------------------------
// Fina
// ---------------------------------------------------------------------------

/** Un grupo para la alineación fina: unos segmentos de B y los de A que les corresponden. */
export interface GrupoFino {
  /** Clave estable (de los ids de sus segmentos): con ella se guarda y se reanuda. */
  clave: string;
  b: Segmento[];
  a: Segmento[];
  gruesas: CorrespondenciaGruesa[];
}

const caracteresDe = (mo: MaterialObra, s: Segmento) => {
  if (mo.medio && s.ancla.tipo === 'tiempo') {
    const [t0, t1] = tramoDe(s)!;
    return mo.indice.filter((u) => u.t0 !== undefined && u.t1 !== undefined && u.t0 < t1 && u.t1 > t0).reduce((t, u) => t + u.largo, 0);
  }
  const d = mo.porId.get(s.unidadDesde)?.orden ?? 0, h = mo.porId.get(s.unidadHasta)?.orden ?? d;
  return mo.indice.filter((u) => u.orden >= d && u.orden <= h).reduce((t, u) => t + u.largo, 0);
};

/**
 * Agrupa las correspondencias gruesas por los segmentos de B (los de A se suman),
 * juntando los pequeños y partiendo los que traen demasiado texto de A: ningún grupo
 * pasa de unos `maxCaracteres` de material (memoria y tamaño de la llamada acotados).
 */
export function gruposFinos(a: MaterialObra, b: MaterialObra, gruesas: readonly CorrespondenciaGruesa[], o: { maxCaracteres?: number; maxA?: number } = {}): GrupoFino[] {
  const porA = new Map(a.hojas.map((s) => [idCortoDe('A', s), s]));
  const porB = new Map(b.hojas.map((s) => [idCortoDe('B', s), s]));
  const grupos = new Map<string, Omit<GrupoFino, 'clave'>>();
  for (const c of gruesas) {
    if (!c.a.length || !c.b.length) continue;
    for (const idb of c.b) {
      const sb = porB.get(idb);
      if (!sb) continue;
      const g = grupos.get(sb.id) ?? { b: [sb], a: [], gruesas: [] };
      for (const ida of c.a) { const sa = porA.get(ida); if (sa && !g.a.includes(sa)) g.a.push(sa); }
      g.gruesas.push(c);
      grupos.set(sb.id, g);
    }
  }
  const max = o.maxCaracteres ?? 9000, maxA = o.maxA ?? 40_000;
  const ordenados = [...grupos.values()].sort((x, y) => x.b[0]!.orden - y.b[0]!.orden);
  const juntos: Array<Omit<GrupoFino, 'clave'>> = [];
  const pesoB = (x: Omit<GrupoFino, 'clave'>) => x.b.reduce((t, s) => t + caracteresDe(b, s), 0);
  const pesoA = (x: Omit<GrupoFino, 'clave'>) => x.a.reduce((t, s) => t + caracteresDe(a, s), 0);
  for (const g of ordenados) {
    const ultimo = juntos.at(-1);
    if (ultimo && pesoB(ultimo) + pesoB(g) <= max && pesoA(ultimo) + pesoA(g) <= maxA && ultimo.a.length + g.a.length <= 8) {
      ultimo.b.push(...g.b);
      for (const s of g.a) if (!ultimo.a.includes(s)) ultimo.a.push(s);
      ultimo.gruesas.push(...g.gruesas);
    } else juntos.push({ b: [...g.b], a: [...g.a], gruesas: [...g.gruesas] });
  }
  // Un segmento de B con demasiado material de A se parte: los de A, en tandas.
  const salida: GrupoFino[] = [];
  for (const g of juntos) {
    g.a.sort((x, y) => x.orden - y.orden);
    const tandas: Segmento[][] = [[]];
    let peso = 0;
    for (const s of g.a) {
      const p = caracteresDe(a, s);
      if (tandas.at(-1)!.length && peso + p > maxA) { tandas.push([]); peso = 0; }
      tandas.at(-1)!.push(s); peso += p;
    }
    for (const t of tandas) {
      const ids = new Set(t.map((s) => idCortoDe('A', s)));
      const gr = g.gruesas.filter((c) => c.a.some((x) => ids.has(x)));
      salida.push({ clave: [...g.b.map((s) => idCortoDe('B', s)), ...t.map((s) => idCortoDe('A', s))].join('-'), b: g.b, a: t, gruesas: gr.length ? gr : g.gruesas });
    }
  }
  return salida;
}

/** Lo que el modelo necesita de un grupo: el texto de sus segmentos, la percepción detallada y la cobertura de cada escena. */
function detalleGrupo(a: MaterialObra, b: MaterialObra, g: GrupoFino, ta: Material, tb: Material): string {
  const partes: string[] = [];
  const orden = (mo: MaterialObra, id: string) => mo.porId.get(id)?.orden ?? 0;
  partes.push(`Segmentos de B: ${g.b.map((s) => `${idCortoDe('B', s)} «${s.titulo}» (B${orden(b, s.unidadDesde)}-B${orden(b, s.unidadHasta)})`).join('; ')}.`);
  partes.push(`Segmentos de A que les corresponden: ${g.a.map((s) => `${idCortoDe('A', s)} «${s.titulo}»${s.ancla.tipo === 'tiempo' ? ` [${tiempo(s.ancla.t0)}-${tiempo(s.ancla.t1)}, ${Math.round(s.ancla.t0)}-${Math.round(s.ancla.t1)} s]` : ''} (A${orden(a, s.unidadDesde)}-A${orden(a, s.unidadHasta)})`).join('; ')}.`);
  partes.push(`Correspondencias gruesas que hay que detallar:\n${g.gruesas.map((c) => `- ${c.a.join(', ')} ↔ ${c.b.join(', ')} (${c.tipo}): ${c.nota}`).join('\n')}`);
  partes.push(`Texto de B (${g.b.map((s) => idCortoDe('B', s)).join(', ')}):\n${textoMarcado(b, tb)}`);
  partes.push(`Texto de A (${g.a.map((s) => idCortoDe('A', s)).join(', ')}):\n${textoMarcado(a, ta)}`);
  for (const [mo, segs] of [[a, g.a], [b, g.b]] as const) {
    const tramos = segs.map(tramoDe).filter((x): x is [number, number] => !!x);
    for (const e of mo.escenas) if (tramos.some(([x, y]) => e.t0 < y && e.t1 > x)) partes.push(`Percepción detallada de ${mo.letra}:\n${e.detalle}`);
    for (const s of segs) {
      const r = tramoDe(s);
      if (!r || !mo.medio) continue;
      const c = cobertura(mo, r[0], r[1]);
      if (c.cobertura < 0.9) partes.push(`Transcripción de ${idCortoDe(mo.letra, s)}: ${Math.round(c.cobertura * 100)} %${c.huecos.length ? ` (sin transcripción: ${c.huecos.map(([x, y]) => `${tiempo(x)}-${tiempo(y)}`).join(', ')})` : ''}. No afirmes que ahí falta un diálogo.`);
    }
  }
  return partes.join('\n\n');
}

/** Los segmentos de `destino` que la alineación gruesa del grupo pone frente al segmento donde cae `lado` (o todos los del grupo). */
function correspondientes(lado: LadoAlineacion | undefined, origen: MaterialObra, destino: MaterialObra, g: GrupoFino): Segmento[] {
  const todos = destino.letra === 'A' ? g.a : g.b;
  if (!lado?.segmento) return todos;
  const hoja = origen.hojas.find((s) => s.id === lado.segmento);
  if (!hoja) return todos;
  const corto = idCortoDe(origen.letra, hoja);
  const ids = new Set(g.gruesas.filter((c) => (origen.letra === 'A' ? c.a : c.b).includes(corto)).flatMap((c) => (destino.letra === 'A' ? c.a : c.b)));
  const segs = todos.filter((s) => ids.has(idCortoDe(destino.letra, s)));
  return segs.length ? segs : todos;
}

/** Una alineación fina antes de ponerle id y orden, con lo literal de cada lado (para la ficha de la relación). */
export type AlineacionSinId = Omit<Alineacion, 'id' | 'relacion' | 'orden'> & { literales?: { a?: string; b?: string } };

export interface ResultadoFino {
  alineaciones: AlineacionSinId[];
  descartadas: number;
  exactas: number;
}

/** La cobertura mínima de la transcripción en los segmentos de A del grupo (1 si A no es un medio). */
function coberturaA(a: MaterialObra, g: GrupoFino): number {
  if (!a.medio) return 1;
  const cs = g.a.map(tramoDe).filter((x): x is [number, number] => !!x).map(([x, y]) => cobertura(a, x, y).cobertura);
  return cs.length ? Math.min(...cs) : 1;
}

/** La alineación fina de un grupo, con el texto de sus segmentos ya cargado (`ta`, `tb`). */
export async function alineacionFina(
  rel: Relacion, a: MaterialObra, b: MaterialObra, g: GrupoFino, ta: Material, tb: Material, modelo: ModeloComprension, acumulado: { uso: UsoModelo },
  o: { prefijo: string; calidad: 'alta' | 'rapida'; limiteMs?: number },
): Promise<ResultadoFino> {
  const r = await llamar<{ alineaciones: AlineacionModelo[] }>(modelo, {
    sistema: sistema(rel, a, b, `alineación fina de unos segmentos de B con los de A que les corresponden. Recorre B en orden, pasaje a pasaje (un párrafo, un intercambio de diálogo, una descripción, un resumen narrativo, un monólogo interior), y di qué le corresponde en A, con las dos pruebas. Incluye también lo que A añade en esas escenas (lado b vacío) y lo de B que A no recoge (lado a vacío, con la cautela sobre los huecos de la transcripción). Entre 8 y 30 correspondencias por segmento de B, según su riqueza, en el orden de B.`),
    partes: [{ texto: o.prefijo }, { texto: `${detalleGrupo(a, b, g, ta, tb)}\n\nHaz la alineación fina. Responde solo con el JSON.` }],
    esquema: ESQUEMA_FINA, calidad: o.calidad, maxTokens: 32_000, operacion: 'transmedia:fina', ...(o.limiteMs ? { limiteMs: o.limiteMs } : {}),
  }, acumulado);
  const cob = coberturaA(a, g);
  const salida: ResultadoFino = { alineaciones: [], descartadas: 0, exactas: 0 };
  const vistas = new Set<string>();
  for (const x of r.alineaciones ?? []) {
    let tipo: TipoCorrespondencia = TIPOS_CORRESPONDENCIA.includes(x.tipo) ? x.tipo : 'transformado';
    const quiereA = tipo !== 'suprimido' && !!x.a && (x.a.cita || x.a.t0 !== undefined || x.a.u !== undefined);
    const quiereB = tipo !== 'anadido' && !!x.b && (x.b.cita || x.b.u !== undefined);
    if (!quiereA && !quiereB) { salida.descartadas++; continue; }
    let la = quiereA ? anclarLado(a, ta, x.a, g.a) : null;
    let lb = quiereB ? anclarLado(b, tb, x.b, g.b) : null;
    let confianza = Math.max(0, Math.min(1, x.confianza ?? 0.7));
    // Si no queda ningún lado probado, la correspondencia entera se descarta.
    if ((quiereA && !la) || (quiereB && !lb)) salida.descartadas++;
    if ((quiereA && !la && !lb?.exacto) || (quiereB && !lb && !la?.exacto)) continue;
    // Un lado que el modelo dio y no se encuentra: los segmentos que corresponden al otro lado, con menos confianza.
    if (quiereA && !la) { const l = ladoDeSegmentos(a, correspondientes(lb?.lado, b, a, g)); if (l) la = { lado: l, exacto: false }; confianza *= 0.6; }
    if (quiereB && !lb) { const l = ladoDeSegmentos(b, correspondientes(la?.lado, a, b, g)); if (l) lb = { lado: l, exacto: false }; confianza *= 0.6; }
    if (!la && !lb) continue;
    if (!lb && tipo !== 'anadido') tipo = 'anadido';
    if (!la && tipo !== 'suprimido') tipo = 'suprimido';
    let nota = limpiarMarcas(x.nota ?? '', a, b);
    if (tipo === 'suprimido' && a.medio && cob < 0.9) {
      confianza = Math.min(confianza, 0.45);
      nota = `${nota.replace(/\.?$/, '.')} Cautela: la transcripción de las escenas correspondientes tiene huecos, así que la ausencia de un diálogo no está comprobada.`;
    }
    const clave = JSON.stringify([la?.lado.ancla, lb?.lado.ancla, tipo]);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    if ((la?.exacto ?? true) && (lb?.exacto ?? true)) salida.exactas++;
    const literales = { ...(la?.literal ? { a: la.literal } : {}), ...(lb?.literal ? { b: lb.literal } : {}) };
    salida.alineaciones.push({
      tipo, ...(la ? { a: la.lado } : {}), ...(lb ? { b: lb.lado } : {}), nota, confianza: Math.round(confianza * 100) / 100,
      ...(Object.keys(literales).length ? { literales } : {}),
    });
  }
  return salida;
}

/** Posición de un lado para ordenar (segundo, o página y carácter). */
export function posicionLado(l: Pick<LadoAlineacion, 'ancla'> | undefined): number {
  if (!l) return Number.MAX_SAFE_INTEGER;
  const a = l.ancla;
  if (a.tipo === 'tiempo') return a.t0 * 1000;
  const base = a.tipo === 'pagina' ? a.fisica : a.tipo === 'seccion' || a.tipo === 'web' ? a.parrafo : a.tipo === 'diapositiva' ? a.n : 0;
  return base * 1e7 + (a.caracteres?.[0] ?? 0);
}

/** Las correspondencias gruesas que no se detallaron (añadidos, supresiones y grupos sin fina) como alineaciones. */
export function alineacionesGruesas(a: MaterialObra, b: MaterialObra, gruesas: readonly CorrespondenciaGruesa[]): AlineacionSinId[] {
  const porA = new Map(a.hojas.map((s) => [idCortoDe('A', s), s]));
  const porB = new Map(b.hojas.map((s) => [idCortoDe('B', s), s]));
  return gruesas.map((c) => {
    const la = ladoDeSegmentos(a, c.a.map((x) => porA.get(x)!).filter(Boolean));
    const lb = ladoDeSegmentos(b, c.b.map((x) => porB.get(x)!).filter(Boolean));
    return { tipo: c.tipo, ...(la ? { a: la } : {}), ...(lb ? { b: lb } : {}), nota: c.nota, confianza: c.confianza };
  });
}
