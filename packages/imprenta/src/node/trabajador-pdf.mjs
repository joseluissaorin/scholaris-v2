// Trabajador de rasterizado en Node (worker_threads). Es JavaScript para poder
// arrancar sin cargador: registra tsx y carga el núcleo en TypeScript.
import { parentPort } from 'node:worker_threads';

try {
  const { register } = await import('tsx/esm/api');
  register();
  await import('./trabajador-pdf-nucleo.ts');
} catch (e) {
  parentPort?.postMessage({ error: String(e?.stack ?? e) });
}
