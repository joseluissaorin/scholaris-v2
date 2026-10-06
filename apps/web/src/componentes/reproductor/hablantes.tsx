/**
 * Cada hablante, una forma y un color de la correspondencia de Kandinsky:
 * el primero un círculo azul, el segundo un cuadrado rojo, el tercero un
 * triángulo amarillo… La forma deja distinguirlos también sin color.
 */
import { cx } from '@scholaris/ui';

export const COLORES_HABLANTE = ['var(--s-azul)', 'var(--s-rojo)', 'var(--s-amarillo)', 'var(--s-verde)', 'var(--s-coffee-500)', 'var(--s-ocre)'] as const;
const FORMAS = ['circulo', 'cuadrado', 'triangulo'] as const;

export const colorHablante = (h: number) => (h < 0 ? 'var(--s-cream-500)' : COLORES_HABLANTE[h % COLORES_HABLANTE.length]!);
export const formaHablante = (h: number) => FORMAS[(h < 0 ? 0 : h) % FORMAS.length]!;

export function FormaHablante({ h, tam = 10, className }: { h: number; tam?: number; className?: string }) {
  const color = colorHablante(h);
  const forma = formaHablante(h);
  return (
    <svg viewBox="0 0 10 10" width={tam} height={tam} className={cx('shrink-0', className)} aria-hidden>
      {forma === 'circulo' ? <circle cx="5" cy="5" r="4.6" fill={color} />
        : forma === 'cuadrado' ? <rect x="0.8" y="0.8" width="8.4" height="8.4" fill={color} />
          : <path d="M5 0.6 L9.6 9.2 L0.4 9.2 Z" fill={color} />}
    </svg>
  );
}
