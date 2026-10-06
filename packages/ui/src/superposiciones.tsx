import type { ReactNode } from 'react';
import { Dialog, DropdownMenu, Switch, Tooltip } from 'radix-ui';
import { cx } from './cx';
import { Icono, type NombreIcono } from './iconos';

export interface PropsDialogo {
  abierto: boolean;
  alCambiar: (abierto: boolean) => void;
  titulo: ReactNode;
  descripcion?: ReactNode;
  children?: ReactNode;
  pie?: ReactNode;
  ancho?: 'm' | 'g';
  /** Oculta el título visualmente (se sigue anunciando). */
  tituloOculto?: boolean;
  className?: string;
}

/** El único diálogo. Para lo irreversible; lo demás se deshace con una tostada. */
export function Dialogo({ abierto, alCambiar, titulo, descripcion, children, pie, ancho = 'm', tituloOculto, className }: PropsDialogo) {
  return (
    <Dialog.Root open={abierto} onOpenChange={alCambiar}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_15_10/0.55)] backdrop-blur-sm anim-aparece" />
        <Dialog.Content
          className={cx(
            'fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado-alto)] anim-dialogo focus:outline-none',
            ancho === 'g' ? 'max-w-2xl' : 'max-w-md',
            className,
          )}
          aria-describedby={descripcion ? undefined : undefined}
        >
          <div className={cx('px-6 pt-5', tituloOculto && 'sr-only')}>
            <Dialog.Title className="text-[1.125rem] font-semibold text-coffee-800">{titulo}</Dialog.Title>
            {descripcion ? <Dialog.Description className="mt-1.5 text-[0.875rem] text-coffee-600">{descripcion}</Dialog.Description> : null}
          </div>
          {children ? <div className={cx(!tituloOculto && 'px-6 pb-2 pt-4')}>{children}</div> : null}
          {pie ? <div className="flex justify-end gap-2 rounded-b-2xl border-t border-cream-300 bg-cream-100/70 px-6 py-3">{pie}</div> : null}
          <Dialog.Close className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-coffee-400 hover:bg-cream-200 hover:text-coffee-800" aria-label="Cerrar">
            <Icono nombre="cerrar" tam={16} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const MenuRaiz = DropdownMenu.Root;
export const MenuDisparador = DropdownMenu.Trigger;

export function MenuContenido({ children, className, alinear = 'end', lado = 'bottom' }: { children: ReactNode; className?: string; alinear?: 'start' | 'end' | 'center'; lado?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={alinear}
        side={lado}
        sideOffset={6}
        className={cx('z-50 min-w-48 rounded-xl border border-cream-400 bg-cream-50 p-1.5 shadow-[var(--levantado-alto)] anim-menu', className)}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuElemento({ icono, peligro, children, alElegir, atajo }: { icono?: NombreIcono; peligro?: boolean; children: ReactNode; alElegir?: () => void; atajo?: string }) {
  return (
    <DropdownMenu.Item
      onSelect={alElegir}
      className={cx(
        'flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-medium outline-none data-[highlighted]:bg-cream-200',
        peligro ? 'text-rojo' : 'text-coffee-700 data-[highlighted]:text-coffee-800',
      )}
    >
      {icono ? <Icono nombre={icono} tam={16} className="text-coffee-400" /> : <span className="w-4" />}
      <span className="flex-1">{children}</span>
      {atajo ? <span className="dato text-coffee-400">{atajo}</span> : null}
    </DropdownMenu.Item>
  );
}

export function MenuSeparador() {
  return <DropdownMenu.Separator className="my-1.5 h-px bg-cream-300" />;
}

export function MenuRotulo({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="rotulo px-2.5 pb-1 pt-2 text-coffee-400">{children}</DropdownMenu.Label>;
}

/** El único interruptor. */
export function Interruptor({ activo, alCambiar, etiqueta, id, disabled }: { activo: boolean; alCambiar: (v: boolean) => void; etiqueta?: string; id?: string; disabled?: boolean }) {
  return (
    <Switch.Root
      id={id}
      checked={activo}
      onCheckedChange={alCambiar}
      aria-label={etiqueta}
      disabled={disabled}
      className="group relative h-6 w-11 shrink-0 rounded-full border border-cream-400 bg-cream-200 shadow-[var(--hundido)] transition-colors duration-[var(--dur-media)] data-[state=checked]:border-coffee-700 data-[state=checked]:bg-coffee-700 disabled:opacity-50"
    >
      {/* La bola corre con muelle y, mientras se pulsa, se aplasta hacia donde va. */}
      <Switch.Thumb className="tactil block h-[18px] w-[18px] origin-left translate-x-[2px] rounded-full bg-[linear-gradient(180deg,#fff_0%,#ede6d6_100%)] shadow-[inset_0_1px_0_#fff,0_1px_3px_rgb(44_24_16/0.35)] group-active:scale-x-[1.22] data-[state=checked]:origin-right data-[state=checked]:translate-x-[22px]" />
    </Switch.Root>
  );
}

export const ConsejoProveedor = Tooltip.Provider;

/** Consejo emergente al pasar o enfocar. Nunca guarda información que no esté también en otro sitio. */
export function Consejo({ texto, children, lado = 'top' }: { texto: ReactNode; children: ReactNode; lado?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip.Provider delayDuration={350}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={lado} sideOffset={6} className="z-50 rounded-lg bg-coffee-800 px-2.5 py-1.5 text-[0.75rem] font-medium text-cream-50 shadow-[var(--shadow-card)] anim-menu">
          {texto}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
    </Tooltip.Provider>
  );
}
