/**
 * Un escenario pequeño para el medio fuera del lector (la vista lado a lado):
 * acoge el marco del motor único (como el lector, y al salir sigue en el
 * reproductor pequeño si suena), salta al tramo pedido sin sonar, reproduce
 * solo ese tramo y rodea la región de la prueba alrededor de su instante.
 *
 * Sin archivo (la demostración), se ve el fotograma clave del instante.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DetalleDocumento } from '@scholaris/contrato';
import type { Region } from '@scholaris/nucleo';
import { cx, Icono } from '@scholaris/ui';
import { tiempoACadena } from '../../lib/formato';
import { RecuadroMano } from '../comunes/recuadro-mano';
import { motor } from '../reproductor/motor';
import { useMotor, useRelojDom } from '../reproductor/ganchos';
import { useFuente } from '../reproductor/reproductor';
import { FotogramaVirtual } from './material';

export function EscenarioCompacto({ doc, tramo, region, instante, className }: {
  doc: DetalleDocumento;
  /** El tramo de la alineación: se salta a su principio y «Reproducir el tramo» para en su final. */
  tramo?: [number, number] | null;
  region?: Region;
  instante?: number;
  className?: string;
}) {
  const m = motor();
  const inst = useMotor();
  const fuente = useFuente(doc);
  const hueco = useRef<HTMLDivElement>(null);
  const reloj = useRef<HTMLSpanElement>(null);
  useRelojDom(reloj);
  const propio = inst.documento === doc.id;
  const esVideo = doc.tipo === 'video';
  const [cerca, setCerca] = useState(false);
  const hasta = useRef<number | null>(null);

  useEffect(() => { void m.cargar(fuente, tramo ? { t: tramo[0] } : {}); }, [fuente]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const n = hueco.current!;
    m.alojar(n, 'lector');
    return () => m.desalojar(n);
  }, [m]);
  // Otro tramo: se va a su principio, sin sonar.
  useEffect(() => {
    if (!tramo || !propio) return;
    hasta.current = null;
    m.irA(instante ?? tramo[0]);
  }, [tramo?.[0], tramo?.[1], instante, propio]); // eslint-disable-line react-hooks/exhaustive-deps
  // La región, solo cerca de su instante; y la pausa al final del tramo que se pidió oír.
  useEffect(() => m.escucharTiempo((t) => {
    setCerca(instante != null && Math.abs(t - instante) <= 2.5);
    if (hasta.current != null && t >= hasta.current) { hasta.current = null; m.pausar(); }
  }), [m, instante]);

  const sonando = propio && inst.quiere && inst.estado !== 'error';
  const oirTramo = () => { if (!tramo) return; hasta.current = tramo[1]; m.irA(tramo[0], { sonar: true }); };
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {esVideo ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-coffee-900 shadow-[var(--levantado)] ring-1 ring-[#1a0f0a]/60">
          <div ref={hueco} className="absolute inset-0" />
          {propio && inst.virtual ? <FotogramaVirtual documento={doc.id} /> : null}
          {region && propio ? <div className="pointer-events-none absolute inset-0"><RecuadroMano region={region} visible={cerca} clave={`lado|${instante}`} etiqueta={`La región del fotograma de ${tiempoACadena(instante ?? 0)}`} /></div> : null}
          {propio && inst.estado === 'error' ? <p role="alert" className="absolute inset-x-3 bottom-3 rounded-lg bg-[rgb(26_15_10/0.85)] px-3 py-2 text-[0.8125rem] text-cream-50">{inst.error ?? 'No se pudo cargar el vídeo.'}</p> : null}
        </div>
      ) : <div ref={hueco} className="absolute h-0 w-0 overflow-hidden" />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => m.alternar()} aria-label={sonando ? 'Pausa' : 'Reproducir'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#1a0f0a] bg-[linear-gradient(180deg,#4a2e1a_0%,#2c1810_100%)] text-cream-50 shadow-[var(--relieve-oscuro)] transition-transform hover:-translate-y-px active:translate-y-px">
          <Icono nombre={sonando ? 'pausa' : 'play'} tam={14} grosor={2.4} />
        </button>
        {tramo ? (
          <button type="button" onClick={oirTramo} aria-label={`${esVideo ? 'Ver' : 'Oír'} el tramo, de ${tiempoACadena(tramo[0])} a ${tiempoACadena(tramo[1])}`} className="tactil flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-cream-400 bg-cream-50 px-2.5 text-[0.8125rem] font-medium text-coffee-700 shadow-[var(--relieve)] hover:-translate-y-px">
            <Icono nombre="play" tam={12} />{esVideo ? 'Ver el tramo' : 'Oír el tramo'}
          </button>
        ) : null}
        <span className="ml-auto whitespace-nowrap font-mono text-[0.75rem] tnum text-coffee-600"><span ref={reloj}>0:00</span><span className="text-apagado"> / {tiempoACadena(doc.duracion ?? 0)}</span></span>
      </div>
    </div>
  );
}
