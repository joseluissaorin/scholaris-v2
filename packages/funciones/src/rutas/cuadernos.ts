/** Rutas de los cuadernos (contrato: funciones.ts, «Cuadernos»). */

import type { NuevaTarjeta, NuevoCuaderno, PedirSintesis } from '@scholaris/contrato';
import type { EntornoFunciones } from '../puertos.js';
import {
  actualizarCuaderno, actualizarTarjeta, borrarCuaderno, borrarTarjeta, crearCuaderno, crearTarjeta, listarCuadernos, listarSintesis,
  listarTarjetas, obtenerCuaderno, obtenerSintesis, ordenarTarjetas, reverificarCuaderno, sintetizar,
} from '../cuadernos.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, ok, type AppFunciones } from './comun.js';

export function rutasCuadernos<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/cuadernos', manejar(async (c, { sql }) => c.json(await listarCuadernos(sql))));
  app.post('/cuadernos', manejar(async (c, { sql }) => c.json(await crearCuaderno(sql, await cuerpo<NuevoCuaderno>(c)), 201)));
  // Antes que /cuadernos/:id/…, para que «sintesis» no se tome por un id.
  app.get('/cuadernos/sintesis/:sintesis', manejar(async (c, { sql }) => c.json(await obtenerSintesis(sql, c.req.param('sintesis')!))));
  app.get('/cuadernos/:id', manejar(async (c, { sql }) => c.json(await obtenerCuaderno(sql, c.req.param('id')!))));
  app.patch('/cuadernos/:id', manejar(async (c, { sql }) => c.json(await actualizarCuaderno(sql, c.req.param('id')!, await cuerpo<Partial<NuevoCuaderno>>(c)))));
  app.delete('/cuadernos/:id', manejar(async (c, { sql }) => { await borrarCuaderno(sql, c.req.param('id')!); return ok(c); }));

  app.get('/cuadernos/:id/tarjetas', manejar(async (c, { sql }) => c.json(await listarTarjetas(sql, c.req.param('id')!))));
  app.post('/cuadernos/:id/tarjetas', manejar(async (c, p) => c.json(await crearTarjeta(p, c.req.param('id')!, await cuerpo<NuevaTarjeta>(c)), 201)));
  app.post('/cuadernos/:id/tarjetas/ordenar', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ orden?: unknown }>(c);
    if (!Array.isArray(b.orden) || b.orden.some((x) => typeof x !== 'string')) throw new ErrorFunciones('peticion_invalida', 'Falta «orden»: la lista de ids de las tarjetas.');
    await ordenarTarjetas(sql, c.req.param('id')!, b.orden as string[]);
    return ok(c);
  }));
  app.patch('/cuadernos/:id/tarjetas/:tarjeta', manejar(async (c, p) => {
    const b = await cuerpo<{ contenido?: Record<string, unknown>; posicion?: number }>(c);
    return c.json(await actualizarTarjeta(p, c.req.param('id')!, c.req.param('tarjeta')!, b));
  }));
  app.delete('/cuadernos/:id/tarjetas/:tarjeta', manejar(async (c, { sql }) => {
    await borrarTarjeta(sql, c.req.param('id')!, c.req.param('tarjeta')!);
    return ok(c);
  }));

  app.post('/cuadernos/:id/sintesis', manejar(async (c, p) => {
    const b = await cuerpo<PedirSintesis>(c);
    return c.json(await sintetizar(p, c.req.param('id')!, b.instrucciones), 201);
  }));
  app.get('/cuadernos/:id/sintesis', manejar(async (c, { sql }) => c.json(await listarSintesis(sql, c.req.param('id')!))));
  app.post('/cuadernos/:id/reverificar', manejar(async (c, p) => c.json({ tarjetas: await reverificarCuaderno(p, c.req.param('id')!) })));
}
