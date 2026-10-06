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
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_21_17/0.38)] backdrop-blur-[2px] anim-aparece" />
        <Dialog.Content
          className={cx(
            'fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-m border border-filete-fuerte bg-hoja shadow-flota anim-dialogo focus:outline-none',
            ancho === 'g' ? 'max-w-2xl' : 'max-w-md',
            className,
          )}
          aria-describedby={descripcion ? undefined : undefined}
        >
          <div className={cx('px-6 pt-5', tituloOculto && 'sr-only')}>
            <Dialog.Title className="titular text-[1.625rem] text-tinta">{titulo}</Dialog.Title>
            {descripcion ? <Dialog.Description className="mt-2 text-[0.9375rem] text-tinta-2">{descripcion}</Dialog.Description> : null}
          </div>
          {children ? <div className={cx(!tituloOculto && 'px-6 pb-2 pt-4')}>{children}</div> : null}
          {pie ? <div className="flex justify-end gap-2 border-t border-filete px-6 py-3">{pie}</div> : null}
          <Dialog.Close className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-tinta" aria-label="Cerrar">
            <Icono nombre="cerrar" tam={16} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const MenuRaiz = DropdownMenu.Root;
export const MenuDisparador = DropdownMenu.Trigger;

export function MenuContenido({ children, className, alinear = 'end' }: { children: ReactNode; className?: string; alinear?: 'start' | 'end' | 'center' }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={alinear}
        sideOffset={6}
        className={cx('z-50 min-w-48 rounded-m border border-filete-fuerte bg-hoja p-1 shadow-flota anim-dialogo', className)}
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
        'flex h-9 cursor-default select-none items-center gap-2.5 rounded-s px-2.5 text-[0.9rem] outline-none data-[highlighted]:bg-hondo',
        peligro ? 'text-rojo' : 'text-tinta',
      )}
    >
      {icono ? <Icono nombre={icono} tam={16} /> : <span className="w-4" />}
      <span className="flex-1">{children}</span>
      {atajo ? <span className="rotulo text-apagado">{atajo}</span> : null}
    </DropdownMenu.Item>
  );
}

export function MenuSeparador() {
  return <DropdownMenu.Separator className="my-1 h-px bg-filete" />;
}

export function MenuRotulo({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="rotulo px-2.5 pb-1 pt-2 text-apagado">{children}</DropdownMenu.Label>;
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
      className="relative h-6 w-11 shrink-0 rounded-full border border-filete-fuerte bg-hondo transition-colors data-[state=checked]:border-tinta data-[state=checked]:bg-tinta disabled:opacity-50"
    >
      <Switch.Thumb className="block h-4 w-4 translate-x-[3px] rounded-full bg-hoja shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-150 data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-amarillo" />
    </Switch.Root>
  );
}

export const ConsejoProveedor = Tooltip.Provider;

/** Consejo emergente al pasar o enfocar. Nunca guarda información que no esté también en otro sitio. */
export function Consejo({ texto, children, lado = 'top' }: { texto: ReactNode; children: ReactNode; lado?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={lado} sideOffset={6} className="z-50 rounded-s bg-tinta px-2 py-1 text-[0.75rem] text-sobre-tinta anim-aparece">
          {texto}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
