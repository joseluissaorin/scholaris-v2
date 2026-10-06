/** Subidas directas al almacén y arranque de la ingesta (ver contrato/subidas.ts). */
import type { Hono } from 'hono';
import type { TipoEntrada } from '@scholaris/nucleo';
import { nuevoId } from '@scholaris/nucleo';
import type {
  CompletarSubida, IngestaIniciada, Ingestar, NuevaSubida, PedirPartes, PedirRecursos, RecursosFirmados, SubidaCreada, SubidaUrl, UrlsPartes,
} from '@scholaris/contrato';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { LIMITES } from '../compartido/planes.js';
import { crearDocumentoPendiente, crearTarea, documentoPorHuella, marcarDocumento, ahora, pendientesPorHuella } from '../compartido/estanteria.js';
import { borrarDocumentoCompleto } from './documentos.js';
import type { ParamsIngesta, PuertosUsuario } from '../puertos.js';
import { exigirEscritura, extension, prm, puertos, type Ctx } from './util.js';

const EXT_TIPO: Record<string, TipoEntrada> = {
  pdf: 'pdf', epub: 'epub', docx: 'documento', doc: 'documento', odt: 'documento', rtf: 'documento', html: 'documento', htm: 'documento',
  md: 'documento', markdown: 'documento', txt: 'documento', pptx: 'presentacion', key: 'presentacion', odp: 'presentacion',
  xlsx: 'hoja', xls: 'hoja', csv: 'hoja', ods: 'hoja', tsv: 'hoja',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', opus: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', avi: 'video',
  jpg: 'imagen', jpeg: 'imagen', png: 'imagen', webp: 'imagen', heic: 'imagen', heif: 'imagen', gif: 'imagen', tif: 'imagen', tiff: 'imagen',
};

export function deducirTipo(nombre: string, mime: string): TipoEntrada | null {
  const e = extension(nombre);
  if (EXT_TIPO[e]) return EXT_TIPO[e]!;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'imagen';
  if (mime === 'application/epub+zip') return 'epub';
  if (mime.startsWith('text/')) return 'documento';
  if (mime.includes('wordprocessingml') || mime.includes('opendocument.text')) return 'documento';
  if (mime.includes('presentationml')) return 'presentacion';
  if (mime.includes('spreadsheetml')) return 'hoja';
  return null;
}

/** Ruta relativa segura dentro del prefijo de la subida. */
export function rutaSegura(ruta: string): string {
  const limpia = ruta.replace(/^\/+/, '');
  exigir(limpia && !limpia.split('/').some((p) => p === '..' || p === '.' || p === '') && limpia.length <= 200 && /^[\w./-]+$/.test(limpia),
    `La ruta «${ruta}» no es válida: usa letras, números, «-», «_», «.» y «/».`);
  return limpia;
}

interface FilaSubida {
  id: string; documento: string; nombre: string; mime: string; bytes: number; huella: string | null; tipo: TipoEntrada;
  clave: string; id_partes: string | null; prefijo: string; bibliotecas: string; metadatos: string | null; estado: string;
}

async function leerSubida(p: PuertosUsuario, id: string): Promise<FilaSubida> {
  const [f] = await p.sql.ejecutar<FilaSubida>('SELECT * FROM pl_subidas WHERE id = ?', id);
  return f ?? noEncontrado('La subida');
}

export function prefijoDocumento(usuario: string, documento: string): string {
  return `u/${usuario}/d/${documento}/`;
}

/** Comprueba la cuota de documentos y bytes antes de aceptar uno nuevo. */
async function comprobarCuotaDocumento(p: PuertosUsuario, bytes: number): Promise<void> {
  const plan = p.config.modo === 'local' ? 'local' : p.usuario.plan;
  const l = LIMITES[plan];
  if (bytes > Math.min(l.bytesSubida, p.config.bytesMaximos)) {
    fallo('demasiado_grande', `El fichero pesa ${(bytes / 1048576).toFixed(0)} MB y el máximo en tu plan es ${(l.bytesSubida / 1048576).toFixed(0)} MB.`, { maximo: l.bytesSubida });
  }
  const cuotas = await p.cuentas.cuotas(p.usuario.id, plan);
  if (cuotas.documentos.limite !== null && cuotas.documentos.usados >= cuotas.documentos.limite) {
    fallo(plan === 'gratis' ? 'requiere_pro' : 'cuota_superada', `Has llegado al máximo de ${cuotas.documentos.limite} documentos de tu plan.`, { cuota: 'documentos' });
  }
  if (cuotas.bytes.limite !== null && cuotas.bytes.usados + bytes > cuotas.bytes.limite) {
    fallo(plan === 'gratis' ? 'requiere_pro' : 'cuota_superada', 'No te queda espacio en tu plan para este fichero.', { cuota: 'bytes' });
  }
}

/** Crea la tarea, marca el documento y lanza el motor de ingesta. */
export async function lanzarIngesta(p: PuertosUsuario, params: Omit<ParamsIngesta, 'usuario' | 'plan' | 'tarea'>, tipoTarea: 'ingesta' | 'reproceso' | 'importacion' = 'ingesta'): Promise<IngestaIniciada> {
  const tarea = await crearTarea(p.sql, tipoTarea, params.documento, { paquete: params.paquete, url: params.url, fases: params.fases });
  const completos: ParamsIngesta = { ...params, usuario: p.usuario.id, plan: p.usuario.plan, tarea: tarea.id };
  // Todo lo necesario para relanzarla tal cual si se queda parada.
  await p.sql.ejecutar('UPDATE pl_tareas SET params = ? WHERE id = ?', JSON.stringify(completos), tarea.id);
  await marcarDocumento(p.sql, params.documento, 'procesando');
  try {
    await p.orquestador.lanzarIngesta(completos);
  } catch (e) {
    await p.sql.ejecutar("UPDATE pl_tareas SET estado = 'error', error = ? WHERE id = ?", (e as Error).message, tarea.id);
    await marcarDocumento(p.sql, params.documento, 'error');
    throw e;
  }
  await p.emisor.emitir(`usuario:${p.usuario.id}`, {
    tipo: 'progreso',
    progreso: { tarea: tarea.id, documento: params.documento, fase: 'subida', avance: 1, total: 0.02, mensaje: 'En cola', transcurrido: 0 },
  });
  return { documento: params.documento, tarea: tarea.id };
}

/** Crea el documento de una URL y lanza su ingesta (la ruta /subidas/url y los lotes). */
export async function ingerirDesdeUrl(p: PuertosUsuario, b: SubidaUrl): Promise<IngestaIniciada> {
  let url: URL;
  try { url = new URL(b.url); } catch { return fallo('peticion_invalida', 'La URL no es válida.'); }
  exigir(url.protocol === 'https:' || url.protocol === 'http:', 'Solo se admiten URLs http y https.');
  if (!p.config.conversionServidor) fallo('no_disponible', 'Esta instancia no puede descargar URLs: sube el fichero desde el navegador.');
  await comprobarCuotaDocumento(p, 1);
  const esVideo = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(url.hostname);
  const tipo: TipoEntrada = b.tipo ?? (esVideo ? 'video' : /\.pdf($|\?)/i.test(url.pathname) ? 'pdf' : 'web');
  const documento = nuevoId('d');
  const prefijo = prefijoDocumento(p.usuario.id, documento);
  await crearDocumentoPendiente(p.sql, {
    id: documento, tipo, huella: '', original: '', mime: tipo === 'web' ? 'text/html' : 'application/octet-stream', bytes: 0,
    metadatos: { autores: [], titulo: b.metadatos?.titulo ?? url.hostname + url.pathname, url: url.toString(), ...b.metadatos },
    bibliotecas: b.bibliotecas ?? [],
  });
  return lanzarIngesta(p, { documento, prefijo, original: '', url: url.toString(), tipo, mime: '', nombre: url.toString(), bibliotecas: b.bibliotecas, ...(b.modo ? { modo: b.modo } : {}) });
}

export function rutasSubidas(app: Hono<Entorno>): void {
  app.post('/subidas', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<NuevaSubida>(c);
    if (c.get('usuario').ambito) b.bibliotecas = [c.get('usuario').ambito!.biblioteca];
    exigir(typeof b.nombre === 'string' && b.nombre.length > 0 && b.nombre.length <= 500, 'Falta el nombre del fichero.');
    exigir(typeof b.mime === 'string', 'Falta el tipo MIME del fichero.');
    exigir(Number.isFinite(b.bytes) && b.bytes > 0, 'El tamaño del fichero no es válido.');
    const tipo = b.tipo ?? deducirTipo(b.nombre, b.mime);
    if (!tipo) fallo('peticion_invalida', `No sé leer ficheros «${extension(b.nombre) || b.mime}». Prueba con PDF, EPUB, DOCX, audio, vídeo o imágenes.`);
    if (b.huella) {
      // Una subida a medias con la misma huella se reanuda: mismo documento, enlaces nuevos.
      const [abierta] = await p.sql.ejecutar<{ id: string; documento: string; clave: string; id_partes: string | null; prefijo: string; tipo: TipoEntrada }>(
        "SELECT s.id, s.documento, s.clave, s.id_partes, s.prefijo, s.tipo FROM pl_subidas s JOIN documentos d ON d.id = s.documento WHERE s.huella = ? AND s.estado IN ('abierta','subida') AND d.estado = 'pendiente' ORDER BY s.creada DESC LIMIT 1", b.huella);
      if (abierta && abierta.tipo === (b.tipo ?? deducirTipo(b.nombre, b.mime))) {
        if (abierta.id_partes) await p.almacen.abortarPartes(abierta.clave, abierta.id_partes).catch(() => undefined);
        const original = await p.almacen.subidaDirecta(abierta.clave, { tipo: b.mime, bytes: b.bytes, partes: b.bytes > 64 * 1024 * 1024 });
        await p.sql.ejecutar("UPDATE pl_subidas SET id_partes = ?, estado = 'abierta', creada = ? WHERE id = ?", original.idSubida ?? null, ahora(), abierta.id);
        return c.json<SubidaCreada>({ subida: abierta.id, documento: abierta.documento, tipo: abierta.tipo, original, prefijo: abierta.prefijo }, 201);
      }
      // Lo demás que quedó a medias con la misma huella (errores) se reemplaza: nunca cuenta como duplicado.
      for (const viejo of await pendientesPorHuella(p.sql, b.huella)) await borrarDocumentoCompleto(p, viejo);
      const dup = await documentoPorHuella(p.sql, b.huella);
      if (dup) {
        return c.json<SubidaCreada>({ subida: '', documento: dup, tipo, original: { modo: 'simple', clave: '' }, prefijo: prefijoDocumento(p.usuario.id, dup), duplicado: dup });
      }
    }
    await comprobarCuotaDocumento(p, b.bytes);
    const documento = nuevoId('d');
    const subida = nuevoId('s');
    const prefijo = prefijoDocumento(p.usuario.id, documento);
    const ext = extension(b.nombre);
    const clave = `${prefijo}original${ext ? `.${ext}` : ''}`;
    const partes = b.bytes > 64 * 1024 * 1024;
    const original = await p.almacen.subidaDirecta(clave, { tipo: b.mime, bytes: b.bytes, partes });
    const titulo = b.metadatos?.titulo ?? b.nombre.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    await crearDocumentoPendiente(p.sql, {
      id: documento, tipo, huella: b.huella ?? '', original: clave, mime: b.mime, bytes: b.bytes,
      metadatos: { autores: [], ...b.metadatos, titulo }, bibliotecas: b.bibliotecas ?? [],
    });
    await p.sql.ejecutar(
      `INSERT INTO pl_subidas (id, documento, nombre, mime, bytes, huella, tipo, clave, id_partes, prefijo, bibliotecas, metadatos, estado, creada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'abierta', ?)`,
      subida, documento, b.nombre, b.mime, b.bytes, b.huella ?? null, tipo, clave, original.idSubida ?? null, prefijo,
      JSON.stringify(b.bibliotecas ?? []), b.metadatos ? JSON.stringify(b.metadatos) : null, ahora(),
    );
    return c.json<SubidaCreada>({ subida, documento, tipo, original, prefijo }, 201);
  });

  app.post('/subidas/url', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<SubidaUrl>(c);
    if (c.get('usuario').ambito) b.bibliotecas = [c.get('usuario').ambito!.biblioteca];
    return c.json(await ingerirDesdeUrl(p, b), 202);
  });

  app.post('/subidas/:id/partes', async (c: Ctx) => {
    const p = puertos(c);
    const s = await leerSubida(p, prm(c, 'id'));
    exigir(s.id_partes, 'Esta subida no es por partes.');
    const b = await cuerpoJson<PedirPartes>(c);
    exigir(Array.isArray(b.numeros) && b.numeros.length > 0 && b.numeros.length <= 100, 'Pide entre 1 y 100 partes a la vez.');
    const partes = await Promise.all(b.numeros.map(async (numero) => {
      exigir(Number.isInteger(numero) && numero >= 1 && numero <= 10000, `Número de parte no válido: ${numero}.`);
      return { numero, ...(await p.almacen.urlParte(s.clave, s.id_partes!, numero)) };
    }));
    return c.json<UrlsPartes>({ partes });
  });

  app.post('/subidas/:id/completar', async (c: Ctx) => {
    const p = puertos(c);
    const s = await leerSubida(p, prm(c, 'id'));
    exigir(s.id_partes, 'Esta subida no es por partes.');
    const b = await cuerpoJson<CompletarSubida>(c);
    exigir(Array.isArray(b.partes) && b.partes.length > 0, 'Faltan las partes.');
    await p.almacen.completarPartes(s.clave, s.id_partes!, b.partes);
    await p.sql.ejecutar("UPDATE pl_subidas SET estado = 'subida' WHERE id = ?", s.id);
    return c.json({ ok: true });
  });

  app.post('/subidas/:id/recursos', async (c: Ctx) => {
    const p = puertos(c);
    const s = await leerSubida(p, prm(c, 'id'));
    const b = await cuerpoJson<PedirRecursos>(c);
    exigir(Array.isArray(b.recursos) && b.recursos.length > 0 && b.recursos.length <= 2000, 'Pide entre 1 y 2000 recursos a la vez.');
    const recursos = await Promise.all(b.recursos.map(async (r) => {
      const ruta = rutaSegura(r.ruta);
      const clave = `${s.prefijo}${ruta}`;
      return { ruta, clave, subida: await p.almacen.subidaDirecta(clave, { tipo: r.mime, bytes: r.bytes, partes: (r.bytes ?? 0) > 64 * 1024 * 1024 }) };
    }));
    return c.json<RecursosFirmados>({ recursos });
  });

  app.post('/subidas/:id/ingestar', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const s = await leerSubida(p, prm(c, 'id'));
    if (s.estado === 'ingestando') fallo('conflicto', 'Esta subida ya se está procesando.');
    const b = await cuerpoJson<Ingestar>(c);
    // Con paquete, la ingesta trabaja con las partes de la imprenta: el original puede seguir subiendo
    // (el Workflow lo espera al final). Sin paquete, el servidor lo necesita ya.
    const cab = await p.almacen.cabecera(s.clave);
    if (!cab && !b.paquete && !b.manifiesto) fallo('peticion_invalida', 'El original todavía no ha llegado al almacén. Termina la subida antes de procesar.');
    let paquete: string | undefined;
    if (b.paquete) {
      paquete = `${s.prefijo}${rutaSegura(b.paquete)}`;
      if (!(await p.almacen.existe(paquete))) fallo('peticion_invalida', `No encuentro el paquete «${b.paquete}»: súbelo antes con /recursos.`);
    } else if (b.manifiesto) {
      paquete = `${s.prefijo}paquete.json`;
      await p.almacen.poner(paquete, JSON.stringify(b.manifiesto), 'application/json');
    } else if (!p.config.conversionServidor) {
      fallo('no_disponible', 'Esta instancia no convierte en el servidor: convierte el fichero en el navegador y manda el paquete.');
    }
    await p.sql.ejecutar("UPDATE pl_subidas SET estado = 'ingestando' WHERE id = ?", s.id);
    if (cab) await p.sql.ejecutar('UPDATE documentos SET bytes = ? WHERE id = ?', cab.bytes, s.documento);
    const r = await lanzarIngesta(p, {
      documento: s.documento, prefijo: s.prefijo, original: s.clave, paquete, tipo: s.tipo, mime: s.mime, nombre: s.nombre,
      forzarVision: b.forzarVision, pista: b.pista, bibliotecas: JSON.parse(s.bibliotecas) as string[], ...(b.modo ? { modo: b.modo } : {}),
    });
    return c.json(r, 202);
  });

  app.delete('/subidas/:id', async (c: Ctx) => {
    const p = puertos(c);
    const s = await leerSubida(p, prm(c, 'id'));
    if (s.estado === 'ingestando') fallo('conflicto', 'La subida ya se está procesando: borra el documento en su lugar.');
    if (s.id_partes) await p.almacen.abortarPartes(s.clave, s.id_partes).catch(() => undefined);
    await p.almacen.borrarPrefijo(s.prefijo);
    await p.sql.ejecutar('DELETE FROM documentos WHERE id = ?', s.documento);
    await p.sql.ejecutar('DELETE FROM pl_subidas WHERE id = ?', s.id);
    return c.json({ ok: true });
  });
}
