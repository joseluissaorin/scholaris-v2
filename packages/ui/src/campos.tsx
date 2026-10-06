import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

/*
 * El campo de siempre (crema, borde suave, redondeado) hundido en el papel:
 * sombra interior arriba. Al enfocarlo, el borde café y el halo cálido.
 */
const BASE =
  'w-full rounded-xl border border-cream-400 bg-cream-50 text-coffee-800 font-sans placeholder:text-coffee-300 ' +
  'shadow-[var(--hundido)] transition-[border-color,box-shadow,background-color] duration-150 hover:border-cream-500 ' +
  'focus:border-coffee-500 focus:bg-[#fffdf8] dark:focus:bg-cream-50 focus:outline-none focus-visible:outline-none focus:shadow-[var(--hundido),0_0_0_3px_rgb(107_66_38/0.15),0_0_12px_rgb(107_66_38/0.08)] ' +
  'disabled:opacity-50';

export interface PropsCampo extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icono?: NombreIcono;
  /** Algo a la derecha: un atajo, un botón pequeño, un recuento. */
  sufijo?: ReactNode;
  tam?: 'm' | 'g';
}

/** El único campo de texto. `tam="g"` es la caja grande de búsqueda. */
export const Campo = forwardRef<HTMLInputElement, PropsCampo>(function Campo({ icono, sufijo, tam = 'm', className, ...resto }, ref) {
  const grande = tam === 'g';
  return (
    <div className={cx('relative flex items-center', className)}>
      {icono ? (
        <span className={cx('pointer-events-none absolute text-coffee-300', grande ? 'left-4' : 'left-3.5')}>
          <Icono nombre={icono} tam={grande ? 20 : 16} />
        </span>
      ) : null}
      <input
        ref={ref}
        className={cx(
          BASE,
          grande ? 'h-14 text-[1.0625rem]' : 'h-10 text-[0.875rem]',
          icono ? (grande ? 'pl-12' : 'pl-10') : grande ? 'pl-5' : 'pl-3.5',
          sufijo ? (grande ? 'pr-28' : 'pr-20') : 'pr-3',
        )}
        {...resto}
      />
      {sufijo ? <span className="absolute right-2 flex items-center gap-1">{sufijo}</span> : null}
    </div>
  );
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AreaTexto({ className, ...resto }, ref) {
  return <textarea ref={ref} className={cx(BASE, 'min-h-28 px-4 py-3 text-[0.875rem] leading-relaxed', className)} {...resto} />;
});

export const Selector = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Selector({ className, children, ...resto }, ref) {
  return (
    <div className={cx('relative', className)}>
      <select ref={ref} className={cx(BASE, 'h-10 appearance-none pl-3.5 pr-9 text-[0.875rem]')} {...resto}>
        {children}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-coffee-400">
        <Icono nombre="abajo" tam={15} />
      </span>
    </div>
  );
});

export interface PropsEtiquetado {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  children: (id: string, describe?: string) => ReactNode;
  className?: string;
}

/** Etiqueta + control + ayuda o error, con los `id` y `aria-describedby` ya enlazados. */
export function Etiquetado({ etiqueta, ayuda, error, children, className }: PropsEtiquetado) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-coffee-700">{etiqueta}</label>
      {children(id, ayuda || error ? idAyuda : undefined)}
      {error ? (
        <p id={idAyuda} className="text-[0.75rem] text-rojo">{error}</p>
      ) : ayuda ? (
        <p id={idAyuda} className="text-[0.75rem] text-apagado">{ayuda}</p>
      ) : null}
    </div>
  );
}
