/**
 * Pasar la hoja: al saltar a otra página («ir a», índice, figuras), la columna
 * de lectura entra como una hoja que se vuelve desde el lomo (hacia delante o
 * hacia atrás según adónde se va). Solo transform y opacidad.
 */
import { curva } from './muelle';
import { quieto } from './preferencias';

export function hojear(el: HTMLElement | null, adelante = true) {
  if (!el || quieto()) return;
  const { curva: c } = curva('asentar');
  const giro = adelante ? 10 : -10;
  el.animate(
    [
      { opacity: 0.25, transform: `perspective(1600px) rotateY(${giro}deg) translateX(${adelante ? 26 : -26}px)`, transformOrigin: adelante ? 'left center' : 'right center' },
      { opacity: 1, transform: 'none', transformOrigin: adelante ? 'left center' : 'right center' },
    ],
    { duration: 560, easing: c },
  );
}
