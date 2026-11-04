/**
 * La ficha de una relación (objetivo «relacion»): el análisis de la
 * transformación entera, de obra a obra. Estructura, personajes añadidos,
 * suprimidos o fundidos, punto de vista, tiempo, espacio, final, ideología y
 * tono, con cada afirmación anclada en los dos lados cuando los dos existen.
 *
 * Memoria acotada: el modelo lee las cabeceras de las dos obras (con el inicio de
 * sus fichas globales), la alineación gruesa, la fina con lo literal de cada lado
 * (las citas ya comprobadas) y la comparación de entidades del grafo agregada en la
 * propia consulta. Para anclar sus pruebas se cargan solo las unidades que cita.
 */
import type { Alineacion, Evidencia, Ficha, LadoAlineacion, Lente, Relacion, TipoCorrespondencia } from '@scholaris/nucleo';
import { anclaACita } from '@scholaris/nucleo';
import { anclarReferencia, modoDe } from '../comprension/anclaje.js';
import type { Material } from '../comprension/material.js';
import { llamar } from '../comprension/modelo.js';
import type { ContextoComprension, ModeloComprension, UsoModelo } from '../comprension/tipos.js';
import { anclarLado, TIPOS_CORRESPONDENCIA } from './alineacion.js';
import { cargarTramo, idCortoDe, limpiarMarcas, type MaterialObra } from './material.js';
import { idFichaRelacion } from './relaciones.js';
import { rotulo } from './obras.js';
import { VERSION_TRANSMEDIA, type CorrespondenciaGruesa, type LadoModelo } from './tipos.js';

export const CLASE_FICHA: Record<Relacion['tipo'], string> = {
  adaptacion_de: 'adaptacion', traduccion_de: 'traduccion', edicion_de: 'edicion', version_de: 'version', cita_a: 'cita', comenta_a: 'comentario',
  responde_a: 'respuesta', parte_de: 'parte', misma_obra: 'misma_obra', relacionado: 'relacion',
};

export const ASPECTOS = ['estructura', 'personajes', 'punto_de_vista', 'tiempo', 'espacio', 'final', 'ideologia', 'tono', 'dialogo', 'simbolos', 'medio', 'otro'] as const;
export const CAMBIOS_PERSONAJE = ['conservado', 'anadido', 'suprimido', 'fusionado', 'desdoblado', 'transformado', 'ampliado', 'reducido', 'de_mencionado_a_escena', 'renombrado'] as const;

const REF = {
  type: 'object',
  properties: {
    u: { type: 'integer' }, cita: { type: 'string', description: 'Cita literal (4-30 palabras).' },
    t0: { type: 'number' }, t1: { type: 'number' }, t: { type: 'number' }, que: { type: 'string', description: 'Lo que se ve u oye, si no hay cita.' },
  },
};
const REFS = { type: 'array', items: REF };

const ESQUEMA_FICHA = {
  type: 'object',
  properties: {
    texto: { type: 'string', description: 'Ensayo analítico de la transformación entera (900-1800 palabras).' },
    resumen_es: { type: 'string' },
    resumen_en: { type: 'string' },
    modo: { type: 'string', description: 'Qué clase de adaptación o de traducción es, con la tipología de la disciplina, en una frase.' },
    cambios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          aspecto: { type: 'string', enum: [...ASPECTOS] },
          afirmacion: { type: 'string', description: 'Qué cambia de B a A y con qué efecto (una o dos frases).' },
          a: { ...REFS, description: 'Pruebas en A.' },
          b: { ...REFS, description: 'Pruebas en B.' },
        },
        required: ['aspecto', 'afirmacion', 'a', 'b'],
      },
    },
    personajes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Como lo llama cada obra («Miguel (Ismael en el cuento)»).' },
          cambio: { type: 'string', enum: [...CAMBIOS_PERSONAJE] },
          nota: { type: 'string' },
          a: REFS, b: REFS,
        },
        required: ['nombre', 'cambio', 'nota', 'a', 'b'],
      },
    },
    evidencias: { type: 'array', items: { ...REF, properties: { ...REF.properties, obra: { type: 'string', enum: ['A', 'B'] } }, required: ['obra'] } },
  },
  required: ['texto', 'resumen_es', 'resumen_en', 'modo', 'cambios', 'personajes', 'evidencias'],
};

/** Quién aparece en cada obra y cuánto (entidades del grafo comunes y propias), agregado en la consulta. */
async function comparacionEntidades(ctx: ContextoComprension, a: MaterialObra, b: MaterialObra): Promise<string> {
  const cuenta = async (mo: MaterialObra) => {
    const m = new Map<string, { nombre: string; n: number; roles: Set<string> }>();
    const filas = await ctx.sql.ejecutar<{ canon: string; nombre: string; rol: string; n: number }>(
      `SELECT coalesce(e.fusionada_en, e.id) AS canon, e.nombre AS nombre, x.rol AS rol, COUNT(*) AS n
         FROM apariciones x JOIN entidades e ON e.id = x.entidad
        WHERE x.documento = ? AND e.tipo IN ('persona', 'lugar', 'obra')
        GROUP BY canon, x.rol ORDER BY n DESC LIMIT 400`, mo.documento.id).catch(() => []);
    for (const f of filas) {
      const k = String(f.canon);
      const x = m.get(k) ?? { nombre: String(f.nombre), n: 0, roles: new Set<string>() };
      x.n += Number(f.n); x.roles.add(String(f.rol));
      m.set(k, x);
    }
    return m;
  };
  const [ca, cb] = [await cuenta(a), await cuenta(b)];
  const claves = [...new Set([...ca.keys(), ...cb.keys()])].sort((x, y) => ((cb.get(y)?.n ?? 0) + (ca.get(y)?.n ?? 0)) - ((cb.get(x)?.n ?? 0) + (ca.get(x)?.n ?? 0))).slice(0, 40);
  if (!claves.length) return '';
  const linea = (k: string) => {
    const x = ca.get(k), y = cb.get(k);
    return `- ${(x ?? y)!.nombre}: A ${x ? `${x.n} (${[...x.roles].join(', ')})` : '0'}; B ${y ? `${y.n} (${[...y.roles].join(', ')})` : '0'}`;
  };
  return `Entidades del grafo en cada obra (apariciones y roles; 0 = no aparece con ese nombre, puede estar con otro):\n${claves.map(linea).join('\n')}`;
}

/** La unidad (su orden) donde cae un lado, para darle al modelo la marca que tiene que citar. */
function ordenDeLado(mo: MaterialObra, l: LadoAlineacion): number | undefined {
  const a = l.ancla;
  if (a.tipo === 'tiempo') return mo.indice.find((u) => u.t0 !== undefined && u.t1 !== undefined && u.t0 <= a.t0 + 0.5 && a.t0 < u.t1 + 0.5 && u.largo > 0)?.orden;
  if (a.tipo === 'pagina') return mo.indice.find((u) => u.ancla.tipo === 'pagina' && u.ancla.fisica === a.fisica)?.orden;
  return undefined;
}

/** Lo literal de cada alineación fina (guardado al alinear), por id. */
export type Literales = ReadonlyMap<string, { a?: string; b?: string }>;

function textoAlineaciones(a: MaterialObra, b: MaterialObra, gruesas: readonly CorrespondenciaGruesa[], alineaciones: readonly Alineacion[], literales: Literales): string {
  const porA = new Map(a.hojas.map((s) => [idCortoDe('A', s), s.titulo]));
  const porB = new Map(b.hojas.map((s) => [idCortoDe('B', s), s.titulo]));
  const g = gruesas.map((c) => `- ${c.a.map((x) => `${x} «${porA.get(x)}»`).join(', ') || '∅'} ↔ ${c.b.map((x) => `${x} «${porB.get(x)}»`).join(', ') || '∅'} (${c.tipo}): ${c.nota}`);
  const lado = (mo: MaterialObra, l: LadoAlineacion | undefined, lit: string | undefined) => {
    if (!l) return `${mo.letra} ∅`;
    const u = ordenDeLado(mo, l);
    return `${u !== undefined ? `⟦${mo.letra}${u} · ${anclaACita(l.ancla, l.anclaFin)}⟧` : `${mo.letra} ${anclaACita(l.ancla, l.anclaFin)}`}${lit ? ` «${lit}»` : ''}`;
  };
  const f = alineaciones.filter((x) => !x.id.includes(':g')).slice(0, 220).map((x) => {
    const lit = literales.get(x.id);
    return `- ${lado(a, x.a, lit?.a)} ↔ ${lado(b, x.b, lit?.b)} (${x.tipo}): ${x.nota}`;
  });
  return `Alineación gruesa:\n${g.join('\n')}\n\nAlineación fina, ya comprobada contra el material (con la marca de la unidad y lo literal de cada lado: cita de ahí):\n${f.join('\n')}`;
}

/** Una referencia del modelo, anclada como prueba en su obra (con las unidades que cita ya cargadas en `m`). */
function anclarRef(mo: MaterialObra, m: Material, r: LadoModelo): Evidencia | null {
  if (r.cita?.trim()) {
    const ev = anclarReferencia(m, { ...(r.u !== undefined ? { u: r.u } : {}), cita: r.cita });
    if (ev) return ev;
  }
  if (mo.medio && typeof r.t0 === 'number') {
    const l = anclarLado(mo, m, { ...r, cita: '' }, mo.hojas);
    if (l) return { documento: mo.documento.id, ancla: l.lado.ancla, modo: modoDe(m), cita: (r.que ?? '').slice(0, 400) || 'Lo que se ve en ese tramo.' };
  }
  return null;
}

/** La ficha de la relación, o null si no hay modelo. */
export async function fichaRelacion(
  ctx: ContextoComprension, rel: Relacion, a: MaterialObra, b: MaterialObra, gruesas: readonly CorrespondenciaGruesa[], alineaciones: readonly Alineacion[],
  modelo: ModeloComprension, acumulado: { uso: UsoModelo }, o: { prefijo: string; calidad: 'alta' | 'rapida'; creada: string; literales?: Literales; limiteMs?: number },
): Promise<{ ficha: Ficha; descartadas: number }> {
  const traduccion = rel.tipo === 'traduccion_de';
  const tarea = traduccion
    ? `la ficha de la traducción: un ensayo de traductología sobre cómo A traduce B (estrategia general, domesticación o extranjerización, registro, nombres propios, referencias culturales, omisiones y adiciones, ritmo), con cada afirmación probada en los dos lados.`
    : `la ficha de la relación: un ensayo de estudios de adaptación sobre la transformación entera de B en A. Trata la estructura (qué se conserva, condensa, amplía, reordena), los personajes (añadidos, suprimidos, fundidos, desdoblados, renombrados, los que pasan de mencionados a estar en escena), el punto de vista y la voz narrativa (qué hace A con el narrador de B), el tiempo (orden, analepsis, presente de la enunciación), el espacio, el final, la ideología y el tono, y lo que cada medio hace con sus recursos. Cada afirmación lleva sus pruebas en A y en B cuando las dos obras tienen algo que mostrar (en un añadido o una supresión, solo en el lado que lo tiene). No afirmes que A suprime un diálogo en un tramo con huecos de transcripción.`;
  const r = await llamar<{
    texto: string; resumen_es?: string; resumen_en?: string; modo?: string;
    cambios?: Array<{ aspecto: string; afirmacion: string; a?: LadoModelo[]; b?: LadoModelo[] }>;
    personajes?: Array<{ nombre: string; cambio: string; nota: string; a?: LadoModelo[]; b?: LadoModelo[] }>;
    evidencias?: Array<LadoModelo & { obra: 'A' | 'B' }>;
  }>(modelo, {
    sistema: `Eres un especialista en literatura comparada y en ${traduccion ? 'estudios de traducción' : 'estudios de adaptación y análisis fílmico'}. Escribes para una biblioteca académica que cita con página y segundo exactos. A es ${rotulo(a.o)} (la obra derivada) y B es ${rotulo(b.o)} (la de partida).

Pruebas: en «a» van las de la obra A y en «b» las de la B. Cada una es una unidad («u», el número tras la letra de la marca «⟦A12 · …⟧» o «⟦B3 · …⟧») con una cita LITERAL copiada de esa unidad (4-30 palabras), o, en un medio y si no hay diálogo, un tramo («t0», «t1» en segundos, «t» el instante) con «que» (lo que se ve u oye, tomado de la percepción). No cites lo que no está. Lo que infieras, dilo como inferencia. Lo que venga de fuera de las obras (biografía, recepción, historia) se marca como externo («fuera de las obras, se sabe que…»).

Escritura: español impecable (tildes, eñes, ¿ y ¡), registro académico, vocabulario técnico de la disciplina bien usado, sin relleno ni fórmulas vacías. Incisos con comas o paréntesis; la raya, a la española (pegada al inciso: —así—), nunca con espacios a los dos lados. Sin emojis ni markdown salvo comillas latinas. Las marcas «⟦A12 · …⟧» no van en la prosa: si hace falta, el localizador humano («p. 14», «1:02:03»). Además, «resumen_es» y «resumen_en»: una o dos frases en español y en inglés.

Tarea: ${tarea}`,
    partes: [
      { texto: o.prefijo },
      { texto: `${await comparacionEntidades(ctx, a, b)}\n\n${textoAlineaciones(a, b, gruesas, alineaciones, o.literales ?? new Map())}\n\nEscribe la ficha. Responde solo con el JSON.` },
    ],
    esquema: ESQUEMA_FICHA, calidad: o.calidad, maxTokens: 32_000, operacion: 'transmedia:ficha', ...(o.limiteMs ? { limiteMs: o.limiteMs } : {}),
  }, acumulado);
  // Solo las unidades que citan sus pruebas (con sus vecinas), cargadas de una vez por obra.
  const citadas = (mo: MaterialObra, refs: Array<LadoModelo | undefined>) => refs.flatMap((x) => (typeof x?.u === 'number' ? [x.u - 1, x.u, x.u + 1] : [])).filter((u) => mo.porOrden.has(u));
  const refsA = [...(r.cambios ?? []).flatMap((c) => c.a ?? []), ...(r.personajes ?? []).flatMap((p) => p.a ?? []), ...(r.evidencias ?? []).filter((e) => e.obra !== 'B')];
  const refsB = [...(r.cambios ?? []).flatMap((c) => c.b ?? []), ...(r.personajes ?? []).flatMap((p) => p.b ?? []), ...(r.evidencias ?? []).filter((e) => e.obra === 'B')];
  const ma = await cargarTramo(ctx, a, citadas(a, refsA)), mb = await cargarTramo(ctx, b, citadas(b, refsB));
  const evidencias: Evidencia[] = [];
  const claves = new Map<string, number>();
  let descartadas = 0;
  const anclar = (mo: MaterialObra, refs: readonly LadoModelo[] | undefined): number[] => {
    const idx: number[] = [];
    for (const x of refs ?? []) {
      const ev = anclarRef(mo, mo === a ? ma : mb, x);
      if (!ev) { descartadas++; continue; }
      const k = JSON.stringify([ev.documento, ev.unidad, ev.ancla]);
      if (!claves.has(k)) { claves.set(k, evidencias.length); evidencias.push(ev); }
      idx.push(claves.get(k)!);
    }
    return idx;
  };
  const limpio = (t: string) => limpiarMarcas(t ?? '', a, b);
  const cambios = (r.cambios ?? []).filter((c) => c.afirmacion?.trim()).map((c) => {
    const pa = anclar(a, c.a), pb = anclar(b, c.b);
    return { aspecto: (ASPECTOS as readonly string[]).includes(c.aspecto) ? c.aspecto : 'otro', afirmacion: limpio(c.afirmacion), pruebas: { a: pa, b: pb }, ...((c.a?.length && !pa.length) || (c.b?.length && !pb.length) || (!pa.length && !pb.length) ? { inferido: true } : {}) };
  });
  const personajes = (r.personajes ?? []).filter((p) => p.nombre?.trim()).map((p) => {
    const pa = anclar(a, p.a), pb = anclar(b, p.b);
    return { nombre: p.nombre.trim(), cambio: (CAMBIOS_PERSONAJE as readonly string[]).includes(p.cambio) ? p.cambio : 'transformado', nota: limpio(p.nota), pruebas: { a: pa, b: pb } };
  });
  for (const e of r.evidencias ?? []) anclar(e.obra === 'B' ? b : a, [e]);
  const conteo: Partial<Record<TipoCorrespondencia, number>> = {};
  for (const x of alineaciones) conteo[x.tipo] = (conteo[x.tipo] ?? 0) + 1;
  const lente: Lente = traduccion ? (b.global?.lente ?? 'general') : (a.global?.lente ?? (a.medio ? 'cine' : 'narrativa'));
  const ficha: Ficha = {
    id: idFichaRelacion(rel.id), documento: null, objetivo: 'relacion', objetivoId: rel.id, lente, clase: CLASE_FICHA[rel.tipo],
    idioma: a.o.idioma || b.o.idioma || 'es', texto: limpio(r.texto ?? ''),
    datos: {
      relacion: { tipo: rel.tipo, origen: rel.origen, destino: rel.destino }, titulo: `${a.o.titulo} y ${b.o.titulo}`, modo: limpio(r.modo ?? ''),
      resumen: { es: limpio(r.resumen_es ?? ''), en: limpio(r.resumen_en ?? '') },
      cambios, personajes,
      mapa: gruesas.map((c) => ({ a: c.a, b: c.b, tipo: c.tipo, nota: c.nota })),
      conteo, alineaciones: alineaciones.length,
      ...(descartadas ? { citasNoVerificadas: descartadas } : {}),
    },
    evidencias, modelo: modelo.modelo(o.calidad), version: VERSION_TRANSMEDIA, creada: o.creada,
  };
  return { ficha, descartadas };
}

export { TIPOS_CORRESPONDENCIA };
