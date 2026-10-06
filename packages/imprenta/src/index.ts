/**
 * @scholaris/imprenta: cualquier archivo → `PaqueteConversion`.
 * Este punto de entrada no depende de la plataforma; `convertir` vive en
 * `@scholaris/imprenta/navegador` y `@scholaris/imprenta/node`.
 */
export * from './tipos.js';
export { abrirCortador, cortarPdf, planPliegos, type CortadorPdf } from './pdf/cortar.js';
export { crearConvertidor, recolectar, type Convertir } from './convertir.js';
export { detectar, compararNombres, type Deteccion, type Formato } from './detectar.js';
export type { Plataforma, Lienzo, MotorPdf } from './plataforma.js';
export { diagnosticar, construirCapa, detectarTitulillos } from './pdf/capa-texto.js';
