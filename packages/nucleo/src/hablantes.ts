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
