/**
 * La transcripción sincronizada.
 *
 * - Virtualizada por párrafos (un turno dentro de un tramo): una entrevista
 *   de dos horas son unos cientos de párrafos y solo existen los visibles.
 * - El karaoke no re-renderiza: el reloj del motor busca la palabra por
 *   búsqueda binaria y, solo si cambia, mueve dos atributos en el DOM.
 * - Sigue a la voz con un desplazamiento suave que se aparta en cuanto la
 *   persona mueve la rueda, toca o usa el teclado; «Volver a la voz» lo retoma.
 * - Pulsar una palabra salta a ella; seleccionar un pasaje lo cita con su
 *   intervalo exacto [t0-t1].
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { cx, EsqueletoTexto } from '@scholaris/ui';
import { tiempoACadena } from '../../lib/formato';
import { motor } from './motor';
import { normalizar, palabraEn, parrafoEn, type Parrafo, type Transcripcion } from './transcripcion';
import { FormaHablante } from './hablantes';
import { menosMovimiento } from './ganchos';

export interface ManejadorTranscripcion {
  /** Lleva la vista a una palabra (sin tocar la reproducción). */
  verPalabra: (w: number) => void;
  seguir: () => void;
}

interface Props {
  transcripcion: Transcripcion | null;
  /** Índices de palabra marcados (búsqueda dentro de la transcripción). */
  marcadas: Uint8Array | null;
  /** Palabra enfocada por la búsqueda. */
  foco: number | null;
  /** Términos de la búsqueda que abrió el documento (?q=): se marcan más suave. */
  resaltar?: string;
  /** Borde superior útil de la ventana (lo que tapa el escenario pegado y las barras). */
  margenSuperior: () => number;
  seguir: boolean;
  alCambiarSeguir: (v: boolean) => void;
  /** Unidades aún no leídas (ingesta en curso). */
  pendientes?: number;
}

const ADELANTO = 0.25;

const estimar = (p: Parrafo) => 36 + Math.ceil(((p.hasta - p.desde) * 6.4) / 64) * 29 + (p.turno ? 26 : 0);

export const TranscripcionVista = forwardRef<ManejadorTranscripcion, Props>(function TranscripcionVista(
  { transcripcion: tr, marcadas, foco, resaltar, margenSuperior, seguir, alCambiarSeguir, pendientes }, ref,
) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [margen, setMargen] = useState(0);
  useLayoutEffect(() => {
    const medir = () => setMargen((contenedor.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [tr == null]);

  const parrafos = tr?.parrafos ?? [];
  const v = useWindowVirtualizer({
    count: parrafos.length,
    estimateSize: (i) => estimar(parrafos[i]!),
    overscan: 6,
    scrollMargin: margen,
  });

  // --- karaoke -------------------------------------------------------------
  const actual = useRef({ w: -1, p: -1 });
  const seguirRef = useRef(seguir);
  seguirRef.current = seguir;
  const animacion = useRef(0);

  const nodoPalabra = (w: number) => contenedor.current?.querySelector<HTMLElement>(`[data-w="${w}"]`) ?? null;

  /** Pone los atributos del párrafo y la palabra actuales en lo que esté pintado. */
  const aplicar = useCallback((w: number, p: number, previo: { w: number; p: number }) => {
    const c = contenedor.current;
    if (!c || !tr) return;
    if (previo.w >= 0 && previo.w !== w) nodoPalabra(previo.w)?.removeAttribute('data-ahora');
    if (w >= 0) nodoPalabra(w)?.setAttribute('data-ahora', 'true');
    // Estado de cada párrafo pintado y lo ya dicho dentro del actual.
    for (const s of c.querySelectorAll<HTMLElement>('[data-p]')) {
      const i = Number(s.dataset.p);
      const e = i < p ? 'pasado' : i === p ? 'actual' : 'futuro';
      if (s.dataset.estado !== e) s.dataset.estado = e;
      if (i === p) {
        for (const n of s.querySelectorAll<HTMLElement>('[data-w]')) {
          const k = Number(n.dataset.w);
          const dicha = w >= 0 ? k <= w : (tr.palabras[k]?.t1 ?? Infinity) <= motor().tiempo();
          if (dicha !== (n.dataset.dicha === 'true')) { if (dicha) n.dataset.dicha = 'true'; else delete n.dataset.dicha; }
        }
      }
    }
  }, [tr]);

  const desplazarA = useCallback((y: number, suave: boolean) => {
    cancelAnimationFrame(animacion.current);
    const desde = window.scrollY;
    const d = y - desde;
    if (Math.abs(d) < 2) return;
    if (!suave || menosMovimiento() || Math.abs(d) > window.innerHeight * 1.5) { window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }); return; }
    const t0 = performance.now(), dur = 520;
    const paso = (ahora: number) => {
      const k = Math.min(1, (ahora - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      window.scrollTo({ top: desde + d * e, behavior: 'instant' as ScrollBehavior });
      if (k < 1) animacion.current = requestAnimationFrame(paso);
    };
    animacion.current = requestAnimationFrame(paso);
  }, []);

  /** Si la palabra actual se sale de la franja cómoda (25 %-65 % de lo visible), se recoloca al 38 %. */
  const acompanar = useCallback((w: number, p: number, suave: boolean) => {
    if (!tr || p < 0) return;
    const arriba = margenSuperior();
    const abajo = window.innerHeight;
    const alto = abajo - arriba;
    const n = w >= 0 ? nodoPalabra(w) : contenedor.current?.querySelector<HTMLElement>(`[data-p="${p}"]`);
    if (!n) { v.scrollToIndex(p, { align: 'center' }); return; }
    const r = n.getBoundingClientRect();
    if (r.top >= arriba + alto * 0.25 && r.bottom <= arriba + alto * 0.65) return;
    desplazarA(window.scrollY + r.top - (arriba + alto * 0.38), suave);
  }, [tr, margenSuperior, v, desplazarA]);

  useEffect(() => {
    if (!tr) return;
    return motor().escucharTiempo((t) => {
      // Un cuarto de segundo de adelanto: el ojo llega a la palabra cuando suena.
      const w = palabraEn(tr, t + ADELANTO);
      const p = w >= 0 ? tr.palabras[w]!.p : parrafoEn(tr, t + ADELANTO);
      const previo = actual.current;
      if (w === previo.w && p === previo.p) return;
      actual.current = { w, p };
      aplicar(w, p, previo);
      if (seguirRef.current) acompanar(w, p, motor().instantanea().estado === 'sonando');
    });
  }, [tr, aplicar, acompanar]);

  // Lo que el virtualizador pinta de nuevo recibe el estado actual.
  const items = v.getVirtualItems();
  const clave = items.map((i) => i.index).join(',');
  useLayoutEffect(() => { aplicar(actual.current.w, actual.current.p, { w: -1, p: -1 }); }, [clave, aplicar, marcadas]);

  // Al volver a seguir, se recoloca enseguida.
  useEffect(() => {
    if (seguir && tr) acompanar(actual.current.w, actual.current.p < 0 ? parrafoEn(tr, motor().tiempo()) : actual.current.p, true);
  }, [seguir]); // eslint-disable-line react-hooks/exhaustive-deps

  // La persona se desplaza a mano: se deja de seguir.
  useEffect(() => {
    const soltar = () => { cancelAnimationFrame(animacion.current); if (seguirRef.current) alCambiarSeguir(false); };
    const teclas = (e: KeyboardEvent) => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && !(e.target as HTMLElement).closest('[role="slider"],input,textarea')) soltar(); };
    const barra = (e: PointerEvent) => { if (e.target === document.documentElement) soltar(); };
    window.addEventListener('wheel', soltar, { passive: true });
    window.addEventListener('touchmove', soltar, { passive: true });
    window.addEventListener('keydown', teclas);
    window.addEventListener('pointerdown', barra);
    return () => { window.removeEventListener('wheel', soltar); window.removeEventListener('touchmove', soltar); window.removeEventListener('keydown', teclas); window.removeEventListener('pointerdown', barra); };
  }, [alCambiarSeguir]);

  useImperativeHandle(ref, () => ({
    verPalabra: (w) => {
      if (!tr) return;
      const p = tr.palabras[w]?.p ?? 0;
      const n = nodoPalabra(w);
      if (n) { const r = n.getBoundingClientRect(); const arriba = margenSuperior(); desplazarA(window.scrollY + r.top - (arriba + (window.innerHeight - arriba) * 0.38), true); }
      else v.scrollToIndex(p, { align: 'center' });
    },
    seguir: () => alCambiarSeguir(true),
  }), [tr, v, margenSuperior, desplazarA, alCambiarSeguir]);

  const raices = useMemo(() => (resaltar ? resaltar.split(/\s+/).map(normalizar).filter((x) => x.length > 2).map((x) => x.slice(0, Math.max(4, x.length - 2))) : []), [resaltar]);

  if (!tr) {
    return <div className="flex flex-col gap-6 py-4" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <EsqueletoTexto key={i} lineas={4} />)}</div>;
  }
  if (!tr.palabras.length) {
    return <p className="py-8 text-[0.9375rem] text-apagado">{pendientes ? 'La transcripción se está escribiendo; aparecerá aquí en cuanto esté el primer tramo.' : 'Este archivo no tiene transcripción.'}</p>;
  }

  return (
    <div ref={contenedor} role="region" aria-label="Transcripción" className="transcripcion relative" style={{ height: v.getTotalSize() }}>
      {items.map((it) => (
        <div key={it.key} data-index={it.index} ref={v.measureElement} className="absolute inset-x-0" style={{ top: it.start - v.options.scrollMargin }}>
          <ParrafoVista tr={tr} i={it.index} marcadas={marcadas} foco={foco} raices={raices} alSeguir={() => alCambiarSeguir(true)} />
        </div>
      ))}
      {pendientes ? <p className="absolute inset-x-0 bottom-0 py-6 text-[0.875rem] text-apagado" style={{ top: v.getTotalSize() }}>Faltan {pendientes} tramos por transcribir…</p> : null}
    </div>
  );
});

const ParrafoVista = memo(function ParrafoVista({ tr, i, marcadas, foco, raices, alSeguir }: { tr: Transcripcion; i: number; marcadas: Uint8Array | null; foco: number | null; raices: string[]; alSeguir: () => void }) {
  const p = tr.parrafos[i]!;
  const anterior = tr.parrafos[i - 1];
  // La marca de tiempo solo al empezar turno o si han pasado 40 s desde la última visible.
  const marcaTiempo = p.turno || !anterior || Math.floor(p.t0 / 40) !== Math.floor(anterior.t0 / 40);
  const ws = tr.palabras.slice(p.desde, p.hasta);
  const ir = (t: number) => {
    const s = document.getSelection();
    if (s && !s.isCollapsed) return;
    motor().irA(t, { sonar: true });
    alSeguir();
  };
  return (
    <section data-p={i} data-orden={p.orden} className={cx('parrafo grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-4 md:grid-cols-[4.5rem_minmax(0,1fr)] md:gap-x-6', p.turno ? 'pt-5 pb-1.5' : 'py-1.5')}>
      <div className="pt-[0.3rem] text-right">
        {marcaTiempo ? (
          <button type="button" onClick={() => ir(p.t0)} className="folio-tiempo rounded-md px-1 font-mono text-[0.75rem] tnum text-apagado hover:bg-cream-200 hover:text-coffee-800 focus-visible:bg-cream-200" aria-label={`Ir a ${tiempoACadena(p.t0)}`}>
            {tiempoACadena(p.t0)}
          </button>
        ) : null}
      </div>
      <div className="min-w-0">
        {p.turno && p.h >= 0 ? (
          <p className="mb-1 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-coffee-600">
            <FormaHablante h={p.h} tam={9} />{tr.hablantes[p.h]}
          </p>
        ) : null}
        <p className="lectura">
          {ws.map((w, j) => {
            const k = p.desde + j;
            const marcada = marcadas?.[k] === 1;
            const sugerida = !marcada && raices.length > 0 && raices.some((r) => normalizar(w.texto).startsWith(r));
            return (
              <span key={k}>
                <span data-w={k} className="palabra" data-marca={marcada ? (foco === k ? 'foco' : 'si') : sugerida ? 'suave' : undefined} onClick={() => ir(w.t0)}>{w.texto}</span>{' '}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
});
