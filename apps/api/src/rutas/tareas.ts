/** Tareas en segundo plano (ver contrato/tiempo-real.ts). */
import type { Hono } from 'hono';
import type { Entorno } from '../entorno.js';
import { fallo, noEncontrado } from '../compartido/errores.js';
import { leerTarea, listarTareas, terminarTarea } from '../compartido/estanteria.js';
import type { ParamsIngesta } from '../puertos.js';
import { lanzarIngesta } from './subidas.js';
import { exigirEscritura, prm, puertos, type Ctx } from './util.js';

export function rutasTareas(app: Hono<Entorno>): void {
  app.get('/tareas', async (c: Ctx) => c.json(await listarTareas(puertos(c).sql, c.req.query('activas') === '1')));

  app.get('/tareas/:id', async (c: Ctx) => {
    const t = await leerTarea(puertos(c).sql, prm(c, 'id'));
    if (!t) noEncontrado('La tarea');
    const { params: _p, ...tarea } = t;
    return c.json(tarea);
  });

  app.post('/tareas/:id/reintentar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const t = await leerTarea(p.sql, prm(c, 'id'));
    if (!t) noEncontrado('La tarea');
    if (t.estado === 'en_cola' || t.estado === 'procesando') fallo('conflicto', 'La tarea sigue en marcha.');
    if (!t.documento || !['ingesta', 'reproceso', 'importacion'].includes(t.tipo)) fallo('peticion_invalida', 'Solo se pueden reintentar las ingestas.');
    const [d] = await p.sql.ejecutar<{ original: string; tipo: string; mime: string; titulo: string | null; metadatos: string }>('SELECT original, tipo, mime, titulo, metadatos FROM documentos WHERE id = ?', t.documento);
    if (!d) noEncontrado('El documento');
    const anterior = (t.params ?? {}) as Partial<ParamsIngesta>;
    const prefijo = `u/${p.usuario.id}/d/${t.documento}/`;
    const r = await lanzarIngesta(p, {
      documento: t.documento, prefijo, original: d.original, paquete: anterior.paquete, url: anterior.url, fases: anterior.fases,
      tipo: d.tipo, mime: d.mime, nombre: d.titulo ?? t.documento,
    }, t.tipo === 'importacion' ? 'importacion' : 'ingesta');
    const { params: _x, ...nueva } = (await leerTarea(p.sql, r.tarea))!;
    return c.json(nueva);
  });

  app.delete('/tareas/:id', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const t = await leerTarea(p.sql, prm(c, 'id'));
    if (!t) noEncontrado('La tarea');
    if (t.estado === 'en_cola' || t.estado === 'procesando') {
      await p.orquestador.cancelar(t.id).catch(() => undefined);
      await terminarTarea(p.sql, t.id, 'cancelada', 'Cancelada por el usuario.');
      await p.emisor.emitir(`usuario:${p.usuario.id}`, { tipo: 'fin', tarea: t.id, documento: t.documento, estado: 'cancelada' });
    }
    return c.json({ ok: true });
  });
}
