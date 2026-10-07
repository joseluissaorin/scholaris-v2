/**
 * «Todo el SPDF»: el inspector de un documento. Enseña, apartado por apartado,
 * todo lo que hay dentro del .spdf: la ficha con la procedencia de cada campo,
 * las unidades con su imagen, texto, notas, lector y folio, las secciones, los
 * fragmentos con su contexto, las figuras y los fotogramas con lo que se ve,
 * los hablantes, las entidades, los espacios vectoriales con un mapa, el
 * registro de la ingesta y el propio fichero. Las listas largas van
 * virtualizadas y se piden a trozos.
 */
import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Boton, Composicion, Consejo, cx, Esqueleto, Icono } from '@scholaris/ui';
import { q } from '../datos/consultas';
import { anioVisible, autores, esMedio, NOMBRE_TIPO } from '../lib/formato';
import { numero } from '../lib/numero';
import { qi } from '../componentes/inspector/consultas';
import { Cifras, Entidades, FichaProcedencia, Fichero, Hablantes, Lectura, Procedencia } from '../componentes/inspector/resumen';
import { FigurasInspector, Fragmentos, Secciones, Unidades } from '../componentes/inspector/listas';
import { Vectores } from '../componentes/inspector/vectores';
import { descargarSpdf, VerJson } from '../componentes/inspector/json';

type Apartado = 'resumen' | 'unidades' | 'secciones' | 'fragmentos' | 'figuras' | 'hablantes' | 'entidades' | 'vectores' | 'procedencia' | 'fichero';
const APARTADOS: Apartado[] = ['resumen', 'unidades', 'secciones', 'fragmentos', 'figuras', 'hablantes', 'entidades', 'vectores', 'procedencia', 'fichero'];

export const Route = createFileRoute('/documentos/$id/contenido')({
  validateSearch: (s: Record<string, unknown>): { ver?: Apartado } => ({ ver: APARTADOS.includes(s.ver as Apartado) ? (s.ver as Apartado) : undefined }),
  loader: async ({ context, params }) => {
    void context.consultas.prefetchQuery(qi.contenido(params.id));
    await context.consultas.ensureQueryData(q.documento(params.id));
  },
  pendingComponent: () => <div className="px-5 py-8 md:px-10"><Esqueleto className="h-6 w-72" /><Esqueleto className="mt-6 h-24 w-full" /><Esqueleto className="mt-6 h-96 w-full" /></div>,
  component: Inspector,
});

function Inspector() {
  const { id } = Route.useParams();
  const { ver = 'resumen' } = Route.useSearch();
  const { data: doc } = useSuspenseQuery(q.documento(id));
  const { data: c, isError } = useQuery(qi.contenido(id));
  const [json, setJson] = useState(false);
  // En el móvil el índice es una tira que se desliza: el apartado activo, a la vista (solo en horizontal).
  const indice = useRef<HTMLElement>(null);
  useEffect(() => {
    const n = indice.current, a = n?.querySelector<HTMLElement>('[data-activo]');
    if (n && a && n.scrollWidth > n.clientWidth) n.scrollLeft = a.offsetLeft - n.clientWidth / 2 + a.offsetWidth / 2;
  }, [ver]);
  const medio = esMedio(doc.tipo);

  const nombres: Record<Apartado, string> = {
    resumen: 'Resumen', unidades: medio ? 'Tramos' : doc.tipo === 'presentacion' ? 'Diapositivas' : 'Páginas', secciones: 'Secciones', fragmentos: 'Fragmentos',
    figuras: medio ? 'Fotogramas' : 'Figuras', hablantes: 'Hablantes', entidades: 'Entidades', vectores: 'Vectores', procedencia: 'Procedencia', fichero: 'Fichero',
  };
  const cuenta: Partial<Record<Apartado, number | undefined>> = {
    unidades: c?.cuentas.unidades ?? doc.unidades, secciones: c?.cuentas.secciones ?? doc.cuentas.secciones, fragmentos: c?.cuentas.fragmentos ?? doc.cuentas.fragmentos,
    figuras: c?.cuentas.figuras ?? doc.cuentas.figuras, hablantes: c?.hablantes.length, vectores: c?.cuentas.vectores, procedencia: c?.procedencia.length,
  };
  const visibles = APARTADOS.filter((a) => a !== 'hablantes' || medio);

  const acciones = (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Boton variante="linea" tam="p" icono="opciones" onClick={() => setJson(true)}>Ver JSON</Boton>
      <Boton variante="tinta" tam="p" icono="descargar" onClick={() => void descargarSpdf(doc)}>Descargar .spdf</Boton>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {/* Barra */}
      <div className="sticky top-14 z-30 border-b border-cream-300 bg-cream-50/90 shadow-[var(--shadow-soft)] backdrop-blur lg:top-0">
        <div className="flex h-[4.25rem] items-center gap-3 px-3 md:px-6">
          <Consejo texto="Volver al lector">
            <Link to="/lector/$id" params={{ id }} aria-label="Volver al lector" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="izquierda" tam={18} /></Link>
          </Consejo>
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-apagado">Todo el SPDF</p>
            <h1 className="truncate text-[0.9375rem] font-semibold leading-tight text-coffee-800">{doc.metadatos.titulo}</h1>
          </div>
          <div className="hidden sm:block">{acciones}</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-10">
        {/* Cabecera */}
        <header className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] text-coffee-600">{autores(doc.metadatos) || 'Sin autor'} · {anioVisible(doc.metadatos)} · {NOMBRE_TIPO[doc.tipo]}</p>
            <h2 className="mt-1 text-[1.5rem] font-bold leading-tight tracking-[-0.01em] text-coffee-800 sm:text-[1.75rem]">{doc.metadatos.titulo}</h2>
            <p className="mt-2 max-w-3xl text-[0.875rem] text-coffee-600">Todo lo que Scholaris guardó al leer este documento, tal como va en su .spdf: lo que se cita, lo que se busca y cómo se obtuvo.</p>
          </div>
          <Composicion estilo={medio ? 'kandinsky' : 'malevich'} semilla={doc.id.length} className="hidden h-[84px] w-[126px] shrink-0 md:block" />
        </header>
        <div className="mt-4 sm:hidden">{acciones}</div>
        <div className="mt-6"><Cifras doc={doc} c={c} /></div>

        <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
          {/* Índice de apartados */}
          <nav ref={indice} aria-label="Apartados del SPDF" className="sin-barra -mx-4 mb-5 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-24 lg:mx-0 lg:mb-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
            {visibles.map((a) => (
              <Link key={a} to="/documentos/$id/contenido" params={{ id }} search={{ ver: a === 'resumen' ? undefined : a }} resetScroll={false}
                data-activo={ver === a ? '' : undefined}
                className={cx('flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[0.875rem] transition-[background,box-shadow]', ver === a ? 'bg-cream-50 font-semibold text-coffee-800 shadow-[var(--relieve)] ring-1 ring-cream-400' : 'font-medium text-coffee-600 hover:bg-cream-200 hover:text-coffee-800')}>
                {ver === a ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-rojo" /> : null}
                <span className="flex-1">{nombres[a]}</span>
                {cuenta[a] != null ? <span className="text-[0.75rem] text-apagado tnum">{numero(cuenta[a]!)}</span> : null}
              </Link>
            ))}
          </nav>

          <div className="min-w-0">
            {isError ? <p className="rounded-xl border border-rojo/30 bg-rojo-suave/50 p-4 text-[0.875rem] text-coffee-800">No se pudo leer el contenido del documento. Vuelve a intentarlo en unos segundos.</p> : null}
            {ver === 'resumen' ? (
              <div className="flex flex-col gap-5">
                <FichaProcedencia doc={doc} />
                {c ? <Lectura c={c} doc={doc} /> : <Esqueleto className="h-64" />}
              </div>
            ) : ver === 'unidades' ? <Unidades doc={doc} />
              : ver === 'secciones' ? <Secciones doc={doc} />
              : ver === 'fragmentos' ? <Fragmentos doc={doc} />
              : ver === 'figuras' ? <FigurasInspector doc={doc} />
              : ver === 'entidades' ? <Entidades documento={id} />
              : !c ? <Esqueleto className="h-96" />
              : ver === 'hablantes' ? <Hablantes c={c} doc={doc} />
              : ver === 'vectores' ? <Vectores c={c} doc={doc} />
              : ver === 'procedencia' ? <Procedencia c={c} doc={doc} />
              : <Fichero c={c} doc={doc} acciones={acciones} />}
          </div>
        </div>
      </div>
      <VerJson abierto={json} alCambiar={setJson} doc={doc} {...(c ? { contenido: c } : {})} />
    </div>
  );
}
