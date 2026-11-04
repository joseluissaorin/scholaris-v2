/**
 * La comprensión de un documento: su mapa (estructura con el resumen de cada
 * parte y la ficha global), sus entidades con todas sus apariciones y sus
 * relaciones con otras obras de la biblioteca, más el estado del flujo y el
 * botón para comprenderlo. Se llega desde la barra del lector («Comprensión»),
 * desde el menú de cada documento y desde la paleta.
 */
import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { Segmento } from '@scholaris/nucleo';
import { avisar, Boton, Composicion, Consejo, cx, Esqueleto, Icono, Vacio } from '@scholaris/ui';
import { q } from '../datos/consultas';
import { fichaGlobal, qc } from '../datos/comprension';
import { anioVisible, autores, esMedio, NOMBRE_TIPO } from '../lib/formato';
import { numero } from '../lib/numero';
import { cuentaCorrespondencias, cuentaLegible, cuentaPorTipo, NOMBRE_CORRESPONDENCIA, NOMBRE_RELACION, verboRelacion, type RelacionVista } from '../lib/comprension';
import { EstadoComprension } from '../componentes/comprension/estado';
import { ArbolEstructura, FichaGlobal, FichaSegmento } from '../componentes/comprension/mapa';
import { PanelEntidades } from '../componentes/comprension/entidades';
import { FormaCorrespondencia } from '../componentes/comprension/alineaciones';
import { AccionesRelacion, DetectarBiblioteca, EstadoAlineacion, NuevaRelacion } from '../componentes/comprension/relaciones';

type Vista = 'mapa' | 'entidades' | 'relaciones';
const VISTAS: Vista[] = ['mapa', 'entidades', 'relaciones'];

interface BusquedaComprension { ver?: Vista; s?: string; e?: string }

export const Route = createFileRoute('/documentos/$id/comprension')({
  validateSearch: (s: Record<string, unknown>): BusquedaComprension => ({
    ver: VISTAS.includes(s.ver as Vista) && s.ver !== 'mapa' ? (s.ver as Vista) : undefined,
    s: typeof s.s === 'string' && s.s ? s.s : undefined,
    e: typeof s.e === 'string' && s.e ? s.e : undefined,
  }),
  loader: async ({ context, params }) => {
    void context.consultas.prefetchQuery(qc.mapa(params.id));
    await context.consultas.ensureQueryData(q.documento(params.id));
  },
  pendingComponent: () => <div className="px-5 py-8 md:px-10"><Esqueleto className="h-6 w-72" /><Esqueleto className="mt-6 h-24 w-full" /><Esqueleto className="mt-6 h-96 w-full" /></div>,
  component: Comprension,
});

function Comprension() {
  const { id } = Route.useParams();
  const { ver = 'mapa', s: elegidoId, e: entidadInicial } = Route.useSearch();
  const navegar = Route.useNavigate();
  const { data: doc } = useSuspenseQuery(q.documento(id));
  const { data: mapa, isError } = useQuery(qc.mapa(id));
  const hecho = !!mapa?.segmentos.length || !!mapa?.global.length;
  const { data: apariciones } = useQuery({ ...qc.apariciones(id), enabled: hecho });
  const { data: relaciones } = useQuery(qc.relaciones(id));
  const medio = esMedio(doc.tipo);
  const global = fichaGlobal(mapa);
  const motivos = useMemo(() => new Set([...(Array.isArray(global?.datos.temas) ? global.datos.temas : []), ...(Array.isArray(global?.datos.motivos) ? global.datos.motivos : [])].map((t: { entidad?: string }) => t?.entidad).filter((x): x is string => !!x)), [global]);
  const elegido = mapa?.segmentos.find((x) => x.id === elegidoId) ?? null;
  const elegir = (x: Segmento | null) => void navegar({ search: (p) => ({ ...p, s: x?.id }), replace: true, resetScroll: false });

  const cuentas: Record<Vista, number | undefined> = { mapa: mapa?.segmentos.length, entidades: mapa?.totales.entidades, relaciones: relaciones?.length };
  const nombres: Record<Vista, string> = { mapa: 'Mapa', entidades: 'Entidades', relaciones: 'Relaciones' };

  return (
    <div className="min-h-dvh">
      <div className="sticky top-14 z-30 border-b border-cream-300 bg-cream-50/90 shadow-[var(--shadow-soft)] backdrop-blur lg:top-0">
        <div className="flex h-[4.25rem] items-center gap-3 px-3 md:px-6">
          <Consejo texto="Volver al lector">
            <Link to="/lector/$id" params={{ id }} aria-label="Volver al lector" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="izquierda" tam={18} /></Link>
          </Consejo>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-apagado">Comprensión</p>
            <h1 className="truncate text-[0.9375rem] font-semibold leading-tight text-coffee-800">{doc.metadatos.titulo}</h1>
          </div>
          {doc.tipo === 'video' && hecho ? (
            <Boton variante="linea" tam="p" comoHijo className="hidden sm:inline-flex">
              <Link to="/lector/$id" params={{ id }} search={{ v: 'pelicula' }}><Icono nombre="video" tam={15} />La película plano a plano</Link>
            </Boton>
          ) : null}
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-10">
        <header className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] text-coffee-600">{autores(doc.metadatos) || 'Sin autor'} · {anioVisible(doc.metadatos)} · {NOMBRE_TIPO[doc.tipo]}</p>
            <h2 className="mt-1 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-coffee-800 sm:text-[1.75rem]">{doc.metadatos.titulo}</h2>
            <p className="mt-2 max-w-3xl text-[0.875rem] text-coffee-600">
              Lo que anotaría quien la hubiera estudiado entera: su estructura, una ficha de cada parte, quién y qué aparece y dónde, y las obras con las que se relaciona. Cada cosa lleva su prueba en la página o en el segundo exactos.
            </p>
          </div>
          <Composicion estilo={medio ? 'kandinsky' : 'malevich'} semilla={doc.id.length + 3} className="hidden h-[84px] w-[126px] shrink-0 md:block" />
        </header>

        <EstadoComprension documento={id} mapa={mapa} listo={doc.estado === 'listo'} className="mt-6" />
        {isError ? <p role="alert" className="mt-4 rounded-xl border border-rojo/30 bg-rojo-suave/50 p-4 text-[0.875rem] text-coffee-800">No se pudo leer la comprensión de este documento. Vuelve a intentarlo en unos segundos.</p> : null}

        <nav aria-label="Apartados de la comprensión" className="sin-barra mt-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-cream-400 bg-cream-200/70 p-1 shadow-[var(--hundido)]">
          {VISTAS.map((v) => (
            <Link key={v} to="/documentos/$id/comprension" params={{ id }} search={{ ver: v === 'mapa' ? undefined : v }} resetScroll={false}
              aria-current={ver === v ? 'page' : undefined}
              className={cx('tactil flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 text-[0.8125rem] font-medium', ver === v ? 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-600 hover:text-coffee-800')}>
              {nombres[v]}{cuentas[v] ? <span className="text-[0.75rem] text-apagado tnum">{numero(cuentas[v]!)}</span> : null}
            </Link>
          ))}
        </nav>

        <div className="mt-6">
          {!mapa ? <Esqueleto className="h-96 rounded-2xl" />
            : ver === 'mapa' ? (
              hecho ? (
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                  <div className="min-w-0">
                    {global ? <FichaGlobal ficha={global} apariciones={apariciones ?? []} /> : <p className="text-[0.875rem] text-apagado">La ficha global todavía no está escrita.</p>}
                  </div>
                  <aside aria-label="Estructura" className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-[0.9375rem] font-semibold text-coffee-800">Estructura</h3>
                      <p className="text-[0.75rem] text-apagado">{cuentaPorTipo(mapa.segmentos).map(([t, n]) => cuentaLegible(t, n)).join(', ')}{mapa.totales.planos ? `, ${cuentaLegible('plano', mapa.totales.planos)}` : ''}</p>
                    </div>
                    <p className="mt-0.5 text-[0.75rem] text-apagado">Pulsa una parte para ver su ficha; el folio abre el lector ahí.</p>
                    <ArbolEstructura documento={id} segmentos={mapa.segmentos} elegido={elegidoId ?? null} alElegir={elegir} className="mt-2" />
                    {elegido ? <FichaSegmento key={elegido.id} documento={id} segmento={elegido} className="mt-4" /> : null}
                  </aside>
                </div>
              ) : <SinComprension medio={medio} />
            ) : ver === 'entidades' ? (
              hecho ? <PanelEntidades documento={id} apariciones={apariciones} motivos={motivos} {...(entidadInicial ? { inicial: entidadInicial } : {})} className="max-w-3xl" /> : <SinComprension medio={medio} />
            ) : (
              <Relaciones documento={id} titulo={doc.metadatos.titulo} relaciones={relaciones} />
            )}
        </div>
      </div>
    </div>
  );
}

function SinComprension({ medio }: { medio: boolean }) {
  return (
    <Vacio forma={medio ? 'circulo' : 'cuadrado'} titulo="Aún no hay nada comprendido">
      Pulsa «Comprender» arriba: la estructura, las fichas y las entidades aparecen aquí según se escriben.
    </Vacio>
  );
}

/** Las obras con que se relaciona: el verbo desde este lado, la ficha de la relación y la vista lado a lado; y ponerlas a mano. */
function Relaciones({ documento, titulo, relaciones }: { documento: string; titulo: string; relaciones: RelacionVista[] | undefined }) {
  const [nueva, setNueva] = useState(false);
  const [detectar, setDetectar] = useState(false);
  const acciones = (
    <div className="flex flex-wrap gap-2">
      <Boton variante="linea" tam="p" icono="mas" onClick={() => setNueva(true)}>Añadir una relación</Boton>
      <Boton variante="fantasma" tam="p" icono="pila" onClick={() => setDetectar(true)}>Buscar en toda la biblioteca</Boton>
    </div>
  );
  return (
    <>
      {!relaciones ? <Esqueleto className="h-40 rounded-2xl" /> : !relaciones.length ? (
        <Vacio forma="triangulo" titulo="Sin relaciones con otras obras" accion={acciones}>
          Cuando en tu biblioteca haya una adaptación, una traducción u otra edición de esta obra, aparecerá aquí con sus correspondencias, pasaje a pasaje. Si la detección no la ve, ponla a mano.
        </Vacio>
      ) : (
        <>
          <div className="mb-4">{acciones}</div>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {relaciones.map((r) => <TarjetaRelacion key={r.id} r={r} documento={documento} />)}
          </ul>
        </>
      )}
      <NuevaRelacion documento={documento} titulo={titulo} abierto={nueva} alCambiar={setNueva} />
      <DetectarBiblioteca abierto={detectar} alCambiar={setDetectar} />
    </>
  );
}

function TarjetaRelacion({ r, documento }: { r: RelacionVista; documento: string }) {
  const { data: als } = useQuery(qc.alineaciones(r.id));
  const [abierta, setAbierta] = useState(false);
  const resumen = (r.ficha?.datos.resumen as { es?: string } | undefined)?.es;
  const autoria = [r.otro.autores.join(', '), r.otro.anio].filter(Boolean).join(', ');
  return (
    <li className="flex flex-col rounded-2xl border border-cream-400 bg-cream-50 p-4 shadow-[var(--levantado)]">
      <p className="text-[0.75rem] font-semibold text-coffee-500">{NOMBRE_RELACION[r.tipo]}{r.confirmada ? <span className="font-normal text-apagado"> (confirmada)</span> : null}</p>
      <h3 className="mt-1 text-[1.0625rem] leading-snug text-coffee-800">
        Esta obra {verboRelacion(r.tipo, r.sentido)}{' '}
        <Link to="/documentos/$id/comprension" params={{ id: r.otro.id }} className="font-semibold italic underline decoration-cream-500 underline-offset-4 hover:decoration-coffee-500">{r.otro.titulo}</Link>
        {autoria ? <span className="text-coffee-600"> ({autoria})</span> : null}
      </h3>
      {resumen ? <p className="mt-2 text-[0.875rem] text-coffee-700">{resumen}</p> : null}
      <EstadoAlineacion r={r} documento={documento} className="mt-3" />
      {r.ficha?.texto ? (
        <>
          <p className={cx('lectura mt-2 text-[0.875rem] leading-relaxed text-coffee-800', !abierta && 'line-clamp-4')}>{r.ficha.texto}</p>
          <button type="button" aria-expanded={abierta} onClick={() => setAbierta((x) => !x)} className="mt-1 self-start text-[0.8125rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">{abierta ? 'Plegar' : 'Leer la ficha entera'}</button>
        </>
      ) : null}
      {als?.length ? (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Correspondencias por tipo">
          {cuentaCorrespondencias(als).map(([t, n]) => (
            <li key={t} className="flex items-center gap-1.5 text-[0.8125rem] text-coffee-700"><FormaCorrespondencia tipo={t} />{NOMBRE_CORRESPONDENCIA[t]} <span className="text-apagado tnum">{n}</span></li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-cream-200 pt-3">
        <Boton variante="tinta" tam="p" comoHijo className={r.alineaciones ? undefined : 'opacity-60'}>
          <Link to="/relaciones/$id" params={{ id: r.id }} search={{ desde: documento }}><Icono nombre="pila" tam={15} />Ver lado a lado{r.alineaciones ? ` (${r.alineaciones})` : ''}</Link>
        </Boton>
        <span className="text-[0.75rem] text-apagado">Confianza {Math.round(r.confianza * 100)} %, {r.fuente === 'modelo' ? 'propuesta por el modelo' : r.fuente === 'wikidata' ? 'según Wikidata' : r.fuente === 'metadatos' ? 'por los metadatos' : 'puesta a mano'}</span>
      </div>
      <AccionesRelacion r={r} documento={documento} className="mt-2" />
    </li>
  );
}
