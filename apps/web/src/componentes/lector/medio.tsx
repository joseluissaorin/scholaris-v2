/**
 * Audio y vídeo: el reproductor arriba, la transcripción debajo, palabra a
 * palabra (karaoke). Cada marca de tiempo es un enlace; pulsar una palabra
 * salta a ese instante. Seleccionar texto cita con el segundo exacto.
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { DetalleDocumento, UnidadVista } from '@scholaris/contrato';
import { Chip, cx, EsqueletoTexto, Icono, Rotulo } from '@scholaris/ui';
import { BLOQUE, q } from '../../datos/consultas';
import { tiempoACadena } from '../../lib/formato';
import { raicesDe } from './markdown';

export interface ManejadorMedio { irA: (t: number) => void }

interface Reloj { t: number; dur: number; sonando: boolean; vel: number; play: () => void; pausa: () => void; ir: (t: number) => void; ponerVel: (v: number) => void }

/** Reloj del medio: el elemento <audio>/<video> si hay fuente; si no, uno virtual (demostración). */
function useReloj(el: HTMLMediaElement | null, duracion: number, inicial: number): Reloj {
  const [t, setT] = useState(inicial);
  const [sonando, setSonando] = useState(false);
  const [vel, setVel] = useState(1);
  const virtual = !el;
  const ultimo = useRef(performance.now());

  useEffect(() => {
    if (!el) return;
    const act = () => setT(el.currentTime);
    const on = () => setSonando(true), off = () => setSonando(false);
    el.addEventListener('timeupdate', act); el.addEventListener('play', on); el.addEventListener('pause', off);
    if (inicial) el.currentTime = inicial;
    let h = 0;
    const bucle = () => { if (!el.paused) setT(el.currentTime); h = requestAnimationFrame(bucle); };
    h = requestAnimationFrame(bucle);
    return () => { el.removeEventListener('timeupdate', act); el.removeEventListener('play', on); el.removeEventListener('pause', off); cancelAnimationFrame(h); };
  }, [el]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!virtual || !sonando) return;
    ultimo.current = performance.now();
    let h = 0;
    const bucle = (ahora: number) => {
      const dt = (ahora - ultimo.current) / 1000; ultimo.current = ahora;
      setT((x) => { const n = x + dt * vel; if (n >= duracion) { setSonando(false); return duracion; } return n; });
      h = requestAnimationFrame(bucle);
    };
    h = requestAnimationFrame(bucle);
    return () => cancelAnimationFrame(h);
  }, [virtual, sonando, vel, duracion]);

  return {
    t, dur: el?.duration && Number.isFinite(el.duration) ? el.duration : duracion, sonando, vel,
    play: () => (el ? void el.play() : setSonando(true)),
    pausa: () => (el ? el.pause() : setSonando(false)),
    ir: (x) => { const n = Math.max(0, Math.min(duracion, x)); if (el) el.currentTime = n; setT(n); },
    ponerVel: (v) => { if (el) el.playbackRate = v; setVel(v); },
  };
}

function palabrasDe(u: UnidadVista) {
  if (u.ancla.tipo !== 'tiempo') return [];
  const { t0, t1 } = u.ancla;
  const ps = u.texto.replace(/\s+/g, ' ').trim().split(' ');
  const pesos = ps.map((p) => p.length + 2);
  const total = pesos.reduce((a, b) => a + b, 0);
  let acum = 0;
  return ps.map((p, i) => { const a = t0 + ((t1 - t0) * acum) / total; acum += pesos[i]!; return { p, t0: a, t1: t0 + ((t1 - t0) * acum) / total }; });
}

export const Medio = forwardRef<ManejadorMedio, { doc: DetalleDocumento; url?: string | null; inicial: number; resaltar?: string; alVer: (orden: number, t: number) => void }>(
  function Medio({ doc, url, inicial, resaltar, alVer }, ref) {
    const [el, setEl] = useState<HTMLMediaElement | null>(null);
    const duracion = doc.duracion ?? doc.unidades * 60;
    const r = useReloj(url ? el : null, duracion, inicial);
    const [seguir, setSeguir] = useState(true);
    const contenedor = useRef<HTMLDivElement>(null);
    const [margen, setMargen] = useState(0);
    useLayoutEffect(() => { setMargen((contenedor.current?.getBoundingClientRect().top ?? 0) + window.scrollY); }, []);
    const paso = duracion / doc.unidades;
    const actual = Math.min(doc.unidades, Math.floor(r.t / paso) + 1);
    const v = useWindowVirtualizer({ count: doc.unidades, estimateSize: () => 132, overscan: 4, scrollMargin: margen });

    useImperativeHandle(ref, () => ({ irA: (t) => { r.ir(t); setSeguir(true); } }), [r]);
    useEffect(() => { alVer(actual, r.t); }, [actual, Math.floor(r.t)]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seguir la voz: si el usuario se desplaza a mano, se deja de seguir hasta que lo pida.
    useEffect(() => {
      const mano = () => setSeguir(false);
      window.addEventListener('wheel', mano, { passive: true });
      window.addEventListener('touchmove', mano, { passive: true });
      return () => { window.removeEventListener('wheel', mano); window.removeEventListener('touchmove', mano); };
    }, []);
    useEffect(() => { if (seguir && margen) v.scrollToIndex(actual - 1, { align: 'center', behavior: r.sonando ? 'smooth' : 'auto' }); }, [actual, seguir, margen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Teclado: espacio reproduce, flechas saltan 10 s.
    useEffect(() => {
      const k = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || e.metaKey || e.ctrlKey) return;
        if (e.key === ' ') { e.preventDefault(); r.sonando ? r.pausa() : r.play(); }
        if (e.key === 'ArrowRight') r.ir(r.t + 10);
        if (e.key === 'ArrowLeft') r.ir(r.t - 10);
      };
      window.addEventListener('keydown', k);
      return () => window.removeEventListener('keydown', k);
    }, [r]);

    const ir = useCallback((t: number) => { r.ir(t); if (!r.sonando) r.play(); setSeguir(true); }, [r]);

    return (
      <div>
        <div className="sticky top-[7.5rem] z-20 -mx-5 border-b border-filete bg-papel/95 px-5 pb-4 pt-2 backdrop-blur md:top-[4.25rem] md:-mx-12 md:px-12">
          {doc.tipo === 'video' ? (
            url ? <video ref={setEl} src={url} className="mx-auto max-h-[38vh] w-full max-w-3xl rounded-s bg-black" playsInline preload="metadata" /> : (
              <div className="relative mx-auto grid aspect-video max-h-[34vh] w-full max-w-3xl place-items-center overflow-hidden rounded-s bg-tinta text-sobre-tinta">
                <svg viewBox="0 0 160 90" className="absolute inset-0 h-full w-full opacity-90" aria-hidden><rect x="0" y="0" width="160" height="90" fill="var(--s-azul)" /><circle cx="122" cy="70" r="46" fill="var(--s-amarillo)" /><rect x="14" y="16" width="62" height="40" fill="#22160f" /></svg>
                <span className="relative font-mono text-[2rem] tnum">{tiempoACadena(r.t)}</span>
              </div>
            )
          ) : url ? <audio ref={setEl} src={url} preload="metadata" /> : null}
          <Controles r={r} />
        </div>

        <div className="mt-2 flex items-center gap-2 py-3">
          <Rotulo>{doc.unidades} tramos · transcripción con marcas por palabra</Rotulo>
          {!seguir ? <Chip icono="audio" className="ml-auto" onClick={() => setSeguir(true)}>Seguir la voz</Chip> : null}
        </div>

        <div ref={contenedor} className="relative" style={{ height: v.getTotalSize() }}>
          {v.getVirtualItems().map((it) => (
            <div key={it.key} data-index={it.index} ref={v.measureElement} className="absolute inset-x-0" style={{ transform: `translateY(${it.start - v.options.scrollMargin}px)` }}>
              <Tramo docId={doc.id} orden={it.index + 1} t={actual === it.index + 1 ? r.t : null} futuro={it.index + 1 > actual} ir={ir} resaltar={resaltar} />
            </div>
          ))}
        </div>
      </div>
    );
  },
);

function Controles({ r }: { r: Reloj }) {
  const VELS = [1, 1.25, 1.5, 2, 0.75];
  return (
    <div className="mx-auto mt-3 flex max-w-3xl items-center gap-3">
      <button type="button" onClick={() => r.ir(r.t - 10)} aria-label="Atrás 10 segundos" className="tactil-grande grid h-10 w-10 place-items-center rounded-s text-tinta-2 hover:bg-hondo hover:text-tinta"><span className="font-mono text-[0.75rem]">−10</span></button>
      <button type="button" onClick={r.sonando ? r.pausa : r.play} aria-label={r.sonando ? 'Pausa' : 'Reproducir'} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tinta text-sobre-tinta hover:bg-tinta-2">
        <Icono nombre={r.sonando ? 'pausa' : 'play'} tam={18} grosor={2.4} />
      </button>
      <button type="button" onClick={() => r.ir(r.t + 10)} aria-label="Adelante 10 segundos" className="tactil-grande grid h-10 w-10 place-items-center rounded-s text-tinta-2 hover:bg-hondo hover:text-tinta"><span className="font-mono text-[0.75rem]">+10</span></button>
      <span className="tnum w-16 shrink-0 text-right font-mono text-[0.875rem]">{tiempoACadena(r.t)}</span>
      <input
        type="range" min={0} max={Math.round(r.dur)} step={1} value={Math.round(r.t)} onChange={(e) => r.ir(Number(e.target.value))}
        aria-label="Posición" aria-valuetext={tiempoACadena(r.t)}
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none bg-hondo accent-[var(--s-rojo)] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-rojo"
        style={{ background: `linear-gradient(to right, var(--s-rojo) ${(r.t / r.dur) * 100}%, var(--s-hondo) ${(r.t / r.dur) * 100}%)` }}
      />
      <span className="tnum hidden w-16 shrink-0 font-mono text-[0.875rem] text-apagado sm:block">{tiempoACadena(r.dur)}</span>
      <button type="button" onClick={() => r.ponerVel(VELS[(VELS.indexOf(r.vel) + 1) % VELS.length]!)} aria-label={`Velocidad ${r.vel}×`} className="h-8 shrink-0 rounded-full border border-filete-fuerte px-2.5 font-mono text-[0.75rem] hover:border-tinta">{r.vel.toLocaleString('es-ES')}×</button>
    </div>
  );
}

const Tramo = memo(function Tramo({ docId, orden, t, futuro, ir, resaltar }: { docId: string; orden: number; t: number | null; futuro: boolean; ir: (t: number) => void; resaltar?: string }) {
  const { data } = useQuery(q.bloque(docId, Math.floor((orden - 1) / BLOQUE)));
  const u = data?.find((x) => x.orden === orden);
  if (!u || u.ancla.tipo !== 'tiempo') return <div className="py-4"><EsqueletoTexto lineas={3} /></div>;
  const ancla = u.ancla;
  const palabras = palabrasDe(u);
  const raices = raicesDe(resaltar);
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return (
    <section data-orden={orden} className={cx('grid grid-cols-[4.75rem_minmax(0,1fr)] gap-4 border-l-[3px] py-4 pl-3 md:grid-cols-[6rem_minmax(0,44rem)] md:gap-8', t != null ? 'border-rojo' : 'border-transparent', futuro && 'tramo-futuro')}>
      <div className="flex flex-col items-start gap-1">
        <button type="button" onClick={() => ir(ancla.t0)} className="border-l-2 border-rojo pl-1.5 font-mono text-[0.8125rem] tnum hover:bg-hondo" aria-label={`Ir a ${tiempoACadena(ancla.t0)}`}>{tiempoACadena(ancla.t0)}</button>
        {ancla.hablante ? <span className="rotulo text-[0.625rem] leading-tight text-apagado">{ancla.hablante}</span> : null}
      </div>
      <p className="lectura">
        {palabras.map((w, i) => {
          const ahora = t != null && t >= w.t0 && t < w.t1;
          const dicha = t != null && t >= w.t1;
          const marcada = raices.length && raices.some((r) => norm(w.p).startsWith(r));
          return (
            <span key={i}>
              <span className="palabra" data-ahora={ahora || undefined} data-dicha={dicha || undefined} onClick={() => ir(w.t0)}>{marcada ? <mark>{w.p}</mark> : w.p}</span>{' '}
            </span>
          );
        })}
      </p>
    </section>
  );
});
