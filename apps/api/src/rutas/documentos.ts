/** Documentos de la estantería (ver contrato/documentos.ts). */
import type { Hono } from 'hono';
import type { Ancla, Documento, MetadatosDocumento, ValorSQL } from '@scholaris/nucleo';
import { vectorABytes } from '@scholaris/nucleo';
import type {
  DetalleDocumento, FiguraVista, FragmentoVista, MapaFolios, Pagina, ParcheMetadatos, Reprocesar, ResumenDocumento, SeccionVista,
  UnidadVista, VolcadoDocumento,
} from '@scholaris/contrato';
import {
  autoresPlanos, escribirDocumento, leerDocumento, leerEspacios, leerFiguras, leerProcedencia, leerSecciones, leerUnidades,
  leerVectores, filaAFragmento, borrarDocumento,
} from '@scholaris/spdf';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { clavesDeDocumento, idsIndiceDeDocumento, tareaDeDocumento, totalesEstanteria, ultimoError, ahora } from '../compartido/estanteria.js';
import { aBase64Url } from '../compartido/firmas.js';
import { invalidarBuscador, puertosFunciones } from '../compartido/servicios.js';
import { alBorrarDocumento } from '@scholaris/funciones';
import type { PuertosUsuario } from '../puertos.js';
import { lanzarIngesta, prefijoDocumento } from './subidas.js';
import { claveDe, cursorADesplazamiento, desplazamientoACursor, entero, etiquetaAncla, exigirEscritura, json, prm, puertos, type Ctx } from './util.js';

type Fila = Record<string, ValorSQL>;

const ORDENES: Record<string, string> = {
  creado: 'creado', actualizado: 'actualizado', titulo: 'titulo COLLATE NOCASE', anio: 'anio', autor: 'autores COLLATE NOCASE',
};

async function documentoOError(p: PuertosUsuario, id: string): Promise<Documento> {
  return (await leerDocumento(p.sql, id)) ?? noEncontrado('El documento');
}

async function urlOpcional(p: PuertosUsuario, documento: string, clave: string | null | undefined): Promise<string | undefined> {
  return clave ? p.almacen.urlLectura(claveDe(p.usuario.id, documento, clave)) : undefined;
}

/** Miniatura de la primera unidad, como portada. */
async function portada(p: PuertosUsuario, documento: string): Promise<string | undefined> {
  const [f] = await p.sql.ejecutar<{ m: string | null; i: string | null }>('SELECT miniatura AS m, imagen AS i FROM unidades WHERE documento = ? ORDER BY orden LIMIT 1', documento);
  return urlOpcional(p, documento, f?.m ?? f?.i);
}

export async function borrarDocumentoCompleto(p: PuertosUsuario, id: string): Promise<void> {
  const claves = await clavesDeDocumento(p.sql, id);
  const ids = await idsIndiceDeDocumento(p.sql, id);
  const tarea = await tareaDeDocumento(p.sql, id);
  if (tarea) await p.orquestador.cancelar(tarea).catch(() => undefined);
  await borrarDocumento(p.sql, id);
  await p.sql.ejecutar('DELETE FROM pl_subidas WHERE documento = ?', id);
  invalidarBuscador(p.sql);
  p.segundoPlano((async () => {
    await alBorrarDocumento(await puertosFunciones(p), id).catch((e: unknown) => console.error('alBorrarDocumento', e));
    if (p.indice && ids.length) for (let i = 0; i < ids.length; i += 500) await p.indice.borrar(p.config.espacioNombres(p.usuario.id), ids.slice(i, i + 500));
    await p.almacen.borrarPrefijo(prefijoDocumento(p.usuario.id, id));
    for (const k of claves) if (!k.startsWith(prefijoDocumento(p.usuario.id, id))) await p.almacen.borrar(k).catch(() => undefined);
    const t = await totalesEstanteria(p.sql);
    await p.cuentas.totales(p.usuario.id, t.documentos, t.bytes);
  })().catch((e) => console.error('borrado en segundo plano', e)));
}

function unidadAVista(f: Fila, urls: { imagen?: string; miniatura?: string }): UnidadVista {
  const ancla = json<Ancla>(f.ancla, { tipo: 'pagina', fisica: Number(f.orden), impresa: null, romana: false, origen: 'ninguno', confianza: 0 });
  const v: UnidadVista = {
    id: String(f.id), orden: Number(f.orden), ancla, etiqueta: etiquetaAncla(ancla), texto: String(f.texto ?? ''),
    lector: String(f.lector ?? ''), confianza: Number(f.confianza ?? 1),
  };
  const notas = json<string[] | null>(f.notas, null);
  if (notas?.length) v.notas = notas;
  if (urls.imagen) v.imagenUrl = urls.imagen;
  if (urls.miniatura) v.miniaturaUrl = urls.miniatura;
  return v;
}

export function rutasDocumentos(app: Hono<Entorno>): void {
  app.get('/documentos', async (c: Ctx) => {
    const p = puertos(c);
    const q = c.req.query();
    const donde: string[] = [];
    const params: ValorSQL[] = [];
    if (q.q) { donde.push('(titulo LIKE ? OR autores LIKE ?)'); params.push(`%${q.q}%`, `%${q.q}%`); }
    const amb = c.get('usuario').ambito;
    if (amb) q.biblioteca = amb.biblioteca;
    if (q.biblioteca) { donde.push('EXISTS (SELECT 1 FROM json_each(documentos.bibliotecas) je WHERE je.value = ?)'); params.push(q.biblioteca); }
    const tipos = c.req.queries('tipo') ?? [];
    if (tipos.length) { donde.push(`tipo IN (${tipos.map(() => '?').join(',')})`); params.push(...tipos); }
    if (q.estado) { donde.push('estado = ?'); params.push(q.estado); }
    if (q.autor) { donde.push('autores LIKE ?'); params.push(`%${q.autor}%`); }
    if (q.anioDesde) { donde.push('anio >= ?'); params.push(entero(q.anioDesde, 0)); }
    if (q.anioHasta) { donde.push('anio <= ?'); params.push(entero(q.anioHasta, 9999)); }
    if (q.idioma) { donde.push('idioma = ?'); params.push(q.idioma); }
    const orden = ORDENES[q.orden ?? 'creado'] ?? 'creado';
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const limite = entero(q.limite, 50, 1, 200);
    const desde = cursorADesplazamiento(q.cursor);
    const w = donde.length ? `WHERE ${donde.join(' AND ')}` : '';
    const filas = await p.sql.ejecutar<Fila>(
      `SELECT id, tipo, estado, titulo, autores, anio, idioma, unidades, duracion, bytes, creado, actualizado, bibliotecas,
         (SELECT COALESCE(u.miniatura, u.imagen) FROM unidades u WHERE u.documento = documentos.id ORDER BY u.orden LIMIT 1) AS portada,
         (SELECT t.id FROM pl_tareas t WHERE t.documento = documentos.id AND t.estado IN ('en_cola','procesando') ORDER BY t.creada DESC LIMIT 1) AS tarea
       FROM documentos ${w} ORDER BY ${orden} ${dir} NULLS LAST, id LIMIT ? OFFSET ?`, ...params, limite + 1, desde);
    const [{ total } = { total: 0 }] = await p.sql.ejecutar<{ total: number }>(`SELECT COUNT(*) AS total FROM documentos ${w}`, ...params);
    const elementos = await Promise.all(filas.slice(0, limite).map(async (f): Promise<ResumenDocumento> => {
      const r: ResumenDocumento = {
        id: String(f.id), tipo: f.tipo as ResumenDocumento['tipo'], estado: f.estado as ResumenDocumento['estado'],
        titulo: String(f.titulo ?? ''), autores: String(f.autores ?? ''), unidades: Number(f.unidades ?? 0), bytes: Number(f.bytes ?? 0),
        creado: String(f.creado), actualizado: String(f.actualizado), bibliotecas: json<string[]>(f.bibliotecas, []),
      };
      if (f.anio != null) r.anio = Number(f.anio);
      if (f.idioma) r.idioma = String(f.idioma);
      if (f.duracion != null) r.duracion = Number(f.duracion);
      if (f.portada) r.portadaUrl = await p.almacen.urlLectura(claveDe(p.usuario.id, String(f.id), String(f.portada)));
      if (f.tarea) r.tarea = String(f.tarea);
      return r;
    }));
    const salida: Pagina<ResumenDocumento> = { elementos, total };
    if (filas.length > limite) salida.siguiente = desplazamientoACursor(desde + limite);
    return c.json(salida);
  });

  app.get('/documentos/:id', async (c: Ctx) => {
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    const [cuentas] = await p.sql.ejecutar<{ f: number; s: number; g: number }>(
      'SELECT (SELECT COUNT(*) FROM fragmentos WHERE documento = ?) AS f, (SELECT COUNT(*) FROM secciones WHERE documento = ?) AS s, (SELECT COUNT(*) FROM figuras WHERE documento = ?) AS g', d.id, d.id, d.id);
    const espaciosIds = new Set((await p.sql.ejecutar<{ espacio: string }>('SELECT DISTINCT espacio FROM vectores WHERE documento = ?', d.id)).map((f) => f.espacio));
    const detalle: DetalleDocumento = {
      ...d,
      espacios: (await leerEspacios(p.sql)).filter((e) => espaciosIds.has(e.id)),
      cuentas: { fragmentos: cuentas?.f ?? 0, secciones: cuentas?.s ?? 0, figuras: cuentas?.g ?? 0 },
      portadaUrl: await portada(p, d.id),
      tarea: await tareaDeDocumento(p.sql, d.id),
    };
    if (d.estado === 'error') detalle.error = await ultimoError(p.sql, d.id);
    return c.json(detalle);
  });

  app.patch('/documentos/:id/metadatos', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    const b = await cuerpoJson<ParcheMetadatos>(c);
    exigir(b && typeof b === 'object' && !Array.isArray(b), 'Manda un objeto con los metadatos que cambian.');
    const procedencia = { ...(d.metadatos.procedencia ?? {}) };
    for (const k of Object.keys(b)) if (k !== 'procedencia') procedencia[k] = { fuente: 'usuario', confianza: 1 };
    const m: MetadatosDocumento = { ...d.metadatos, ...b, procedencia };
    exigir(typeof m.titulo === 'string' && m.titulo.trim(), 'El título no puede quedar vacío.');
    exigir(Array.isArray(m.autores), 'Los autores deben ser una lista.');
    await escribirDocumento(p.sql, { ...d, metadatos: m, actualizado: ahora() });
    void autoresPlanos;
    // Los metadatos filtrables del índice (año, idioma) se actualizan al reindexar; la estantería ya está al día.
    return c.json(await (async () => {
      const nuevo = (await leerDocumento(p.sql, d.id))!;
      return { ...nuevo, espacios: [], cuentas: { fragmentos: 0, secciones: 0, figuras: 0 } } satisfies DetalleDocumento;
    })());
  });

  app.delete('/documentos/:id', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    await borrarDocumentoCompleto(p, d.id);
    return c.json({ ok: true });
  });

  app.post('/documentos/:id/reprocesar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    if (await tareaDeDocumento(p.sql, d.id)) fallo('conflicto', 'El documento ya se está procesando.');
    const b = await cuerpoJson<Reprocesar>(c);
    const prefijo = prefijoDocumento(p.usuario.id, d.id);
    const paquete = (await p.almacen.existe(`${prefijo}paquete.json`)) ? `${prefijo}paquete.json` : undefined;
    const r = await lanzarIngesta(p, {
      documento: d.id, prefijo, original: d.original, paquete, tipo: d.tipo, mime: d.mime, nombre: d.metadatos.titulo,
      fases: b.fases, url: d.metadatos.url && !d.original ? d.metadatos.url : undefined,
    }, 'reproceso');
    return c.json(r, 202);
  });

  app.get('/documentos/:id/unidades', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const desde = entero(c.req.query('desde'), 0, 0);
    const hasta = entero(c.req.query('hasta'), desde + 19, desde, desde + 99);
    const filas = await p.sql.ejecutar<Fila>('SELECT * FROM unidades WHERE documento = ? AND orden BETWEEN ? AND ? ORDER BY orden', id, desde, hasta);
    if (!filas.length && !(await leerDocumento(p.sql, id))) noEncontrado('El documento');
    return c.json(await Promise.all(filas.map(async (f) => unidadAVista(f, {
      imagen: await urlOpcional(p, id, f.imagen as string | null), miniatura: await urlOpcional(p, id, f.miniatura as string | null),
    }))));
  });

  app.get('/documentos/:id/unidades/:orden', async (c: Ctx) => {
    const p = puertos(c);
    const [f] = await p.sql.ejecutar<Fila>('SELECT * FROM unidades WHERE documento = ? AND orden = ?', prm(c, 'id'), entero(prm(c, 'orden'), 1));
    if (!f) noEncontrado('La unidad');
    const doc = prm(c, 'id');
    return c.json(unidadAVista(f, { imagen: await urlOpcional(p, doc, f.imagen as string | null), miniatura: await urlOpcional(p, doc, f.miniatura as string | null) }));
  });

  app.get('/documentos/:id/unidades/:orden/imagen', async (c: Ctx) => {
    const p = puertos(c);
    const [f] = await p.sql.ejecutar<{ imagen: string | null; miniatura: string | null }>('SELECT imagen, miniatura FROM unidades WHERE documento = ? AND orden = ?', prm(c, 'id'), entero(prm(c, 'orden'), 1));
    const clave = c.req.query('miniatura') ? (f?.miniatura ?? f?.imagen) : (f?.imagen ?? f?.miniatura);
    if (!clave) noEncontrado('La imagen de la unidad');
    return c.redirect(await p.almacen.urlLectura(claveDe(p.usuario.id, prm(c, 'id'), clave)), 302);
  });

  app.get('/documentos/:id/folios', async (c: Ctx) => {
    const p = puertos(c);
    const filas = await p.sql.ejecutar<Fila>('SELECT orden, ancla, impresa, t0 FROM unidades WHERE documento = ? ORDER BY orden', prm(c, 'id'));
    const folios: MapaFolios['folios'] = filas.map((f) => {
      const a = json<Ancla | null>(f.ancla, null);
      const e: MapaFolios['folios'][number] = { orden: Number(f.orden), impresa: (f.impresa as string | null) ?? null };
      if (a?.tipo === 'pagina') { e.fisica = a.fisica; e.origen = a.origen; e.confianza = a.confianza; }
      if (f.t0 != null) e.t0 = Number(f.t0);
      return e;
    });
    return c.json<MapaFolios>({ folios });
  });

  app.get('/documentos/:id/secciones', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const ordenes = new Map((await p.sql.ejecutar<{ id: string; orden: number }>('SELECT id, orden FROM unidades WHERE documento = ?', id)).map((f) => [f.id, f.orden]));
    const secciones = await leerSecciones(p.sql, id);
    return c.json<SeccionVista[]>(secciones.map((s) => {
      const v: SeccionVista = { id: s.id, nivel: s.nivel, titulo: s.titulo, unidadDesde: ordenes.get(s.unidadDesde) ?? 1 };
      if (s.padre) v.padre = s.padre;
      if (s.unidadHasta && ordenes.has(s.unidadHasta)) v.unidadHasta = ordenes.get(s.unidadHasta)!;
      if (s.resumen) v.resumen = s.resumen;
      return v;
    }));
  });

  app.get('/documentos/:id/fragmentos', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const unidad = c.req.query('unidad');
    const desde = entero(c.req.query('desde'), unidad ? entero(unidad, 0) : 0);
    const hasta = entero(c.req.query('hasta'), unidad ? desde : desde + 9);
    const filas = await p.sql.ejecutar<Fila>(
      `SELECT f.*, u.orden AS orden_unidad FROM fragmentos f JOIN unidades u ON u.id = f.unidad
       WHERE f.documento = ? AND u.orden BETWEEN ? AND ? ORDER BY f.orden LIMIT 1000`, id, desde, hasta);
    return c.json<FragmentoVista[]>(filas.map((f) => {
      const fr = filaAFragmento(f as never);
      const v: FragmentoVista = {
        id: fr.id, unidad: Number(f.orden_unidad), orden: fr.orden, texto: fr.texto, contexto: fr.contexto, seccion: fr.seccion,
        ancla: fr.ancla, etiqueta: etiquetaAncla(fr.ancla, fr.anclaFin),
      };
      if (fr.anclaFin) v.anclaFin = fr.anclaFin;
      return v;
    }));
  });

  app.get('/documentos/:id/figuras', async (c: Ctx) => {
    const p = puertos(c);
    const id = prm(c, 'id');
    const ordenes = new Map((await p.sql.ejecutar<{ id: string; orden: number }>('SELECT id, orden FROM unidades WHERE documento = ?', id)).map((f) => [f.id, f.orden]));
    const figuras = await leerFiguras(p.sql, id);
    return c.json<FiguraVista[]>(await Promise.all(figuras.map(async (g) => {
      const v: FiguraVista = { id: g.id, unidad: ordenes.get(g.unidad) ?? 0, imagenUrl: g.imagen ? await p.almacen.urlLectura(claveDe(p.usuario.id, id, g.imagen)) : '', ancla: g.ancla, etiqueta: etiquetaAncla(g.ancla) };
      if (g.pie) v.pie = g.pie;
      if (g.descripcion) v.descripcion = g.descripcion;
      return v;
    })));
  });

  app.get('/documentos/:id/original', async (c: Ctx) => {
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    if (!d.original) noEncontrado('El original');
    const nombre = `${(d.metadatos.titulo || d.id).replace(/[^\p{L}\p{N} ._-]+/gu, '').slice(0, 80)}${/\.[a-z0-9]+$/i.exec(d.original)?.[0] ?? ''}`;
    return c.json({ url: await p.almacen.urlLectura(d.original, { segundos: 3600 * 6, descarga: nombre, tipo: d.mime }) });
  });

  // El medio con Range: redirige a la URL firmada, que admite Range.
  app.get('/documentos/:id/medio', async (c: Ctx) => {
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    if (!d.original) noEncontrado('El medio');
    return c.redirect(await p.almacen.urlLectura(d.original, { segundos: 3600 * 6, tipo: d.mime }), 302);
  });

  app.get('/documentos/:id/volcado', async (c: Ctx) => {
    const p = puertos(c);
    const d = await documentoOError(p, prm(c, 'id'));
    return c.json(await volcarDocumento(p, d));
  });
}

/** Todo lo necesario para armar el .spdf (en el navegador o en el servidor). */
export async function volcarDocumento(p: PuertosUsuario, d: Documento): Promise<VolcadoDocumento> {
  const unidades = await leerUnidades(p.sql, d.id);
  const secciones = await leerSecciones(p.sql, d.id);
  const fragmentos = (await p.sql.ejecutar<Fila>('SELECT * FROM fragmentos WHERE documento = ? ORDER BY orden', d.id)).map((f) => filaAFragmento(f as never));
  const figuras = await leerFiguras(p.sql, d.id);
  const espaciosIds = new Set((await p.sql.ejecutar<{ espacio: string }>('SELECT DISTINCT espacio FROM vectores WHERE documento = ?', d.id)).map((f) => f.espacio));
  const espacios = (await leerEspacios(p.sql)).filter((e) => espaciosIds.has(e.id));
  const vectores: VolcadoDocumento['vectores'] = [];
  for (const e of espacios) {
    for (const v of await leerVectores(p.sql, { espacio: e.id, documento: d.id })) {
      vectores.push({ objetivo: v.objetivo, id: v.id, espacio: v.espacio, base64: aBase64Url(vectorABytes(v.valores)) });
    }
  }
  const binarios: VolcadoDocumento['binarios'] = {};
  const poner = async (k: string | undefined, mime: string) => { if (k && !binarios[k]) binarios[k] = { url: await p.almacen.urlLectura(claveDe(p.usuario.id, d.id, k), { segundos: 3600 }), mime }; };
  await poner(d.original || undefined, d.mime);
  for (const u of unidades) { await poner(u.imagen, 'image/jpeg'); await poner(u.miniatura, 'image/webp'); }
  for (const g of figuras) await poner(g.imagen, 'image/jpeg');
  return {
    version: 400,
    documento: d,
    unidades: unidades.map((u) => ({
      id: u.id, orden: u.orden, ancla: u.ancla, texto: u.texto, notas: u.notas, cabecera: u.cabecera, pie: u.pie,
      imagen: u.imagen, miniatura: u.miniatura, lector: u.lector, confianza: u.confianza,
    })),
    secciones: secciones.map((s) => ({ id: s.id, padre: s.padre ?? undefined, nivel: s.nivel, titulo: s.titulo, unidadDesde: s.unidadDesde, unidadHasta: s.unidadHasta ?? undefined, resumen: s.resumen ?? undefined })),
    fragmentos: fragmentos.map((f) => ({ id: f.id, unidad: f.unidad, orden: f.orden, texto: f.texto, contexto: f.contexto, seccion: f.seccion, ancla: f.ancla, anclaFin: f.anclaFin })),
    figuras: figuras.map((g) => ({ id: g.id, unidad: g.unidad, imagen: g.imagen, pie: g.pie, descripcion: g.descripcion, ancla: g.ancla })),
    espacios,
    vectores,
    procedencia: (await leerProcedencia(p.sql, d.id)).map((e) => ({ fase: e.fase, proveedor: e.proveedor ?? undefined, detalle: e.detalle, ms: e.ms ?? undefined, cuando: e.cuando ?? '' })),
    binarios,
  };
}
