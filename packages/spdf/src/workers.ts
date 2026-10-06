/**
 * Arranque del motor SQLite en Cloudflare Workers (workerd).
 *
 * workerd no compila WebAssembly en tiempo de ejecución, así que todo llega ya
 * compilado como módulo (regla «CompiledWasm» de wrangler, activa por defecto
 * para `*.wasm`): el propio `sqlite3.wasm` y los puentes JS→wasm que
 * sqlite-wasm necesita al arrancar (ver `motor.ts`).
 *
 * ```ts
 * import { prepararMotorWorkers } from '@scholaris/spdf/workers';
 * prepararMotorWorkers();            // una vez, al cargar el Worker
 * const spdf = await crearSpdf();    // y a partir de aquí, como en cualquier sitio
 * ```
 *
 * No importar desde Node ni desde el navegador: allí no hace falta.
 */

import sqlite3 from '@sqlite.org/sqlite-wasm/sqlite3.wasm';
import i0 from '../wasm/puentes/i0.wasm';
import i1 from '../wasm/puentes/i1.wasm';
import i2 from '../wasm/puentes/i2.wasm';
import i3 from '../wasm/puentes/i3.wasm';
import i4 from '../wasm/puentes/i4.wasm';
import i5 from '../wasm/puentes/i5.wasm';
import i6 from '../wasm/puentes/i6.wasm';
import v0 from '../wasm/puentes/v0.wasm';
import v1 from '../wasm/puentes/v1.wasm';
import v2 from '../wasm/puentes/v2.wasm';
import v3 from '../wasm/puentes/v3.wasm';
import v4 from '../wasm/puentes/v4.wasm';
import v5 from '../wasm/puentes/v5.wasm';
import v6 from '../wasm/puentes/v6.wasm';
import { configurarMotor, type OpcionesMotor } from './motor.js';

export const PUENTES: Record<string, WebAssembly.Module> = { i0, i1, i2, i3, i4, i5, i6, v0, v1, v2, v3, v4, v5, v6 };

let preparado = false;

/** Configura el motor para workerd. Se puede llamar varias veces. */
export function prepararMotorWorkers(extra: Omit<OpcionesMotor, 'moduloWasm' | 'puentes'> = {}): void {
  if (preparado) return;
  configurarMotor({ ...extra, moduloWasm: sqlite3, puentes: PUENTES });
  preparado = true;
}
