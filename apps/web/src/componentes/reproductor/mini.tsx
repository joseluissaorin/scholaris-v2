/**
 * El reproductor pequeño: aparece al salir del lector mientras suena un audio
 * o un vídeo, y sigue sonando mientras se navega por la aplicación. Pulsar el
 * título vuelve al lector en el instante en que va.
 */
import { AccesoReferencia } from '../comunes/boton-referencia';
import { useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { cx, Icono } from '@scholaris/ui';
import { tiempoACadena } from '../../lib/formato';
import { motor } from './motor';
import { useMotor, useRelojDom } from './ganchos';

export default function MiniReproductor() {
  const m = motor();
  const inst = useMotor();
  const hueco = useRef<HTMLDivElement>(null);
  const reloj = useRef<HTMLSpanElement>(null);
  const progreso = useRef<HTMLDivElement>(null);
  useRelojDom(reloj);

  useLayoutEffect(() => {
    const n = hueco.current;
    if (!n || !inst.mini) return;
    m.alojar(n, 'mini');
    return () => m.desalojar(n);
  }, [m, inst.mini]);

  useLayoutEffect(() => m.escucharTiempo((t) => {
    if (progreso.current && inst.duracion) progreso.current.style.transform = `scaleX(${Math.min(1, t / inst.duracion)})`;
  }), [m, inst.duracion]);

  if (!inst.mini || !inst.documento) return null;
  const video = inst.tipo === 'video';
  return (
    <aside aria-label="Reproductor" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-3 right-[5.25rem] z-40 overflow-hidden rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado-alto),0_12px_32px_rgb(44_24_16/0.18)] anim-tostada sm:left-auto sm:right-5 sm:w-[23rem] lg:bottom-5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-cream-300"><div ref={progreso} className="h-full origin-left bg-rojo will-change-transform" style={{ transform: 'scaleX(0)' }} /></div>
      <div className="flex items-center gap-3 p-2.5 pt-3">
        <div className={cx('relative shrink-0 overflow-hidden rounded-lg', video ? 'h-[3.375rem] w-24 bg-coffee-900' : 'h-11 w-11')}>
          <div ref={hueco} className={video ? 'absolute inset-0' : 'absolute h-0 w-0 overflow-hidden'} />
          {!video ? (
            <svg viewBox="0 0 44 44" className="h-11 w-11" aria-hidden>
              <circle cx="22" cy="22" r="21" fill="var(--s-azul)" /><circle cx="22" cy="22" r="14" fill="var(--s-cream-50)" /><circle cx="22" cy="22" r="8" fill="var(--s-amarillo)" /><circle cx="22" cy="22" r="3" fill="var(--s-coffee-800)" />
            </svg>
          ) : null}
        </div>
        <Link to="/lector/$id" params={{ id: inst.documento }} className="min-w-0 flex-1" aria-label={`Volver a «${inst.titulo}»`}>
          <p className="truncate text-[0.875rem] font-semibold leading-tight text-coffee-800 hover:underline">{inst.titulo}</p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-[0.75rem] tnum text-apagado"><span ref={reloj}>0:00</span> / {tiempoACadena(inst.duracion)}</p>
        </Link>
        <button type="button" onClick={() => m.alternar()} aria-label={inst.quiere ? 'Pausa' : 'Reproducir'} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#1a0f0a] bg-[linear-gradient(180deg,#4a2e1a_0%,#2c1810_100%)] text-cream-50 shadow-[var(--relieve-oscuro)] active:translate-y-px">
          <Icono nombre={inst.quiere ? 'pausa' : 'play'} tam={15} grosor={2.4} />
        </button>
        <AccesoReferencia documento={inst.documento} className="h-9 px-2" />
        <button type="button" onClick={() => m.cerrarMini()} aria-label="Cerrar el reproductor" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-apagado hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="cerrar" tam={16} /></button>
      </div>
    </aside>
  );
}
