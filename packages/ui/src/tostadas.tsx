import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { cx } from './cx';
import { Icono } from './iconos';

/**
 * Tostadas: el único canal de avisos. Sustituyen a los diálogos de confirmación:
 * la acción se hace al momento y la tostada ofrece «Deshacer».
 */
export interface Tostada {
  id: number;
  mensaje: string;
  tono: 'normal' | 'exito' | 'error';
  accion?: { etiqueta: string; alPulsar: () => void };
  duracion: number;
  /** Se está yendo: baja y se desvanece antes de quitarse. */
  sale?: boolean;
}

let tostadas: Tostada[] = [];
let siguiente = 1;
const oyentes = new Set<() => void>();
const emitir = () => oyentes.forEach((o) => o());

export function avisar(mensaje: string, opciones: Partial<Omit<Tostada, 'id' | 'mensaje'>> = {}): number {
  const id = siguiente++;
  const t: Tostada = { id, mensaje, tono: opciones.tono ?? 'normal', accion: opciones.accion, duracion: opciones.duracion ?? (opciones.accion ? 7000 : 4200) };
  tostadas = [...tostadas.slice(-3), t];
  emitir();
  return id;
}

/** Hace algo y ofrece deshacerlo. `confirmar` se llama si nadie deshace a tiempo. */
export function conDeshacer(mensaje: string, deshacer: () => void, confirmar?: () => void): void {
  let deshecho = false;
  const id = avisar(mensaje, {
    accion: { etiqueta: 'Deshacer', alPulsar: () => { deshecho = true; deshacer(); } },
  });
  if (confirmar) setTimeout(() => { if (!deshecho) confirmar(); }, 7200);
  void id;
}

export function retirar(id: number) {
  // Primero se marca (y se va con su animación); después se quita de la lista.
  if (!tostadas.some((t) => t.id === id && !t.sale)) return;
  tostadas = tostadas.map((t) => (t.id === id ? { ...t, sale: true } : t));
  emitir();
  setTimeout(() => { tostadas = tostadas.filter((t) => t.id !== id); emitir(); }, 170);
}

function suscribir(o: () => void) {
  oyentes.add(o);
  return () => oyentes.delete(o);
}

function UnaTostada({ t }: { t: Tostada }) {
  useEffect(() => {
    const h = setTimeout(() => retirar(t.id), t.duracion);
    return () => clearTimeout(h);
  }, [t.id, t.duracion]);
  return (
    <div
      data-tostada={t.id}
      role={t.tono === 'error' ? 'alert' : 'status'}
      className={cx(
        'pointer-events-auto flex min-h-11 w-full max-w-md items-center gap-3 rounded-xl border px-4 py-2',
        t.sale ? '[animation:s-tostada-sale_0.17s_var(--ease-salida)_both]' : 'anim-tostada',
        'border-[#1a0f0a] bg-[#2c1810] text-[#faf7f0] shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_8px_30px_rgb(44_24_16/0.3)]',
      )}
    >
      <span className={cx('h-2 w-2 shrink-0', t.tono === 'error' ? 'bg-[#e0705f]' : t.tono === 'exito' ? 'rounded-full bg-[#e8a838]' : 'rounded-full bg-[#d4c4b0]')} aria-hidden />
      <span className="flex-1 text-[0.875rem]">{t.mensaje}</span>
      {t.accion ? (
        <button
          type="button"
          className="-mr-1 rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-semibold text-[#e8a838] hover:bg-white/10"
          onClick={() => { t.accion?.alPulsar(); retirar(t.id); }}
        >
          {t.accion.etiqueta}
        </button>
      ) : null}
      <button type="button" aria-label="Cerrar aviso" className="-mr-2 grid h-7 w-7 place-items-center rounded-lg opacity-60 hover:opacity-100" onClick={() => retirar(t.id)}>
        <Icono nombre="cerrar" tam={14} />
      </button>
    </div>
  );
}

/** Se monta una vez, en la raíz. */
export function Tostadora() {
  const lista = useSyncExternalStore(suscribir, () => tostadas, () => tostadas);
  const pila = useRef<HTMLDivElement>(null);
  const antes = useRef(new Map<string, number>());
  // FLIP: cuando una tostada se va, las demás se deslizan a su sitio en vez de saltar.
  useLayoutEffect(() => {
    const ahora = new Map<string, number>();
    pila.current?.querySelectorAll<HTMLElement>('[data-tostada]').forEach((el) => {
      const y = el.offsetTop;
      ahora.set(el.dataset.tostada!, y);
      const previo = antes.current.get(el.dataset.tostada!);
      if (previo != null && previo !== y && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.animate([{ transform: `translateY(${previo - y}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', composite: 'add' });
      }
    });
    antes.current = ahora;
  }, [lista]);
  return (
    <div ref={pila} aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[60] flex flex-col items-center gap-2 px-3 md:bottom-6">
      {lista.map((t) => <UnaTostada key={t.id} t={t} />)}
    </div>
  );
}
