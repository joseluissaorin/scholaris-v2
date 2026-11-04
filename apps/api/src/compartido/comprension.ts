/**
 * La comprensión en la plataforma (docs/COMPRENSION.md), común a la nube y a
 * `apps/local`: el contexto de los pasos (estantería, Gemini, embebedor,
 * índice, percepción) y el lanzamiento, con su cola para la biblioteca entera.
 *
 * El trabajo lo lleva el Workflow `scholaris-comprension` (o la cola local). Aquí
 * solo se decide qué lanzar y se deja apuntado en el estado del documento (su
 * procedencia): instancia, parámetros y relanzamientos, para el vigilante.
 */
import { nuevoId, type Emisor, type Embebedor, type IndiceVectorial, type Lente, type PercepcionMedio, type SQL } from '@scholaris/nucleo';
import type { EventoTiempoReal, Plan } from '@scholaris/contrato';
import {
  actualizarEstado, comprenderDocumento, leerEstadoComprension, type ContextoComprension, type EstadoComprension, type ModeloComprension, type ProgresoComprension,
} from '@scholaris/ingesta';
import { crearComprensorGemini, crearGemini, type ConfigGemini } from '@scholaris/proveedores';
import type { AlmacenAmpliado, PuertosUsuario } from '../puertos.js';

/** Con qué se lanza la comprensión de un documento (serializable: va en el Workflow). */
export interface ParamsComprension {
  usuario: string;
  plan: Plan;
  documento: string;
  /** Id de la instancia del Workflow («cmp-<documento>-<sello>»): también es el nombre de su tarea de vigilancia. */
  instancia: string;
  forzar?: boolean;
  lentes?: Lente[];
  economico?: boolean;
  relanzamientos?: number;
}

/** Comprensiones a la vez por usuario cuando se pide la biblioteca entera. */
export const COMPRENSIONES_A_LA_VEZ = 2;

export const instanciaComprension = (documento: string) => `cmp-${documento}-${Date.now().toString(36)}${nuevoId().slice(-3)}`;
export const documentoDeInstancia = (instancia: string) => /^cmp-(.+)-[a-z0-9]+$/.exec(instancia)?.[1] ?? null;

/** La percepción de un medio, donde la deja la percepción: `u/<usuario>/d/<documento>/percepcion.json`. */
export async function leerPercepcionAlmacen(almacen: Pick<AlmacenAmpliado, 'bytes'>, usuario: string, documento: string): Promise<PercepcionMedio | null> {
  try {
    const b = await almacen.bytes(`u/${usuario}/d/${documento}/percepcion.json`);
    if (!b) return null;
    const p = JSON.parse(new TextDecoder().decode(b)) as PercepcionMedio;
    return Array.isArray(p.escenas) ? { ...p, documento } : null;
  } catch { return null; }
}

/** El modelo de comprensión con la clave de Gemini del usuario o de la instancia (sin clave, no hay). */
export function modeloComprension(gemini: ConfigGemini | undefined): ModeloComprension | null {
  if (!gemini?.clave) return null;
  const cliente = crearGemini({ ...gemini, concurrencia: 8, timeoutMs: Math.max(gemini.timeoutMs ?? 0, 600_000) });
  return crearComprensorGemini(cliente) as unknown as ModeloComprension;
}

export interface DependenciasContexto {
  sql: SQL;
  usuario: string;
  almacen: Pick<AlmacenAmpliado, 'bytes'>;
  gemini?: ConfigGemini;
  embebedor?: Embebedor;
  indice?: IndiceVectorial | null;
  espacioNombres?: string;
  emisor?: Emisor<EventoTiempoReal>;
  /** Latido para el vigilante (cada aviso de progreso lo renueva). */
  latido?(): Promise<void>;
}

export function contextoComprension(d: DependenciasContexto): ContextoComprension {
  return {
    sql: d.sql,
    modelo: modeloComprension(d.gemini),
    ...(d.embebedor ? { embebedor: d.embebedor } : {}),
    ...(d.indice ? { indice: d.indice } : {}),
    ...(d.espacioNombres ? { espacioNombres: d.espacioNombres } : {}),
    fetch: globalThis.fetch.bind(globalThis),
    percepcion: (documento) => leerPercepcionAlmacen(d.almacen, d.usuario, documento),
    alProgreso: async (p: ProgresoComprension) => {
      await d.latido?.();
      await d.emisor?.emitir(`usuario:${d.usuario}`, { tipo: 'comprension', documento: p.documento, paso: p.paso, avance: p.avance, mensaje: p.mensaje, estado: p.paso === 'fin' ? 'hecho' : 'en_marcha' }).catch(() => undefined);
    },
  };
}

const ahora = () => new Date().toISOString();

/**
 * Lanza la comprensión de un documento. Si ya hay una en marcha (y no se pide
 * rehacer), no lanza otra. Sin orquestador que la lleve, la deja «pendiente».
 */
export async function lanzarComprension(
  p: PuertosUsuario, documento: string, o: { forzar?: boolean; lentes?: Lente[]; economico?: boolean; soloEncolar?: boolean } = {},
): Promise<{ instancia: string | null; estado: EstadoComprension['estado'] }> {
  const previo = await leerEstadoComprension(p.sql, documento);
  const viva = previo && (previo.estado === 'en_marcha' || previo.estado === 'pendiente') && previo.instancia && Date.now() - Date.parse(previo.actualizado) < 30 * 60_000;
  if (viva && !o.forzar) return { instancia: previo!.instancia ?? null, estado: previo!.estado };
  const instancia = instanciaComprension(documento);
  const params: ParamsComprension = {
    usuario: p.usuario.id, plan: p.usuario.plan, documento, instancia,
    ...(o.forzar ? { forzar: true } : {}), ...(o.lentes?.length ? { lentes: o.lentes } : {}),
    ...(o.economico || p.usuario.plan === 'gratis' ? { economico: true } : {}),
  };
  const t = ahora();
  // Una comprensión hecha no se da por perdida al relanzarla sin «forzar» (al cerrar otra vez la
  // ingesta, por ejemplo): el plan comprueba la versión y la huella del material y, si no han
  // cambiado, no hace nada. Solo lo que hay que hacer de verdad pasa a «pendiente».
  const conserva = previo?.estado === 'hecho' && !o.forzar;
  const estado: EstadoComprension['estado'] = conserva ? 'hecho' : 'pendiente';
  await actualizarEstado(p.sql, documento, {
    estado, instancia, params: params as unknown as Record<string, unknown>, relanzamientos: 0, lanzada: false,
    ...(conserva ? {} : { error: undefined }),
    ...(previo ? {} : { lentes: o.lentes ?? [], version: '', iniciado: t }),
  }, t);
  if (o.soloEncolar || !p.orquestador.lanzarComprension) return { instancia, estado };
  await actualizarEstado(p.sql, documento, { lanzada: true }, ahora());
  await p.orquestador.lanzarComprension(params);
  return { instancia, estado };
}

/** Documentos con la comprensión pendiente (sin lanzar) o en marcha. */
async function enCola(sql: SQL): Promise<{ pendientes: Array<{ documento: string; params: ParamsComprension }>; enMarcha: number }> {
  const filas = await sql.ejecutar<{ documento: string; detalle: string }>("SELECT documento, detalle FROM procedencia WHERE fase = 'comprension'");
  const pendientes: Array<{ documento: string; params: ParamsComprension; t: string }> = [];
  let enMarcha = 0;
  for (const f of filas) {
    try {
      const c = JSON.parse(String(f.detalle)) as { estado: string; params?: ParamsComprension; actualizado: string; lanzada?: boolean };
      if (c.estado === 'en_marcha' && Date.now() - Date.parse(c.actualizado) < 30 * 60_000) enMarcha++;
      if (c.estado === 'pendiente' && c.params && !c.lanzada) pendientes.push({ documento: String(f.documento), params: c.params, t: c.actualizado });
    } catch { /* fila rota */ }
  }
  pendientes.sort((a, b) => a.t.localeCompare(b.t));
  return { pendientes, enMarcha };
}

/** Lanza las comprensiones encoladas hasta llenar el cupo del usuario. */
export async function lanzarPendientes(p: PuertosUsuario, maximo = COMPRENSIONES_A_LA_VEZ): Promise<number> {
  if (!p.orquestador.lanzarComprension) return 0;
  const { pendientes, enMarcha } = await enCola(p.sql);
  let lanzadas = 0;
  for (const x of pendientes.slice(0, Math.max(0, maximo - enMarcha))) {
    await actualizarEstado(p.sql, x.documento, { lanzada: true }, ahora());
    await p.orquestador.lanzarComprension(x.params);
    lanzadas++;
  }
  return lanzadas;
}

/** Encola la comprensión de muchos documentos (o de todos los listos) y lanza las primeras. */
export async function comprenderBiblioteca(p: PuertosUsuario, o: { forzar?: boolean; lentes?: Lente[]; economico?: boolean; documentos?: string[] } = {}): Promise<{ encolados: number; lanzados: number }> {
  const ids = o.documentos?.length
    ? o.documentos
    : (await p.sql.ejecutar<{ id: string }>("SELECT id FROM documentos WHERE estado = 'listo' ORDER BY creado")).map((f) => String(f.id));
  let encolados = 0;
  for (const id of ids) {
    const e = await leerEstadoComprension(p.sql, id);
    if (!o.forzar && e && (e.estado === 'hecho' || e.estado === 'en_marcha')) continue;
    await lanzarComprension(p, id, { ...o, soloEncolar: true });
    encolados++;
  }
  const lanzados = await lanzarPendientes(p);
  return { encolados, lanzados };
}

/**
 * La comprensión entera en el mismo proceso (`apps/local`): los mismos pasos que
 * el Workflow, uno detrás de otro, y después la siguiente de la cola.
 */
export async function comprenderEnProceso(p: PuertosUsuario, params: ParamsComprension, gemini?: ConfigGemini): Promise<EstadoComprension> {
  const ia = await p.inteligencia();
  const ctx = contextoComprension({
    sql: p.sql, usuario: params.usuario, almacen: p.almacen, ...(gemini ? { gemini } : {}), embebedor: ia.embebedor, indice: p.indice,
    espacioNombres: p.config.espacioNombres(params.usuario), emisor: p.emisor,
  });
  try {
    return await comprenderDocumento(ctx, params.documento, {
      ...(params.forzar ? { forzar: true } : {}), ...(params.lentes?.length ? { lentes: params.lentes } : {}), ...(params.economico ? { economico: true } : {}),
    });
  } finally {
    await p.emisor.emitir(`usuario:${params.usuario}`, { tipo: 'comprension', documento: params.documento, paso: 'fin', avance: 1, mensaje: 'Comprensión terminada' }).catch(() => undefined);
  }
}
