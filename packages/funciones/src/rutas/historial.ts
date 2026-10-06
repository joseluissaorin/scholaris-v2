/** Rutas del historial de búsquedas (contrato: funciones.ts, «Historial»). */

import type { IntencionConsulta } from '@scholaris/contrato';
import type { EntornoFunciones } from '../puertos.js';
import {
  anotarBusqueda, borrarBusqueda, estadisticasHistorial, eventosBusqueda, fijarBusqueda, listarHistorial, obtenerBusqueda,
  ocultarBusqueda, parametrosRepeticion, type RangoEstadisticas,
} from '../historial.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, ok, qBool, qNumero, qTexto, sse, type AppFunciones } from './comun.js';

export function rutasHistorial<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/historial', manejar(async (c, { sql }) => {
    const f: Parameters<typeof listarHistorial>[1] = {};
    const q = qTexto(c, 'q'), desde = qTexto(c, 'desde'), hasta = qTexto(c, 'hasta'), intencion = qTexto(c, 'intencion');
    const cursor = qTexto(c, 'cursor'), limite = qNumero(c, 'limite'), fijados = qBool(c, 'fijados');
    const confianza = qTexto(c, 'confianza'), biblioteca = qTexto(c, 'biblioteca');
    if (q) f.q = q;
    if (desde) f.desde = desde;
    if (hasta) f.hasta = hasta;
    if (intencion) f.intencion = intencion as IntencionConsulta;
    if (cursor) f.cursor = cursor;
    if (limite !== undefined) f.limite = limite;
    if (fijados) f.fijados = true;
    if (confianza) f.confianza = confianza as 'alta' | 'media' | 'baja';
    if (biblioteca) f.biblioteca = biblioteca;
    return c.json(await listarHistorial(sql, f));
  }));

  app.get('/historial/estadisticas', manejar(async (c, { sql }) => {
    const rango = (qTexto(c, 'rango') ?? '30d') as RangoEstadisticas;
    if (!['24h', '7d', '30d', '90d', 'todo'].includes(rango)) throw new ErrorFunciones('peticion_invalida', 'El rango debe ser «24h», «7d», «30d», «90d» o «todo».');
    return c.json(await estadisticasHistorial(sql, rango));
  }));

  app.get('/historial/:id', manejar(async (c, { sql }) => c.json(await obtenerBusqueda(sql, c.req.param('id')!))));

  /** Reproduce la búsqueda tal como se vio (SSE). `velocidad=original` respeta los tiempos (máximo 5 s entre eventos). */
  app.get('/historial/:id/reproducir', manejar(async (c, { sql }) => {
    const eventos = await eventosBusqueda(sql, c.req.param('id')!);
    const original = qTexto(c, 'velocidad') === 'original';
    return sse(async (enviar) => {
      let previo: number | null = null;
      for (const e of eventos) {
        if (original && previo !== null) await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(0, e.ms - previo!))));
        previo = e.ms;
        await enviar(e.etapa ?? 'evento', e.datos);
      }
      await enviar('fin_reproduccion', {});
    });
  }));

  app.post('/historial/:id/fijar', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ fijado?: unknown }>(c);
    if (typeof b.fijado !== 'boolean') throw new ErrorFunciones('peticion_invalida', 'Falta «fijado» (verdadero o falso).');
    await fijarBusqueda(sql, c.req.param('id')!, b.fijado);
    return ok(c);
  }));

  app.post('/historial/:id/nota', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ nota?: unknown }>(c);
    if (b.nota !== null && b.nota !== undefined && typeof b.nota !== 'string') throw new ErrorFunciones('peticion_invalida', 'La nota debe ser un texto.');
    await anotarBusqueda(sql, c.req.param('id')!, (b.nota as string | null | undefined) ?? null);
    return ok(c);
  }));

  app.post('/historial/:id/ocultar', manejar(async (c, { sql }) => {
    await ocultarBusqueda(sql, c.req.param('id')!);
    return ok(c);
  }));

  app.post('/historial/:id/repetir', manejar(async (c, { sql }) => c.json(await parametrosRepeticion(sql, c.req.param('id')!))));

  app.delete('/historial/:id', manejar(async (c, { sql }) => {
    await borrarBusqueda(sql, c.req.param('id')!);
    return ok(c);
  }));
}
