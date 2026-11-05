/**
 * El flujo de comprensión, paso a paso (docs/COMPRENSION.md, «Ingesta: el flujo
 * de comprensión»). Cada paso:
 *
 * - recibe el plan (pequeño y serializable) y lee lo que necesita del puerto SQL:
 *   ningún paso necesita en memoria el resultado de otro;
 * - es idempotente: ids deterministas, sustituye lo que escribió y, si ya consta
 *   como hecho en la procedencia, no repite nada (ni paga dos veces);
 * - apunta su coste (modelo, tokens, dólares) en la procedencia del documento.
 *
 * El Workflow `scholaris-comprension` los llama uno a uno (las tandas de fichas
 * y las entidades, a la vez); `comprenderDocumento` los encadena en local.
 */
import { enParalelo, type Aparicion, type Ficha, type Lente, type PercepcionMedio, type Segmento } from '@scholaris/nucleo';
import { borrarComprension, escribirApariciones, escribirFichas, leerApariciones, leerFichas, leerSegmentos } from '@scholaris/spdf';
import { ESQUEMA_ELECCION, SISTEMA_ELECCION, elegirLentes, lente, VERSION_COMPRENSION, versionDe } from './lentes/index.js';
import {
  agruparSecuencias, construirArbol, estructuraDelModelo, guardarEstructura, segmentosDePercepcion, segmentosDeSecciones, unidadesEnTramo, type Borrador,
} from './estructura.js';
import {
  analizarEntidades, aparicionesDePercepcion, aparicionesDeTemas, aparicionesDeTexto, conocidasEnBiblioteca, enlazarReparto, extraerEntidadesDelModelo, fichasDeEntidades,
  principalesDe, resolverEntidades, type EntidadResuelta, type Papel,
} from './entidades.js';
import { actualizarEstado, apuntarPaso, borrarPasos, gastado, guardarDatosPaso, leerDatosPaso, leerEstadoComprension, pasoHecho, usoVacio } from './estado.js';
import { fichaGlobal, fichasDeLote, lotesDeFichas } from './fichas.js';
import { indexarFichas } from './indexado.js';
import { hablantesDe, leerMaterial, muestraDe, tokensDe, type Material, type VozPercibida } from './material.js';
import { fichasDePlanos } from './medios.js';
import { ErrorPlazo, llamar, modeloDelPaso } from './modelo.js';
import { regionesDelPaso } from './regiones.js';
import { huella } from './util.js';
import type { ContextoComprension, EstadoComprension, ModeloComprension, OpcionesComprension, PasoComprension, PlanComprension, UsoModelo } from './tipos.js';

const ahoraDe = (ctx: ContextoComprension) => (ctx.ahora?.() ?? new Date()).toISOString();
/** Un SQL remoto (el del Workflow, por RPC) junta las escrituras: al acabar cada paso se mandan. */
const vaciar = async (ctx: ContextoComprension) => { await (ctx.sql as { vaciarPendientes?(): Promise<void> }).vaciarPendientes?.(); };

/** El modelo de un paso: acotado a su plazo, con diario y con latido mientras responde. */
function modeloDe(ctx: ContextoComprension, documento: string, paso: string): ModeloComprension {
  return modeloDelPaso(ctx.modelo!, {
    documento, paso, ...(ctx.limite ? { limite: ctx.limite } : {}),
    ...(ctx.registro ? { registro: ctx.registro.bind(ctx) } : {}), ...(ctx.latido ? { latido: ctx.latido.bind(ctx) } : {}),
  });
}

/**
 * Si un intento anterior de este paso se quedó sin tiempo, el siguiente va con el modelo
 * rápido: es mejor una ficha algo menos fina que un paso que nunca termina.
 */
async function calidadDelPaso(ctx: ContextoComprension, documento: string, clave: string, calidad: 'alta' | 'rapida'): Promise<'alta' | 'rapida'> {
  const plazos = (await leerDatosPaso<number>(ctx.sql, documento, `plazos:${clave}`)) ?? 0;
  if (plazos > 0 && calidad === 'alta') ctx.registro?.({ documento, paso: clave, sub: 'calidad', estado: 'fin', detalle: { calidad: 'rapida', plazosAgotados: plazos } });
  return plazos > 0 ? 'rapida' : calidad;
}

/** Apunta que un intento se quedó sin tiempo (lo lee `calidadDelPaso` en el siguiente) y deja seguir al error. */
async function conRegistroDePlazo<T>(ctx: ContextoComprension, documento: string, clave: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const m = (e as Error)?.message ?? '';
    if (e instanceof ErrorPlazo || /plazo|tiempo agotado/i.test(m)) {
      const previos = (await leerDatosPaso<number>(ctx.sql, documento, `plazos:${clave}`).catch(() => 0)) ?? 0;
      await guardarDatosPaso(ctx.sql, documento, `plazos:${clave}`, previos + 1, ahoraDe(ctx)).catch(() => undefined);
      await vaciar(ctx).catch(() => undefined);
    }
    throw e;
  }
}

/** Mide una parte de un paso y la deja en el diario (inicio, fin o error, con su duración). */
async function parte<T>(ctx: ContextoComprension, documento: string, paso: string, sub: string, fn: () => Promise<T>, detalle?: (r: T) => Record<string, unknown>): Promise<T> {
  const t0 = Date.now();
  ctx.registro?.({ documento, paso, sub, estado: 'inicio' });
  try {
    const r = await fn();
    ctx.registro?.({ documento, paso, sub, estado: 'fin', ms: Date.now() - t0, ...(detalle ? { detalle: detalle(r) } : {}) });
    await Promise.resolve(ctx.latido?.()).catch(() => undefined);
    return r;
  } catch (e) {
    ctx.registro?.({ documento, paso, sub, estado: 'error', ms: Date.now() - t0, detalle: { error: ((e as Error)?.message || String(e)).slice(0, 300) } });
    throw e;
  }
}
const PRESUPUESTO = 4;
const MAX_CONTEXTO = 2_400_000;
const POR_LLAMADA = 6;
/** En los medios cada escena lleva su percepción (planos, sonido): tandas más pequeñas, llamadas más cortas. */
const POR_LLAMADA_MEDIO = 4;

async function avisar(ctx: ContextoComprension, documento: string, paso: PasoComprension, avance: number, mensaje: string): Promise<void> {
  try { await ctx.alProgreso?.({ documento, paso, avance, mensaje }); } catch (e) {
    // Una cancelación sí para el trabajo; cualquier otro fallo del aviso, no.
    if (/cancelad/i.test((e as Error).message)) throw e;
  }
}

/** El material con su percepción (si es un medio y la hay) y las voces que esta reconoció. */
async function materialDe(ctx: ContextoComprension, documento: string): Promise<{ m: Material; percepcion: PercepcionMedio | null }> {
  const m = await leerMaterial(ctx.sql, documento);
  const percepcion = await percepcionDe(ctx, m);
  if (percepcion) m.voces = vocesPercibidas(percepcion);
  return { m, percepcion };
}

/** Las líneas de diálogo con su hablante, tal como las reconoció la percepción. */
export function vocesPercibidas(p: PercepcionMedio): VozPercibida[] {
  return p.escenas.flatMap((e) => e.dialogoClave.filter((d) => d.hablante).map((d) => ({ t: d.t, hablante: d.hablante!, texto: d.texto }))).sort((a, b) => a.t - b.t);
}

/** Huella de la percepción: si llega otra (o una reparada), la estructura del medio se rehace. */
export const huellaDePercepcion = (p: PercepcionMedio | null) => (p ? huella(JSON.stringify([p.modelo, p.version, p.duracion, p.escenas.map((e) => [e.t0, e.t1, e.planos.length])])) : '');

async function percepcionDe(ctx: ContextoComprension, m: Material): Promise<PercepcionMedio | null> {
  if (!m.medio || !ctx.percepcion) return null;
  try {
    const p = await ctx.percepcion(m.documento.id);
    return p?.escenas?.length ? p : null;
  } catch { return null; }
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Plazos de cada paso según el tamaño (segundos): lo que puede tardar el modelo con margen. */
export function plazosDe(tokens: number, largo: boolean): PlanComprension['plazos'] {
  // Medido el 4-11-2026 con gemini-4-argon (pensamiento medio): una tanda de seis escenas de una
  // película con la obra entera delante, de 3 a 6 minutos; la lista de entidades de un cuento de
  // 16 000 tokens, unos 2 minutos, y cada tanda de análisis de cinco principales, 1-2; la ficha
  // global, 3-4. El plazo deja holgura para un reintento dentro del paso.
  const k = tokens / 1000;
  const acotar = (s: number) => Math.round(Math.min(3600, Math.max(300, s)));
  return {
    estructura: acotar(300 + k * (largo ? 3 : 5)),
    fichas: acotar(600 + k * (largo ? 2 : 0.5)),
    entidades: acotar(600 + k * 6),
    personajes: acotar(600 + k * 3),
    global: acotar(600 + k * 4),
    indexado: acotar(240 + k * 0.5),
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Primer paso: elige las lentes, mide el documento, decide plazos y presupuesto
 * y deja el estado «en_marcha». Si ya estaba hecha con esta versión, el plan sale
 * con `hecha` y los demás pasos no hacen nada. Si estaba a medias con la misma
 * versión (un relanzamiento), se reanuda donde quedó.
 */
export async function planificarComprension(ctx: ContextoComprension, documento: string, o: OpcionesComprension = {}): Promise<PlanComprension> {
  const t = ahoraDe(ctx);
  const { m, percepcion } = await materialDe(ctx, documento);
  let lentes: Lente[] = (o.lentes ?? []).filter((l, i, a) => a.indexOf(l) === i).slice(0, 2);
  const uso: { uso: UsoModelo } = { uso: usoVacio() };
  if (!lentes.length) {
    const e = elegirLentes({ tipo: m.documento.tipo, metadatos: m.documento.metadatos, muestra: muestraDe(m), hablantes: hablantesDe(m).length });
    lentes = e.lentes;
    if (e.confianza < 0.5 && ctx.modelo) {
      try {
        const r = await llamar<{ lentes: Lente[] }>(ctx.modelo, {
          sistema: SISTEMA_ELECCION, partes: [{ texto: `${JSON.stringify({ tipo: m.documento.tipo, ...m.documento.metadatos }).slice(0, 2000)}\n\nMuestra:\n${muestraDe(m, 6000)}` }],
          esquema: ESQUEMA_ELECCION as unknown as Record<string, unknown>, calidad: 'rapida', maxTokens: 400, operacion: 'plan:lente',
        }, uso);
        const validas = (r.lentes ?? []).filter((l) => lente(l).id === l).slice(0, 2);
        if (validas.length) lentes = validas;
      } catch { /* se queda la elección sin modelo */ }
    }
  }
  const version = versionDe(lentes, VERSION_COMPRENSION);
  const huellaMaterial = huella(m.unidades.map((u) => `${u.id}:${u.texto.length}`).join('|'));
  const maxCaracteres = o.maxCaracteresContexto ?? MAX_CONTEXTO;
  const extraPercepcion = percepcion ? JSON.stringify(percepcion).length * 0.6 : 0;
  const caracteres = Math.round(m.caracteres + extraPercepcion);
  const tokensAprox = tokensDe(caracteres);
  const largo = caracteres <= maxCaracteres;
  const economico = !!o.economico;
  const calidades: PlanComprension['calidades'] = economico
    ? { estructura: 'rapida', fichas: 'rapida', entidades: 'rapida', global: 'rapida' }
    : { estructura: 'alta', fichas: 'alta', entidades: 'alta', global: 'alta', ...(o.calidades ?? {}) };
  const lotes = Math.max(1, Math.ceil(tokensAprox / 9000));
  const precio = (c: 'alta' | 'rapida') => ctx.modelo?.precio?.(c) ?? { entrada: 2, salida: 12 };
  const coste = (c: 'alta' | 'rapida', entrada: number, salida: number) => (entrada * precio(c).entrada + salida * precio(c).salida) / 1e6;
  const estimacionUsd = r2(
    coste(calidades.estructura, tokensAprox, 12_000)
    + coste(calidades.fichas, (largo ? tokensAprox : tokensAprox / lotes + 4000) * lotes * 0.6, 14_000 * lotes)
    + coste(calidades.entidades, tokensAprox, 16_000)
    + coste(calidades.global, tokensAprox + 8000 * lotes, 16_000) * lentes.length,
  );
  const plan: PlanComprension = {
    documento, lentes, version, medio: m.medio, caracteres, tokensAprox, largo, conPercepcion: !!percepcion,
    plazos: plazosDe(tokensAprox, largo), presupuestoUsd: o.presupuestoUsd ?? PRESUPUESTO, estimacionUsd, economico, calidades, huella: huellaMaterial, hecha: false,
    reusar: { estructura: false, fichas: false },
    opciones: { segmentosPorLlamada: o.segmentosPorLlamada ?? (m.medio ? POR_LLAMADA_MEDIO : POR_LLAMADA), ...(o.wikidata !== undefined ? { wikidata: o.wikidata } : {}), maxCaracteresContexto: maxCaracteres },
  };
  if (!ctx.modelo) {
    await actualizarEstado(ctx.sql, documento, { estado: 'sin_modelo', lentes, version, iniciado: t }, t);
    await vaciar(ctx);
    return { ...plan, hecha: true };
  }
  const previo = await leerEstadoComprension(ctx.sql, documento);
  const huellaPercepcion = huellaDePercepcion(percepcion);
  const mismaVersion = previo?.version === version;
  const mismaPercepcion = (previo?.huellaPercepcion ?? '') === huellaPercepcion;
  const mismo = mismaVersion && (!previo?.huella || previo.huella === huellaMaterial) && mismaPercepcion;
  if (previo?.estado === 'hecho' && mismo && !o.forzar && o.rehacer?.length) {
    // Rehacer solo unos pasos (la ficha global, por ejemplo): se borran sus marcas y las del indexado, y los
    // demás pasos, que siguen hechos, no hacen nada ni cuestan.
    for (const paso of new Set([...o.rehacer, 'indexado'])) await ctx.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ?', documento, `comprension:${paso}`);
    await actualizarEstado(ctx.sql, documento, { estado: 'en_marcha', error: undefined }, t);
    await vaciar(ctx);
    return { ...plan, reusar: { estructura: true, fichas: true } };
  }
  if (previo?.estado === 'hecho' && mismo && !o.forzar) return { ...plan, hecha: true };
  const reanudar = previo?.estado === 'en_marcha' && mismo && !o.forzar;
  if (reanudar) {
    await actualizarEstado(ctx.sql, documento, { estado: 'en_marcha', error: undefined }, t);
  } else if (previo && mismaVersion && !o.forzar && previo.estado !== 'sin_modelo') {
    // Misma versión con otro material (la transcripción se reparó, llegó la percepción) o tras un
    // error: se rehace por partes. Lo que no ha cambiado (la estructura de un medio con la misma
    // percepción, las fichas de los segmentos con la misma huella de entrada) no se vuelve a pagar.
    await borrarPasos(ctx.sql, documento);
    plan.reusar = { estructura: m.medio && mismaPercepcion, fichas: true };
    await actualizarEstado(ctx.sql, documento, { estado: 'en_marcha', huella: huellaMaterial, huellaPercepcion, iniciado: t, avisos: [], error: undefined }, t);
  } else {
    // De cero: fuera la comprensión anterior (también del índice) y su procedencia.
    const { fichas } = await borrarComprension(ctx.sql, documento);
    if (ctx.indice && ctx.espacioNombres && fichas.length) {
      for (let i = 0; i < fichas.length; i += 500) await ctx.indice.borrar(ctx.espacioNombres, fichas.slice(i, i + 500)).catch(() => undefined);
    }
    await borrarPasos(ctx.sql, documento);
    await actualizarEstado(ctx.sql, documento, { estado: 'en_marcha', lentes, version, huella: huellaMaterial, huellaPercepcion, iniciado: t, avisos: [], error: undefined }, t);
  }
  if (uso.uso.llamadas) await apuntarPaso(ctx.sql, documento, 'plan', uso.uso, uso.uso.ms, t, {});
  await vaciar(ctx);
  await avisar(ctx, documento, 'plan', 0.02, `Comprensión con la lente ${lentes.join(' y ')}`);
  return plan;
}

// ---------------------------------------------------------------------------
// Estructura
// ---------------------------------------------------------------------------

export async function pasoSegmentos(ctx: ContextoComprension, plan: PlanComprension): Promise<{ segmentos: number; lotes: number }> {
  const doc = plan.documento;
  const def = lente(plan.lentes[0]!);
  const lotesActuales = async () => lotesDeFichas(await leerSegmentos(ctx.sql, doc), def, plan.opciones.segmentosPorLlamada).length;
  if (plan.hecha || !ctx.modelo) return { segmentos: (await leerSegmentos(ctx.sql, doc)).length, lotes: 0 };
  if (await pasoHecho(ctx.sql, doc, 'estructura')) return { segmentos: (await leerSegmentos(ctx.sql, doc)).length, lotes: await lotesActuales() };
  const inicio = Date.now();
  const t = ahoraDe(ctx);
  await avisar(ctx, doc, 'estructura', 0.05, 'Leyendo la estructura de la obra');
  const { m, percepcion } = await materialDe(ctx, doc);
  const l = plan.lentes[0]!;
  const acumulado = { uso: usoVacio() };
  const avisos: string[] = [];
  const previos = plan.reusar.estructura ? await leerSegmentos(ctx.sql, doc) : [];
  if (previos.length) {
    // La misma estructura (un medio con la misma percepción): se reancla a las unidades nuevas por tiempo.
    const reanclados = previos.map((s) => {
      if (s.ancla.tipo !== 'tiempo') return s;
      const us = unidadesEnTramo(m, s.ancla.t0, s.anclaFin?.tipo === 'tiempo' ? s.anclaFin.t1 : s.ancla.t1);
      return { ...s, unidadDesde: us[0]!.id, unidadHasta: us.at(-1)!.id };
    });
    const { secciones } = await guardarEstructura(ctx.sql, m, reanclados);
    let planos = 0;
    if (percepcion) {
      const fichas = fichasDePlanos(percepcion, reanclados, { idioma: m.documento.metadatos.idioma ?? 'es', modelo: percepcion.modelo, version: lente('cine').version, creada: t });
      for (let i = 0; i < fichas.length; i += 200) await escribirFichas(ctx.sql, fichas.slice(i, i + 200));
      planos = fichas.length;
    }
    const lotes = lotesDeFichas(reanclados, def, plan.opciones.segmentosPorLlamada).length;
    await apuntarPaso(ctx.sql, doc, 'estructura', usoVacio(), Date.now() - inicio, ahoraDe(ctx), { segmentos: reanclados.length, secciones, lotes, planos, reutilizada: 1 });
    await vaciar(ctx);
    return { segmentos: reanclados.length, lotes };
  }
  const leidos = segmentosDeSecciones(m, l);
  const borradores: Borrador[] = [...leidos];
  if (percepcion) {
    let secuencias: Awaited<ReturnType<typeof agruparSecuencias>> = [];
    try { secuencias = await agruparSecuencias(m, percepcion, modeloDe(ctx, doc, 'estructura'), l, acumulado); } catch (e) { avisos.push(`Sin secuencias: ${(e as Error).message}`.slice(0, 200)); }
    borradores.push(...segmentosDePercepcion(m, percepcion, secuencias));
  } else {
    const rangoMax = leidos.reduce((x, b) => Math.max(x, b.rango), -1);
    const finos = def.segmentos.filter((s) => s !== 'plano').length;
    if (!leidos.length || rangoMax < finos - 1) {
      const calidad = await calidadDelPaso(ctx, doc, 'estructura', plan.calidades.estructura);
      const delModelo = await conRegistroDePlazo(ctx, doc, 'estructura', () => estructuraDelModelo(m, l, modeloDe(ctx, doc, 'estructura'), acumulado, { leidos, maxCaracteres: Math.min(plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, 1_200_000), calidad }));
      borradores.push(...(leidos.length ? delModelo.filter((b) => b.rango > rangoMax && b.tipo !== 'otro') : delModelo));
    }
  }
  let segmentos = construirArbol(doc, borradores);
  if (!segmentos.length && m.unidades.length) {
    const a = m.unidades[0]!, b = m.unidades.at(-1)!;
    segmentos = [{
      id: `${doc}:sg0`, documento: doc, padre: null, nivel: 1, orden: 0, tipo: def.segmentos.includes('apartado') ? 'apartado' : def.segmentos[0] ?? 'obra',
      titulo: m.documento.metadatos.titulo ?? 'Obra entera', ancla: a.t0 !== undefined ? { tipo: 'tiempo', t0: a.t0, t1: b.t1 ?? a.t1! } : a.ancla,
      unidadDesde: a.id, unidadHasta: b.id, origen: 'deducido', confianza: 0.5,
    }];
    avisos.push('No se pudo deducir la estructura: queda la obra como un solo segmento.');
  }
  const { secciones } = await guardarEstructura(ctx.sql, m, segmentos);
  let planos = 0;
  if (percepcion) {
    const fichas = fichasDePlanos(percepcion, segmentos, { idioma: m.documento.metadatos.idioma ?? 'es', modelo: percepcion.modelo, version: lente('cine').version, creada: t });
    for (let i = 0; i < fichas.length; i += 200) await escribirFichas(ctx.sql, fichas.slice(i, i + 200));
    planos = fichas.length;
  }
  const lotes = lotesDeFichas(segmentos, def, plan.opciones.segmentosPorLlamada).length;
  await apuntarPaso(ctx.sql, doc, 'estructura', acumulado.uso, Date.now() - inicio, ahoraDe(ctx), { segmentos: segmentos.length, secciones, lotes, planos }, avisos);
  await vaciar(ctx);
  await avisar(ctx, doc, 'estructura', 0.15, `${segmentos.length} segmentos`);
  return { segmentos: segmentos.length, lotes };
}

// ---------------------------------------------------------------------------
// Fichas de segmento
// ---------------------------------------------------------------------------

export async function pasoFichas(ctx: ContextoComprension, plan: PlanComprension, lote: number): Promise<{ fichas: number }> {
  const doc = plan.documento;
  const paso = `fichas:${lote}`;
  if (plan.hecha || !ctx.modelo || await pasoHecho(ctx.sql, doc, paso)) return { fichas: 0 };
  const inicio = Date.now();
  const l = plan.lentes[0]!;
  const segmentos = await leerSegmentos(ctx.sql, doc);
  const lotes = lotesDeFichas(segmentos, lente(l), plan.opciones.segmentosPorLlamada);
  const ids = lotes[lote];
  if (!ids?.length) return { fichas: 0 };
  const yaGastado = await gastado(ctx.sql, doc);
  if (yaGastado > plan.presupuestoUsd) {
    await apuntarPaso(ctx.sql, doc, paso, usoVacio(), 0, ahoraDe(ctx), { fichas: 0 }, [`Presupuesto agotado (${yaGastado.toFixed(2)} USD): quedan segmentos sin ficha propia.`]);
    await vaciar(ctx);
    return { fichas: 0 };
  }
  const { m, percepcion } = await materialDe(ctx, doc);
  const acumulado = { uso: usoVacio() };
  const previas = new Map<string, Ficha>();
  if (plan.reusar.fichas) {
    for (const f of await leerFichas(ctx.sql, { documento: doc, objetivo: 'segmento', lente: l })) {
      if (typeof f.datos.huellaEntrada === 'string') previas.set(f.datos.huellaEntrada, f);
    }
  }
  const calidadFichas = yaGastado > plan.presupuestoUsd * 0.7 ? 'rapida' : await calidadDelPaso(ctx, doc, paso, plan.calidades.fichas);
  const r = await conRegistroDePlazo(ctx, doc, paso, () => fichasDeLote(m, l, segmentos, ids, modeloDe(ctx, doc, paso), acumulado, {
    previas,
    largo: plan.largo, calidad: calidadFichas, maxCaracteres: plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO,
    percepcion, idioma: m.documento.metadatos.idioma ?? 'es', creada: ahoraDe(ctx),
  }));
  // Las pruebas de las páginas, a su sitio en la imagen (anclaje material).
  const regiones = await regionesDelPaso(ctx, m, r.fichas, acumulado, { gastado: yaGastado, presupuestoUsd: plan.presupuestoUsd });
  await escribirFichas(ctx.sql, r.fichas);
  await apuntarPaso(ctx.sql, doc, paso, acumulado.uso, Date.now() - inicio, ahoraDe(ctx), { fichas: r.fichas.length, reutilizadas: r.reutilizadas, citasDescartadas: r.descartadas, sinFicha: r.faltan, ...regiones },
    r.faltan ? [`${r.faltan} segmentos se quedaron sin ficha en la tanda ${lote + 1}.`] : []);
  await vaciar(ctx);
  return { fichas: r.fichas.length };
}

// ---------------------------------------------------------------------------
// Entidades y apariciones
// ---------------------------------------------------------------------------

/** Lo que el paso de entidades deja para el de personajes. */
interface DatosEntidades {
  entidades: Array<Pick<EntidadResuelta, 'id' | 'nombre' | 'tipo' | 'formas' | 'alusiones' | 'descripcion' | 'ficticia' | 'importancia' | 'actor' | 'grafo'>>;
  papeles: Papel[];
}

/**
 * Entidades y apariciones: la lista del modelo (sin análisis: corta y rápida), su
 * resolución en el grafo, las apariciones en el material y en la percepción y el
 * reparto (Wikidata acotado). El análisis de las principales es el paso siguiente.
 */
export async function pasoEntidades(ctx: ContextoComprension, plan: PlanComprension): Promise<{ entidades: number; apariciones: number }> {
  const doc = plan.documento;
  const paso = 'entidades';
  if (plan.hecha || !ctx.modelo || await pasoHecho(ctx.sql, doc, paso)) return { entidades: 0, apariciones: 0 };
  const inicio = Date.now();
  const t = ahoraDe(ctx);
  await avisar(ctx, doc, 'entidades', 0.5, 'Reconociendo personajes, lugares, obras y motivos');
  const l = plan.lentes[0]!;
  const { m, percepcion } = await materialDe(ctx, doc);
  const segmentos = await leerSegmentos(ctx.sql, doc);
  const acumulado = { uso: usoVacio() };
  const avisos: string[] = [];
  const conocidas = await parte(ctx, doc, paso, 'conocidas', () => conocidasEnBiblioteca(ctx.sql, doc));
  const calidad = await calidadDelPaso(ctx, doc, paso, plan.calidades.entidades);
  const delModelo = await conRegistroDePlazo(ctx, doc, paso, () => extraerEntidadesDelModelo(m, l, modeloDe(ctx, doc, paso), acumulado, {
    largo: plan.largo, calidad, maxCaracteres: Math.min(plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, 1_200_000), percepcion, conocidas,
  }));
  const ents = await parte(ctx, doc, paso, 'resolver', () => resolverEntidades(ctx.sql, delModelo), (r) => ({ entidades: r.length }));
  const apariciones = await parte(ctx, doc, paso, 'apariciones', async () => {
    // Primero lo percibido (puede añadir personas al reparto: las voces de la transcripción se casan con ellas).
    const aps = percepcion ? (await aparicionesDePercepcion(ctx.sql, m, percepcion, ents, segmentos)).apariciones : [];
    const deTexto = aparicionesDeTexto(m, ents, segmentos);
    // Una línea de diálogo percibida que ya está como turno de la transcripción (misma voz, mismo tramo) no se cuenta dos veces.
    const turnos = deTexto.filter((a) => a.rol === 'habla' && a.ancla.tipo === 'tiempo');
    const repetida = (a: Aparicion) => a.rol === 'habla' && a.ancla.tipo === 'tiempo'
      && turnos.some((x) => x.entidad === a.entidad && x.ancla.tipo === 'tiempo' && a.ancla.tipo === 'tiempo' && a.ancla.t0 >= x.ancla.t0 - 1 && a.ancla.t0 <= x.ancla.t1 + 1);
    for (let i = aps.length - 1; i >= 0; i--) if (repetida(aps[i]!)) aps.splice(i, 1);
    aps.push(...deTexto);
    return aps;
  }, (r) => ({ apariciones: r.length }));
  const reparto = await parte(ctx, doc, paso, 'reparto', () => enlazarReparto(ctx.sql, m, ents, {
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}), ...(plan.opciones.wikidata !== undefined ? { wikidata: plan.opciones.wikidata } : {}), percepcion, ahora: t,
  }), (r) => ({ papeles: r.papeles.length, avisos: r.avisos.length }));
  avisos.push(...reparto.avisos);
  await parte(ctx, doc, paso, 'escribir', async () => {
    // Sustituye lo de una pasada anterior (salvo los temas, que son de la ficha global).
    await ctx.sql.ejecutar('DELETE FROM apariciones WHERE documento = ? AND id NOT LIKE ?', doc, `${doc}:ap:t:%`);
    for (let i = 0; i < apariciones.length; i += 500) await escribirApariciones(ctx.sql, apariciones.slice(i, i + 500));
    const datos: DatosEntidades = {
      entidades: ents.map(({ id, nombre, tipo, formas, alusiones, descripcion, ficticia, importancia, actor, grafo }) => ({
        id, nombre, tipo, formas, grafo, ...(alusiones ? { alusiones } : {}), ...(descripcion ? { descripcion } : {}), ...(ficticia !== undefined ? { ficticia } : {}),
        ...(importancia !== undefined ? { importancia } : {}), ...(actor ? { actor } : {}),
      })),
      papeles: reparto.papeles,
    };
    await guardarDatosPaso(ctx.sql, doc, 'entidades', datos, ahoraDe(ctx));
  });
  await apuntarPaso(ctx.sql, doc, paso, acumulado.uso, Date.now() - inicio, ahoraDe(ctx), {
    entidades: ents.length, apariciones: apariciones.length, papeles: reparto.papeles.length,
  }, avisos);
  await vaciar(ctx);
  return { entidades: ents.length, apariciones: apariciones.length };
}

/**
 * Las fichas de entidad: el análisis de las principales (en tandas pequeñas y a la
 * vez) y una línea para las de importancia media. Necesita el paso de entidades.
 */
export async function pasoPersonajes(ctx: ContextoComprension, plan: PlanComprension): Promise<{ fichas: number }> {
  const doc = plan.documento;
  const paso = 'personajes';
  if (plan.hecha || !ctx.modelo || await pasoHecho(ctx.sql, doc, paso)) return { fichas: 0 };
  const datos = await leerDatosPaso<DatosEntidades>(ctx.sql, doc, 'entidades');
  if (!datos) throw new Error('Faltan las entidades del documento: el paso de entidades no ha terminado.');
  const inicio = Date.now();
  const t = ahoraDe(ctx);
  await avisar(ctx, doc, 'personajes', 0.6, 'Analizando los personajes y los motivos principales');
  const l = plan.lentes[0]!;
  const { m, percepcion } = await materialDe(ctx, doc);
  const acumulado = { uso: usoVacio() };
  const ents = datos.entidades as EntidadResuelta[];
  const calidad = await calidadDelPaso(ctx, doc, paso, plan.calidades.entidades);
  const analisis = await conRegistroDePlazo(ctx, doc, paso, () => analizarEntidades(m, l, principalesDe(ents), modeloDe(ctx, doc, paso), acumulado, {
    largo: plan.largo, calidad, maxCaracteres: Math.min(plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, 1_200_000), percepcion,
  }));
  const conAnalisis = ents.map((e) => {
    const a = analisis.get(e.nombre);
    return a ? { ...e, analisis: a.analisis, evidencias: a.evidencias } : e;
  });
  const apariciones = await leerApariciones(ctx.sql, { documento: doc, limite: 100_000 });
  const fe = fichasDeEntidades(m, l, conAnalisis, apariciones, datos.papeles, { modelo: ctx.modelo.modelo(plan.calidades.entidades), idioma: m.documento.metadatos.idioma ?? 'es', creada: t });
  // Las pruebas de las páginas, a su sitio en la imagen (anclaje material).
  const regiones = await regionesDelPaso(ctx, m, fe.fichas, acumulado, { gastado: await gastado(ctx.sql, doc), presupuestoUsd: plan.presupuestoUsd });
  await parte(ctx, doc, paso, 'escribir', async () => {
    const viejas = (await ctx.sql.ejecutar<{ id: string }>("SELECT id FROM fichas WHERE documento = ? AND objetivo = 'entidad'", doc)).map((f) => String(f.id));
    const nuevas = new Set(fe.fichas.map((f) => f.id));
    for (const id of viejas) if (!nuevas.has(id)) {
      await ctx.sql.ejecutar('DELETE FROM fichas WHERE id = ?', id);
      await ctx.sql.ejecutar("DELETE FROM vectores WHERE objetivo = 'ficha' AND id = ?", id);
    }
    await escribirFichas(ctx.sql, fe.fichas);
  });
  await apuntarPaso(ctx.sql, doc, paso, acumulado.uso, Date.now() - inicio, ahoraDe(ctx), { fichas: fe.fichas.length, analizadas: analisis.size, citasDescartadas: fe.descartadas, ...regiones });
  await vaciar(ctx);
  return { fichas: fe.fichas.length };
}

// ---------------------------------------------------------------------------
// Ficha global
// ---------------------------------------------------------------------------

export async function pasoGlobal(ctx: ContextoComprension, plan: PlanComprension): Promise<{ fichas: number; temas: number }> {
  const doc = plan.documento;
  if (plan.hecha || !ctx.modelo || await pasoHecho(ctx.sql, doc, 'global')) return { fichas: 0, temas: 0 };
  const inicio = Date.now();
  const t = ahoraDe(ctx);
  await avisar(ctx, doc, 'global', 0.75, 'Escribiendo la ficha global de la obra');
  const { m, percepcion } = await materialDe(ctx, doc);
  const segmentos = await leerSegmentos(ctx.sql, doc);
  const fichasSegmento = await leerFichas(ctx.sql, { documento: doc, objetivo: 'segmento' });
  const acumulado = { uso: usoVacio() };
  const calidad = (await gastado(ctx.sql, doc)) > plan.presupuestoUsd ? 'rapida' : await calidadDelPaso(ctx, doc, 'global', plan.calidades.global);
  await ctx.sql.ejecutar('DELETE FROM apariciones WHERE documento = ? AND id LIKE ?', doc, `${doc}:ap:t:%`);
  // Fichas de segmentos que ya no existen (la estructura cambió al rehacer): fuera, también del índice.
  const vigentes = new Set(segmentos.map((s) => s.id));
  const huerfanas = fichasSegmento.filter((f) => !vigentes.has(f.objetivoId)).map((f) => f.id);
  for (const id of huerfanas) {
    await ctx.sql.ejecutar('DELETE FROM fichas WHERE id = ?', id);
    await ctx.sql.ejecutar("DELETE FROM vectores WHERE objetivo = 'ficha' AND id = ?", id);
  }
  if (huerfanas.length && ctx.indice && ctx.espacioNombres) await ctx.indice.borrar(ctx.espacioNombres, huerfanas).catch(() => undefined);
  const fichasVigentes = fichasSegmento.filter((f) => vigentes.has(f.objetivoId));
  // En audio y vídeo la global sale del mapa (estructura, percepción escena a escena y fichas de escenas y
  // secuencias, sin las de cada plano), no del material entero: con una película de dos horas delante, el
  // mejor modelo no contestaba a tiempo y la escribía el rápido de respaldo.
  const porMapa = m.medio;
  const fichasMapa = porMapa ? fichasVigentes.filter((f) => f.clase !== 'plano') : fichasVigentes;
  let temas = 0, descartadas = 0;
  const fichas: Ficha[] = [];
  // Una ficha global por lente, a la vez (cada una es una llamada larga): el paso dura lo que la más lenta.
  const modelo = modeloDe(ctx, doc, 'global');
  const globales = await conRegistroDePlazo(ctx, doc, 'global', () => Promise.all(plan.lentes.map((l, i) => fichaGlobal(m, l, segmentos, fichasMapa, modelo, acumulado, {
    largo: plan.largo && !porMapa, calidad, maxCaracteres: plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, percepcion, idioma: m.documento.metadatos.idioma ?? 'es', creada: t, secundaria: i > 0,
  }))));
  for (const r of globales) {
    descartadas += r.descartadas;
    const { ta, mo } = await parte(ctx, doc, 'global', 'temas', async () => ({
      ta: await aparicionesDeTemas(ctx.sql, m, r.temas, 'tema', segmentos),
      mo: await aparicionesDeTemas(ctx.sql, m, r.motivos, 'motivo', segmentos),
    }), (x) => ({ temas: x.ta.entidades.length, motivos: x.mo.entidades.length }));
    descartadas += ta.descartadas + mo.descartadas;
    const enlazar = (lista: unknown, ents: Array<{ nombre: string; id: string; apariciones: number }>) => (Array.isArray(lista) ? lista : []).map((x: { nombre: string; descripcion: string }) => {
      const e = ents.find((y) => y.nombre.toLowerCase() === x.nombre.trim().toLowerCase()) ?? ents.find((y) => y.nombre.toLowerCase().includes(x.nombre.trim().toLowerCase().slice(0, 12)));
      return { ...x, ...(e ? { entidad: e.id, apariciones: e.apariciones } : {}) };
    });
    r.ficha.datos.temas = enlazar(r.ficha.datos.temas, ta.entidades);
    r.ficha.datos.motivos = enlazar(r.ficha.datos.motivos, mo.entidades);
    temas += ta.entidades.length + mo.entidades.length;
    const aps = [...ta.apariciones, ...mo.apariciones];
    for (let k = 0; k < aps.length; k += 500) await escribirApariciones(ctx.sql, aps.slice(k, k + 500));
    if (r.ficha.texto) fichas.push(r.ficha);
  }
  const regiones = await regionesDelPaso(ctx, m, fichas, acumulado, { gastado: await gastado(ctx.sql, doc), presupuestoUsd: plan.presupuestoUsd });
  await escribirFichas(ctx.sql, fichas);
  await apuntarPaso(ctx.sql, doc, 'global', acumulado.uso, Date.now() - inicio, ahoraDe(ctx), { fichas: fichas.length, temas, citasDescartadas: descartadas, ...regiones });
  await vaciar(ctx);
  return { fichas: fichas.length, temas };
}

// ---------------------------------------------------------------------------
// Indexado y cierre
// ---------------------------------------------------------------------------

export async function pasoIndexado(ctx: ContextoComprension, plan: PlanComprension): Promise<{ vectores: number; pendientes: boolean }> {
  const doc = plan.documento;
  if (plan.hecha || !ctx.modelo || await pasoHecho(ctx.sql, doc, 'indexado')) return { vectores: 0, pendientes: false };
  const inicio = Date.now();
  await avisar(ctx, doc, 'indexado', 0.92, 'Indexando las fichas para la búsqueda');
  const r = await parte(ctx, doc, 'indexado', 'vectores', () => indexarFichas(ctx, doc), (x) => ({ vectores: x.vectores, pendientes: x.pendientes }));
  await apuntarPaso(ctx.sql, doc, 'indexado', usoVacio(ctx.embebedor?.espacio.modelo ?? ''), Date.now() - inicio, ahoraDe(ctx), { vectores: r.vectores, pendientes: r.pendientes ? 1 : 0 },
    r.pendientes ? ['Los vectores de las fichas no llegaron al índice: se buscan por texto y se reenviarán.'] : []);
  await vaciar(ctx);
  return r;
}

export async function cerrarComprension(ctx: ContextoComprension, plan: PlanComprension, r: { ok: boolean; error?: string }): Promise<EstadoComprension> {
  const t = ahoraDe(ctx);
  const previo = await leerEstadoComprension(ctx.sql, plan.documento);
  if (plan.hecha && previo) return previo;
  const e = await actualizarEstado(ctx.sql, plan.documento, r.ok ? { estado: 'hecho', error: undefined } : { estado: 'error', error: (r.error ?? 'La comprensión ha fallado.').slice(0, 500) }, t);
  await vaciar(ctx);
  await avisar(ctx, plan.documento, 'fin', 1, r.ok ? `Comprensión terminada (${e.usd.toFixed(2)} USD)` : 'La comprensión ha fallado');
  return e;
}

/** Lo que ve quien pide la comprensión de un documento entero en un solo proceso (local, pruebas, banco). */
export async function comprenderDocumento(ctx: ContextoComprension, documento: string, o: OpcionesComprension & { concurrencia?: number } = {}): Promise<EstadoComprension> {
  const plan = await planificarComprension(ctx, documento, o);
  if (plan.hecha) return (await leerEstadoComprension(ctx.sql, documento))!;
  try {
    const { lotes } = await pasoSegmentos(ctx, plan);
    let hechas = 0;
    await Promise.all([
      enParalelo(Array.from({ length: lotes }, (_, i) => i), Math.max(1, o.concurrencia ?? 3), async (i) => {
        await pasoFichas(ctx, plan, i);
        hechas++;
        await avisar(ctx, documento, 'fichas', 0.15 + 0.5 * (hechas / Math.max(1, lotes)), `Fichas: tanda ${hechas} de ${lotes}`);
      }),
      (async () => { await pasoEntidades(ctx, plan); await pasoPersonajes(ctx, plan); })(),
    ]);
    await pasoGlobal(ctx, plan);
    await pasoIndexado(ctx, plan);
    return await cerrarComprension(ctx, plan, { ok: true });
  } catch (e) {
    await cerrarComprension(ctx, plan, { ok: false, error: (e as Error).message }).catch(() => undefined);
    throw e;
  }
}

export type { Segmento };
