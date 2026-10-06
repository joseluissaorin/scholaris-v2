/**
 * Límite de parámetros por sentencia. D1 y la SQLite de los Durable Objects
 * admiten como mucho 100 parámetros enlazados en una sentencia («too many SQL
 * variables»). Las listas de longitud variable van como un único parámetro
 * JSON (`IN (SELECT value FROM json_each(?))`) y las inserciones de varias
 * filas se trocean para que filas × columnas no pase de 99.
 */
import type { SQL, ValorSQL } from './puertos.js';

export const MAX_PARAMETROS_SQL = 100;

/**
 * Lista para `IN` con un solo parámetro, sea cual sea su longitud:
 * `const l = enLista(ids); sql.ejecutar(\`… WHERE id IN ${l.sql}\`, l.param)`.
 */
export function enLista(valores: readonly (string | number)[]): { sql: string; param: string } {
  return { sql: '(SELECT value FROM json_each(?))', param: JSON.stringify(valores) };
}

/** Falla como D1 o un Durable Object si una sentencia pasa de `max` parámetros. */
export function comprobarParametros(consulta: string, parametros: readonly unknown[], max = MAX_PARAMETROS_SQL): void {
  if (parametros.length > max) {
    throw new Error(`too many SQL variables: ${parametros.length} parámetros (máximo ${max}) en «${consulta.replace(/\s+/g, ' ').slice(0, 160)}»`);
  }
}

/**
 * Envuelve un puerto SQL para que falle como D1 o un Durable Object si una
 * sentencia pasa de `max` parámetros. Para las pruebas: así una regresión no
 * llega a producción.
 */
export function sqlConLimite<S extends SQL>(sql: S, max = MAX_PARAMETROS_SQL): S {
  const envueltos = new WeakMap<object, unknown>();
  const envolver = <T extends SQL>(s: T): T => {
    const ya = envueltos.get(s);
    if (ya) return ya as T;
    const proxy: T = new Proxy(s, {
      get(objetivo, clave) {
        const v = Reflect.get(objetivo, clave, objetivo) as unknown;
        if (typeof v !== 'function') return v;
        if (clave === 'ejecutar') {
          return async (consulta: string, ...p: ValorSQL[]) => { comprobarParametros(consulta, p, max); return objetivo.ejecutar(consulta, ...p); };
        }
        if (clave === 'ejecutarSync') {
          return (consulta: string, p: readonly ValorSQL[] = []) => { comprobarParametros(consulta, p, max); return (v as (c: string, p: readonly ValorSQL[]) => unknown).call(objetivo, consulta, p); };
        }
        if (clave === 'transaccion') {
          return <R>(fn: (tx: SQL) => Promise<R>) => objetivo.transaccion((tx) => fn(tx === objetivo ? proxy : envolver(tx)));
        }
        if (clave === 'lote') {
          return (sentencias: Array<{ consulta: string; parametros: ValorSQL[] }>) => {
            for (const s2 of sentencias) comprobarParametros(s2.consulta, s2.parametros, max);
            return (v as (x: unknown) => unknown).call(objetivo, sentencias);
          };
        }
        return (v as (...a: unknown[]) => unknown).bind(objetivo);
      },
    });
    envueltos.set(s, proxy);
    return proxy;
  };
  return envolver(sql);
}
