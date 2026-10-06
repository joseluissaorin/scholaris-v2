/**
 * Las figuras marcadas sobre la imagen de su página: un recuadro donde está
 * (si la ingesta guardó la región) o una pestaña en la esquina si no; al pasar
 * se lee lo que se ve, y al pulsar se abre el visor.
 */
import { memo, useMemo, useState } from 'react';
import { Consejo, cx } from '@scholaris/ui';
import { altFigura, useFigurasDocumento, VisorFigura, type FiguraVisor } from './figuras';

/** Las figuras de una página (unidad base 1), de la caché compartida del documento. */
export function useFigurasDePagina(documento: string, orden: number): FiguraVisor[] {
  const { figuras } = useFigurasDocumento(documento);
  return useMemo(() => figuras.filter((f) => f.unidad === orden && f.ancla.tipo !== 'tiempo'), [figuras, orden]);
}

/** La capa de las marcas: exactamente donde se pinta la imagen dentro de su caja. */
function capa(a?: { imagen: number; caja: number }): React.CSSProperties {
  if (!a || Math.abs(a.imagen - a.caja) < 0.005) return { inset: 0 };
  if (a.imagen > a.caja) { const h = (a.caja / a.imagen) * 100; return { left: 0, right: 0, top: `${(100 - h) / 2}%`, height: `${h}%` }; }
  const w = (a.imagen / a.caja) * 100;
  return { top: 0, bottom: 0, left: `${(100 - w) / 2}%`, width: `${w}%` };
}

/** El texto alternativo de una página con figuras: dice qué figuras lleva. */
export function altPagina(etiqueta: string, figuras: FiguraVisor[]): string {
  if (!figuras.length) return `Imagen de la página ${etiqueta}`;
  return `Imagen de la página ${etiqueta}. ${figuras.length === 1 ? 'Lleva una figura' : `Lleva ${figuras.length} figuras`}: ${figuras.map(altFigura).join(' · ')}`;
}

export const MarcasFiguras = memo(function MarcasFiguras({ documento, figuras, todas, alIr, aspecto }: {
  documento: string; figuras: FiguraVisor[]; todas?: FiguraVisor[]; alIr?: (f: FiguraVisor) => void;
  /** Proporciones de la imagen y de su caja (object-contain): las marcas van sobre la imagen, no sobre las bandas. */
  aspecto?: { imagen: number; caja: number };
}) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const lista = todas ?? figuras;
  if (!figuras.length) return null;
  const abrir = (f: FiguraVisor) => setAbierta(lista.findIndex((x) => x.id === f.id));
  const sinRegion = figuras.filter((f) => !f.region);
  return (
    <>
      <div className="pointer-events-none absolute" data-documento={documento} style={capa(aspecto)}>
        {figuras.filter((f) => f.region).map((f, i) => (
          <Consejo key={f.id} texto={<span className="block max-w-[22rem] text-left">{f.descripcion ?? f.pie ?? 'Figura'}</span>}>
            <button type="button" onClick={() => abrir(f)} aria-label={`Figura: ${altFigura(f)}`}
              className="marca-figura group pointer-events-auto absolute rounded-[2px] border-2 border-rojo/45 outline-none transition-[border-color,background] hover:border-rojo hover:bg-rojo/5 focus-visible:border-rojo"
              style={{ left: `${f.region!.x * 100}%`, top: `${f.region!.y * 100}%`, width: `${f.region!.w * 100}%`, height: `${f.region!.h * 100}%` }}>
              <span className="absolute -left-[2px] -top-[2px] grid h-5 min-w-5 place-items-center bg-rojo px-1 font-mono text-[0.625rem] font-semibold text-cream-50 shadow-[var(--relieve-oscuro)]">{i + 1}</span>
            </button>
          </Consejo>
        ))}
        {sinRegion.length ? (
          <div className="pointer-events-auto absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5">
            {sinRegion.map((f) => (
              <Consejo key={f.id} texto={<span className="block max-w-[22rem] text-left">{f.descripcion ?? f.pie ?? 'Figura'}</span>}>
                <button type="button" onClick={() => abrir(f)} aria-label={`Figura: ${altFigura(f)}`}
                  className={cx('flex max-w-full items-center gap-1.5 rounded-lg border border-cream-400 bg-cream-50/95 px-2 py-1 text-left text-[0.75rem] text-coffee-700 shadow-[var(--relieve)] backdrop-blur hover:-translate-y-px hover:text-coffee-900')}>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-azul" />
                  <span className="truncate">{f.pie ?? f.descripcion ?? 'Figura'}</span>
                </button>
              </Consejo>
            ))}
          </div>
        ) : null}
      </div>
      <VisorFigura figuras={lista} indice={abierta} alCambiar={setAbierta} {...(alIr ? { alIr } : {})} />
    </>
  );
});
