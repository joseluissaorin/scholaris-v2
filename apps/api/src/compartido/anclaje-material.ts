/**
 * El anclaje material sobre la plataforma (docs/COMPRENSION.md, principio 1): la
 * región de un pasaje en la imagen de su página, para las pruebas de las fichas de
 * la comprensión y para las citas de Investigar. Envuelve `crearAnclador`
 * (percepcion.ts): las líneas de la capa de texto del paquete se cargan una vez por
 * instancia (un PDF digital no cuesta nada) y lo escaneado lo localiza Gemini 3.8
 * Flash («alta», lo que midió percepción: unos 3,5 s y 0,001 $ por cita) con un
 * contador propio, para que quien lo pide sepa lo que ha gastado. Las
 * localizaciones se guardan en el almacén (`<prefijo>percepcion/anclaje/…`): la
 * misma cita no se paga dos veces.
 */
import type { AnclajeMaterialDocumento } from '@scholaris/ingesta';
import type { SQL } from '@scholaris/nucleo';
import { ContadorUso, crearGemini, MODELOS_GEMINI, type ConfigGemini } from '@scholaris/proveedores';
import type { AlmacenAmpliado } from '../puertos.js';
import { crearAnclador } from './percepcion.js';

/** Lo que usa el anclaje del almacén: leer el paquete y las imágenes, y guardar la caché. */
export type AlmacenAnclaje = Pick<AlmacenAmpliado, 'bytes' | 'obtener' | 'poner'>;

export const prefijoAnclaje = (usuario: string, documento: string) => `u/${usuario}/d/${documento}/`;

/** El almacén, si sirve para anclar (las pruebas montan almacenes con solo `bytes`). */
export function almacenAnclaje(a: Partial<AlmacenAnclaje>): AlmacenAnclaje | null {
  return typeof a.bytes === 'function' && typeof a.obtener === 'function' && typeof a.poner === 'function' ? (a as AlmacenAnclaje) : null;
}

/**
 * El anclaje material de un documento. Sin clave de Gemini, solo por la capa de
 * texto. Uno por paso o por investigación: `uso()` es lo que ha gastado este.
 */
export function anclajeMaterial(d: { almacen: AlmacenAnclaje; sql: SQL; gemini?: ConfigGemini }, doc: { documento: string; prefijo: string }): AnclajeMaterialDocumento {
  const contador = new ContadorUso();
  const redactor = d.gemini?.clave ? crearGemini({ ...d.gemini, contador, timeoutMs: 90_000, intentos: 2 }).redactor() : undefined;
  const anclar = crearAnclador({ almacen: d.almacen as AlmacenAmpliado, sql: d.sql, ...(redactor ? { redactor } : {}) }, doc);
  return {
    async region(orden, o) {
      const r = await anclar(orden, {
        ...(o.caracteres ? { caracteres: o.caracteres } : {}), ...(o.cita ? { cita: o.cita } : {}), vision: !!redactor && o.vision !== false,
      });
      return r.ancla.region;
    },
    uso() {
      const t = contador.total();
      return { modelo: t.llamadas ? MODELOS_GEMINI.redactorAlto : '', tokensEntrada: t.tokensEntrada, tokensSalida: t.tokensSalida, usd: t.usd, ms: t.ms, llamadas: t.llamadas };
    },
  };
}
