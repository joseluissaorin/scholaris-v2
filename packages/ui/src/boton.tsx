import { cloneElement, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

export type VarianteBoton = 'tinta' | 'rojo' | 'linea' | 'fantasma';
export type TamBoton = 'p' | 'm' | 'g';

const VARIANTES: Record<VarianteBoton, string> = {
  tinta: 'bg-tinta text-sobre-tinta hover:bg-tinta-2 border border-tinta',
  rojo: 'bg-rojo text-[#fbf5ec] hover:brightness-110 border border-rojo dark:text-[#1a1511]',
  linea: 'bg-transparent text-tinta border border-filete-fuerte hover:border-tinta hover:bg-hoja',
  fantasma: 'bg-transparent text-tinta-2 border border-transparent hover:text-tinta hover:bg-hondo/70',
};

const TAMANOS: Record<TamBoton, string> = {
  p: 'h-8 px-2.5 text-[0.8125rem] gap-1.5',
  m: 'h-10 px-3.5 text-[0.9375rem] gap-2',
  g: 'h-12 px-5 text-[1.0625rem] gap-2.5',
};
const TAMANOS_ICONO: Record<TamBoton, string> = { p: 'h-8 w-8', m: 'h-10 w-10', g: 'h-12 w-12' };

export interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tam?: TamBoton;
  icono?: NombreIcono;
  /** Botón solo con icono: exige `aria-label`. */
  soloIcono?: boolean;
  cargando?: boolean;
  /** Renderiza el hijo (un enlace del router, por ejemplo) con el aspecto del botón. */
  comoHijo?: boolean;
  atajo?: ReactNode;
}

/** El único botón de Scholaris. */
export const Boton = forwardRef<HTMLButtonElement, PropsBoton>(function Boton(
  { variante = 'linea', tam = 'm', icono, soloIcono, cargando, comoHijo, atajo, className, children, disabled, type, ...resto },
  ref,
) {
  const tamIcono = tam === 'g' ? 20 : tam === 'p' ? 15 : 17;
  const clases = cx(
    'relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-s font-serif leading-none',
    'transition-[background-color,border-color,color,transform,filter] duration-100 active:translate-y-px',
    'disabled:pointer-events-none disabled:opacity-45',
    VARIANTES[variante],
    soloIcono ? TAMANOS_ICONO[tam] : TAMANOS[tam],
    className,
  );
  // «Como hijo»: el aspecto del botón sobre un enlace del enrutador, sin envolverlo.
  if (comoHijo && isValidElement(children)) {
    const hijo = children as ReactElement<{ className?: string }>;
    return cloneElement(hijo, { ...(resto as object), className: cx(clases, 'gap-2', hijo.props.className) });
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={clases}
      {...resto}
    >
      {cargando ? (
        <span aria-hidden className="inline-block h-3 w-3 border-[1.5px] border-current anim-gira" style={{ animationDuration: '0.9s' }} />
      ) : icono ? (
        <Icono nombre={icono} tam={tamIcono} />
      ) : null}
      {children}
      {atajo ? <span className="rotulo ml-1 opacity-60">{atajo}</span> : null}
    </button>
  );
});
