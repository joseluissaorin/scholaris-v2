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
  consolidacionRegistrada, consolidar, enviarLote, ErrorFaltaTanda, indexarTanda, leerTanda, metadatosTempranos, planificar, prepararDocumento, recogerLote,
  type ContextoTuberia, type Plan, type ResumenTanda, type Tanda,
} from '@scholaris/ingesta';
import type { Plan as PlanUsuario } from '@scholaris/contrato';
import { completarTranscripcionEn } from './transcripcion.js';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { EntradaIndice, EspacioVectorial, Lector, MetadatosDocumento, PaginaLeida } from '@scholaris/nucleo';
import { enParalelo } from '@scholaris/nucleo';
import type { ParamsIngesta } from '../puertos.js';
import {
  adelgazar, asegurarPaquete, fuenteDesdeAlmacen, inteligenciaConMemoria, lectorConMemoria, leerPaquete, miniPaquete, trabajo, type ContextoMotor,
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
  /**
   * Cuándo se preparó esta ingesta (ISO). Separa la consolidación de esta ingesta
   * de la de una anterior del mismo documento (ver `consolidarTuberia`).
   */
  preparado?: string;
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
      // También grabado: un reintento o un relanzamiento no vuelve a pagar las páginas fáciles.
      ...(extra.lectorEconomico ? { lectorEconomico: lectorConMemoria(extra.lectorEconomico, ctx.almacen, `${trabajo(params)}economico/`) } : {}),
      ...(extra.lotes ? { lotes: extra.lotes } : {}),
      fuente: fuenteDesdeAlmacen(ctx.almacen, params, paquete, ctx.recortar),
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
      ...(ctx.catalogos ? { catalogos: ctx.catalogos } : {}),
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
    preparado: new Date().toISOString(),
    tandas: plan.tandas.map((t) => ({ id: t.id, clase: t.clase, desde: t.desde, hasta: t.hasta })),
    ...(descargado ?? {}),
  };
}

/**
 * Completa la transcripción de un medio antes de consolidarlo (percepcion/NOTAS.md):
 * cobertura contra el mapa de la voz, huecos en subventanas de 75 s como mucho
 * (Gemini mirando el proxy; si no, la reserva con el audio recortado), unidades
 * con el tiempo roto y, si ya hay percepción y el plan lo permite, los hablantes.
 * Lo deja en el estado de trabajo para `consolidar` y guarda la revisión (aplicada).
 * Cada llamada queda grabada: un reintento no vuelve a pagar nada.
 */
export async function completarTranscripcionTuberia(
  ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia,
  o: { plan: PlanUsuario; alProgreso?: (p: { fase: 'huecos' | 'hablantes'; hechas: number; total: number; usd: number }) => void | Promise<void> },
): Promise<Record<string, unknown>> {
  if (info.modo !== 'medio') return { omitida: 'no es un medio' };
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  const r = await completarTranscripcionEn(ctx, contexto(ctx, params, paquete, plan, { vectores: false }), params, o);
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return r;
}

/** Modo económico: manda las páginas difíciles a la API por lotes. */
/** Pliegos por lote de Gemini: con todas las páginas en uno, el lote (imágenes, base64 y JSON) no cabe en 128 MB. */
const PLIEGOS_POR_LOTE = 4;

export async function enviarLoteTuberia(ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia): Promise<string | null> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  // Varios lotes pequeños, uno detrás de otro (la memoria de cada uno se libera antes del siguiente);
  // el id que se devuelve es la lista, separada por comas.
  const ids: string[] = [];
  for (let i = 0; i < plan.pliegos.length; i += PLIEGOS_POR_LOTE) {
    const parte: Plan = { ...plan, pliegos: plan.pliegos.slice(i, i + PLIEGOS_POR_LOTE) };
    const id = await enviarLote(contexto(ctx, params, paquete, parte, { vectores: false }));
    if (id) ids.push(id);
  }
  return ids.length ? ids.join(',') : null;
}

/** ¿Está el lote? Si sí, sus resultados quedan en el almacén, uno por pliego. */
export async function recogerLoteTuberia(ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia, id: string): Promise<{ listo: boolean; error?: string }> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  const errores: string[] = [];
  let pendientes = 0;
  for (const uno of id.split(',').filter(Boolean)) {
    // Los lotes ya recogidos dejan su marca y no se vuelven a descargar.
    if (await ctx.almacen.existe(claveLote(params, `hecho-${uno.replace(/[^\w-]+/g, '_')}`))) continue;
    const r = await recogerLote(contexto(ctx, params, paquete, plan, { vectores: false }), uno);
    if (!r.listo) { pendientes++; continue; }
    for (const [k, paginas] of Object.entries(r.resultados ?? {})) await ctx.almacen.poner(claveLote(params, k), JSON.stringify(paginas), 'application/json');
    await ctx.almacen.poner(claveLote(params, `hecho-${uno.replace(/[^\w-]+/g, '_')}`), '{}', 'application/json');
    if (r.error) errores.push(r.error);
  }
  if (pendientes) return { listo: false };
  return { listo: true, ...(errores.length ? { error: errores.join('; ') } : {}) };
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
  /**
   * La consolidación la terminó otro (un intento anterior que siguió trabajando):
   * no se sabe si su envío al índice llegó entero, así que conviene reindexar
   * (reenvía los vectores ya guardados; no vuelve a pagar ninguno).
   */
  recuperada?: boolean;
}

/**
 * Cuánto puede tardar el paso «consolidar», en segundos.
 *
 * En los libros manda el número de páginas. En audio y vídeo las unidades del
 * plan son los tramos de diez minutos, que no dicen nada del trabajo: consolidar
 * rehace la transcripción entera, la escucha otra vez donde suena mal, sitúa cada
 * fragmento y vectoriza un fotograma por escena. Ahí manda la duración: casi dos
 * horas de película (12 tramos) se quedaban en 144 s y necesitaban unos 6 minutos.
 */
export function plazoConsolidacion(info: Pick<InfoTuberia, 'modo' | 'unidades' | 'coste'>): number {
  const s = info.modo === 'medio' ? 300 + 8 * info.coste : 120 + 2 * info.unidades;
  return Math.min(3600, Math.max(120, Math.ceil(s)));
}

export async function consolidarTuberia(ctx: ContextoMotor, params: ParamsIngesta, info: InfoTuberia): Promise<ResumenConsolidacion> {
  const paquete = await leerPaquete(ctx.almacen, info.paquete);
  const plan = (await leerJson<Plan>(ctx, clavePlan(params)))!;
  const pendientes = { vectores: false };
  const metadatos = await metadatosGuardados(ctx, params.documento);
  let resumen: Omit<ResumenConsolidacion, 'vectoresPendientes'>;
  try {
    const r = await consolidar(contexto(ctx, params, paquete, plan, pendientes), { metadatos });
    resumen = {
      unidades: r.unidades.length, fragmentos: r.fragmentos.length, secciones: r.secciones.length, figuras: r.figuras.length,
      reaprovechados: r.reaprovechados, vectores: r.vectores, tiempos: r.tiempos,
    };
  } catch (e) {
    // Las tandas ya no están porque otra consolidación de esta misma ingesta terminó
    // y limpió el trabajo (un paso que caducó y siguió trabajando, o el relanzamiento
    // del vigilante): el documento está hecho. Se recoge su resultado en vez de fallar.
    const faltaTanda = e instanceof ErrorFaltaTanda || (e instanceof Error && e.name === 'ErrorFaltaTanda');
    const hecha = faltaTanda && info.preparado ? await consolidacionRegistrada(ctx.sql, params.documento, info.preparado) : null;
    if (!hecha) throw e;
    const { cuando: _c, ...cuentas } = hecha;
    resumen = { ...cuentas, recuperada: true };
  }
  // Un medio sin duración conocida (YouTube cuando su API no responde): la del final de lo transcrito.
  if (plan.modo === 'medio' && !paquete.duracion) {
    const [f] = await ctx.sql.ejecutar<{ fin: number | null }>("SELECT max(CAST(json_extract(ancla, '$.t1') AS REAL)) AS fin FROM unidades WHERE documento = ?", params.documento);
    if (f?.fin && f.fin > 0 && f.fin < 1e6) await ctx.sql.ejecutar('UPDATE documentos SET duracion = ? WHERE id = ? AND (duracion IS NULL OR duracion = 0)', Math.ceil(f.fin), params.documento);
  }
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return { ...resumen, ...(pendientes.vectores ? { vectoresPendientes: true } : {}) };
}
