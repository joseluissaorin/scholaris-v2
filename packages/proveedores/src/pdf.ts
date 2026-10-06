/**
 * Cortar un PDF en trozos sin salir de JavaScript puro (pdf-lib), para partir
 * un pliego cuando la respuesta del modelo no cabe. Se importa bajo demanda:
 * quien nunca parte un pliego no carga pdf-lib.
 */

/** Número de páginas de un PDF. */
export async function contarPaginasPdf(pdf: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/** Copia las páginas [desde, hasta) (índices desde 0) a un PDF nuevo. */
export async function cortarPdf(pdf: Uint8Array, desde: number, hasta: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const origen = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  const destino = await PDFDocument.create();
  const indices = Array.from({ length: Math.max(0, Math.min(hasta, origen.getPageCount()) - desde) }, (_, i) => desde + i);
  const paginas = await destino.copyPages(origen, indices);
  for (const p of paginas) destino.addPage(p);
  return destino.save({ useObjectStreams: true });
}

/** Parte un PDF en pliegos de `tam` páginas. */
export async function pliegosPdf(pdf: Uint8Array, tam: number): Promise<Array<{ pdf: Uint8Array; primeraFisica: number; paginas: number }>> {
  const total = await contarPaginasPdf(pdf);
  const salida: Array<{ pdf: Uint8Array; primeraFisica: number; paginas: number }> = [];
  for (let i = 0; i < total; i += tam) {
    const hasta = Math.min(total, i + tam);
    salida.push({ pdf: await cortarPdf(pdf, i, hasta), primeraFisica: i + 1, paginas: hasta - i });
  }
  return salida;
}
