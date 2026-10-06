import { cx } from '@scholaris/ui';

/** El monograma: un cuadrado de tinta, una S en cursiva y un cuarto de círculo rojo que lo muerde. */
export function Monograma({ tam = 40, className }: { tam?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" width={tam} height={tam} className={cx('shrink-0', className)} role="img" aria-label="Scholaris">
      <rect width="40" height="40" fill="var(--s-tinta)" />
      <path d="M40 22v18H22A18 18 0 0140 22z" fill="var(--s-rojo)" />
      <text x="17" y="29" textAnchor="middle" fontFamily="Georgia, serif" fontStyle="italic" fontSize="27" fill="var(--s-papel)">S</text>
    </svg>
  );
}
