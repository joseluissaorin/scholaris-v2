/**
 * La imprenta en el navegador. Llámala DENTRO de un Web Worker dedicado:
 *
 *   import { convertir, configurarImprenta } from '@scholaris/imprenta/navegador';
 *   configurarImprenta({ recursosPdfjs: '/pdfjs/' });
 *   for await (const e of convertir({ nombre, bytes })) postMessage(e, e.tipo === 'parte' ? [e.datos.buffer] : []);
 *
 * Ella misma crea los trabajadores anidados que rasterizan las páginas.
 */

import { crearConvertidor } from '../convertir.js';
import { plataformaNavegador } from './plataforma-navegador.js';

export { configurarImprenta, plataformaNavegador, type ConfiguracionImprenta } from './plataforma-navegador.js';
export * from '../index.js';

export const convertir = crearConvertidor(plataformaNavegador);
