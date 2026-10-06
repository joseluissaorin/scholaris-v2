/**
 * @scholaris/folios: el folio impreso de cada página, el corazón de una cita.
 *
 * - `extraerCandidatos`: números de cabecera, pie y bordes del texto.
 * - `deducirFolios`: lógica pura (sin red): cadena coherente de lecturas +
 *   deducción por tramos (romanos, arábigos, transición, láminas, dobles
 *   páginas, foliación).
 * - `elegirConJuez`: lo mismo, preguntando al juez (Jev) las páginas dudosas en
 *   una sola petición por lotes.
 * - `DeductorPaginas`: port fiel de `page_deducer.py` de v3.
 */

export * from './tipos.js';
export * from './candidatos.js';
export * from './secuencia.js';
export * from './deductor.js';
export * from './folios.js';
