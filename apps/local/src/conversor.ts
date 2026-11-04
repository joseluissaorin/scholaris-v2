/**
 * Conversor del servidor (Cloudflare Container o cualquier Docker): la
 * imprenta de Node con ffmpeg, @napi-rs/canvas y LibreOffice, para cuando no
 * hay navegador (SDK, API, importaciones) con la misma calidad que en la web:
 * PDF con capa de texto, vídeo con fotogramas, EPUB, DOCX y diapositivas con
 * su imagen.
 *
 *   POST /convertir?nombre=…&mime=…[&tipo=…]   cuerpo: el fichero
 *     → application/x-scholaris-tramas: una trama por parte binaria y al final
 *       {tipo:'fin', paquete} (o {tipo:'error', mensaje}).
 *   POST /recortar?x=…&y=…&w=…&h=…[&maximo=…]   cuerpo: la imagen
 *     → image/jpeg con la región (0-1) recortada: el recorte de una figura para su vector.
 *   POST /proxy?tipo=video|audio&nombre=…   cuerpo: el original (va a disco, no a memoria)
 *     → tramas: {tipo:'parte', id:'proxy.cortes.json'} con los cortes de plano,
 *       {tipo:'parte', id:'proxy.voz.json'} con los tramos con sonido de la voz,
 *       {tipo:'trozo', id:'proxy.mp4', desde, total} con el proxy en pedazos de 8 MiB
 *       y {tipo:'fin', bytes}. Lo que ven los modelos (percepción e Investigar).
 *   GET  /salud
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { convertir, crearProxy, recolectar, recortarImagen, type PaqueteConversion } from '@scholaris/imprenta/node';
import { codificarTrama } from '@scholaris/api/compartido/tramas';

const ejecutar = promisify(execFile);

/** PPTX/KEY/ODP → PDF con LibreOffice. */
async function aPdf(nombre: string, bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'lo-'));
  try {
    const entrada = join(dir, nombre.replace(/[^\w.-]/g, '_'));
    await writeFile(entrada, bytes);
    await ejecutar('soffice', ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, entrada], { timeout: 300_000 });
    const pdf = (await readdir(dir)).find((f) => f.endsWith('.pdf'));
    if (!pdf) throw new Error('LibreOffice no produjo PDF');
    return new Uint8Array(await readFile(join(dir, pdf)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function convertirTodo(nombre: string, mime: string, tipo: string | undefined, bytes: Uint8Array, enviar: (id: string, mime: string, datos: Uint8Array) => void): Promise<PaqueteConversion> {
  const r = await recolectar(convertir({ nombre, mime, bytes }, tipo ? { tipo: tipo as never } : {}));
  let paquete = r.paquete;
  let datos = r.datos;
  const tareas = paquete.reserva?.tareas ?? [];
  if (tareas.includes('imagenes_diapositivas') || tareas.includes('conversion_completa')) {
    const pdf = await aPdf(nombre, bytes);
    const rp = await recolectar(convertir({ nombre: `${nombre}.pdf`, mime: 'application/pdf', bytes: pdf }, { tipo: 'pdf' }));
    if (tareas.includes('conversion_completa') || paquete.contenido.clase !== 'presentacion') {
      // Sin texto propio (Keynote, PPT antiguo): las diapositivas como páginas.
      paquete = { ...rp.paquete, tipo: 'presentacion', origen: paquete.origen, metadatos: { ...rp.paquete.metadatos, ...paquete.metadatos } };
      datos = rp.datos;
    } else if (rp.paquete.contenido.clase === 'pdf') {
      const paginas = rp.paquete.contenido.paginas;
      for (const d of paquete.contenido.diapositivas) {
        const p = paginas[d.n - 1];
        if (!p?.imagen) continue;
        const id = `diapositivas/${String(d.n).padStart(4, '0')}.jpg`;
        const img = rp.datos.get(p.imagen);
        if (!img) continue;
        datos.set(id, img);
        paquete.partes.push({ id, clase: 'pagina', mime: 'image/jpeg', bytes: img.byteLength, unidad: d.n });
        d.imagen = id;
      }
    }
    paquete = { ...paquete, reserva: null };
  }
  for (const [id, d] of datos) enviar(id, paquete.partes.find((x) => x.id === id)?.mime ?? 'application/octet-stream', d);
  return paquete;
}

/** Trozos del proxy: 8 MiB (R2 pide partes iguales de 5 MiB como mínimo, salvo la última). */
const TROZO = 8 * 1024 * 1024;

/** El proxy de un medio: el original va a un temporal (puede pesar gigas) y el proxy sale por trozos. */
async function servirProxy(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const tipo = url.searchParams.get('tipo') === 'audio' ? 'audio' : 'video';
  const dir = await mkdtemp(join(tmpdir(), 'original-'));
  const entrada = join(dir, (url.searchParams.get('nombre') ?? 'medio').replace(/[^\w.-]/g, '_').slice(-80) || 'medio');
  try {
    await pipeline(req, createWriteStream(entrada));
    res.writeHead(200, { 'content-type': 'application/x-scholaris-tramas' });
    const t0 = Date.now();
    const p = await crearProxy(entrada, tipo);
    try {
      if (p.cortes) res.write(codificarTrama({ tipo: 'parte', id: 'proxy.cortes.json', mime: 'application/json' }, new TextEncoder().encode(JSON.stringify(p.cortes))));
      if (p.voz) res.write(codificarTrama({ tipo: 'parte', id: 'proxy.voz.json', mime: 'application/json' }, new TextEncoder().encode(JSON.stringify(p.voz))));
      const f = await open(p.ruta, 'r');
      try {
        for (let desde = 0; desde < p.bytes; desde += TROZO) {
          const b = Buffer.alloc(Math.min(TROZO, p.bytes - desde));
          await f.read(b, 0, b.length, desde);
          // Contrapresión: no se lee el siguiente trozo hasta que el anterior ha salido.
          if (!res.write(codificarTrama({ tipo: 'trozo', id: 'proxy.mp4', mime: p.mime, desde, total: p.bytes }, b))) await new Promise((r) => { res.once('drain', r); res.once('close', r); });
        }
      } finally {
        await f.close();
      }
      res.end(codificarTrama({ tipo: 'fin', bytes: p.bytes, mime: p.mime, ms: Date.now() - t0 }));
    } finally {
      await p.borrar();
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/x-scholaris-tramas' });
    res.end(codificarTrama({ tipo: 'error', mensaje: (e as Error).message }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const puerto = Number(process.env.PORT ?? 8080);
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://conversor');
  if (url.pathname === '/salud') { res.end('ok'); return; }
  if (url.pathname === '/recortar' && req.method === 'POST') {
    const trozosR: Buffer[] = [];
    for await (const t of req) trozosR.push(t as Buffer);
    const n = (k: string) => Number(url.searchParams.get(k));
    try {
      const r = await recortarImagen(new Uint8Array(Buffer.concat(trozosR)), { x: n('x'), y: n('y'), w: n('w'), h: n('h') }, Number(url.searchParams.get('maximo') ?? 1024));
      res.writeHead(200, { 'content-type': r.mime }); res.end(Buffer.from(r.bytes));
    } catch (e) {
      res.writeHead(422, { 'content-type': 'text/plain' }); res.end(String((e as Error)?.message ?? e));
    }
    return;
  }
  if (url.pathname === '/proxy' && req.method === 'POST') { await servirProxy(req, res, url); return; }
  if (url.pathname !== '/convertir' || req.method !== 'POST') { res.statusCode = 404; res.end(); return; }
  const trozos: Buffer[] = [];
  for await (const t of req) trozos.push(t as Buffer);
  const bytes = new Uint8Array(Buffer.concat(trozos));
  res.writeHead(200, { 'content-type': 'application/x-scholaris-tramas' });
  const t0 = Date.now();
  try {
    const paquete = await convertirTodo(url.searchParams.get('nombre') ?? 'fichero', url.searchParams.get('mime') ?? 'application/octet-stream', url.searchParams.get('tipo') ?? undefined, bytes,
      (id, mime, datos) => { res.write(codificarTrama({ tipo: 'parte', id, mime }, datos)); });
    res.end(codificarTrama({ tipo: 'fin', paquete, ms: Date.now() - t0 }));
  } catch (e) {
    console.error(e);
    res.end(codificarTrama({ tipo: 'error', mensaje: (e as Error).message }));
  }
}).listen(puerto, () => console.log(`Conversor escuchando en ${puerto}`));
