/**
 * Las entidades reconocidas, resaltadas con discreción en el texto del lector
 * (un subrayado punteado). Al pulsar una, un globo dice qué es y en qué otros
 * documentos aparece, con enlace a cada pasaje. Las formas llegan de una sola
 * petición por documento; `Markdown` las aplica si hay un proveedor encima.
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import type { EntidadesLector } from '@scholaris/contrato';
import { Folio, Rotulo } from '@scholaris/ui';
import { q } from '../../datos/consultas';
import { anclaABusqueda } from '../../lib/anclas';
import { etiquetaCorta } from '../../lib/formato';
import { NOMBRE_TIPO_ENTIDAD, Pasaje } from '../entidades/comun';
import { ContextoEntidades, type MarcadorEntidades } from './contexto-entidades';


const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function crearMarcador(datos: EntidadesLector, documento: string): MarcadorEntidades | null {
  const formas = datos.formas.filter((f) => f.texto.length >= 2 && datos.entidades[f.entidad]);
  if (!formas.length) return null;
  const porForma = new Map<string, string>();
  for (const f of formas) if (!porForma.has(f.texto)) porForma.set(f.texto, f.entidad);
  // La forma más larga primero: «Charlie Parker» antes que «Parker».
  const lista = [...porForma.keys()].sort((a, b) => b.length - a.length);
  let re: RegExp;
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}])(${lista.map((f) => escapar(f).replace(/\s+/g, '\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  } catch {
    return null;
  }
  const normal = (s: string) => s.replace(/\s+/g, ' ');
  return {
    marcar(texto, clave) {
      re.lastIndex = 0;
      if (!re.test(texto)) return null;
      re.lastIndex = 0;
      const salida: ReactNode[] = [];
      let ultimo = 0, k = 0, m: RegExpExecArray | null;
      while ((m = re.exec(texto))) {
        const entidad = porForma.get(normal(m[0]));
        if (!entidad) continue;
        if (m.index > ultimo) salida.push(<Fragment key={`${clave}e${k++}`}>{texto.slice(ultimo, m.index)}</Fragment>);
        salida.push(<MarcaEntidad key={`${clave}e${k++}`} id={entidad} texto={m[0]} documento={documento} datos={datos.entidades[entidad]!} />);
        ultimo = m.index + m[0].length;
      }
      if (ultimo < texto.length) salida.push(<Fragment key={`${clave}e${k++}`}>{texto.slice(ultimo)}</Fragment>);
      return salida;
    },
  };
}

/** Envuelve el flujo del lector. Si el documento no tiene entidades (o la API no las sirve), no hace nada. */
export function ProveedorEntidades({ documento, children }: { documento: string; children: ReactNode }) {
  const { data } = useQuery(q.entidadesLector(documento));
  const marcador = useMemo(() => (data ? crearMarcador(data, documento) : null), [data, documento]);
  return <ContextoEntidades.Provider value={marcador}>{children}</ContextoEntidades.Provider>;
}

function MarcaEntidad({ id, texto, documento, datos }: { id: string; texto: string; documento: string; datos: EntidadesLector['entidades'][string] }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="entidad-marca cursor-pointer rounded-md text-inherit underline decoration-coffee-300 decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-coffee-700 focus-visible:decoration-rojo"
          aria-label={`${texto}: ${NOMBRE_TIPO_ENTIDAD[datos.tipo].toLowerCase()}${datos.documentos > 1 ? `, aparece en ${datos.documentos} documentos` : ''}`}>
          {texto}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} collisionPadding={12}
          className="anim-menu z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-cream-400 bg-cream-50 p-4 text-coffee-800 shadow-[var(--levantado-alto)] outline-none">
          <Rotulo>{NOMBRE_TIPO_ENTIDAD[datos.tipo]}</Rotulo>
          <p className="mt-0.5 text-[1.0625rem] font-bold leading-tight">{datos.nombre}</p>
          {datos.descripcion ? <p className="mt-0.5 text-[0.8125rem] text-coffee-600">{datos.descripcion}</p> : null}
          <OtrosDocumentos id={id} documento={documento} hay={datos.documentos > 1} />
          <Link to="/explorar/entidades" search={{ e: id }} className="mt-3 inline-block text-[0.8125rem] font-medium text-coffee-700 underline decoration-rojo decoration-2 underline-offset-4 hover:text-coffee-900">Ver la ficha y su grafo</Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** «Aparece también en…»: se pide al abrir el globo (Radix no monta el contenido hasta entonces). */
function OtrosDocumentos({ id, documento, hay }: { id: string; documento: string; hay: boolean }) {
  const { data, isPending } = useQuery({ ...q.entidad(id), enabled: hay });
  if (!hay) return <p className="mt-3 text-[0.8125rem] text-coffee-500">Solo aparece en este documento.</p>;
  if (isPending) return <p className="mt-3 text-[0.8125rem] text-coffee-500">Buscando en tu biblioteca…</p>;
  const otros = data?.porDocumento.filter((d) => d.documento !== documento) ?? [];
  if (!otros.length) return null;
  return (
    <div className="mt-3">
      <Rotulo>Aparece también en</Rotulo>
      <ul className="mt-1.5 flex flex-col gap-2">
        {otros.slice(0, 4).map((d) => {
          const m = d.menciones[0];
          return (
            <li key={d.documento}>
              <Link to="/lector/$id" params={{ id: d.documento }} search={m ? anclaABusqueda(m.ancla, { f: m.fragmento, q: m.texto }) : {}} className="group block text-[0.8125rem] leading-snug">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate font-semibold text-coffee-800 group-hover:underline">{d.titulo}</span>
                  {m ? <Folio className="shrink-0">{etiquetaCorta(m.ancla, m.etiqueta)}</Folio> : null}
                </span>
                {m ? <Pasaje texto={m.contexto} className="mt-0.5 line-clamp-2 block text-coffee-600" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {otros.length > 4 ? <p className="mt-1.5 text-[0.75rem] text-coffee-500">y {otros.length - 4} más.</p> : null}
    </div>
  );
}
