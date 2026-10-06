/**
 * El resaltado llega de la API como HTML con <mark>. Se escapa todo y solo se
 * devuelven las marcas: ningún HTML del corpus llega a ejecutarse.
 */
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function htmlSeguro(html: string): string {
  return html.replace(/[&<>"']/g, (c) => ESC[c]!).replace(/&lt;(\/?)mark&gt;/g, '<$1mark>');
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
