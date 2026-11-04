/**
 * El proxy de un documento en la API de ficheros del modelo (Gemini Files),
 * subido una vez y reaprovechado mientras viva. Los ficheros caducan a las 48 h:
 * se vuelven a subir si falta poco, si cambió el proxy o si el servidor ya no
 * los tiene. La subida va por trozos leídos del almacén (un Worker no puede
 * tener entero un proxy de 300 MB en sus 128 MB).
 *
 * Lo comparten la percepción y la herramienta «ver» de Investigar.
 */
import type { FicheroModelo } from './tipos.js';
import { clavesProxy } from './proxy.js';

/** Un fichero de la API (estructuralmente igual a `ArchivoGemini` de @scholaris/proveedores). */
export interface FicheroRemoto {
  nombre: string;
  uri: string;
  mime: string;
  estado: 'ACTIVE' | 'PROCESSING' | 'FAILED';
  bytes?: number;
  expira?: string;
}

/** La API de ficheros (Gemini: `subirArchivoPorTrozos` y `archivo` del cliente). */
export interface PuertoFicheros {
  subirArchivoPorTrozos(o: { bytes: number; mime: string; nombreVisible?: string; leer(desde: number, hasta: number): Promise<Uint8Array> }): Promise<FicheroRemoto>;
  archivo(nombre: string): Promise<FicheroRemoto | null>;
}

/** Lo que hace falta del almacén (lo cumple el `Almacen` de nucleo con `cabecera`). */
export interface AlmacenProxy {
  cabecera(clave: string): Promise<{ bytes: number; tipo?: string; etag?: string } | null>;
  rango(clave: string, desde: number, hasta: number): Promise<Uint8Array | null>;
  bytes(clave: string): Promise<Uint8Array | null>;
  poner(clave: string, cuerpo: string, tipo?: string): Promise<void>;
}

export interface CacheGemini {
  uri: string;
  nombre: string;
  mime: string;
  bytes: number;
  etag?: string;
  subido: string;
  expira: string;
}

export class ErrorSinProxy extends Error {
  constructor(clave: string) {
    super(`Este documento aún no tiene proxy (${clave}): hay que crearlo antes de que el modelo lo vea.`);
    this.name = 'ErrorSinProxy';
  }
}

export interface PuertosFuenteGemini {
  almacen: AlmacenProxy;
  ficheros: PuertoFicheros;
  reloj?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const HORA = 3_600_000;

/**
 * `{ uri, mime }` del proxy del documento en Gemini, listo para `fileData`.
 * - `margenHoras`: vida mínima que le tiene que quedar (por defecto 6 h).
 * - `renovar`: subirlo otra vez aunque la caché diga que vive.
 */
export async function fuenteGemini(p: PuertosFuenteGemini, o: { prefijo: string; margenHoras?: number; renovar?: boolean; mime?: string }): Promise<FicheroModelo & { expira: string; nombre: string }> {
  const reloj = p.reloj ?? Date.now;
  const esperar = p.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const claves = clavesProxy(o.prefijo);
  const cab = await p.almacen.cabecera(claves.proxy);
  if (!cab) throw new ErrorSinProxy(claves.proxy);
  const mime = o.mime ?? (cab.tipo && /^(video|audio)\//.test(cab.tipo) ? cab.tipo : 'video/mp4');
  const margen = (o.margenHoras ?? 6) * HORA;

  if (!o.renovar) {
    const crudo = await p.almacen.bytes(claves.gemini).catch(() => null);
    let cache: CacheGemini | null = null;
    try { cache = crudo ? (JSON.parse(new TextDecoder().decode(crudo)) as CacheGemini) : null; } catch { cache = null; }
    const mismoProxy = cache && cache.bytes === cab.bytes && (!cache.etag || !cab.etag || cache.etag === cab.etag);
    if (cache && mismoProxy && Date.parse(cache.expira) - reloj() > margen) {
      const vivo = await p.ficheros.archivo(cache.nombre).catch(() => undefined);
      // Si no se puede preguntar (red), se confía en la caché; si el servidor dice que no existe, se sube.
      if (vivo === undefined) return { uri: cache.uri, mime: cache.mime, nombre: cache.nombre, expira: cache.expira };
      if (vivo && vivo.estado !== 'FAILED') {
        const listo = vivo.estado === 'ACTIVE' ? vivo : await esperarActivo(p.ficheros, vivo, esperar);
        return { uri: listo.uri, mime: cache.mime, nombre: listo.nombre, expira: listo.expira ?? cache.expira };
      }
    }
  }

  const subido = await p.ficheros.subirArchivoPorTrozos({
    bytes: cab.bytes, mime, nombreVisible: `scholaris-${o.prefijo.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 120),
    leer: async (desde, hasta) => {
      const b = await p.almacen.rango(claves.proxy, desde, hasta - 1);
      if (!b) throw new Error(`No se pudo leer ${claves.proxy} [${desde}, ${hasta})`);
      return b;
    },
  });
  const listo = subido.estado === 'ACTIVE' ? subido : await esperarActivo(p.ficheros, subido, esperar);
  const cache: CacheGemini = {
    uri: listo.uri, nombre: listo.nombre, mime: listo.mime || mime, bytes: cab.bytes, ...(cab.etag ? { etag: cab.etag } : {}),
    subido: new Date(reloj()).toISOString(), expira: listo.expira ?? new Date(reloj() + 47 * HORA).toISOString(),
  };
  await p.almacen.poner(claves.gemini, JSON.stringify(cache), 'application/json');
  return { uri: cache.uri, mime: cache.mime, nombre: cache.nombre, expira: cache.expira };
}

/** Un vídeo recién subido tarda en procesarse: se espera a ACTIVE (hasta ~10 min). */
async function esperarActivo(f: PuertoFicheros, a: FicheroRemoto, esperar: (ms: number) => Promise<void>): Promise<FicheroRemoto> {
  let actual = a;
  for (let i = 0; i < 120 && actual.estado === 'PROCESSING'; i++) {
    await esperar(i < 10 ? 2000 : 5000);
    actual = (await f.archivo(a.nombre)) ?? actual;
  }
  if (actual.estado !== 'ACTIVE') throw new Error(`El fichero ${a.nombre} no quedó listo en la API del modelo (${actual.estado}).`);
  return actual;
}
