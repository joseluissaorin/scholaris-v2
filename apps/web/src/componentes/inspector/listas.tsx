/**
 * Las listas largas del inspector, virtualizadas sobre la ventana: unidades
 * (páginas o tramos) por bloques, fragmentos por páginas que se piden al
 * llegar al final, secciones en árbol y figuras en rejilla.
 */
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { DetalleDocumento, FragmentoInspeccion, SeccionVista, UnidadInspeccion } from '@scholaris/contrato';
import { cx, Esqueleto, EsqueletoTexto, Folio, Icono, Rotulo } from '@scholaris/ui';
import { q } from '../../datos/consultas';
import { numero } from '../../lib/numero';
import { esMedio, tiempoACadena } from '../../lib/formato';
import { textoLimpio as limpiar } from '../../lib/texto';
import { BLOQUE_INSPECCION, qi } from './consultas';
import { esFotograma, esVacio, ImagenFigura, useFigurasDocumento, VisorFigura } from './figuras';
import { Apartado, Carril, nombreLector, pct } from './resumen';
import { coincide } from './texto';
import { RehacerFiguras } from './rehacer-figuras';

/** El margen del contenedor respecto al principio de la página (para el virtualizador de ventana). */
function useMargen(ref: React.RefObject<HTMLElement | null>) {
  const [m, setM] = useState(0);
  useLayoutEffect(() => {
    const medir = () => setM((ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [ref]);
  return m;
}

const ORIGEN: Record<string, string> = { leido: 'leído en la página', deducido: 'deducido por la secuencia', epub: 'del EPUB', ninguno: 'sin folio' };

// ---------------------------------------------------------------------------
// Unidades
// ---------------------------------------------------------------------------

export function Unidades({ doc }: { doc: DetalleDocumento }) {
  const ref = useRef<HTMLDivElement>(null);
  const margen = useMargen(ref);
  const [abiertas, setAbiertas] = useState<Set<number>>(() => new Set());
  const v = useWindowVirtualizer({ count: doc.unidades, estimateSize: () => 112, overscan: 6, scrollMargin: margen });
  const medio = esMedio(doc.tipo);
  return (
    <Apartado titulo={medio ? 'Tramos' : doc.tipo === 'presentacion' ? 'Diapositivas' : 'Páginas'} forma="cuadrado"
      descripcion={medio ? 'Cada tramo citable con su intervalo, su texto y el instante de cada palabra.' : 'Cada unidad con su imagen, su texto, notas, cabecera y pie, quién la leyó, con qué confianza, y su folio con cómo se dedujo. Pulsa una para verla entera.'}>
      <div ref={ref} className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => (
          <div key={it.key} data-index={it.index} ref={v.measureElement} className="absolute inset-x-0" style={{ top: it.start - v.options.scrollMargin }}>
            <FilaUnidad doc={doc} orden={it.index + 1} abierta={abiertas.has(it.index + 1)}
              alternar={() => setAbiertas((s) => { const n = new Set(s); if (n.has(it.index + 1)) n.delete(it.index + 1); else n.add(it.index + 1); return n; })} />
          </div>
        ))}
      </div>
    </Apartado>
  );
}

const FilaUnidad = memo(function FilaUnidad({ doc, orden, abierta, alternar }: { doc: DetalleDocumento; orden: number; abierta: boolean; alternar: () => void }) {
  const { data } = useQuery(qi.unidades(doc.id, Math.floor((orden - 1) / BLOQUE_INSPECCION)));
  const u = data?.find((x) => x.orden === orden);
  if (!u) return <div className="flex gap-4 border-b border-cream-300 py-3"><Esqueleto className="h-20 w-14 shrink-0" /><div className="flex-1"><EsqueletoTexto lineas={3} /></div></div>;
  const pagina = u.ancla.tipo === 'pagina' ? u.ancla : null;
  const medio = u.t0 != null;
  const dudoso = !!pagina && pagina.confianza < 0.75;
  return (
    <article className={cx('border-b border-cream-300 py-3', abierta && 'bg-cream-100/60')}>
      <button type="button" onClick={alternar} aria-expanded={abierta} className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-lg text-left hover:bg-cream-100 sm:grid-cols-[4.5rem_minmax(0,1fr)_14rem] sm:gap-4">
        {u.miniaturaUrl || u.imagenUrl ? <img src={u.miniaturaUrl ?? u.imagenUrl} alt="" loading="lazy" decoding="async" className={cx('w-full rounded-sm border border-cream-400 bg-white object-cover object-top shadow-[var(--relieve)]', medio || doc.tipo === 'presentacion' ? 'aspect-video' : 'aspect-[1/1.414]')} />
          : <span className="grid aspect-[1/1.414] w-full place-items-center rounded-sm border border-dashed border-cream-500 font-mono text-[0.6875rem] text-apagado">{medio ? tiempoACadena(u.t0 ?? 0) : orden}</span>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Folio dudoso={dudoso}>{u.etiqueta || `[${orden}]`}</Folio>
            {pagina ? <span className="text-[0.75rem] text-apagado">física {pagina.fisica}{pagina.romana ? ' · romana' : ''}</span> : null}
            {medio ? <span className="font-mono text-[0.75rem] text-apagado tnum">{tiempoACadena(u.t0 ?? 0)}-{tiempoACadena(u.t1 ?? 0)}</span> : null}
          </div>
          <p className={cx('mt-1 text-[0.8125rem] leading-snug text-coffee-700', !abierta && 'line-clamp-2')}>{limpiar(u.texto).slice(0, abierta ? undefined : 400) || <span className="text-apagado">Sin texto: en blanco, guarda o lámina.</span>}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5 text-[0.6875rem]">
            {u.notas?.length ? <Insignia>{u.notas.length} {u.notas.length === 1 ? 'nota' : 'notas'}</Insignia> : null}
            {u.cabecera ? <Insignia>cabecera</Insignia> : null}
            {u.pie ? <Insignia>pie</Insignia> : null}
            {u.figuras ? <Insignia tono="azul">{u.figuras} {medio ? (u.figuras === 1 ? 'fotograma' : 'fotogramas') : u.figuras === 1 ? 'figura' : 'figuras'}</Insignia> : null}
            <Insignia>{u.fragmentos} {u.fragmentos === 1 ? 'fragmento' : 'fragmentos'}</Insignia>
            {u.palabras ? <Insignia>{numero(u.palabras)} palabras con instante</Insignia> : null}
          </ul>
        </div>
        <div className="col-span-2 min-w-0 text-[0.75rem] text-coffee-600 sm:col-span-1">
          <p className="truncate" title={u.lector}>{nombreLector(u.lector)}</p>
          <div className="mt-1 flex items-center gap-2"><Carril valor={u.confianza} className="flex-1" /><span className="tnum">{pct(u.confianza)}</span></div>
          {pagina ? <p className={cx('mt-1', dudoso && 'rounded bg-amarillo-suave px-1')}>Folio {pagina.impresa ?? '—'}: {ORIGEN[pagina.origen] ?? pagina.origen} ({pct(pagina.confianza)})</p> : null}
        </div>
      </button>
      {abierta ? <DetalleUnidad doc={doc} u={u} /> : null}
    </article>
  );
});

function Insignia({ children, tono }: { children: React.ReactNode; tono?: 'azul' }) {
  return <li className={cx('rounded-md border px-1.5 py-0.5', tono === 'azul' ? 'border-azul/30 bg-azul-suave text-azul' : 'border-cream-400 bg-cream-100 text-coffee-600')}>{children}</li>;
}

function DetalleUnidad({ doc, u }: { doc: DetalleDocumento; u: UnidadInspeccion }) {
  const medio = u.t0 != null;
  return (
    <div className="mt-3 grid gap-5 pl-0 sm:pl-[5.5rem] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      {u.imagenUrl ? <a href={u.imagenUrl} target="_blank" rel="noreferrer" className="block"><img src={u.imagenUrl} alt={`Imagen de ${u.etiqueta}`} loading="lazy" className="w-full rounded-md border border-cream-400 bg-white shadow-[var(--levantado)]" /></a> : null}
      <div className="min-w-0">
        {u.cabecera ? <Bloque titulo="Cabecera"><p className="font-serif text-[0.875rem] italic text-coffee-600">{u.cabecera}</p></Bloque> : null}
        <Bloque titulo="Texto"><p className="whitespace-pre-wrap font-serif text-[0.9375rem] leading-relaxed text-coffee-800">{u.texto || '—'}</p></Bloque>
        {u.notas?.length ? <Bloque titulo="Notas al pie"><ol className="list-decimal pl-5 font-serif text-[0.8125rem] leading-relaxed text-coffee-700">{u.notas.map((n, i) => <li key={i}>{n}</li>)}</ol></Bloque> : null}
        {u.pie ? <Bloque titulo="Pie de página"><p className="font-serif text-[0.875rem] italic text-coffee-600">{u.pie}</p></Bloque> : null}
        <Bloque titulo="Ancla"><pre className="overflow-auto rounded-lg bg-cream-200/70 p-2.5 font-mono text-[0.6875rem] text-coffee-700 shadow-[var(--hundido)]">{JSON.stringify(u.ancla, null, 2)}</pre></Bloque>
        <Link to="/lector/$id" params={{ id: doc.id }} search={medio ? { t: Math.floor(u.t0 ?? 0) } : { u: u.orden }} className="mt-1 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-coffee-700 underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-900">
          <Icono nombre="lector" tam={14} />Abrir en el lector
        </Link>
      </div>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div className="mb-4"><Rotulo>{titulo}</Rotulo><div className="mt-1">{children}</div></div>;
}

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

export function Secciones({ doc }: { doc: DetalleDocumento }) {
  const { data, isPending } = useQuery(q.secciones(doc.id));
  const { data: folios } = useQuery(q.folios(doc.id));
  const medio = esMedio(doc.tipo);
  const etiqueta = (o: number) => { const f = folios?.folios[o - 1]; return medio ? (f?.t0 != null ? tiempoACadena(f.t0) : '') : f?.impresa ? `p. ${f.impresa}` : `[${o}]`; };
  return (
    <Apartado titulo="Secciones" descripcion="El índice del documento: cada sección con su nivel, dónde empieza y dónde acaba.">
      {isPending ? <EsqueletoTexto lineas={8} /> : !data?.length ? <p className="text-[0.875rem] text-apagado">Este documento no trae secciones.</p> : (
        <ol className="flex flex-col">
          {data.map((s: SeccionVista) => (
            <li key={s.id} style={{ paddingLeft: `${(s.nivel - 1) * 1.25}rem` }}>
              <Link to="/lector/$id" params={{ id: doc.id }} search={medio ? { t: Math.floor(folios?.folios[s.unidadDesde - 1]?.t0 ?? 0) } : { u: s.unidadDesde }}
                className="group flex items-baseline gap-3 rounded-lg px-2 py-1.5 hover:bg-cream-200">
                <span className={cx('min-w-0 flex-1', s.nivel === 1 ? 'text-[0.9375rem] font-medium text-coffee-800' : 'text-[0.875rem] text-coffee-600')}>
                  {s.nivel > 1 ? <span aria-hidden className="mr-2 text-cream-500">└</span> : null}{s.titulo}
                  {s.resumen ? <span className="mt-0.5 block text-[0.8125rem] font-normal text-apagado">{s.resumen}</span> : null}
                </span>
                <span className="dato shrink-0 text-coffee-500">{etiqueta(s.unidadDesde)}{s.unidadHasta && s.unidadHasta !== s.unidadDesde ? `-${etiqueta(s.unidadHasta).replace(/^p\. /, '')}` : ''}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Apartado>
  );
}

// ---------------------------------------------------------------------------
// Fragmentos
// ---------------------------------------------------------------------------

export function Fragmentos({ doc }: { doc: DetalleDocumento }) {
  const consulta = useInfiniteQuery(qi.fragmentos(doc.id));
  const lista = useMemo(() => consulta.data?.pages.flatMap((p) => p.elementos) ?? [], [consulta.data]);
  const total = consulta.data?.pages[0]?.total ?? doc.cuentas.fragmentos;
  const [filtro, setFiltro] = useState('');
  const diferido = useDeferredValue(filtro);
  const visibles = useMemo(() => (diferido.trim() ? lista.filter((f) => coincide(diferido, f.texto, f.contexto, f.seccion.join(' '))) : lista), [lista, diferido]);
  const ref = useRef<HTMLDivElement>(null);
  const margen = useMargen(ref);
  const quedan = consulta.hasNextPage;
  const v = useWindowVirtualizer({ count: visibles.length + (quedan ? 1 : 0), estimateSize: () => 190, overscan: 5, scrollMargin: margen });
  const items = v.getVirtualItems();
  const ultimo = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (quedan && !consulta.isFetchingNextPage && (ultimo >= visibles.length - 8 || diferido.trim())) void consulta.fetchNextPage();
  }, [ultimo, visibles.length, quedan, consulta, diferido]);
  return (
    <Apartado titulo="Fragmentos" forma="triangulo"
      descripcion="Los trozos que se buscan y se citan: cada uno con su ancla, su sección, la línea de contexto que lo sitúa en la obra y, en los textos antiguos, la capa de búsqueda en grafía moderna."
      accion={<span className="shrink-0 text-[0.8125rem] text-coffee-600 tnum">{numero(lista.length)} de {numero(total)}</span>}>
      <label className="relative mb-3 block">
        <span className="sr-only">Filtrar los fragmentos</span>
        <Icono nombre="filtro" tam={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-coffee-400" />
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por texto, contexto o sección"
          className="h-10 w-full rounded-xl border border-cream-400 bg-cream-50 pl-9 pr-3 text-[0.875rem] shadow-[var(--hundido)] outline-none focus:border-coffee-500" />
      </label>
      <div ref={ref} className="relative" style={{ height: v.getTotalSize() }}>
        {items.map((it) => (
          <div key={it.key} data-index={it.index} ref={v.measureElement} className="absolute inset-x-0" style={{ top: it.start - v.options.scrollMargin }}>
            {it.index < visibles.length ? <TarjetaFragmento doc={doc} f={visibles[it.index]!} /> : <div className="py-4"><EsqueletoTexto lineas={4} /></div>}
          </div>
        ))}
      </div>
      {!consulta.isPending && !visibles.length ? <p className="text-[0.875rem] text-apagado">{filtro ? `Ningún fragmento dice «${filtro}».` : 'Este documento aún no tiene fragmentos.'}</p> : null}
    </Apartado>
  );
}

const TarjetaFragmento = memo(function TarjetaFragmento({ doc, f }: { doc: DetalleDocumento; f: FragmentoInspeccion }) {
  const [abierto, setAbierto] = useState(false);
  const medio = f.ancla.tipo === 'tiempo';
  const moderna = f.textoBusqueda && f.textoBusqueda !== f.texto ? f.textoBusqueda : null;
  return (
    <article className="border-b border-cream-300 py-4">
      <header className="flex flex-wrap items-center gap-2">
        <Folio>{f.etiqueta}</Folio>
        {f.seccion.length ? <span className="min-w-0 truncate text-[0.75rem] text-coffee-500">{f.seccion.join(' › ')}</span> : null}
        <span className="ml-auto font-mono text-[0.6875rem] text-apagado">n.º {numero(f.orden + 1)}</span>
      </header>
      {f.contexto ? (
        <p className="mt-2 flex gap-2 rounded-lg bg-azul-suave/60 px-3 py-2 text-[0.8125rem] leading-snug text-coffee-700">
          <span className="rotulo shrink-0 pt-px text-azul">Contexto</span><span className="italic">{f.contexto}</span>
        </p>
      ) : null}
      <p className={cx('mt-2 whitespace-pre-wrap font-serif text-[0.9375rem] leading-relaxed text-coffee-800', !abierto && 'line-clamp-5')}>{f.texto}</p>
      {moderna ? (
        <p className={cx('mt-2 rounded-lg border border-dashed border-cream-500 px-3 py-2 text-[0.8125rem] text-coffee-600', !abierto && 'line-clamp-2')}><span className="rotulo mr-2 text-apagado">Capa de búsqueda</span>{moderna}</p>
      ) : null}
      <footer className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-coffee-500">
        <button type="button" onClick={() => setAbierto((x) => !x)} className="underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-800">{abierto ? 'Plegar' : 'Ver entero'}</button>
        <Link to="/lector/$id" params={{ id: doc.id }} search={medio ? { t: Math.floor((f.ancla as { t0: number }).t0) } : { u: f.unidad }} className="underline decoration-filete-fuerte underline-offset-4 hover:text-coffee-800">Abrir en el lector</Link>
        {f.vectores.length ? f.vectores.map((e) => <span key={e} className="rounded-md bg-cream-200 px-1.5 py-0.5 font-mono text-[0.6875rem]">vector · {e}</span>) : <span className="text-apagado">sin vector</span>}
        {f.textoBusqueda === null ? <span className="text-apagado">capa moderna sin calcular</span> : null}
        <span className="font-mono text-[0.6875rem] text-apagado">{f.id}</span>
      </footer>
    </article>
  );
});

// ---------------------------------------------------------------------------
// Figuras y fotogramas
// ---------------------------------------------------------------------------

export function FigurasInspector({ doc }: { doc: DetalleDocumento }) {
  const { figuras, cargando } = useFigurasDocumento(doc.id);
  const [filtro, setFiltro] = useState('');
  const diferido = useDeferredValue(filtro);
  const [abierta, setAbierta] = useState<number | null>(null);
  const visibles = useMemo(() => figuras.filter((f) => coincide(diferido, f.descripcion, f.pie, f.etiqueta)), [figuras, diferido]);
  const fotogramas = figuras.some(esFotograma);
  return (
    <Apartado titulo={fotogramas ? 'Fotogramas clave' : 'Figuras'} descripcion={fotogramas ? 'Los fotogramas que se guardaron del vídeo, con lo que se ve en cada uno (texto en pantalla, personas, objetos), descrito al leerlo.' : 'Las figuras que se encontraron al leer: la imagen, su pie impreso y la descripción automática de lo que se ve.'}
      accion={<div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3"><span className="text-[0.8125rem] text-coffee-600 tnum">{numero(visibles.length)} de {numero(figuras.length)}</span>{doc.estado === 'listo' ? <RehacerFiguras doc={doc} /> : null}</div>}>
      <label className="relative mb-4 block">
        <span className="sr-only">Buscar en lo que se ve</span>
        <Icono nombre="buscar" tam={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-coffee-400" />
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar en las descripciones y los pies"
          className="h-10 w-full rounded-xl border border-cream-400 bg-cream-50 pl-9 pr-3 text-[0.875rem] shadow-[var(--hundido)] outline-none focus:border-coffee-500" />
      </label>
      {cargando ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="aspect-[4/3]" />)}</div>
        : !figuras.length ? <p className="text-[0.875rem] text-apagado">Este documento no tiene figuras ni imágenes. Si crees que sí las tiene, «Volver a buscar figuras» mira sus páginas otra vez.</p>
        : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibles.map((f) => (
              <li key={f.id} className={cx('[content-visibility:auto] [contain-intrinsic-size:auto_20rem]', esVacio(f) && 'opacity-60')}>
                <button type="button" onClick={() => setAbierta(figuras.indexOf(f))} className="group block h-full w-full overflow-hidden rounded-xl border border-cream-400 bg-cream-50 text-left shadow-[var(--relieve)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--levantado)]">
                  <ImagenFigura fig={f} className={cx('w-full', esFotograma(f) ? 'aspect-video' : 'aspect-[4/3]')} />
                  <div className="p-3">
                    <div className="flex items-center gap-2"><Folio>{f.etiqueta}</Folio>{f.region ? <span className="text-[0.6875rem] text-apagado">recortada de la página</span> : null}{f.escena ? <span className="text-[0.6875rem] font-semibold text-ocre">escena</span> : null}</div>
                    {f.pie ? <p className="mt-2 font-serif text-[0.875rem] italic leading-snug text-coffee-800">{f.pie}</p> : null}
                    {f.descripcion ? <p className="mt-1.5 text-[0.8125rem] leading-snug text-coffee-600">{f.descripcion}</p> : <p className="mt-1.5 text-[0.8125rem] text-apagado">Sin descripción.</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      <VisorFigura figuras={figuras} indice={abierta} alCambiar={setAbierta} contexto={doc.metadatos.titulo} />
    </Apartado>
  );
}
