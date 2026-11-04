/**
 * Relaciones entre obras y alineaciones (contrato/transmedia.ts y
 * docs/COMPRENSION.md): leerlas, crearlas, confirmarlas, rechazarlas y pedir que
 * se detecten y se alineen para un documento o para toda la biblioteca. Crear,
 * confirmar, rechazar y lanzar el trabajo es de quien es dueño de la estantería.
 */
import type { Hono } from 'hono';
import type { Alineacion, TipoCorrespondencia, TipoRelacion } from '@scholaris/nucleo';
import type { Pagina, PedirAlineacion, PedirRelacion, PedirTransmediaBiblioteca, RelacionVista, TransmediaLanzada } from '@scholaris/contrato';
import { leerAlineaciones, leerDocumento, leerRelaciones } from '@scholaris/spdf';
import { confirmarRelacion, crearRelacionUsuario, ErrorRelacion, leerRelacion, rechazarRelacion, TIPOS_CORRESPONDENCIA, TIPOS_RELACION } from '@scholaris/ingesta';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { lanzarTransmedia, relacionVista } from '../compartido/transmedia.js';
import { entero, exigirEscritura, prm, puertos, type Ctx } from './util.js';

const ahora = () => new Date().toISOString();

/** Los errores de las operaciones del usuario, con su código de la API. */
async function conErrores<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ErrorRelacion) return e.codigo === 'no_existe' ? noEncontrado(/documento/.test(e.message) ? 'El documento' : 'La relación') : fallo('peticion_invalida', e.message);
    throw e;
  }
}

export function rutasTransmedia(app: Hono<Entorno>): void {
  app.get('/documentos/:id/relaciones', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerDocumento(p.sql, id))) noEncontrado('El documento');
    const vistas: RelacionVista[] = [];
    for (const r of (await leerRelaciones(p.sql, id)).sort((x, y) => y.confianza - x.confianza)) vistas.push(await relacionVista(p, r, id));
    return c.json(vistas);
  });

  app.post('/documentos/:id/alinear', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const id = prm(c, 'id');
    const d = await leerDocumento(p.sql, id);
    if (!d) noEncontrado('El documento');
    exigir(d.estado === 'listo', 'El documento todavía no está listo.');
    const b = await cuerpoJson<PedirAlineacion>(c);
    if (b.relacion !== undefined) {
      const r = await leerRelacion(p.sql, String(b.relacion));
      exigir(r && (r.origen === id || r.destino === id), 'Esa relación no es de este documento.');
    }
    const instancia = await lanzarTransmedia(p, { documento: id, ...(b.relacion ? { relacion: String(b.relacion) } : {}), ...(b.forzar ? { forzar: true } : {}) });
    const salida: TransmediaLanzada = { instancia, relaciones: (await leerRelaciones(p.sql, id)).length };
    return c.json(salida, 202);
  });

  app.post('/transmedia/biblioteca', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<PedirTransmediaBiblioteca>(c);
    if (b.documentos !== undefined) exigir(Array.isArray(b.documentos) && b.documentos.every((x) => typeof x === 'string'), '«documentos» es una lista de ids.');
    const instancia = await lanzarTransmedia(p, {
      ...(b.documentos?.length ? { documentos: b.documentos } : {}), ...(b.forzar ? { forzar: true } : {}), ...(b.alinear === false ? { alinear: false } : {}),
    });
    const [n] = await p.sql.ejecutar<{ n: number }>('SELECT COUNT(*) AS n FROM relaciones');
    const salida: TransmediaLanzada = { instancia, relaciones: Number(n?.n ?? 0) };
    return c.json(salida, 202);
  });

  app.get('/relaciones/:id', async (c: Ctx) => {
    const p = puertos(c);
    const r = await leerRelacion(p.sql, prm(c, 'id'));
    if (!r) noEncontrado('La relación');
    return c.json(await relacionVista(p, r));
  });

  app.get('/relaciones/:id/alineaciones', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    if (!(await leerRelacion(p.sql, id))) noEncontrado('La relación');
    const tipo = c.req.query('tipo');
    if (tipo) exigir((TIPOS_CORRESPONDENCIA as readonly string[]).includes(tipo), `«${tipo}» no es un tipo de correspondencia. Admitidos: ${TIPOS_CORRESPONDENCIA.join(', ')}.`);
    const desde = entero(c.req.query('desde'), 0, 0), limite = entero(c.req.query('limite'), 500, 1, 2000);
    const todas: Alineacion[] = (await leerAlineaciones(p.sql, { relacion: id })).filter((x) => !tipo || x.tipo === (tipo as TipoCorrespondencia));
    const pagina: Pagina<Alineacion> = { elementos: todas.slice(desde, desde + limite), total: todas.length, ...(desde + limite < todas.length ? { siguiente: String(desde + limite) } : {}) };
    return c.json(pagina);
  });

  app.post('/relaciones', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<PedirRelacion>(c);
    exigir(typeof b.origen === 'string' && typeof b.destino === 'string', '«origen» y «destino» son ids de documento.');
    exigir((TIPOS_RELACION as readonly string[]).includes(String(b.tipo)), `«tipo» admite: ${TIPOS_RELACION.join(', ')}.`);
    if (b.nota !== undefined) exigir(typeof b.nota === 'string' && b.nota.length <= 2000, '«nota» es un texto de hasta 2000 caracteres.');
    const r = await conErrores(() => crearRelacionUsuario(p.sql, { origen: b.origen, destino: b.destino, tipo: b.tipo as TipoRelacion, ...(b.nota ? { nota: b.nota } : {}) }, ahora()));
    return c.json(await relacionVista(p, r), 201);
  });

  app.post('/relaciones/:id/confirmar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const r = await conErrores(() => confirmarRelacion(p.sql, prm(c, 'id')));
    return c.json(await relacionVista(p, r));
  });

  app.delete('/relaciones/:id', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    await conErrores(() => rechazarRelacion(p.sql, prm(c, 'id'), ahora()));
    return c.json({ borrada: true });
  });
}
