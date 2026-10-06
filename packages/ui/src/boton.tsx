import { cloneElement, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

export type VarianteBoton = 'tinta' | 'rojo' | 'linea' | 'fantasma';
export type TamBoton = 'p' | 'm' | 'g';

/*
 * El botón de siempre (redondeado, DM Sans, seminegrita) con relieve: un filo
 * de luz arriba, sombra corta y blanda; al pasar sube un poco y al pulsar se
 * hunde. El principal es café oscuro con un degradado mínimo de tinta.
 */
const VARIANTES: Record<VarianteBoton, string> = {
  tinta:
    'text-cream-50 bg-[linear-gradient(180deg,#4a2e1a_0%,#2c1810_100%)] border border-[#1a0f0a] shadow-[var(--relieve-oscuro)] ' +
    'hover:-translate-y-px hover:bg-[linear-gradient(180deg,#5c3d2e_0%,#2c1810_100%)] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_4px_12px_rgb(26_15_10/0.25)] ' +
    'active:translate-y-px active:shadow-[var(--pulsado)] active:bg-[#2c1810] ' +
    'dark:text-[#1f1712] dark:bg-[linear-gradient(180deg,#faf7f0_0%,#e2d9c5_100%)] dark:border-[#c4ae96] dark:hover:bg-[linear-gradient(180deg,#fff_0%,#ede6d6_100%)]',
  rojo:
    'text-[#fdf8f1] bg-[linear-gradient(180deg,#cc5246_0%,#b83e33_100%)] border border-[#9a3128] shadow-[var(--relieve-oscuro)] ' +
    'hover:-translate-y-px hover:brightness-105 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_4px_12px_rgb(120_30_20/0.25)] ' +
    'active:translate-y-px active:shadow-[var(--pulsado)] active:brightness-95',
  linea:
    'text-coffee-800 bg-[linear-gradient(180deg,var(--s-cream-50)_0%,var(--s-cream-100)_100%)] border border-cream-400 shadow-[var(--relieve)] ' +
    'hover:-translate-y-px hover:bg-cream-50 hover:border-cream-500 hover:shadow-[var(--relieve-alto)] ' +
    'active:translate-y-px active:shadow-[var(--pulsado)] active:bg-cream-200',
  fantasma:
    'text-coffee-600 bg-transparent border border-transparent hover:bg-cream-200 hover:text-coffee-800 active:shadow-[var(--pulsado)] active:translate-y-px',
};

const TAMANOS: Record<TamBoton, string> = {
  p: 'h-8 px-3 text-[0.8125rem] gap-1.5 rounded-lg',
  m: 'h-10 px-4 text-[0.875rem] gap-2 rounded-xl',
  g: 'h-12 px-6 text-[0.9375rem] gap-2.5 rounded-xl',
};
const TAMANOS_ICONO: Record<TamBoton, string> = { p: 'h-8 w-8 rounded-lg', m: 'h-10 w-10 rounded-xl', g: 'h-12 w-12 rounded-xl' };

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
    'relative inline-flex select-none items-center justify-center whitespace-nowrap font-sans font-semibold leading-none',
    'transition-[background,border-color,color,transform,box-shadow,filter] duration-150 ease-out',
    'disabled:pointer-events-none disabled:opacity-50',
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
        <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent anim-gira" style={{ animationDuration: '0.8s' }} />
      ) : icono ? (
        <Icono nombre={icono} tam={tamIcono} />
      ) : null}
      {children}
      {atajo ? <span className="dato ml-1 opacity-60">{atajo}</span> : null}
    </button>
  );
});
