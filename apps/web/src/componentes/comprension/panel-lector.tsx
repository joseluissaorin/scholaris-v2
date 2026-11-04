/**
 * La comprensión dentro del lector, en el panel lateral: el mapa (estado,
 * estructura con la parte por donde se va, la ficha de la parte elegida y las
 * relaciones con otras obras) y las entidades. Todo lo que se pulsa lleva al
 * sitio sin salir del lector: la página con sus caracteres o su región
 * marcados, o el segundo con la región sobre el fotograma.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { AnclaMaterial, Segmento } from '@scholaris/nucleo';
import type { DetalleDocumento } from '@scholaris/contrato';
import { Boton, Esqueleto, Icono, Rotulo } from '@scholaris/ui';
import { fichaGlobal, qc } from '../../datos/comprension';
import { esMedio } from '../../lib/formato';
import { segmentoEn, verboRelacion } from '../../lib/comprension';
import { EstadoComprension } from './estado';
import { ArbolEstructura, FichaSegmento } from './mapa';
import { PanelEntidades } from './entidades';

export function PanelComprension({ doc, actual, tiempo, alIr }: { doc: DetalleDocumento; actual: number; tiempo: number; alIr: (a: AnclaMaterial) => void }) {
  const { data: mapa } = useQuery(qc.mapa(doc.id));
  const { data: relaciones } = useQuery(qc.relaciones(doc.id));
  const [elegido, setElegido] = useState<Segmento | null>(null);
  const medio = esMedio(doc.tipo);
  const aqui = useMemo(() => (mapa ? segmentoEn(mapa.segmentos, medio ? { t: tiempo } : { u: actual }) : undefined), [mapa, medio, tiempo, actual]);
  if (!mapa) return <div className="flex flex-col gap-3"><Esqueleto className="h-20 rounded-2xl" />{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-8" />)}</div>;
  return (
    <div className="flex flex-col gap-4">
      <EstadoComprension documento={doc.id} mapa={mapa} listo={doc.estado === 'listo'} compacto />
      {mapa.segmentos.length ? (
        <section aria-label="Estructura">
          <div className="flex items-baseline gap-2">
            <Rotulo>Estructura</Rotulo>
            <Link to="/documentos/$id/comprension" params={{ id: doc.id }} className="ml-auto text-[0.75rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">Ver la comprensión entera</Link>
          </div>
          <ArbolEstructura documento={doc.id} segmentos={mapa.segmentos} actual={aqui?.id ?? null} elegido={elegido?.id ?? null} alElegir={setElegido} alIr={(s) => alIr(s.ancla)} className="mt-1.5" />
          {elegido ? <FichaSegmento key={elegido.id} documento={doc.id} segmento={elegido} className="mt-3" alIr={alIr} /> : null}
        </section>
      ) : null}
      {doc.tipo === 'video' && mapa.totales.planos ? (
        <Boton variante="linea" tam="p" icono="video" comoHijo className="self-start">
          <Link to="/lector/$id" params={{ id: doc.id }} search={(s) => ({ ...s, v: 'pelicula' as const })} replace resetScroll={false}>La película plano a plano</Link>
        </Boton>
      ) : null}
      {relaciones?.length ? (
        <section aria-label="Relaciones con otras obras">
          <Rotulo>Relaciones</Rotulo>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {relaciones.map((r) => (
              <li key={r.id}>
                <Link to="/relaciones/$id" params={{ id: r.id }} search={{ desde: doc.id }} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-[0.875rem] hover:bg-cream-200">
                  <Icono nombre="pila" tam={15} className="mt-0.5 shrink-0 text-coffee-400" />
                  <span className="min-w-0">
                    <span className="text-coffee-600">Esta obra {verboRelacion(r.tipo, r.sentido)} </span>
                    <em className="text-coffee-800 group-hover:underline group-hover:underline-offset-4">{r.otro.titulo}</em>
                    {r.alineaciones ? <span className="block text-[0.75rem] text-apagado">{r.alineaciones} correspondencias, lado a lado</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function PanelEntidadesLector({ doc, alIr }: { doc: DetalleDocumento; alIr: (a: AnclaMaterial) => void }) {
  const { data: mapa } = useQuery(qc.mapa(doc.id));
  const hecho = !!mapa?.totales.apariciones;
  const { data: apariciones } = useQuery({ ...qc.apariciones(doc.id), enabled: hecho });
  const global = fichaGlobal(mapa);
  const motivos = useMemo(() => new Set([...(Array.isArray(global?.datos.temas) ? global.datos.temas : []), ...(Array.isArray(global?.datos.motivos) ? global.datos.motivos : [])].map((t: { entidad?: string }) => t?.entidad).filter((x): x is string => !!x)), [global]);
  if (!mapa) return <div className="flex flex-col gap-2">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="h-12 rounded-xl" />)}</div>;
  if (!hecho) return <EstadoComprension documento={doc.id} mapa={mapa} listo={doc.estado === 'listo'} compacto />;
  return <PanelEntidades documento={doc.id} apariciones={apariciones} motivos={motivos} alIr={(a) => alIr(a.ancla)} compacto />;
}
