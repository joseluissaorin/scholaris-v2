import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { cx, FormaBauhaus, type FormaVacio } from '@scholaris/ui';

/**
 * La cabecera de cada lugar: un número, un titular enorme y una sola forma
 * Bauhaus que muerde el borde. Siempre igual, para que el usuario sepa dónde está.
 */
export function Cabecera({ numero, antetitulo, titulo, forma, color, children, compacta, className }: {
  numero?: string; antetitulo: ReactNode; titulo: ReactNode; forma: FormaVacio; color?: string; children?: ReactNode; compacta?: boolean; className?: string;
}) {
  return (
    <header className={cx('relative overflow-hidden px-5 md:px-12', compacta ? 'pb-4 pt-6 md:pt-8' : 'pb-6 pt-7 md:pb-8 md:pt-12', className)}>
      <FormaBauhaus
        forma={forma}
        color={color}
        className={cx('pointer-events-none absolute', compacta ? '-right-12 -top-16 h-44 w-44 md:h-56 md:w-56' : '-right-20 -top-24 h-56 w-56 md:-right-16 md:-top-28 md:h-[22rem] md:w-[22rem]')}
      />
      <p className="rotulo relative text-apagado">{numero ? <span className="text-rojo">{numero}</span> : null}{numero ? ' · ' : ''}{antetitulo}</p>
      <h1 className={cx('titular relative mt-2 max-w-[11ch] text-tinta', compacta ? 'text-[clamp(2.25rem,6vw,3.5rem)]' : 'text-[clamp(3rem,10vw,6.75rem)]')}>{titulo}</h1>
      {children ? <div className="relative mt-5 md:mt-7">{children}</div> : null}
    </header>
  );
}

/** Pestañas que son rutas: se precargan al pasar el ratón, se comparten por enlace. */
export function Pestanas({ elementos, etiqueta }: { elementos: Array<{ a: string; texto: ReactNode; exacta?: boolean; insignia?: number }>; etiqueta: string }) {
  return (
    <nav aria-label={etiqueta} className="sin-barra sticky top-14 z-20 -mb-px flex gap-1 overflow-x-auto border-b border-filete bg-papel/90 px-5 backdrop-blur md:top-0 md:px-12">
      {elementos.map((e) => (
        <Link
          key={e.a}
          to={e.a}
          activeOptions={{ exact: e.exacta ?? false, includeSearch: false }}
          className="group relative flex h-12 shrink-0 items-center gap-2 px-3 text-[0.9375rem] text-tinta-2 hover:text-tinta data-[status=active]:text-tinta"
        >
          <span className="group-data-[status=active]:italic">{e.texto}</span>
          {e.insignia ? <span className="rotulo grid h-5 min-w-5 place-items-center rounded-full bg-amarillo px-1 text-[0.625rem] text-tinta">{e.insignia}</span> : null}
          <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] bg-tinta opacity-0 group-data-[status=active]:opacity-100" />
        </Link>
      ))}
    </nav>
  );
}

/** Contenedor de página con los márgenes del sistema. */
export function Lienzo({ children, className, ancho = 'normal' }: { children: ReactNode; className?: string; ancho?: 'normal' | 'estrecho' | 'total' }) {
  return <div className={cx('px-5 py-6 md:px-12 md:py-8', ancho === 'estrecho' && 'max-w-4xl', ancho === 'normal' && 'max-w-[90rem]', className)}>{children}</div>;
}
