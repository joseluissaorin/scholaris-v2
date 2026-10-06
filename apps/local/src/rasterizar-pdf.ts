/**
 * PDF → imágenes de página (JPEG) para el lector de visión local: los modelos
 * de visión y lenguaje (Qwen2.5-VL, Qwen3-VL, MiniCPM-V) leen imágenes, no PDF.
 * Usa pdf.js y @napi-rs/canvas, los mismos de la imprenta de Node: sin red.
 */
import { plataformaNode } from '@scholaris/imprenta/node';

/** Lado mayor de la página en píxeles. 1600 deja legibles las notas a pie y no dispara los tokens de imagen. */
export const LADO_LECTURA = 1600;

export function crearRasterizador(o: { lado?: number; calidad?: number } = {}) {
  const lado = o.lado ?? LADO_LECTURA;
  const calidad = o.calidad ?? 0.85;
  return async (pdf: Uint8Array): Promise<Array<{ bytes: Uint8Array; mime: string }>> => {
    const { lib, parametros } = await plataformaNode.pdfjs();
    const doc = await lib.getDocument({ ...parametros, data: pdf.slice() } as Parameters<typeof lib.getDocument>[0]).promise;
    try {
      const salida: Array<{ bytes: Uint8Array; mime: string }> = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pagina = await doc.getPage(i);
        const base = pagina.getViewport({ scale: 1 });
        const vp = pagina.getViewport({ scale: lado / Math.max(base.width, base.height) });
        const ancho = Math.max(1, Math.round(vp.width)), alto = Math.max(1, Math.round(vp.height));
        const lienzo = plataformaNode.crearLienzo(ancho, alto);
        lienzo.ctx.fillStyle = '#ffffff';
        lienzo.ctx.fillRect(0, 0, ancho, alto);
        await pagina.render({ canvas: lienzo.nativo, canvasContext: lienzo.ctx, viewport: vp, annotationMode: 0 } as never).promise;
        salida.push({ bytes: await plataformaNode.aJpeg(lienzo, calidad), mime: 'image/jpeg' });
        pagina.cleanup();
      }
      return salida;
    } finally {
      await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
      await doc.cleanup?.();
    }
  };
}
