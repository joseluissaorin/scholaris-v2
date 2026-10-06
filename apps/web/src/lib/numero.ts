/**
 * Números a la española según la RAE: coma decimal y, a partir de cinco cifras,
 * los millares separados por un espacio fino que no se parte (U+202F): 10 000,
 * 1 284 (sin separar, cuatro cifras). Nunca el punto de millares.
 */
const ESPACIO_FINO = ' ';

export function numero(n: number, opciones: Intl.NumberFormatOptions = {}): string {
  const partes = new Intl.NumberFormat('es-ES', { useGrouping: false, ...opciones }).formatToParts(n);
  const entero = partes.filter((p) => p.type === 'integer').map((p) => p.value).join('');
  const conGrupos = entero.length >= 5 ? entero.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACIO_FINO) : entero;
  let puesto = false;
  return partes.map((p) => {
    if (p.type !== 'integer') return p.value;
    if (puesto) return '';
    puesto = true;
    return conGrupos;
  }).join('');
}
