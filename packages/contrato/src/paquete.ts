/**
 * Paquetes `.scholaris`: una biblioteca entera en un fichero.
 *
 * Es un zip corriente (se abre con cualquier descompresor):
 *
 *   manifest.json           ManifiestoPaquete: la biblioteca, sus derechos y la lista de documentos
 *   LEEME.txt               los derechos en palabras, para quien abra el zip a mano
 *   portada.<ext>           opcional
 *   documentos/<id>.spdf    un .spdf por documento (texto, anclas, vectores, páginas…)
 *
 * Sin dependencias: el escritor va en flujo (una entrada cada vez en memoria,
 * con ZIP64 si pasa de 4 GB) y el lector salta por el fichero sin cargarlo
 * entero (un `Blob` de varios GB en el navegador). Funciona en el navegador, en
 * Workers, en Node ≥ 20 y en Bun.
 */
import type { ClienteScholaris } from './cliente.js';
import type { ImportacionPaquete, ManifiestoPaquete, OpcionesPaquete } from './comunidad.js';
import type { ImportacionSpdf } from './documentos.js';
import { ErrorApi } from './comun.js';

export const MIME_PAQUETE = 'application/x-scholaris';
export const EXTENSION_PAQUETE = '.scholaris';

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Uint8Array, previo = 0): number {
  let c = ~previo >>> 0;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

// ---------------------------------------------------------------------------
// Escritor en flujo
// ---------------------------------------------------------------------------

interface EntradaEscrita { nombre: Uint8Array; crc: number; comprimido: number; tamano: number; desplazamiento: number; metodo: 0 | 8; hora: number; fecha: number }

const MAX32 = 0xffffffff;

function fechaDos(d: Date): { hora: number; fecha: number } {
  const anio = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    fecha: ((anio - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function flujoDe(datos: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(datos); c.close(); } });
}

async function comprimir(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = flujoDe(datos).pipeThrough(new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

async function descomprimir(datos: Uint8Array): Promise<Uint8Array> {
  const flujo = flujoDe(datos).pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/**
 * Escribe un zip en flujo. `flujo` se puede devolver ya como cuerpo de una
 * respuesta; cada `anadir` espera a que el lector haya tomado lo anterior
 * (contrapresión), así que nunca hay más de una entrada en memoria.
 */
export class EscritorZip {
  readonly flujo: ReadableStream<Uint8Array>;
  private readonly escritor: WritableStreamDefaultWriter<Uint8Array>;
  private readonly entradas: EntradaEscrita[] = [];
  private posicion = 0;
  private cerrado = false;

  constructor() {
    const t = new TransformStream<Uint8Array, Uint8Array>(undefined, { highWaterMark: 1 }, { highWaterMark: 1 });
    this.flujo = t.readable;
    this.escritor = t.writable.getWriter();
  }

  private async escribir(b: Uint8Array): Promise<void> {
    await this.escritor.ready;
    await this.escritor.write(b);
    this.posicion += b.length;
  }

  /** Añade una entrada. Sin `comprimir`, se guarda tal cual (los .spdf ya van en gzip). */
  async anadir(nombre: string, datos: Uint8Array | string, opciones: { comprimir?: boolean; fecha?: Date } = {}): Promise<void> {
    if (this.cerrado) throw new Error('El zip ya está cerrado.');
    const crudo = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
    const metodo: 0 | 8 = opciones.comprimir ? 8 : 0;
    const cuerpo = metodo === 8 ? await comprimir(crudo) : crudo;
    if (cuerpo.length >= MAX32 || crudo.length >= MAX32) throw new Error(`«${nombre}» pasa de 4 GB: no cabe en una entrada.`);
    const n = new TextEncoder().encode(nombre);
    const { hora, fecha } = fechaDos(opciones.fecha ?? new Date());
    const crc = crc32(crudo);
    const e: EntradaEscrita = { nombre: n, crc, comprimido: cuerpo.length, tamano: crudo.length, desplazamiento: this.posicion, metodo, hora, fecha };
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // nombres en UTF-8
    h.setUint16(8, metodo, true);
    h.setUint16(10, hora, true);
    h.setUint16(12, fecha, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, cuerpo.length, true);
    h.setUint32(22, crudo.length, true);
    h.setUint16(26, n.length, true);
    h.setUint16(28, 0, true);
    await this.escribir(new Uint8Array(h.buffer));
    await this.escribir(n);
    // Por trozos: un .spdf de cientos de MB no se copia entero de una vez en el flujo.
    for (let i = 0; i < cuerpo.length; i += 4 * 1024 * 1024) await this.escribir(cuerpo.subarray(i, Math.min(cuerpo.length, i + 4 * 1024 * 1024)));
    this.entradas.push(e);
  }

  /** Escribe el directorio central (con ZIP64 si hace falta) y cierra el flujo. */
  async cerrar(): Promise<void> {
    if (this.cerrado) return;
    this.cerrado = true;
    const inicioDirectorio = this.posicion;
    for (const e of this.entradas) {
      const zip64 = e.desplazamiento >= MAX32;
      const extra = zip64 ? 12 : 0;
      const h = new DataView(new ArrayBuffer(46 + extra));
      h.setUint32(0, 0x02014b50, true);
      h.setUint16(4, (3 << 8) | 45, true); // hecho en Unix, versión 4.5
      h.setUint16(6, zip64 ? 45 : 20, true);
      h.setUint16(8, 0x0800, true);
      h.setUint16(10, e.metodo, true);
      h.setUint16(12, e.hora, true);
      h.setUint16(14, e.fecha, true);
      h.setUint32(16, e.crc, true);
      h.setUint32(20, e.comprimido, true);
      h.setUint32(24, e.tamano, true);
      h.setUint16(28, e.nombre.length, true);
      h.setUint16(30, extra, true);
      h.setUint32(38, (0o100644 << 16) >>> 0, true);
      h.setUint32(42, zip64 ? MAX32 : e.desplazamiento, true);
      if (zip64) {
        h.setUint16(46, 0x0001, true);
        h.setUint16(48, 8, true);
        h.setBigUint64(50, BigInt(e.desplazamiento), true);
      }
      const b = new Uint8Array(h.buffer);
      // El nombre va entre la cabecera fija (46) y el campo extra.
      await this.escribir(b.subarray(0, 46));
      await this.escribir(e.nombre);
      if (extra) await this.escribir(b.subarray(46));
    }
    const tamDirectorio = this.posicion - inicioDirectorio;
    const necesita64 = this.entradas.length >= 0xffff || inicioDirectorio >= MAX32 || tamDirectorio >= MAX32;
    if (necesita64) {
      const inicio64 = this.posicion;
      const z = new DataView(new ArrayBuffer(56 + 20));
      z.setUint32(0, 0x06064b50, true);
      z.setBigUint64(4, 44n, true);
      z.setUint16(12, 45, true);
      z.setUint16(14, 45, true);
      z.setBigUint64(24, BigInt(this.entradas.length), true);
      z.setBigUint64(32, BigInt(this.entradas.length), true);
      z.setBigUint64(40, BigInt(tamDirectorio), true);
      z.setBigUint64(48, BigInt(inicioDirectorio), true);
      z.setUint32(56, 0x07064b50, true);
      z.setBigUint64(64, BigInt(inicio64), true);
      z.setUint32(72, 1, true);
      await this.escribir(new Uint8Array(z.buffer));
    }
    const f = new DataView(new ArrayBuffer(22));
    f.setUint32(0, 0x06054b50, true);
    f.setUint16(8, Math.min(0xffff, this.entradas.length), true);
    f.setUint16(10, Math.min(0xffff, this.entradas.length), true);
    f.setUint32(12, Math.min(MAX32, tamDirectorio), true);
    f.setUint32(16, Math.min(MAX32, inicioDirectorio), true);
    await this.escribir(new Uint8Array(f.buffer));
    await this.escritor.close();
  }

  /** Corta el flujo con un error (el que descarga verá la descarga fallida, no un zip a medias que parezca bueno). */
  async abortar(motivo: unknown): Promise<void> {
    this.cerrado = true;
    await this.escritor.abort(motivo).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Lector
// ---------------------------------------------------------------------------

export interface EntradaZip {
  nombre: string;
  tamano: number;
  comprimido: number;
  metodo: number;
  crc: number;
  desplazamiento: number;
}

export interface Zip {
  entradas: EntradaZip[];
  entrada(nombre: string): EntradaZip | undefined;
  leer(e: EntradaZip | string): Promise<Uint8Array>;
  texto(e: EntradaZip | string): Promise<string>;
}

type Fuente = Blob | Uint8Array | ArrayBuffer;

async function trozo(f: Blob | Uint8Array, desde: number, hasta: number): Promise<Uint8Array> {
  if (f instanceof Uint8Array) return f.subarray(desde, hasta);
  return new Uint8Array(await f.slice(desde, hasta).arrayBuffer());
}

/** Abre un zip sin cargarlo entero: lee el final, el directorio y luego cada entrada que se pida. */
export async function abrirZip(fuente: Fuente): Promise<Zip> {
  const f = fuente instanceof ArrayBuffer ? new Uint8Array(fuente) : fuente;
  const largo = f instanceof Uint8Array ? f.length : f.size;
  if (largo < 22) throw new Error('No es un zip: es demasiado pequeño.');
  const cola = await trozo(f, Math.max(0, largo - 65_557), largo);
  const dv = new DataView(cola.buffer, cola.byteOffset, cola.byteLength);
  let fin = -1;
  for (let i = cola.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('No es un zip (no tiene directorio central).');
  let total = dv.getUint16(fin + 10, true);
  let tamDir = dv.getUint32(fin + 12, true);
  let inicioDir = dv.getUint32(fin + 16, true);
  if (fin >= 20 && dv.getUint32(fin - 20, true) === 0x07064b50) {
    const pos64 = Number(dv.getBigUint64(fin - 20 + 8, true));
    const z = await trozo(f, pos64, pos64 + 56);
    const zv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    if (zv.getUint32(0, true) === 0x06064b50) {
      total = Number(zv.getBigUint64(32, true));
      tamDir = Number(zv.getBigUint64(40, true));
      inicioDir = Number(zv.getBigUint64(48, true));
    }
  }
  const dir = await trozo(f, inicioDir, inicioDir + tamDir);
  const d = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entradas: EntradaZip[] = [];
  const dec = new TextDecoder();
  let p = 0;
  for (let k = 0; k < total && p + 46 <= dir.length; k++) {
    if (d.getUint32(p, true) !== 0x02014b50) throw new Error('El directorio del zip está dañado.');
    const metodo = d.getUint16(p + 10, true);
    const crc = d.getUint32(p + 16, true);
    let comprimido = d.getUint32(p + 20, true);
    let tamano = d.getUint32(p + 24, true);
    const ln = d.getUint16(p + 28, true);
    const lx = d.getUint16(p + 30, true);
    const lc = d.getUint16(p + 32, true);
    let desplazamiento = d.getUint32(p + 42, true);
    const nombre = dec.decode(dir.subarray(p + 46, p + 46 + ln));
    // ZIP64: los campos a 0xFFFFFFFF vienen en el extra 0x0001, en este orden.
    let x = p + 46 + ln;
    const finExtra = x + lx;
    while (x + 4 <= finExtra) {
      const id = d.getUint16(x, true);
      const tam = d.getUint16(x + 2, true);
      if (id === 0x0001) {
        let y = x + 4;
        if (tamano === MAX32) { tamano = Number(d.getBigUint64(y, true)); y += 8; }
        if (comprimido === MAX32) { comprimido = Number(d.getBigUint64(y, true)); y += 8; }
        if (desplazamiento === MAX32) { desplazamiento = Number(d.getBigUint64(y, true)); }
      }
      x += 4 + tam;
    }
    entradas.push({ nombre, tamano, comprimido, metodo, crc, desplazamiento });
    p += 46 + ln + lx + lc;
  }
  const porNombre = new Map(entradas.map((e) => [e.nombre, e]));
  const leer = async (e0: EntradaZip | string): Promise<Uint8Array> => {
    const e = typeof e0 === 'string' ? porNombre.get(e0) : e0;
    if (!e) throw new Error(`El zip no contiene «${String(e0)}».`);
    const cab = await trozo(f, e.desplazamiento, e.desplazamiento + 30);
    const cv = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
    if (cv.getUint32(0, true) !== 0x04034b50) throw new Error(`La entrada «${e.nombre}» está dañada.`);
    const inicio = e.desplazamiento + 30 + cv.getUint16(26, true) + cv.getUint16(28, true);
    const crudo = await trozo(f, inicio, inicio + e.comprimido);
    if (e.metodo === 0) return crudo;
    if (e.metodo === 8) return descomprimir(crudo);
    throw new Error(`La entrada «${e.nombre}» usa un método de compresión que no sé leer (${e.metodo}).`);
  };
  return {
    entradas,
    entrada: (n) => porNombre.get(n),
    leer,
    texto: async (e) => new TextDecoder().decode(await leer(e)),
  };
}

// ---------------------------------------------------------------------------
// Paquetes con el cliente
// ---------------------------------------------------------------------------

/** Lee el manifiesto de un .scholaris (sin abrir los documentos). */
export async function leerManifiesto(fuente: Fuente): Promise<{ zip: Zip; manifiesto: ManifiestoPaquete }> {
  const zip = await abrirZip(fuente);
  if (!zip.entrada('manifest.json')) throw new Error('No es un paquete de Scholaris: falta manifest.json.');
  const manifiesto = JSON.parse(await zip.texto('manifest.json')) as ManifiestoPaquete;
  if (manifiesto.formato !== 'scholaris-biblioteca') throw new Error('No es un paquete de biblioteca de Scholaris.');
  if (manifiesto.version > 1) throw new Error(`El paquete es de una versión más nueva (${manifiesto.version}): actualiza Scholaris.`);
  return { zip, manifiesto };
}

/** Lo más grande que se manda de una vez a /documentos/importar (los proxies cortan hacia los 100 MB). */
const MAX_SPDF_DIRECTO = 95 * 1024 * 1024;

/**
 * Importa un .scholaris: crea la biblioteca (o usa `biblioteca`) y manda cada
 * .spdf a la estantería. Nada se vuelve a leer: solo se calculan los vectores
 * que falten. Lo que ya estaba (misma huella) se añade a la biblioteca sin copiarlo.
 */
export async function importarPaquete(
  api: ClienteScholaris,
  fuente: Fuente,
  o: { biblioteca?: string; nombre?: string; alAvance?: (hechos: number, total: number, titulo: string) => void } = {},
): Promise<ImportacionPaquete> {
  const { zip, manifiesto: m } = await leerManifiesto(fuente);
  const b = o.biblioteca ?? (await api.bibliotecas.crear({
    nombre: o.nombre ?? m.biblioteca.nombre,
    ...(m.biblioteca.descripcion ? { descripcion: m.biblioteca.descripcion } : {}),
    ...(m.biblioteca.color ? { color: m.biblioteca.color } : {}),
    derechos: m.biblioteca.derechos,
    ...(m.biblioteca.notaDerechos ? { notaDerechos: m.biblioteca.notaDerechos } : {}),
  })).id;
  const salida: ImportacionPaquete = { biblioteca: b, importados: [], repetidos: [], fallidos: [], avisos: [] };
  let hechos = 0;
  for (const d of m.documentos) {
    o.alAvance?.(hechos, m.documentos.length, d.titulo);
    try {
      const e = zip.entrada(d.archivo);
      if (!e) throw new Error('No está en el paquete.');
      if (e.tamano > MAX_SPDF_DIRECTO) throw new Error('Es demasiado grande para importarlo de una vez: exporta el paquete sin originales.');
      const r = await api.documentos.importar(await zip.leer(e), { biblioteca: b, deduplicar: true }) as ImportacionSpdf & { repetido?: boolean };
      if (r.repetido) salida.repetidos.push({ origen: d.id, documento: r.documento });
      else salida.importados.push({ origen: d.id, documento: r.documento, ...(r.tarea ? { tarea: r.tarea } : {}) });
      for (const a of r.avisos) if (!salida.avisos.includes(a)) salida.avisos.push(a);
    } catch (err) {
      salida.fallidos.push({ origen: d.id, error: err instanceof ErrorApi || err instanceof Error ? err.message : String(err) });
    }
    hechos++;
  }
  o.alAvance?.(hechos, m.documentos.length, '');
  return salida;
}

/** Ruta de descarga de un paquete (con sus opciones en la consulta). */
export function consultaPaquete(o: OpcionesPaquete = {}): Record<string, string | undefined> {
  return {
    originales: o.originales === false ? '0' : undefined,
    vectores: o.vectores === false ? '0' : undefined,
    documentos: o.documentos?.length ? o.documentos.join(',') : undefined,
  };
}
