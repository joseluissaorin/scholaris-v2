import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

/**
 * La tarjeta de siempre: crema, esquinas de 16 px, borde suave y una sombra en
 * capas que la levanta del papel, con un filo de luz arriba. `viva` sube un
 * poco más al pasar.
 */
export const Tarjeta = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { viva?: boolean }>(function Tarjeta({ viva, className, ...resto }, ref) {
  return (
    <div
      ref={ref}
      className={cx(
        'rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado)]',
        viva && 'transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-cream-500 hover:shadow-[var(--levantado-alto)]',
        className,
      )}
      {...resto}
    />
  );
});

/** Rótulo de sección: mayúsculas, seminegrita, espaciado. */
export function Rotulo({ className, ...resto }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('rotulo text-apagado', className)} {...resto} />;
}

export interface PropsChip extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onToggle'> {
  activo?: boolean;
  icono?: NombreIcono;
  /** Punto de color delante (como las píldoras de tipo de documento). */
  punto?: 'rojo' | 'azul' | 'amarillo' | 'tinta';
  /** Si se da, el chip muestra una ✕ para quitarlo. */
  alQuitar?: () => void;
  recuento?: number;
}

const PUNTO = { rojo: 'bg-rojo', azul: 'bg-azul', amarillo: 'bg-amarillo', tinta: 'bg-coffee-800' };

/** La píldora: filtro conmutable (sube; activa, se hunde en café) o etiqueta que se quita. */
export function Chip({ activo, icono, punto, alQuitar, recuento, className, children, ...resto }: PropsChip) {
  const cuerpo = (
    <>
      {punto ? <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', PUNTO[punto])} aria-hidden /> : null}
      {icono ? <Icono nombre={icono} tam={14} /> : null}
      <span>{children}</span>
      {recuento != null ? <span className={cx('tnum text-[0.75rem]', activo ? 'text-cream-300' : 'text-coffee-300')}>{recuento}</span> : null}
    </>
  );
  const clases = cx(
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 font-sans text-[0.8125rem] font-medium leading-none transition-[background,border-color,box-shadow,transform] duration-150',
    activo
      ? 'border-[#1a0f0a] bg-coffee-800 text-cream-50 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)] dark:border-cream-500 dark:text-[#1f1712]'
      : 'border-cream-400 bg-cream-50 text-coffee-600 shadow-[var(--relieve)] hover:-translate-y-px hover:border-cream-500 hover:text-coffee-800 active:translate-y-px active:shadow-[var(--pulsado)]',
    className,
  );
  if (alQuitar) {
    return (
      <span className={clases}>
        {cuerpo}
        <button type="button" onClick={alQuitar} className="-mr-1.5 grid h-6 w-6 place-items-center rounded-md hover:bg-black/10" aria-label={`Quitar ${typeof children === 'string' ? children : 'filtro'}`}>
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
 * El folio: toda cita lleva uno («p. 145», «12:04», «diap. 7»). Una plaquita
 * hundida en mono con una cuña roja. `dudoso` cuando el folio se dedujo con
 * poca confianza.
 */
export function Folio({ children, dudoso, grande, className, ...resto }: HTMLAttributes<HTMLSpanElement> & { dudoso?: boolean; grande?: boolean }) {
  return (
    <span
      className={cx(
        'relative inline-flex items-center whitespace-nowrap rounded-md bg-cream-200 font-mono tnum leading-none text-coffee-700 shadow-[var(--hundido)]',
        grande ? 'h-7 pl-3 pr-2 text-[0.875rem]' : 'h-5 pl-2 pr-1.5 text-[0.6875rem]',
        className,
      )}
      title={dudoso ? 'Folio deducido con poca confianza' : undefined}
      {...resto}
    >
      <span aria-hidden className={cx('absolute left-0 top-1 bottom-1 rounded-r-sm', grande ? 'w-[3px]' : 'w-[2px]', dudoso ? 'bg-amarillo' : 'bg-rojo')} />
      {children}
      {dudoso ? <span aria-label="(deducido)" className="ml-0.5 text-ocre">?</span> : null}
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
export type Estilo = 'kandinsky' | 'malevich' | 'bauhaus';

/**
 * El lenguaje de formas. Tres registros, siempre con la correspondencia
 * color-forma de Kandinsky (amarillo-triángulo, rojo-cuadrado, azul-círculo):
 *  · kandinsky: círculos concéntricos, una línea que cruza, puntos en tensión;
 *  · malevich: un cuadrado negro dominante y barras planas que flotan en diagonal;
 *  · bauhaus: la retícula con las tres formas primarias.
 */
export function Composicion({ estilo, className, semilla = 0 }: { estilo: Estilo; className?: string; semilla?: number }) {
  const g = (semilla % 4) * 7;
  if (estilo === 'kandinsky') {
    return (
      <svg viewBox="0 0 240 160" className={className} aria-hidden>
        <circle cx={150 + g} cy="80" r="62" fill="var(--s-azul)" />
        <circle cx={150 + g} cy="80" r="44" fill="var(--s-cream-50)" />
        <circle cx={150 + g} cy="80" r="30" fill="var(--s-amarillo)" />
        <circle cx={150 + g} cy="80" r="14" fill="var(--s-coffee-800)" />
        <line x1="10" y1="142" x2="232" y2="20" stroke="var(--s-coffee-800)" strokeWidth="2.2" />
        <line x1="40" y1="20" x2="120" y2="150" stroke="var(--s-rojo)" strokeWidth="1.4" />
        <path d="M44 120 L70 74 L96 120 Z" fill="var(--s-amarillo)" />
        <rect x="200" y="122" width="22" height="22" fill="var(--s-rojo)" transform="rotate(12 211 133)" />
        <circle cx="34" cy="40" r="4" fill="var(--s-coffee-800)" />
        <circle cx="222" cy="40" r="2.5" fill="var(--s-rojo)" />
        <circle cx="108" cy="30" r="2" fill="var(--s-coffee-800)" />
      </svg>
    );
  }
  if (estilo === 'malevich') {
    return (
      <svg viewBox="0 0 240 160" className={className} aria-hidden>
        <rect x={112 + g} y="22" width="96" height="96" fill="var(--s-coffee-800)" transform={`rotate(-8 ${160 + g} 70)`} />
        <rect x="24" y="96" width="150" height="14" fill="var(--s-rojo)" transform="rotate(-24 99 103)" />
        <rect x="40" y="124" width="90" height="8" fill="var(--s-azul)" transform="rotate(-24 85 128)" />
        <rect x="58" y="40" width="34" height="34" fill="var(--s-amarillo)" transform="rotate(18 75 57)" />
        <rect x="196" y="122" width="30" height="5" fill="var(--s-coffee-800)" transform="rotate(-24 211 124)" />
        <circle cx="30" cy="34" r="3" fill="var(--s-rojo)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 240 160" className={className} aria-hidden>
      <g stroke="var(--s-cream-400)" strokeWidth="1">
        {[40, 80, 120, 160, 200].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="160" />)}
        {[40, 80, 120].map((y) => <line key={y} x1="0" y1={y} x2="240" y2={y} />)}
      </g>
      <circle cx={80 + g} cy="80" r="40" fill="var(--s-azul)" />
      <rect x="120" y="40" width="80" height="80" fill="var(--s-rojo)" />
      <path d="M160 120 L200 40 L240 120 Z" fill="var(--s-amarillo)" transform="translate(-40 0)" opacity="0.92" />
      <rect x="40" y="132" width="120" height="6" fill="var(--s-coffee-800)" />
    </svg>
  );
}

/** El estado vacío: tarjeta hundida con borde discontinuo, una composición, un titular, una frase y una acción. */
export function Vacio({ forma = 'circulo', estilo, titulo, children, accion, className }: { forma?: FormaVacio; estilo?: Estilo; titulo: ReactNode; children?: ReactNode; accion?: ReactNode; className?: string }) {
  const e: Estilo = estilo ?? (forma === 'triangulo' ? 'kandinsky' : forma === 'cuadrado' || forma === 'cuarto' ? 'malevich' : 'bauhaus');
  return (
    <div className={cx('relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-dashed border-cream-500 bg-cream-100/60 px-6 py-10 text-center shadow-[var(--hundido)] sm:px-10', className)}>
      <Composicion estilo={e} className="mb-2 h-24 w-36" />
      <h3 className="text-[1.0625rem] font-semibold text-coffee-800">{titulo}</h3>
      {children ? <div className="max-w-[48ch] text-[0.875rem] text-coffee-600">{children}</div> : null}
      {accion ? <div className="mt-2 flex flex-wrap justify-center gap-2">{accion}</div> : null}
    </div>
  );
}

/** Una sola forma primaria (para acentos pequeños). */
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

/** Tecla: un botoncito con relieve, como una tecla de verdad. */
export function Teclas({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-cream-400 border-b-2 bg-cream-50 px-1 font-mono text-[0.6875rem] leading-none text-coffee-600 shadow-[var(--relieve)]', className)}>
      {children}
    </kbd>
  );
}

/** Barra de avance: un carril hundido con la tinta llenándolo. Sin valor es indeterminada. */
export function BarraAvance({ valor, className, etiqueta, tono = 'rojo' }: { valor?: number; className?: string; etiqueta?: string; tono?: 'rojo' | 'azul' | 'tinta' }) {
  const color = tono === 'azul' ? 'bg-azul' : tono === 'tinta' ? 'bg-coffee-800' : 'bg-rojo';
  return (
    <div
      role="progressbar"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valor == null ? undefined : Math.round(valor * 100)}
      className={cx('relative h-1.5 w-full overflow-hidden rounded-full bg-cream-200 shadow-[var(--hundido)]', className)}
    >
      {valor == null ? (
        <div className={cx('absolute inset-y-0 w-1/3 rounded-full anim-pulso', color)} />
      ) : (
        <div className={cx('h-full rounded-full transition-[width] duration-300 ease-out', color)} style={{ width: `${Math.max(2, Math.min(100, valor * 100))}%` }} />
      )}
    </div>
  );
}

/** Separador con rótulo. */
export function Filete({ children, className }: { children?: ReactNode; className?: string }) {
  if (!children) return <hr className={cx('border-0 border-t border-cream-300', className)} />;
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <span className="rotulo text-coffee-700">{children}</span>
      <span className="h-px flex-1 bg-cream-300" />
    </div>
  );
}
