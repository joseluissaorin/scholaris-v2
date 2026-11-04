/**
 * El paso transmedia del flujo de comprensión (docs/COMPRENSION.md, paso 7) y la
 * pasada por toda la biblioteca:
 *
 * - `pasoTransmedia`: detecta las relaciones de un documento con el resto y dice
 *   cuáles quedan por alinear (las dos obras comprendidas y sin alineación vigente).
 * - `alinearRelacion`: la alineación gruesa y fina de una relación y su ficha. Una
 *   sola a la vez por relación (un cerrojo en la procedencia: dos comprensiones que
 *   terminan juntas no pagan dos veces) e idempotente por huella: si las dos obras
 *   no han cambiado, no se repite.
 * - `transmediaBiblioteca`: lo mismo para todos los pares de la biblioteca.
 *
 * El estado de cada alineación vive en la procedencia del documento de origen
 * (`transmedia:alineacion:<relación>`), con su coste.
 */
import { enParalelo, nuevoId, type Documento, type Relacion, type Vector } from '@scholaris/nucleo';
import { escribirAlineaciones, escribirFichas, leerDocumento, leerRelaciones } from '@scholaris/spdf';
import { leerEstadoComprension } from '../comprension/estado.js';
import type { ContextoComprension, UsoModelo } from '../comprension/tipos.js';
import { textoVectorFicha } from '../comprension/indexado.js';
import { huella } from '../comprension/util.js';
import { entradasIndice, escribirEspacio, escribirVectores } from '../pasos/indexado.js';
import { vectorizar } from '../pasos/vectores.js';
import { alinearObras } from './alineacion.js';
import { detectarRelaciones } from './deteccion.js';
import { fichaRelacion } from './ficha.js';
import { materialObra } from './material.js';
import { medioDe } from './obras.js';
import { leerRelacion } from './relaciones.js';
import { alinearTraduccion } from './traduccion.js';
import { VERSION_TRANSMEDIA, type EstadoAlineacion, type OpcionesAlineacion, type OpcionesDeteccion, type ResultadoTransmedia } from './tipos.js';

const ahoraDe = (ctx: Pick<ContextoComprension, 'ahora'>) => (ctx.ahora?.() ?? new Date()).toISOString();
const vaciar = async (ctx: ContextoComprension) => { await (ctx.sql as { vaciarPendientes?(): Promise<void> }).vaciarPendientes?.(); };
const fase = (rel: string) => `transmedia:alineacion:${rel}`;
/** Una alineación «en marcha» que lleva más de esto sin moverse se da por muerta. */
const CERROJO_MS = 45 * 60_000;

/** Tipos que se alinean (las citas y lo «relacionado» no tienen correspondencia tramo a tramo). */
export const SE_ALINEAN = new Set<Relacion['tipo']>(['adaptacion_de', 'traduccion_de', 'edicion_de', 'version_de', 'misma_obra']);

/** Una traducción entre textos se alinea por párrafos: no necesita la comprensión de las dos obras. */
const porParrafos = (rel: Relacion, a: Documento, b: Documento) => (rel.tipo === 'traduccion_de' || rel.tipo === 'edicion_de' || rel.tipo === 'misma_obra') && medioDe(a) === 'texto' && medioDe(b) === 'texto';

export async function leerEstadoAlineacion(ctx: Pick<ContextoComprension, 'sql'>, rel: Pick<Relacion, 'id' | 'origen'>): Promise<EstadoAlineacion | null> {
  const [f] = await ctx.sql.ejecutar<{ detalle: string }>('SELECT detalle FROM procedencia WHERE documento = ? AND fase = ? ORDER BY rowid DESC LIMIT 1', rel.origen, fase(rel.id));
  if (!f) return null;
  try { return JSON.parse(String(f.detalle)) as EstadoAlineacion; } catch { return null; }
}

async function escribirEstado(ctx: ContextoComprension, rel: Relacion, e: EstadoAlineacion): Promise<void> {
  await ctx.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ?', rel.origen, fase(rel.id));
  await ctx.sql.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)', rel.origen, fase(rel.id), e.modelo ?? null, JSON.stringify(e), null, e.actualizado);
  await vaciar(ctx);
}

/** Huella de lo que entra en la alineación: si las obras (o su comprensión) cambian, se rehace. */
export async function huellaRelacion(ctx: ContextoComprension, rel: Relacion): Promise<string> {
  const partes: unknown[] = [VERSION_TRANSMEDIA, rel.tipo, rel.origen, rel.destino];
  for (const d of [rel.origen, rel.destino]) {
    const doc = await leerDocumento(ctx.sql, d);
    const [u] = await ctx.sql.ejecutar<{ n: number; c: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(texto)), 0) AS c FROM unidades WHERE documento = ?', d);
    const e = doc && rel.tipo === 'traduccion_de' && medioDe(doc) === 'texto' ? null : await leerEstadoComprension(ctx.sql, d);
    partes.push([doc?.estado, u?.n, u?.c, e?.estado === 'hecho' ? [e.version, e.huella, e.huellaPercepcion] : null]);
  }
  return huella(JSON.stringify(partes));
}

/** ¿Está lista para alinear? Las dos obras listas y, salvo en los textos que se alinean por párrafos, comprendidas. */
export async function lista(ctx: ContextoComprension, rel: Relacion): Promise<boolean> {
  if (!SE_ALINEAN.has(rel.tipo)) return false;
  const [a, b] = [await leerDocumento(ctx.sql, rel.origen), await leerDocumento(ctx.sql, rel.destino)];
  if (!a || !b || a.estado !== 'listo' || b.estado !== 'listo') return false;
  if (porParrafos(rel, a, b)) return true;
  for (const d of [rel.origen, rel.destino]) if ((await leerEstadoComprension(ctx.sql, d))?.estado !== 'hecho') return false;
  return true;
}

/** Relaciones (de un documento o de toda la biblioteca) que hay que alinear ahora. */
export async function relacionesPorAlinear(ctx: ContextoComprension, documento?: string, o: { forzar?: boolean } = {}): Promise<string[]> {
  const salida: string[] = [];
  for (const rel of await leerRelaciones(ctx.sql, documento)) {
    if (!(await lista(ctx, rel))) continue;
    const e = await leerEstadoAlineacion(ctx, rel);
    if (e?.estado === 'en_marcha' && Date.now() - Date.parse(e.actualizado) < CERROJO_MS) continue;
    if (!o.forzar && e?.estado === 'hecho' && e.huella === await huellaRelacion(ctx, rel)) continue;
    salida.push(rel.id);
  }
  return salida;
}

/**
 * Toma el cerrojo de una relación: un INSERT condicional (una sola sentencia,
 * atómica en la estantería) y después se comprueba de quién quedó.
 */
async function tomarCerrojo(ctx: ContextoComprension, rel: Relacion, instancia: string, huellaActual: string, ahora: string): Promise<boolean> {
  const limite = new Date(Date.parse(ahora) - CERROJO_MS).toISOString();
  const e: EstadoAlineacion = {
    relacion: rel.id, estado: 'en_marcha', version: VERSION_TRANSMEDIA, huella: huellaActual, instancia, alineaciones: 0, gruesas: 0, descartadas: 0,
    usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 0, avisos: [], iniciado: ahora, actualizado: ahora,
  };
  await ctx.sql.ejecutar(
    `INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando)
     SELECT ?, ?, NULL, ?, NULL, ? WHERE NOT EXISTS (
       SELECT 1 FROM procedencia WHERE documento = ? AND fase = ? AND json_extract(detalle, '$.estado') = 'en_marcha' AND json_extract(detalle, '$.instancia') <> ? AND cuando > ?)`,
    rel.origen, fase(rel.id), JSON.stringify(e), ahora, rel.origen, fase(rel.id), instancia, limite,
  );
  const filas = await ctx.sql.ejecutar<{ detalle: string; rowid: number }>('SELECT rowid, detalle FROM procedencia WHERE documento = ? AND fase = ? ORDER BY rowid DESC', rel.origen, fase(rel.id));
  const mia = filas.find((f) => { try { return (JSON.parse(String(f.detalle)) as EstadoAlineacion).instancia === instancia; } catch { return false; } });
  if (!mia) return false;
  const otraViva = filas.some((f) => {
    try { const x = JSON.parse(String(f.detalle)) as EstadoAlineacion; return x.instancia !== instancia && x.estado === 'en_marcha' && x.actualizado > limite; } catch { return false; }
  });
  if (otraViva) return false;
  // Fuera los estados anteriores (el «hecho» de otra pasada, un cerrojo caducado).
  await ctx.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ? AND rowid <> ?', rel.origen, fase(rel.id), Number(mia.rowid));
  await vaciar(ctx);
  return true;
}

/** Vectoriza la ficha de la relación (en el documento de origen: el buscador la encuentra al filtrar por él). */
async function indexarFichaRelacion(ctx: ContextoComprension, rel: Relacion, ficha: Parameters<typeof textoVectorFicha>[0]): Promise<void> {
  const emb = ctx.embebedor;
  if (!emb?.admite('texto') || !ficha.texto.trim()) return;
  const doc = await leerDocumento(ctx.sql, rel.origen);
  if (!doc) return;
  const vectores: Vector[] = [];
  await vectorizar([{ objetivo: 'ficha' as const, id: ficha.id, texto: textoVectorFicha(ficha) }], emb, { parte: async () => null }, async (vs) => { vectores.push(...vs); }, { concurrencia: 1 });
  await escribirEspacio(ctx.sql, emb.espacio);
  await escribirVectores(ctx.sql, rel.origen, vectores);
  if (ctx.indice && ctx.espacioNombres) {
    const base = vectores.filter((v) => v.espacio === ctx.indice!.espacio.id);
    if (base.length) await ctx.indice.insertar(ctx.espacioNombres, entradasIndice(doc, base)).catch(() => undefined);
  }
}

export interface ResultadoAlinear {
  relacion: string;
  estado: 'hecho' | 'ocupada' | 'al_dia' | 'no_se_alinea' | 'error';
  alineaciones: number;
  gruesas: number;
  ficha: boolean;
  usd: number;
  avisos: string[];
}

/** Alinea una relación (gruesa, fina o por párrafos) y escribe su ficha. */
export async function alinearRelacion(ctx: ContextoComprension, relacion: string, o: OpcionesAlineacion = {}): Promise<ResultadoAlinear> {
  const rel = await leerRelacion(ctx.sql, relacion);
  const vacio = (estado: ResultadoAlinear['estado'], avisos: string[] = []): ResultadoAlinear => ({ relacion, estado, alineaciones: 0, gruesas: 0, ficha: false, usd: 0, avisos });
  if (!rel) return vacio('error', ['La relación ya no existe.']);
  if (!(await lista(ctx, rel))) return vacio('no_se_alinea');
  const ahora = ahoraDe(ctx);
  const h = await huellaRelacion(ctx, rel);
  const previo = await leerEstadoAlineacion(ctx, rel);
  if (!o.forzar && previo?.estado === 'hecho' && previo.huella === h) return { ...vacio('al_dia'), alineaciones: previo.alineaciones, gruesas: previo.gruesas, usd: 0 };
  const instancia = o.instancia ?? `tmd-${nuevoId()}`;
  if (!(await tomarCerrojo(ctx, rel, instancia, h, ahora))) return vacio('ocupada');
  const acumulado: { uso: UsoModelo } = { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } };
  const avisos: string[] = [];
  const estado = (cambios: Partial<EstadoAlineacion>): EstadoAlineacion => ({
    relacion: rel.id, estado: 'en_marcha', version: VERSION_TRANSMEDIA, huella: h, instancia, alineaciones: 0, gruesas: 0, descartadas: 0,
    usd: Math.round(acumulado.uso.usd * 1e5) / 1e5, tokensEntrada: acumulado.uso.tokensEntrada, tokensSalida: acumulado.uso.tokensSalida, llamadas: acumulado.uso.llamadas,
    ...(acumulado.uso.modelo ? { modelo: acumulado.uso.modelo } : {}), avisos, iniciado: ahora, actualizado: ahoraDe(ctx), ...cambios,
  });
  try {
    const [a, b] = [await materialObra(ctx, rel.origen, 'A'), await materialObra(ctx, rel.destino, 'B')];
    const calidad = o.calidad ?? 'alta';
    const presupuestoUsd = o.presupuestoUsd ?? 4;
    let alineaciones;
    let gruesas: Awaited<ReturnType<typeof alinearObras>>['gruesas'] = [];
    let prefijo: { texto: string; largo: boolean } | null = null;
    let descartadas = 0;
    if (porParrafos(rel, a.m.documento, b.m.documento)) {
      // Las ventanas de párrafos de una traducción van con el modelo rápido salvo que se pida otro (son muchas y sencillas).
      const r = await alinearTraduccion(rel, a, b, ctx.modelo, acumulado, { calidad: o.calidad ?? 'rapida', concurrencia: o.concurrencia ?? 4, presupuestoUsd });
      alineaciones = r.alineaciones;
      avisos.push(...r.avisos);
    } else {
      const r = await alinearObras(rel, a, b, ctx.modelo, acumulado, { calidad, concurrencia: o.concurrencia ?? 4, presupuestoUsd, ...(o.maxCaracteres ? { maxCaracteres: o.maxCaracteres } : {}) });
      alineaciones = r.alineaciones; gruesas = r.gruesas; prefijo = r.prefijo; descartadas = r.descartadas;
      avisos.push(...r.avisos);
    }
    // Sustituye las alineaciones anteriores de la relación.
    await ctx.sql.ejecutar('DELETE FROM alineaciones WHERE relacion = ?', rel.id);
    for (let i = 0; i < alineaciones.length; i += 200) await escribirAlineaciones(ctx.sql, alineaciones.slice(i, i + 200));
    await escribirEstado(ctx, rel, estado({ alineaciones: alineaciones.length, gruesas: gruesas.length, descartadas }));
    let conFicha = false;
    if ((o.ficha ?? true) && ctx.modelo && acumulado.uso.usd <= presupuestoUsd * 1.25) {
      try {
        const { prefijoRelacion } = await import('./alineacion.js');
        const pre = prefijo ?? prefijoRelacion(rel, a, b, o.maxCaracteres ? { maxCaracteres: o.maxCaracteres } : {});
        const f = await fichaRelacion(ctx, rel, a, b, gruesas, alineaciones, ctx.modelo, acumulado, { prefijo: pre.texto, calidad: o.calidadFicha ?? 'alta', creada: ahoraDe(ctx) });
        if (f.ficha.texto) {
          await escribirFichas(ctx.sql, [f.ficha]);
          await indexarFichaRelacion(ctx, rel, f.ficha).catch(() => { avisos.push('La ficha de la relación no llegó al índice de vectores: se busca por texto.'); });
          conFicha = true;
        }
        descartadas += f.descartadas;
      } catch (e) { avisos.push(`No se pudo escribir la ficha de la relación (${(e as Error).message.slice(0, 120)}).`); }
    }
    const fin = estado({ estado: 'hecho', alineaciones: alineaciones.length, gruesas: gruesas.length, descartadas });
    await escribirEstado(ctx, rel, fin);
    return { relacion: rel.id, estado: 'hecho', alineaciones: alineaciones.length, gruesas: gruesas.length, ficha: conFicha, usd: fin.usd, avisos };
  } catch (e) {
    const mensaje = (e as Error).message.slice(0, 300);
    await escribirEstado(ctx, rel, estado({ estado: 'error', error: mensaje })).catch(() => undefined);
    return { ...vacio('error', [...avisos, mensaje]), usd: acumulado.uso.usd };
  }
}

/** Paso del Workflow: las relaciones del documento con la biblioteca y las que quedan por alinear. */
export async function pasoTransmedia(ctx: ContextoComprension, documento: string, o: OpcionesDeteccion & { forzar?: boolean } = {}): Promise<ResultadoTransmedia> {
  const d = await detectarRelaciones(ctx, documento, o);
  await vaciar(ctx);
  return { relaciones: d.relaciones.length, nuevas: d.nuevas, porAlinear: await relacionesPorAlinear(ctx, documento, o.forzar ? { forzar: true } : {}), avisos: d.avisos };
}

/** Lo mismo para toda la biblioteca (o unos documentos): detección par a par. */
export async function pasoTransmediaBiblioteca(ctx: ContextoComprension, o: OpcionesDeteccion & { forzar?: boolean; documentos?: string[] } = {}): Promise<ResultadoTransmedia> {
  const d = await detectarRelaciones(ctx, null, { ...o, ...(o.documentos?.length ? { con: o.documentos } : {}) });
  await vaciar(ctx);
  const ids = new Set(d.relaciones.map((r) => r.id));
  const porAlinear = (await relacionesPorAlinear(ctx, undefined, o.forzar ? { forzar: true } : {})).filter((id) => !o.documentos?.length || ids.has(id));
  return { relaciones: d.relaciones.length, nuevas: d.nuevas, porAlinear, avisos: d.avisos };
}

/** En un solo proceso (local, pruebas, guion): detectar y alinear lo que toque. */
export async function transmediaEnProceso(
  ctx: ContextoComprension, documento: string | null, o: OpcionesDeteccion & OpcionesAlineacion & { documentos?: string[]; alinear?: boolean } = {},
): Promise<{ deteccion: ResultadoTransmedia; alineadas: ResultadoAlinear[] }> {
  const deteccion = documento ? await pasoTransmedia(ctx, documento, o) : await pasoTransmediaBiblioteca(ctx, o);
  if (o.alinear === false) return { deteccion, alineadas: [] };
  const alineadas = await enParalelo(deteccion.porAlinear, 2, (id) => alinearRelacion(ctx, id, o));
  return { deteccion, alineadas };
}
