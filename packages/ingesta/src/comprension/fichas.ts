/**
 * Fichas: la de cada segmento (con el esquema de su lente) y la global del
 * documento (docs/COMPRENSION.md, pasos 3 y 5). El modelo lee la obra entera
 * cuando cabe (lo estable va delante para aprovechar la caché implícita) y, si
 * no, solo el tramo de cada segmento y las fichas ya hechas (mapa y reducción).
 * Cada afirmación lleva sus evidencias, ancladas aquí contra el material.
 */
import type { Ficha, Lente, PercepcionMedio, Segmento } from '@scholaris/nucleo';
import { anclarReferencias, limpiarProsa } from './anclaje.js';
import { esquemaFichaGlobal, esquemaFichasSegmento, lente, REGLAS_COMUNES } from './lentes/index.js';
import { coberturaTranscripcion, etiquetaUnidad, fichaDocumento, huecosTranscripcion, textoParaModelo, type Material } from './material.js';
import { VERSION_COMPRENSION } from './lentes/comun.js';
import { huella } from './util.js';
import { textoEscena, textoReparto } from './medios.js';
import { llamar } from './modelo.js';
import type { DefinicionLente, ModeloComprension, RefModelo, UsoModelo } from './tipos.js';

export const idCorto = (s: Pick<Segmento, 'orden'>) => `s${s.orden}`;

const tiempo = (s: Segmento) => (s.ancla.tipo === 'tiempo' ? ` [${Math.round(s.ancla.t0)}-${Math.round(s.ancla.t1)} s]` : '');

/** El árbol de segmentos en texto, para que el modelo sepa dónde está cada parte. */
export function textoEstructura(m: Material, segmentos: readonly Segmento[]): string {
  const orden = (id: string) => m.porId.get(id)?.orden ?? '?';
  return segmentos.filter((s) => s.tipo !== 'plano').map((s) =>
    `${'  '.repeat(Math.max(0, s.nivel - 1))}${idCorto(s)} ${s.tipo} «${s.titulo}» U${orden(s.unidadDesde)}-U${orden(s.unidadHasta)}${tiempo(s)}${s.resumen ? `: ${s.resumen}` : ''}`,
  ).join('\n');
}

/** Tandas de segmentos con ficha, en orden de lectura (deterministas: el mismo árbol da las mismas). */
export function lotesDeFichas(segmentos: readonly Segmento[], def: DefinicionLente, porLlamada = 6): string[][] {
  const con = segmentos.filter((s) => def.conFicha.includes(s.tipo) && s.tipo !== 'plano');
  const lotes: string[][] = [];
  for (let i = 0; i < con.length; i += porLlamada) lotes.push(con.slice(i, i + porLlamada).map((s) => s.id));
  return lotes;
}

export interface OpcionesFichas {
  /** El documento entero va en cada llamada. */
  largo: boolean;
  calidad: 'alta' | 'rapida';
  maxCaracteres: number;
  percepcion?: PercepcionMedio | null;
  idioma: string;
  creada: string;
}

/** Lo que se repite en todas las llamadas de un documento: ficha, reparto, estructura y (si cabe) la obra. */
export function prefijoMaterial(m: Material, segmentos: readonly Segmento[], o: Pick<OpcionesFichas, 'largo' | 'percepcion' | 'maxCaracteres'>): string {
  const partes = [fichaDocumento(m.documento)];
  if (o.percepcion?.reparto.length) partes.push(`Reparto percibido (guía para reconocer a cada uno):\n${textoReparto(o.percepcion)}`);
  if (segmentos.length) partes.push(`Estructura (ids de segmento para «segmento»):\n${textoEstructura(m, segmentos)}`);
  if (o.percepcion?.escenas.length) {
    const escenas = [...o.percepcion.escenas].sort((a, b) => a.t0 - b.t0);
    partes.push(`Percepción de la obra, escena a escena (sin el detalle de los planos):\n${escenas.map((e, i) => `Escena ${i} [${Math.round(e.t0)}-${Math.round(e.t1)} s] «${e.titulo}»${e.lugar ? `, ${e.lugar}` : ''}. ${e.accion}${e.personas.length ? ` (${e.personas.join(', ')})` : ''}`).join('\n')}`);
  }
  const huecos = m.medio ? huecosTranscripcion(m) : [];
  if (huecos.length) {
    const t = (x: number) => etiquetaUnidad({ tipo: 'tiempo', t0: x, t1: x });
    partes.push(`Tramos sin transcripción (no se sabe si son silencio, música o huecos de la transcripción): ${huecos.map(([a, b]) => `${t(a)}-${t(b)}`).join(', ')}. Lo que pase ahí solo se conoce por la percepción y los fotogramas; nunca concluyas que algo no se dice o no ocurre porque no esté en la transcripción.`);
  }
  if (o.largo) partes.push(`Material completo:\n\n${textoParaModelo(m, { fotogramas: m.medio, maxCaracteres: o.maxCaracteres })}`);
  return partes.join('\n\n');
}

/** Unidades de un segmento (en los medios, las que tocan su tramo de tiempo). */
function unidadesDe(m: Material, s: Segmento) {
  if (s.ancla.tipo === 'tiempo') {
    const a = s.ancla;
    return m.unidades.filter((u) => u.t0 !== undefined && u.t1 !== undefined && u.t0 < a.t1 && u.t1 > a.t0);
  }
  const d = m.porId.get(s.unidadDesde)?.orden ?? 0, h = m.porId.get(s.unidadHasta)?.orden ?? d;
  return m.unidades.filter((u) => u.orden >= d && u.orden <= h);
}

/**
 * Huella de lo que entra en la ficha de un segmento: versión de la lente, el
 * segmento, su texto, lo percibido en su tramo y las voces. Si no cambia, la
 * ficha se reutiliza al rehacer (una transcripción reparada solo paga lo nuevo).
 */
export function huellaEntradaSegmento(m: Material, l: Lente, s: Segmento, percepcion?: PercepcionMedio | null): string {
  const a = s.ancla.tipo === 'tiempo' ? s.ancla : null;
  const escenas = a && percepcion ? percepcion.escenas.filter((e) => e.t0 < a.t1 && e.t1 > a.t0) : [];
  const voces = a ? (m.voces ?? []).filter((v) => v.t >= a.t0 && v.t < a.t1) : [];
  return huella(JSON.stringify([VERSION_COMPRENSION, lente(l).version, s.tipo, s.titulo, a ? [Math.round(a.t0), Math.round(a.t1)] : null, unidadesDe(m, s).map((u) => u.texto), escenas, voces]));
}

interface FichaModelo {
  segmento?: string;
  texto: string;
  resumen_es?: string;
  resumen_en?: string;
  datos?: Record<string, unknown>;
  evidencias?: RefModelo[];
}

function sistemaLente(def: DefinicionLente, tarea: string): string {
  return `${REGLAS_COMUNES}\n\n${def.instrucciones}\n\nTarea: ${tarea}`;
}

/** Las fichas de una tanda de segmentos. */
export async function fichasDeLote(
  m: Material, l: Lente, segmentos: readonly Segmento[], ids: readonly string[], modelo: ModeloComprension, acumulado: { uso: UsoModelo },
  o: OpcionesFichas & { previas?: ReadonlyMap<string, Ficha> },
): Promise<{ fichas: Ficha[]; descartadas: number; faltan: number; reutilizadas: number }> {
  const def = lente(l);
  const porId = new Map(segmentos.map((s) => [s.id, s]));
  const huellas = new Map<string, string>();
  const reutilizadas: Ficha[] = [];
  const objetivo: Segmento[] = [];
  for (const id of ids) {
    const s = porId.get(id);
    if (!s) continue;
    const h = huellaEntradaSegmento(m, l, s, o.percepcion);
    huellas.set(s.id, h);
    const previa = o.previas?.get(h);
    if (previa) reutilizadas.push({ ...previa, id: `${m.documento.id}:fi:${s.id}:${l}`, objetivoId: s.id, datos: { ...previa.datos, titulo: s.titulo } });
    else objetivo.push(s);
  }
  if (!objetivo.length) return { fichas: reutilizadas, descartadas: 0, faltan: 0, reutilizadas: reutilizadas.length };
  const escenasPercibidas = o.percepcion ? [...o.percepcion.escenas].sort((a, b) => a.t0 - b.t0) : [];
  const detalle = (s: Segmento) => {
    const partes: string[] = [];
    if (!o.largo) {
      const d = m.porId.get(s.unidadDesde)?.orden, h = m.porId.get(s.unidadHasta)?.orden;
      partes.push(textoParaModelo(m, { ...(d !== undefined ? { desde: d } : {}), ...(h !== undefined ? { hasta: h } : {}), fotogramas: m.medio }));
    }
    if (s.ancla.tipo === 'tiempo' && escenasPercibidas.length) {
      const a = s.ancla;
      escenasPercibidas.forEach((e, i) => { if (e.t0 < a.t1 && e.t1 > a.t0) partes.push(textoEscena(o.percepcion!, i)); });
    }
    if (s.ancla.tipo === 'tiempo') {
      const c = coberturaTranscripcion(m, s.ancla.t0, s.ancla.t1);
      const t = (x: number) => etiquetaUnidad({ tipo: 'tiempo', t0: x, t1: x });
      if (c.cobertura < 0.9) partes.push(`Transcripción de este tramo: ${Math.round(c.cobertura * 100)} %${c.huecos.length ? ` (sin transcripción: ${c.huecos.map(([x, y]) => `${t(x)}-${t(y)}`).join(', ')})` : ''}. Apóyate en lo percibido y no afirmes ausencias.`);
    }
    return partes.join('\n\n');
  };
  const pedir = async (lista: Segmento[]) => {
    const tarea = lista.map((s) => {
      const d = detalle(s);
      return `${idCorto(s)} (${s.tipo} «${s.titulo}»${tiempo(s)})${d ? `\n${d}` : ''}`;
    }).join('\n\n');
    const r = await llamar<{ fichas: FichaModelo[] }>(modelo, {
      sistema: sistemaLente(def, 'fichas de segmentos. Analiza cada segmento pedido dentro del conjunto de la obra, con el esquema dado.'),
      partes: [
        { texto: prefijoMaterial(m, segmentos, o) },
        { texto: `Haz la ficha de estos segmentos (uno por segmento, con su id en «segmento»):\n\n${tarea}\n\nResponde solo con el JSON.` },
      ],
      esquema: esquemaFichasSegmento(def.datosSegmento), calidad: o.calidad, maxTokens: Math.min(30_000, 3500 * lista.length + 2000), operacion: 'fichas',
    }, acumulado);
    return r.fichas ?? [];
  };

  let respuesta = await pedir(objetivo);
  const hechas = new Set(respuesta.map((f) => f.segmento));
  const faltan = objetivo.filter((s) => !hechas.has(idCorto(s)));
  if (faltan.length && faltan.length < objetivo.length) respuesta = [...respuesta, ...(await pedir(faltan))];

  const porCorto = new Map(objetivo.map((s) => [idCorto(s), s]));
  const fichas: Ficha[] = [];
  let descartadas = 0;
  const vistos = new Set<string>();
  for (const f of respuesta) {
    const s = f.segmento ? porCorto.get(f.segmento.trim()) : undefined;
    if (!s || vistos.has(s.id) || !f.texto?.trim()) continue;
    vistos.add(s.id);
    const a = anclarReferencias(m, f.evidencias, { maximo: 24 });
    descartadas += a.descartadas;
    const transcripcion = s.ancla.tipo === 'tiempo' ? coberturaTranscripcion(m, s.ancla.t0, s.ancla.t1) : null;
    fichas.push({
      id: `${m.documento.id}:fi:${s.id}:${l}`, documento: m.documento.id, objetivo: 'segmento', objetivoId: s.id, lente: l, clase: s.tipo,
      idioma: o.idioma, texto: limpiarProsa(f.texto.trim(), m),
      datos: {
        ...(f.datos ?? {}), resumen: { es: limpiarProsa(f.resumen_es ?? '', m), en: limpiarProsa(f.resumen_en ?? '', m) }, titulo: s.titulo,
        huellaEntrada: huellas.get(s.id), ...(transcripcion ? { transcripcion, percibido: !!o.percepcion } : {}),
        ...(a.descartadas ? { citasNoVerificadas: a.descartadas } : {}),
      },
      evidencias: a.evidencias, modelo: modelo.modelo(o.calidad), version: def.version, creada: o.creada,
    });
  }
  return { fichas: [...reutilizadas, ...fichas], descartadas, faltan: objetivo.length - fichas.length, reutilizadas: reutilizadas.length };
}

export interface TemaModelo {
  nombre: string;
  descripcion: string;
  formas?: string[];
  apariciones?: RefModelo[];
}

interface GlobalModelo {
  texto: string;
  resumen_es?: string;
  resumen_en?: string;
  sinopsis?: string;
  temas?: TemaModelo[];
  motivos?: TemaModelo[];
  contexto?: Array<{ dato: string; externo: boolean }>;
  datos?: Record<string, unknown>;
  evidencias?: RefModelo[];
}

/**
 * La ficha global de una lente: la obra entera en contexto largo (con las fichas
 * de segmento como apoyo) o, si no cabe, el mapa: estructura y fichas.
 */
export async function fichaGlobal(
  m: Material, l: Lente, segmentos: readonly Segmento[], fichasSegmento: readonly Ficha[], modelo: ModeloComprension, acumulado: { uso: UsoModelo },
  o: OpcionesFichas & { secundaria?: boolean },
): Promise<{ ficha: Ficha; temas: TemaModelo[]; motivos: TemaModelo[]; descartadas: number }> {
  const def = lente(l);
  const porSegmento = new Map(segmentos.map((s) => [s.id, s]));
  const resumenes = fichasSegmento
    .filter((f) => f.objetivo === 'segmento' && f.clase !== 'plano')
    .map((f) => {
      const s = porSegmento.get(f.objetivoId);
      const r = (f.datos.resumen as { es?: string } | undefined)?.es;
      return `${s ? idCorto(s) : f.objetivoId} «${s?.titulo ?? ''}»: ${o.largo ? r || f.texto.slice(0, 400) : f.texto}`;
    });
  const mapa = resumenes.length ? `Fichas de los segmentos (${o.largo ? 'resumen' : 'texto entero'}):\n${resumenes.join('\n')}` : '';
  const r = await llamar<GlobalModelo>(modelo, {
    sistema: sistemaLente(def, `la ficha global de la obra con la lente «${l}»${o.secundaria ? ' (lente secundaria: lo que esta disciplina ve y la principal no)' : ''}: sinopsis extensa; tesis o sentido; temas y motivos que la atraviesan con TODAS sus apariciones (cita cada una y da las formas literales que los señalan, para encontrar el resto); historia frente a orden del relato cuando lo haya; voz y punto de vista; estilo; contexto (lo externo, marcado). Holismo: cada parte se entiende dentro del todo.`),
    partes: [
      { texto: prefijoMaterial(m, segmentos, o) },
      { texto: `${mapa}\n\nEscribe la ficha global. Responde solo con el JSON.` },
    ],
    esquema: esquemaFichaGlobal(def.datosGlobal), calidad: o.calidad, maxTokens: 30_000, operacion: 'global',
  }, acumulado);
  const a = anclarReferencias(m, r.evidencias, { maximo: 60 });
  const ficha: Ficha = {
    id: `${m.documento.id}:fi:global:${l}`, documento: m.documento.id, objetivo: 'documento', objetivoId: m.documento.id, lente: l, clase: 'global',
    idioma: o.idioma, texto: limpiarProsa((r.texto ?? '').trim(), m),
    datos: {
      ...(r.datos ?? {}), sinopsis: limpiarProsa(r.sinopsis ?? '', m), contexto: r.contexto ?? [],
      temas: (r.temas ?? []).map((t) => ({ nombre: t.nombre, descripcion: t.descripcion })),
      motivos: (r.motivos ?? []).map((t) => ({ nombre: t.nombre, descripcion: t.descripcion })),
      resumen: { es: limpiarProsa(r.resumen_es ?? '', m), en: limpiarProsa(r.resumen_en ?? '', m) },
      fuente: o.largo ? 'obra entera' : 'mapa de fichas',
      ...(a.descartadas ? { citasNoVerificadas: a.descartadas } : {}),
    },
    evidencias: a.evidencias, modelo: modelo.modelo(o.calidad), version: def.version, creada: o.creada,
  };
  return { ficha, temas: r.temas ?? [], motivos: r.motivos ?? [], descartadas: a.descartadas };
}
