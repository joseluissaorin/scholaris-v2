/** Rutas de las perspectivas (contrato: funciones.ts, «Perspectivas y corpus»). */

import type { EntornoFunciones } from '../puertos.js';
import { arqueologia, descartarRecomendacion, huecos, recomendaciones, registrarApertura } from '../perspectivas.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, ok, qNumero, qTexto, type AppFunciones } from './comun.js';

export function rutasPerspectivas<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/perspectivas/arqueologia', manejar(async (c, { sql }) => {
    const dias = qNumero(c, 'dias'), cubeta = qTexto(c, 'cubeta');
    if (cubeta && !['dia', 'semana', 'mes'].includes(cubeta)) throw new ErrorFunciones('peticion_invalida', 'La cubeta debe ser «dia», «semana» o «mes».');
    return c.json(await arqueologia(sql, { ...(dias ? { dias } : {}), ...(cubeta ? { cubeta: cubeta as 'dia' | 'semana' | 'mes' } : {}) }));
  }));
  app.get('/perspectivas/huecos', manejar(async (c, { sql }) => {
    const dias = qNumero(c, 'dias');
    return c.json(await huecos(sql, dias ? { dias } : {}));
  }));
  app.get('/perspectivas/recomendaciones', manejar(async (c, { sql }) => {
    const limite = qNumero(c, 'limite');
    return c.json(await recomendaciones(sql, limite ? { limite } : {}));
  }));
  app.post('/perspectivas/recomendaciones/:documento/descartar', manejar(async (c, { sql }) => {
    await descartarRecomendacion(sql, c.req.param('documento')!);
    return ok(c);
  }));
  app.post('/perspectivas/abierto', manejar(async (c, { sql }) => {
    const b = await cuerpo<{ documento?: string; unidad?: string; superficie?: string }>(c);
    if (!b.documento || typeof b.documento !== 'string') throw new ErrorFunciones('peticion_invalida', 'Falta el documento abierto.');
    await registrarApertura(sql, { documento: b.documento, ...(b.unidad ? { unidad: b.unidad } : {}), ...(b.superficie ? { superficie: b.superficie } : {}) });
    return ok(c);
  }));
}
