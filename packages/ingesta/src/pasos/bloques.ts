/**
 * Documentos con estructura propia (DOCX, EPUB, HTML, Markdown, diapositivas,
 * hojas, web): no hace falta leer nada con visión, el texto ya está. Cada bloque
 * es una unidad con su ancla exacta (sección y párrafo, folio del EPUB si lo hay,
 * diapositiva, rango de filas).
 */

import type { Ancla } from '@scholaris/nucleo';
import type { PaqueteConversion } from '@scholaris/imprenta';
import type { UnidadLeida } from '../tipos.js';

const base = (orden: number, texto: string, ancla: Ancla, lector: string): UnidadLeida => ({
  orden, fisica: orden + 1, texto, notas: [], cabecera: '', pie: '', folioVisto: null, titulos: [], figuras: [], vacia: !texto.trim(), lector, confianza: 1, ancla,
});

export function unidadesDeBloques(paquete: PaqueteConversion): UnidadLeida[] {
  const c = paquete.contenido;
  if (c.clase === 'presentacion') {
    return c.diapositivas.map((d, i) => base(i, [d.titulo && `# ${d.titulo}`, d.texto, d.notas && `Notas del orador: ${d.notas}`].filter(Boolean).join('\n\n'), { tipo: 'diapositiva', n: d.n }, 'presentacion'));
  }
  if (c.clase === 'hoja') {
    const salida: UnidadLeida[] = [];
    for (const h of c.hojas) for (const t of h.tramos) salida.push(base(salida.length, `# ${h.nombre}\n\n${t.markdown}`, { tipo: 'hoja', hoja: h.nombre, filaDesde: t.filaDesde, filaHasta: t.filaHasta }, 'hoja'));
    return salida;
  }
  if (c.clase !== 'documento' && c.clase !== 'web') return [];
  const notas = c.clase === 'documento' ? new Map(c.notas.map((n) => [n.id, n.texto])) : new Map<string, string>();
  return c.bloques.map((b, i) => {
    let texto = b.tipo === 'titulo' ? `${'#'.repeat(Math.min(6, b.nivel ?? 1))} ${b.texto}` : b.texto;
    const susNotas = (b.notas ?? []).filter((id) => notas.has(id));
    for (const id of susNotas) if (!texto.includes(`[^${id}]`)) texto += `[^${id}]`;
    const ancla: Ancla = c.clase === 'web'
      ? { tipo: 'web', url: c.url, ruta: b.ruta, parrafo: b.parrafo, consultada: c.consultada }
      : { tipo: 'seccion', ruta: b.ruta, parrafo: b.parrafo, ...(b.impresa !== undefined ? { impresa: b.impresa } : {}) };
    const u = base(i, texto, ancla, c.clase === 'web' ? 'web' : c.formato);
    u.notas = susNotas.map((id) => `[^${id}]: ${notas.get(id)}`);
    if (b.tipo === 'titulo') u.titulos = [{ nivel: b.nivel ?? 1, texto: b.texto }];
    return u;
  });
}
