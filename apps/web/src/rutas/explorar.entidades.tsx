/**
 * Personas y obras: el grafo de conocimiento de la biblioteca. A la izquierda,
 * la lista que se busca; a la derecha, la ficha de la entidad elegida con su
 * vecindario dibujado, dónde aparece (cada mención abre el lector en su folio),
 * su línea temporal y el camino hasta otra entidad.
 */
import { useDeferredValue, useEffect, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Entidad, FichaEntidad, TipoEntidad } from '@scholaris/contrato';
import { avisar, Boton, Campo, Chip, cx, Esqueleto, Folio, Rotulo, Tarjeta, Vacio } from '@scholaris/ui';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { anclaABusqueda } from '../lib/anclas';
import { etiquetaCorta } from '../lib/formato';
import { GrafoEntidades, FormaEntidad } from '../componentes/entidades/grafo-entidades';
import { documentos, menciones, NOMBRE_TIPO_ENTIDAD, Pasaje, PLURAL_TIPO_ENTIDAD, PUNTO_TIPO_ENTIDAD } from '../componentes/entidades/comun';

interface BusquedaEntidades { q?: string; tipo?: TipoEntidad; e?: string }

const TIPOS: TipoEntidad[] = ['persona', 'obra', 'lugar', 'organizacion', 'evento', 'concepto'];

export const Route = createFileRoute('/explorar/entidades')({
  validateSearch: (s: Record<string, unknown>): BusquedaEntidades => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    tipo: typeof s.tipo === 'string' && (TIPOS as string[]).includes(s.tipo) ? (s.tipo as TipoEntidad) : undefined,
    e: typeof s.e === 'string' && s.e ? s.e : undefined,
  }),
  component: Entidades,
});

function Entidades() {
  const busqueda = Route.useSearch();
  const navegar = useNavigate({ from: '/explorar/entidades' });
  const [texto, setTexto] = useState(busqueda.q ?? '');
  const diferido = useDeferredValue(texto.trim());
  const lista = useQuery(q.entidades(diferido, busqueda.tipo));
  const elegida = busqueda.e ?? lista.data?.elementos[0]?.id;

  useEffect(() => {
    // La URL sigue a la búsqueda (sin llenar el historial).
    if ((busqueda.q ?? '') !== diferido) void navegar({ search: (s) => ({ ...s, q: diferido || undefined }), replace: true });
  }, [diferido, busqueda.q, navegar]);

  const elegir = (id: string) => void navegar({ search: (s) => ({ ...s, e: id }) });

  return (
    <Lienzo>
      <div className="max-w-2xl">
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.01em] text-coffee-800">Quién y qué aparece en tus documentos.</h2>
        <p className="mt-1 text-[0.9375rem] text-coffee-600">Personas, obras y lugares de toda tu biblioteca, con cada mención en su página o en su minuto. Pulsa una para ver con quién aparece y cómo se llega de un libro a otro.</p>
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <section aria-label="Lista de entidades" className="flex min-w-0 flex-col gap-3">
          <Campo icono="buscar" placeholder="Buscar: Cortázar, Parker, París…" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Buscar entidades" />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
            {TIPOS.map((t) => (
              <Chip key={t} punto={PUNTO_TIPO_ENTIDAD[t]} activo={busqueda.tipo === t} aria-pressed={busqueda.tipo === t}
                onClick={() => void navegar({ search: (s) => ({ ...s, tipo: s.tipo === t ? undefined : t }), replace: true })}>{PLURAL_TIPO_ENTIDAD[t]}</Chip>
            ))}
          </div>
          {lista.isPending ? (
            <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4, 5].map((i) => <Esqueleto key={i} className="h-11" />)}</div>
          ) : lista.isError ? (
            <p className="text-[0.875rem] text-coffee-600">No se ha podido cargar la lista. Vuelve a intentarlo en un momento.</p>
          ) : !lista.data?.elementos.length ? (
            diferido || busqueda.tipo ? <p className="text-[0.875rem] text-coffee-600">Nada con ese nombre en tu biblioteca.</p> : null
          ) : (
            <>
              <Rotulo>{lista.data.total ?? lista.data.elementos.length} {(lista.data.total ?? 0) === 1 ? 'entidad' : 'entidades'}</Rotulo>
              <ul className="-mx-1 flex max-h-[70dvh] flex-col gap-0.5 overflow-y-auto px-1 pb-2">
                {lista.data.elementos.map((e) => <FilaLista key={e.id} e={e} activa={e.id === elegida} alElegir={() => elegir(e.id)} />)}
              </ul>
            </>
          )}
        </section>
        <section aria-label="Ficha de la entidad" className="min-w-0">
          {elegida ? <Ficha id={elegida} alElegir={elegir} /> : lista.isPending ? <Esqueleto className="h-96" /> : <SinEntidades />}
        </section>
      </div>
    </Lienzo>
  );
}

function FilaLista({ e, activa, alElegir }: { e: Entidad; activa: boolean; alElegir: () => void }) {
  return (
    <li>
      <button type="button" onClick={alElegir} aria-current={activa || undefined}
        className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-[background,box-shadow]',
          activa ? 'bg-cream-50 shadow-[var(--relieve)]' : 'hover:bg-cream-200/70')}>
        <svg viewBox="-12 -12 24 24" className="h-4 w-4 shrink-0" aria-hidden><FormaEntidad tipo={e.tipo} r={8} /></svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium text-coffee-800">{e.nombre}</span>
          <span className="block truncate text-[0.75rem] text-coffee-500">{e.descripcion ?? NOMBRE_TIPO_ENTIDAD[e.tipo]}</span>
        </span>
        <span className="tnum shrink-0 font-mono text-[0.6875rem] text-coffee-500" title={`${menciones(e.menciones)} en ${documentos(e.documentos)}`}>
          {e.documentos > 1 ? `${e.documentos} doc.` : `×${e.menciones}`}
        </span>
      </button>
    </li>
  );
}

function SinEntidades() {
  const qc = useQueryClient();
  const estado = useQuery(q.estadoEntidades());
  const [lanzando, setLanzando] = useState(false);
  const enMarcha = estado.data?.documentos.filter((d) => d.estado === 'en_marcha' || d.estado === 'pendiente').length ?? 0;
  async function reconocer() {
    setLanzando(true);
    try {
      const r = await api().entidades.reanudar(true);
      avisar(r.reanudados.length ? `Reconociendo entidades en ${documentos(r.reanudados.length)}. Aparecerán aquí a medida que terminen.` : 'Tu biblioteca ya está al día.');
      void qc.invalidateQueries({ queryKey: ['entidades'] });
    } catch {
      avisar('No se ha podido empezar. Vuelve a intentarlo en un momento.', { tono: 'error' });
    } finally {
      setLanzando(false);
    }
  }
  return (
    <Vacio forma="circulo" titulo={enMarcha ? 'Leyendo tu biblioteca en busca de personas y obras…' : 'Aún no hay personas ni obras reconocidas.'}
      accion={enMarcha ? undefined : <Boton variante="tinta" cargando={lanzando} onClick={() => void reconocer()}>Reconocer en toda la biblioteca</Boton>}>
      {enMarcha
        ? `Quedan ${documentos(enMarcha)}. Cada documento nuevo se lee solo al terminar de subirlo.`
        : 'Cada documento nuevo se lee solo al subirlo. Para los que ya tenías, pulsa el botón: cuesta unos céntimos por libro.'}
    </Vacio>
  );
}

function Ficha({ id, alElegir }: { id: string; alElegir: (id: string) => void }) {
  const ficha = useQuery(q.entidad(id));
  const vecindario = useQuery(q.vecindario(id));
  if (ficha.isPending) return <div className="flex flex-col gap-4"><Esqueleto className="h-16 w-2/3" /><Esqueleto className="aspect-[16/9]" /><Esqueleto className="h-40" /></div>;
  if (ficha.isError || !ficha.data) return <Vacio forma="cuadrado" titulo="Esta entidad ya no está.">Puede que se haya unido a otra o que se borrara el documento donde aparecía.</Vacio>;
  const f = ficha.data;
  return (
    <article className="anim-entra flex flex-col gap-6" aria-labelledby="titulo-entidad">
      <header>
        <Rotulo>{NOMBRE_TIPO_ENTIDAD[f.tipo]}{f.wikidata ? ' · ' : ''}{f.wikidata ? <a href={`https://www.wikidata.org/wiki/${f.wikidata}`} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-coffee-800">Wikidata {f.wikidata}</a> : null}</Rotulo>
        <h3 id="titulo-entidad" className="mt-1 text-[1.75rem] font-bold leading-tight tracking-[-0.015em] text-coffee-800">{f.nombre}</h3>
        {f.descripcion ? <p className="mt-1 text-[0.9375rem] text-coffee-600">{f.descripcion}</p> : null}
        <p className="mt-2 text-[0.875rem] text-coffee-600">{menciones(f.menciones)} en {documentos(f.documentos)}{f.alias.length ? <> · también «{f.alias.slice(0, 5).join('», «')}»</> : null}</p>
      </header>

      {vecindario.data && vecindario.data.nodos.length > 1 ? (
        <Tarjeta className="overflow-hidden p-2">
          <GrafoEntidades datos={vecindario.data} alElegir={(e) => alElegir(e.id)} />
          <p className="px-3 pb-2 text-[0.75rem] text-coffee-500">Las líneas más gruesas unen lo que aparece más cerca y más veces. Pasa por encima de una línea para ver la relación, si el texto la dice.</p>
        </Tarjeta>
      ) : vecindario.isPending ? <Esqueleto className="aspect-[16/9]" /> : null}

      {f.vecinos.some((v) => v.relacion) ? (
        <div>
          <Rotulo>Lo que dicen los textos</Rotulo>
          <ul className="mt-2 flex flex-col gap-1.5">
            {f.vecinos.filter((v) => v.relacion).map((v) => (
              <li key={v.entidad.id} className="text-[0.9375rem] text-coffee-700">
                <button type="button" className="text-left hover:underline" onClick={() => alElegir(v.entidad.id)}>{v.relacion}</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DondeAparece f={f} />
      <LineaTemporal id={f.id} />
      <Camino desde={f} alElegir={alElegir} />
    </article>
  );
}

function DondeAparece({ f }: { f: FichaEntidad }) {
  return (
    <div>
      <Rotulo>Dónde aparece</Rotulo>
      <ul className="mt-3 flex flex-col gap-5">
        {f.porDocumento.map((d) => (
          <li key={d.documento}>
            <div className="flex items-baseline gap-2">
              <Link to="/lector/$id" params={{ id: d.documento }} className="min-w-0 truncate text-[1rem] font-semibold text-coffee-800 hover:underline">{d.titulo || 'Sin título'}</Link>
              <span className="shrink-0 text-[0.8125rem] text-coffee-500">{[d.autores, d.anio].filter(Boolean).join(', ')}</span>
              <span className="tnum ml-auto shrink-0 font-mono text-[0.6875rem] text-coffee-500">{menciones(d.total)}</span>
            </div>
            <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-cream-400 pl-3">
              {d.menciones.map((m) => (
                <li key={m.id}>
                  <Link to="/lector/$id" params={{ id: d.documento }} search={anclaABusqueda(m.ancla, { f: m.fragmento, q: m.texto })}
                    className="group flex items-baseline gap-2.5 rounded-md py-0.5 text-[0.875rem] leading-snug text-coffee-700">
                    <Folio className="shrink-0">{etiquetaCorta(m.ancla, m.etiqueta)}</Folio>
                    <Pasaje texto={m.contexto} className="min-w-0 group-hover:text-coffee-900" />
                  </Link>
                </li>
              ))}
              {d.total > d.menciones.length ? <li className="text-[0.8125rem] text-coffee-500">y {menciones(d.total - d.menciones.length)} más en este documento.</li> : null}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineaTemporal({ id }: { id: string }) {
  const { data } = useQuery(q.lineaEntidad(id));
  const conAnio = data?.elementos.filter((x) => x.anio !== undefined) ?? [];
  const anios = [...new Set(conAnio.map((x) => x.anio!))];
  if (anios.length < 2) return null;
  return (
    <div>
      <Rotulo>En el tiempo</Rotulo>
      <ol className="mt-3 flex flex-col gap-2">
        {anios.slice(0, 12).map((a) => {
          const del = conAnio.filter((x) => x.anio === a);
          const x = del[0]!;
          return (
            <li key={a} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-3">
              <span className="tnum font-mono text-[0.8125rem] font-semibold text-coffee-800">{a}</span>
              <Link to="/lector/$id" params={{ id: x.documento }} search={anclaABusqueda(x.ancla, { f: x.fragmento })} className="text-[0.875rem] text-coffee-700 hover:underline">
                <span className="">{x.titulo}</span>, {etiquetaCorta(x.ancla, x.etiqueta)}{x.fecha ? ` (el pasaje dice ${x.fecha})` : ''}
                {del.length > 1 ? <span className="text-coffee-500"> y {del.length - 1} {del.length === 2 ? 'pasaje' : 'pasajes'} más</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Camino({ desde, alElegir }: { desde: Entidad; alElegir: (id: string) => void }) {
  const [texto, setTexto] = useState('');
  const [hasta, setHasta] = useState<Entidad | null>(null);
  const diferido = useDeferredValue(texto.trim());
  const sugerencias = useQuery({ ...q.entidades(diferido), enabled: diferido.length > 1 && !hasta });
  const camino = useQuery(q.caminoEntidades(desde.id, hasta?.id ?? ''));
  useEffect(() => { setHasta(null); setTexto(''); }, [desde.id]);
  return (
    <div>
      <Rotulo>Cómo se llega a otra</Rotulo>
      <div className="relative mt-2 max-w-md">
        <Campo icono="buscar" placeholder={`De ${desde.nombre} a…`} value={hasta ? hasta.nombre : texto} aria-label="Entidad de destino"
          onChange={(e) => { setHasta(null); setTexto(e.target.value); }} />
        {!hasta && sugerencias.data?.elementos.length ? (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-cream-400 bg-cream-50 p-1 shadow-[var(--relieve-alto)]">
            {sugerencias.data.elementos.filter((e) => e.id !== desde.id).slice(0, 8).map((e) => (
              <li key={e.id}><button type="button" className="w-full rounded-md px-2.5 py-1.5 text-left text-[0.875rem] hover:bg-cream-200" onClick={() => setHasta(e)}>{e.nombre} <span className="text-coffee-500">· {NOMBRE_TIPO_ENTIDAD[e.tipo]}</span></button></li>
            ))}
          </ul>
        ) : null}
      </div>
      {hasta ? (
        camino.isPending ? <Esqueleto className="mt-3 h-24" /> : !camino.data?.pasos.length ? (
          <p className="mt-3 text-[0.875rem] text-coffee-600">No hay camino en cuatro pasos o menos: en tu biblioteca no aparecen cerca.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {camino.data.pasos.map((p, i) => (
              <li key={p.entidad.id} className="flex gap-3">
                <svg viewBox="-12 -12 24 24" className="mt-1 h-4 w-4 shrink-0" aria-hidden><FormaEntidad tipo={p.entidad.tipo} r={8} /></svg>
                <div className="min-w-0">
                  <button type="button" onClick={() => alElegir(p.entidad.id)} className="text-[0.9375rem] font-semibold text-coffee-800 hover:underline">{p.entidad.nombre}</button>
                  {p.via ? (
                    <Link to="/lector/$id" params={{ id: p.via.documento }} search={anclaABusqueda(p.via.ancla, { f: p.via.fragmento })} className="mt-0.5 block text-[0.8125rem] leading-snug text-coffee-600 hover:text-coffee-800">
                      {p.via.relacion ? <span className="block font-medium text-coffee-700">{p.via.relacion}</span> : null}
                      <span className="">{p.via.titulo}</span>, {etiquetaCorta(p.via.ancla, p.via.etiqueta)}: <Pasaje texto={p.via.contexto} />
                    </Link>
                  ) : i === 0 ? null : <span className="block text-[0.8125rem] text-coffee-500">Aparecen juntas.</span>}
                </div>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
