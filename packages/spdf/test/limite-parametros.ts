/**
 * Preparación de las pruebas: el puerto sqlite-wasm falla, como D1 y los
 * Durable Objects, si una sentencia pasa de 100 parámetros. Así una lista
 * `IN (?, ?, …)` sin trocear no llega a producción.
 */
import { comprobarParametros, type ValorSQL } from '@scholaris/nucleo';
import { SqlWasm } from '../src/puerto.js';

const original = SqlWasm.prototype.ejecutarSync;
SqlWasm.prototype.ejecutarSync = function <T>(this: SqlWasm, consulta: string, parametros: readonly ValorSQL[] = []): T[] {
  comprobarParametros(consulta, parametros);
  return original.call(this, consulta, parametros) as T[];
};
