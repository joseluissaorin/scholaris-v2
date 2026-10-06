/**
 * Exportar e importar .spdf. Lo normal es armarlo en el navegador con el
 * volcado (GET /documentos/:id/volcado); esto es la reserva del servidor y la
 * importación (v3 por el migrador, v4 tal cual).
 */
import type { Hono } from 'hono';
import type { Documento } from '@scholaris/nucleo';
import { crearSpdf, leerDocumento } from '@scholaris/spdf';
import type { CompletarPartesImportacion, ImportacionSpdf, ImportarRecursos, Ok, PedirPartesImportacion, RecursosFirmados, UrlsPartes } from '@scholaris/contrato';
import { leerBiblioteca } from '../compartido/estanteria.js';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { importarSpdf } from '../compartido/importar-spdf.js';
import { volcarDocumento } from './documentos.js';
import { prefijoDocumento, rutaSegura } from './subidas.js';
import { claveDe, exigirEscritura, prm, puertos, type Ctx } from './util.js';
import type { PuertosUsuario } from '../puertos.js';

/** Máximo que se incrusta en un .spdf armado en el servidor (memoria del Worker). */
export const MAX_INCRUSTADO = 64 * 1024 * 1024;

export interface OpcionesArmar {
  /** Incrustar los binarios (páginas, figuras y, si `originales`, el original). */
  incrustar: boolean;
  /** Con `incrustar`, también el original (por defecto sí). */
  originales?: boolean;
  /** Los vectores (por defecto sí). */
  vectores?: boolean;
  /** Lo no incrustado se nombra con su clave completa del almacén (copias sin duplicar bytes). */
  referencias?: boolean;
}

export async function armarSpdf(p: PuertosUsuario, d: Documento, o: OpcionesArmar): Promise<{ bytes: Uint8Array; sinOriginal: boolean }> {
  const v = await volcarDocumento(p, d);
  const a = await crearSpdf({ generador: `scholaris-nube ${p.config.version}` });
  let sinOriginal = !!d.original;
  try {
    let usados = 0;
    const blobs = new Map<string, string>();
    if (o.incrustar) {
      // El original primero; el resto se lee de 16 en 16 con un solo viaje por fichero (antes, cabecera
      // y bytes en serie: un libro de 1000 páginas pasaba de cinco minutos). Tope: MAX_INCRUSTADO.
      const prefijo = prefijoDocumento(p.usuario.id, d.id);
      const claves = Object.keys(v.binarios)
        .filter((clave) => !(clave === d.original && o.originales === false))
        .sort((x, y) => Number(y === d.original) - Number(x === d.original));
      let lleno = false;
      for (let i = 0; i < claves.length && !lleno; i += 16) {
        const leidos = await Promise.all(claves.slice(i, i + 16).map(async (clave) => ({ clave, bytes: await p.almacen.bytes(claveDe(p.usuario.id, d.id, clave)).catch(() => null) })));
        for (const { clave, bytes } of leidos) {
          if (!bytes) continue;
          if (usados + bytes.byteLength > MAX_INCRUSTADO) { lleno = true; continue; }
          // En el fichero las claves son relativas: «original.pdf», «paginas/0001.jpg».
          const rel = !clave.startsWith('u/') ? clave : clave.startsWith(prefijo) ? clave.slice(prefijo.length) : clave.split('/').pop()!;
          await a.ponerBlob(rel, v.binarios[clave]!.mime, bytes);
          blobs.set(clave, rel);
          usados += bytes.byteLength;
          if (clave === d.original) sinOriginal = false;
        }
      }
    }
    const rel = (k?: string) => (k ? blobs.get(k) ?? (o.referencias ? claveDe(p.usuario.id, d.id, k) : k) : undefined);
    await a.escribirDocumento({ ...d, original: rel(d.original) ?? '' , bibliotecas: [] });
    await a.escribirUnidades(v.unidades.map((u) => ({ ...u, documento: d.id, imagen: rel(u.imagen), miniatura: rel(u.miniatura) })));
    await a.escribirSecciones(v.secciones.map((s) => ({ ...s, documento: d.id })));
    await a.escribirFragmentos(v.fragmentos.map((f) => ({ ...f, documento: d.id })));
    await a.escribirFiguras(v.figuras.map((g) => ({ ...g, documento: d.id, imagen: rel(g.imagen) ?? g.imagen ?? "" })));
    if (o.vectores !== false) {
      for (const e of v.espacios) await a.escribirEspacio(e);
      const { leerVectores } = await import('@scholaris/spdf');
      for (const e of v.espacios) await a.escribirVectores((await leerVectores(p.sql, { espacio: e.id, documento: d.id })).map((x) => ({ ...x, documento: d.id })));
    }
    for (const e of v.procedencia) await a.registrarProcedencia({ documento: d.id, fase: e.fase, proveedor: e.proveedor ?? null, detalle: e.detalle, ms: e.ms ?? null, cuando: e.cuando });
    await a.optimizarIndice();
    return { bytes: a.exportar(), sinOriginal };
  } finally {
    a.cerrar();
  }
}

export function rutasSpdf(app: Hono<Entorno>): void {
  app.get('/documentos/:id/spdf', async (c: Ctx) => {
    const p = puertos(c);
    const d = await leerDocumento(p.sql, prm(c, 'id'));
    if (!d) noEncontrado('El documento');
    if (d.estado !== 'listo') fallo('conflicto', 'El documento todavía no está listo para exportar.');
    const q = c.req.query();
    const { bytes } = await armarSpdf(p, d, { incrustar: q.incrustar !== '0', originales: q.originales !== '0', vectores: q.vectores !== '0', referencias: q.referencias === '1' });
    const nombre = `${(d.metadatos.titulo || d.id).replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 80)}.spdf`;
    return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/x-spdf', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}` } });
  });

  // Importación por el almacén: los binarios de un .spdf grande se suben directos
  // (por partes si pasan de 64 MB) y luego se importa el .spdf ligero que los nombra.
  const clavePropia = (c: Ctx, clave: string) => {
    const p = puertos(c);
    exigir(typeof clave === 'string' && clave.startsWith(`u/${p.usuario.id}/d/`) && !clave.includes('..'), 'Clave fuera de tu estantería.');
    return p;
  };

  app.post('/documentos/importar/recursos', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<ImportarRecursos>(c);
    exigir(typeof b.documento === 'string' && /^[\w-]{3,80}$/.test(b.documento), 'Id de documento no válido.');
    if (await leerDocumento(p.sql, b.documento)) fallo('conflicto', 'Ese documento ya está en tu estantería.');
    exigir(Array.isArray(b.recursos) && b.recursos.length > 0 && b.recursos.length <= 2000, 'Pide entre 1 y 2000 recursos a la vez.');
    const prefijo = prefijoDocumento(p.usuario.id, b.documento);
    const recursos = await Promise.all(b.recursos.map(async (r) => {
      const ruta = rutaSegura(r.ruta);
      const clave = `${prefijo}${ruta}`;
      return { ruta, clave, subida: await p.almacen.subidaDirecta(clave, { tipo: r.mime, bytes: r.bytes, partes: (r.bytes ?? 0) > 64 * 1024 * 1024 }) };
    }));
    return c.json<RecursosFirmados>({ recursos });
  });

  app.post('/documentos/importar/partes', async (c: Ctx) => {
    exigirEscritura(c);
    const b = await cuerpoJson<PedirPartesImportacion>(c);
    const p = clavePropia(c, b.clave);
    exigir(typeof b.idSubida === 'string' && b.idSubida.length > 0, 'Falta idSubida.');
    exigir(Array.isArray(b.numeros) && b.numeros.length > 0 && b.numeros.length <= 100, 'Pide entre 1 y 100 partes a la vez.');
    const partes = await Promise.all(b.numeros.map(async (numero) => {
      exigir(Number.isInteger(numero) && numero >= 1 && numero <= 10000, `Número de parte no válido: ${numero}.`);
      return { numero, ...(await p.almacen.urlParte(b.clave, b.idSubida, numero)) };
    }));
    return c.json<UrlsPartes>({ partes });
  });

  app.post('/documentos/importar/completar', async (c: Ctx) => {
    exigirEscritura(c);
    const b = await cuerpoJson<CompletarPartesImportacion>(c);
    const p = clavePropia(c, b.clave);
    exigir(Array.isArray(b.partes) && b.partes.length > 0, 'Faltan las partes.');
    await p.almacen.completarPartes(b.clave, b.idSubida, b.partes);
    return c.json<Ok>({ ok: true });
  });

  app.post('/documentos/importar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    exigir(bytes.length > 100, 'Manda el fichero .spdf en el cuerpo de la petición.');
    exigir(bytes.length <= Math.min(p.config.bytesMaximos, 512 * 1024 * 1024), 'El .spdf es demasiado grande para importarlo por aquí.');
    const amb = c.get('usuario').ambito;
    const biblioteca = amb ? amb.biblioteca : c.req.query('biblioteca');
    if (biblioteca && !amb && !(await leerBiblioteca(p.sql, biblioteca, p.usuario.id))) noEncontrado('La biblioteca');
    // Solo la puerta pone `importarDe` (copias de bibliotecas ajenas, sin duplicar binarios).
    const ajeno = c.get('usuario').importarDe;
    const r = await importarSpdf(p, bytes, {
      ...(biblioteca ? { bibliotecas: [biblioteca] } : {}),
      deduplicar: c.req.query('deduplicar') === '1' || !!ajeno,
      ...(ajeno ? { ajeno } : {}),
    });
    const primero = r.documentos[0]!;
    const salida: ImportacionSpdf = { documento: primero.documento, versionOrigen: r.versionOrigen, avisos: r.avisos };
    const tarea = r.documentos.find((d) => d.tarea)?.tarea;
    if (tarea) salida.tarea = tarea;
    if (r.documentos.every((d) => d.repetido)) salida.repetido = true;
    return c.json(salida, 201);
  });
}
