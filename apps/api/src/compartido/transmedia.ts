/**
 * Transmedia en la plataforma (docs/COMPRENSION.md, paso 7), común a la nube y a
 * `apps/local`: lanzar la detección y la alineación de un documento o de la
 * biblioteca entera, y las vistas de las relaciones para las rutas.
 *
 * El trabajo lo lleva el mismo Workflow de la comprensión (`scholaris-comprension`)
 * con `transmedia` en los parámetros, o la cola local. Detectar es barato
 * (metadatos, contenido, Wikidata con caché, grafo); alinear llama al modelo.
 */
import { nuevoId, type Relacion } from '@scholaris/nucleo';
import type { EstadoAlineacionVista, ObraRelacionada, RelacionVista } from '@scholaris/contrato';
import { leerDocumento, leerFichas } from '@scholaris/spdf';
import { alinearRelacion, estadoVigente, leerEstadoAlineacion, transmediaEnProceso, type ContextoComprension } from '@scholaris/ingesta';
import type { ConfigGemini } from '@scholaris/proveedores';
import type { PuertosUsuario } from '../puertos.js';
import { contextoComprension, type ParamsComprension } from './comprension.js';

export const instanciaTransmedia = () => `tmd-${Date.now().toString(36)}${nuevoId().slice(-3)}`;

/**
 * Plazo de un intento de alineación (segundos). Cada llamada al modelo se acota a lo
 * que quede; lo hecho queda guardado por grupos, así que un reintento sigue donde quedó.
 */
export const PLAZO_ALINEAR_S = 1500;

/** Mensaje de un fallo de la alineación apto para la interfaz (el estado de la relación). */
export function legibleAlineacion(m: string): string {
  if (/memory limit|isolate|Durable Object/i.test(m)) return 'La alineación se interrumpió varias veces (la plataforma se quedó sin memoria). Vuelve a pedirla: lo ya hecho se aprovecha.';
  if (/timed out|WorkflowTimeoutError|plazo/i.test(m)) return 'La alineación tardó más de lo previsto y se detuvo. Vuelve a pedirla: lo ya hecho se aprovecha.';
  if (/presupuesto/i.test(m)) return m;
  return 'No he podido terminar la alineación de estas obras. Vuelve a pedirla más tarde: lo ya hecho se aprovecha.';
}

/**
 * Lanza la detección (y la alineación) de un documento o de toda la biblioteca.
 * Sin orquestador que la lleve, devuelve null.
 */
export async function lanzarTransmedia(
  p: PuertosUsuario, o: { documento?: string; documentos?: string[]; relacion?: string; forzar?: boolean; alinear?: boolean } = {},
): Promise<string | null> {
  if (!p.orquestador.lanzarComprension) return null;
  const instancia = instanciaTransmedia();
  const params: ParamsComprension = {
    usuario: p.usuario.id, plan: p.usuario.plan, documento: o.documento ?? '*', instancia, transmedia: o.documento ? 'documento' : 'biblioteca',
    ...(o.documentos?.length ? { documentos: o.documentos } : {}), ...(o.relacion ? { relacion: o.relacion } : {}),
    ...(o.forzar ? { forzar: true } : {}), ...(o.alinear === false ? { alinear: false } : {}),
    ...(p.usuario.plan === 'gratis' ? { economico: true } : {}),
  };
  await p.orquestador.lanzarComprension(params);
  return instancia;
}

/** Las opciones de detección y alineación que salen de los parámetros del Workflow. */
export function opcionesTransmedia(params: ParamsComprension) {
  return {
    ...(params.forzar ? { forzar: true } : {}), ...(params.documentos?.length ? { documentos: params.documentos } : {}),
    ...(params.economico ? { calidad: 'rapida' as const, calidadFicha: 'rapida' as const } : {}), instancia: params.instancia,
  };
}

/** La transmedia entera en el mismo proceso (`apps/local`). */
export async function transmediaEnProcesoPlataforma(p: PuertosUsuario, params: ParamsComprension, gemini?: ConfigGemini): Promise<void> {
  const ia = await p.inteligencia();
  const ctx = contextoComprension({
    sql: p.sql, usuario: params.usuario, almacen: p.almacen, ...(gemini ? { gemini } : {}), embebedor: ia.embebedor, indice: p.indice,
    espacioNombres: p.config.espacioNombres(params.usuario), emisor: p.emisor,
  });
  await transmediaDeContexto(ctx, params);
}

export async function transmediaDeContexto(ctx: ContextoComprension, params: ParamsComprension): Promise<void> {
  const o = { ...opcionesTransmedia(params), ...(params.alinear === false ? { alinear: false } : {}) };
  if (params.relacion) {
    await alinearRelacion(ctx, params.relacion, o);
    return;
  }
  await transmediaEnProceso(ctx, params.transmedia === 'biblioteca' || params.documento === '*' ? null : params.documento, o);
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

async function obraRelacionada(p: PuertosUsuario, id: string): Promise<ObraRelacionada> {
  const d = await leerDocumento(p.sql, id);
  const m = d?.metadatos;
  return {
    id, titulo: m?.titulo ?? id, autores: (m?.autores ?? []).map((a) => [a.nombre, a.apellidos].filter(Boolean).join(' ')).filter(Boolean),
    ...(m?.anio ? { anio: m.anio } : {}), tipo: d?.tipo ?? 'documento',
  };
}

/** Una relación vista desde un documento (o desde su origen), con la otra obra, su ficha y su estado. */
export async function relacionVista(p: PuertosUsuario, r: Relacion, desde?: string, o: { ficha?: boolean } = {}): Promise<RelacionVista> {
  const sentido: RelacionVista['sentido'] = !desde || desde === r.origen ? 'origen' : 'destino';
  const otro = await obraRelacionada(p, sentido === 'origen' ? r.destino : r.origen);
  const [n] = await p.sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM alineaciones WHERE relacion = ?', r.id);
  const ficha = o.ficha === false ? undefined : (await leerFichas(p.sql, { objetivo: 'relacion', objetivoId: r.id }))[0];
  // Un «en marcha» que lleva demasiado sin moverse está muerto: se enseña como error (nunca «Alineando…» para siempre).
  const e = estadoVigente(await leerEstadoAlineacion({ sql: p.sql }, r));
  const estadoAlineacion: EstadoAlineacionVista | undefined = e
    ? {
      estado: e.estado, alineaciones: e.alineaciones, usd: e.usd, avisos: e.avisos, ...(e.error ? { error: e.error } : {}), actualizado: e.actualizado,
      ...(e.total ? { hechos: e.hechos ?? 0, total: e.total } : {}),
    }
    : undefined;
  return {
    ...r, otro, sentido, alineaciones: Number(n?.n ?? 0), confirmada: r.fuente === 'usuario',
    ...(ficha ? { ficha } : {}), ...(estadoAlineacion ? { estadoAlineacion } : {}),
  };
}
