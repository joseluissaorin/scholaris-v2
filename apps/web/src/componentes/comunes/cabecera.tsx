import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Composicion, cx, Icono, type Estilo, type FormaVacio } from '@scholaris/ui';

/** La forma primaria de cada lugar, con la correspondencia de Kandinsky. */
const FORMA_LUGAR: Record<FormaVacio, { estilo: Estilo; marca: ReactNode }> = {
  cuarto: { estilo: 'bauhaus', marca: <span className="h-3 w-3 bg-rojo" /> },
  circulo: { estilo: 'kandinsky', marca: <span className="h-3 w-3 rounded-full bg-azul" /> },
  triangulo: { estilo: 'kandinsky', marca: <span className="h-0 w-0 border-x-[7px] border-b-[12px] border-x-transparent border-b-amarillo" /> },
  cuadrado: { estilo: 'malevich', marca: <span className="h-3 w-3 rotate-12 bg-coffee-800" /> },
};

/**
 * La cabecera de cada lugar, como en la Scholaris de siempre: el título y una
 * línea que dice qué se hace aquí. A la derecha, una composición pequeña (el
 * lenguaje Bauhaus, con contención); a la izquierda, la forma del lugar.
 */
export function Cabecera({ antetitulo, titulo, forma, children, compacta, className }: {
  numero?: string; antetitulo: ReactNode; titulo: ReactNode; forma: FormaVacio; color?: string; children?: ReactNode; compacta?: boolean; className?: string;
}) {
  const f = FORMA_LUGAR[forma];
  return (
    <header className={cx('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10', compacta ? 'pt-6' : 'pt-6 sm:pt-8', className)}>
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2.5 text-[1.5rem] font-bold tracking-[-0.01em] text-coffee-800 sm:text-[1.75rem]">
            <span aria-hidden className="grid h-4 w-4 place-items-center">{f.marca}</span>
            {titulo}
          </h1>
          <p className="mt-1 text-[0.875rem] text-coffee-600">{antetitulo}</p>
        </div>
        <Composicion estilo={f.estilo} semilla={forma.length} className="-mt-2 hidden h-[76px] w-[114px] shrink-0 sm:block" />
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </header>
  );
}

/** Pestañas que son rutas: un control segmentado con relieve; la activa se hunde en café. */
export function Pestanas({ elementos, etiqueta }: { elementos: Array<{ a: string; texto: ReactNode; exacta?: boolean; insignia?: number }>; etiqueta: string }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 lg:px-10">
      <nav aria-label={etiqueta} className="sin-barra inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-cream-400 bg-cream-200/70 p-1 shadow-[var(--hundido)]">
        {elementos.map((e) => (
          <Link
            key={e.a}
            to={e.a}
            activeOptions={{ exact: e.exacta ?? false, includeSearch: false }}
            className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[0.8125rem] font-medium text-coffee-600 transition-[background,box-shadow,color] hover:text-coffee-800 data-[status=active]:bg-cream-50 data-[status=active]:text-coffee-800 data-[status=active]:shadow-[var(--relieve)]"
          >
            {e.texto}
            {e.insignia ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-amarillo px-1 text-[0.625rem] font-bold text-coffee-800">{e.insignia}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Contenedor de página con los márgenes de siempre. */
export function Lienzo({ children, className, ancho = 'normal' }: { children: ReactNode; className?: string; ancho?: 'normal' | 'estrecho' | 'total' }) {
  return <div className={cx('mx-auto w-full px-4 py-6 sm:px-6 lg:px-10', ancho === 'estrecho' ? 'max-w-4xl' : ancho === 'normal' ? 'max-w-6xl' : '', className)}>{children}</div>;
}

/** Sección en tarjeta, como los ajustes de siempre: icono, título, una línea y el contenido. */
export function Seccion({ icono, titulo, descripcion, accion, children, className }: { icono: import('@scholaris/ui').NombreIcono; titulo: ReactNode; descripcion?: ReactNode; accion?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-cream-400 bg-cream-50 p-5 shadow-[var(--levantado)] sm:p-6', className)}>
      <div className="flex items-start gap-3">
        <Icono nombre={icono} tam={18} className="mt-0.5 shrink-0 text-coffee-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold text-coffee-800">{titulo}</h2>
          {descripcion ? <p className="mt-0.5 text-[0.8125rem] text-coffee-500">{descripcion}</p> : null}
        </div>
        {accion}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
