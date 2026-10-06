/** Rutas del grafo de citas (contrato: funciones.ts, «Grafo de citas»). */

import type { EntornoFunciones } from '../puertos.js';
import { detalleNodo, obtenerGrafo, reconstruirGrafo, referenciasHuerfanas } from '../grafo/grafo.js';
import { manejar, qBool, qNumero, qTexto, type AppFunciones } from './comun.js';

export function rutasGrafo<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/grafo', manejar(async (c, { sql }) => {
    const biblioteca = qTexto(c, 'biblioteca'), confianzaMinima = qNumero(c, 'confianzaMinima'), todos = qBool(c, 'todos');
    return c.json(await obtenerGrafo(sql, { ...(biblioteca ? { biblioteca } : {}), ...(confianzaMinima !== undefined ? { confianzaMinima } : {}), ...(todos ? { todos } : {}) }));
  }));
  app.get('/grafo/nodos/:documento', manejar(async (c, { sql }) => c.json(await detalleNodo(sql, c.req.param('documento')!))));
  app.get('/grafo/huerfanas', manejar(async (c, { sql }) => {
    const minimo = qNumero(c, 'minimo'), limite = qNumero(c, 'limite');
    return c.json(await referenciasHuerfanas(sql, { ...(minimo ? { minimo } : {}), ...(limite ? { limite } : {}) }));
  }));
  app.post('/grafo/reconstruir', manejar(async (c, { sql }) => c.json(await reconstruirGrafo(sql))));
}
