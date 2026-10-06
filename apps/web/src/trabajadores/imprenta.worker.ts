/// <reference lib="webworker" />
/**
 * La imprenta en su propio hilo: recibe un archivo, llama a `convertir()` de
 * `@scholaris/imprenta` y reenvía cada evento al hilo principal, transfiriendo
 * los bytes de las partes (sin copiarlos).
 *
 * Si la imprenta no puede cargarse (navegador sin módulos en hilos, por
 * ejemplo), el hilo responde «no_disponible» y la conversión la hace el servidor.
 */
import type { ArchivoEntrada, EventoConversion, OpcionesConversion } from '@scholaris/imprenta';


export type MensajeHaciaImprenta =
  | { tipo: 'convertir'; archivo: ArchivoEntrada; fotos?: ArchivoEntrada[] }
  | { tipo: 'cancelar' };

export type MensajeDesdeImprenta =
  | { tipo: 'evento'; evento: EventoConversion }
  | { tipo: 'no_disponible' }
  | { tipo: 'fallo'; mensaje: string }
  | { tipo: 'hecho' };

const ambito = self as unknown as DedicatedWorkerGlobalScope;
const control = new AbortController();

ambito.onmessage = async (ev: MessageEvent<MensajeHaciaImprenta>) => {
  const m = ev.data;
  if (m.tipo === 'cancelar') { control.abort(); return; }
  let mod: typeof import('@scholaris/imprenta/navegador');
  try { mod = await import('@scholaris/imprenta/navegador'); }
  catch { ambito.postMessage({ tipo: 'no_disponible' } satisfies MensajeDesdeImprenta); return; }
  try {
    mod.configurarImprenta({ recursosPdfjs: '/pdfjs/' });
    const opciones: OpcionesConversion = { senal: control.signal, ...(m.fotos ? { fotos: m.fotos, tipo: 'fotos' as const } : {}) };
    for await (const e of mod.convertir(m.archivo, opciones)) {
      if (e.tipo === 'parte') ambito.postMessage({ tipo: 'evento', evento: e } satisfies MensajeDesdeImprenta, [e.datos.buffer as ArrayBuffer]);
      else ambito.postMessage({ tipo: 'evento', evento: e } satisfies MensajeDesdeImprenta);
    }
    ambito.postMessage({ tipo: 'hecho' } satisfies MensajeDesdeImprenta);
  } catch (err) {
    ambito.postMessage({ tipo: 'fallo', mensaje: err instanceof Error ? err.message : String(err) } satisfies MensajeDesdeImprenta);
  }
};
