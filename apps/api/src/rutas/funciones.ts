/**
 * Monta las rutas de @scholaris/funciones (historial, cuadernos, vigilantes,
 * alertas, conceptos, mapa, grafo, perspectivas, corpus, privacidad) sobre la
 * app de usuario. Leen `c.get('funciones')`.
 */
import type { Hono } from 'hono';
import * as funciones from '@scholaris/funciones';
import type { Entorno } from '../entorno.js';
import { puertosFunciones } from '../compartido/servicios.js';

type Montador = (app: Hono<{ Variables: { funciones: funciones.PuertosFunciones } }>) => void;

const GRUPOS = ['historial', 'cuadernos', 'vigilantes', 'alertas', 'conceptos', 'mapa', 'grafo', 'perspectivas', 'corpus', 'privacidad'];

export function montarFunciones(app: Hono<Entorno>): void {
  // Los puertos de funciones solo se arman para sus rutas (cuestan una inteligencia).
  for (const g of GRUPOS) {
    app.use(`/${g}`, async (c, next) => { c.set('funciones', await puertosFunciones(c.get('puertos'))); await next(); });
    app.use(`/${g}/*`, async (c, next) => { c.set('funciones', await puertosFunciones(c.get('puertos'))); await next(); });
  }
  const modulo = funciones as unknown as Record<string, unknown>;
  // Cada grupo exporta `rutas<Grupo>(app)`; también se admite un `rutasFunciones(app)` que lo monte todo.
  if (typeof modulo.rutasFunciones === 'function') {
    (modulo.rutasFunciones as Montador)(app as never);
    return;
  }
  for (const [nombre, f] of Object.entries(modulo)) {
    if (/^rutas[A-Z]/.test(nombre) && typeof f === 'function') (f as Montador)(app as never);
  }
}
