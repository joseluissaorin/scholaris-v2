/**
 * El motor SQLite del SPDF: la compilación oficial a WebAssembly
 * (`@sqlite.org/sqlite-wasm`), que trae FTS5 de serie. La de sql.js no lo trae
 * («no such module: fts5»), y sin FTS5 no hay búsqueda léxica dentro del fichero.
 *
 * Funciona igual en el navegador, en Node y en Workers (workerd):
 *
 * - Navegador y Node: no hace falta configurar nada; el módulo localiza
 *   `sqlite3.wasm` a su lado (en Node lo lee del disco).
 * - Workers: workerd no deja compilar WebAssembly a partir de bytes en tiempo
 *   de ejecución. Eso afecta dos veces: al propio `sqlite3.wasm` y a los
 *   «puentes» diminutos que sqlite-wasm compila al arrancar para poner
 *   funciones JS en la tabla de funciones (`jsFuncToWasm`: cinco firmas, doce
 *   veces). Ambos se importan ya compilados (wrangler los compila al
 *   desplegar) y se le pasan al motor; `@scholaris/spdf/workers` lo hace todo:
 *
 *   ```ts
 *   import { prepararMotorWorkers } from '@scholaris/spdf/workers';
 *   prepararMotorWorkers();
 *   ```
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

export type MotorSqlite = Sqlite3Static;

export interface OpcionesMotor {
  /** Módulo WebAssembly ya compilado (obligatorio en Workers). */
  moduloWasm?: WebAssembly.Module;
  /** Bytes de `sqlite3.wasm`, si se prefiere cargarlos a mano. */
  bytesWasm?: ArrayBuffer | Uint8Array;
  /** URL de `sqlite3.wasm` (navegador con empaquetadores que mueven los ficheros). */
  urlWasm?: string;
  /**
   * Puentes JS→wasm precompilados, por firma («i3» = i32(i32, i32, i32), «v0» = void()).
   * Necesarios donde no se puede compilar wasm en tiempo de ejecución (Workers).
   */
  puentes?: Record<string, WebAssembly.Module>;
  /**
   * Instalar los VFS persistentes del navegador (OPFS, kvvfs). Por defecto no:
   * el SPDF vive en memoria y se exporta a bytes; sin ellos el arranque es más
   * ligero y no necesita más puentes en Workers.
   */
  vfsPersistentes?: boolean;
  /** Mensajes del motor; por defecto, silencio para lo informativo y consola para los errores. */
  registro?: (nivel: 'info' | 'error', ...args: unknown[]) => void;
}

let opciones: OpcionesMotor = {};
let promesa: Promise<MotorSqlite> | null = null;
let cargado: MotorSqlite | null = null;

/** Fija cómo se carga el motor. Debe llamarse antes del primer `abrirSpdf`/`crearSpdf`. */
export function configurarMotor(nuevas: OpcionesMotor): void {
  if (promesa) throw new Error('El motor SQLite ya está cargado: configurarMotor debe llamarse antes del primer uso.');
  opciones = { ...nuevas };
}

/** Carga (una sola vez) y devuelve el motor SQLite. */
export function motor(): Promise<MotorSqlite> {
  if (!promesa) {
    promesa = cargar(opciones).then((m) => (cargado = m)).catch((e) => {
      promesa = null;
      throw e;
    });
  }
  return promesa;
}

/** El motor ya cargado (síncrono); falla si aún no se ha llamado a `motor()`. */
export function motorCargado(): MotorSqlite {
  if (!cargado) throw new Error('El motor SQLite aún no está cargado.');
  return cargado;
}

async function cargar(o: OpcionesMotor): Promise<MotorSqlite> {
  const registro = o.registro ?? ((nivel: 'info' | 'error', ...args: unknown[]) => { if (nivel === 'error') console.error(...args); });
  const modulo: Record<string, unknown> = {
    print: (...args: unknown[]) => registro('info', ...args),
    printErr: (...args: unknown[]) => registro('error', ...args),
  };
  if (o.moduloWasm) {
    const compilado = o.moduloWasm;
    modulo.instantiateWasm = (imports: WebAssembly.Imports, listo: (instancia: WebAssembly.Instance, modulo: WebAssembly.Module) => void) => {
      void WebAssembly.instantiate(compilado, imports).then((instancia) => listo(instancia, compilado));
      return {};
    };
  } else if (o.bytesWasm) {
    modulo.wasmBinary = o.bytesWasm instanceof Uint8Array ? o.bytesWasm : new Uint8Array(o.bytesWasm);
  } else if (o.urlWasm) {
    const url = o.urlWasm;
    modulo.locateFile = (ruta: string) => (ruta.endsWith('.wasm') ? url : ruta);
  }
  const iniciarModulo = sqlite3InitModule as unknown as (m: Record<string, unknown>) => Promise<MotorSqlite>;
  const iniciar = async (m: Record<string, unknown>) => {
    const g = globalThis as { sqlite3ApiConfig?: unknown };
    if (!o.vfsPersistentes) {
      g.sqlite3ApiConfig = { disable: { vfs: { kvvfs: true, opfs: true, 'opfs-vfs': true, 'opfs-sahpool': true, 'opfs-wl': true } } };
    }
    try { return await iniciarModulo(m); } finally { if (!o.vfsPersistentes) delete g.sqlite3ApiConfig; }
  };
  const puentes = o.puentes;
  if (!puentes) return iniciar(modulo);
  const s3 = await conPuentes(puentes, () => iniciar(modulo));
  // Las instalaciones posteriores (callbacks) también pasan por los puentes.
  const w = s3.wasm as unknown as { jsFuncToWasm: (f: unknown, firma: unknown) => unknown };
  const original = w.jsFuncToWasm;
  w.jsFuncToWasm = (f: unknown, firma: unknown) => conPuentesSync(puentes, () => original(f, firma));
  return s3;
}

// ---------------------------------------------------------------------------
// Puentes precompilados
// ---------------------------------------------------------------------------

/**
 * Bytes del puente que genera `jsFuncToWasm` para una firma de solo i32
 * (`resultado` «i» o «v», `n` parámetros). Son siempre los mismos: por eso se
 * pueden compilar de antemano (`wasm/puentes/*.wasm`).
 */
export function bytesPuente(resultado: 'i' | 'v', n: number): Uint8Array {
  const c = [1, 96, n, ...new Array<number>(n).fill(0x7f)];
  if (resultado === 'v') c.push(0);
  else c.push(1, 0x7f);
  c.unshift(c.length);
  c.unshift(0, 97, 115, 109, 1, 0, 0, 0, 1);
  c.push(2, 7, 1, 1, 101, 1, 102, 0, 0, 7, 5, 1, 1, 102, 0, 0);
  return new Uint8Array(c);
}

/** «i3», «v0»… si los bytes son un puente de solo i32; null si no. */
export function clavePuente(fuente: BufferSource): string | null {
  const b = fuente instanceof Uint8Array ? fuente : ArrayBuffer.isView(fuente) ? new Uint8Array(fuente.buffer, fuente.byteOffset, fuente.byteLength) : new Uint8Array(fuente);
  if (b.length > 64 || b[8] !== 1 || b[11] !== 0x60) return null;
  const n = b[12] as number;
  for (let i = 0; i < n; i++) if (b[13 + i] !== 0x7f) return null;
  const nr = b[13 + n];
  const clave = nr === 0 ? `v${n}` : nr === 1 && b[14 + n] === 0x7f ? `i${n}` : null;
  if (!clave) return null;
  const esperado = bytesPuente(clave[0] as 'i' | 'v', n);
  if (esperado.length !== b.length) return null;
  for (let i = 0; i < b.length; i++) if (esperado[i] !== b[i]) return null;
  return clave;
}

type ConstructorModulo = typeof WebAssembly.Module;

function sustituirModulo(puentes: Record<string, WebAssembly.Module>): () => void {
  const W = WebAssembly as unknown as { Module: ConstructorModulo };
  const Original = W.Module;
  const Sustituto = function (this: unknown, fuente: BufferSource) {
    const clave = clavePuente(fuente);
    const m = clave ? puentes[clave] : undefined;
    return m ?? new Original(fuente);
  } as unknown as ConstructorModulo;
  Object.setPrototypeOf(Sustituto, Original);
  (Sustituto as unknown as { prototype: unknown }).prototype = Original.prototype;
  W.Module = Sustituto;
  return () => { W.Module = Original; };
}

async function conPuentes<T>(puentes: Record<string, WebAssembly.Module>, fn: () => Promise<T>): Promise<T> {
  const restaurar = sustituirModulo(puentes);
  try { return await fn(); } finally { restaurar(); }
}

function conPuentesSync<T>(puentes: Record<string, WebAssembly.Module>, fn: () => T): T {
  const restaurar = sustituirModulo(puentes);
  try { return fn(); } finally { restaurar(); }
}
