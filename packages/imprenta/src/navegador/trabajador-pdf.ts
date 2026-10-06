/// <reference lib="webworker" />
/**
 * Trabajador de páginas del navegador: abre su copia del PDF con pdf.js (en
 * este mismo hilo) y rasteriza las páginas que le piden con OffscreenCanvas.
 */

import { procesarPaginaCruda, type OpcionesPaginaCruda, type PaginaCruda } from '../pdf/pagina-cruda.js';
import { configurarImprenta, parametrosPdfjsNavegador, pdfjsNavegador, plataformaNavegador } from './plataforma-navegador.js';

type Mensaje =
  | { tipo: 'abrir'; bytes: Uint8Array; recursosPdfjs: string }
  | { tipo: 'pagina'; id: number; fisica: number; op: OpcionesPaginaCruda };

const ambito = self as unknown as DedicatedWorkerGlobalScope;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let doc: any = null;
let lib: Awaited<ReturnType<typeof pdfjsNavegador>> | null = null;
let cola: Promise<void> = Promise.resolve();

function transferibles(c: PaginaCruda): ArrayBuffer[] {
  return [c.jpeg?.bytes, c.miniatura?.bytes, ...c.figuras.map((f) => f.imagen.bytes)]
    .filter((b): b is Uint8Array => Boolean(b) && b!.byteOffset === 0 && b!.byteLength === b!.buffer.byteLength)
    .map((b) => b.buffer as ArrayBuffer);
}

ambito.addEventListener('message', (e: MessageEvent<Mensaje>) => {
  const m = e.data;
  if (m.tipo === 'abrir') {
    (async () => {
      try {
        configurarImprenta({ recursosPdfjs: m.recursosPdfjs });
        lib = await pdfjsNavegador();
        doc = await lib.getDocument({ ...parametrosPdfjsNavegador(), data: m.bytes }).promise;
        ambito.postMessage({ listo: true });
      } catch (err) {
        ambito.postMessage({ error: String((err as Error)?.stack ?? err) });
      }
    })();
    return;
  }
  // Una página a la vez por trabajador (el paralelismo lo dan los trabajadores).
  cola = cola.then(async () => {
    try {
      if (!doc || !lib) throw new Error('Documento sin abrir');
      const cruda = await procesarPaginaCruda(plataformaNavegador, lib as unknown as { OPS: Record<string, number> }, doc, m.fisica, m.op);
      ambito.postMessage({ id: m.id, cruda }, transferibles(cruda));
    } catch (err) {
      ambito.postMessage({ id: m.id, error: String((err as Error)?.stack ?? err) });
    }
  });
});
