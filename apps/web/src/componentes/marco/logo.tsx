import { cx } from '@scholaris/ui';

/**
 * El logo dibujado a mano: la cabeza de perfil con un libro abierto por
 * sombrero. Sobre el café oscuro se invierte con un punto de sepia, como
 * siempre.
 */
export function Logo({ tam = 32, sobreOscuro, className }: { tam?: number; sobreOscuro?: boolean; className?: string }) {
  return (
    <img
      src="/logo.webp"
      alt=""
      width={tam}
      height={tam}
      decoding="async"
      className={cx('shrink-0 select-none', sobreOscuro ? 'invert sepia-[.2] brightness-[.95] mix-blend-lighten' : 'mix-blend-multiply dark:invert dark:mix-blend-lighten', className)}
      style={{ width: tam, height: tam }}
    />
  );
}
