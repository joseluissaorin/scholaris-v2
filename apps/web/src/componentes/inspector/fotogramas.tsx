/**
 * Los fotogramas clave de un vídeo con lo que se ve en cada uno: la tira del
 * reproductor (buscable, con el actual marcado, pulsar salta a ese segundo) y
 * las marcas de escena dentro de la transcripción.
 */
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { cx, Icono } from '@scholaris/ui';
import { motor } from '../reproductor/motor';
import { buscarIndice } from '../reproductor/transcripcion';
import { tiempoACadena } from '../../lib/formato';
import { esVacio, ImagenFigura, useFigurasDocumento, VisorFigura, type FiguraVisor } from './figuras';
import { coincide, sinTildes } from './texto';

/** Las escenas que merece la pena marcar: sin fundidos a negro y sin repetir lo mismo seguido. */
export interface Escenas { lista: FiguraVisor[]; inicios: Float64Array }

export function useEscenas(documento: string, activo: boolean): Escenas | null {
  const { figuras } = useFigurasDocumento(documento, activo);
  return useMemo(() => {
    const fs = figuras.filter((f) => f.t !== undefined && !esVacio(f));
    if (!fs.length) return null;
    const lista: FiguraVisor[] = [];
    let previa = '';
    let ultimo = -Infinity;
    for (const f of fs) {
      const clave = sinTildes(f.descripcion ?? '').replace(/[^\p{L}\s]/gu, '').split(/\s+/).slice(0, 8).join(' ');
      if (clave && clave === previa) continue;
      // En la transcripción, una marca cada 45 s como mucho, salvo los cambios de escena.
      if (!f.escena && (f.t ?? 0) - ultimo < 45) continue;
      previa = clave;
      ultimo = f.t ?? 0;
      lista.push(f);
    }
    return { lista, inicios: Float64Array.from(lista, (f) => f.t ?? 0) };
  }, [figuras]);
}

/** Las escenas que empiezan en [t0, t1). */
export function escenasEntre(e: Escenas, t0: number, t1: number): FiguraVisor[] {
  const out: FiguraVisor[] = [];
  for (let i = Math.max(0, buscarIndice(e.inicios, t0 - 0.001) + 1); i < e.lista.length && e.inicios[i]! < t1; i++) out.push(e.lista[i]!);
  if (!out.length && t0 === 0 && e.lista[0] && e.inicios[0] === 0) out.push(e.lista[0]);
  return out;
}

/** Marca de escena en la transcripción: el fotograma pequeño, el instante y lo que se ve (se despliega). */
export const MarcaEscena = memo(function MarcaEscena({ escenas, alAbrir }: { escenas: FiguraVisor[]; alAbrir: (f: FiguraVisor) => void }) {
  const [abierta, setAbierta] = useState(false);
  const f = escenas[0]!;
  const mas = escenas.length - 1;
  return (
    <div className="marca-escena mb-2 mt-1 flex items-start gap-2.5 rounded-lg border border-dashed border-cream-500/80 bg-cream-50/70 p-1.5 pr-2.5 text-[0.8125rem]">
      <button type="button" onClick={() => motor().irA(f.t ?? 0, { sonar: true })} aria-label={`Ir a la escena de ${tiempoACadena(f.t ?? 0)}`} className="shrink-0 overflow-hidden rounded-md ring-1 ring-cream-400 hover:ring-coffee-500">
        <ImagenFigura fig={f} className="aspect-video w-[4.5rem]" />
      </button>
      <div className="min-w-0 flex-1 pt-0.5">
        <button type="button" onClick={() => setAbierta((x) => !x)} aria-expanded={abierta} className="flex w-full items-start gap-1.5 text-left text-coffee-600 hover:text-coffee-800">
          <span aria-hidden className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 bg-rojo" />
          <span className={cx('min-w-0 flex-1', !abierta && 'line-clamp-1')}>
            <span className="mr-1.5 font-mono text-[0.6875rem] text-apagado tnum">{tiempoACadena(f.t ?? 0)}</span>
            {f.descripcion ?? 'Escena'}
          </span>
          <Icono nombre={abierta ? 'arriba' : 'abajo'} tam={13} className="mt-0.5 shrink-0 text-coffee-400" />
        </button>
        {abierta ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-3">
            <button type="button" onClick={() => alAbrir(f)} className="text-[0.75rem] font-medium text-coffee-700 underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-900">Ampliar el fotograma</button>
            {mas > 0 ? escenas.slice(1).map((x) => (
              <button key={x.id} type="button" onClick={() => alAbrir(x)} title={x.descripcion} className="font-mono text-[0.6875rem] text-apagado hover:text-coffee-800">+ {tiempoACadena(x.t ?? 0)}</button>
            )) : null}
          </div>
        ) : mas > 0 ? <span className="ml-3 text-[0.6875rem] text-apagado">y {mas} {mas === 1 ? 'escena más' : 'escenas más'}</span> : null}
      </div>
    </div>
  );
});

/**
 * La tira de fotogramas del reproductor: todos los fotogramas clave con lo que
 * se ve en cada uno. Se busca en las descripciones; pulsar uno salta a su
 * segundo; el que está en pantalla se marca y la tira lo sigue.
 */
export function TiraFotogramas({ documento, cargar = true }: { documento: string; /** Las imágenes esperan a que el vídeo tenga su índice: los primeros bytes son para el vídeo. */ cargar?: boolean }) {
  const { figuras } = useFigurasDocumento(documento);
  const [pedir, setPedir] = useState(cargar);
  useEffect(() => { if (cargar) setPedir(true); }, [cargar]);
  // Si el vídeo no llega a cargar, las imágenes no esperan para siempre.
  useEffect(() => { const h = setTimeout(() => setPedir(true), 5000); return () => clearTimeout(h); }, []);
  const todos = useMemo(() => figuras.filter((f) => f.t !== undefined), [figuras]);
  const [filtro, setFiltro] = useState('');
  const [soloEscenas, setSoloEscenas] = useState(false);
  const diferido = useDeferredValue(filtro);
  const hayEscenas = todos.some((f) => f.escena);
  const visibles = useMemo(() => todos.filter((f) => !esVacio(f) && (!soloEscenas || f.escena) && coincide(diferido, f.descripcion)), [todos, diferido, soloEscenas]);
  const inicios = useMemo(() => Float64Array.from(visibles, (f) => f.t ?? 0), [visibles]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const lista = useRef<HTMLOListElement>(null);
  const encima = useRef(false);

  // El fotograma actual, sin renders: un atributo en el DOM, y la tira lo sigue si nadie la está tocando.
  useEffect(() => {
    let previo = -1;
    const marcar = (t: number) => {
      const i = buscarIndice(inicios, t);
      if (i === previo || !lista.current) return;
      previo = i;
      lista.current.querySelector('[data-actual]')?.removeAttribute('data-actual');
      const n = lista.current.querySelector<HTMLElement>(`[data-i="${i}"]`);
      if (!n) return;
      n.setAttribute('data-actual', '');
      if (!encima.current) {
        const c = lista.current;
        const top = n.offsetTop - c.offsetTop;
        if (top < c.scrollTop || top + n.offsetHeight > c.scrollTop + c.clientHeight) c.scrollTo({ top: top - c.clientHeight / 3, behavior: 'smooth' });
      }
    };
    // Al abrir (aún en pausa) ya se marca el fotograma del instante en que está el vídeo.
    const h = requestAnimationFrame(() => marcar(motor().tiempo()));
    const soltar = motor().escucharTiempo(marcar);
    return () => { cancelAnimationFrame(h); soltar(); };
  }, [inicios]);

  if (!todos.length) return null;
  return (
    <section aria-label="Fotogramas" className="mt-6">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="rotulo text-apagado">Lo que se ve</h2>
        <span className="text-[0.75rem] text-apagado tnum">{visibles.length} de {todos.length} fotogramas</span>
        {hayEscenas ? (
          <button type="button" aria-pressed={soloEscenas} onClick={() => setSoloEscenas((x) => !x)} className={cx('ml-auto rounded-md px-2 py-0.5 text-[0.75rem] font-medium', soloEscenas ? 'bg-coffee-800 text-cream-50' : 'text-coffee-600 hover:bg-cream-200')}>Solo cambios de escena</button>
        ) : null}
      </div>
      <label className="relative mb-2 block">
        <span className="sr-only">Buscar en lo que se ve</span>
        <Icono nombre="buscar" tam={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-coffee-400" />
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar en lo que se ve: libros, pizarra, rótulo…"
          className="h-9 w-full rounded-xl border border-cream-400 bg-cream-50 pl-8 pr-3 text-[0.8125rem] shadow-[var(--hundido)] outline-none focus:border-coffee-500" />
      </label>
      <ol ref={lista} onPointerEnter={() => { encima.current = true; }} onPointerLeave={() => { encima.current = false; }}
        className="tira-fotogramas relative max-h-[min(30rem,46dvh)] overflow-y-auto overscroll-contain rounded-xl border border-cream-400 bg-cream-200/50 p-1.5 shadow-[var(--hundido)]">
        {visibles.map((f, i) => (
          <li key={f.id} data-i={i} className="group/f rounded-lg [content-visibility:auto] [contain-intrinsic-size:auto_4.5rem] data-[actual]:bg-cream-50 data-[actual]:shadow-[var(--relieve)]">
            <div className="flex items-start gap-2.5 p-1.5">
              <button type="button" onClick={() => motor().irA(f.t ?? 0, { sonar: true })} aria-label={`Ir a ${tiempoACadena(f.t ?? 0)}: ${f.descripcion ?? ''}`}
                className="relative shrink-0 overflow-hidden rounded-md ring-1 ring-cream-400 hover:ring-coffee-500 group-data-[actual]/f:ring-2 group-data-[actual]/f:ring-rojo">
                {pedir ? <ImagenFigura fig={f} className="aspect-video w-[6.5rem]" /> : <span className="block aspect-video w-[6.5rem] bg-coffee-900/80" />}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-[#1a0f0a]/75 px-1 font-mono text-[0.625rem] text-cream-100 tnum">{tiempoACadena(f.t ?? 0)}</span>
              </button>
              <button type="button" onClick={() => setAbierta(i)} className="min-w-0 flex-1 text-left text-[0.8125rem] leading-snug text-coffee-700 hover:text-coffee-900" title="Ampliar">
                <span className="line-clamp-3">{f.descripcion ?? 'Sin descripción'}</span>
                {f.escena ? <span className="mt-0.5 block text-[0.6875rem] font-semibold text-ocre">cambio de escena</span> : null}
              </button>
            </div>
          </li>
        ))}
        {!visibles.length ? <li className="p-3 text-[0.8125rem] text-apagado">Ningún fotograma dice «{filtro}».</li> : null}
      </ol>
      <VisorFigura figuras={visibles} indice={abierta} alCambiar={setAbierta} alIr={(f) => motor().irA(f.t ?? 0, { sonar: true })} />
    </section>
  );
}
