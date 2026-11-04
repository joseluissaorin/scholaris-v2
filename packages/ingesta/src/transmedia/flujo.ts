/**
 * El paso transmedia del flujo de comprensión (docs/COMPRENSION.md, paso 7) y la
 * pasada por toda la biblioteca:
 *
 * - `pasoTransmedia`: detecta las relaciones de un documento con el resto y dice
 *   cuáles quedan por alinear (las dos obras comprendidas y sin alineación vigente).
 * - `alinearRelacion`: la alineación gruesa y fina de una relación y su ficha.
 * - `transmediaBiblioteca`: lo mismo para todos los pares de la biblioteca.
 *
 * La alineación (incidente del 4-11-2026: el Durable Object se quedó sin memoria a
 * mitad y la relación se quedó «en marcha» para siempre):
 *
 * - Memoria acotada: de cada obra solo lo ligero (`material.ts`); el texto, por grupos.
 * - Durable y reanudable: la gruesa se guarda en cuanto sale; cada grupo fino (o cada
 *   ventana de párrafos) escribe sus alineaciones y deja constancia al acabar. Un
 *   reintento con la misma huella reanuda donde quedó y no paga dos veces lo hecho.
 * - Cada llamada al modelo, acotada al plazo del paso; si se queda sin tiempo, se
 *   repite con el modelo rápido si queda margen, y los intentos siguientes van con él.
 * - Cualquier fallo deja el estado en «error» (con reintentos de la escritura) y se
 *   relanza: el Workflow reintenta el paso. Un «en marcha» sin moverse más de
 *   `CERROJO_MS` se da por muerto (nunca «Alineando…» para siempre).
 * - Una sola a la vez por relación (cerrojo en la procedencia) e idempotente por huella.
 *
 * El estado vive en la procedencia del documento de origen: `transmedia:alineacion:<relación>`
 * (estado y coste), `transmedia:gruesa:<relación>` y `transmedia:grupo:<relación>:<clave>`.
 */
import { enParalelo, nuevoId, type Alineacion, type Documento, type Relacion, type Vector } from '@scholaris/nucleo';
import { escribirAlineaciones, escribirFichas, leerAlineaciones, leerDocumento, leerRelaciones } from '@scholaris/spdf';
import { leerEstadoComprension } from '../comprension/estado.js';
import { ErrorPlazo, MARGEN_PASO_MS, modeloDelPaso } from '../comprension/modelo.js';
import type { ContextoComprension, ModeloComprension, UsoModelo } from '../comprension/tipos.js';
import { textoVectorFicha } from '../comprension/indexado.js';
import { huella } from '../comprension/util.js';
import { entradasIndice, escribirEspacio, escribirVectores } from '../pasos/indexado.js';
import { vectorizar } from '../pasos/vectores.js';
import {
  alineacionesGruesas, alineacionFina, alineacionGruesa, alineacionGruesaProporcional, gruposFinos, posicionLado, prefijoRelacion, type AlineacionSinId,
} from './alineacion.js';
import { detectarRelaciones } from './deteccion.js';
import { fichaRelacion } from './ficha.js';
import { cargarTramo, ordenesDe, materialObra, type MaterialObra } from './material.js';
import { medioDe } from './obras.js';
import { leerRelacion } from './relaciones.js';
import { alineacionesDeVentana, parrafosDe, revisarVentana, ventanasDeTraduccion } from './traduccion.js';
import { VERSION_TRANSMEDIA, type CorrespondenciaGruesa, type EstadoAlineacion, type OpcionesAlineacion, type OpcionesDeteccion, type ResultadoTransmedia } from './tipos.js';

const ahoraDe = (ctx: Pick<ContextoComprension, 'ahora'>) => (ctx.ahora?.() ?? new Date()).toISOString();
const vaciar = async (ctx: ContextoComprension) => { await (ctx.sql as { vaciarPendientes?(): Promise<void> }).vaciarPendientes?.(); };
const fase = (rel: string) => `transmedia:alineacion:${rel}`;
const faseGruesa = (rel: string) => `transmedia:gruesa:${rel}`;
const faseGrupo = (rel: string, clave: string) => `transmedia:grupo:${rel}:${clave}`;
/** Una alineación «en marcha» que lleva más de esto sin moverse se da por muerta (cada grupo la refresca). */
export const CERROJO_MS = 15 * 60_000;
/** Tiempo máximo de una llamada de la alineación fina con el modelo alto (lo medido: 40-95 s). */
const POR_LLAMADA_MS = 240_000;

/** Tipos que se alinean (las citas y lo «relacionado» no tienen correspondencia tramo a tramo). */
export const SE_ALINEAN = new Set<Relacion['tipo']>(['adaptacion_de', 'traduccion_de', 'edicion_de', 'version_de', 'misma_obra']);

/** Una traducción entre textos se alinea por párrafos: no necesita la comprensión de las dos obras. */
const porParrafos = (rel: Relacion, a: Documento, b: Documento) => (rel.tipo === 'traduccion_de' || rel.tipo === 'edicion_de' || rel.tipo === 'misma_obra') && medioDe(a) === 'texto' && medioDe(b) === 'texto';

export async function leerEstadoAlineacion(ctx: Pick<ContextoComprension, 'sql'>, rel: Pick<Relacion, 'id' | 'origen'>): Promise<EstadoAlineacion | null> {
  const [f] = await ctx.sql.ejecutar<{ detalle: string }>('SELECT detalle FROM procedencia WHERE documento = ? AND fase = ? ORDER BY rowid DESC LIMIT 1', rel.origen, fase(rel.id));
  if (!f) return null;
  try { return JSON.parse(String(f.detalle)) as EstadoAlineacion; } catch { return null; }
}

/**
 * Escribe el estado (y lo manda ya a la estantería). Se reintenta: si la estantería
 * acaba de reiniciarse, la siguiente petición la encuentra en pie.
 */
async function escribirEstado(ctx: ContextoComprension, rel: Relacion, e: EstadoAlineacion, intentos = 3): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await ctx.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ?', rel.origen, fase(rel.id));
      await ctx.sql.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)', rel.origen, fase(rel.id), e.modelo ?? null, JSON.stringify(e), null, e.actualizado);
      await vaciar(ctx);
      return;
    } catch (x) {
      if (i >= intentos) throw x;
      await new Promise((r) => setTimeout(r, 1000 * i * i));
    }
  }
}

/** Un dato de la alineación en la procedencia del documento de origen (la gruesa, cada grupo hecho). */
async function guardarDato(ctx: ContextoComprension, rel: Relacion, f: string, detalle: unknown, ahora: string): Promise<void> {
  await ctx.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ?', rel.origen, f);
  await ctx.sql.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)', rel.origen, f, null, JSON.stringify(detalle), null, ahora);
}

async function leerDato<T>(ctx: ContextoComprension, rel: Relacion, f: string): Promise<T | null> {
  const [x] = await ctx.sql.ejecutar<{ detalle: string }>('SELECT detalle FROM procedencia WHERE documento = ? AND fase = ? ORDER BY rowid DESC LIMIT 1', rel.origen, f);
  if (!x) return null;
  try { return JSON.parse(String(x.detalle)) as T; } catch { return null; }
}

interface GrupoHecho { huella: string; clave: string; alineaciones: number; descartadas: number; gruesas: number[]; literales?: Array<{ id: string; a?: string; b?: string }> }

async function gruposHechos(ctx: ContextoComprension, rel: Relacion, h: string): Promise<Map<string, GrupoHecho>> {
  const filas = await ctx.sql.ejecutar<{ detalle: string }>('SELECT detalle FROM procedencia WHERE documento = ? AND fase LIKE ?', rel.origen, `${faseGrupo(rel.id, '')}%`);
  const salida = new Map<string, GrupoHecho>();
  for (const f of filas) {
    try { const g = JSON.parse(String(f.detalle)) as GrupoHecho; if (g.huella === h) salida.set(g.clave, g); } catch { /* fila rota: el grupo se rehace */ }
  }
  return salida;
}

/** Fuera lo de una pasada anterior: alineaciones y datos de la gruesa y de los grupos. */
async function limpiarRelacion(ctx: ContextoComprension, rel: Relacion): Promise<void> {
  await ctx.sql.ejecutar('DELETE FROM alineaciones WHERE relacion = ?', rel.id);
  await ctx.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND (fase = ? OR fase LIKE ?)', rel.origen, faseGruesa(rel.id), `${faseGrupo(rel.id, '')}%`);
  await vaciar(ctx);
}

/** El estado tal como se ve: un «en marcha» que no se mueve desde hace más de `CERROJO_MS` está muerto. */
export function estadoVigente(e: EstadoAlineacion | null, ahora = Date.now()): EstadoAlineacion | null {
  if (!e || e.estado !== 'en_marcha' || ahora - Date.parse(e.actualizado) < CERROJO_MS) return e;
  return { ...e, estado: 'error', error: e.error ?? 'La alineación se detuvo sin terminar. Vuelve a pedirla: lo ya hecho se aprovecha.' };
}

const esPlazo = (e: unknown) => e instanceof ErrorPlazo || /plazo|tiempo agotado|timed out/i.test((e as Error)?.message ?? '');
/** Fallos de la plataforma (la estantería reiniciada, la red): el paso entero se reintenta. */
const esDeLaPlataforma = (e: unknown) => /Durable Object|isolate|memory limit|reset|Network connection lost|internal error/i.test((e as Error)?.message ?? '');

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
async function tomarCerrojo(ctx: ContextoComprension, rel: Relacion, e: EstadoAlineacion, ahora: string): Promise<boolean> {
  const limite = new Date(Date.parse(ahora) - CERROJO_MS).toISOString();
  const instancia = e.instancia;
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

interface Trabajo {
  ctx: ContextoComprension;
  rel: Relacion;
  a: MaterialObra;
  b: MaterialObra;
  h: string;
  modelo: ModeloComprension | null;
  acumulado: { uso: UsoModelo };
  estado: EstadoAlineacion;
  /** Gasto de los intentos anteriores (para el presupuesto, que es de la relación). */
  previoUsd: number;
  presupuestoUsd: number;
  calidad: 'alta' | 'rapida';
  concurrencia: number;
  avisos: string[];
  /** Guarda el estado (con el gasto de este intento sumado) y refresca el cerrojo. */
  apuntar(cambios: Partial<EstadoAlineacion>): Promise<void>;
}

const resto = (ctx: ContextoComprension) => (ctx.limite ? ctx.limite - Date.now() - MARGEN_PASO_MS : Number.POSITIVE_INFINITY);

/**
 * Una llamada acotada: con el modelo pedido y un tope de tiempo; si se queda sin
 * tiempo y aún queda margen en el paso, otra vez con el modelo rápido. Cada intento
 * sin tiempo se apunta (los siguientes intentos del paso van con el rápido).
 */
async function acotada<T>(t: Trabajo, fn: (calidad: 'alta' | 'rapida', limiteMs: number) => Promise<T>, o: { porLlamadaMs?: number; calidad?: 'alta' | 'rapida' } = {}): Promise<T> {
  const calidad = o.calidad ?? t.calidad;
  const limite = (ms: number) => Math.max(1000, Math.min(resto(t.ctx), ms));
  try {
    return await fn(calidad, limite(o.porLlamadaMs ?? POR_LLAMADA_MS));
  } catch (e) {
    if (!esPlazo(e)) throw e;
    if (calidad === 'alta' && resto(t.ctx) > 90_000) {
      t.estado.plazos = (t.estado.plazos ?? 0) + 1;
      t.avisos.push('Una llamada se quedó sin tiempo con el modelo alto: se repitió con el rápido.');
      return await fn('rapida', limite(180_000));
    }
    throw e;
  }
}

/** Ordena todas las alineaciones de la relación por el lado del origen (lee solo ids y anclas). */
async function ordenar(ctx: ContextoComprension, rel: Relacion): Promise<number> {
  const filas = await ctx.sql.ejecutar<{ id: string; ancla_a: string | null; ancla_b: string | null }>('SELECT id, ancla_a, ancla_b FROM alineaciones WHERE relacion = ?', rel.id);
  const pos = filas.map((f) => ({
    id: String(f.id),
    pa: posicionLado(f.ancla_a ? { ancla: JSON.parse(String(f.ancla_a)) } : undefined),
    pb: posicionLado(f.ancla_b ? { ancla: JSON.parse(String(f.ancla_b)) } : undefined),
  })).sort((x, y) => (x.pa === y.pa ? x.pb - y.pb : x.pa - y.pa));
  for (const [k, x] of pos.entries()) await ctx.sql.ejecutar('UPDATE alineaciones SET orden = ? WHERE id = ?', k, x.id);
  await vaciar(ctx);
  return pos.length;
}

const sinLiterales = (x: AlineacionSinId): Omit<Alineacion, 'id' | 'relacion' | 'orden'> => { const { literales: _l, ...resto_ } = x; return resto_; };

/** Gruesa y fina de una adaptación (o versión), grupo a grupo, guardando cada uno. */
async function alinearPorGrupos(t: Trabajo, o: OpcionesAlineacion, ahora: () => string): Promise<{ gruesas: CorrespondenciaGruesa[]; literales: Map<string, { a?: string; b?: string }> }> {
  const { ctx, rel, a, b, h } = t;
  const prefijo = prefijoRelacion(rel, a, b, { global: true }).texto;
  // 1. La gruesa: guardada en cuanto sale (un reintento no la vuelve a pagar).
  const guardada = await leerDato<{ huella: string; gruesas: CorrespondenciaGruesa[] }>(ctx, rel, faseGruesa(rel.id));
  let gruesas = guardada?.huella === h ? guardada.gruesas : null;
  if (!gruesas) {
    if (t.modelo) {
      try {
        gruesas = await acotada(t, (calidad, limiteMs) => alineacionGruesa(rel, a, b, t.modelo!, t.acumulado, { prefijo, calidad, limiteMs }), { porLlamadaMs: 300_000 });
      } catch (e) {
        if (esPlazo(e) || esDeLaPlataforma(e)) throw e;
        t.avisos.push(`La alineación gruesa falló (${((e as Error).message ?? '').slice(0, 120)}): queda la aproximada por posición.`);
      }
    }
    if (!gruesas?.length) gruesas = alineacionGruesaProporcional(a, b);
    await guardarDato(ctx, rel, faseGruesa(rel.id), { huella: h, gruesas }, ahora());
    await t.apuntar({ fase: 'fina', gruesas: gruesas.length });
  }
  // 2. Los grupos finos: cada uno carga su texto, llama, escribe y deja constancia.
  const grupos = gruposFinos(a, b, gruesas, o.maxCaracteres ? { maxCaracteres: o.maxCaracteres } : {});
  const hechos = await gruposHechos(ctx, rel, h);
  await t.apuntar({ fase: 'fina', total: grupos.length, hechos: grupos.filter((g) => hechos.has(g.clave)).length });
  let parar: unknown = null;
  await enParalelo(grupos.filter((g) => !hechos.has(g.clave)), Math.max(1, t.concurrencia), async (g) => {
    if (parar) return;
    if (t.previoUsd + t.acumulado.uso.usd > t.presupuestoUsd) {
      if (!t.avisos.some((x) => x.startsWith('Presupuesto'))) t.avisos.push(`Presupuesto agotado (${(t.previoUsd + t.acumulado.uso.usd).toFixed(2)} USD): parte de la relación queda solo con la alineación gruesa.`);
      return;
    }
    try {
      let finas: AlineacionSinId[] = [];
      let descartadas = 0;
      if (t.modelo) {
        const ta = await cargarTramo(ctx, a, ordenesDe(a, g.a)), tb = await cargarTramo(ctx, b, ordenesDe(b, g.b));
        try {
          const r = await acotada(t, (calidad, limiteMs) => alineacionFina(rel, a, b, g, ta, tb, t.modelo!, t.acumulado, { prefijo, calidad, limiteMs }));
          finas = r.alineaciones; descartadas = r.descartadas;
        } catch (e) {
          if (esPlazo(e) || esDeLaPlataforma(e)) throw e;
          // Un fallo del modelo en un grupo (salida cortada, bloqueo): queda su gruesa y se sigue.
          t.avisos.push(`Un tramo no se pudo alinear en detalle (${g.b.map((s) => s.titulo).join(', ').slice(0, 80)}): ${((e as Error).message ?? '').slice(0, 100)}`);
        }
      }
      const prefijoId = `${rel.id}:f${g.clave}-`;
      const conId: Alineacion[] = finas.map((x, k) => ({ id: `${prefijoId}${String(k).padStart(3, '0')}`, relacion: rel.id, orden: 0, ...sinLiterales(x) }));
      await ctx.sql.ejecutar('DELETE FROM alineaciones WHERE relacion = ? AND id LIKE ?', rel.id, `${prefijoId}%`);
      for (let i = 0; i < conId.length; i += 100) await escribirAlineaciones(ctx.sql, conId.slice(i, i + 100));
      await guardarDato(ctx, rel, faseGrupo(rel.id, g.clave), {
        huella: h, clave: g.clave, alineaciones: conId.length, descartadas, gruesas: g.gruesas.map((c) => gruesas!.indexOf(c)),
        literales: finas.flatMap((x, k) => (x.literales ? [{ id: conId[k]!.id, ...x.literales }] : [])),
      } satisfies GrupoHecho, ahora());
      hechos.set(g.clave, { huella: h, clave: g.clave, alineaciones: conId.length, descartadas, gruesas: [] });
      await t.apuntar({ hechos: hechos.size, descartadas: (t.estado.descartadas ?? 0) + descartadas });
    } catch (e) {
      parar ??= e;
    }
  });
  if (parar) throw parar;
  // 3. Las gruesas sin detalle (añadidos, supresiones y las que no dieron fina), como tales.
  const conFina = new Set<number>();
  const literales = new Map<string, { a?: string; b?: string }>();
  for (const x of (await gruposHechos(ctx, rel, h)).values()) {
    if (x.alineaciones > 0) for (const i of x.gruesas) conFina.add(i);
    for (const l of x.literales ?? []) literales.set(l.id, { ...(l.a ? { a: l.a } : {}), ...(l.b ? { b: l.b } : {}) });
  }
  const soloGruesas = alineacionesGruesas(a, b, gruesas.filter((_, i) => !conFina.has(i)));
  await ctx.sql.ejecutar('DELETE FROM alineaciones WHERE relacion = ? AND id LIKE ?', rel.id, `${rel.id}:g%`);
  await escribirAlineaciones(ctx.sql, soloGruesas.map((x, k) => ({ id: `${rel.id}:g${String(k).padStart(4, '0')}`, relacion: rel.id, orden: 0, ...sinLiterales(x) })));
  await vaciar(ctx);
  return { gruesas, literales };
}

/** Una traducción entre textos, ventana a ventana de párrafos, guardando cada una. */
async function alinearPorParrafos(t: Trabajo, ahora: () => string): Promise<void> {
  const { ctx, rel, a, b, h } = t;
  const ventanas = ventanasDeTraduccion(await parrafosDe(ctx, a), await parrafosDe(ctx, b));
  const hechas = await gruposHechos(ctx, rel, h);
  await t.apuntar({ fase: 'fina', total: ventanas.length, hechos: hechas.size });
  let parar: unknown = null;
  await enParalelo(ventanas.map((v, k) => ({ v, k, clave: `p${String(k).padStart(4, '0')}` })).filter((x) => !hechas.has(x.clave)), Math.max(1, t.concurrencia), async ({ v, k, clave }) => {
    if (parar) return;
    try {
      let grupos = v;
      if (t.modelo && t.previoUsd + t.acumulado.uso.usd <= t.presupuestoUsd) {
        try {
          grupos = await acotada(t, (calidad, limiteMs) => revisarVentana(ctx, rel, a, b, v, t.modelo!, t.acumulado, { calidad, limiteMs }), { porLlamadaMs: 120_000 });
        } catch (e) {
          if (esPlazo(e) || esDeLaPlataforma(e)) throw e;
          // Un bloqueo del modelo rápido (falso positivo de seguridad) se intenta una vez con el alto.
          if (t.calidad === 'rapida' && /bloquead|PROHIBITED|SAFETY/i.test((e as Error)?.message ?? '')) {
            grupos = await acotada(t, (calidad, limiteMs) => revisarVentana(ctx, rel, a, b, v, t.modelo!, t.acumulado, { calidad, limiteMs }), { porLlamadaMs: 120_000, calidad: 'alta' }).catch(() => v);
          }
          if (grupos === v && !t.avisos.some((x) => x.startsWith('Una ventana'))) t.avisos.push(`Una ventana de párrafos no se pudo revisar (${((e as Error).message ?? '').slice(0, 100)}): queda la alineación por longitudes.`);
        }
      }
      const als = alineacionesDeVentana(rel, a, b, k, grupos);
      await ctx.sql.ejecutar('DELETE FROM alineaciones WHERE relacion = ? AND id LIKE ?', rel.id, `${rel.id}:p${String(k).padStart(4, '0')}-%`);
      for (let i = 0; i < als.length; i += 100) await escribirAlineaciones(ctx.sql, als.slice(i, i + 100));
      await guardarDato(ctx, rel, faseGrupo(rel.id, clave), { huella: h, clave, alineaciones: als.length, descartadas: 0, gruesas: [] } satisfies GrupoHecho, ahora());
      hechas.set(clave, { huella: h, clave, alineaciones: als.length, descartadas: 0, gruesas: [] });
      await t.apuntar({ hechos: hechas.size });
    } catch (e) {
      parar ??= e;
    }
  });
  if (parar) throw parar;
}

/** Lo literal de unas cuantas alineaciones de una traducción (las que tienen algo que decir primero), para la ficha. */
async function literalesDeTraduccion(t: Trabajo, als: readonly Alineacion[], max = 60): Promise<Map<string, { a?: string; b?: string }>> {
  const notables = als.filter((x) => x.tipo !== 'traducido');
  const resto_ = als.filter((x) => x.tipo === 'traducido');
  const paso = Math.max(1, Math.ceil(resto_.length / Math.max(1, max - notables.length)));
  const elegidas = [...notables.slice(0, max), ...resto_.filter((_, i) => i % paso === 0)].slice(0, max);
  const salida = new Map<string, { a?: string; b?: string }>();
  for (const [mo, lado] of [[t.a, 'a'], [t.b, 'b']] as const) {
    const ordenes = elegidas.flatMap((x) => { const l = x[lado]; const u = l && l.ancla.tipo === 'pagina' ? mo.indice.find((y) => y.ancla.tipo === 'pagina' && y.ancla.fisica === (l.ancla as { fisica: number }).fisica) : undefined; return u ? [u.orden] : []; });
    const m = await cargarTramo(t.ctx, mo, ordenes);
    const porFisica = new Map(m.unidades.map((u) => [u.ancla.tipo === 'pagina' ? u.ancla.fisica : -1, Array.from(u.texto)]));
    for (const x of elegidas) {
      const l = x[lado];
      if (!l || l.ancla.tipo !== 'pagina' || !l.ancla.caracteres) continue;
      const texto = porFisica.get(l.ancla.fisica)?.slice(...l.ancla.caracteres).join('').slice(0, 300);
      if (texto) salida.set(x.id, { ...(salida.get(x.id) ?? {}), [lado]: texto });
    }
  }
  return salida;
}

/**
 * Alinea una relación (gruesa y fina, o por párrafos) y escribe su ficha. Reanuda lo
 * que quedó a medias con la misma huella. Si algo falla, deja el estado en «error» y
 * lanza el error (el Workflow reintenta el paso y el reintento sigue donde quedó).
 */
export async function alinearRelacion(ctx: ContextoComprension, relacion: string, o: OpcionesAlineacion = {}): Promise<ResultadoAlinear> {
  const rel = await leerRelacion(ctx.sql, relacion);
  const vacio = (estado: ResultadoAlinear['estado'], avisos: string[] = []): ResultadoAlinear => ({ relacion, estado, alineaciones: 0, gruesas: 0, ficha: false, usd: 0, avisos });
  if (!rel) return vacio('error', ['La relación ya no existe.']);
  if (!(await lista(ctx, rel))) return vacio('no_se_alinea');
  const ahora = () => ahoraDe(ctx);
  const inicio = ahora();
  const h = await huellaRelacion(ctx, rel);
  const previo = await leerEstadoAlineacion(ctx, rel);
  if (!o.forzar && previo?.estado === 'hecho' && previo.huella === h) return { ...vacio('al_dia'), alineaciones: previo.alineaciones, gruesas: previo.gruesas, usd: 0 };
  const instancia = o.instancia ?? `tmd-${nuevoId()}`;
  // Se reanuda lo de un intento anterior con la misma huella (con «forzar», solo si es de esta misma instancia: sus reintentos).
  const reanudar = !!previo && previo.huella === h && previo.estado !== 'hecho' && (!o.forzar || previo.instancia === instancia);
  const estado: EstadoAlineacion = reanudar
    ? { ...previo!, estado: 'en_marcha', instancia, actualizado: inicio, avisos: [] }
    : { relacion: rel.id, estado: 'en_marcha', version: VERSION_TRANSMEDIA, huella: h, instancia, alineaciones: 0, gruesas: 0, descartadas: 0, usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 0, avisos: [], fase: 'gruesa', plazos: 0, iniciado: inicio, actualizado: inicio };
  delete estado.error;
  if (!(await tomarCerrojo(ctx, rel, estado, inicio))) return vacio('ocupada');
  if (!reanudar) await limpiarRelacion(ctx, rel);
  const acumulado: { uso: UsoModelo } = { uso: { modelo: '', tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: 0, llamadas: 0 } };
  const base = { usd: estado.usd, tokensEntrada: estado.tokensEntrada, tokensSalida: estado.tokensSalida, llamadas: estado.llamadas };
  const avisos: string[] = [];
  const apuntar = async (cambios: Partial<EstadoAlineacion>) => {
    Object.assign(estado, cambios);
    const u = acumulado.uso;
    Object.assign(estado, {
      usd: Math.round((base.usd + u.usd) * 1e5) / 1e5, tokensEntrada: base.tokensEntrada + u.tokensEntrada, tokensSalida: base.tokensSalida + u.tokensSalida, llamadas: base.llamadas + u.llamadas,
      ...(u.modelo ? { modelo: [...new Set([...(estado.modelo ?? '').split('+'), ...u.modelo.split('+')])].filter(Boolean).join('+') } : {}), avisos: [...new Set(avisos)].slice(0, 12), actualizado: ahora(),
    });
    await escribirEstado(ctx, rel, estado);
  };
  const modelo = ctx.modelo ? modeloDelPaso(ctx.modelo, { documento: rel.origen, paso: 'alinear', ...(ctx.limite ? { limite: ctx.limite } : {}), ...(ctx.registro ? { registro: ctx.registro } : {}), ...(ctx.latido ? { latido: ctx.latido } : {}) }) : null;
  try {
    const [a, b] = [await materialObra(ctx, rel.origen, 'A'), await materialObra(ctx, rel.destino, 'B')];
    const parrafos = porParrafos(rel, a.documento, b.documento);
    // Tras un intento sin tiempo, lo que falta va con el modelo rápido (mejor algo menos fino que nunca acabar).
    const calidad = (estado.plazos ?? 0) > 0 ? 'rapida' : o.calidad ?? (parrafos ? 'rapida' : 'alta');
    const t: Trabajo = {
      ctx, rel, a, b, h, modelo, acumulado, estado, previoUsd: base.usd, presupuestoUsd: o.presupuestoUsd ?? 4, calidad, concurrencia: o.concurrencia ?? 3, avisos, apuntar,
    };
    let gruesas: CorrespondenciaGruesa[] = [];
    let literales = new Map<string, { a?: string; b?: string }>();
    if (parrafos) await alinearPorParrafos(t, ahora);
    else ({ gruesas, literales } = await alinearPorGrupos(t, o, ahora));
    const total = await ordenar(ctx, rel);
    await apuntar({ fase: 'ficha', alineaciones: total, gruesas: gruesas.length });
    // La ficha de la relación (una sola llamada; si ya está escrita con esta huella, no se repite).
    if ((o.ficha ?? true) && modelo && !estado.ficha && base.usd + acumulado.uso.usd <= (o.presupuestoUsd ?? 4) * 1.25) {
      const als = await leerAlineaciones(ctx.sql, { relacion: rel.id });
      if (parrafos) literales = await literalesDeTraduccion(t, als);
      try {
        const f = await acotada(t, (c, limiteMs) => fichaRelacion(ctx, rel, a, b, gruesas, als, modelo, acumulado, {
          prefijo: prefijoRelacion(rel, a, b, { global: true }).texto, calidad: c, creada: ahora(), literales, limiteMs,
        }), { porLlamadaMs: 360_000, calidad: (estado.plazos ?? 0) > 0 ? 'rapida' : o.calidadFicha ?? 'alta' });
        if (f.ficha.texto) {
          await escribirFichas(ctx.sql, [f.ficha]);
          await vaciar(ctx);
          await indexarFichaRelacion(ctx, rel, f.ficha).catch(() => { avisos.push('La ficha de la relación no llegó al índice de vectores: se busca por texto.'); });
          estado.ficha = true;
        }
        estado.descartadas = (estado.descartadas ?? 0) + f.descartadas;
      } catch (e) {
        if (esPlazo(e) || esDeLaPlataforma(e)) throw e;
        avisos.push(`No se pudo escribir la ficha de la relación (${((e as Error).message ?? '').slice(0, 120)}).`);
      }
    }
    await apuntar({ estado: 'hecho', fase: 'hecho' });
    return { relacion: rel.id, estado: 'hecho', alineaciones: estado.alineaciones, gruesas: estado.gruesas, ficha: !!estado.ficha, usd: Math.round(acumulado.uso.usd * 1e5) / 1e5, avisos: [...new Set(avisos)] };
  } catch (e) {
    const mensaje = ((e as Error)?.message || String(e) || 'error sin mensaje').slice(0, 300);
    if (esPlazo(e)) estado.plazos = (estado.plazos ?? 0) + 1;
    // Nunca «en marcha» para siempre: el estado queda en «error» (el reintento lo vuelve a poner en marcha).
    await apuntar({ estado: 'error', error: mensaje }).catch(() => undefined);
    throw new ErrorAlineacion(rel.id, mensaje, acumulado.uso.usd);
  }
}

/** La alineación de una relación falló (el estado ya dice «error»): el paso se reintenta y reanuda. */
export class ErrorAlineacion extends Error {
  constructor(public readonly relacion: string, mensaje: string, public readonly usd: number) {
    super(`Alineación de ${relacion}: ${mensaje}`);
    this.name = 'ErrorAlineacion';
  }
}

/** Tras agotar los reintentos (el Workflow lo llama): el estado queda en «error» si seguía en marcha. */
export async function marcarFalloAlineacion(ctx: ContextoComprension, relacion: string, mensaje: string): Promise<void> {
  const rel = await leerRelacion(ctx.sql, relacion);
  if (!rel) return;
  const e = await leerEstadoAlineacion(ctx, rel);
  if (e && e.estado !== 'en_marcha') return;
  const t = ahoraDe(ctx);
  await escribirEstado(ctx, rel, {
    ...(e ?? { relacion, version: VERSION_TRANSMEDIA, huella: '', instancia: '', alineaciones: 0, gruesas: 0, descartadas: 0, usd: 0, tokensEntrada: 0, tokensSalida: 0, llamadas: 0, avisos: [], iniciado: t }),
    estado: 'error', error: mensaje.slice(0, 300), actualizado: t,
  });
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
  const alineadas = await enParalelo(deteccion.porAlinear, 2, (id) => alinearRelacion(ctx, id, o).catch((e: unknown): ResultadoAlinear => ({
    relacion: id, estado: 'error', alineaciones: 0, gruesas: 0, ficha: false, usd: e instanceof ErrorAlineacion ? e.usd : 0, avisos: [((e as Error)?.message ?? String(e)).slice(0, 300)],
  })));
  return { deteccion, alineadas };
}
