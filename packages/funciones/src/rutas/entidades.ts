/** Rutas de las entidades (contrato: funciones.ts, «Entidades»). */

import type { EntornoFunciones } from '../puertos.js';
import {
  buscarEntidades, caminoEntidades, encolarEntidades, entidadesDocumento, entidadesLector, estadoEntidades, estadoExtraccion,
  extraerEntidadesDocumento, fichaEntidad, hayEntidadesPendientes, lineaTemporalEntidad, mencionesEntidad, reanudarEntidades,
  vecindarioEntidad,
} from '../entidades/index.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, qBool, qNumero, qTexto, type AppFunciones } from './comun.js';

export function rutasEntidades<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  // Las rutas fijas van antes que «/entidades/:id».
  app.get('/entidades', manejar(async (c, { sql }) => {
    const q = qTexto(c, 'q'), tipo = qTexto(c, 'tipo'), documento = qTexto(c, 'documento'), limite = qNumero(c, 'limite'), cursor = qTexto(c, 'cursor');
    return c.json(await buscarEntidades(sql, { ...(q ? { q } : {}), ...(tipo ? { tipo } : {}), ...(documento ? { documento } : {}), ...(limite ? { limite } : {}), ...(cursor ? { cursor } : {}) }));
  }));

  app.get('/entidades/estado', manejar(async (c, p) => {
    // Mirar el estado también despierta lo que se quedó parado (un Durable Object reciclado).
    if (p.enSegundoPlano && p.inteligencia?.redactor && (await hayEntidadesPendientes(p.sql))) p.enSegundoPlano(reanudarEntidades(p));
    return c.json(await estadoEntidades(p.sql));
  }));

  app.post('/entidades/reanudar', manejar(async (c, p) => {
    const b = await cuerpo<{ todos?: boolean }>(c);
    if (!p.inteligencia?.redactor) throw new ErrorFunciones('no_disponible', 'No hay redactor configurado para reconocer entidades.', 503);
    const todos = b.todos === true || qBool(c, 'todos') === true;
    if (p.enSegundoPlano) {
      // Se responde enseguida con lo que se va a hacer; el trabajo sigue detrás.
      const pendientes = (await p.sql.ejecutar<{ documento: string }>("SELECT documento FROM entidades_trabajos WHERE estado <> 'hecho'")).map((f) => f.documento);
      const nuevos = todos ? (await p.sql.ejecutar<{ id: string }>("SELECT id FROM documentos WHERE estado = 'listo' AND id NOT IN (SELECT documento FROM entidades_trabajos)")).map((f) => f.id) : [];
      for (const d of nuevos) await encolarEntidades(p.sql, d);
      p.enSegundoPlano(reanudarEntidades(p));
      return c.json({ reanudados: [...pendientes, ...nuevos] }, 202);
    }
    return c.json({ reanudados: await reanudarEntidades(p, { todos }) });
  }));

  app.get('/entidades/camino', manejar(async (c, { sql }) => {
    const desde = qTexto(c, 'desde'), hasta = qTexto(c, 'hasta');
    if (!desde || !hasta) throw new ErrorFunciones('peticion_invalida', 'Faltan «desde» y «hasta».');
    const saltos = qNumero(c, 'saltos');
    return c.json(await caminoEntidades(sql, desde, hasta, Math.max(1, Math.min(6, saltos ?? 4))));
  }));

  app.get('/entidades/documentos/:documento', manejar(async (c, { sql }) => {
    const limite = qNumero(c, 'limite');
    return c.json(await entidadesDocumento(sql, c.req.param('documento')!, limite ?? 60));
  }));

  app.get('/entidades/documentos/:documento/lector', manejar(async (c, { sql }) => c.json(await entidadesLector(sql, c.req.param('documento')!))));

  app.post('/entidades/documentos/:documento/extraer', manejar(async (c, p) => {
    const documento = c.req.param('documento')!;
    const b = await cuerpo<{ forzar?: boolean }>(c);
    const [doc] = await p.sql.ejecutar('SELECT id FROM documentos WHERE id = ?', documento);
    if (!doc) throw new ErrorFunciones('no_encontrado', 'No existe ese documento.', 404);
    if (!p.inteligencia?.redactor) throw new ErrorFunciones('no_disponible', 'No hay redactor configurado para reconocer entidades.', 503);
    const forzar = b.forzar === true;
    if (p.enSegundoPlano) {
      await encolarEntidades(p.sql, documento);
      p.enSegundoPlano(extraerEntidadesDocumento(p, documento, { forzar }));
      return c.json(await estadoExtraccion(p.sql, documento), 202);
    }
    return c.json(await extraerEntidadesDocumento(p, documento, { forzar }), 201);
  }));

  app.get('/entidades/:id', manejar(async (c, { sql }) => {
    const porDocumento = qNumero(c, 'porDocumento');
    return c.json(await fichaEntidad(sql, c.req.param('id')!, porDocumento ? { porDocumento } : {}));
  }));

  app.get('/entidades/:id/menciones', manejar(async (c, { sql }) => {
    const documento = qTexto(c, 'documento'), limite = qNumero(c, 'limite'), cursor = qTexto(c, 'cursor');
    return c.json(await mencionesEntidad(sql, c.req.param('id')!, { ...(documento ? { documento } : {}), ...(limite ? { limite } : {}), ...(cursor ? { cursor } : {}) }));
  }));

  app.get('/entidades/:id/vecinos', manejar(async (c, { sql }) => {
    const limite = qNumero(c, 'limite'), saltos = qNumero(c, 'saltos');
    return c.json(await vecindarioEntidad(sql, c.req.param('id')!, { ...(limite ? { limite } : {}), ...(saltos ? { saltos } : {}) }));
  }));

  app.get('/entidades/:id/linea', manejar(async (c, { sql }) => c.json(await lineaTemporalEntidad(sql, c.req.param('id')!))));
}
