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

export class ErrorPresupuesto extends Error {
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
    esReintentable: (e) => !/bloquead|PROHIBITED|SAFETY|presupuesto|no acepta/i.test(e instanceof Error ? e.message : String(e)),
  });
  const u = acumulado.uso;
  u.tokensEntrada += r.uso.tokensEntrada; u.tokensSalida += r.uso.tokensSalida; u.usd += r.uso.usd; u.ms += r.uso.ms; u.llamadas += r.uso.llamadas;
  if (r.uso.modelo && !u.modelo.split('+').includes(r.uso.modelo)) u.modelo = [u.modelo, r.uso.modelo].filter(Boolean).join('+');
  return r.json;
}
