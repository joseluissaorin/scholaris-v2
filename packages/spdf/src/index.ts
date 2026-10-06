/**
 * @scholaris/spdf: el formato SPDF 4.0.
 *
 * Un .spdf es una base SQLite comprimida con gzip que contiene un documento
 * leído y citable: unidades con su ancla, fragmentos con su contexto, figuras,
 * vectores de uno o varios espacios, blobs y procedencia. Funciona en el
 * navegador, en Workers y en Node (sqlite-wasm oficial, con FTS5).
 */

export * from './esquema.js';
export * from './motor.js';
export * from './puerto.js';
export * from './vectores.js';
export * from './repositorio.js';
export * from './archivo.js';
export * from './migrar-v3.js';
export * from './limpieza.js';
