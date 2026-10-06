/** Rutas de vigilantes y alertas (contrato: funciones.ts, «Vigilantes y alertas»). */

import type { NuevoVigilante } from '@scholaris/contrato';
import type { EntornoFunciones } from '../puertos.js';
import {
  actualizarVigilante, alertasDeVigilante, borrarVigilante, crearVigilante, ejecutarVigilante, listarAlertas, listarVigilantes,
  marcarAlertaVista, marcarTodasVistas, obtenerVigilante,
} from '../vigilantes.js';
import { cuerpo, manejar, ok, qBool, qNumero, type AppFunciones } from './comun.js';

export function rutasVigilantes<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/vigilantes', manejar(async (c, { sql }) => c.json(await listarVigilantes(sql))));
  app.post('/vigilantes', manejar(async (c, { sql }) => c.json(await crearVigilante(sql, await cuerpo<NuevoVigilante>(c)), 201)));
  app.get('/vigilantes/:id', manejar(async (c, { sql }) => c.json(await obtenerVigilante(sql, c.req.param('id')!))));
  app.patch('/vigilantes/:id', manejar(async (c, { sql }) => c.json(await actualizarVigilante(sql, c.req.param('id')!, await cuerpo<Partial<NuevoVigilante>>(c)))));
  app.delete('/vigilantes/:id', manejar(async (c, { sql }) => { await borrarVigilante(sql, c.req.param('id')!); return ok(c); }));
  app.post('/vigilantes/:id/ejecutar', manejar(async (c, p) => {
    const a = await ejecutarVigilante(p, c.req.param('id')!, { disparadaPor: 'manual' });
    return c.json(a ?? { nada: true as const });
  }));
  app.get('/vigilantes/:id/alertas', manejar(async (c, { sql }) => c.json(await alertasDeVigilante(sql, c.req.param('id')!, qNumero(c, 'limite')))));
}

export function rutasAlertas<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/alertas', manejar(async (c, { sql }) => {
    const limite = qNumero(c, 'limite');
    return c.json(await listarAlertas(sql, { pendientes: qBool(c, 'pendientes') ?? false, ...(limite ? { limite } : {}) }));
  }));
  app.post('/alertas/vistas', manejar(async (c, { sql }) => c.json({ vistas: await marcarTodasVistas(sql) })));
  app.post('/alertas/:id/visto', manejar(async (c, { sql }) => { await marcarAlertaVista(sql, c.req.param('id')!); return ok(c); }));
}
