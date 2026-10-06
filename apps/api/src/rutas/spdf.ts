/**
 * Exportar e importar .spdf. Lo normal es armarlo en el navegador con el
 * volcado (GET /documentos/:id/volcado); esto es la reserva del servidor y la
 * importación (v3 por el migrador, v4 tal cual).
 */
import type { Hono } from 'hono';
import { nuevoId, type Documento } from '@scholaris/nucleo';
import { abrirSpdf, crearSpdf, leerDocumento } from '@scholaris/spdf';
import type { CompletarPartesImportacion, ImportacionSpdf, ImportarRecursos, Ok, PedirPartesImportacion, RecursosFirmados, UrlsPartes } from '@scholaris/contrato';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { ahora, totalesEstanteria } from '../compartido/estanteria.js';
import { invalidarBuscador } from '../compartido/servicios.js';
import { volcarDocumento } from './documentos.js';
import { lanzarIngesta, prefijoDocumento, rutaSegura } from './subidas.js';
import { claveDe, exigirEscritura, prm, puertos, type Ctx } from './util.js';
import type { PuertosUsuario } from '../puertos.js';

/** Máximo que se incrusta en un .spdf armado en el servidor (memoria del Worker). */
const MAX_INCRUSTADO = 64 * 1024 * 1024;

async function armarSpdf(p: PuertosUsuario, d: Documento, incrustar: boolean): Promise<Uint8Array> {
  const v = await volcarDocumento(p, d);
  const a = await crearSpdf({ generador: `scholaris-nube ${p.config.version}` });
  try {
    let usados = 0;
    const blobs = new Map<string, string>();
    if (incrustar) {
      for (const clave of Object.keys(v.binarios)) {
        const real = claveDe(p.usuario.id, d.id, clave);
        const cab = await p.almacen.cabecera(real);
        if (!cab || usados + cab.bytes > MAX_INCRUSTADO) continue;
        const bytes = await p.almacen.bytes(real);
        if (!bytes) continue;
        // En el fichero las claves son relativas: «original.pdf», «paginas/0001.jpg».
        const rel = !clave.startsWith('u/') ? clave : clave.startsWith(prefijoDocumento(p.usuario.id, d.id)) ? clave.slice(prefijoDocumento(p.usuario.id, d.id).length) : clave.split('/').pop()!;
        await a.ponerBlob(rel, v.binarios[clave]!.mime, bytes);
        blobs.set(clave, rel);
        usados += cab.bytes;
      }
    }
    const rel = (k?: string) => (k ? blobs.get(k) ?? k : undefined);
    await a.escribirDocumento({ ...d, original: rel(d.original) ?? '' , bibliotecas: [] });
    await a.escribirUnidades(v.unidades.map((u) => ({ ...u, documento: d.id, imagen: rel(u.imagen), miniatura: rel(u.miniatura) })));
    await a.escribirSecciones(v.secciones.map((s) => ({ ...s, documento: d.id })));
    await a.escribirFragmentos(v.fragmentos.map((f) => ({ ...f, documento: d.id })));
    await a.escribirFiguras(v.figuras.map((g) => ({ ...g, documento: d.id, imagen: rel(g.imagen) ?? g.imagen ?? "" })));
    for (const e of v.espacios) await a.escribirEspacio(e);
    const { leerVectores } = await import('@scholaris/spdf');
    for (const e of v.espacios) await a.escribirVectores((await leerVectores(p.sql, { espacio: e.id, documento: d.id })).map((x) => ({ ...x, documento: d.id })));
    for (const e of v.procedencia) await a.registrarProcedencia({ documento: d.id, fase: e.fase, proveedor: e.proveedor ?? null, detalle: e.detalle, ms: e.ms ?? null, cuando: e.cuando });
    await a.optimizarIndice();
    return a.exportar();
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
    const bytes = await armarSpdf(p, d, c.req.query('incrustar') !== '0');
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
    const avisos: string[] = [];
    let a;
    try {
      a = await abrirSpdf(bytes, { migrar: true });
    } catch (e) {
      return fallo('peticion_invalida', `No es un .spdf válido: ${(e as Error).message}`);
    }
    try {
      const versionOrigen = Number.parseFloat(await a.version()) >= 4 ? 400 : 300;
      const docs = await a.documentos();
      exigir(docs.length >= 1, 'El .spdf no contiene ningún documento.');
      const ia = await p.inteligencia();
      let documento = '';
      let tarea: string | undefined;
      for (const d0 of docs) {
        // Si el id ya existe en la estantería (otra copia), se importa con id nuevo.
        const existe = await leerDocumento(p.sql, d0.id);
        const id = existe ? nuevoId('d') : d0.id;
        if (existe) avisos.push(`El documento ya estaba en tu estantería: se ha importado como copia (${id}).`);
        const prefijo = prefijoDocumento(p.usuario.id, id);
        // Binarios incrustados → almacén.
        const claves = new Map<string, string>();
        for (const b of await a.blobs()) {
          const blob = await a.leerBlob(b.clave);
          if (!blob) continue;
          const destino = `${prefijo}${b.clave.replace(/^\/+/, '').replace(/\.\.+/g, '.')}`;
          await p.almacen.poner(destino, blob.datos, blob.mime);
          claves.set(b.clave, destino);
        }
        const k = (x?: string | null) => (x ? claves.get(x) ?? (x.startsWith(prefijo) ? x : undefined) : undefined);
        const unidades = await a.leerUnidades(d0.id);
        const fragmentos = await a.leerFragmentos(d0.id);
        const secciones = await a.leerSecciones(d0.id);
        const figuras = await a.leerFiguras(d0.id);
        const espacios = await a.espacios();
        const { escribirDocumento, escribirUnidades, escribirFragmentos, escribirSecciones, escribirFiguras, escribirEspacio, escribirVectores, leerVectores, registrarProcedencia } = await import('@scholaris/spdf');
        const remap = <T extends { id: string }>(x: T) => (existe ? { ...x, id: `${x.id}_${id.slice(-6)}` } : x);
        const mapaUnidad = new Map(unidades.map((u) => [u.id, remap(u).id]));
        const mapaFrag = new Map(fragmentos.map((f) => [f.id, remap(f).id]));
        await p.sql.transaccion(async (tx) => {
          await escribirDocumento(tx, { ...d0, id, original: k(d0.original) ?? claves.get('original') ?? '', estado: 'listo', bibliotecas: [], actualizado: ahora() });
          await escribirUnidades(tx, unidades.map((u) => ({ ...remap(u), documento: id, imagen: k(u.imagen), miniatura: k(u.miniatura) })));
          await escribirSecciones(tx, secciones.map((s) => ({ ...remap(s), documento: id, unidadDesde: mapaUnidad.get(s.unidadDesde) ?? s.unidadDesde, unidadHasta: s.unidadHasta ? mapaUnidad.get(s.unidadHasta) ?? s.unidadHasta : s.unidadHasta })));
          await escribirFragmentos(tx, fragmentos.map((f) => ({ ...remap(f), documento: id, unidad: mapaUnidad.get(f.unidad) ?? f.unidad })));
          await escribirFiguras(tx, figuras.map((g) => ({ ...remap(g), documento: id, unidad: mapaUnidad.get(g.unidad) ?? g.unidad, imagen: k(g.imagen) ?? g.imagen })));
          for (const e of espacios) await escribirEspacio(tx, e);
        });
        // Vectores: se guardan los de todos los espacios; al índice va solo el base.
        let tieneBase = false;
        for (const e of espacios) {
          const vs = (await leerVectores(a.sql, { espacio: e.id, documento: d0.id })).map((v) => ({ ...v, documento: id, id: v.objetivo === 'fragmento' ? mapaFrag.get(v.id) ?? v.id : v.objetivo === 'unidad' ? mapaUnidad.get(v.id) ?? v.id : v.id }));
          for (let i = 0; i < vs.length; i += 500) await escribirVectores(p.sql, vs.slice(i, i + 500));
          if (e.id === ia.embebedor.espacio.id && vs.length) {
            tieneBase = true;
            if (p.indice) {
              const meta = (obj: string) => ({ objetivo: obj, documento: id, tipo: d0.tipo, ...(d0.metadatos.anio ? { anio: d0.metadatos.anio } : {}), ...(d0.metadatos.idioma ? { idioma: d0.metadatos.idioma } : {}) });
              for (let i = 0; i < vs.length; i += 500) {
                await p.indice.insertar(p.config.espacioNombres(p.usuario.id), vs.slice(i, i + 500).map((v) => ({ id: v.id, valores: v.valores, metadatos: meta(v.objetivo) })));
              }
            }
          }
        }
        for (const e of await a.leerProcedencia(d0.id)) await registrarProcedencia(p.sql, { ...e, documento: id });
        if (!tieneBase) {
          avisos.push(`Faltan los vectores de ${ia.embebedor.espacio.id}: se calculan ahora a partir del texto ya leído.`);
          const r = await lanzarIngesta(p, { documento: id, prefijo, original: k(d0.original) ?? '', tipo: d0.tipo, mime: d0.mime, nombre: d0.metadatos.titulo, fases: ['contexto', 'vectores'] }, 'importacion');
          tarea = r.tarea;
        }
        documento ||= id;
      }
      invalidarBuscador(p.sql);
      const t = await totalesEstanteria(p.sql);
      await p.cuentas.totales(p.usuario.id, t.documentos, t.bytes);
      const salida: ImportacionSpdf = { documento, versionOrigen, avisos };
      if (tarea) salida.tarea = tarea;
      return c.json(salida, 201);
    } finally {
      a.cerrar();
    }
  });
}
