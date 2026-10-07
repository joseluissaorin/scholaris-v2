import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { avisar, Boton, Esqueleto, Rotulo } from '@scholaris/ui';
import type { TipoEntrada } from '@scholaris/nucleo';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { bytes, haceCuanto, NOMBRE_TIPO } from '../lib/formato';
import { numero } from '../lib/numero';
import { nombreIdioma } from '../lib/nombres';

export const Route = createFileRoute('/explorar/corpus')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.corpus()),
  component: Corpus,
});


/** Barras horizontales: lo más legible para pocas categorías. Una sola tinta; el dato manda. */
function Barras({ datos, etiqueta }: { datos: Array<[string, number]>; etiqueta: string }) {
  const max = Math.max(1, ...datos.map(([, n]) => n));
  return (
    <figure className="rounded-2xl border border-cream-400 bg-cream-50 p-5 shadow-[var(--levantado)]">
      <figcaption><Rotulo className="text-coffee-700">{etiqueta}</Rotulo></figcaption>
      <ul className="mt-3 flex flex-col gap-2">
        {datos.map(([k, n]) => (
          <li key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-[0.8125rem]">
            <span className="truncate text-coffee-700">{k}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-cream-200 shadow-[var(--hundido)]"><span className="block h-full rounded-full bg-coffee-700" style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="tnum text-right font-mono text-[0.8125rem]">{n}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Corpus() {
  const qc = useQueryClient();
  const { data, isPending, isFetching } = useQuery(q.corpus());
  async function refrescar() {
    try { qc.setQueryData(['corpus'], await api().corpus.refrescar()); avisar('Cifras al día.'); } catch { avisar('No se pudo refrescar.', { tono: 'error' }); }
  }
  if (isPending || !data) return <Lienzo><div className="grid grid-cols-2 gap-6 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Esqueleto key={i} className="h-28" />)}</div></Lienzo>;
  const cifras: Array<[string, string]> = [
    ['documentos', numero(data.documentos)],
    ['páginas y unidades', numero(data.unidades)],
    ['pasajes citables', numero(data.fragmentos)],
    ['horas de audio y vídeo', numero(data.segundosDeMedio / 3600, { maximumFractionDigits: 1 })],
  ];
  return (
    <Lienzo>
      <div className="flex items-center justify-end gap-3">
        <Rotulo>{data.refrescado ? `Contado ${haceCuanto(data.refrescado)}` : ''} · {bytes(data.bytes)} en originales</Rotulo>
        <Boton variante="fantasma" tam="p" icono="rayo" cargando={isFetching} onClick={() => void refrescar()}>Recontar</Boton>
      </div>
      <dl className="mt-4 grid grid-cols-2 border-y border-tinta md:grid-cols-4">
        {cifras.map(([k, v], i) => (
          <div key={k} className={`py-6 ${i ? 'md:border-l md:border-filete md:pl-6' : ''} ${i % 2 ? 'max-md:border-l max-md:border-filete max-md:pl-5' : ''} ${i > 1 ? 'max-md:border-t max-md:border-filete' : ''}`}>
            <dd className="text-[1.5rem] font-bold tracking-[-0.01em] tnum">{v}</dd>
            <dt className="rotulo mt-2 text-apagado">{k}</dt>
          </div>
        ))}
      </dl>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <Barras etiqueta="Por tipo" datos={Object.entries(data.porTipo).sort((a, b) => b[1] - a[1]).map(([k, n]) => [NOMBRE_TIPO[k as TipoEntrada] ?? k, n])} />
        {/* Las décadas llegan como «1950s»: se leen por su número («1950-59»), y en orden. */}
        <Barras etiqueta="Por década de la obra" datos={Object.entries(data.porDecada).map(([k, n]) => [parseInt(k, 10), n] as const).filter(([d]) => Number.isFinite(d)).sort((a, b) => a[0] - b[0]).map(([d, n]) => [`${d}-${String(d + 9).slice(-2)}`, n])} />
        <Barras etiqueta="Por idioma" datos={Object.entries(data.porIdioma).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k === 'desconocido' ? 'Sin determinar' : nombreIdioma(k), n])} />
      </div>
    </Lienzo>
  );
}
