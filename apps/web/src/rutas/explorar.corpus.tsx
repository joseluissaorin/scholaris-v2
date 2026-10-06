import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { avisar, Boton, Esqueleto, Rotulo } from '@scholaris/ui';
import type { TipoEntrada } from '@scholaris/nucleo';
import { api } from '../datos/api';
import { q } from '../datos/consultas';
import { Lienzo } from '../componentes/comunes/cabecera';
import { bytes, haceCuanto, NOMBRE_TIPO } from '../lib/formato';
import { numero } from '../lib/numero';

export const Route = createFileRoute('/explorar/corpus')({
  loader: ({ context }) => context.consultas.ensureQueryData(q.corpus()),
  component: Corpus,
});

const IDIOMA: Record<string, string> = { es: 'Español', en: 'Inglés', fr: 'Francés', la: 'Latín', it: 'Italiano', de: 'Alemán', pt: 'Portugués', ca: 'Catalán' };

/** Barras horizontales: lo más legible para pocas categorías. Una sola tinta; el dato manda. */
function Barras({ datos, etiqueta }: { datos: Array<[string, number]>; etiqueta: string }) {
  const max = Math.max(1, ...datos.map(([, n]) => n));
  return (
    <figure>
      <figcaption><Rotulo>{etiqueta}</Rotulo></figcaption>
      <ul className="mt-3 flex flex-col gap-2">
        {datos.map(([k, n]) => (
          <li key={k} className="grid grid-cols-[8rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-[0.875rem]">
            <span className="truncate">{k}</span>
            <span className="h-3 bg-hondo"><span className="block h-full bg-tinta" style={{ width: `${(n / max) * 100}%` }} /></span>
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
            <dd className="titular text-[clamp(2.75rem,6vw,4.5rem)] tnum">{v}</dd>
            <dt className="rotulo mt-2 text-apagado">{k}</dt>
          </div>
        ))}
      </dl>
      <div className="mt-10 grid gap-12 md:grid-cols-3">
        <Barras etiqueta="Por tipo" datos={Object.entries(data.porTipo).sort((a, b) => b[1] - a[1]).map(([k, n]) => [NOMBRE_TIPO[k as TipoEntrada] ?? k, n])} />
        <Barras etiqueta="Por década de la obra" datos={Object.entries(data.porDecada).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, n]) => [`${k}-${String(Number(k) + 9).slice(2)}`, n])} />
        <Barras etiqueta="Por idioma" datos={Object.entries(data.porIdioma).sort((a, b) => b[1] - a[1]).map(([k, n]) => [IDIOMA[k] ?? k, n])} />
      </div>
    </Lienzo>
  );
}
