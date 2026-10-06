/** Rutas del corpus (contrato: funciones.ts, «Perspectivas y corpus»). */

import type { EntornoFunciones } from '../puertos.js';
import { construirInstantanea, kpisCorpus, obtenerInstantanea } from '../corpus.js';
import { manejar, type AppFunciones } from './comun.js';

export function rutasCorpus<E extends EntornoFunciones>(app: AppFunciones<E>): void {
  app.get('/corpus/kpis', manejar(async (c, { sql }) => c.json(await kpisCorpus(sql))));
  app.get('/corpus/instantanea', manejar(async (c, { sql }) => c.json(await obtenerInstantanea(sql))));
  app.post('/corpus/instantanea/refrescar', manejar(async (c, { sql }) => c.json(await construirInstantanea(sql))));
}
