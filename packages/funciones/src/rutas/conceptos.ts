/** Rutas de los conceptos (contrato: funciones.ts, «Conceptos»). */

import type { Context } from 'hono';
import type { EntornoFunciones, PuertosFunciones } from '../puertos.js';
import {
  actualizarConcepto, agregadosInforme, borrarConcepto, crearConcepto, crearInforme, etiquetarTramo, listarConceptos, listarInformes,
  listarTramos, obtenerConcepto, obtenerInforme, procesarInforme, type FiltrosTramos, type NuevoConceptoCompleto, type OpcionesInforme,
} from '../conceptos/conceptos.js';
import { exportarInforme } from '../conceptos/exportar.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, ok, qNumero, qTexto, quiereSSE, sse, type AppFunciones } from './comun.js';

async function avisarFin(p: PuertosFunciones, informe: string) {
  if (!p.emisor) return;
  try {
    const i = await obtenerInforme(p.sql, informe);
    await p.emisor.emitir(p.canal ?? `usuario:${p.usuario.id}`, {
      tipo: 'fin', tarea: informe, estado: i.estado === 'listo' ? 'listo' : 'error', ...(i.error ? { error: i.error } : {}),
    });
  } catch {
    // El aviso es secundario.
  }
}

async function ejecutar(c: Context, p: PuertosFunciones): Promise<Response> {
  const concepto = c.req.param('id')!;
  await obtenerConcepto(p.sql, concepto);
  const o = await cuerpo<OpcionesInforme>(c);
  const informe = await crearInforme(p.sql, concepto);
  const respuesta = { informe, tarea: informe };
  if (quiereSSE(c)) {
    return sse(async (enviar) => {
      await enviar('inicio', respuesta);
      await procesarInforme(p, informe, o, (e) => enviar('progreso', { fase: e.fase, avance: e.avance, mensaje: e.mensaje }));
      await enviar('fin', { fin: await obtenerInforme(p.sql, informe) });
      await avisarFin(p, informe);
    });
  }
  const trabajo = procesarInforme(p, informe, o).then(() => avisarFin(p, informe));
  if (p.enSegundoPlano) {
    p.enSegundoPlano(trabajo);
    return c.json(respuesta, 202);
  }
  await trabajo;
  return c.json(respuesta, 201);
}

export function rutasConceptos<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/conceptos', manejar(async (c, { sql }) => c.json(await listarConceptos(sql))));
  app.post('/conceptos', manejar(async (c, { sql }) => c.json(await crearConcepto(sql, await cuerpo<NuevoConceptoCompleto>(c)), 201)));

  // Antes que /conceptos/:id.
  app.get('/conceptos/informes/:informe', manejar(async (c, { sql }) => c.json(await obtenerInforme(sql, c.req.param('informe')!))));
  app.get('/conceptos/informes/:informe/tramos', manejar(async (c, { sql }) => {
    const f: FiltrosTramos = {};
    const limite = qNumero(c, 'limite'), confianza = qNumero(c, 'confianzaMinima');
    if (limite !== undefined) f.limite = limite;
    if (confianza !== undefined) f.confianzaMinima = confianza;
    for (const k of ['cursor', 'documento', 'idioma', 'uso', 'lema', 'tipoCoincidencia'] as const) {
      const v = qTexto(c, k);
      if (v) f[k] = v;
    }
    const orden = qTexto(c, 'orden');
    if (orden) {
      if (!['confianza', 'documento', 'anio'].includes(orden)) throw new ErrorFunciones('peticion_invalida', 'El orden debe ser «confianza», «documento» o «anio».');
      f.orden = orden as FiltrosTramos['orden'];
    }
    return c.json(await listarTramos(sql, c.req.param('informe')!, f));
  }));
  app.get('/conceptos/informes/:informe/agregados', manejar(async (c, { sql }) => c.json(await agregadosInforme(sql, c.req.param('informe')!))));
  app.get('/conceptos/informes/:informe/exportar', manejar(async (c, { sql }) => {
    const e = await exportarInforme(sql, c.req.param('informe')!, qTexto(c, 'formato') ?? 'csv');
    return new Response(e.cuerpo as Uint8Array<ArrayBuffer>, {
      headers: { 'content-type': e.tipo, 'content-disposition': `attachment; filename="${e.nombre}"`, 'cache-control': 'no-store' },
    });
  }));
  app.post('/conceptos/tramos/:tramo/etiqueta', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ etiqueta?: string; nota?: string }>(c);
    return c.json(await etiquetarTramo(sql, c.req.param('tramo')!, String(b.etiqueta ?? ''), b.nota));
  }));

  app.get('/conceptos/:id', manejar(async (c, { sql }) => c.json(await obtenerConcepto(sql, c.req.param('id')!))));
  app.patch('/conceptos/:id', manejar(async (c, { sql }) => c.json(await actualizarConcepto(sql, c.req.param('id')!, await cuerpo<Partial<NuevoConceptoCompleto>>(c)))));
  app.delete('/conceptos/:id', manejar(async (c, { sql }) => { await borrarConcepto(sql, c.req.param('id')!); return ok(c); }));
  app.post('/conceptos/:id/ejecutar', manejar(ejecutar));
  app.get('/conceptos/:id/informes', manejar(async (c, { sql }) => c.json(await listarInformes(sql, c.req.param('id')!))));
}
