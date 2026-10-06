/**
 * Almacén sobre R2. Las operaciones de servidor usan el binding; el navegador
 * sube y descarga directo a R2 con URLs prefirmadas si hay credenciales S3 y,
 * si no, a través de la propia API con URLs firmadas por HMAC (pass-through en
 * streaming, como Andarama).
 */
import type { SubidaDirecta } from '@scholaris/nucleo';
import type { AlmacenAmpliado } from '../puertos.js';
import { PrefirmadorS3, type ConfigS3 } from '../compartido/s3.js';
import { firmarParametros } from '../compartido/firmas.js';
import { PREFIJO_API } from '@scholaris/contrato';

export const TAM_PARTE = 16 * 1024 * 1024;

export interface OpcionesR2 {
  secreto: string;
  /** Origen público de la API para las URLs firmadas. */
  origen: string;
  s3?: ConfigS3;
}

export function crearAlmacenR2(bucket: R2Bucket, o: OpcionesR2): AlmacenAmpliado {
  const s3 = o.s3 ? new PrefirmadorS3(o.s3) : null;
  const urlApi = async (ruta: string, ps: Record<string, string>, segundos: number, exp?: number) => `${o.origen}${PREFIJO_API}${ruta}?${(await firmarParametros(o.secreto, ps, segundos, exp)).toString()}`;

  const almacen: AlmacenAmpliado = {
    async poner(clave, cuerpo, tipo) {
      await bucket.put(clave, cuerpo as ReadableStream | ArrayBuffer | string, tipo ? { httpMetadata: { contentType: tipo } } : undefined);
    },
    async obtener(clave) {
      const r = await bucket.get(clave);
      if (!r) return null;
      return { cuerpo: r.body, meta: { clave, bytes: r.size, ...(r.httpMetadata?.contentType ? { tipo: r.httpMetadata.contentType } : {}) } };
    },
    async bytes(clave) {
      const r = await bucket.get(clave);
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    async rango(clave, desde, hasta) {
      const r = await bucket.get(clave, { range: { offset: desde, length: hasta - desde + 1 } });
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    async flujoRango(clave, desde, hasta) {
      const r = await bucket.get(clave, { range: { offset: desde, length: hasta - desde + 1 } });
      return r ? r.body : null;
    },
    async existe(clave) {
      return (await bucket.head(clave)) !== null;
    },
    async cabecera(clave) {
      const h = await bucket.head(clave);
      return h ? { bytes: h.size, etag: h.httpEtag, ...(h.httpMetadata?.contentType ? { tipo: h.httpMetadata.contentType } : {}) } : null;
    },
    async borrar(clave) {
      await bucket.delete(clave);
    },
    async borrarPrefijo(prefijo) {
      let n = 0;
      let cursor: string | undefined;
      do {
        const l = await bucket.list({ prefix: prefijo, limit: 1000, ...(cursor ? { cursor } : {}) });
        const claves = l.objects.map((x) => x.key);
        if (claves.length) await bucket.delete(claves);
        n += claves.length;
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
      return n;
    },
    async listar(prefijo) {
      const salida: Array<{ clave: string; bytes: number }> = [];
      let cursor: string | undefined;
      do {
        const l = await bucket.list({ prefix: prefijo, limit: 1000, ...(cursor ? { cursor } : {}) });
        for (const x of l.objects) salida.push({ clave: x.key, bytes: x.size });
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
      return salida;
    },
    async subidaDirecta(clave, op): Promise<SubidaDirecta> {
      if (op.partes) {
        const mp = await bucket.createMultipartUpload(clave, op.tipo ? { httpMetadata: { contentType: op.tipo } } : undefined);
        return { modo: 'partes', clave, idSubida: mp.uploadId, tamParte: TAM_PARTE };
      }
      if (s3) return { modo: 'simple', clave, url: await s3.put(clave), ...(op.tipo ? { cabeceras: { 'content-type': op.tipo } } : {}) };
      const ps: Record<string, string> = { clave, op: 'subir' };
      if (op.tipo) ps.tipo = op.tipo;
      if (op.bytes) ps.max = String(op.bytes);
      return { modo: 'simple', clave, url: await urlApi('/subidas/directa', ps, 3600 * 6), ...(op.tipo ? { cabeceras: { 'content-type': op.tipo } } : {}) };
    },
    async urlParte(clave, idSubida, numero) {
      if (s3) return { url: await s3.parte(clave, idSubida, numero) };
      return { url: await urlApi('/subidas/directa', { clave, op: 'subir', parte: String(numero), idSubida }, 3600 * 6) };
    },
    async ponerParte(clave, idSubida, numero, cuerpo) {
      const p = await bucket.resumeMultipartUpload(clave, idSubida).uploadPart(numero, cuerpo as ReadableStream);
      return p.etag;
    },
    async completarPartes(clave, idSubida, partes) {
      await bucket.resumeMultipartUpload(clave, idSubida).complete(partes.sort((a, b) => a.numero - b.numero).map((x) => ({ partNumber: x.numero, etag: x.etag.replace(/^"|"$/g, '') })));
    },
    async abortarPartes(clave, idSubida) {
      await bucket.resumeMultipartUpload(clave, idSubida).abort();
    },
    async urlLectura(clave, op = {}) {
      const segundos = op.segundos ?? 3600;
      if (s3) return s3.get(clave, segundos, op);
      const ps: Record<string, string> = { clave };
      if (op.descarga) ps.dl = op.descarga;
      if (op.tipo) ps.tipo = op.tipo;
      // Caducidad redondeada a la hora: la misma imagen da la misma URL y el navegador la cachea.
      const exp = Math.ceil((Date.now() / 1000 + segundos) / 3600) * 3600;
      return urlApi('/binarios', ps, segundos, exp);
    },
  };
  return almacen;
}
