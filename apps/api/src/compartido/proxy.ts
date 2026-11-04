/**
 * El proxy de un medio en el almacén (packages/ingesta/src/percepcion/proxy.ts):
 * `<prefijo>proxy.mp4` (360p y audio mono, o solo audio) y `<prefijo>proxy.cortes.json`.
 * Lo hace el conversor (el contenedor en Cloudflare, ffmpeg en local) a partir
 * del original; se escribe por partes, sin tener el proxy entero en memoria.
 */
import { clavesProxy } from '@scholaris/ingesta';
export { clavesProxy };
import type { AlmacenAmpliado } from '../puertos.js';
import type { ArchivoConvertir } from './motor-ingesta.js';
import { leerTramas } from './tramas.js';

export interface InfoProxy {
  clave: string;
  bytes: number;
  mime: string;
  /** Cortes de plano detectados (0 en audio). */
  cortes: number;
  /** Ya estaba hecho. */
  existia?: boolean;
}

/** Hace el proxy de un original y lo deja en el almacén bajo `prefijo`. */
export type HacerProxy = (archivo: ArchivoConvertir, tipo: 'video' | 'audio', destino: { almacen: AlmacenAmpliado; prefijo: string }) => Promise<InfoProxy>;

/** Trozo de 8 MiB: múltiplo de lo que pide R2 (todas las partes iguales menos la última, de 5 MiB como mínimo). */
export const TROZO_PROXY = 8 * 1024 * 1024;

/**
 * Escribe en el almacén lo que llega por trozos. Si cabe en uno, de una vez; si
 * no, como subida por partes (R2 o disco), y si algo falla, se aborta.
 */
export async function guardarPorTrozos(almacen: AlmacenAmpliado, clave: string, mime: string, trozos: AsyncIterable<Uint8Array>): Promise<number> {
  const it = trozos[Symbol.asyncIterator]();
  const primero = await it.next();
  if (primero.done) { await almacen.poner(clave, new Uint8Array(), mime); return 0; }
  const segundo = await it.next();
  if (segundo.done) { await almacen.poner(clave, primero.value, mime); return primero.value.length; }
  const sub = await almacen.subidaDirecta(clave, { tipo: mime, partes: true });
  if (!sub.idSubida) throw new Error('El almacén no admite subidas por partes');
  const partes: Array<{ numero: number; etag: string }> = [];
  let bytes = 0;
  try {
    let n = 1;
    for (let r: IteratorResult<Uint8Array> = primero; !r.done; r = n === 2 ? segundo : await it.next()) {
      partes.push({ numero: n, etag: await almacen.ponerParte(clave, sub.idSubida, n, r.value) });
      bytes += r.value.length;
      n++;
    }
    await almacen.completarPartes(clave, sub.idSubida, partes);
    return bytes;
  } catch (e) {
    await almacen.abortarPartes(clave, sub.idSubida).catch(() => undefined);
    throw e;
  }
}

/**
 * El proxy del conversor remoto (el contenedor): `POST /proxy?tipo=…&nombre=…`
 * con el original en el cuerpo. Responde tramas: `parte` con los cortes,
 * `trozo` con el proxy en pedazos de 8 MiB y `fin`.
 */
export function proxyRemoto(llamar: (peticion: Request) => Promise<Response>): HacerProxy {
  return async (archivo, tipo, { almacen, prefijo }) => {
    const claves = clavesProxy(prefijo);
    const q = new URLSearchParams({ tipo, nombre: archivo.nombre, mime: archivo.mime });
    const r = await llamar(new Request(`http://conversor/proxy?${q}`, { method: 'POST', body: await archivo.flujo(), duplex: 'half' } as RequestInit));
    if (!r.ok || !r.body) { await r.body?.cancel(); throw new Error(`El conversor respondió ${r.status} al pedir el proxy`); }
    let mime = tipo === 'video' ? 'video/mp4' : 'audio/mp4';
    let cortes = 0;
    let fin: { bytes?: number } | null = null;
    const tramas = leerTramas(r.body);
    // Los trozos se pasan a la subida por partes según llegan; los cortes y el fin, aparte.
    async function* trozos(): AsyncGenerator<Uint8Array> {
      for await (const { cabecera, datos } of tramas) {
        if (cabecera.tipo === 'trozo') { if (cabecera.mime) mime = String(cabecera.mime); yield datos; }
        else if (cabecera.tipo === 'parte' && cabecera.id === 'proxy.voz.json') await almacen.poner(claves.voz, datos, 'application/json');
        else if (cabecera.tipo === 'parte' && cabecera.id === 'proxy.cortes.json') {
          await almacen.poner(claves.cortes, datos, 'application/json');
          try { cortes = (JSON.parse(new TextDecoder().decode(datos)) as { cortes?: unknown[] }).cortes?.length ?? 0; } catch { /* sin recuento */ }
        } else if (cabecera.tipo === 'error') throw new Error(`El conversor no pudo hacer el proxy: ${String(cabecera.mensaje)}`);
        else if (cabecera.tipo === 'fin') { fin = cabecera as { bytes?: number }; return; }
      }
    }
    const bytes = await guardarPorTrozos(almacen, claves.proxy, mime, trozos());
    if (!fin) throw new Error('El conversor cortó el proxy antes de terminar');
    if ((fin as { bytes?: number }).bytes !== undefined && (fin as { bytes?: number }).bytes !== bytes) throw new Error(`El proxy llegó incompleto (${bytes} de ${(fin as { bytes?: number }).bytes} bytes)`);
    return { clave: claves.proxy, bytes, mime, cortes };
  };
}

/**
 * El proxy de un documento de audio o vídeo: si ya está, no se rehace (salvo
 * `forzar`); si no hay quien lo haga, null.
 */
export async function asegurarProxy(
  ctx: { almacen: AlmacenAmpliado; hacerProxy?: HacerProxy },
  doc: { prefijo: string; original: string; mime: string; tipo: string; nombre?: string },
  opciones: { forzar?: boolean } = {},
): Promise<InfoProxy | null> {
  if (doc.tipo !== 'video' && doc.tipo !== 'audio') return null;
  const claves = clavesProxy(doc.prefijo);
  if (!opciones.forzar) {
    const cab = await ctx.almacen.cabecera(claves.proxy);
    if (cab && cab.bytes > 0) return { clave: claves.proxy, bytes: cab.bytes, mime: cab.tipo ?? (doc.tipo === 'video' ? 'video/mp4' : 'audio/mp4'), cortes: 0, existia: true };
  }
  if (!ctx.hacerProxy || !doc.original) return null;
  const cab = await ctx.almacen.cabecera(doc.original);
  if (!cab) return null;
  const almacen = ctx.almacen;
  const archivo: ArchivoConvertir = {
    nombre: doc.nombre ?? doc.original.split('/').pop() ?? 'medio', mime: doc.mime, tipo: doc.tipo, bytes: cab.bytes,
    async leer() { const b = await almacen.bytes(doc.original); if (!b) throw new Error('No encuentro el original'); return b; },
    async flujo() { const o = await almacen.obtener(doc.original); if (!o) throw new Error('No encuentro el original'); return o.cuerpo as ReadableStream<Uint8Array>; },
  };
  return ctx.hacerProxy(archivo, doc.tipo, { almacen, prefijo: doc.prefijo });
}
