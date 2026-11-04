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
import { enParalelo, type Ficha, type Lente, type PercepcionMedio, type Segmento } from '@scholaris/nucleo';
import { borrarComprension, escribirApariciones, escribirFichas, leerFichas, leerSegmentos } from '@scholaris/spdf';
import { ESQUEMA_ELECCION, SISTEMA_ELECCION, elegirLentes, lente, VERSION_COMPRENSION, versionDe } from './lentes/index.js';
import {
  agruparSecuencias, construirArbol, estructuraDelModelo, guardarEstructura, segmentosDePercepcion, segmentosDeSecciones, type Borrador,
} from './estructura.js';
import { aparicionesDePercepcion, aparicionesDeTemas, aparicionesDeTexto, conocidasEnBiblioteca, enlazarReparto, extraerEntidadesDelModelo, fichasDeEntidades, resolverEntidades } from './entidades.js';
import { actualizarEstado, apuntarPaso, borrarPasos, gastado, leerEstadoComprension, pasoHecho, usoVacio } from './estado.js';
import { fichaGlobal, fichasDeLote, lotesDeFichas } from './fichas.js';
import { indexarFichas } from './indexado.js';
import { hablantesDe, leerMaterial, muestraDe, tokensDe, type Material } from './material.js';
import { fichasDePlanos } from './medios.js';
import { llamar } from './modelo.js';
import type { ContextoComprension, EstadoComprension, OpcionesComprension, PasoComprension, PlanComprension, UsoModelo } from './tipos.js';

const ahoraDe = (ctx: ContextoComprension) => (ctx.ahora?.() ?? new Date()).toISOString();
const PRESUPUESTO = 4;
const MAX_CONTEXTO = 2_400_000;
const POR_LLAMADA = 6;

async function avisar(ctx: ContextoComprension, documento: string, paso: PasoComprension, avance: number, mensaje: string): Promise<void> {
  try { await ctx.alProgreso?.({ documento, paso, avance, mensaje }); } catch (e) {
    // Una cancelación sí para el trabajo; cualquier otro fallo del aviso, no.
    if (/cancelad/i.test((e as Error).message)) throw e;
  }
}

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
  const k = tokens / 1000;
  const acotar = (s: number) => Math.round(Math.min(3600, Math.max(300, s)));
  return {
    estructura: acotar(180 + k * (largo ? 1.5 : 3)),
    fichas: acotar(240 + k * (largo ? 0.8 : 0.3)),
    entidades: acotar(240 + k * 2.5),
    global: acotar(300 + k * 2),
    indexado: acotar(120 + k * 0.3),
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
  const m = await leerMaterial(ctx.sql, documento);
  const percepcion = await percepcionDe(ctx, m);
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
    plazos: plazosDe(tokensAprox, largo), presupuestoUsd: o.presupuestoUsd ?? PRESUPUESTO, estimacionUsd, economico, calidades, hecha: false,
    opciones: { segmentosPorLlamada: o.segmentosPorLlamada ?? POR_LLAMADA, ...(o.wikidata !== undefined ? { wikidata: o.wikidata } : {}), maxCaracteresContexto: maxCaracteres },
  };
  if (!ctx.modelo) {
    await actualizarEstado(ctx.sql, documento, { estado: 'sin_modelo', lentes, version, iniciado: t }, t);
    return { ...plan, hecha: true };
  }
  const previo = await leerEstadoComprension(ctx.sql, documento);
  if (previo?.estado === 'hecho' && previo.version === version && !o.forzar) return { ...plan, hecha: true };
  const reanudar = previo?.estado === 'en_marcha' && previo.version === version && !o.forzar;
  if (!reanudar) {
    // De cero: fuera la comprensión anterior (también del índice) y su procedencia.
    const { fichas } = await borrarComprension(ctx.sql, documento);
    if (ctx.indice && ctx.espacioNombres && fichas.length) {
      for (let i = 0; i < fichas.length; i += 500) await ctx.indice.borrar(ctx.espacioNombres, fichas.slice(i, i + 500)).catch(() => undefined);
    }
    await borrarPasos(ctx.sql, documento);
    await actualizarEstado(ctx.sql, documento, { estado: 'en_marcha', lentes, version, iniciado: t, avisos: [], error: undefined }, t);
  } else {
    await actualizarEstado(ctx.sql, documento, { estado: 'en_marcha', error: undefined }, t);
  }
  if (uso.uso.llamadas) await apuntarPaso(ctx.sql, documento, 'plan', uso.uso, uso.uso.ms, t, {});
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
  const m = await leerMaterial(ctx.sql, doc);
  const percepcion = await percepcionDe(ctx, m);
  const l = plan.lentes[0]!;
  const acumulado = { uso: usoVacio() };
  const avisos: string[] = [];
  const leidos = segmentosDeSecciones(m, l);
  const borradores: Borrador[] = [...leidos];
  if (percepcion) {
    let secuencias: Awaited<ReturnType<typeof agruparSecuencias>> = [];
    try { secuencias = await agruparSecuencias(m, percepcion, ctx.modelo, l, acumulado); } catch (e) { avisos.push(`Sin secuencias: ${(e as Error).message}`.slice(0, 200)); }
    borradores.push(...segmentosDePercepcion(m, percepcion, secuencias));
  } else {
    const rangoMax = leidos.reduce((x, b) => Math.max(x, b.rango), -1);
    const finos = def.segmentos.filter((s) => s !== 'plano').length;
    if (!leidos.length || rangoMax < finos - 1) {
      const delModelo = await estructuraDelModelo(m, l, ctx.modelo, acumulado, { leidos, maxCaracteres: Math.min(plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, 1_200_000), calidad: plan.calidades.estructura });
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
    return { fichas: 0 };
  }
  const m = await leerMaterial(ctx.sql, doc);
  const percepcion = await percepcionDe(ctx, m);
  const acumulado = { uso: usoVacio() };
  const r = await fichasDeLote(m, l, segmentos, ids, ctx.modelo, acumulado, {
    largo: plan.largo, calidad: yaGastado > plan.presupuestoUsd * 0.7 ? 'rapida' : plan.calidades.fichas, maxCaracteres: plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO,
    percepcion, idioma: m.documento.metadatos.idioma ?? 'es', creada: ahoraDe(ctx),
  });
  await escribirFichas(ctx.sql, r.fichas);
  await apuntarPaso(ctx.sql, doc, paso, acumulado.uso, Date.now() - inicio, ahoraDe(ctx), { fichas: r.fichas.length, citasDescartadas: r.descartadas, sinFicha: r.faltan },
    r.faltan ? [`${r.faltan} segmentos se quedaron sin ficha en la tanda ${lote + 1}.`] : []);
  return { fichas: r.fichas.length };
}

// ---------------------------------------------------------------------------
// Entidades y apariciones
// ---------------------------------------------------------------------------

export async function pasoEntidades(ctx: ContextoComprension, plan: PlanComprension): Promise<{ entidades: number; apariciones: number }> {
  const doc = plan.documento;
  if (plan.hecha || !ctx.modelo || await pasoHecho(ctx.sql, doc, 'entidades')) return { entidades: 0, apariciones: 0 };
  const inicio = Date.now();
  const t = ahoraDe(ctx);
  await avisar(ctx, doc, 'entidades', 0.5, 'Reconociendo personajes, lugares, obras y motivos');
  const l = plan.lentes[0]!;
  const m = await leerMaterial(ctx.sql, doc);
  const percepcion = await percepcionDe(ctx, m);
  const segmentos = await leerSegmentos(ctx.sql, doc);
  const acumulado = { uso: usoVacio() };
  const avisos: string[] = [];
  const conocidas = await conocidasEnBiblioteca(ctx.sql, doc);
  const delModelo = await extraerEntidadesDelModelo(m, l, ctx.modelo, acumulado, {
    largo: plan.largo, calidad: plan.calidades.entidades, maxCaracteres: Math.min(plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, 1_200_000), percepcion, conocidas,
  });
  const ents = await resolverEntidades(ctx.sql, delModelo);
  const apariciones = aparicionesDeTexto(m, ents, segmentos);
  if (percepcion) {
    const p = await aparicionesDePercepcion(ctx.sql, m, percepcion, ents, segmentos);
    apariciones.push(...p.apariciones);
  }
  const reparto = await enlazarReparto(ctx.sql, m, ents, { ...(ctx.fetch ? { fetch: ctx.fetch } : {}), ...(plan.opciones.wikidata !== undefined ? { wikidata: plan.opciones.wikidata } : {}), percepcion, ahora: t });
  avisos.push(...reparto.avisos);
  const fe = fichasDeEntidades(m, l, ents, apariciones, reparto.papeles, { modelo: ctx.modelo.modelo(plan.calidades.entidades), idioma: m.documento.metadatos.idioma ?? 'es', creada: t });
  // Sustituye lo de una pasada anterior (salvo los temas, que son de la ficha global).
  await ctx.sql.ejecutar('DELETE FROM apariciones WHERE documento = ? AND id NOT LIKE ?', doc, `${doc}:ap:t:%`);
  const viejas = (await ctx.sql.ejecutar<{ id: string }>("SELECT id FROM fichas WHERE documento = ? AND objetivo = 'entidad'", doc)).map((f) => String(f.id));
  const nuevas = new Set(fe.fichas.map((f) => f.id));
  for (const id of viejas) if (!nuevas.has(id)) {
    await ctx.sql.ejecutar('DELETE FROM fichas WHERE id = ?', id);
    await ctx.sql.ejecutar("DELETE FROM vectores WHERE objetivo = 'ficha' AND id = ?", id);
  }
  for (let i = 0; i < apariciones.length; i += 500) await escribirApariciones(ctx.sql, apariciones.slice(i, i + 500));
  await escribirFichas(ctx.sql, fe.fichas);
  await apuntarPaso(ctx.sql, doc, 'entidades', acumulado.uso, Date.now() - inicio, ahoraDe(ctx), {
    entidades: ents.length, apariciones: apariciones.length, papeles: reparto.papeles.length, fichas: fe.fichas.length, citasDescartadas: fe.descartadas,
  }, avisos);
  return { entidades: ents.length, apariciones: apariciones.length };
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
  const m = await leerMaterial(ctx.sql, doc);
  const percepcion = await percepcionDe(ctx, m);
  const segmentos = await leerSegmentos(ctx.sql, doc);
  const fichasSegmento = await leerFichas(ctx.sql, { documento: doc, objetivo: 'segmento' });
  const acumulado = { uso: usoVacio() };
  const calidad = (await gastado(ctx.sql, doc)) > plan.presupuestoUsd ? 'rapida' : plan.calidades.global;
  await ctx.sql.ejecutar('DELETE FROM apariciones WHERE documento = ? AND id LIKE ?', doc, `${doc}:ap:t:%`);
  let temas = 0, descartadas = 0;
  const fichas: Ficha[] = [];
  for (const [i, l] of plan.lentes.entries()) {
    const r = await fichaGlobal(m, l, segmentos, fichasSegmento, ctx.modelo, acumulado, {
      largo: plan.largo, calidad, maxCaracteres: plan.opciones.maxCaracteresContexto ?? MAX_CONTEXTO, percepcion, idioma: m.documento.metadatos.idioma ?? 'es', creada: t, secundaria: i > 0,
    });
    descartadas += r.descartadas;
    const ta = await aparicionesDeTemas(ctx.sql, m, r.temas, 'tema', segmentos);
    const mo = await aparicionesDeTemas(ctx.sql, m, r.motivos, 'motivo', segmentos);
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
  await escribirFichas(ctx.sql, fichas);
  await apuntarPaso(ctx.sql, doc, 'global', acumulado.uso, Date.now() - inicio, ahoraDe(ctx), { fichas: fichas.length, temas, citasDescartadas: descartadas });
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
  const r = await indexarFichas(ctx, doc);
  await apuntarPaso(ctx.sql, doc, 'indexado', usoVacio(ctx.embebedor?.espacio.modelo ?? ''), Date.now() - inicio, ahoraDe(ctx), { vectores: r.vectores, pendientes: r.pendientes ? 1 : 0 },
    r.pendientes ? ['Los vectores de las fichas no llegaron al índice: se buscan por texto y se reenviarán.'] : []);
  return r;
}

export async function cerrarComprension(ctx: ContextoComprension, plan: PlanComprension, r: { ok: boolean; error?: string }): Promise<EstadoComprension> {
  const t = ahoraDe(ctx);
  const previo = await leerEstadoComprension(ctx.sql, plan.documento);
  if (plan.hecha && previo) return previo;
  const e = await actualizarEstado(ctx.sql, plan.documento, r.ok ? { estado: 'hecho', error: undefined } : { estado: 'error', error: (r.error ?? 'La comprensión ha fallado.').slice(0, 500) }, t);
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
      pasoEntidades(ctx, plan),
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
