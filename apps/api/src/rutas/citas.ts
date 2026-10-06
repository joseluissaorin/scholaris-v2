/** Citas (ver contrato/citas.ts). La lógica vive en @scholaris/citas. */
import type { Hono } from 'hono';
import type { Documento, MetadatosDocumento, ValorSQL } from '@scholaris/nucleo';
import { nuevoId } from '@scholaris/nucleo';
import type {
  Autocita, DecisionesAutocita, DetalleAutocita, ExportarReferencias, ImportacionBibtex, ImportarBibtex, InsertarEnDocx, Pagina,
  PedirBibliografia, PropuestaCita, ResumenAutocita, Verificar,
} from '@scholaris/contrato';
import {
  autocitar, bibliografia, citaDocumento, exportarReferencias, extraerTexto, importarBibtex, insertarCitasDocx, insertarCitasTexto,
  listarEstilos, verificarAfirmacion,
} from '@scholaris/citas';
import { leerDocumento } from '@scholaris/spdf';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo, noEncontrado } from '../compartido/errores.js';
import { ahora, crearTarea, terminarTarea } from '../compartido/estanteria.js';
import { obtenerBuscador } from '../compartido/servicios.js';
import type { PuertosUsuario } from '../puertos.js';
import { cursorADesplazamiento, desplazamientoACursor, entero, exigirEscritura, json, prm, puertos, type Ctx } from './util.js';

type Fila = Record<string, ValorSQL>;
type DocBreve = Pick<Documento, 'id' | 'tipo' | 'metadatos'>;

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Documentos por ids o por biblioteca (todos los listos si no se da nada). */
async function documentosDe(p: PuertosUsuario, ids?: string[], biblioteca?: string): Promise<DocBreve[]> {
  let filas: Array<{ id: string; tipo: string; metadatos: string }>;
  if (ids?.length) {
    exigir(ids.length <= 5000, 'Demasiados documentos (máximo 5000).');
    filas = await p.sql.ejecutar(`SELECT id, tipo, metadatos FROM documentos WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  } else if (biblioteca) {
    filas = await p.sql.ejecutar('SELECT d.id, d.tipo, d.metadatos FROM documentos d, json_each(d.bibliotecas) je WHERE je.value = ? ORDER BY d.autores, d.anio', biblioteca);
  } else {
    filas = await p.sql.ejecutar("SELECT id, tipo, metadatos FROM documentos WHERE estado = 'listo' ORDER BY autores, anio");
  }
  return filas.map((f) => ({ id: f.id, tipo: f.tipo as Documento['tipo'], metadatos: JSON.parse(f.metadatos) as MetadatosDocumento }));
}

function filaAResumen(f: Fila): ResumenAutocita {
  return { id: String(f.id), titulo: String(f.titulo), estado: f.estado as ResumenAutocita['estado'], citas: json<unknown[]>(f.propuestas, []).length, creada: String(f.creada) };
}

function filaADetalle(f: Fila): DetalleAutocita {
  const d: DetalleAutocita = {
    ...filaAResumen(f), texto: String(f.texto ?? ''), parrafos: json<string[]>(f.parrafos, []), propuestas: json<PropuestaCita[]>(f.propuestas, []),
    bibliografia: json<string[]>(f.bibliografia, []), estilo: String(f.estilo),
  };
  if (f.error) d.error = String(f.error);
  return d;
}

async function leerAutocita(p: PuertosUsuario, id: string): Promise<Fila> {
  const [f] = await p.sql.ejecutar<Fila>('SELECT * FROM pl_autocitas WHERE id = ?', id);
  return f ?? noEncontrado('La autocita');
}

/** Ejecuta la autocita en segundo plano y apunta el resultado en la estantería. */
async function ejecutarAutocita(p: PuertosUsuario, id: string, tarea: string, texto: string, b: Autocita): Promise<void> {
  const canal = `usuario:${p.usuario.id}`;
  const t0 = Date.now();
  try {
    await p.sql.ejecutar("UPDATE pl_autocitas SET estado = 'procesando' WHERE id = ?", id);
    const ia = await p.inteligencia();
    const buscador = await obtenerBuscador(p);
    const r = await autocitar(texto, { buscador, redactor: ia.redactor, juez: ia.juez }, {
      ...(b.filtros ? { filtros: b.filtros } : {}), estilo: b.estilo ?? 'apa', idioma: b.idioma ?? 'es-ES',
      ...(b.umbral !== undefined ? { umbral: b.umbral } : {}), ...(b.maxPorParrafo ? { maxPorParrafo: b.maxPorParrafo } : {}),
      alProgreso: (e: { fase?: string; avance?: number; mensaje?: string }) => {
        void p.emisor.emitir(canal, { tipo: 'progreso', progreso: { tarea, documento: '', fase: 'indexado', avance: e.avance ?? 0, total: e.avance ?? 0, mensaje: e.mensaje ?? e.fase, transcurrido: Date.now() - t0 } });
      },
    } as Parameters<typeof autocitar>[2]);
    await p.sql.ejecutar("UPDATE pl_autocitas SET estado = 'listo', texto = ?, parrafos = ?, propuestas = ?, bibliografia = ? WHERE id = ?",
      r.texto, JSON.stringify(r.parrafos), JSON.stringify(r.propuestas), JSON.stringify(r.bibliografia), id);
    await terminarTarea(p.sql, tarea, 'listo');
    await p.emisor.emitir(canal, { tipo: 'fin', tarea, estado: 'listo' });
  } catch (e) {
    console.error('autocita', e);
    const mensaje = 'No he podido terminar la autocita. Vuelve a intentarlo en unos minutos.';
    await p.sql.ejecutar("UPDATE pl_autocitas SET estado = 'error', error = ? WHERE id = ?", mensaje, id);
    await terminarTarea(p.sql, tarea, 'error', (e as Error).message);
    await p.emisor.emitir(canal, { tipo: 'fin', tarea, estado: 'error', error: mensaje });
  }
}

/** Texto de un DOCX/TXT/MD subido a la estantería del usuario. */
async function textoDeSubida(p: PuertosUsuario, clave: string): Promise<{ texto: string; bytes: Uint8Array; mime: string }> {
  exigir(clave.startsWith(`u/${p.usuario.id}/`), 'Ese fichero no es tuyo.');
  const bytes = await p.almacen.bytes(clave);
  if (!bytes) fallo('no_encontrado', 'No encuentro el fichero subido.');
  const cab = await p.almacen.cabecera(clave);
  const mime = cab?.tipo ?? (clave.endsWith('.docx') ? MIME_DOCX : 'text/plain');
  return { texto: (await extraerTexto(bytes, mime)).texto, bytes, mime };
}

export function rutasCitas(app: Hono<Entorno>): void {
  app.post('/citas/autocita', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<Autocita>(c);
    exigir(b.texto || b.subida, 'Manda el texto a citar o la clave de un DOCX subido.');
    const texto = b.texto ?? (await textoDeSubida(p, b.subida!)).texto;
    exigir(texto.trim().length >= 20, 'El texto es demasiado corto para citarlo.');
    exigir(texto.length <= 200_000, 'El texto es demasiado largo (máximo 200 000 caracteres).');
    const plan = p.config.modo === 'local' ? 'local' : p.usuario.plan;
    if (!(await p.cuentas.consumir(p.usuario.id, plan, 'autocitasMes'))) {
      fallo(plan === 'gratis' ? 'requiere_pro' : 'cuota_superada', 'Has llegado al máximo de autocitas de este mes en tu plan.', { cuota: 'autocitasMes' });
    }
    const id = nuevoId('a');
    const estilo = b.estilo ?? 'apa';
    await p.sql.ejecutar("INSERT INTO pl_autocitas (id, titulo, estado, peticion, texto, estilo, creada) VALUES (?, ?, 'en_cola', ?, ?, ?, ?)",
      id, (b.titulo ?? texto.slice(0, 80).replace(/\s+/g, ' ')).trim(), JSON.stringify({ ...b, texto: undefined }), texto, estilo, ahora());
    const tarea = await crearTarea(p.sql, 'autocita', null, { autocita: id });
    p.segundoPlano(ejecutarAutocita(p, id, tarea.id, texto, b));
    return c.json({ tarea: tarea.id, autocita: id }, 202);
  });

  app.get('/citas/autocita', async (c: Ctx) => {
    const p = puertos(c);
    const limite = entero(c.req.query('limite'), 30, 1, 100);
    const desde = cursorADesplazamiento(c.req.query('cursor'));
    const filas = await p.sql.ejecutar<Fila>('SELECT id, titulo, estado, propuestas, creada FROM pl_autocitas ORDER BY creada DESC LIMIT ? OFFSET ?', limite + 1, desde);
    const salida: Pagina<ResumenAutocita> = { elementos: filas.slice(0, limite).map(filaAResumen) };
    if (filas.length > limite) salida.siguiente = desplazamientoACursor(desde + limite);
    return c.json(salida);
  });

  app.get('/citas/autocita/:id', async (c: Ctx) => c.json(filaADetalle(await leerAutocita(puertos(c), prm(c, 'id')))));

  app.patch('/citas/autocita/:id', async (c: Ctx) => {
    const p = puertos(c);
    const f = await leerAutocita(p, prm(c, 'id'));
    const b = await cuerpoJson<DecisionesAutocita>(c);
    exigir(Array.isArray(b.decisiones), 'Manda una lista de decisiones.');
    const propuestas = json<PropuestaCita[]>(f.propuestas, []);
    const porId = new Map(propuestas.map((x) => [x.id, x]));
    for (const d of b.decisiones) {
      const x = porId.get(d.propuesta);
      if (x && (d.decision === 'aceptada' || d.decision === 'rechazada')) x.decision = d.decision;
    }
    await p.sql.ejecutar('UPDATE pl_autocitas SET propuestas = ? WHERE id = ?', JSON.stringify(propuestas), f.id as string);
    return c.json(filaADetalle({ ...f, propuestas: JSON.stringify(propuestas) }));
  });

  app.delete('/citas/autocita/:id', async (c: Ctx) => {
    const p = puertos(c);
    await leerAutocita(p, prm(c, 'id'));
    await p.sql.ejecutar('DELETE FROM pl_autocitas WHERE id = ?', prm(c, 'id'));
    return c.json({ ok: true });
  });

  app.get('/citas/autocita/:id/exportar', async (c: Ctx) => {
    const p = puertos(c);
    const d = filaADetalle(await leerAutocita(p, prm(c, 'id')));
    if (d.estado !== 'listo') fallo('conflicto', 'La autocita todavía no ha terminado.');
    const formato = c.req.query('formato') ?? 'docx';
    const aceptadas = d.propuestas.filter((x) => x.decision !== 'rechazada');
    const docs = await documentosDe(p, [...new Set(aceptadas.map((x) => x.cita.documento))]);
    const peticion = json<Autocita>((await leerAutocita(p, d.id)).peticion, {});
    const nombre = d.titulo.replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 60) || 'autocita';
    if (formato === 'docx') {
      exigir(peticion.subida, 'Esta autocita no salió de un DOCX: expórtala como «md» o «txt».');
      const { bytes } = await textoDeSubida(p, peticion.subida!);
      const salida = await insertarCitasDocx(bytes, aceptadas, docs, { estilo: d.estilo, ...(peticion.idioma ? { idioma: peticion.idioma } : {}) });
      return new Response(salida as Uint8Array<ArrayBuffer>, { headers: { 'content-type': MIME_DOCX, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}.docx` } });
    }
    exigir(formato === 'md' || formato === 'txt' || formato === 'latex', 'Formatos: docx, md, txt, latex.');
    const texto = await insertarCitasTexto(d.texto, aceptadas, docs, { formato: formato === 'txt' ? 'texto' : 'markdown', estilo: d.estilo });
    return new Response(texto, { headers: { 'content-type': formato === 'txt' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nombre)}.${formato === 'latex' ? 'tex' : formato}` } });
  });

  app.post('/citas/extraer-texto', async (c: Ctx) => {
    const mime = c.req.header('content-type') ?? 'application/octet-stream';
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    exigir(bytes.length > 0 && bytes.length <= 50 * 1024 * 1024, 'Manda un fichero de hasta 50 MB.');
    return c.json(await extraerTexto(bytes, mime));
  });

  app.post('/citas/verificar', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<Verificar>(c);
    exigir(typeof b.afirmacion === 'string' && b.afirmacion.trim().length > 3, 'Escribe la afirmación que quieres verificar.');
    exigir(b.afirmacion.length <= 4000, 'La afirmación es demasiado larga.');
    const ia = await p.inteligencia();
    const buscador = await obtenerBuscador(p);
    return c.json(await verificarAfirmacion(b.afirmacion, { buscador, juez: ia.juez, redactor: ia.redactor }, {
      ...(b.fragmentos ? { fragmentos: b.fragmentos } : {}), ...(b.filtros ? { filtros: b.filtros } : {}),
      ...(b.anioTexto ? { anioTexto: b.anioTexto } : {}), ...(b.k ? { k: b.k } : {}),
    }));
  });

  app.post('/citas/exportar', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<ExportarReferencias>(c);
    exigir(['bibtex', 'ris', 'csl-json'].includes(b.formato), 'Formatos: bibtex, ris, csl-json.');
    const texto = exportarReferencias(await documentosDe(p, b.documentos, b.biblioteca), b.formato);
    const tipo = b.formato === 'csl-json' ? 'application/vnd.citationstyles.csl+json' : b.formato === 'ris' ? 'application/x-research-info-systems' : 'application/x-bibtex';
    return new Response(texto, { headers: { 'content-type': `${tipo}; charset=utf-8` } });
  });

  app.post('/citas/bibliografia', async (c: Ctx) => {
    const p = puertos(c);
    const b = await cuerpoJson<PedirBibliografia>(c);
    return c.json(await bibliografia(await documentosDe(p, b.documentos, b.biblioteca), { ...(b.estilo ? { estilo: b.estilo } : {}), ...(b.idioma ? { idioma: b.idioma } : {}), ...(b.formato ? { formato: b.formato } : {}) }));
  });

  app.post('/citas/docx', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<InsertarEnDocx>(c);
    exigir(b.autocita, 'Indica la autocita cuyas citas quieres insertar.');
    const d = filaADetalle(await leerAutocita(p, b.autocita!));
    const peticion = json<Autocita>((await leerAutocita(p, d.id)).peticion, {});
    const clave = b.subida ?? peticion.subida;
    exigir(clave, 'Falta el DOCX original: súbelo y manda su clave en «subida».');
    const { bytes } = await textoDeSubida(p, clave!);
    const aceptadas = d.propuestas.filter((x) => x.decision !== 'rechazada');
    const salida = await insertarCitasDocx(bytes, aceptadas, await documentosDe(p, [...new Set(aceptadas.map((x) => x.cita.documento))]), {
      estilo: b.estilo ?? d.estilo, bibliografia: b.bibliografia ?? true,
    });
    const destino = `u/${p.usuario.id}/exportaciones/${d.id}-${Date.now()}.docx`;
    await p.almacen.poner(destino, salida, MIME_DOCX);
    return c.json({ url: await p.almacen.urlLectura(destino, { segundos: 3600, descarga: `${d.titulo.slice(0, 60) || 'citado'}.docx`, tipo: MIME_DOCX }) });
  });

  app.post('/citas/importar-bibtex', async (c: Ctx) => {
    exigirEscritura(c);
    const p = puertos(c);
    const b = await cuerpoJson<ImportarBibtex>(c);
    exigir(typeof b.bibtex === 'string' && b.bibtex.includes('@'), 'Pega un BibTeX válido.');
    exigir(b.bibtex.length <= 5_000_000, 'El BibTeX es demasiado grande (máximo 5 MB).');
    const r = importarBibtex(b.bibtex);
    const salida: ImportacionBibtex = { creados: 0, actualizados: 0, coincidencias: [], errores: r.errores };
    const existentes = await p.sql.ejecutar<{ id: string; metadatos: string; titulo: string | null }>('SELECT id, metadatos, titulo FROM documentos');
    const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const porDoi = new Map<string, string>(), porIsbn = new Map<string, string>(), porTitulo = new Map<string, string>();
    for (const e of existentes) {
      const m = JSON.parse(e.metadatos) as MetadatosDocumento;
      if (m.doi) porDoi.set(m.doi.toLowerCase(), e.id);
      if (m.isbn) porIsbn.set(m.isbn.replace(/[^0-9x]/gi, ''), e.id);
      if (e.titulo) porTitulo.set(normal(e.titulo), e.id);
    }
    for (const entrada of r.entradas) {
      const m = entrada.metadatos;
      const hallado = (m.doi && porDoi.get(m.doi.toLowerCase())) || (m.isbn && porIsbn.get(m.isbn.replace(/[^0-9x]/gi, ''))) || (m.titulo && porTitulo.get(normal(m.titulo)));
      if (hallado) {
        salida.coincidencias.push({ clave: entrada.clave, documento: hallado });
        const d = await leerDocumento(p.sql, hallado);
        if (d) {
          // Completa los huecos sin pisar lo que ya hay.
          const nuevos = Object.fromEntries(Object.entries(m).filter(([k, v]) => v !== undefined && (d.metadatos as unknown as Record<string, unknown>)[k] === undefined));
          if (Object.keys(nuevos).length) {
            await p.sql.ejecutar('UPDATE documentos SET metadatos = ?, actualizado = ? WHERE id = ?', JSON.stringify({ ...d.metadatos, ...nuevos }), ahora(), hallado);
            salida.actualizados++;
          }
        }
        if (b.biblioteca) await p.sql.ejecutar("UPDATE documentos SET bibliotecas = json_insert(bibliotecas, '$[#]', ?) WHERE id = ? AND NOT EXISTS (SELECT 1 FROM json_each(bibliotecas) WHERE value = ?)", b.biblioteca, hallado, b.biblioteca);
      } else {
        // Ficha sin original: referencia bibliográfica, no buscable hasta que se suba el fichero.
        const id = nuevoId('d');
        const t = ahora();
        await p.sql.ejecutar(
          `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, creado, actualizado, bibliotecas, titulo, autores, anio, idioma)
           VALUES (?, 'documento', ?, 'pendiente', '', '', 'application/x-bibtex', 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
          id, JSON.stringify(m), t, t, JSON.stringify(b.biblioteca ? [b.biblioteca] : []), m.titulo ?? entrada.clave,
          (m.autores ?? []).map((a) => a.apellidos || a.nombre).join('; ') || null, m.anio ?? null, m.idioma ?? null);
        salida.creados++;
      }
    }
    return c.json(salida);
  });

  app.get('/citas/estilos', async (c: Ctx) => c.json(await listarEstilos(c.req.query('q'))));

  app.get('/documentos/:id/cita', async (c: Ctx) => {
    const p = puertos(c);
    const [d] = await documentosDe(p, [prm(c, 'id')]);
    if (!d) noEncontrado('El documento');
    return c.json(await citaDocumento(d, { ...(c.req.query('estilo') ? { estilo: c.req.query('estilo')! } : {}), ...(c.req.query('idioma') ? { idioma: c.req.query('idioma')! } : {}) }));
  });
}
