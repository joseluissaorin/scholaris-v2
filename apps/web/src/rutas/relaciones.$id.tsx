/**
 * Dos obras relacionadas, lado a lado: arriba, la ficha de la relación (qué
 * conserva, qué cambia, qué añade y qué suprime) con la leyenda de las
 * correspondencias, que filtra; a cada lado, el visor de su obra (el vídeo en el
 * tramo, o la página con la región rodeada y los caracteres subrayados); en el
 * centro, cada alineación con su tipo y su nota. Elegir una alineación lleva
 * los dos visores a sus anclas; J y K pasan a la siguiente y a la anterior.
 *
 * Se llega desde la comprensión de cualquiera de las dos obras (Relaciones,
 * «Ver lado a lado»); `desde` dice cuál va a la izquierda.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { Segmento, TipoCorrespondencia } from '@scholaris/nucleo';
import { Boton, Consejo, cx, Esqueleto, Icono, Teclas } from '@scholaris/ui';
import { q } from '../datos/consultas';
import { qc } from '../datos/comprension';
import { esNoEncontrado } from '../componentes/comunes/errores';
import { cuentaCorrespondencias, NOMBRE_CORRESPONDENCIA, NOMBRE_RELACION, SENTIDO_CORRESPONDENCIA, verboRelacion } from '../lib/comprension';
import { CambiosRelacion, FilaAlineacion, FormaCorrespondencia, VisorLado } from '../componentes/comprension/alineaciones';
import { AccionesRelacion, EstadoAlineacion } from '../componentes/comprension/relaciones';

interface BusquedaRelacion { desde?: string; al?: string; tipo?: TipoCorrespondencia }
// Aquí y no de lib/comprension: la validación va en el trozo inicial y no debe arrastrar la biblioteca entera.
const TIPOS: readonly string[] = ['equivalente', 'traducido', 'condensado', 'ampliado', 'transformado', 'reordenado', 'anadido', 'suprimido', 'alusion'];

export const Route = createFileRoute('/relaciones/$id')({
  validateSearch: (s: Record<string, unknown>): BusquedaRelacion => ({
    desde: typeof s.desde === 'string' && s.desde ? s.desde : undefined,
    al: typeof s.al === 'string' && s.al ? s.al : undefined,
    tipo: TIPOS.includes(s.tipo as string) ? (s.tipo as TipoCorrespondencia) : undefined,
  }),
  loader: async ({ context, params }) => {
    try {
      const r = await context.consultas.ensureQueryData(qc.relacion(params.id));
      void context.consultas.prefetchQuery(qc.alineaciones(params.id));
      void context.consultas.prefetchQuery(q.documento(r.origen));
      void context.consultas.prefetchQuery(q.documento(r.destino));
    } catch (e) {
      if (esNoEncontrado(e)) throw notFound();
      throw e;
    }
  },
  pendingComponent: () => <div className="px-5 py-8 md:px-10"><Esqueleto className="h-6 w-72" /><Esqueleto className="mt-6 h-40 w-full" /><Esqueleto className="mt-6 h-96 w-full" /></div>,
  component: LadoALado,
});

function LadoALado() {
  const { id } = Route.useParams();
  const { desde, al: elegidaId, tipo } = Route.useSearch();
  const navegar = Route.useNavigate();
  const { data: r } = useSuspenseQuery(qc.relacion(id));
  const izq = desde === r.destino ? r.destino : r.origen;
  const der = izq === r.origen ? r.destino : r.origen;
  const { data: docIzq } = useQuery(q.documento(izq));
  const { data: docDer } = useQuery(q.documento(der));
  // Mientras se alinea, las correspondencias van llegando: se piden de nuevo cada pocos segundos.
  const { data: todas, isPending } = useQuery({ ...qc.alineaciones(id), refetchInterval: r.estadoAlineacion?.estado === 'en_marcha' ? 6000 : false });
  const { data: segIzq } = useQuery(qc.segmentos(izq));
  const { data: segDer } = useQuery(qc.segmentos(der));
  const segmentos = useMemo(() => new Map<string, Segmento>([...(segIzq ?? []), ...(segDer ?? [])].map((s) => [s.id, s])), [segIzq, segDer]);
  const lista = useMemo(() => [...(todas ?? [])].sort((a, b) => a.orden - b.orden).filter((x) => !tipo || x.tipo === tipo), [todas, tipo]);
  const k = Math.max(0, lista.findIndex((x) => x.id === elegidaId));
  const elegida = lista[k];
  const ladoDe = (doc: string) => (elegida?.a?.documento === doc ? elegida.a : elegida?.b?.documento === doc ? elegida.b : undefined);

  const elegir = useCallback((al: string) => void navegar({ search: (s) => ({ ...s, al }), replace: true, resetScroll: false }), [navegar]);
  // J y K: la siguiente y la anterior (como en un lector de noticias); fuera de los campos.
  useEffect(() => {
    const t = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const tecla = e.key.toLowerCase();
      if (tecla === 'j' && k + 1 < lista.length) { e.preventDefault(); elegir(lista[k + 1]!.id); }
      else if (tecla === 'k' && k > 0) { e.preventDefault(); elegir(lista[k - 1]!.id); }
    };
    window.addEventListener('keydown', t);
    return () => window.removeEventListener('keydown', t);
  }, [k, lista, elegir]);

  const sentido = izq === r.origen ? 'origen' : 'destino';
  const tituloIzq = docIzq?.metadatos.titulo ?? '', tituloDer = docDer?.metadatos.titulo ?? '';
  const ficha = r.ficha;
  const resumen = (ficha?.datos.resumen as { es?: string } | undefined)?.es;
  const motorIzq = docIzq ? docIzq.tipo === 'video' || docIzq.tipo === 'audio' : false;

  return (
    <div className="min-h-dvh">
      <div className="sticky top-14 z-30 border-b border-cream-300 bg-cream-50/90 shadow-[var(--shadow-soft)] backdrop-blur lg:top-0">
        <div className="flex h-[4.25rem] items-center gap-3 px-3 md:px-6">
          <Consejo texto="Volver a la comprensión">
            <Link to="/documentos/$id/comprension" params={{ id: izq }} search={{ ver: 'relaciones' }} aria-label="Volver a la comprensión" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="izquierda" tam={18} /></Link>
          </Consejo>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-apagado">{NOMBRE_RELACION[r.tipo]} lado a lado</p>
            <h1 className="truncate text-[0.9375rem] font-semibold leading-tight text-coffee-800"><em>{tituloIzq}</em> y <em>{tituloDer}</em></h1>
          </div>
          <Consejo texto="Poner la otra obra a la izquierda">
            <Boton variante="linea" tam="p" comoHijo><Link to="/relaciones/$id" params={{ id }} search={{ desde: der, ...(tipo ? { tipo } : {}) }} aria-label="Cambiar de lado: la otra obra a la izquierda"><Icono nombre="ordenar" tam={15} /><span className="hidden sm:inline">Cambiar de lado</span></Link></Boton>
          </Consejo>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
        <header className="max-w-4xl">
          <h2 className="text-[1.375rem] font-bold leading-tight tracking-[-0.01em] text-coffee-800 sm:text-[1.625rem]">
            <em>{tituloIzq}</em> {verboRelacion(r.tipo, sentido)} <em>{tituloDer}</em>
          </h2>
          {resumen ? <p className="mt-2 text-[1rem] text-coffee-700">{resumen}</p> : null}
          {ficha?.texto ? <p className="lectura mt-3 text-[0.9375rem] leading-relaxed text-coffee-800">{ficha.texto}</p> : null}
          {ficha ? <CambiosRelacion ficha={ficha} tituloA={r.origen === izq ? tituloIzq : tituloDer} tituloB={r.destino === izq ? tituloIzq : tituloDer} className="mt-4" /> : null}
          <EstadoAlineacion r={r} documento={izq} className="mt-4 max-w-xl" />
          <AccionesRelacion r={r} documento={izq} className="mt-3" alRechazar={() => void navegar({ to: '/documentos/$id/comprension', params: { id: izq }, search: { ver: 'relaciones' } })} />
        </header>

        {todas?.length ? (
          <div className="mt-6 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por tipo de correspondencia">
            <FiltroTipo activo={!tipo} recuento={todas.length} a={undefined}>Todas</FiltroTipo>
            {cuentaCorrespondencias(todas).map(([t, n]) => <FiltroTipo key={t} activo={tipo === t} recuento={n} a={tipo === t ? undefined : t} tipo={t}>{NOMBRE_CORRESPONDENCIA[t]}</FiltroTipo>)}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 md:order-1 xl:sticky xl:top-24 xl:self-start">
            <VisorLado doc={docIzq} lado={ladoDe(izq)} tipo={elegida?.tipo} otroTitulo={tituloDer} conMotor={motorIzq} />
          </div>
          <div className="min-w-0 md:order-3 md:col-span-2 xl:order-2 xl:col-span-1">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[0.9375rem] font-semibold text-coffee-800">Correspondencias</h2>
              <span className="text-[0.75rem] text-apagado">{lista.length ? `${k + 1} de ${lista.length}` : ''}</span>
              <span className="ml-auto hidden items-center gap-1 text-[0.75rem] text-apagado sm:flex"><Teclas>J</Teclas><Teclas>K</Teclas> siguiente y anterior</span>
            </div>
            <div className="mb-2 flex justify-between gap-3 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-coffee-500" aria-hidden>
              <span className="min-w-0 truncate">{tituloIzq}</span><span className="min-w-0 truncate text-right">{tituloDer}</span>
            </div>
            {isPending ? <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-20 rounded-xl" />)}</div>
              : !lista.length ? <p className="rounded-xl border border-dashed border-cream-500 p-4 text-[0.875rem] text-coffee-600">{todas?.length ? 'Ninguna correspondencia de ese tipo.' : 'Esta relación todavía no tiene alineaciones: se calculan después de comprender las dos obras.'}</p>
              : (
                <ol className="flex flex-col gap-2" aria-label="Correspondencias">
                  {lista.map((al, i) => <FilaAlineacion key={al.id} al={al} izq={izq} der={der} segmentos={segmentos} elegida={al.id === elegida?.id} alElegir={elegir} numero={i + 1} />)}
                </ol>
              )}
          </div>
          <div className="min-w-0 md:order-2 xl:order-3 xl:sticky xl:top-24 xl:self-start">
            <VisorLado doc={docDer} lado={ladoDe(der)} tipo={elegida?.tipo} otroTitulo={tituloIzq} conMotor={!motorIzq && !!docDer && (docDer.tipo === 'video' || docDer.tipo === 'audio')} />
          </div>
        </div>
        {elegida ? <p className="sr-only" aria-live="polite">{NOMBRE_CORRESPONDENCIA[elegida.tipo]}: {SENTIDO_CORRESPONDENCIA[elegida.tipo]}. {elegida.nota}</p> : null}
      </div>
    </div>
  );
}

function FiltroTipo({ activo, recuento, a, tipo, children }: { activo: boolean; recuento: number; a: TipoCorrespondencia | undefined; tipo?: TipoCorrespondencia; children: string }) {
  const { id } = Route.useParams();
  const { desde } = Route.useSearch();
  return (
    <Link to="/relaciones/$id" params={{ id }} search={{ ...(desde ? { desde } : {}), ...(a ? { tipo: a } : {}) }} replace resetScroll={false} aria-current={activo ? 'true' : undefined}
      title={tipo ? SENTIDO_CORRESPONDENCIA[tipo] : undefined}
      className={cx('tactil inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[0.8125rem] font-medium',
        activo ? 'border-[#1a0f0a] bg-coffee-800 text-cream-50 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)]' : 'border-cream-400 bg-cream-50 text-coffee-600 shadow-[var(--relieve)] hover:-translate-y-px hover:text-coffee-800')}>
      {tipo ? <FormaCorrespondencia tipo={tipo} /> : null}{children}<span className={cx('tnum text-[0.75rem]', activo ? 'text-cream-300' : 'text-coffee-400')}>{recuento}</span>
    </Link>
  );
}
