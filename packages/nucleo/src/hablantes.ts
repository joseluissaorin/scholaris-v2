/**
 * Marcas de hablante de las transcripciones («**Nombre:** lo que dice»).
 *
 * Un fragmento o una ventana de búsqueda puede cortar la marca por la mitad
 * («…Sí, exacto. **Joaquín Sol»): entonces el Markdown sale crudo. Aquí se
 * separan del texto ANTES de recortar, para que cada pantalla las pinte como
 * etiqueta propia y ningún asterisco llegue a la interfaz.
 */

export interface MarcaHablante {
  /** Posición en el texto ya limpio donde empieza el turno. */
  pos: number;
  nombre: string;
}

const SEP = '\u0001';
const COMPLETA = /\*\*([^*\n\u0001]{1,80}?):\*\*[ \t]*/g;
// Cortada por delante: «errano:** Sí…» (el cierre sin su apertura), quizá tras «…».
const CORTADA_INICIO = /^(\s*…\s*)?[^*\n\u0001]{0,80}?:\*\*[ \t]*/;
// Cortada por detrás: «… **Joaquín Sol» o «… **Joaquín Soler Serrano:» (la apertura sin su cierre).
const CORTADA_FINAL = /[ \t]*\*\*[^*\n\u0001]{0,80}?(\s*…)?\s*$/;

const sinEtiquetas = (s: string) => s.replace(/<[^>]*>/g, '').trim();

/**
 * Quita las marcas de hablante (completas o partidas por un corte) y cualquier
 * asterisco suelto, y devuelve dónde empezaba cada turno en el texto limpio.
 * Acepta texto con `<mark>` (el resaltado): los nombres salen sin etiquetas.
 */
export function separarHablantes(texto: string): { texto: string; hablantes: MarcaHablante[] } {
  if (!texto.includes('*')) return { texto, hablantes: [] };
  const nombres: string[] = [];
  let s = texto.replace(COMPLETA, (_m, nombre: string) => { nombres.push(sinEtiquetas(nombre)); return SEP; });
  s = s.replace(CORTADA_INICIO, (_m, puntos?: string) => puntos ?? '');
  s = s.replace(CORTADA_FINAL, (_m, puntos: string | undefined, en: number) => (puntos && !/[.?!…»]$/.test(s.slice(0, en)) ? '…' : ''));
  // Ningún asterisco suelto (negritas o cursivas de Markdown que quedaron cojas).
  s = s.replace(/\*+/g, '');
  const hablantes: MarcaHablante[] = [];
  let limpio = '';
  const partes = s.split(SEP);
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) hablantes.push({ pos: limpio.length, nombre: nombres[i - 1] ?? '' });
    limpio += partes[i];
  }
  // Un turno que empieza justo al final no tiene nada que etiquetar.
  limpio = limpio.replace(/[ \t]+$/, '');
  return { texto: limpio, hablantes: hablantes.filter((h) => h.nombre && h.pos < limpio.length) };
}

/**
 * Para salidas en Markdown: deja las marcas completas como están y quita solo
 * las que un corte dejó partidas (que sí romperían el Markdown).
 */
export function repararMarcasHablante(texto: string): string {
  if (!texto.includes('**')) return texto;
  const completas: string[] = [];
  let s = texto.replace(COMPLETA, (m) => { completas.push(m); return SEP; });
  s = s.replace(CORTADA_INICIO, (_m, puntos?: string) => puntos ?? '');
  s = s.replace(CORTADA_FINAL, (_m, puntos: string | undefined, en: number) => (puntos && !/[.?!…»]$/.test(s.slice(0, en)) ? '…' : ''));
  let k = 0;
  return s.replace(/\u0001/g, () => completas[k++] ?? '');
}

/**
 * Marcado que dejó la OCR de la v1 dentro del texto: imágenes con su caja
 * («![](page=0,bbox=[25, 11, 817, 447])») y envoltorios HTML de alineación
 * («<div align="center">»). No es texto del documento: se quita al migrar, al
 * pintar, al buscar y al servir. `cajas` devuelve las cajas por si alguien
 * quiere aprovecharlas como regiones de figura (en las unidades de la página).
 */
const IMAGEN_OCR = /!\[[^\]\n]*\]\(\s*page\s*=\s*(\d+)\s*,\s*bbox\s*=\s*\[\s*([-\d.\s,]+?)\s*\]\s*\)/g;
const IMAGEN_VACIA = /!\[\]\([^)\n]*\)/g;
const DIV_OCR = /<\/?div\b[^>\n]*>/gi;

export function cajasOCR(texto: string): Array<{ pagina: number; caja: [number, number, number, number] }> {
  const salida: Array<{ pagina: number; caja: [number, number, number, number] }> = [];
  for (const m of texto.matchAll(IMAGEN_OCR)) {
    const n = (m[2] ?? '').split(',').map((x) => Number(x.trim()));
    if (n.length === 4 && n.every((x) => Number.isFinite(x))) salida.push({ pagina: Number(m[1]), caja: n as [number, number, number, number] });
  }
  return salida;
}

export function limpiarMarcadoOCR(texto: string): string {
  if (!texto || (!texto.includes('](') && !/<\/?div/i.test(texto))) return texto;
  return texto
    .replace(IMAGEN_OCR, '')
    .replace(IMAGEN_VACIA, '')
    .replace(DIV_OCR, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Descripciones de figuras de la v1: «Image type: ARTWORK Description: …»
 * (a veces con negritas de Markdown). Se queda solo la descripción.
 */
export function limpiarDescripcionV1(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .replace(/^\s*\**\s*Image\s+type\s*:?\s*\**\s*[A-Z_ /-]+?\s*\**\s*Description\s*:?\s*\**\s*/i, '')
    .replace(/\*\*/g, '')
    .trim();
}
