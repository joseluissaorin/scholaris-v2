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
 *   de ejecución; hay que importar el .wasm como módulo (wrangler lo compila al
 *   desplegar) y pasarlo antes del primer uso:
 *
 *   ```ts
 *   import wasm from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
 *   configurarMotor({ moduloWasm: wasm });
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
  const iniciar = sqlite3InitModule as unknown as (m: Record<string, unknown>) => Promise<MotorSqlite>;
  return iniciar(modulo);
}
