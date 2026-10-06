/**
 * La tubería por tandas de @scholaris/ingesta, llevada a pasos de la
 * plataforma (packages/ingesta/NOTAS.md):
 *
 *   prepararTuberia     paquete, plan, un fichero pequeño por tanda, fila del documento
 *   [económico]         enviarLoteTuberia → (esperar) → recogerLoteTuberia
 *   procesarTanda(t)    leerTanda + indexarTanda: unidades legibles y texto buscable
 *                       mientras se lee; la tanda de la página 1 saca además los metadatos
 *   consolidarTuberia   folios, secciones, costuras, figuras, vectores que falten: «listo»
 *
 * Todo el estado entre pasos vive en la estantería (SQL y `blobs`) y en el
 * almacén (`<prefijo>trabajo/`). Las lecturas se graban (como en el motor
 * clásico), así que reintentar un paso no vuelve a pagar ninguna.
 */
import {
  consolidar, enviarLote, indexarTanda, leerTanda, metadatosTempranos, planificar, prepararDocumento, recogerLote,
  type ContextoTuberia, type Plan, type ResumenTanda, type Tanda,
} from '@scholaris/ingesta';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { EntradaIndice, EspacioVectorial, Lector, MetadatosDocumento, PaginaLeida } from '@scholaris/nucleo';
import { enParalelo } from '@scholaris/nucleo';
import type { ParamsIngesta } from '../puertos.js';
import {
  adelgazar, asegurarPaquete, fuenteDesdeAlmacen, inteligenciaConMemoria, leerPaquete, miniPaquete, trabajo, type ContextoMotor,
} from './motor-ingesta.js';

export type ModoIngesta = 'rapido' | 'economico';

export interface InfoTuberia {
  paquete: string;
  modo: Plan['modo'];
  economico: boolean;
  unidades: number;
  tandas: Array<{ id: number; clase: Tanda['clase']; desde: number; hasta: number }>;
  /** Para la cuota: páginas o minutos. */
  coste: number;
  original?: string;
  mime?: string;
  bytes?: number;
}

const clavePlan = (p: ParamsIngesta) => `${trabajo(p)}plan.json`;
const claveTanda = (p: ParamsIngesta, id: number) => `${trabajo(p)}tandas/${id}.json`;
const claveLote = (p: ParamsIngesta, k: string) => `${trabajo(p)}lote/${k}.json`;

async function leerJson<T>(ctx: ContextoMotor, clave: string): Promise<T | null> {
  const b = await ctx.almacen.bytes(clave);
  return b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null;
}

/** Los puertos de la tubería sobre los de la plataforma. */
function contexto(ctx: ContextoMotor, params: ParamsIngesta, paquete: PaqueteConversion, plan: Plan, pendientes: { vectores: boolean }): ContextoTuberia {
  const ia = inteligenciaConMemoria(ctx.inteligencia, ctx.almacen, trabajo(params), ctx.gemini);
  const extra = ctx.inteligencia as typeof ctx.inteligencia & { lotes?: ContextoTuberia['puertos']['lotes']; lectorEconomico?: Lector };
  const base = ia.embebedor.espacio.id;
  return {
    paquete,
    plan,
    documento: params.documento,
    puertos: {
      inteligencia: ia,
      ...(extra.lectorEconomico ? { lectorEconomico: extra.lectorEconomico } : {}),
      ...(extra.lotes ? { lotes: extra.lotes } : {}),
      fuente: fuenteDesdeAlmacen(ctx.almacen, params, paquete),
      sql: ctx.sql,
      ...(ctx.indice ? {
        indice: {
          // El índice nunca tira la ingesta: si falla, se apunta y la cola lo reintenta.
          insertar: async (espacio: EspacioVectorial, entradas: EntradaIndice[]) => {
            if (espacio.id !== base || pendientes.vectores) return;
            try { await ctx.indice!.insertar(ctx.espacioNombres, entradas); } catch (e) {
              pendientes.vectores = true;
              console.error(JSON.stringify({ nivel: 'aviso', que: 'indice_vectorial', error: (e as Error).message }));
            }
          },
          borrar: async (espacio: EspacioVectorial, ids: string[]) => {
            if (espacio.id === base) await ctx.indice!.borrar(ctx.espacioNombres, ids).catch(() => undefined);
          },
        },
      } : {}),
      guardarBlob: async (clave, datos) => { await ctx.almacen.poner(`${params.prefijo}${clave}`, datos.bytes, datos.mime); },
      ...(ctx.correoContacto ? { correoContacto: ctx.correoContacto } : {}),
    },
    opciones: {
      ...(params.pista ? { pista: params.pista } : {}),
      ...(params.bibliotecas?.length ? { bibliotecas: params.bibliotecas } : {}),
      ...(ctx.sinVerificacion ? { sinVerificacion: true } : {}),
    },
  };
}

/** Metadatos ya sacados por la tanda de la primera página (los guarda la tubería en `blobs`). */
async function metadatosGuardados(ctx: ContextoMotor, documento: string): Promise<MetadatosDocumento | null> {
  const [f] = await ctx.sql.ejecutar<{ datos: Uint8Array | string }>('SELECT datos FROM blobs WHERE clave = ?', `trabajo/${documento}/metadatos.json`);
  if (!f) return null;
  try {
    const texto = typeof f.datos === 'string' ? f.datos : new TextDecoder().decode(f.datos);
    return (JSON.parse(texto) as { metadatos?: MetadatosDocumento }).metadatos ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

export async function prepararTuberia(ctx: ContextoMotor, params: ParamsIngesta & { modo?: ModoIngesta }): Promise<InfoTuberia> {
  const { clave, descargado } = await asegurarPaquete(ctx, params);
  const paquete = adelgazar(await leerPaquete(ctx.almacen, clave));
  const ligero = `${trabajo(params)}paquete.ligero.json`;
  await ctx.almacen.poner(ligero, JSON.stringify(paquete), 'application/json');
  // Pliegos de dos páginas: la salida del lector manda en la latencia, y la primera página llega antes.
  const plan = planificar(paquete, { modo: params.modo ?? 'rapido', paginasPorPliego: 2 });
  await ctx.almacen.poner(clavePlan(params), JSON.stringify(plan), 'application/json');
  // Un fichero pequeño por tanda: cada paso carga solo sus páginas (128 MB por aislamiento).
  await enParalelo(plan.tandas, 16, (t) => ctx.almacen.poner(claveTanda(params, t.id), JSON.stringify({
    tanda: t, paquete: t.clase === 'pliego' || t.clase === 'capa' ? miniPaquete(paquete, t.desde, t.hasta) : paquete,
  }), 'application/json'));
  await prepararDocumento(contexto(ctx, params, paquete, plan, { vectores: false }));
  // Mientras se lee: el total, y el título y los autores del propio fichero en vez del nombre del archivo.
  await ctx.sql.ejecutar('UPDATE documentos SET unidades = ? WHERE id = ?', plan.unidades, params.documento);
  const ficha = paquete.metadatos;
  if (ficha?.titulo && ficha.titulo.trim().length > 2) {
    const [d] = await ctx.sql.ejecutar<{ metadatos: string }>('SELECT metadatos FROM documentos WHERE id = ?', params.documento);
    if (d) {
      const m = { ...(JSON.parse(d.metadatos) as Record<string, unknown>), titulo: ficha.titulo.trim(), ...(ficha.autores?.length ? { autores: ficha.autores } : {}) };
      await ctx.sql.ejecutar('UPDATE documentos SET metadatos = ?, titulo = ? WHERE id = ?', JSON.stringify(m), ficha.titulo.trim(), params.documento);
    }
  }
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  const coste = plan.modo === 'medio' ? Math.ceil((paquete.duracion ?? plan.tramos.length * 600) / 60) : plan.unidades;
  return {
    paquete: ligero, modo: plan.modo, economico: (params.modo ?? 'rapido') === 'economico', unidades: plan.unidades, coste,
    tandas: plan.tandas.map((t) => ({ id: t.id, clase: t.clase, desde: t.desde, hasta: t.hasta })),
    ...(descargado ?? {}),
  };
}

/** Modo económico: manda las páginas difíciles a la API por lotes. */
export async function enviarLoteTuberia(ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia): Promise<string | null> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  return enviarLote(contexto(ctx, params, paquete, plan, { vectores: false }));
}

/** ¿Está el lote? Si sí, sus resultados quedan en el almacén, uno por pliego. */
export async function recogerLoteTuberia(ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia, id: string): Promise<{ listo: boolean; error?: string }> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  const r = await recogerLote(contexto(ctx, params, paquete, plan, { vectores: false }), id);
  if (!r.listo) return { listo: false };
  for (const [k, paginas] of Object.entries(r.resultados ?? {})) await ctx.almacen.poner(claveLote(params, k), JSON.stringify(paginas), 'application/json');
  return { listo: true, ...(r.error ? { error: r.error } : {}) };
}

export interface ResultadoTanda extends ResumenTanda { vectoresPendientes?: boolean }

/** Una tanda: leer (grabado) e indexar. Legible y buscable al terminar. */
export async function procesarTanda(
  ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia, id: number,
  avisos: { alBuscables?: (r: ResumenTanda) => Promise<void> | void } = {},
): Promise<ResultadoTanda> {
  const f = await leerJson<{ tanda: Tanda; paquete: PaqueteConversion }>(ctx, claveTanda(params, id));
  const plan = await leerJson<Plan>(ctx, clavePlan(params));
  if (!f || !plan) throw new Error(`Falta el trabajo de la tanda ${id}`);
  const pendientes = { vectores: false };
  const ctxT = contexto(ctx, params, f.paquete, plan, pendientes);
  const t = f.tanda;
  // Modo económico: lo que trajo la API por lotes para este pliego, si lo trajo.
  let resultadosLote: Record<string, PaginaLeida[]> | undefined;
  if (info.economico && t.clase === 'pliego') {
    const pl = plan.pliegos.find((p) => p.id === t.pliego);
    const k = pl ? `${pl.desde}-${pl.hasta}` : '';
    const r = k ? await leerJson<PaginaLeida[]>(ctx, claveLote(params, k)) : null;
    if (r) resultadosLote = { [k]: r };
  }
  const lectura = await leerTanda(t, ctxT, resultadosLote ? { resultadosLote } : {});
  // La tanda de la primera página saca los metadatos; las demás los usan si ya están.
  // Sin esperarlos: la tanda escribe antes sus unidades y su texto (legible y buscable)
  // y luego espera a los metadatos para el contexto y los vectores.
  const guardados = await metadatosGuardados(ctx, params.documento);
  const primera = (t.clase === 'tramo' ? t.tramo === 1 : t.desde <= 1) || info.tandas[0]?.id === id;
  const metadatos: Promise<MetadatosDocumento | null> | MetadatosDocumento | null = guardados ?? (primera && lectura.unidades.length
    ? metadatosTempranos(ctxT, lectura.unidades.slice(0, 5)).then((m) => m.metadatos).catch(() => null)
    : null);
  const r = await indexarTanda(t, lectura, ctxT, { metadatos, alBuscables: (b) => { void Promise.resolve(avisos.alBuscables?.(b)).catch(() => undefined); } });
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return { ...r, ...(pendientes.vectores ? { vectoresPendientes: true } : {}) };
}

export interface ResumenConsolidacion {
  unidades: number;
  fragmentos: number;
  secciones: number;
  figuras: number;
  reaprovechados: number;
  vectores: Record<string, number>;
  tiempos: Record<string, number>;
  vectoresPendientes?: boolean;
}

export async function consolidarTuberia(ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia): Promise<ResumenConsolidacion> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  const pendientes = { vectores: false };
  const metadatos = await metadatosGuardados(ctx, params.documento);
  const r = await consolidar(contexto(ctx, params, paquete, plan, pendientes), { metadatos });
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return {
    unidades: r.unidades.length, fragmentos: r.fragmentos.length, secciones: r.secciones.length, figuras: r.figuras.length,
    reaprovechados: r.reaprovechados, vectores: r.vectores, tiempos: r.tiempos,
    ...(pendientes.vectores ? { vectoresPendientes: true } : {}),
  };
}
