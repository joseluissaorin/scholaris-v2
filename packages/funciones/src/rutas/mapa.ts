/** Rutas del mapa de conceptos (contrato: funciones.ts, «Mapa de conceptos»). */

import type { EventoConstruccionMapa } from '@scholaris/contrato';
import type { EntornoFunciones } from '../puertos.js';
import { construirMapa, metaMapa, miembrosGrupo, obtenerMapa, type OpcionesMapa } from '../mapa/construir.js';
import { ErrorFunciones } from '../util.js';
import { cuerpo, manejar, qNumero, qTexto, sse, type AppFunciones } from './comun.js';

export function rutasMapa<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/mapa/meta', manejar(async (c, { sql }) => {
    const { ejecucion: _e, espacio: _s, reduccion: _r, ...meta } = await metaMapa(sql);
    return c.json(meta);
  }));
  app.get('/mapa', manejar(async (c, { sql }) => {
    const biblioteca = qTexto(c, 'biblioteca'), maxPuntos = qNumero(c, 'maxPuntos');
    return c.json(await obtenerMapa(sql, { ...(biblioteca ? { biblioteca } : {}), ...(maxPuntos ? { maxPuntos } : {}) }));
  }));
  app.get('/mapa/grupos/:indice', manejar(async (c, { sql }) => {
    const indice = Number(c.req.param('indice'));
    if (!Number.isInteger(indice) || indice < 0) throw new ErrorFunciones('peticion_invalida', 'El índice del grupo debe ser un número entero.');
    return c.json(await miembrosGrupo(sql, indice, qNumero(c, 'limite') ?? 100));
  }));
  /** SSE de EventoConstruccionMapa: { fase, avance, mensaje } y al final { fin: MetaMapa } (o { error }). */
  app.post('/mapa/construir', manejar(async (c, p) => {
    const o = await cuerpo<OpcionesMapa>(c);
    return sse(async (enviar) => {
      try {
        const r = await construirMapa(p, o, (e) => enviar('progreso', { fase: e.fase, avance: e.avance, mensaje: e.mensaje } satisfies EventoConstruccionMapa));
        await enviar('fin', { fin: { construido: r.construido, grupos: r.grupos, puntos: r.puntos, muestreados: r.muestreados, ms: r.ms } } satisfies EventoConstruccionMapa);
      } catch (e) {
        const mensaje = e instanceof ErrorFunciones ? e.message : 'No se ha podido construir el mapa.';
        await enviar('error', { error: mensaje } satisfies EventoConstruccionMapa);
      }
    });
  }));
}
