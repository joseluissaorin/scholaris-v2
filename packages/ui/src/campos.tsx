import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

const BASE =
  'w-full rounded-s border border-filete-fuerte bg-hoja text-tinta placeholder:text-apagado/80 ' +
  'transition-[border-color,box-shadow] duration-100 hover:border-tinta-2 ' +
  'focus:border-tinta focus:outline-none focus-visible:outline-none focus:shadow-[0_0_0_3px_var(--s-rojo-suave)] ' +
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
        <span className={cx('pointer-events-none absolute text-apagado', grande ? 'left-4' : 'left-3')}>
          <Icono nombre={icono} tam={grande ? 22 : 17} />
        </span>
      ) : null}
      <input
        ref={ref}
        className={cx(
          BASE,
          grande ? 'h-14 text-[1.25rem] tracking-[-0.01em]' : 'h-10 text-[0.9375rem]',
          icono ? (grande ? 'pl-12' : 'pl-9') : grande ? 'pl-5' : 'pl-3',
          sufijo ? (grande ? 'pr-28' : 'pr-20') : 'pr-3',
        )}
        {...resto}
      />
      {sufijo ? <span className="absolute right-2 flex items-center gap-1">{sufijo}</span> : null}
    </div>
  );
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AreaTexto({ className, ...resto }, ref) {
  return <textarea ref={ref} className={cx(BASE, 'min-h-28 px-3 py-2.5 text-[0.9375rem] leading-relaxed', className)} {...resto} />;
});

export const Selector = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Selector({ className, children, ...resto }, ref) {
  return (
    <div className={cx('relative', className)}>
      <select ref={ref} className={cx(BASE, 'h-10 appearance-none pl-3 pr-9 text-[0.9375rem]')} {...resto}>
        {children}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-apagado">
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
      <label htmlFor={id} className="rotulo text-tinta-2">{etiqueta}</label>
      {children(id, ayuda || error ? idAyuda : undefined)}
      {error ? (
        <p id={idAyuda} className="text-[0.8125rem] text-rojo">{error}</p>
      ) : ayuda ? (
        <p id={idAyuda} className="text-[0.8125rem] text-apagado">{ayuda}</p>
      ) : null}
    </div>
  );
}
