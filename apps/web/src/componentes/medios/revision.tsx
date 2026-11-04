/**
 * La transcripción de un audio o un vídeo, revisada: cuánto de lo que suena está
 * transcrito (antes y después de la revisión), cuántos huecos quedan y si la
 * revisión se aplicó. «Revisar la transcripción» pregunta antes lo que costaría
 * (la API lo simula) y solo lanza el trabajo al confirmar; mientras trabaja, la
 * tarjeta lo dice y se pone al día sola.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CoberturaTranscripcionVista, DetalleDocumento, EstimacionMedio, ParteTrabajoMedio } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, cx, Dialogo, Esqueleto, Icono } from '@scholaris/ui';
import { lanzarRevision, qm, revisionEnMarcha, simularRevision } from '../../datos/medios';
import { costeLegible } from '../../lib/investigacion';
import { haceCuanto, tiempoACadena } from '../../lib/formato';
import { numero } from '../../lib/numero';

export const NOMBRE_PARTE: Record<ParteTrabajoMedio, string> = {
  proxy: 'preparar una copia ligera del medio',
  percepcion: 'mirar y escuchar la obra entera (escenas, planos y reparto)',
  huecos: 'rellenar lo que falta en la transcripción',
  hablantes: 'revisar quién dice cada frase',
  reescritura: 'reescribir la transcripción con lo corregido',
};

/** «92 %»: lo que suena que tiene palabras con su instante. */
export function porcentajeCubierto(c: Pick<CoberturaTranscripcionVista, 'activo' | 'cubierto'> | undefined): number | null {
  if (!c || !(c.activo > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((c.cubierto / c.activo) * 100)));
}

const mensaje = (e: unknown, defecto: string) => (e instanceof Error && e.message ? e.message : defecto);

export function RevisionTranscripcion({ doc, compacta, className }: { doc: DetalleDocumento; compacta?: boolean; className?: string }) {
  const qcl = useQueryClient();
  const { data: r, isPending } = useQuery(qm.revision(doc.id));
  const [dialogo, setDialogo] = useState(false);
  const [opciones, setOpciones] = useState({ hablantes: true, percepcion: false });
  const [simulada, setSimulada] = useState<EstimacionMedio | null | undefined>(undefined);
  const [ocupado, setOcupado] = useState<'simular' | 'lanzar' | null>(null);
  const enMarcha = revisionEnMarcha(r);
  const listo = doc.estado === 'listo';

  // Con una revisión ya aplicada, volver a revisar es rehacerla; con una sin aplicar, basta con aplicarla.
  const pedido = (o: typeof opciones) => ({ ...o, ...(r?.aplicada ? { rehacer: true } : {}) });
  const simular = async (o = opciones) => {
    setOcupado('simular');
    try { setSimulada((await simularRevision(doc.id, pedido(o))).estimacion); setDialogo(true); }
    catch (e) { avisar(mensaje(e, 'No se pudo calcular lo que costaría.'), { tono: 'error' }); }
    finally { setOcupado(null); }
  };
  const cambiar = (k: 'hablantes' | 'percepcion', v: boolean) => { const o = { ...opciones, [k]: v }; setOpciones(o); void simular(o); };
  const lanzar = async () => {
    setOcupado('lanzar');
    try {
      await lanzarRevision(qcl, doc.id, pedido(opciones));
      avisar('Se está revisando la transcripción. El documento se puede seguir leyendo mientras tanto.', { tono: 'exito' });
      setDialogo(false);
    } catch (e) { avisar(mensaje(e, 'No se pudo lanzar la revisión.'), { tono: 'error' }); }
    finally { setOcupado(null); }
  };

  const antes = r?.cobertura?.antes, despues = r?.cobertura?.despues;
  const pa = porcentajeCubierto(antes), pd = porcentajeCubierto(despues);
  const actual = despues ?? antes;
  const sinAplicar = !!r?.cobertura && !r.aplicada;

  return (
    <section aria-label="La transcripción" className={cx('rounded-2xl border border-cream-400 bg-cream-50 p-3.5 shadow-[var(--levantado)]', className)}>
      <div className="flex items-center gap-2">
        <h2 className="text-[0.875rem] font-semibold text-coffee-800">La transcripción</h2>
        {r?.aplicada ? <span className="text-[0.75rem] text-apagado">revisada {haceCuanto(r.aplicada)}</span> : null}
      </div>
      {isPending ? <Esqueleto className="mt-2 h-10" /> : enMarcha ? (
        <div className="mt-2">
          <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-coffee-700"><span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-rojo anim-pulso" />{r?.tarea?.estado === 'en_cola' ? 'En cola para revisarse.' : 'Revisando: escuchando los tramos con huecos y rellenándolos.'}</p>
          <BarraAvance tono="azul" etiqueta="Revisando la transcripción" className="mt-2" />
        </div>
      ) : !r?.cobertura ? (
        <p className="mt-1.5 text-[0.8125rem] text-coffee-600">
          {r?.tarea?.estado === 'error' ? <span className="text-rojo">{r.tarea.error ?? 'La última revisión falló.'} </span> : null}
          Sin revisar: no se sabe todavía qué partes de lo que suena faltan en la transcripción.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap text-[1.25rem] font-semibold tnum text-coffee-800">{pd ?? pa ?? '?'} %</span>
            <span className="text-[0.8125rem] text-coffee-600">de lo que suena está transcrito{pd != null && pa != null && pd !== pa ? <span className="text-apagado"> (antes, {pa} %)</span> : null}</span>
          </div>
          <BarraAvance valor={(pd ?? pa ?? 0) / 100} tono="azul" etiqueta="Parte transcrita de lo que suena" />
          {actual ? (
            <p className="text-[0.8125rem] text-coffee-600">
              {actual.huecos ? <>{numero(actual.huecos)} {actual.huecos === 1 ? 'hueco' : 'huecos'}{actual.segundosSinTexto ? `, ${tiempoACadena(actual.segundosSinTexto)} sin texto` : ''}. Van marcados en rojo, a trazos, bajo la línea del tiempo.</> : 'Sin huecos.'}
              {actual.palabrasRotas ? ` ${numero(actual.palabrasRotas)} ${actual.palabrasRotas === 1 ? 'palabra' : 'palabras'} con el instante roto.` : ''}
            </p>
          ) : null}
          {r.correcciones && !compacta ? (
            <p className="text-[0.75rem] text-apagado">
              La revisión {r.aplicada ? 'rellenó' : 'propone rellenar'} {numero(r.correcciones.huecos + r.correcciones.tiemposRotos)} {r.correcciones.huecos + r.correcciones.tiemposRotos === 1 ? 'hueco' : 'huecos'}{r.correcciones.hablantes ? `, corrige ${numero(r.correcciones.hablantes)} ${r.correcciones.hablantes === 1 ? 'hablante' : 'hablantes'}` : ''}{r.correcciones.desfases ? ` y ${numero(r.correcciones.desfases)} ${r.correcciones.desfases === 1 ? 'desfase' : 'desfases'}` : ''}{r.usd ? `; costó ${costeLegible(r.usd)}` : ''}.
            </p>
          ) : null}
          {sinAplicar ? <p className="text-[0.8125rem] font-medium text-ocre">La revisión está hecha pero sin aplicar a la transcripción.</p> : null}
        </div>
      )}
      {r?.tarea?.estado === 'error' && r.cobertura ? <p role="alert" className="mt-2 text-[0.8125rem] text-rojo">{r.tarea.error ?? 'La última revisión falló.'}</p> : null}
      {!compacta && (r?.avisos?.length || r?.avisosDocumento.length) ? (
        <ul className="mt-2 flex flex-col gap-1" aria-label="Avisos de la transcripción">
          {[...(r.avisosDocumento.map((a) => a.mensaje)), ...(r.avisos ?? [])].slice(0, 3).map((a, i) => <li key={i} className="flex items-start gap-2 text-[0.75rem] text-coffee-600"><Icono nombre="aviso" tam={13} className="mt-0.5 shrink-0 text-ocre" />{a}</li>)}
        </ul>
      ) : null}
      {!enMarcha ? (
        <Boton variante={sinAplicar ? 'tinta' : 'linea'} tam="p" icono="rayo" className="mt-3" disabled={!listo} cargando={ocupado === 'simular'} onClick={() => void simular()}
          title={listo ? undefined : 'Se podrá revisar cuando termine la lectura del documento'}>
          {sinAplicar ? 'Aplicar la revisión' : r?.cobertura ? 'Volver a revisar' : 'Revisar la transcripción'}
        </Boton>
      ) : null}

      <Dialogo abierto={dialogo} alCambiar={setDialogo} titulo={sinAplicar ? '¿Aplicar la revisión?' : '¿Revisar la transcripción?'}
        pie={<><Boton variante="linea" onClick={() => setDialogo(false)}>Cancelar</Boton><Boton variante="tinta" icono="rayo" cargando={ocupado === 'lanzar'} disabled={ocupado === 'simular' || !simulada} onClick={() => void lanzar()}>{simulada && simulada.usd > 0 ? `Revisar por ${costeLegible(simulada.usd)}` : 'Revisar'}</Boton></>}>
        <div className="flex flex-col gap-3 text-[0.9375rem] text-coffee-700">
          {ocupado === 'simular' && simulada === undefined ? <Esqueleto className="h-16" /> : !simulada ? (
            <p>No hay nada que revisar en este medio: la transcripción ya está completa y aplicada.</p>
          ) : (
            <>
              <p>Se escucha {doc.tipo === 'video' ? 'el vídeo' : 'el audio'} ({tiempoACadena(simulada.duracion)}) y se hará esto:</p>
              <ul className="flex flex-col gap-1 pl-1">
                {simulada.hara.map((h) => <li key={h} className="flex items-start gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 bg-rojo" />{NOMBRE_PARTE[h]}</li>)}
              </ul>
              <p className="rounded-xl border border-cream-400 bg-cream-100/70 px-3.5 py-2.5 shadow-[var(--hundido)]">
                {simulada.usd > 0 ? <>Costará unos <strong className="font-semibold text-coffee-800">{costeLegible(simulada.usd)}</strong>, según la duración.</> : 'No gasta modelo: solo reescribe la transcripción con lo que ya está revisado.'}
              </p>
            </>
          )}
          {!sinAplicar ? (
            <div className="flex flex-col gap-2 text-[0.875rem] text-coffee-800">
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={opciones.hablantes} disabled={ocupado === 'simular'} onChange={(e) => cambiar('hablantes', e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--s-coffee-800)]" />
                <span>Revisar también quién dice cada frase (con la percepción del medio; en los planes de pago).</span>
              </label>
              {doc.tipo === 'video' ? (
                <label className="flex items-start gap-2.5">
                  <input type="checkbox" checked={opciones.percepcion} disabled={ocupado === 'simular'} onChange={(e) => cambiar('percepcion', e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--s-coffee-800)]" />
                  <span>Percibir antes el vídeo entero si aún no se ha hecho: escenas, planos y reparto, que también usa la comprensión.</span>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      </Dialogo>
    </section>
  );
}
