/**
 * Lo que costaría comprender un documento, antes de pedirlo. La API todavía no
 * estima la comprensión, así que se calcula aquí con la misma cuenta que hace el
 * flujo al planificar (packages/ingesta/src/comprension/flujo.ts): tokens del
 * material, tandas de fichas de unos 9000 tokens, y estructura, fichas,
 * entidades, personajes y ficha global con los precios de los modelos
 * (packages/proveedores/src/precios.ts). El tamaño del material se aproxima por
 * las páginas o los minutos, así que es una cifra orientativa: se dice siempre
 * «unos» y nunca se cobra por ella.
 */
import type { TipoEntrada } from '@scholaris/nucleo';

/** Dólares por millón de tokens (entrada, salida). Gemini 4 Argon dobla su precio el 1-12-2026. */
export function preciosComprension(ahora = Date.now()): { alta: [number, number]; rapida: [number, number] } {
  const doble = ahora >= Date.UTC(2026, 11, 1);
  return { alta: doble ? [4, 20] : [2, 10], rapida: [0.75, 3.75] };
}

/** Caracteres aproximados del material que lee la comprensión (texto, o transcripción y percepción en los medios). */
export function caracteresAproximados(d: { tipo: TipoEntrada; unidades: number; duracion?: number }): number {
  switch (d.tipo) {
    // Unas 15 letras por segundo de voz; en vídeo, la percepción (planos, escenas) añade otro tanto.
    case 'video': return Math.round((d.duracion ?? d.unidades * 50) * 15 * 1.7);
    case 'audio': return Math.round((d.duracion ?? d.unidades * 50) * 15 * 1.1);
    case 'epub': case 'web': case 'documento': return d.unidades * 1500;
    case 'presentacion': return d.unidades * 500;
    case 'hoja': return d.unidades * 3000;
    case 'imagen': return Math.max(1, d.unidades) * 1200;
    default: return d.unidades * 2200;
  }
}

/** El presupuesto por documento del flujo: si se pasa, sigue con el modelo rápido (y apenas gasta más). */
export const PRESUPUESTO_COMPRENSION = 4;

/** Dólares aproximados de comprender un documento (con una lente; `economico`, solo el modelo rápido). */
export function estimarComprension(d: { tipo: TipoEntrada; unidades: number; duracion?: number }, o: { economico?: boolean; lentes?: number; ahora?: number } = {}): number {
  const caracteres = caracteresAproximados(d);
  const tokens = Math.ceil(caracteres / 3.6);
  const largo = caracteres <= 2_400_000;
  const lotes = Math.max(1, Math.ceil(tokens / 9000));
  const p = preciosComprension(o.ahora);
  const precio = o.economico ? p.rapida : p.alta;
  const coste = (entrada: number, salida: number) => (entrada * precio[0] + salida * precio[1]) / 1e6;
  const total = coste(tokens, 12_000)
    + coste((largo ? tokens : tokens / lotes + 4000) * lotes * 0.6, 14_000 * lotes)
    // Entidades y, aparte, los personajes y los motivos principales.
    + coste(tokens, 16_000) + coste(tokens * 0.5, 12_000)
    + coste(tokens + 8000 * lotes, 16_000) * Math.max(1, o.lentes ?? 1);
  // Pasado el presupuesto, el resto va con el modelo rápido: el tope es el presupuesto y poco más.
  const conTope = total > PRESUPUESTO_COMPRENSION ? PRESUPUESTO_COMPRENSION + (total - PRESUPUESTO_COMPRENSION) * (p.rapida[1] / precio[1]) : total;
  return Math.round(conTope * 100) / 100;
}

/** «unos 0,85 USD», «menos de 0,05 USD». */
export function dolaresAproximados(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '0 USD';
  if (usd < 0.05) return 'menos de 0,05 USD';
  return `unos ${usd.toFixed(usd < 10 ? 2 : 0).replace('.', ',')} USD`;
}
