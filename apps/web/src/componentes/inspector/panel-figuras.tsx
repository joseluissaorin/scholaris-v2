/**
 * El panel «Figuras» del lector (y «Fotogramas» en los vídeos): cada imagen con
 * lo que se ve y su pie a la vista, un buscador sobre las descripciones y el
 * visor al pulsar.
 */
import { useDeferredValue, useMemo, useState } from 'react';
import { Esqueleto, Folio, Icono, cx } from '@scholaris/ui';
import { altFigura, esFotograma, esVacio, ImagenFigura, useFigurasDocumento, VisorFigura, type FiguraVisor } from './figuras';
import { coincide } from './texto';

export function PanelFiguras({ documento, alIr, actual }: { documento: string; alIr: (f: FiguraVisor) => void; actual?: number }) {
  const { figuras, cargando } = useFigurasDocumento(documento);
  const [filtro, setFiltro] = useState('');
  const [vacios, setVacios] = useState(false);
  const diferido = useDeferredValue(filtro);
  const fotogramas = figuras.some(esFotograma);
  const visibles = useMemo(() => figuras.filter((f) => (vacios || !esVacio(f)) && coincide(diferido, f.descripcion, f.pie, f.etiqueta)), [figuras, diferido, vacios]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const ocultos = figuras.filter(esVacio).length;

  if (cargando) return <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="aspect-[4/3]" />)}</div>;
  if (!figuras.length) return <p className="text-[0.9375rem] text-apagado">Este documento no tiene figuras ni imágenes descritas.</p>;

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Buscar en lo que se ve</span>
        <Icono nombre="buscar" tam={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-coffee-400" />
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder={fotogramas ? 'Buscar en lo que se ve: pizarra, libros…' : 'Buscar en las figuras: diagrama, tabla…'}
          className="h-10 w-full rounded-xl border border-cream-400 bg-cream-50 pl-9 pr-3 text-[0.875rem] shadow-[var(--hundido)] outline-none focus:border-coffee-500" />
      </label>
      <p className="mb-3 mt-2 flex items-center gap-2 text-[0.75rem] text-apagado">
        <span className="tnum">{visibles.length} de {figuras.length}</span> {fotogramas ? 'fotogramas' : 'figuras'}
        {ocultos ? <button type="button" onClick={() => setVacios((x) => !x)} className="ml-auto underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-800">{vacios ? 'Ocultar los vacíos' : `Ver ${ocultos} en negro o vacíos`}</button> : null}
      </p>
      <ul className="flex flex-col gap-3">
        {visibles.map((f) => {
          const aqui = actual != null && !esFotograma(f) && f.unidad === actual;
          return (
            <li key={f.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_9rem]">
              <article className={cx('overflow-hidden rounded-xl border bg-cream-50 shadow-[var(--relieve)]', aqui ? 'border-coffee-500' : 'border-cream-400')}>
                <button type="button" onClick={() => setAbierta(figuras.indexOf(f))} className="group relative block w-full text-left" aria-label={`Abrir: ${altFigura(f)}`}>
                  <ImagenFigura fig={f} className={cx('w-full', esFotograma(f) ? 'aspect-video' : 'aspect-[4/3]')} />
                  <span className="absolute right-2 top-2 rounded-md bg-[#1a0f0a]/70 px-1.5 py-0.5 text-[0.6875rem] font-medium text-cream-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Ampliar</span>
                </button>
                <div className="px-3 pb-3 pt-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => alIr(f)} className="rounded-md hover:bg-cream-200" aria-label={esFotograma(f) ? `Ir a ${f.etiqueta}` : `Ir a la ${f.etiqueta}`}><Folio>{f.etiqueta}</Folio></button>
                    {f.escena ? <span className="text-[0.6875rem] font-semibold text-ocre">escena</span> : null}
                    {aqui ? <span className="ml-auto text-[0.6875rem] text-apagado">en esta página</span> : null}
                  </div>
                  {f.pie ? <p className="mt-1.5 font-serif text-[0.875rem] italic leading-snug text-coffee-800">{f.pie}</p> : null}
                  {f.descripcion ? <p className="mt-1 text-[0.8125rem] leading-snug text-coffee-600">{f.descripcion}</p> : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {!visibles.length ? <p className="mt-2 text-[0.875rem] text-apagado">Ninguna descripción dice «{filtro}».</p> : null}
      <VisorFigura figuras={figuras} indice={abierta} alCambiar={setAbierta} alIr={alIr} />
    </div>
  );
}
