/**
 * La línea del tiempo como una línea de Kandinsky: un trazo fino de tinta, lo
 * oído en tinta más gruesa, los turnos de palabra como una franja de colores debajo, los
 * capítulos como círculos sobre el trazo y el cabezal como tres círculos
 * concéntricos (azul, crema, amarillo). Al pasar por encima enseña el
 * fotograma clave más cercano, el instante, quién habla y en qué capítulo.
 *
 * El cabezal y lo oído se mueven tocando el DOM desde el reloj del motor:
 * ningún render de React por fotograma.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from '@scholaris/ui';
import { tiempoACadena } from '../../lib/formato';
import { motor } from './motor';
import { buscarIndice, type Transcripcion } from './transcripcion';
import { colorHablante, FormaHablante } from './hablantes';
import { fotogramaEn, type Fotogramas } from './ganchos';

export interface Capitulo { t0: number; titulo: string }

interface Props {
  duracion: number;
  transcripcion: Transcripcion | null;
  capitulos?: Capitulo[];
  fotogramas?: Fotogramas | null;
  /** El instante citado (?t=): un triángulo amarillo encima del trazo. */
  marca?: number | null;
  oscura?: boolean;
  className?: string;
}

const fraccion = (t: number, d: number) => (d > 0 ? Math.max(0, Math.min(1, t / d)) : 0);

export const LineaTiempo = memo(function LineaTiempo({ duracion, transcripcion, capitulos = [], fotogramas, marca, oscura, className }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const oido = useRef<HTMLDivElement>(null);
  const cabezal = useRef<HTMLDivElement>(null);
  const cargado = useRef<HTMLDivElement>(null);
  const arrastrando = useRef(false);
  const ultimaBusqueda = useRef(0);
  const [vista, setVista] = useState<{ x: number; t: number; ancho: number } | null>(null);

  const pintar = useCallback((t: number) => {
    const f = fraccion(t, duracion);
    if (oido.current) oido.current.style.transform = `scaleX(${f})`;
    if (cabezal.current) cabezal.current.style.left = `${f * 100}%`;
    const r = raiz.current;
    if (r) {
      r.setAttribute('aria-valuenow', String(Math.floor(t)));
      r.setAttribute('aria-valuetext', `${tiempoACadena(t)} de ${tiempoACadena(duracion)}`);
    }
  }, [duracion]);

  // El reloj del motor mueve el cabezal; lo descargado se repinta como mucho dos veces por segundo.
  useEffect(() => {
    let ultimoCargado = 0;
    return motor().escucharTiempo((t) => {
      if (!arrastrando.current) pintar(t);
      const ahora = performance.now();
      if (ahora - ultimoCargado > 500 && cargado.current) {
        ultimoCargado = ahora;
        cargado.current.innerHTML = motor().cargado().map(([a, b]) => `<span style="left:${a * 100}%;width:${Math.max(0, b - a) * 100}%"></span>`).join('');
      }
    });
  }, [pintar]);

  const tiempoDe = (clientX: number) => {
    const r = raiz.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return { x, t: (x / r.width) * duracion, ancho: r.width };
  };

  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !duracion) return;
    raiz.current!.setPointerCapture(e.pointerId);
    arrastrando.current = true;
    const p = tiempoDe(e.clientX);
    pintar(p.t);
    setVista(p);
    motor().irA(p.t);
    ultimaBusqueda.current = performance.now();
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    if (!duracion) return;
    const p = tiempoDe(e.clientX);
    if (arrastrando.current) {
      pintar(p.t);
      // Mientras se arrastra se busca como mucho cada 120 ms: el vídeo enseña dónde está sin ahogar la red.
      if (performance.now() - ultimaBusqueda.current > 120) { motor().irA(p.t); ultimaBusqueda.current = performance.now(); }
    }
    if (e.pointerType === 'mouse' || arrastrando.current) setVista(p);
  };
  const alSoltar = (e: PointerEvent<HTMLDivElement>) => {
    if (!arrastrando.current) return;
    arrastrando.current = false;
    const p = tiempoDe(e.clientX);
    motor().irA(p.t);
    if (e.pointerType !== 'mouse') setVista(null);
  };

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const m = motor();
    const pasos: Record<string, number> = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -60, PageUp: 60 };
    if (e.key in pasos) { e.preventDefault(); e.stopPropagation(); m.saltar(pasos[e.key]!); }
    else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); m.irA(0); }
    else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); m.irA(duracion - 1); }
  };

  return (
    <div
      ref={raiz}
      role="slider"
      tabIndex={0}
      aria-label="Posición"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duracion)}
      onPointerDown={alBajar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onPointerLeave={(e) => { if (!arrastrando.current && e.pointerType === 'mouse') setVista(null); }}
      onKeyDown={alTeclear}
      className={cx('linea-tiempo group relative h-10 cursor-pointer touch-none select-none outline-none', oscura && 'linea-oscura', className)}
    >
      {/* El trazo */}
      <div className="absolute inset-x-0 top-[15px] h-[2px] rounded-full bg-[var(--linea-trazo)]" />
      <div ref={cargado} className="linea-cargado absolute inset-x-0 top-[15px] h-[2px]" />
      <div ref={oido} className="absolute inset-x-0 top-[14px] h-1 origin-left rounded-full bg-[var(--linea-oido)] will-change-transform" style={{ transform: 'scaleX(0)' }} />

      {/* Turnos de palabra */}
      {transcripcion && duracion ? <Turnos transcripcion={transcripcion} duracion={duracion} /> : null}

      {/* Capítulos: círculos sobre el trazo */}
      {capitulos.map((c) => (
        <span key={`${c.t0}-${c.titulo}`} className="pointer-events-none absolute top-[11px] h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 border-azul bg-[var(--linea-fondo)]" style={{ left: `${fraccion(c.t0, duracion) * 100}%` }} />
      ))}

      {/* El instante citado */}
      {marca != null && duracion ? (
        <svg viewBox="0 0 10 8" width="10" height="8" className="pointer-events-none absolute top-[2px] -translate-x-1/2" style={{ left: `${fraccion(marca, duracion) * 100}%` }} aria-hidden>
          <path d="M0 0 H10 L5 8 Z" fill="var(--s-amarillo)" stroke="var(--s-coffee-800)" strokeWidth="0.8" />
        </svg>
      ) : null}

      {/* El cabezal: tres círculos concéntricos */}
      <div ref={cabezal} className="pointer-events-none absolute top-[16px] left-0 -translate-x-1/2 -translate-y-1/2">
        <span className="block h-[18px] w-[18px] rounded-full border-[3px] border-azul bg-cream-50 shadow-[0_1px_3px_rgb(44_24_16/0.35)] transition-transform group-hover:scale-110 group-focus-visible:scale-110">
          <span className="m-auto mt-[3px] block h-[6px] w-[6px] rounded-full bg-amarillo" />
        </span>
      </div>

      {vista ? <Vista {...vista} duracion={duracion} transcripcion={transcripcion} capitulos={capitulos} fotogramas={fotogramas ?? null} /> : null}
    </div>
  );
});

/** La franja de turnos: un SVG estático por documento (los turnos de menos de un píxel se funden). */
const Turnos = memo(function Turnos({ transcripcion, duracion }: { transcripcion: Transcripcion; duracion: number }) {
  const rects = useMemo(() => {
    const out: Array<{ x: number; w: number; h: number }> = [];
    for (const t of transcripcion.turnos) {
      const x = (t.t0 / duracion) * 1000, w = Math.max(0.6, ((t.t1 - t.t0) / duracion) * 1000);
      const ult = out.at(-1);
      if (ult && ult.h === t.h && x - (ult.x + ult.w) < 1.5) ult.w = x + w - ult.x;
      else out.push({ x, w, h: t.h });
    }
    return out;
  }, [transcripcion, duracion]);
  if (transcripcion.hablantes.length < 2) return null;
  return (
    <svg viewBox="0 0 1000 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-[23px] h-1 w-full overflow-visible" aria-hidden>
      {rects.map((r, i) => <rect key={i} x={r.x} y="0" width={r.w} height="1" fill={colorHablante(r.h)} opacity={0.6} />)}
    </svg>
  );
});

function Vista({ x, t, ancho, duracion, transcripcion, capitulos, fotogramas }: { x: number; t: number; ancho: number; duracion: number; transcripcion: Transcripcion | null; capitulos: Capitulo[]; fotogramas: Fotogramas | null }) {
  const turno = transcripcion?.turnos[Math.max(0, buscarIndice(transcripcion.iniciosTurno, t))];
  const capitulo = [...capitulos].reverse().find((c) => c.t0 <= t);
  const f = fotogramas ? fotogramaEn(fotogramas, t) : -1;
  const anchoVista = fotogramas ? 176 : 150;
  const izquierda = Math.max(0, Math.min(ancho - anchoVista, x - anchoVista / 2));
  return (
    <>
      <span className="pointer-events-none absolute top-[6px] h-[20px] w-px bg-tinta/50" style={{ left: x }} />
      <div className="pointer-events-none absolute bottom-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-cream-400 bg-cream-50 shadow-[var(--levantado-alto)]" style={{ left: izquierda, width: anchoVista }} role="presentation">
        {fotogramas && f >= 0 ? <img src={fotogramas.url[f]} alt="" className="block aspect-video w-full bg-coffee-900 object-cover" decoding="async" /> : null}
        <div className="px-2.5 py-1.5">
          <p className="font-mono text-[0.8125rem] font-medium tnum text-coffee-800">{tiempoACadena(t)}<span className="text-apagado"> / {tiempoACadena(duracion)}</span></p>
          {turno && turno.h >= 0 && transcripcion ? (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.75rem] text-coffee-600"><FormaHablante h={turno.h} tam={8} />{transcripcion.hablantes[turno.h]}</p>
          ) : null}
          {capitulo ? <p className="mt-0.5 truncate text-[0.75rem] text-apagado">{capitulo.titulo}</p> : null}
        </div>
      </div>
    </>
  );
}
