import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { EsqueletoTexto, FormaBauhaus, Icono, Rotulo } from '@scholaris/ui';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';
import { numero } from '../lib/numero';
import { FalloConsulta } from '../componentes/comunes/errores';

/** Sin nada que enseñar en una columna: una línea que dice por qué y cuándo habrá algo. */
function NadaAun({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-cream-500 bg-cream-100/60 px-4 py-3 text-[0.875rem] text-coffee-600 shadow-[var(--hundido)]">{children}</p>;
}

export const Route = createFileRoute('/explorar/perspectivas')({
  loader: ({ context }) => Promise.all([context.consultas.ensureQueryData(q.arqueologia()), context.consultas.prefetchQuery(q.huecos()), context.consultas.prefetchQuery(q.recomendaciones())]),
  component: Perspectivas,
});

function Columna({ forma, titulo, subtitulo, children }: { forma: 'circulo' | 'triangulo' | 'cuadrado'; titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="relative">
      <FormaBauhaus forma={forma} className="h-10 w-10" />
      <h2 className="mt-4 text-[1.5rem] leading-tight">{titulo}</h2>
      <p className="mt-1 text-[0.9375rem] text-tinta-2">{subtitulo}</p>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Perspectivas() {
  const arq = useQuery(q.arqueologia());
  const huecos = useQuery(q.huecos());
  const rec = useQuery(q.recomendaciones());
  return (
    <Lienzo>
      <div className="grid gap-12 md:grid-cols-3 md:gap-10">
        <Columna forma="circulo" titulo="Lo que leíste y olvidaste" subtitulo="Documentos que responden a lo que buscas ahora y que no abres desde hace tiempo.">
          {arq.isPending ? <EsqueletoTexto lineas={4} /> : arq.isError ? <FalloConsulta compacto error={arq.error} reintentar={() => void arq.refetch()} /> : !arq.data?.olvidados.length ? <NadaAun>Aún nada olvidado. Aparecerá aquí lo que encaje con tus búsquedas y lleves tiempo sin abrir.</NadaAun> : arq.data.olvidados.map((o) => (
            <Link key={o.documento} to="/lector/$id" params={{ id: o.documento }} className="group block border-l-[3px] border-azul pl-4">
              <p className=" group-hover:underline">{o.titulo}</p>
              <p className="mt-1 text-[0.875rem] text-tinta-2">{o.motivo}</p>
              {o.ultimaApertura ? <Rotulo className="mt-1 block">Abierto por última vez {haceCuanto(o.ultimaApertura)}</Rotulo> : null}
            </Link>
          ))}
        </Columna>
        <Columna forma="triangulo" titulo="Lo que buscas y no tienes" subtitulo="Temas que consultas a menudo y para los que tu biblioteca apenas responde.">
          {huecos.isPending ? <EsqueletoTexto lineas={4} /> : huecos.isError ? <FalloConsulta compacto error={huecos.error} reintentar={() => void huecos.refetch()} /> : !huecos.data?.length ? <NadaAun>Sin huecos a la vista: tu biblioteca responde a lo que buscas. Cuantas más búsquedas hagas, más fino será esto.</NadaAun> : huecos.data.map((h) => (
            <div key={h.tema} className="border-l-[3px] border-amarillo pl-4">
              <p className="">{h.tema}</p>
              {h.sugerencia ? <p className="mt-1 text-[0.875rem] text-tinta-2">{h.sugerencia}</p> : null}
              <Rotulo className="mt-1 block">{h.consultas} búsquedas · {numero(h.resultadosMedios)} resultados de media</Rotulo>
            </div>
          ))}
        </Columna>
        <Columna forma="cuadrado" titulo="Lo que te falta leer" subtitulo="Obras que citan tus documentos o que encajan con tus temas.">
          {rec.isPending ? <EsqueletoTexto lineas={4} /> : rec.isError ? <FalloConsulta compacto error={rec.error} reintentar={() => void rec.refetch()} /> : !rec.data?.length ? <NadaAun>Nada que recomendar todavía. Las obras que citan tus documentos irán apareciendo aquí.</NadaAun> : rec.data.map((r) => (
            <div key={r.titulo} className="border-l-[3px] border-rojo pl-4">
              <p className="flex items-start gap-2"><Icono nombre="marcador" tam={14} className="mt-1 shrink-0 not- text-rojo" />{r.titulo}</p>
              <p className="mt-1 text-[0.875rem] text-tinta-2">{r.motivo}</p>
            </div>
          ))}
        </Columna>
      </div>
    </Lienzo>
  );
}
