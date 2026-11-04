/**
 * Los medios que ya están en la biblioteca: proxy, percepción y transcripción
 * revisada, para los documentos que se ingirieron antes de que existieran.
 * Lo usan las fases `transcripcion` y `percepcion` de la ingesta (el Workflow en
 * la nube, la cola en local) y las rutas que las lanzan, que dicen antes lo que
 * va a costar.
 *
 *   pasoRevisionMedio    la revisión de la transcripción (huecos y, con la
 *                        percepción, hablantes), guardada sin aplicar
 *   pasoPercepcionMedio  la percepción completa (`percepcion.json`)
 *   pasoAplicarMedio     la revisión aplicada: la capa literal reescrita
 */
import { hablantesDeDialogos, type ResultadoReescritura } from '@scholaris/ingesta';
import type { Plan } from '@scholaris/contrato';
import type { IndiceVectorial, Inteligencia, SQL } from '@scholaris/nucleo';
import type { ConfigGemini } from '@scholaris/proveedores';
import { leerDocumento } from '@scholaris/spdf';
import type { AlmacenAmpliado, ParamsIngesta, PuertosUsuario } from '../puertos.js';
import { lanzarIngesta, prefijoDocumento } from '../rutas/subidas.js';
import { clavePercepcion, leerPercepcion, percibirDocumento, unidadesDeMedio } from './percepcion.js';
import type { HacerProxy } from './proxy.js';
import { aplicarRevisionDocumento, leerRevision, presupuestoTranscripcion, revisaHablantes, revisarTranscripcionDocumento, type ResultadoAplicarRevision } from './transcripcion.js';

export interface ContextoMedio {
  almacen: AlmacenAmpliado;
  sql: SQL;
  inteligencia: Inteligencia;
  indice: IndiceVectorial | null;
  espacioNombres: string;
  gemini?: ConfigGemini;
  hacerProxy?: HacerProxy;
}

// ---------------------------------------------------------------------------
// Lo que cuesta (medido el 4-11-2026: percepcion/NOTAS.md)
// ---------------------------------------------------------------------------

/** Argon dobla su precio el 1-12-2026 (de 2 y 10 a 4 y 20 $ por millón). */
const ARGON_DOBLE = Date.parse('2026-12-01T00:00:00Z');

/** Dólares por hora de medio de cada parte, según la fecha. */
export function preciosHora(ahora = Date.now()): { percepcion: number; huecos: number; hablantes: number } {
  const argon = ahora >= ARGON_DOBLE ? 2 : 1;
  return {
    // La película entera: 4,07 $ en 1 h 50 min con Argon (unos 2,2 $/h; se redondea a 2,6 por las ventanas muy cortadas).
    percepcion: 2.6 * argon,
    // Huecos con Flash: 0,012 $ por subventana de 75 s; en una transcripción mala, unas 50 por hora.
    huecos: 0.6,
    // Hablantes con Argon: 0,128 $ por ventana de 8 min.
    hablantes: 0.128 * 7.5 * argon,
  };
}

export interface EstimacionMedio {
  documento: string;
  titulo: string;
  tipo: string;
  duracion: number;
  tieneProxy: boolean;
  tienePercepcion: boolean;
  tieneRevision: boolean;
  revisionAplicada: boolean;
  /** Lo que se haría y lo que costaría (dólares). */
  hara: Array<'proxy' | 'percepcion' | 'huecos' | 'hablantes' | 'reescritura'>;
  usd: number;
}

/** Lo que hace falta hacer con un medio y lo que costaría. */
export async function estimarMedio(
  ctx: Pick<ContextoMedio, 'almacen' | 'sql'>, doc: { id: string; prefijo: string }, o: { percepcion: boolean; hablantes: boolean; rehacer?: boolean; ahora?: number },
): Promise<EstimacionMedio | null> {
  const d = await leerDocumento(ctx.sql, doc.id);
  if (!d || (d.tipo !== 'video' && d.tipo !== 'audio')) return null;
  const duracion = (d as { duracion?: number }).duracion ?? 0;
  const [proxy, percepcion, revision] = await Promise.all([
    ctx.almacen.cabecera(`${doc.prefijo}proxy.mp4`).catch(() => null),
    ctx.almacen.cabecera(clavePercepcion(doc.prefijo)).catch(() => null),
    leerRevision(ctx.almacen, doc.prefijo),
  ]);
  const p = preciosHora(o.ahora);
  const horas = duracion / 3600;
  const hara: EstimacionMedio['hara'] = [];
  let usd = 0;
  if (!proxy) hara.push('proxy');
  if (o.percepcion && (!percepcion || o.rehacer)) { hara.push('percepcion'); usd += p.percepcion * horas; }
  const revisar = o.rehacer || !revision;
  if (revisar) { hara.push('huecos'); usd += p.huecos * horas; }
  if (revisar && o.hablantes && (o.percepcion || percepcion)) { hara.push('hablantes'); usd += p.hablantes * horas; }
  if (revisar || (revision && !revision.aplicada)) hara.push('reescritura');
  return {
    documento: doc.id, titulo: d.metadatos.titulo, tipo: d.tipo, duracion, tieneProxy: !!proxy, tienePercepcion: !!percepcion,
    tieneRevision: !!revision, revisionAplicada: !!revision?.aplicada, hara, usd: Math.round(usd * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Pasos (cada uno, idempotente: lo pagado queda grabado en el almacén)
// ---------------------------------------------------------------------------

const docDe = async (ctx: Pick<ContextoMedio, 'sql'>, p: ParamsIngesta) => {
  const d = await leerDocumento(ctx.sql, p.documento);
  if (!d) throw new Error('El documento ya no existe.');
  return { documento: p.documento, prefijo: p.prefijo, tipo: d.tipo, original: p.original || d.original, mime: p.mime || d.mime, nombre: p.nombre, duracion: (d as { duracion?: number }).duracion ?? 0 };
};

/**
 * La revisión de la transcripción, guardada sin aplicar. Si ya hay una sin
 * aplicar y no se pide rehacerla, se deja la que hay (la de la percepción, o la
 * que llegó en la petición).
 */
export async function pasoRevisionMedio(ctx: ContextoMedio, p: ParamsIngesta, o: { hablantes?: boolean } = {}): Promise<Record<string, unknown>> {
  const doc = await docDe(ctx, p);
  const previa = await leerRevision(ctx.almacen, p.prefijo);
  if (previa && !previa.aplicada && !p.medio?.rehacer && !o.hablantes) return { reutilizada: true, correcciones: previa.correcciones.length };
  const hablantes = (o.hablantes ?? p.medio?.hablantes ?? true) && revisaHablantes(p.plan);
  const r = await revisarTranscripcionDocumento({
    almacen: ctx.almacen, sql: ctx.sql, ...(ctx.gemini ? { gemini: ctx.gemini } : {}), transcriptor: ctx.inteligencia.transcriptor, ...(ctx.hacerProxy ? { hacerProxy: ctx.hacerProxy } : {}),
  }, doc, {
    // Sin percepción no hay reparto con caras y voces: solo los huecos.
    ...(hablantes ? {} : { hablantes: false }),
    presupuestoUsd: p.medio?.presupuestoUsd ?? presupuestoTranscripcion(p.plan, doc.duracion) + (hablantes ? preciosHora().hablantes * (doc.duracion / 3600) * 1.3 : 0),
    maxSubventanas: Math.ceil(doc.duracion / 60) + 4,
  });
  return {
    correcciones: r.correcciones.length, huecos: r.cobertura.huecos.length, usd: Math.round(r.coste.usd * 10000) / 10000,
    llamadas: r.coste.llamadas, grabadas: r.coste.grabadas, avisos: r.avisos.slice(0, 10),
  };
}

/** La percepción completa del medio (con la transcripción revisada, si hay revisión). */
export async function pasoPercepcionMedio(ctx: ContextoMedio, p: ParamsIngesta): Promise<Record<string, unknown>> {
  const doc = await docDe(ctx, p);
  const presupuesto = p.medio?.presupuestoUsd ?? preciosHora().percepcion * (doc.duracion / 3600) * 1.5 + 0.5;
  const r = await percibirDocumento({ almacen: ctx.almacen, sql: ctx.sql, gemini: ctx.gemini ?? { clave: '' }, ...(ctx.hacerProxy ? { hacerProxy: ctx.hacerProxy } : {}) }, doc, {
    reutilizar: !p.medio?.rehacer, presupuestoUsd: presupuesto,
  });
  return { escenas: r.escenas.length, planos: r.escenas.reduce((n, e) => n + ((e as { planos?: unknown[] }).planos?.length ?? 0), 0), reparto: r.reparto.length, usd: Math.round(r.coste.usd * 10000) / 10000, ventanas: r.ventanas.length };
}

/**
 * Aplica la revisión guardada y reescribe la capa literal; después pone en las
 * frases clave de la percepción el hablante de la transcripción revisada.
 */
export async function pasoAplicarMedio(ctx: ContextoMedio, p: ParamsIngesta): Promise<ResultadoAplicarRevision> {
  const ia = ctx.inteligencia;
  const base = ia.embebedor.espacio.id;
  const r = await aplicarRevisionDocumento({
    almacen: ctx.almacen, sql: ctx.sql,
    reescritura: {
      inteligencia: ia,
      ...(ctx.indice ? {
        indice: {
          // El índice nunca tira el paso: si falla, la cola lo reindexa después.
          insertar: async (espacio, entradas) => { if (espacio.id === base) await ctx.indice!.insertar(ctx.espacioNombres, entradas).catch(() => undefined); },
          borrar: async (espacio, ids) => { if (espacio.id === base) await ctx.indice!.borrar(ctx.espacioNombres, ids).catch(() => undefined); },
        },
      } : {}),
    },
  }, { documento: p.documento, prefijo: p.prefijo }, { ...(p.medio?.forzar ? { forzar: true } : {}) });
  if (r.aplicada) {
    const percepcion = await leerPercepcion(ctx.almacen, p.prefijo);
    if (percepcion) {
      const h = hablantesDeDialogos(percepcion, await unidadesDeMedio(ctx.sql, p.documento));
      if (h.cambios) await ctx.almacen.poner(clavePercepcion(p.prefijo), JSON.stringify({ ...percepcion, ...h.percepcion }), 'application/json');
    }
  }
  await (ctx.sql as { vaciarPendientes?: () => Promise<void> }).vaciarPendientes?.();
  return r;
}

export type { ResultadoReescritura };

// ---------------------------------------------------------------------------
// Lanzar, de uno en uno o la biblioteca entera (con su cola)
// ---------------------------------------------------------------------------

export interface PedidoMedio {
  /** `transcripcion`: revisar y reescribir la transcripción. `percepcion`: además, proxy y percepción completa. */
  que: 'transcripcion' | 'percepcion';
  rehacer?: boolean;
  forzar?: boolean;
  hablantes?: boolean;
  presupuestoUsd?: number;
}

/** Trabajos de medios a la vez por usuario (cada percepción son muchas llamadas largas al modelo). */
export const MEDIOS_A_LA_VEZ = 2;
const FASE_COLA = 'cola_medio';

/** Lanza el trabajo de un medio (fase `transcripcion` o `percepcion` de la ingesta). El documento sigue «listo». */
export async function lanzarMedio(p: PuertosUsuario, documento: string, pedido: PedidoMedio): Promise<{ documento: string; tarea: string }> {
  const d = await leerDocumento(p.sql, documento);
  if (!d) throw new Error(`No existe el documento ${documento}`);
  const prefijo = prefijoDocumento(p.usuario.id, documento);
  const paquete = (await p.almacen.existe(`${prefijo}paquete.json`)) ? `${prefijo}paquete.json` : undefined;
  const medio = {
    ...(pedido.rehacer ? { rehacer: true } : {}), ...(pedido.forzar ? { forzar: true } : {}),
    ...(pedido.hablantes === false ? { hablantes: false } : {}), ...(pedido.presupuestoUsd ? { presupuestoUsd: pedido.presupuestoUsd } : {}),
  };
  const r = await lanzarIngesta(p, {
    documento, prefijo, original: d.original, ...(paquete ? { paquete } : {}), tipo: d.tipo, mime: d.mime, nombre: d.metadatos.titulo,
    fases: pedido.que === 'percepcion' ? ['proxy', 'percepcion', 'transcripcion'] : ['transcripcion'], ...(Object.keys(medio).length ? { medio } : {}),
  }, 'reproceso', { conservarEstado: true });
  return { documento, tarea: r.tarea };
}

/** Trabajos de medios en marcha (tareas de las fases `transcripcion` o `percepcion` sin terminar). */
async function enMarcha(sql: SQL): Promise<Set<string>> {
  const filas = await sql.ejecutar<{ documento: string | null; params: string | null }>("SELECT documento, params FROM pl_tareas WHERE estado IN ('en_cola','procesando')");
  const docs = new Set<string>();
  for (const f of filas) {
    try {
      const fases = ((f.params ? JSON.parse(f.params) : {}) as { fases?: string[] }).fases ?? [];
      if (f.documento && fases.some((x) => x === 'transcripcion' || x === 'percepcion')) docs.add(f.documento);
    } catch { /* fila rota */ }
  }
  return docs;
}

/** Encola el trabajo de varios medios y lanza los primeros; los demás salen al terminar estos (`lanzarMediosPendientes`). */
export async function encolarMedios(p: PuertosUsuario, documentos: string[], pedido: PedidoMedio): Promise<{ encolados: number; lanzados: Array<{ documento: string; tarea: string }> }> {
  const ocupados = await enMarcha(p.sql);
  const ya = new Set((await p.sql.ejecutar<{ documento: string }>('SELECT documento FROM procedencia WHERE fase = ?', FASE_COLA)).map((f) => String(f.documento)));
  let encolados = 0;
  const cuando = new Date().toISOString();
  for (const id of documentos) {
    if (ocupados.has(id) || ya.has(id)) continue;
    await p.sql.ejecutar('INSERT INTO procedencia (documento, fase, proveedor, detalle, ms, cuando) VALUES (?, ?, ?, ?, ?, ?)', id, FASE_COLA, pedido.que, JSON.stringify(pedido), null, cuando);
    encolados++;
  }
  return { encolados, lanzados: await lanzarMediosPendientes(p) };
}

/** Lanza los trabajos de medios encolados hasta llenar el cupo del usuario. */
export async function lanzarMediosPendientes(p: PuertosUsuario, maximo = MEDIOS_A_LA_VEZ): Promise<Array<{ documento: string; tarea: string }>> {
  const filas = await p.sql.ejecutar<{ documento: string; detalle: string }>('SELECT documento, detalle FROM procedencia WHERE fase = ? ORDER BY cuando, rowid', FASE_COLA);
  if (!filas.length) return [];
  const ocupados = await enMarcha(p.sql);
  const lanzados: Array<{ documento: string; tarea: string }> = [];
  for (const f of filas) {
    if (ocupados.size + lanzados.length >= maximo) break;
    const id = String(f.documento);
    await p.sql.ejecutar('DELETE FROM procedencia WHERE documento = ? AND fase = ?', id, FASE_COLA);
    if (ocupados.has(id)) continue;
    try {
      lanzados.push(await lanzarMedio(p, id, JSON.parse(String(f.detalle)) as PedidoMedio));
    } catch (e) { console.error('medio', id, e); }
  }
  return lanzados;
}

/** Los medios de la biblioteca («listos»), o los pedidos que lo sean. */
export async function mediosDeBiblioteca(sql: SQL, documentos?: string[]): Promise<string[]> {
  const filas = await sql.ejecutar<{ id: string }>("SELECT id FROM documentos WHERE estado = 'listo' AND tipo IN ('video','audio') ORDER BY creado");
  const todos = filas.map((f) => String(f.id));
  if (!documentos?.length) return todos;
  const pedidos = new Set(documentos);
  return todos.filter((id) => pedidos.has(id));
}

/** Lo que se lanzaría y lo que costaría, documento a documento. */
export async function estimarMedios(
  p: Pick<PuertosUsuario, 'sql' | 'almacen' | 'usuario'>, documentos: string[], pedido: PedidoMedio,
): Promise<{ documentos: EstimacionMedio[]; usd: number; horas: number }> {
  const out: EstimacionMedio[] = [];
  for (const id of documentos) {
    const e = await estimarMedio({ sql: p.sql, almacen: p.almacen }, { id, prefijo: prefijoDocumento(p.usuario.id, id) }, {
      percepcion: pedido.que === 'percepcion', hablantes: pedido.hablantes !== false && revisaHablantes(p.usuario.plan), ...(pedido.rehacer ? { rehacer: true } : {}),
    });
    if (e && e.hara.length) out.push(e);
  }
  return {
    documentos: out, usd: Math.round(out.reduce((s, e) => s + e.usd, 0) * 100) / 100,
    horas: Math.round((out.reduce((s, e) => s + e.duracion, 0) / 3600) * 100) / 100,
  };
}
