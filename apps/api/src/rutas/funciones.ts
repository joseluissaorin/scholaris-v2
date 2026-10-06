/**
 * Monta las rutas de @scholaris/funciones (historial, cuadernos, vigilantes,
 * alertas, conceptos, mapa, grafo, perspectivas, corpus, privacidad) sobre la
 * app de usuario. Leen `c.get('funciones')`.
 */
import type { Hono } from 'hono';
import * as funciones from '@scholaris/funciones';
import type { Entorno } from '../entorno.js';
import { invalidarBuscador, puertosFunciones } from '../compartido/servicios.js';
import { idsIndiceDeDocumento } from '../compartido/estanteria.js';

type Montador = (app: Hono<{ Variables: { funciones: funciones.PuertosFunciones } }>) => void;

const GRUPOS = ['historial', 'cuadernos', 'vigilantes', 'alertas', 'conceptos', 'mapa', 'grafo', 'perspectivas', 'corpus', 'privacidad'];

export function montarFunciones(app: Hono<Entorno>): void {
  // Los puertos de funciones solo se arman para sus rutas (cuestan una inteligencia).
  for (const g of GRUPOS) {
    app.use(`/${g}`, async (c, next) => { c.set('funciones', await puertosFunciones(c.get('puertos'))); await next(); });
    app.use(`/${g}/*`, async (c, next) => { c.set('funciones', await puertosFunciones(c.get('puertos'))); await next(); });
  }
  // La purga de privacidad de funciones borra la estantería; aquí, además, el almacén y el índice.
  app.use('/privacidad/purgar', async (c, next) => {
    const p = c.get('puertos');
    const docs = (await p.sql.ejecutar<{ id: string }>('SELECT id FROM documentos')).map((f) => f.id);
    const ids: string[] = [];
    for (const d of docs) ids.push(...(await idsIndiceDeDocumento(p.sql, d)));
    await next();
    if (c.res.status < 300) {
      p.segundoPlano((async () => {
        if (p.indice) for (let i = 0; i < ids.length; i += 500) await p.indice.borrar(p.config.espacioNombres(p.usuario.id), ids.slice(i, i + 500));
        await p.almacen.borrarPrefijo(`u/${p.usuario.id}/`);
        await p.cuentas.totales(p.usuario.id, 0, 0);
      })().catch((e) => console.error('purga', e)));
      invalidarBuscador(p.sql);
    }
  });
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
