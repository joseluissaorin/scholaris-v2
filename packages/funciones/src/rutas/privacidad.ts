/** Rutas de privacidad (contrato: cuenta.ts, «Privacidad»). */

import type { EntornoFunciones } from '../puertos.js';
import { estadoGrabacion, fijarGrabacion } from '../ajustes.js';
import { exportarDatos, purgarHistorial, purgarTodo, zipExportacion } from '../privacidad.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, qBool, type AppFunciones } from './comun.js';

export function rutasPrivacidad<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/privacidad/grabacion', manejar(async (c, { sql }) => c.json(await estadoGrabacion(sql))));
  app.post('/privacidad/grabacion', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ activa?: unknown }>(c);
    if (typeof b.activa !== 'boolean') throw new ErrorFunciones('peticion_invalida', 'Falta «activa» (verdadero o falso).');
    return c.json(await fijarGrabacion(sql, b.activa));
  }));
  app.get('/privacidad/exportar', manejar(async (c, { sql }) => {
    const zip = zipExportacion(await exportarDatos(sql, { biblioteca: qBool(c, 'biblioteca') ?? true }));
    const fecha = new Date().toISOString().slice(0, 10);
    return new Response(zip as Uint8Array<ArrayBuffer>, {
      headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="scholaris-exportacion-${fecha}.zip"`, 'cache-control': 'no-store' },
    });
  }));
  app.delete('/privacidad/historial', manejar(async (c, { sql }) => c.json(await purgarHistorial(sql))));
  app.post('/privacidad/purgar', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ confirmar?: string }>(c);
    if (b.confirmar !== 'BORRAR') throw new ErrorFunciones('peticion_invalida', 'Para borrarlo todo hay que confirmar con «BORRAR».');
    return c.json(await purgarTodo(sql));
  }));
}
