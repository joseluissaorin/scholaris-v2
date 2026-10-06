import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { EsqueletoTexto, FormaBauhaus, Icono, Rotulo } from '@scholaris/ui';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { haceCuanto } from '../lib/formato';
import { numero } from '../lib/numero';

export const Route = createFileRoute('/explorar/perspectivas')({
  loader: ({ context }) => Promise.all([context.consultas.ensureQueryData(q.arqueologia()), context.consultas.prefetchQuery(q.huecos()), context.consultas.prefetchQuery(q.recomendaciones())]),
  component: Perspectivas,
});

function Columna({ forma, titulo, subtitulo, children }: { forma: 'circulo' | 'triangulo' | 'cuadrado'; titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="relative">
      <FormaBauhaus forma={forma} className="h-10 w-10" />
      <h2 className="mt-4 text-[1.5rem] italic leading-tight">{titulo}</h2>
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
          {arq.isPending ? <EsqueletoTexto lineas={4} /> : arq.data?.olvidados.map((o) => (
            <Link key={o.documento} to="/lector/$id" params={{ id: o.documento }} className="group block border-l-[3px] border-azul pl-4">
              <p className="italic group-hover:underline">{o.titulo}</p>
              <p className="mt-1 text-[0.875rem] text-tinta-2">{o.motivo}</p>
              {o.ultimaApertura ? <Rotulo className="mt-1 block">Abierto por última vez {haceCuanto(o.ultimaApertura)}</Rotulo> : null}
            </Link>
          ))}
        </Columna>
        <Columna forma="triangulo" titulo="Lo que buscas y no tienes" subtitulo="Temas que consultas a menudo y para los que tu biblioteca apenas responde.">
          {huecos.isPending ? <EsqueletoTexto lineas={4} /> : huecos.data?.map((h) => (
            <div key={h.tema} className="border-l-[3px] border-amarillo pl-4">
              <p className="italic">{h.tema}</p>
              {h.sugerencia ? <p className="mt-1 text-[0.875rem] text-tinta-2">{h.sugerencia}</p> : null}
              <Rotulo className="mt-1 block">{h.consultas} búsquedas · {numero(h.resultadosMedios)} resultados de media</Rotulo>
            </div>
          ))}
        </Columna>
        <Columna forma="cuadrado" titulo="Lo que te falta leer" subtitulo="Obras que citan tus documentos o que encajan con tus temas.">
          {rec.isPending ? <EsqueletoTexto lineas={4} /> : rec.data?.map((r) => (
            <div key={r.titulo} className="border-l-[3px] border-rojo pl-4">
              <p className="flex items-start gap-2 italic"><Icono nombre="marcador" tam={14} className="mt-1 shrink-0 not-italic text-rojo" />{r.titulo}</p>
              <p className="mt-1 text-[0.875rem] text-tinta-2">{r.motivo}</p>
            </div>
          ))}
        </Columna>
      </div>
    </Lienzo>
  );
}
