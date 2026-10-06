/**
 * Medios que empiezan a sonar al instante: el índice de un MP4 (la caja
 * «moov») tiene que ir ANTES de los datos («mdat»). Si va al final, el
 * navegador tiene que pedir el final del archivo antes de poder reproducir
 * nada (y algunos, con conexiones lentas, descargan casi todo).
 *
 * Aquí se hace lo mismo que `ffmpeg -movflags +faststart`, pero sin ffmpeg y
 * sin tener el archivo entero en memoria: se leen solo las cabeceras de las
 * cajas de primer nivel y la «moov», se corrigen los desplazamientos de los
 * trozos (stco/co64) y se reescribe el objeto por partes iguales de 16 MiB,
 * cada una armada con rangos del original. Sirve en el Worker (R2) y en local.
 *
 * También dice qué códecs lleva (avc1, hvc1, av01, vp09, mp4a, opus…), para
 * avisar si un navegador no podrá reproducirlo.
 */
import type { AlmacenAmpliado } from '../puertos.js';

export interface Caja { tipo: string; desde: number; tam: number; cabecera: number }

const TAM_PARTE = 16 * 1024 * 1024;
/** Más allá de esto no se toca (una «moov» de más de 64 MiB es rarísima: horas y horas a muchos fps). */
const MOOV_MAXIMA = 64 * 1024 * 1024;

const u32 = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const tipoDe = (b: Uint8Array, i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);

/** Las cajas de primer nivel, leyendo solo 16 bytes de cada una. */
export async function cajasDeNivelSuperior(leer: (desde: number, hasta: number) => Promise<Uint8Array | null>, total: number): Promise<Caja[] | null> {
  const out: Caja[] = [];
  let pos = 0;
  for (let n = 0; pos < total && n < 64; n++) {
    const h = await leer(pos, Math.min(total - 1, pos + 15));
    if (!h || h.length < 8) return null;
    let tam = u32(h, 0);
    const tipo = tipoDe(h, 4);
    let cabecera = 8;
    if (tam === 1) {
      if (h.length < 16) return null;
      tam = u32(h, 8) * 2 ** 32 + u32(h, 12);
      cabecera = 16;
    } else if (tam === 0) tam = total - pos;
    if (!/^[\x20-\x7e]{4}$/.test(tipo) || tam < cabecera || pos + tam > total) return null;
    out.push({ tipo, desde: pos, tam, cabecera });
    pos += tam;
  }
  return out;
}

const CONTENEDORES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'mvex', 'udta', 'dinf']);

/** Recorre las cajas de la «moov» (en memoria) y llama a `fn` con cada una. */
function recorrer(b: Uint8Array, desde: number, hasta: number, fn: (tipo: string, inicio: number, tam: number, cab: number) => void) {
  let i = desde;
  while (i + 8 <= hasta) {
    let tam = u32(b, i);
    const tipo = tipoDe(b, i + 4);
    let cab = 8;
    if (tam === 1) { tam = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12); cab = 16; }
    else if (tam === 0) tam = hasta - i;
    if (tam < cab || i + tam > hasta) return;
    fn(tipo, i, tam, cab);
    if (CONTENEDORES.has(tipo)) recorrer(b, i + cab, i + tam, fn);
    i += tam;
  }
}

/** Los códecs de las pistas (las entradas de «stsd»). */
export function codecsDeMoov(moov: Uint8Array): string[] {
  const out: string[] = [];
  recorrer(moov, 8, moov.length, (tipo, inicio, _tam, cab) => {
    // stsd: versión+banderas (4), número de entradas (4), y cada entrada empieza por tamaño (4) + formato (4).
    if (tipo === 'stsd' && inicio + cab + 16 <= moov.length) out.push(tipoDe(moov, inicio + cab + 12));
  });
  return out;
}

/**
 * Suma `delta` a todos los desplazamientos de trozo (stco de 32 bits y co64),
 * en una copia de la «moov». Devuelve null si alguno no cabe en 32 bits
 * (habría que convertir stco en co64 y la caja cambiaría de tamaño: se deja).
 */
export function desplazarTrozos(moov: Uint8Array, delta: number): Uint8Array | null {
  const b = moov.slice();
  const vista = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let ok = true;
  recorrer(b, 8, b.length, (tipo, inicio, _tam, cab) => {
    if (tipo !== 'stco' && tipo !== 'co64') return;
    const n = vista.getUint32(inicio + cab + 4);
    let p = inicio + cab + 8;
    for (let k = 0; k < n; k++) {
      if (tipo === 'stco') {
        const v = vista.getUint32(p) + delta;
        if (v > 0xffffffff) { ok = false; return; }
        vista.setUint32(p, v);
        p += 4;
      } else {
        const v = Number(vista.getBigUint64(p)) + delta;
        vista.setBigUint64(p, BigInt(v));
        p += 8;
      }
    }
  });
  return ok ? b : null;
}

/** Trozos del archivo nuevo: bytes en memoria (la moov corregida) o rangos del original. */
export type Trozo = { datos: Uint8Array } | { desde: number; hasta: number };

/**
 * El orden nuevo: todo lo anterior al primer «mdat» (menos la moov), la moov
 * corregida, y el resto en su orden. Los datos se desplazan exactamente el
 * tamaño de la moov.
 */
export function planFaststart(cajas: Caja[], moovCorregida: Uint8Array): Trozo[] {
  const moov = cajas.find((c) => c.tipo === 'moov')!;
  const primerMdat = cajas.findIndex((c) => c.tipo === 'mdat');
  const out: Trozo[] = [];
  const rango = (c: Caja) => out.push({ desde: c.desde, hasta: c.desde + c.tam - 1 });
  cajas.slice(0, primerMdat).filter((c) => c !== moov).forEach(rango);
  out.push({ datos: moovCorregida });
  cajas.slice(primerMdat).filter((c) => c !== moov).forEach(rango);
  return out;
}

export interface Diagnostico {
  mp4: boolean;
  /** La moov ya va delante de los datos. */
  rapido: boolean;
  codecs: string[];
  /** Códecs que Safari o Chrome en general no reproducen dentro de un MP4. */
  dudosos: string[];
}

const DUDOSOS = new Set(['av01', 'vp09', 'vp08', 'hev1', 'dvh1', 'dvhe']);

export async function diagnosticar(almacen: AlmacenAmpliado, clave: string): Promise<{ diag: Diagnostico; cajas: Caja[] | null; total: number; moov: Uint8Array | null } | null> {
  const cab = await almacen.cabecera(clave);
  if (!cab) return null;
  const leer = (a: number, b: number) => almacen.rango(clave, a, b);
  const cajas = await cajasDeNivelSuperior(leer, cab.bytes);
  const moovCaja = cajas?.find((c) => c.tipo === 'moov');
  const mdat = cajas?.findIndex((c) => c.tipo === 'mdat') ?? -1;
  if (!cajas || !cajas.some((c) => c.tipo === 'ftyp') || !moovCaja || mdat < 0) {
    return { diag: { mp4: false, rapido: true, codecs: [], dudosos: [] }, cajas, total: cab.bytes, moov: null };
  }
  const moov = moovCaja.tam <= MOOV_MAXIMA ? await leer(moovCaja.desde, moovCaja.desde + moovCaja.tam - 1) : null;
  const codecs = moov ? codecsDeMoov(moov) : [];
  return {
    diag: { mp4: true, rapido: cajas.indexOf(moovCaja) < mdat, codecs, dudosos: codecs.filter((c) => DUDOSOS.has(c)) },
    cajas, total: cab.bytes, moov,
  };
}

export type ResultadoFaststart = { estado: 'ya' | 'hecho' | 'no_mp4' | 'no_se_puede'; diag?: Diagnostico; ms?: number };

/**
 * Pone la moov delante, reescribiendo el objeto en el mismo sitio (el
 * almacén sustituye el objeto de golpe al completar la subida por partes:
 * quien lo esté leyendo sigue con el viejo hasta entonces).
 */
export async function adelantarMoov(almacen: AlmacenAmpliado, clave: string, tipo?: string): Promise<ResultadoFaststart> {
  const inicio = Date.now();
  const d = await diagnosticar(almacen, clave);
  if (!d || !d.diag.mp4 || !d.cajas) return { estado: 'no_mp4' };
  if (d.diag.rapido) return { estado: 'ya', diag: d.diag };
  if (!d.moov) return { estado: 'no_se_puede', diag: d.diag };
  const moovCaja = d.cajas.find((c) => c.tipo === 'moov')!;
  const primerMdat = d.cajas.find((c) => c.tipo === 'mdat')!;
  // Lo que queda entre el primer mdat y la moov se desplaza tanto como mide la moov.
  if (moovCaja.desde < primerMdat.desde) return { estado: 'ya', diag: d.diag };
  const corregida = desplazarTrozos(d.moov, moovCaja.tam);
  if (!corregida) return { estado: 'no_se_puede', diag: d.diag };
  const plan = planFaststart(d.cajas, corregida);
  const total = plan.reduce((n, t) => n + ('datos' in t ? t.datos.length : t.hasta - t.desde + 1), 0);
  if (total !== d.total) return { estado: 'no_se_puede', diag: d.diag };

  const subida = await almacen.subidaDirecta(clave, { partes: true, ...(tipo ? { tipo } : {}), bytes: total });
  if (subida.modo !== 'partes' || !subida.idSubida) return { estado: 'no_se_puede', diag: d.diag };
  const id = subida.idSubida;
  try {
    const partes: Array<{ numero: number; etag: string }> = [];
    for (let n = 0, desde = 0; desde < total; n++, desde += TAM_PARTE) {
      const hasta = Math.min(total, desde + TAM_PARTE);
      const parte = await armar(plan, desde, hasta, (a, b) => almacen.rango(clave, a, b));
      partes.push({ numero: n + 1, etag: await almacen.ponerParte(clave, id, n + 1, parte) });
    }
    await almacen.completarPartes(clave, id, partes);
  } catch (e) {
    await almacen.abortarPartes(clave, id).catch(() => undefined);
    throw e;
  }
  return { estado: 'hecho', diag: { ...d.diag, rapido: true }, ms: Date.now() - inicio };
}

/** Los bytes [desde, hasta) del archivo nuevo, armados con los trozos del plan. */
export async function armar(plan: Trozo[], desde: number, hasta: number, leer: (a: number, b: number) => Promise<Uint8Array | null>): Promise<Uint8Array> {
  const out = new Uint8Array(hasta - desde);
  let pos = 0; // posición en el archivo nuevo
  for (const t of plan) {
    const largo = 'datos' in t ? t.datos.length : t.hasta - t.desde + 1;
    const a = Math.max(desde, pos), b = Math.min(hasta, pos + largo);
    if (a < b) {
      const ini = a - pos, fin = b - pos; // dentro del trozo
      const trozo = 'datos' in t ? t.datos.subarray(ini, fin) : await leer(t.desde + ini, t.desde + fin - 1);
      if (!trozo || trozo.length !== b - a) throw new Error('No se pudo leer el original');
      out.set(trozo, a - desde);
    }
    pos += largo;
    if (pos >= hasta) break;
  }
  return out;
}

/** ¿Es un MP4 o un MOV (por tipo o por extensión)? */
export const esMp4 = (mime?: string, clave?: string) => /^(video|audio)\/(mp4|quicktime|x-m4a|m4a|x-m4v)$/.test(mime ?? '') || /\.(mp4|m4a|m4v|mov)$/i.test(clave ?? '');
