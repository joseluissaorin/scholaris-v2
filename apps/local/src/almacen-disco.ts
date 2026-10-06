/**
 * Almacén en disco con la misma interfaz que R2: cada clave es un fichero
 * bajo la raíz, el tipo MIME va en un fichero hermano «.tipo», y las subidas
 * del navegador pasan por la API con URLs firmadas (como el modo
 * pass-through de la nube).
 */
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import type { SubidaDirecta } from '@scholaris/nucleo';
import { PREFIJO_API } from '@scholaris/contrato';
import type { AlmacenAmpliado } from '@scholaris/api/puertos';
import { firmarParametros } from '@scholaris/api/compartido/firmas';

export const TAM_PARTE = 16 * 1024 * 1024;

export function crearAlmacenDisco(raizRelativa: string, o: { secreto: string; origen: () => string }): AlmacenAmpliado {
  const raiz = resolve(raizRelativa);
  const ruta = (clave: string) => {
    const r = resolve(raiz, clave);
    if (!r.startsWith(raiz + sep)) throw new Error(`Clave fuera del almacén: ${clave}`);
    return r;
  };
  const rutaTipo = (clave: string) => `${ruta(clave)}.__tipo`;
  const partes = (id: string) => join(raiz, '.partes', id.replace(/[^\w-]/g, ''));
  const urlApi = async (camino: string, ps: Record<string, string>, segundos: number, exp?: number) =>
    `${o.origen()}${PREFIJO_API}${camino}?${(await firmarParametros(o.secreto, ps, segundos, exp)).toString()}`;

  async function escribir(destino: string, cuerpo: ReadableStream | ArrayBuffer | Uint8Array | string): Promise<void> {
    await mkdir(dirname(destino), { recursive: true });
    const tmp = `${destino}.${randomUUID()}.tmp`;
    if (typeof cuerpo === 'string' || cuerpo instanceof Uint8Array || cuerpo instanceof ArrayBuffer) {
      await writeFile(tmp, typeof cuerpo === 'string' ? cuerpo : new Uint8Array(cuerpo as ArrayBuffer));
    } else {
      await pipeline(Readable.fromWeb(cuerpo as never), createWriteStream(tmp));
    }
    await rename(tmp, destino);
  }

  const almacen: AlmacenAmpliado = {
    async poner(clave, cuerpo, tipo) {
      await escribir(ruta(clave), cuerpo);
      if (tipo) await writeFile(rutaTipo(clave), tipo);
    },
    async obtener(clave) {
      const r = ruta(clave);
      const s = await stat(r).catch(() => null);
      if (!s?.isFile()) return null;
      const tipo = existsSync(rutaTipo(clave)) ? await readFile(rutaTipo(clave), 'utf8') : undefined;
      return { cuerpo: Readable.toWeb(createReadStream(r)) as unknown as ReadableStream, meta: { clave, bytes: s.size, ...(tipo ? { tipo } : {}) } };
    },
    async bytes(clave) {
      try { return new Uint8Array(await readFile(ruta(clave))); } catch { return null; }
    },
    async rango(clave, desde, hasta) {
      let f;
      try { f = await open(ruta(clave), 'r'); } catch { return null; }
      try {
        const b = Buffer.alloc(hasta - desde + 1);
        const { bytesRead } = await f.read(b, 0, b.length, desde);
        return new Uint8Array(b.subarray(0, bytesRead));
      } finally { await f.close(); }
    },
    async flujoRango(clave, desde, hasta) {
      const r = ruta(clave);
      if (!(await stat(r).catch(() => null))?.isFile()) return null;
      return Readable.toWeb(createReadStream(r, { start: desde, end: hasta })) as unknown as ReadableStream;
    },
    async existe(clave) {
      return (await stat(ruta(clave)).catch(() => null))?.isFile() ?? false;
    },
    async cabecera(clave) {
      const s = await stat(ruta(clave)).catch(() => null);
      if (!s?.isFile()) return null;
      const tipo = existsSync(rutaTipo(clave)) ? await readFile(rutaTipo(clave), 'utf8') : undefined;
      return { bytes: s.size, etag: `"${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}"`, ...(tipo ? { tipo } : {}) };
    },
    async borrar(clave) {
      await rm(ruta(clave), { force: true });
      await rm(rutaTipo(clave), { force: true });
    },
    async borrarPrefijo(prefijo) {
      const lista = await almacen.listar(prefijo);
      for (const x of lista) await almacen.borrar(x.clave);
      // Si el prefijo es un directorio, fuera entero.
      if (prefijo.endsWith('/')) await rm(ruta(prefijo.slice(0, -1)), { recursive: true, force: true }).catch(() => undefined);
      return lista.length;
    },
    async listar(prefijo) {
      const salida: Array<{ clave: string; bytes: number }> = [];
      const base = prefijo.includes('/') ? ruta(prefijo.slice(0, prefijo.lastIndexOf('/') + 1) || '.') : raiz;
      const recorrer = async (dir: string): Promise<void> => {
        let entradas;
        try { entradas = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entradas) {
          const p = join(dir, e.name);
          if (e.isDirectory()) { if (e.name !== '.partes') await recorrer(p); continue; }
          if (e.name.endsWith('.__tipo') || e.name.endsWith('.tmp')) continue;
          const clave = relative(raiz, p).split(sep).join('/');
          if (clave.startsWith(prefijo)) salida.push({ clave, bytes: (await stat(p)).size });
        }
      };
      await recorrer(base);
      return salida;
    },
    async subidaDirecta(clave, op): Promise<SubidaDirecta> {
      if (op.partes) {
        const id = randomUUID();
        await mkdir(partes(id), { recursive: true });
        await writeFile(join(partes(id), 'destino'), JSON.stringify({ clave, tipo: op.tipo ?? null }));
        return { modo: 'partes', clave, idSubida: id, tamParte: TAM_PARTE };
      }
      const ps: Record<string, string> = { clave, op: 'subir' };
      if (op.tipo) ps.tipo = op.tipo;
      if (op.bytes) ps.max = String(op.bytes);
      return { modo: 'simple', clave, url: await urlApi('/subidas/directa', ps, 3600 * 6), ...(op.tipo ? { cabeceras: { 'content-type': op.tipo } } : {}) };
    },
    async urlParte(clave, idSubida, numero) {
      return { url: await urlApi('/subidas/directa', { clave, op: 'subir', parte: String(numero), idSubida }, 3600 * 6) };
    },
    async ponerParte(_clave, idSubida, numero, cuerpo) {
      const destino = join(partes(idSubida), String(numero).padStart(5, '0'));
      await escribir(destino, cuerpo);
      const h = createHash('md5').update(await readFile(destino)).digest('hex');
      return `"${h}"`;
    },
    async completarPartes(clave, idSubida, lista) {
      const dir = partes(idSubida);
      const info = JSON.parse(await readFile(join(dir, 'destino'), 'utf8')) as { clave: string; tipo: string | null };
      if (info.clave !== clave) throw new Error('La subida no corresponde a esa clave');
      const destino = ruta(clave);
      await mkdir(dirname(destino), { recursive: true });
      const tmp = `${destino}.${randomUUID()}.tmp`;
      const salida = createWriteStream(tmp);
      for (const p of [...lista].sort((a, b) => a.numero - b.numero)) {
        await pipeline(createReadStream(join(dir, String(p.numero).padStart(5, '0'))), salida, { end: false });
      }
      await new Promise<void>((r, e) => salida.end((err?: Error | null) => (err ? e(err) : r())));
      await rename(tmp, destino);
      if (info.tipo) await writeFile(rutaTipo(clave), info.tipo);
      await rm(dir, { recursive: true, force: true });
    },
    async abortarPartes(_clave, idSubida) {
      await rm(partes(idSubida), { recursive: true, force: true });
    },
    async urlLectura(clave, op = {}) {
      const segundos = op.segundos ?? 3600;
      const ps: Record<string, string> = { clave };
      if (op.descarga) ps.dl = op.descarga;
      if (op.tipo) ps.tipo = op.tipo;
      const exp = Math.ceil((Date.now() / 1000 + segundos) / 3600) * 3600;
      return urlApi('/binarios', ps, segundos, exp);
    },
  };
  return almacen;
}
