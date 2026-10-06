/**
 * Leer una colección ajena: la de un enlace sin cuenta o la que sigues. Las
 * portadas, buscar dentro y un lector de solo lectura con el folio de cada
 * página (o el minuto de cada tramo de audio y vídeo), con anclas en la URL
 * (`?doc=…&u=145` o `&t=754`) para enlazar un pasaje exacto.
 *
 * Recibe el cliente ya encerrado (`api.publico(token)` o `api.compartida(id)`):
 * todo lo que pide se queda dentro de esa colección.
 */
import { Resaltado } from '../../lib/resaltado';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ClienteScholaris, ResultadoVista, ResumenDocumento, UnidadVista } from '@scholaris/contrato';
import { Boton, Campo, cx, Esqueleto, Folio, Icono, Rotulo, Tarjeta, Vacio } from '@scholaris/ui';
import { IconoTipo } from '../comunes/icono-tipo';
import { textoLimpio } from '../../lib/texto';
import { duracion, nombreUnidad } from '../../lib/formato';
import { numero } from '../../lib/numero';

export interface Posicion { doc?: string; u?: number; t?: number }

const ICONO: Record<string, 'documento' | 'audio' | 'video' | 'imagen' | 'web' | 'hoja' | 'diapositiva' | 'lector'> = {
  pdf: 'documento', pdf_escaneado: 'documento', audio: 'audio', video: 'video', imagen: 'imagen', fotos: 'imagen', web: 'web', hoja: 'hoja', presentacion: 'diapositiva', epub: 'lector', documento: 'lector',
};

const POR_BLOQUE = 12;

export function LecturaCompartida({ cliente, clave, posicion, alMover, acciones, alCopiarDocumento }: {
  cliente: ClienteScholaris;
  /** Para la caché: el token del enlace o el id de la colección. */
  clave: string;
  posicion: Posicion;
  alMover: (p: Posicion) => void;
  acciones?: React.ReactNode;
  /** «Copiar a mi biblioteca» de un solo documento. */
  alCopiarDocumento?: (documento: string) => void;
}) {
  const { data: docs, isPending } = useQuery({ queryKey: ['ajena', clave, 'documentos'], queryFn: () => cliente.documentos.listar({ limite: 200, orden: 'titulo', dir: 'asc' }) });
  const [consulta, setConsulta] = useState('');
  const [busqueda, setBusqueda] = useState<{ q: string; resultados: ResultadoVista[] } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const lista = docs?.elementos ?? [];
  // Un enlace de un solo documento abre directamente el lector.
  const abierto = posicion.doc ?? (lista.length === 1 && !busqueda ? lista[0]!.id : undefined);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = consulta.trim();
    if (!q) { setBusqueda(null); return; }
    setBuscando(true);
    try { setBusqueda({ q, resultados: (await cliente.busqueda.buscar({ consulta: q, k: 20 })).resultados }); }
    catch { setBusqueda({ q, resultados: [] }); }
    finally { setBuscando(false); }
  }

  if (abierto) {
    const d = lista.find((x) => x.id === abierto);
    return <Lector cliente={cliente} clave={clave} documento={abierto} resumen={d} posicion={posicion} volver={lista.length > 1 ? () => alMover({}) : undefined} alMover={alMover} alCopiar={alCopiarDocumento} />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={(e) => void buscar(e)} className="min-w-64 flex-1">
          <Campo icono="buscar" placeholder="Buscar dentro de la colección" value={consulta} onChange={(e) => setConsulta(e.target.value)} aria-label="Buscar dentro" className="[&_input]:h-12" />
        </form>
        {acciones}
      </div>

      {buscando ? <div className="mt-6 space-y-3">{[0, 1, 2].map((i) => <Esqueleto key={i} className="h-20 rounded-xl" />)}</div> : busqueda ? (
        <section aria-label="Resultados" className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="rotulo text-[0.75rem] text-coffee-700">{numero(busqueda.resultados.length)} pasajes para «{busqueda.q}»</h2>
            <button type="button" className="text-[0.75rem] text-coffee-400 hover:text-coffee-700" onClick={() => { setBusqueda(null); setConsulta(''); }}>Volver a la colección</button>
          </div>
          {!busqueda.resultados.length ? <p className="text-[0.875rem] text-coffee-500">Nada coincide.</p> : (
            <ul className="space-y-3">
              {busqueda.resultados.map((r) => {
                const a = r.fragmento.ancla;
                return (
                  <li key={r.fragmento.id}>
                    <Tarjeta viva className="cursor-pointer p-4" onClick={() => alMover({ doc: r.documento.id, ...(a.tipo === 'tiempo' ? { t: Math.floor(a.t0) } : { u: unidadDeResultado(r) }) })}>
                      <div className="flex items-center gap-2 text-[0.8125rem] text-coffee-500">
                        <Folio>{r.etiqueta}</Folio>
                        <span className="truncate font-medium text-coffee-700">{r.documento.metadatos.titulo}</span>
                      </div>
                      <p className="mt-2 line-clamp-3 font-[Georgia] text-[0.9375rem] text-coffee-800"><Resaltado html={r.resaltado ?? r.fragmento.texto} /></p>
                      <p className="mt-1.5 text-[0.75rem] text-coffee-400">{r.citaCorta}</p>
                    </Tarjeta>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : isPending ? (
        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} className="aspect-[3/4] rounded-xl" />)}</div>
      ) : !lista.length ? (
        <Vacio estilo="malevich" titulo="La colección está vacía." className="mt-6">Cuando tenga documentos, aparecerán aquí.</Vacio>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {lista.map((d) => <FichaAjena key={d.id} d={d} alAbrir={() => alMover({ doc: d.id })} />)}
        </ul>
      )}
    </div>
  );
}

/** El orden de la unidad de un resultado (base 0 en la API → base 1 en la web). */
function unidadDeResultado(r: ResultadoVista): number | undefined {
  const a = r.fragmento.ancla;
  return a.tipo === 'pagina' ? a.fisica : undefined;
}

function FichaAjena({ d, alAbrir }: { d: ResumenDocumento; alAbrir: () => void }) {
  return (
    <li>
      <button type="button" onClick={alAbrir} className="group block w-full text-left">
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-cream-300 bg-cream-100 shadow-[var(--levantado)] transition-transform group-hover:-translate-y-0.5">
          {d.portadaUrl ? <img src={d.portadaUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : (
            <div className="grid h-full place-items-center"><IconoTipo nombre={ICONO[d.tipo] ?? 'documento'} tam={44} /></div>
          )}
        </div>
        <p className="mt-2.5 line-clamp-2 text-[0.875rem] font-medium leading-snug text-coffee-800">{d.titulo}</p>
        <p className="mt-0.5 truncate text-[0.75rem] text-coffee-400">{[d.autores, d.anio].filter(Boolean).join(' · ') || nombreUnidad(d.tipo, d.unidades)}</p>
      </button>
    </li>
  );
}

function Lector({ cliente, clave, documento, resumen, posicion, volver, alMover, alCopiar }: {
  cliente: ClienteScholaris; clave: string; documento: string; resumen?: ResumenDocumento; posicion: Posicion;
  volver?: () => void; alMover: (p: Posicion) => void; alCopiar?: (documento: string) => void;
}) {
  const { data: d } = useQuery({ queryKey: ['ajena', clave, 'documento', documento], queryFn: () => cliente.documentos.obtener(documento) });
  const esMedio = (d?.tipo ?? resumen?.tipo) === 'audio' || (d?.tipo ?? resumen?.tipo) === 'video';
  const total = d?.unidades ?? resumen?.unidades ?? 0;
  // Bloque de 12 páginas alrededor de la pedida (la web cuenta desde 1; la API, desde 0).
  const pedida = posicion.u ? posicion.u - 1 : 0;
  const [desde, setDesde] = useState(Math.max(0, pedida - (pedida % POR_BLOQUE)));
  useEffect(() => { setDesde(Math.max(0, pedida - (pedida % POR_BLOQUE))); }, [documento, pedida]);
  const { data: unidades, isPending } = useQuery({
    queryKey: ['ajena', clave, 'unidades', documento, esMedio ? 'todo' : desde],
    queryFn: () => (esMedio ? cliente.documentos.unidades(documento, 0, 99) : cliente.documentos.unidades(documento, desde, desde + POR_BLOQUE - 1)),
    enabled: !!d,
  });
  const { data: medio } = useQuery({ queryKey: ['ajena', clave, 'original', documento], queryFn: () => cliente.documentos.original(documento), enabled: esMedio });
  const reproductor = useRef<HTMLMediaElement>(null);
  const objetivo = useRef<HTMLLIElement>(null);

  // Ir al instante (?t=) o a la página (?u=) pedidos.
  useEffect(() => { if (posicion.t != null && reproductor.current) reproductor.current.currentTime = posicion.t; }, [posicion.t, medio?.url]);
  useEffect(() => { objetivo.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [unidades, posicion.u, posicion.t]);

  const marcada = useMemo(() => {
    if (!unidades) return undefined;
    if (posicion.t != null) return unidades.find((x) => x.ancla.tipo === 'tiempo' && x.ancla.t0 <= posicion.t! && x.ancla.t1 > posicion.t!)?.orden;
    return posicion.u ? posicion.u - 1 : undefined;
  }, [unidades, posicion.u, posicion.t]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {volver ? <Boton variante="fantasma" tam="p" icono="izquierda" onClick={volver}>La colección</Boton> : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[1.25rem] font-semibold text-coffee-800">{d?.metadatos.titulo ?? resumen?.titulo ?? '…'}</h2>
          <p className="truncate text-[0.8125rem] text-coffee-500">
            {[d?.metadatos.autores?.map((a) => [a.nombre, a.apellidos].filter(Boolean).join(' ')).join(', '), d?.metadatos.anio].filter(Boolean).join(' · ')}
            {total ? ` · ${nombreUnidad(d?.tipo ?? resumen!.tipo, total)}` : ''}{d?.duracion ? ` · ${duracion(d.duracion)}` : ''}
          </p>
        </div>
        {alCopiar ? <Boton variante="linea" tam="p" icono="copiar" onClick={() => alCopiar(documento)}>Copiar a mi biblioteca</Boton> : null}
      </div>

      {esMedio && medio?.url ? (
        <div className="sticky top-2 z-10 mb-5 rounded-2xl border border-cream-300 bg-cream-50 p-3 shadow-[var(--levantado)]">
          {d?.tipo === 'video'
            ? <video ref={reproductor as React.RefObject<HTMLVideoElement>} src={medio.url} controls preload="metadata" className="max-h-[50vh] w-full rounded-xl bg-black" />
            : <audio ref={reproductor as React.RefObject<HTMLAudioElement>} src={medio.url} controls preload="metadata" className="w-full" />}
        </div>
      ) : null}

      {isPending || !unidades ? <div className="space-y-4">{[0, 1].map((i) => <Esqueleto key={i} className="h-64 rounded-2xl" />)}</div> : (
        <ol className="space-y-5">
          {unidades.map((u) => (
            <li key={u.id} ref={u.orden === marcada ? objetivo : undefined} className="scroll-mt-24">
              <Unidad u={u} marcada={u.orden === marcada} alPulsar={() => {
                if (u.ancla.tipo === 'tiempo') { alMover({ doc: documento, t: Math.floor(u.ancla.t0) }); if (reproductor.current) { reproductor.current.currentTime = u.ancla.t0; void reproductor.current.play().catch(() => undefined); } }
                else alMover({ doc: documento, u: u.orden + 1 });
              }} />
            </li>
          ))}
        </ol>
      )}

      {!esMedio && total > POR_BLOQUE ? (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Boton variante="linea" tam="p" icono="izquierda" disabled={desde === 0} onClick={() => setDesde(Math.max(0, desde - POR_BLOQUE))}>Anteriores</Boton>
          <Rotulo>{numero(desde + 1)}-{numero(Math.min(total, desde + POR_BLOQUE))} de {numero(total)}</Rotulo>
          <Boton variante="linea" tam="p" icono="derecha" disabled={desde + POR_BLOQUE >= total} onClick={() => setDesde(desde + POR_BLOQUE)}>Siguientes</Boton>
        </div>
      ) : null}
    </div>
  );
}

function Unidad({ u, marcada, alPulsar }: { u: UnidadVista; marcada: boolean; alPulsar: () => void }) {
  const medio = u.ancla.tipo === 'tiempo';
  return (
    <article className={cx('rounded-2xl border bg-cream-50 shadow-[var(--levantado)]', marcada ? 'border-rojo' : 'border-cream-300', medio ? 'p-4' : 'grid gap-5 p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]')}>
      {!medio && (u.imagenUrl || u.miniaturaUrl) ? <img src={u.miniaturaUrl ?? u.imagenUrl} alt={`Página ${u.etiqueta}`} loading="lazy" className="w-full rounded-lg border border-cream-300" /> : null}
      <div className="min-w-0">
        <button type="button" onClick={alPulsar} title="Enlazar este punto" className="mb-2 inline-flex items-center gap-1.5">
          <Folio grande={!medio}>{u.etiqueta}</Folio>
          <Icono nombre="enlace" tam={12} className="text-coffee-300" />
        </button>
        <p className="whitespace-pre-line font-[Georgia] text-[0.9375rem] leading-relaxed text-coffee-800">{textoLimpio(u.texto) || <span className="text-coffee-400">Sin texto.</span>}</p>
      </div>
    </article>
  );
}
