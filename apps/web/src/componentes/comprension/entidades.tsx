/**
 * Las entidades de un documento (personas y personajes, lugares, obras, temas y
 * motivos) con todas sus apariciones ancladas: el rol (nombrado, habla, en
 * cuadro, se oye…), su folio y, si hay región, su recorte. Al pulsar una se va a
 * la página con los caracteres o la región marcados, o al instante del vídeo con
 * la región sobre el fotograma. Debajo, la misma entidad en las otras obras de
 * la biblioteca.
 */
import { memo, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { AparicionVista } from '@scholaris/contrato';
import { Chip, cx, Esqueleto, Folio, Icono, Rotulo } from '@scholaris/ui';
import { aparicionesFuera, qc } from '../../datos/comprension';
import { q } from '../../datos/consultas';
import {
  agruparApariciones, categoriaDe, etiquetaAncla, NOMBRE_CATEGORIA, NOMBRE_ROL, resumenRoles, type CategoriaEntidad, type EntidadEnDocumento,
} from '../../lib/comprension';
import { DatosFicha } from './mapa';
import { enlaceAncla, VistaAncla } from './material';

const CATEGORIAS: CategoriaEntidad[] = ['personas', 'lugares', 'obras', 'motivos', 'otras'];
const FORMA: Record<CategoriaEntidad, string> = {
  personas: 'h-2.5 w-2.5 rounded-full bg-azul', lugares: 'h-2.5 w-2.5 bg-rojo', obras: 'h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-amarillo',
  motivos: 'h-2.5 w-2.5 rotate-45 bg-coffee-800', otras: 'h-2.5 w-2.5 rounded-full border-2 border-coffee-500',
};
const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function PanelEntidades({ documento, apariciones, motivos, alIr, compacto, inicial, className }: {
  documento: string;
  apariciones: AparicionVista[] | undefined;
  /** Las entidades que son temas o motivos de la ficha global. */
  motivos?: ReadonlySet<string>;
  /** En el lector: ir a la aparición sin salir (si no, enlaza al lector). */
  alIr?: (a: AparicionVista) => void;
  compacto?: boolean;
  /** La entidad abierta al llegar. */
  inicial?: string;
  className?: string;
}) {
  const entidades = useMemo(() => agruparApariciones(apariciones ?? [], motivos), [apariciones, motivos]);
  const [categoria, setCategoria] = useState<CategoriaEntidad | null>(null);
  const [filtro, setFiltro] = useState('');
  const [abierta, setAbierta] = useState<string | null>(inicial ?? null);
  const cuentas = useMemo(() => { const m = new Map<CategoriaEntidad, number>(); for (const e of entidades) m.set(e.categoria, (m.get(e.categoria) ?? 0) + 1); return m; }, [entidades]);
  // Con muchas (una película reconoce cientos: objetos de un plano, figurantes), primero las principales:
  // tres apariciones o más, y los temas y motivos. Buscar por nombre las encuentra todas.
  const [menores, setMenores] = useState(false);
  const recortar = entidades.length > 40 && !menores && !filtro.trim();
  const principal = (e: (typeof entidades)[number]) => e.apariciones.length >= 3 || !!motivos?.has(e.id);
  const filtradas = entidades.filter((e) => (!categoria || e.categoria === categoria) && (!filtro.trim() || sinTildes(e.nombre).includes(sinTildes(filtro.trim()))));
  const visibles = recortar ? filtradas.filter(principal) : filtradas;
  const ocultas = filtradas.length - visibles.length;

  if (!apariciones) return <div className={cx('flex flex-col gap-2', className)}>{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-12 rounded-xl" />)}</div>;
  if (!entidades.length) return <p className={cx('text-[0.875rem] text-apagado', className)}>La comprensión todavía no ha reconocido personas, lugares ni motivos en este documento.</p>;
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por clase">
        <Chip activo={!categoria} onClick={() => setCategoria(null)} recuento={entidades.length}>Todas</Chip>
        {CATEGORIAS.filter((c) => cuentas.get(c)).map((c) => (
          <Chip key={c} activo={categoria === c} onClick={() => setCategoria((x) => (x === c ? null : c))} recuento={cuentas.get(c)}>{NOMBRE_CATEGORIA[c]}</Chip>
        ))}
      </div>
      {entidades.length > 8 ? (
        <label className="flex h-9 items-center rounded-xl border border-cream-400 bg-cream-50 shadow-[var(--hundido)] focus-within:border-coffee-500">
          <Icono nombre="buscar" tam={15} className="ml-3 shrink-0 text-apagado" />
          <span className="sr-only">Buscar una entidad</span>
          <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por nombre" className="h-full min-w-0 flex-1 bg-transparent px-2 text-[0.875rem] text-coffee-800 outline-none placeholder:text-apagado" />
        </label>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {visibles.map((e) => (
          <FilaEntidad key={e.id} e={e} documento={documento} abierta={abierta === e.id} alAbrir={() => setAbierta((x) => (x === e.id ? null : e.id))} {...(alIr ? { alIr } : {})} compacto={!!compacto} />
        ))}
        {!visibles.length ? <li className="px-2 py-3 text-[0.875rem] text-apagado">Ninguna entidad con ese nombre.</li> : null}
      </ul>
      {ocultas > 0 ? (
        <button type="button" onClick={() => setMenores(true)} className="self-start rounded-lg px-2 py-1 text-[0.8125rem] font-medium text-coffee-600 hover:bg-cream-200 hover:text-coffee-800">
          Ver también {ocultas === 1 ? 'la que aparece' : `las ${ocultas} que aparecen`} una o dos veces
        </button>
      ) : null}
    </div>
  );
}

const FilaEntidad = memo(function FilaEntidad({ e, documento, abierta, alAbrir, alIr, compacto }: {
  e: EntidadEnDocumento; documento: string; abierta: boolean; alAbrir: () => void; alIr?: (a: AparicionVista) => void; compacto: boolean;
}) {
  const conRegion = e.apariciones.filter((a) => a.ancla.region).slice(0, compacto ? 2 : 4);
  return (
    <li className={cx('rounded-xl border transition-[background,box-shadow]', abierta ? 'border-cream-400 bg-cream-50 shadow-[var(--levantado)]' : 'border-transparent hover:bg-cream-200/70')}>
      <button type="button" onClick={alAbrir} aria-expanded={abierta} className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left">
        <span aria-hidden className={cx('shrink-0', FORMA[e.categoria])} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium text-coffee-800">{e.nombre}</span>
          <span className="block truncate text-[0.75rem] text-coffee-500">{resumenRoles(e)}</span>
        </span>
        <Icono nombre="abajo" tam={14} className={cx('shrink-0 text-coffee-400 transition-transform', !abierta && '-rotate-90')} />
      </button>
      {abierta ? (
        <div className="px-2.5 pb-3 anim-sube">
          <FichaEntidad documento={documento} entidad={e.id} />
          {conRegion.length ? (
            <ul className={cx('mb-3 grid gap-2', compacto ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')} aria-label="Dónde se ve">
              {conRegion.map((a) => (
                <li key={a.id}>
                  <IrAparicion a={a} {...(alIr ? { alIr } : {})} className="block rounded-lg">
                    <VistaAncla documento={a.documento} ancla={a.ancla} palabras={false} texto={false} altoMax={6} />
                    <span className="mt-1 block text-center font-mono text-[0.6875rem] text-coffee-600">{etiquetaAncla(a.ancla, a.anclaFin)}</span>
                  </IrAparicion>
                </li>
              ))}
            </ul>
          ) : null}
          <Rotulo>Apariciones</Rotulo>
          <ListaApariciones apariciones={e.apariciones} {...(alIr ? { alIr } : {})} />
          <EnOtrasObras entidad={e.id} documento={documento} nombre={e.nombre} />
        </div>
      ) : null}
    </li>
  );
});

function IrAparicion({ a, alIr, className, children }: { a: AparicionVista; alIr?: (a: AparicionVista) => void; className?: string; children: React.ReactNode }) {
  const etiqueta = `${a.nombre}, ${NOMBRE_ROL[a.rol]}, ${etiquetaAncla(a.ancla, a.anclaFin)}`;
  if (alIr) return <button type="button" onClick={() => alIr(a)} aria-label={etiqueta} className={cx('w-full text-left hover:bg-cream-200/70', className)}>{children}</button>;
  return <Link {...enlaceAncla(a.documento, a.ancla)} aria-label={etiqueta} className={cx('hover:bg-cream-200/70', className)}>{children}</Link>;
}

/** Las apariciones, una por línea: folio, rol y la forma en que aparece. */
export function ListaApariciones({ apariciones, alIr, max = 12 }: { apariciones: AparicionVista[]; alIr?: (a: AparicionVista) => void; max?: number }) {
  const [todas, setTodas] = useState(false);
  const lista = todas ? apariciones : apariciones.slice(0, max);
  return (
    <>
      <ol className="mt-1.5 flex flex-col">
        {lista.map((a) => (
          <li key={a.id}>
            <IrAparicion a={a} {...(alIr ? { alIr } : {})} className="flex items-baseline gap-2 rounded-lg px-1.5 py-1">
              <Folio className="shrink-0">{etiquetaAncla(a.ancla, a.anclaFin)}</Folio>
              <span className="shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-coffee-500">{NOMBRE_ROL[a.rol]}</span>
              <span className="min-w-0 truncate text-[0.8125rem] text-coffee-700">{a.forma}</span>
            </IrAparicion>
          </li>
        ))}
      </ol>
      {apariciones.length > max ? (
        <button type="button" onClick={() => setTodas((x) => !x)} className="mt-1 px-1.5 text-[0.8125rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">
          {todas ? 'Ver menos' : `Ver las ${apariciones.length}`}
        </button>
      ) : null}
    </>
  );
}

/** La ficha de una entidad (un personaje, con quién lo interpreta), si la comprensión la escribió. */
function FichaEntidad({ documento, entidad }: { documento: string; entidad: string }) {
  const { data } = useQuery(qc.fichasDe(documento, { entidad }));
  const f = data?.find((x) => x.objetivo === 'entidad');
  if (!f) return null;
  return (
    <div className="mb-3 rounded-lg bg-cream-100/80 px-3 py-2 shadow-[var(--hundido)]">
      <DatosFicha datos={f.datos} solo={['actor', 'papel', 'arco']} />
    </div>
  );
}

/** La misma entidad en las demás obras de la biblioteca: cuántas veces y dónde (con sus apariciones ancladas, si las hay). */
function EnOtrasObras({ entidad, documento, nombre }: { entidad: string; documento: string; nombre: string }) {
  const { data: ficha, isPending, isError } = useQuery({ ...q.entidad(entidad), retry: 0 });
  const otras = (ficha?.porDocumento ?? []).filter((d) => d.documento !== documento);
  const { data: fuera } = useQuery(aparicionesFuera(otras.map((d) => d.documento), entidad));
  if (isError || (!isPending && !otras.length)) return null;
  return (
    <section aria-label={`${nombre} en otras obras`} className="mt-3 border-t border-cream-200 pt-2.5">
      <div className="flex items-baseline gap-2">
        <Rotulo>En otras obras</Rotulo>
        <Link to="/explorar/entidades" search={{ e: entidad }} className="ml-auto text-[0.75rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">Ver en el grafo</Link>
      </div>
      {isPending ? <Esqueleto className="mt-2 h-8" /> : (
        <ul className="mt-1.5 flex flex-col gap-2">
          {otras.map((d) => {
            const aps = fuera?.get(d.documento) ?? [];
            return (
              <li key={d.documento} className="text-[0.8125rem]">
                <p className="flex items-baseline gap-2">
                  <Link to="/documentos/$id/comprension" params={{ id: d.documento }} search={{ ver: 'entidades', e: entidad }} className="min-w-0 truncate italic text-coffee-800 underline-offset-4 hover:underline">{d.titulo}</Link>
                  <span className="shrink-0 text-apagado">{aps.length ? `${aps.length} ${aps.length === 1 ? 'aparición' : 'apariciones'}` : `${d.total} ${d.total === 1 ? 'mención' : 'menciones'}`}</span>
                </p>
                {aps.length ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {aps.slice(0, 6).map((a) => (
                      <li key={a.id}><Link {...enlaceAncla(a.documento, a.ancla)} title={`${NOMBRE_ROL[a.rol]}: ${a.forma}`} className="inline-flex h-6 items-center rounded-md border border-cream-400 bg-cream-50 px-1.5 font-mono text-[0.6875rem] text-coffee-700 shadow-[var(--relieve)] hover:border-cream-500">{etiquetaAncla(a.ancla, a.anclaFin)}</Link></li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

