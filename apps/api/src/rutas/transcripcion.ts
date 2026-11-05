/**
 * La transcripción revisada de los medios y la percepción de los que ya están en
 * la biblioteca (packages/ingesta/src/percepcion/NOTAS.md, «La transcripción»):
 *
 *   POST /documentos/:id/transcripcion/revisar   revisar (o aplicar una revisión
 *        que llega en el cuerpo) y reescribir la transcripción de un medio
 *   GET  /documentos/:id/transcripcion/revision  la revisión guardada, resumida
 *   POST /transcripcion/revisar                  lo mismo para muchos medios
 *   POST /medios/percibir                        proxy, percepción y transcripción
 *        revisada de los medios que aún no la tienen
 *
 * Todo lo que gasta modelo dice antes lo que costaría: con `simular` (o sin
 * `confirmar`, en las de la biblioteca) solo se estima. El documento sigue
 * «listo» mientras se trabaja; la comprensión se pone al día sola después.
 */
import type { Hono } from 'hono';
import type { RevisionTranscripcion } from '@scholaris/ingesta';
import { leerDocumento } from '@scholaris/spdf';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { tareaDeDocumento } from '../compartido/estanteria.js';
import { encolarMedios, estimarMedios, lanzarMedio, mediosDeBiblioteca, preciosHora, type PedidoMedio } from '../compartido/medios-existentes.js';
import { coberturaActual, leerRevision, revisaHablantes } from '../compartido/transcripcion.js';
import { prefijoDocumento } from './subidas.js';
import { exigirEscritura, prm, puertos, type Ctx } from './util.js';

interface CuerpoRevisar {
  /** Una revisión hecha fuera (la `RevisionTranscripcion` de la percepción): se aplica tal cual. */
  revision?: RevisionTranscripcion;
  /** Volver a revisar aunque haya una revisión guardada sin aplicar. */
  rehacer?: boolean;
  /** Aplicar aunque ya conste como aplicada o no case del todo con las unidades actuales. */
  forzar?: boolean;
  /** Revisar también quién dice cada frase (con la percepción; planes de pago). */
  hablantes?: boolean;
  /** Hacer antes la percepción completa del medio (si no la tiene). */
  percepcion?: boolean;
  /** Solo decir qué se haría y cuánto costaría. */
  simular?: boolean;
  presupuestoUsd?: number;
}

interface CuerpoBiblioteca {
  documentos?: string[];
  /** Sin él, solo se estima. */
  confirmar?: boolean;
  rehacer?: boolean;
  hablantes?: boolean;
  /** Tope del gasto total: si la estimación lo pasa, no se lanza nada. */
  presupuestoUsd?: number;
}

const esMedio = (tipo: string) => tipo === 'video' || tipo === 'audio';

function revisionValida(r: unknown, documento: string): RevisionTranscripcion {
  const x = r as Partial<RevisionTranscripcion> | null;
  exigir(!!x && typeof x === 'object' && Array.isArray(x.correcciones) && !!x.cobertura && typeof x.cobertura === 'object', '«revision» tiene que ser una revisión de la transcripción (con «correcciones» y «cobertura»).');
  exigir(!x!.documento || x!.documento === documento, `La revisión es de otro documento (${x!.documento}).`);
  exigir(x!.correcciones!.length <= 20_000, 'La revisión trae demasiadas correcciones.');
  for (const c of x!.correcciones!) {
    exigir(c && typeof c === 'object' && ['hueco', 'hablante', 'desfase'].includes((c as { tipo: string }).tipo), 'Cada corrección es un «hueco», un «hablante» o un «desfase».');
  }
  // Lo que no es de la revisión (las unidades revisadas que trae el JSON de la percepción) no se guarda.
  const { unidadesRevisadas: _u, ...limpia } = x as RevisionTranscripcion & { unidadesRevisadas?: unknown };
  return { ...limpia, documento, version: limpia.version ?? 'externa', modelo: limpia.modelo ?? 'externa', avisos: limpia.avisos ?? [], coste: limpia.coste ?? { usd: 0, llamadas: 0, tokensEntrada: 0, tokensSalida: 0, ms: 0, grabadas: 0 } };
}

const pedidoDe = (b: { rehacer?: boolean; forzar?: boolean; hablantes?: boolean; presupuestoUsd?: number }, que: PedidoMedio['que']): PedidoMedio => ({
  que, ...(b.rehacer ? { rehacer: true } : {}), ...(b.forzar ? { forzar: true } : {}), ...(b.hablantes === false ? { hablantes: false } : {}),
  ...(typeof b.presupuestoUsd === 'number' && b.presupuestoUsd > 0 ? { presupuestoUsd: b.presupuestoUsd } : {}),
});

export function rutasTranscripcion(app: Hono<Entorno>): void {
  app.post('/documentos/:id/transcripcion/revisar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    const d = await leerDocumento(p.sql, id);
    if (!d) noEncontrado('El documento');
    exigir(esMedio(d.tipo), 'Solo los audios y los vídeos tienen transcripción que revisar.');
    exigir(d.estado === 'listo', 'El documento todavía no está listo: su transcripción se completa sola al terminar la ingesta.');
    const b = await cuerpoJson<CuerpoRevisar>(c);
    const pedido = pedidoDe(b, b.percepcion ? 'percepcion' : 'transcripcion');
    if (b.revision !== undefined) {
      exigir(!b.percepcion, 'Con una revisión hecha fuera no se percibe el medio: pide la percepción aparte.');
      pedido.rehacer = false;
    }
    const estimada = (await estimarMedios(p, [id], pedido)).documentos[0] ?? null;
    // Con una revisión hecha fuera no se revisa nada: solo se reescribe (el contexto y los vectores de lo nuevo, céntimos).
    const estimacion = estimada && b.revision !== undefined ? { ...estimada, hara: ['reescritura' as const], usd: 0 } : estimada;
    if (b.simular) return c.json({ documento: id, lanzada: false, estimacion, precios: preciosHora() });
    if (await tareaDeDocumento(p.sql, id)) fallo('conflicto', 'El documento ya se está procesando.');
    if (b.revision !== undefined) {
      const r = revisionValida(b.revision, id);
      // Sin aplicar todavía: la aplica la tarea, que comprueba antes que es de estas unidades.
      await p.almacen.poner(`${prefijoDocumento(p.usuario.id, id)}transcripcion.revision.json`, JSON.stringify({ ...r, aplicada: undefined }), 'application/json');
    }
    const r = await lanzarMedio(p, id, pedido);
    return c.json({ ...r, lanzada: true, estimacion }, 202);
  });

  app.get('/documentos/:id/transcripcion/revision', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const d = await leerDocumento(p.sql, id);
    if (!d) noEncontrado('El documento');
    const r = await leerRevision(p.almacen, prefijoDocumento(p.usuario.id, id));
    // La última tarea de revisión (o de percepción) de este medio y los avisos que dejó: para quien espera a que termine.
    const tareas = await p.sql.ejecutar<{ id: string; estado: string; error: string | null; params: string | null; actualizada: string }>('SELECT id, estado, error, params, actualizada FROM pl_tareas WHERE documento = ? ORDER BY creada DESC LIMIT 20', id);
    const t = tareas.find((x) => { try { return ((x.params ? JSON.parse(x.params) : {}) as { fases?: string[] }).fases?.some((f) => f === 'transcripcion' || f === 'percepcion'); } catch { return false; } });
    const tarea = t ? { id: t.id, estado: t.estado, actualizada: t.actualizada, ...(t.error ? { error: t.error } : {}) } : null;
    const avisosDoc = (await p.sql.ejecutar<{ codigo: string; mensaje: string }>("SELECT codigo, mensaje FROM pl_avisos WHERE documento = ? AND codigo LIKE 'transcripcion%'", id)).map((x) => ({ codigo: x.codigo, mensaje: x.mensaje }));
    if (!r && !tarea) noEncontrado('La revisión de la transcripción');
    if (!r) return c.json({ documento: id, aplicada: null, tarea, avisosDocumento: avisosDoc });
    const cuenta = (tipo: string, reemplaza?: boolean) => r.correcciones.filter((x) => x.tipo === tipo && (reemplaza === undefined || (x.tipo === 'hueco' && !!x.reemplaza?.length) === reemplaza)).length;
    // Revisiones guardadas antes de que la cobertura supiera de música: se recalcula la de ahora (sin modelos).
    const final = r.aplicada && r.coberturaFinal && r.coberturaFinal.musica === undefined
      ? (await coberturaActual(p, id, prefijoDocumento(p.usuario.id, id), d.duracion ?? undefined).catch(() => null)) ?? r.coberturaFinal
      : r.coberturaFinal;
    const sinTexto = (cb: RevisionTranscripcion['cobertura']) => ({
      activo: cb.activo, cubierto: cb.cubierto, huecos: cb.huecos.filter((h) => h.motivo !== 'musica').length,
      ...(cb.musica !== undefined ? { musica: Math.round(cb.musica) } : {}),
      segundosSinTexto: Math.round(cb.huecos.filter((h) => h.motivo === 'sin_texto').reduce((s, h) => s + h.activo, 0)), palabrasRotas: cb.palabrasRotas,
      // Dónde están (los primeros 400): la web los marca en la línea del tiempo del reproductor.
      lista: cb.huecos.filter((h) => h.motivo !== 'musica').slice(0, 400).map((h) => ({ t0: Math.round(h.t0 * 10) / 10, t1: Math.round(h.t1 * 10) / 10, motivo: h.motivo as 'sin_texto' | 'tiempos_rotos', activo: Math.round(h.activo * 10) / 10 })),
    });
    return c.json({
      documento: id, version: r.version, modelo: r.modelo, aplicada: r.aplicada ?? null,
      correcciones: { huecos: cuenta('hueco', false), tiemposRotos: cuenta('hueco', true), hablantes: cuenta('hablante'), desfases: cuenta('desfase') },
      cobertura: { antes: sinTexto(r.cobertura), ...(final ? { despues: sinTexto(final) } : {}) },
      usd: r.coste?.usd ?? 0, avisos: r.avisos.slice(0, 50), tarea, avisosDocumento: avisosDoc,
    });
  });

  app.post('/transcripcion/revisar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<CuerpoBiblioteca>(c);
    if (b.documentos !== undefined) exigir(Array.isArray(b.documentos) && b.documentos.every((x) => typeof x === 'string'), '«documentos» es una lista de ids.');
    const pedido = pedidoDe(b, 'transcripcion');
    const est = await estimarMedios(p, await mediosDeBiblioteca(p.sql, b.documentos), pedido);
    if (!b.confirmar) return c.json({ lanzada: false, ...est, precios: preciosHora(), aviso: 'Solo es una estimación: repite la petición con «confirmar»: true para lanzarla.' });
    if (b.presupuestoUsd !== undefined && est.usd > b.presupuestoUsd) fallo('conflicto', `La estimación (${est.usd.toFixed(2)} $) pasa del presupuesto que has puesto (${b.presupuestoUsd.toFixed(2)} $).`, { usd: est.usd });
    const r = await encolarMedios(p, est.documentos.map((e) => e.documento), pedido);
    return c.json({ lanzada: true, ...est, ...r }, 202);
  });

  app.post('/medios/percibir', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<CuerpoBiblioteca>(c);
    if (b.documentos !== undefined) exigir(Array.isArray(b.documentos) && b.documentos.every((x) => typeof x === 'string'), '«documentos» es una lista de ids.');
    const pedido = pedidoDe(b, 'percepcion');
    const est = await estimarMedios(p, await mediosDeBiblioteca(p.sql, b.documentos), pedido);
    const salida = { ...est, precios: preciosHora(), hablantes: revisaHablantes(p.usuario.plan) && b.hablantes !== false };
    if (!b.confirmar) return c.json({ lanzada: false, ...salida, aviso: 'Solo es una estimación: repite la petición con «confirmar»: true para lanzarla.' });
    // Como la comprensión: sola, solo en los planes de pago; en el gratuito, de uno en uno y pedido a mano.
    if (p.usuario.plan === 'gratis' && est.documentos.length > 1) fallo('requiere_pro', 'Percibir los medios de toda la biblioteca es de los planes de pago. En el gratuito, pídelo de uno en uno con POST /documentos/{id}/transcripcion/revisar y «percepcion»: true.');
    if (b.presupuestoUsd !== undefined && est.usd > b.presupuestoUsd) fallo('conflicto', `La estimación (${est.usd.toFixed(2)} $) pasa del presupuesto que has puesto (${b.presupuestoUsd.toFixed(2)} $).`, { usd: est.usd });
    const r = await encolarMedios(p, est.documentos.map((e) => e.documento), pedido);
    return c.json({ lanzada: true, ...salida, ...r }, 202);
  });
}
