/**
 * El resaltado llega de la API como HTML con <mark>. Se escapa todo y solo se
 * devuelven las marcas: ningún HTML del corpus llega a ejecutarse.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

import { textoLimpio } from './texto';

export function htmlSeguro(html: string): string {
  return textoLimpio(html).replace(/[&<>"']/g, (c) => ESC[c]!).replace(/&lt;(\/?)mark&gt;/g, '<$1mark>');
}

export function Resaltado({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: htmlSeguro(html) }} />;
}

/** Resalta términos en texto plano (para el lector, con `?q=`). */
export function resaltarTerminos(texto: string, q?: string): string {
  const base = texto.replace(/[&<>"']/g, (c) => ESC[c]!);
  if (!q) return base;
  const raices = q.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 3).map((t) => t.slice(0, Math.max(4, t.length - 2)));
  if (!raices.length) return base;
  return base.replace(/[\p{L}\p{M}]+/gu, (w) => {
    const n = w.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    return raices.some((r) => n.startsWith(r)) ? `<mark>${w}</mark>` : w;
  });
}

/** HTML de una referencia CSL: solo cursivas, negritas, versalitas y enlaces sin script. */
export function htmlSeguroReferencia(html: string): string {
  // Fuera los contenedores de citeproc (div.csl-entry, spans sin estilo) antes de escapar.
  const limpio = html.replace(/<\/?div[^>]*>/g, '').replace(/<span(?![^>]*small-caps)[^>]*>([\s\S]*?)<\/span>/g, '$1');
  const escapado = limpio.replace(/[&<>"']/g, (c) => ESC[c]!);
  return escapado
    .replace(/&lt;(\/?)(i|em|b|strong|sup|sub)&gt;/g, '<$1$2>')
    .replace(/&lt;span style=&quot;font-variant:\s*small-caps;?&quot;&gt;/g, '<span style="font-variant:small-caps">')
    .replace(/&lt;\/span&gt;/g, '</span>');
}
