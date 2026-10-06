/**
 * Las figuras en Buscar: el filtro «Figuras e imágenes» (láminas, diagramas y
 * fotogramas de toda la biblioteca, por su descripción y por su imagen) y la
 * figura que respalda un pasaje encontrado por la vía visual.
 */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ResultadoVista } from '@scholaris/contrato';
import { Boceto } from '../../bocetos/boceto';
import { EsqueletoTexto, Folio, Icono, Rotulo, Vacio, cx } from '@scholaris/ui';
import { api } from '../../datos/api';
import { numero } from '../../lib/numero';
import { ICONO_TIPO } from '../../lib/formato';
import { deEncontrada, esFotograma, ImagenFigura, VisorFigura, type FiguraVisor } from './figuras';

/** La rejilla de figuras que encajan con la consulta. */
export function ResultadosFiguras({ consulta, documento, tipo }: { consulta: string; documento?: string; tipo?: 'figuras' | 'fotogramas' }) {
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    queryKey: ['figuras-buscar', consulta, documento ?? '', tipo ?? ''],
    queryFn: async () => (await api().figuras.buscar({ ...(consulta ? { q: consulta } : {}), ...(documento ? { documento } : {}), ...(tipo ? { tipo } : {}), limite: 60 })).map((f) => ({ ...deEncontrada(f), tipo: f.tipo, puntuacion: f.puntuacion, vias: f.vias })),
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
  });
  const [abierta, setAbierta] = useState<number | null>(null);
  if (isPending) return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded-2xl border border-cream-400 bg-cream-50 p-3"><div className="esqueleto aspect-[4/3]" /><EsqueletoTexto lineas={2} className="mt-3" /></div>)}</div>;
  if (isError) return <p className="text-[0.9375rem] text-apagado">No se pudieron buscar las figuras.</p>;
  if (!data?.length) {
    return <Vacio forma="circulo" titulo={consulta ? `Ninguna figura ni fotograma muestra «${consulta}».` : 'Tu biblioteca aún no tiene figuras.'} dibujo={<Boceto nombre="lupa" decorativo />}>Se busca en lo que se ve (la descripción que se hizo al leer), en los pies impresos y en la propia imagen.</Vacio>;
  }
  return (
    <>
      <div className={cx('mb-4 flex items-baseline gap-3', isPlaceholderData && 'opacity-60')}>
        <h2 className="rotulo text-[0.75rem] text-coffee-700">{numero(data.length)} {data.length === 1 ? 'figura o fotograma' : 'figuras y fotogramas'}</h2>
        <Rotulo>por lo que se ve, el pie y la imagen</Rotulo>
      </div>
      <ul className={cx('grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3', isPlaceholderData && 'opacity-60')}>
        {data.map((f, i) => (
          <li key={f.id} className="anim-sube" style={{ animationDelay: `calc(${Math.min(i, 10)} * var(--escalon))` }}>
            <button type="button" onClick={() => setAbierta(i)} className="levanta group block h-full w-full overflow-hidden rounded-2xl border border-cream-400 bg-cream-50 text-left shadow-[var(--levantado)]">
              <ImagenFigura fig={f} className={cx('w-full', esFotograma(f) ? 'aspect-video' : 'aspect-[4/3]')} />
              <div className="p-3.5">
                <div className="flex items-center gap-2">
                  <Folio>{f.etiqueta}</Folio>
                  <span className="text-[0.6875rem] text-apagado">{f.vias.includes('imagen') && f.vias.includes('texto') ? 'por la imagen y el texto' : f.vias.includes('imagen') ? 'por la imagen' : 'por el texto'}</span>
                </div>
                {f.pie ? <p className="mt-2 line-clamp-2 font-serif text-[0.875rem] italic leading-snug text-coffee-800">{f.pie}</p> : null}
                {f.descripcion ? <p className="mt-1.5 line-clamp-4 text-[0.8125rem] leading-snug text-coffee-600">{f.descripcion}</p> : null}
                <p className="mt-2.5 flex items-center gap-1.5 border-t border-cream-200 pt-2 text-[0.75rem] text-coffee-500">
                  <Icono nombre={ICONO_TIPO[f.tipo]} tam={13} className="shrink-0 text-coffee-400" /><em className="truncate">{f.titulo}</em>
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <VisorFigura figuras={data} indice={abierta} alCambiar={setAbierta} />
    </>
  );
}

/** Bajo un pasaje encontrado por su imagen: la figura o el fotograma, con lo que se ve. */
export function FiguraEnResultado({ r }: { r: ResultadoVista }) {
  const [abierta, setAbierta] = useState<number | null>(null);
  const g = r.figura;
  if (!g) return null;
  const fig: FiguraVisor = {
    id: g.id, documento: r.documento.id, titulo: r.documento.metadatos.titulo, unidad: 0, imagenUrl: g.imagenUrl,
    ...(g.pie ? { pie: g.pie } : {}), ...(g.descripcion ? { descripcion: g.descripcion } : {}), ...(g.region ? { region: g.region } : {}),
    ...(g.t !== undefined ? { t: g.t } : {}),
    ancla: g.t !== undefined ? { tipo: 'tiempo', t0: g.t, t1: g.t } : r.fragmento.ancla, etiqueta: r.etiqueta,
  };
  if (r.fragmento.ancla.tipo === 'pagina') fig.unidad = r.fragmento.ancla.fisica;
  return (
    <>
      <button type="button" onClick={() => setAbierta(0)} className="mt-3 flex w-full items-start gap-3 rounded-xl border border-cream-400 bg-cream-100/70 p-2 text-left shadow-[var(--hundido)] hover:border-cream-500">
        <ImagenFigura fig={fig} className={cx('w-28 shrink-0 rounded-md', g.t !== undefined ? 'aspect-video' : 'aspect-[4/3]')} />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="rotulo text-apagado">{g.t !== undefined ? 'Lo que se ve en el fotograma' : 'La figura'}</span>
          {g.pie ? <span className="mt-0.5 block font-serif text-[0.8125rem] italic text-coffee-800">{g.pie}</span> : null}
          {g.descripcion ? <span className="mt-0.5 line-clamp-3 block text-[0.8125rem] leading-snug text-coffee-600">{g.descripcion}</span> : null}
        </span>
      </button>
      <VisorFigura figuras={[fig]} indice={abierta} alCambiar={setAbierta} />
    </>
  );
}
