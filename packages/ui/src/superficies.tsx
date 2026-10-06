import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

/** La única tarjeta: una hoja sobre el papel. `viva` la hace reaccionar al puntero. */
export const Tarjeta = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { viva?: boolean }>(function Tarjeta({ viva, className, ...resto }, ref) {
  return (
    <div
      ref={ref}
      className={cx(
        'rounded-m border border-filete bg-hoja',
        viva && 'transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:border-filete-fuerte hover:shadow-hoja',
        className,
      )}
      {...resto}
    />
  );
});

/** Etiqueta monoespaciada en mayúsculas: susurra datos. */
export function Rotulo({ className, ...resto }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('rotulo text-apagado', className)} {...resto} />;
}

export interface PropsChip extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onToggle'> {
  activo?: boolean;
  icono?: NombreIcono;
  /** Si se da, el chip muestra una ✕ para quitarlo. */
  alQuitar?: () => void;
  recuento?: number;
}

/** El único chip: filtro conmutables o etiqueta que se puede quitar. */
export function Chip({ activo, icono, alQuitar, recuento, className, children, ...resto }: PropsChip) {
  const cuerpo = (
    <>
      {icono ? <Icono nombre={icono} tam={14} /> : null}
      <span>{children}</span>
      {recuento != null ? <span className="rotulo tnum opacity-70">{recuento}</span> : null}
    </>
  );
  const clases = cx(
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] leading-none transition-colors duration-100',
    activo ? 'border-tinta bg-tinta text-sobre-tinta' : 'border-filete-fuerte bg-transparent text-tinta-2 hover:border-tinta hover:text-tinta',
    className,
  );
  if (alQuitar) {
    return (
      <span className={clases}>
        {cuerpo}
        <button type="button" onClick={alQuitar} className="-mr-1.5 grid h-6 w-6 place-items-center rounded-full hover:bg-hondo/40" aria-label={`Quitar ${typeof children === 'string' ? children : 'filtro'}`}>
          <Icono nombre="cerrar" tam={12} />
        </button>
      </span>
    );
  }
  return (
    <button type="button" aria-pressed={activo} className={clases} {...resto}>
      {cuerpo}
    </button>
  );
}

/**
 * El folio: la marca de Scholaris. Toda cita lleva uno («p. 145», «12:04»,
 * «diap. 7»). `dudoso` lo marca cuando el folio se dedujo con poca confianza.
 */
export function Folio({ children, dudoso, grande, className, ...resto }: HTMLAttributes<HTMLSpanElement> & { dudoso?: boolean; grande?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap border-l-2 font-mono tnum leading-none',
        grande ? 'border-l-[3px] pl-2 text-[1.0625rem]' : 'pl-1.5 text-[0.75rem]',
        dudoso ? 'border-amarillo text-tinta-2' : 'border-rojo text-tinta',
        className,
      )}
      title={dudoso ? 'Folio deducido con poca confianza' : undefined}
      {...resto}
    >
      {children}
      {dudoso ? <span aria-label="(deducido)" className="ml-0.5 text-amarillo">?</span> : null}
    </span>
  );
}

export function Esqueleto({ className, ...resto }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cx('esqueleto', className)} {...resto} />;
}

/** Líneas de texto falsas para un bloque que carga. */
export function EsqueletoTexto({ lineas = 3, className }: { lineas?: number; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lineas }, (_, i) => (
        <div key={i} className="esqueleto h-3" style={{ width: i === lineas - 1 ? '62%' : `${92 - (i % 3) * 6}%` }} />
      ))}
    </div>
  );
}

export type FormaVacio = 'circulo' | 'triangulo' | 'cuadrado' | 'cuarto';

/** El único estado vacío: una forma grande, un titular, una frase y, si hace falta, una acción. */
export function Vacio({ forma = 'circulo', titulo, children, accion, className }: { forma?: FormaVacio; titulo: ReactNode; children?: ReactNode; accion?: ReactNode; className?: string }) {
  return (
    <div className={cx('relative flex flex-col items-start gap-4 overflow-hidden rounded-m border border-dashed border-filete-fuerte px-6 py-10 sm:px-10', className)}>
      <FormaBauhaus forma={forma} className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 opacity-90" />
      <h3 className="titular relative max-w-[18ch] text-[2rem] text-tinta">{titulo}</h3>
      {children ? <div className="relative max-w-[52ch] text-tinta-2">{children}</div> : null}
      {accion ? <div className="relative mt-2 flex flex-wrap gap-2">{accion}</div> : null}
    </div>
  );
}

/** Las tres formas de la casa (y el cuarto de círculo de la portada). */
export function FormaBauhaus({ forma, className, color }: { forma: FormaVacio; className?: string; color?: string }) {
  const relleno = color ?? (forma === 'circulo' ? 'var(--s-azul)' : forma === 'triangulo' ? 'var(--s-amarillo)' : 'var(--s-rojo)');
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {forma === 'circulo' ? <circle cx="50" cy="50" r="50" fill={relleno} /> : null}
      {forma === 'triangulo' ? <path d="M50 0L100 100H0z" fill={relleno} /> : null}
      {forma === 'cuadrado' ? <rect x="8" y="8" width="84" height="84" fill={relleno} transform="rotate(12 50 50)" /> : null}
      {forma === 'cuarto' ? <path d="M100 0v100A100 100 0 010 0z" fill={relleno} /> : null}
    </svg>
  );
}

export function Teclas({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-s border border-filete-fuerte bg-hoja px-1 font-mono text-[0.6875rem] leading-none text-tinta-2', className)}>{children}</kbd>;
}

/** Barra de avance. Sin valor es indeterminada. */
export function BarraAvance({ valor, className, etiqueta, tono = 'rojo' }: { valor?: number; className?: string; etiqueta?: string; tono?: 'rojo' | 'azul' | 'tinta' }) {
  const color = tono === 'azul' ? 'bg-azul' : tono === 'tinta' ? 'bg-tinta' : 'bg-rojo';
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valor == null ? undefined : Math.round(valor * 100)}
      className={cx('relative h-[3px] w-full overflow-hidden bg-hondo', className)}
    >
      {valor == null ? (
        <div className={cx('absolute inset-y-0 w-1/3 anim-pulso', color)} />
      ) : (
        <div className={cx('h-full transition-[width] duration-300 ease-out', color)} style={{ width: `${Math.max(2, Math.min(100, valor * 100))}%` }} />
      )}
    </div>
  );
}

/** Separador con rótulo: la regla horizontal de imprenta. */
export function Filete({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return <hr className={cx('border-0 border-t border-filete', className)} />;
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <span className="rotulo text-apagado">{children}</span>
      <span className="h-px flex-1 bg-filete" />
    </div>
  );
}
