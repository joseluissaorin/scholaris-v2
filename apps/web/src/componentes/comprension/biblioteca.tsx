/**
 * Comprender toda la biblioteca: cuántos documentos faltan, lo que costaría
 * (aproximado, por el tamaño de cada uno), el modelo rápido como opción y, al
 * confirmar, la cola (POST /comprension/biblioteca); debajo, los que están en
 * marcha con su paso y su avance, que se ponen al día solos.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResumenDocumento } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, Dialogo, Esqueleto } from '@scholaris/ui';
import { api } from '../../datos/api';
import { qc } from '../../datos/comprension';
import { q } from '../../datos/consultas';
import { avanceComprension } from '../../lib/comprension';
import { dolaresAproximados, estimarComprension, PRESUPUESTO_COMPRENSION } from '../../lib/estimacion';
import { numero } from '../../lib/numero';

/** Los documentos que se pueden comprender y aún no lo están (ni están en marcha). */
export function porComprender(docs: readonly ResumenDocumento[], hechos: ReadonlySet<string>): ResumenDocumento[] {
  return docs.filter((d) => d.estado === 'listo' && !hechos.has(d.id));
}

export function ComprensionBiblioteca() {
  const qcl = useQueryClient();
  const { data: docs } = useQuery(q.documentos());
  const { data: estados } = useQuery({ ...qc.estados(), refetchInterval: (x) => (x.state.data?.some((e) => e.estado === 'en_marcha') ? 6000 : false) });
  const [economico, setEconomico] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const ocupados = useMemo(() => new Set((estados ?? []).filter((e) => e.estado === 'hecho' || e.estado === 'en_marcha').map((e) => e.documento)), [estados]);
  const pendientes = useMemo(() => porComprender(docs?.elementos ?? [], ocupados), [docs, ocupados]);
  const total = useMemo(() => pendientes.reduce((s, d) => s + estimarComprension({ tipo: d.tipo, unidades: d.unidades, ...(d.duracion ? { duracion: d.duracion } : {}) }, { economico }), 0), [pendientes, economico]);
  const enMarcha = (estados ?? []).filter((e) => e.estado === 'en_marcha');
  const fallidos = (estados ?? []).filter((e) => e.estado === 'error');
  const titulo = (id: string) => docs?.elementos.find((d) => d.id === id)?.titulo ?? id;

  const lanzar = async () => {
    setEnviando(true);
    try {
      const r = await api().comprension.biblioteca({ documentos: pendientes.map((d) => d.id), ...(economico ? { economico: true } : {}) });
      avisar(`${numero(r.encolados)} ${r.encolados === 1 ? 'documento en cola' : 'documentos en cola'}; empiezan ${numero(r.lanzados)}.`, { tono: 'exito' });
      setConfirmar(false);
      await qcl.invalidateQueries({ queryKey: ['comprension'] });
    } catch (e) { avisar(e instanceof Error && e.message ? e.message : 'No se pudo lanzar la comprensión de la biblioteca.', { tono: 'error' }); }
    finally { setEnviando(false); }
  };

  if (!docs || !estados) return <Esqueleto className="h-24 rounded-xl" />;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.875rem] text-coffee-700">
        {numero(ocupados.size)} de {numero(docs.elementos.filter((d) => d.estado === 'listo').length)} documentos comprendidos o en marcha.
        {pendientes.length ? <> Faltan {numero(pendientes.length)}: costaría {dolaresAproximados(total)}.</> : ' No falta ninguno.'}
      </p>
      {pendientes.length ? (
        <div className="flex flex-wrap items-center gap-3">
          <Boton variante="tinta" tam="p" icono="chispa" onClick={() => setConfirmar(true)}>Comprender {pendientes.length === 1 ? 'el que falta' : `los ${numero(pendientes.length)} que faltan`}</Boton>
          <label className="flex items-center gap-2 text-[0.8125rem] text-coffee-700">
            <input type="checkbox" checked={economico} onChange={(e) => setEconomico(e.target.checked)} className="h-4 w-4 accent-[var(--s-coffee-800)]" />Solo con el modelo rápido
          </label>
        </div>
      ) : null}
      {enMarcha.length ? (
        <section aria-label="En marcha">
          <h3 className="text-[0.8125rem] font-semibold text-coffee-600">En marcha</h3>
          <ul className="mt-1.5 flex flex-col gap-2.5">
            {enMarcha.map((e) => {
              const av = avanceComprension(e);
              return (
                <li key={e.documento}>
                  <p className="flex items-baseline gap-2 text-[0.8125rem]">
                    <Link to="/documentos/$id/comprension" params={{ id: e.documento }} className="min-w-0 truncate italic text-coffee-800 underline-offset-4 hover:underline">{titulo(e.documento)}</Link>
                    <span className="ml-auto shrink-0 text-apagado">{av.texto}</span>
                  </p>
                  <BarraAvance valor={av.valor || undefined} tono="azul" etiqueta={`Avance de ${titulo(e.documento)}`} className="mt-1" />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {fallidos.length ? (
        <p role="alert" className="text-[0.8125rem] text-rojo">
          {fallidos.length === 1 ? 'Uno falló' : `${numero(fallidos.length)} fallaron`}: {fallidos.slice(0, 3).map((e) => titulo(e.documento)).join(', ')}{fallidos.length > 3 ? '…' : ''}. Desde la comprensión de cada uno se puede reintentar.
        </p>
      ) : null}
      <Dialogo abierto={confirmar} alCambiar={setConfirmar} titulo="¿Comprender la biblioteca?"
        pie={<><Boton variante="linea" onClick={() => setConfirmar(false)}>Cancelar</Boton><Boton variante="tinta" icono="chispa" cargando={enviando} onClick={() => void lanzar()}>Comprender {numero(pendientes.length)}</Boton></>}>
        <div className="flex flex-col gap-3 text-[0.9375rem] text-coffee-700">
          <p>Se comprenden {pendientes.length === 1 ? 'el documento que falta' : `los ${numero(pendientes.length)} documentos que faltan`}, unos pocos a la vez; los demás esperan en cola.</p>
          <p className="rounded-xl border border-cream-400 bg-cream-100/70 px-3.5 py-2.5 shadow-[var(--hundido)]">
            Costará <strong className="font-semibold text-coffee-800">{dolaresAproximados(total)}</strong>{economico ? ' con el modelo rápido' : ''}, calculado por el tamaño de cada uno. Ninguno pasa de {PRESUPUESTO_COMPRENSION} USD con el modelo bueno: lo que falte sigue con el rápido.
          </p>
          <ul className="max-h-40 overflow-y-auto text-[0.8125rem] text-coffee-600">
            {pendientes.slice(0, 50).map((d) => <li key={d.id} className="flex gap-3"><span className="min-w-0 flex-1 truncate">{d.titulo}</span><span className="dato shrink-0">{dolaresAproximados(estimarComprension({ tipo: d.tipo, unidades: d.unidades, ...(d.duracion ? { duracion: d.duracion } : {}) }, { economico }))}</span></li>)}
            {pendientes.length > 50 ? <li className="text-apagado">y {numero(pendientes.length - 50)} más</li> : null}
          </ul>
        </div>
      </Dialogo>
    </div>
  );
}

