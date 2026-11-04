/**
 * Adaptadores del puerto `ModeloComprension`. La plataforma monta el de Gemini
 * (apps/api, con coste medido); aquí está el que envuelve un Redactor cualquiera
 * (pruebas, montajes sin Gemini) y la llamada con reintento y control de gasto.
 */
import { reintentar, type Redactor } from '@scholaris/nucleo';
import type { ModeloComprension, PeticionComprension, UsoModelo } from './tipos.js';

/** Un Redactor como modelo de comprensión: «alta» y «rapida» pasan tal cual; el coste no se mide. */
export function modeloDesdeRedactor(redactor: Redactor, nombres: { alta?: string; rapida?: string } = {}): ModeloComprension {
  return {
    nombre: `redactor:${redactor.nombre}`,
    modelo: (c) => (c === 'alta' ? nombres.alta ?? `${redactor.nombre}:alta` : nombres.rapida ?? `${redactor.nombre}:rapida`),
    async generar<T>(p: PeticionComprension): Promise<{ json: T; uso: UsoModelo }> {
      const t0 = Date.now();
      const partes: Array<{ texto: string } | { bytes: Uint8Array; mime: string }> = [];
      for (const x of p.partes) {
        if ('texto' in x) partes.push({ texto: x.texto });
        else if ('bytes' in x) partes.push({ bytes: x.bytes, mime: x.mime });
      }
      const r = await redactor.generar<T>({
        sistema: p.sistema, mensajes: [{ rol: 'usuario', partes }], esquema: p.esquema, calidad: p.calidad,
        ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
      });
      const json = r.json ?? (JSON.parse(r.texto) as T);
      return { json, uso: { modelo: this.modelo(p.calidad), tokensEntrada: 0, tokensSalida: 0, usd: 0, ms: Date.now() - t0, llamadas: 1 } };
    },
  };
}

export class ErrorPresupuestoComprension extends Error {
  constructor(public readonly gastado: number, public readonly tope: number) {
    super(`La comprensión de este documento ha llegado a su presupuesto (${gastado.toFixed(2)} de ${tope.toFixed(2)} USD).`);
  }
}

/**
 * Llama al modelo con reintentos (los fallos de red y de JSON se reintentan; un
 * bloqueo por seguridad no) y suma el uso en `acumulado`.
 */
export async function llamar<T>(modelo: ModeloComprension, p: PeticionComprension, acumulado: { uso: UsoModelo }): Promise<T> {
  const r = await reintentar(async () => modelo.generar<T>(p), {
    intentos: 3, base: 2000,
    esReintentable: (e) => !/bloquead|PROHIBITED|SAFETY|presupuesto|no acepta|MAX_TOKENS|cortada|sin respuesta para|plazo/i.test(e instanceof Error ? e.message : String(e)),
  });
  const u = acumulado.uso;
  u.tokensEntrada += r.uso.tokensEntrada; u.tokensSalida += r.uso.tokensSalida; u.usd += r.uso.usd; u.ms += r.uso.ms; u.llamadas += r.uso.llamadas;
  if (r.uso.modelo && !u.modelo.split('+').includes(r.uso.modelo)) u.modelo = [u.modelo, r.uso.modelo].filter(Boolean).join('+');
  return r.json;
}

/** Se acabó el plazo del paso: no se reintenta dentro de él (el Workflow decide). */
export class ErrorPlazo extends Error {
  constructor(public readonly paso: string, public readonly operacion: string) {
    super(`Se acabó el plazo del paso «${paso}» antes de ${operacion}: se reintentará el paso.`);
    this.name = 'ErrorPlazo';
  }
}

/** Margen que se deja al paso para escribir lo hecho después de la última llamada. */
export const MARGEN_PASO_MS = 20_000;

/**
 * El modelo tal como lo usa un paso: cada llamada se acota a lo que quede del plazo
 * (`limiteMs`), se apunta en el diario (inicio, fin, tokens, dólares) y, mientras el
 * modelo responde, late cada minuto para el vigilante (es trabajo de verdad, y nunca
 * más allá del plazo). Sin tiempo suficiente para una llamada, `ErrorPlazo`.
 */
export function modeloDelPaso(
  modelo: ModeloComprension,
  o: { documento: string; paso: string; limite?: number; registro?: (r: import('./tipos.js').RegistroComprension) => void; latido?: () => Promise<void> | void; reloj?: () => number },
): ModeloComprension {
  const reloj = o.reloj ?? Date.now;
  return {
    nombre: modelo.nombre,
    modelo: (c) => modelo.modelo(c),
    ...(modelo.precio ? { precio: (c: 'alta' | 'rapida') => modelo.precio!(c) } : {}),
    async generar<T>(p: PeticionComprension) {
      const resto = o.limite ? o.limite - reloj() - MARGEN_PASO_MS : undefined;
      if (resto !== undefined && resto < 15_000) throw new ErrorPlazo(o.paso, p.operacion);
      const limiteMs = resto !== undefined ? Math.min(resto, p.limiteMs ?? resto) : p.limiteMs;
      const sub = `modelo:${p.operacion}`;
      const t0 = reloj();
      o.registro?.({ documento: o.documento, paso: o.paso, sub, estado: 'inicio', modelo: modelo.modelo(p.calidad), ...(limiteMs ? { detalle: { limiteMs } } : {}) });
      const latiendo = o.latido ? setInterval(() => { void Promise.resolve(o.latido!()).catch(() => undefined); }, 60_000) : null;
      try {
        await o.latido?.();
        const r = await modelo.generar<T>({ ...p, ...(limiteMs ? { limiteMs } : {}) });
        o.registro?.({ documento: o.documento, paso: o.paso, sub, estado: 'fin', ms: reloj() - t0, modelo: r.uso.modelo, tokensEntrada: r.uso.tokensEntrada, tokensSalida: r.uso.tokensSalida, usd: Math.round(r.uso.usd * 1e5) / 1e5 });
        return r;
      } catch (e) {
        o.registro?.({ documento: o.documento, paso: o.paso, sub, estado: 'error', ms: reloj() - t0, detalle: { error: ((e as Error)?.message || String(e)).slice(0, 300) } });
        throw e;
      } finally {
        if (latiendo) clearInterval(latiendo);
        await Promise.resolve(o.latido?.()).catch(() => undefined);
      }
    },
  };
}
