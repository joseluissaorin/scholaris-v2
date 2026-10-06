/** Núcleo del trabajador de rasterizado de Node: abre su copia del PDF y procesa páginas. */
import { parentPort, workerData } from 'node:worker_threads';
import { procesarPaginaCruda, type OpcionesPaginaCruda } from '../pdf/pagina-cruda.js';
import { parametrosPdfjsNode, pdfjsNode, plataformaNode } from './plataforma-node.js';

const puerto = parentPort;
if (!puerto) throw new Error('Esto es un trabajador');

const lib = await pdfjsNode();
const bytes = (workerData as { bytes: Uint8Array }).bytes;
const doc = await lib.getDocument({ ...parametrosPdfjsNode(), data: bytes.slice() }).promise;
puerto.postMessage({ listo: true });

puerto.on('message', async (m: { id: number; fisica: number; op: OpcionesPaginaCruda }) => {
  try {
    const cruda = await procesarPaginaCruda(plataformaNode, lib as unknown as { OPS: Record<string, number> }, doc, m.fisica, m.op);
    const transferir: ArrayBuffer[] = [];
    for (const b of [cruda.jpeg?.bytes, cruda.miniatura?.bytes, ...cruda.figuras.map((f) => f.imagen.bytes)]) {
      if (b && b.byteOffset === 0 && b.byteLength === b.buffer.byteLength) transferir.push(b.buffer as ArrayBuffer);
    }
    puerto.postMessage({ id: m.id, cruda }, transferir);
  } catch (e) {
    puerto.postMessage({ id: m.id, error: String((e as Error)?.stack ?? e) });
  }
});
