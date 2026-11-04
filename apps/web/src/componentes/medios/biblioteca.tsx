/**
 * Percibir los audios y los vídeos de la biblioteca (o solo revisar sus
 * transcripciones): primero la estimación, documento a documento y en total,
 * con lo que se haría con cada uno; luego un tope de gasto y la confirmación;
 * después, cada medio con su estado (en cola, trabajando, hecho), que se pone
 * al día solo mientras trabaja.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstimacionMedios, MediosLanzados } from '@scholaris/contrato';
import { avisar, Boton, Campo, cx, Dialogo, Etiquetado } from '@scholaris/ui';
import { q } from '../../datos/consultas';
import { mediosDeBiblioteca } from '../../datos/medios';
import { costeLegible } from '../../lib/investigacion';
import { tiempoACadena } from '../../lib/formato';
import { numero } from '../../lib/numero';
import { NOMBRE_PARTE } from './revision';

type Lote = { documentos: Array<{ documento: string; titulo: string }>; lanzado: string };

/** Cada medio lanzado, con su estado: en cola (aún sin tarea), trabajando (con una tarea abierta) o hecho (la tuvo y ya no). */
export function estadosDelLote(lote: Lote, activas: ReadonlySet<string>, vistos: ReadonlySet<string>): Array<{ documento: string; titulo: string; estado: 'cola' | 'trabajando' | 'hecho' }> {
  return lote.documentos.map((d) => ({ ...d, estado: activas.has(d.documento) ? 'trabajando' : vistos.has(d.documento) ? 'hecho' : 'cola' }));
}

const CLAVE = 'scholaris:lote-medios';

export function MediosBiblioteca() {
  const qcl = useQueryClient();
  const [soloTranscripcion, setSoloTranscripcion] = useState(false);
  const [estimacion, setEstimacion] = useState<EstimacionMedios | null>(null);
  const [tope, setTope] = useState('');
  const [ocupado, setOcupado] = useState<'estimar' | 'lanzar' | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [lote, setLote] = useState<Lote | null>(() => { try { return JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null') as Lote | null; } catch { return null; } });
  const { data: tareas } = useQuery({ ...q.tareas(), enabled: !!lote, refetchInterval: lote ? 5000 : false });
  const activas = useMemo(() => new Set((tareas ?? []).filter((t) => t.estado === 'procesando' || t.estado === 'en_cola').map((t) => t.documento).filter((x): x is string => !!x)), [tareas]);
  // Los que se han visto trabajar: cuando su tarea se cierra, están hechos.
  const vistos = useRef(new Set<string>());
  for (const d of activas) vistos.current.add(d);
  const estados = lote ? estadosDelLote(lote, activas, vistos.current) : [];
  const terminado = !!lote && estados.length > 0 && estados.every((e) => e.estado === 'hecho');
  useEffect(() => { if (terminado) void qcl.invalidateQueries({ queryKey: ['medios', 'revision'] }); }, [terminado, qcl]);

  const estimar = async (solo = soloTranscripcion) => {
    setOcupado('estimar');
    try {
      const r = await mediosDeBiblioteca({ soloTranscripcion: solo });
      if (!r.lanzada) { setEstimacion(r); setTope(String(Math.max(1, Math.ceil(r.usd)))); }
    } catch (e) { avisar(e instanceof Error && e.message ? e.message : 'No se pudo calcular lo que costaría.', { tono: 'error' }); }
    finally { setOcupado(null); }
  };
  const topeUsd = Number(tope.replace(',', '.'));
  const topeValido = Number.isFinite(topeUsd) && topeUsd > 0;
  const lanzar = async () => {
    if (!estimacion) return;
    setOcupado('lanzar');
    try {
      const r = await mediosDeBiblioteca({ soloTranscripcion, confirmar: true, documentos: estimacion.documentos.map((d) => d.documento), ...(topeValido ? { presupuestoUsd: topeUsd } : {}) }, qcl) as MediosLanzados;
      const nuevo: Lote = { documentos: r.documentos.map((d) => ({ documento: d.documento, titulo: d.titulo })), lanzado: new Date().toISOString() };
      vistos.current = new Set(r.lanzados.map((x) => x.documento));
      setLote(nuevo);
      try { sessionStorage.setItem(CLAVE, JSON.stringify(nuevo)); } catch { /* sin almacenamiento */ }
      avisar(`${numero(r.encolados)} ${r.encolados === 1 ? 'medio en cola' : 'medios en cola'}; empiezan ${numero(r.lanzados.length)}.`, { tono: 'exito' });
      setConfirmar(false);
      setEstimacion(null);
    } catch (e) { avisar(e instanceof Error && e.message ? e.message : 'No se pudo lanzar el trabajo.', { tono: 'error' }); }
    finally { setOcupado(null); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Qué hacer con los medios" className="flex flex-col gap-1.5 text-[0.875rem] text-coffee-800">
        {([[false, 'Percibir los medios que aún no lo están: escenas, planos, reparto y, con ello, la transcripción revisada'], [true, 'Solo revisar sus transcripciones: rellenar los huecos y corregir quién habla']] as const).map(([v, t]) => (
          <label key={String(v)} className="flex items-start gap-2.5">
            <input type="radio" name="que-medios" checked={soloTranscripcion === v} onChange={() => { setSoloTranscripcion(v); setEstimacion(null); }} className="mt-1 h-4 w-4 accent-[var(--s-coffee-800)]" />{t}
          </label>
        ))}
      </div>
      <div>
        <Boton variante="linea" tam="p" icono="buscar" cargando={ocupado === 'estimar'} onClick={() => void estimar()}>Calcular lo que costaría</Boton>
      </div>

      {estimacion ? (
        estimacion.documentos.length ? (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto rounded-xl border border-cream-300 bg-cream-50">
              <table className="w-full text-[0.8125rem]">
                <caption className="sr-only">Lo que se haría con cada medio y lo que costaría</caption>
                <thead className="bg-cream-100 text-left text-[0.6875rem] uppercase tracking-[0.06em] text-coffee-500">
                  <tr><th scope="col" className="px-3 py-2 font-semibold">Medio</th><th scope="col" className="px-3 py-2 font-semibold">Duración</th><th scope="col" className="px-3 py-2 font-semibold">Qué se hará</th><th scope="col" className="px-3 py-2 text-right font-semibold">Coste</th></tr>
                </thead>
                <tbody>
                  {estimacion.documentos.map((d) => (
                    <tr key={d.documento} className="border-t border-cream-200 align-top">
                      <td className="px-3 py-2 italic text-coffee-800">{d.titulo}</td>
                      <td className="dato px-3 py-2 text-coffee-600">{tiempoACadena(d.duracion)}</td>
                      <td className="px-3 py-2 text-coffee-700">{d.hara.map((h) => NOMBRE_PARTE[h]).join('; ')}</td>
                      <td className="dato whitespace-nowrap px-3 py-2 text-right text-coffee-800">{costeLegible(d.usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-cream-300 bg-cream-100/70 font-semibold text-coffee-800">
                    <td className="px-3 py-2" colSpan={3}>{numero(estimacion.documentos.length)} {estimacion.documentos.length === 1 ? 'medio' : 'medios'}, {numero(estimacion.horas, { maximumFractionDigits: 1 })} h</td>
                    <td className="dato whitespace-nowrap px-3 py-2 text-right">{costeLegible(estimacion.usd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {estimacion.hablantes === false ? <p className="text-[0.75rem] text-apagado">Quién dice cada frase no se revisa en tu plan.</p> : null}
            <div className="flex flex-wrap items-end gap-3">
              <Etiquetado etiqueta="Tope de gasto (USD)" ayuda="Si la estimación lo pasa, no se lanza nada." className="w-48">
                {(id, ayuda) => <Campo id={id} aria-describedby={ayuda} inputMode="decimal" value={tope} onChange={(e) => setTope(e.target.value)} aria-invalid={!topeValido} />}
              </Etiquetado>
              <Boton variante="tinta" tam="m" icono="rayo" disabled={!topeValido || topeUsd < estimacion.usd} onClick={() => setConfirmar(true)}
                title={topeValido && topeUsd < estimacion.usd ? 'La estimación pasa del tope' : undefined}>
                {soloTranscripcion ? 'Revisar' : 'Percibir'} {estimacion.documentos.length === 1 ? 'el medio' : `los ${numero(estimacion.documentos.length)}`}
              </Boton>
            </div>
            {topeValido && topeUsd < estimacion.usd ? <p role="alert" className="text-[0.8125rem] text-rojo">La estimación ({costeLegible(estimacion.usd)}) pasa del tope: súbelo o deja la biblioteca para otro día.</p> : null}
          </div>
        ) : <p className="text-[0.875rem] text-coffee-600">No hay nada que hacer: {soloTranscripcion ? 'todas las transcripciones están revisadas' : 'todos los medios están percibidos'}.</p>
      ) : null}

      {lote ? (
        <section aria-label="El trabajo en marcha" className="rounded-xl border border-cream-300 bg-cream-50/70 p-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[0.8125rem] font-semibold text-coffee-700">{terminado ? 'Terminado' : 'En marcha'}</h3>
            <span className="text-[0.75rem] text-apagado">{numero(estados.filter((e) => e.estado === 'hecho').length)} de {numero(estados.length)} hechos</span>
            {terminado ? <button type="button" onClick={() => { setLote(null); try { sessionStorage.removeItem(CLAVE); } catch { /* nada */ } }} className="ml-auto text-[0.75rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">Quitar</button> : null}
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {estados.map((e) => (
              <li key={e.documento} className="flex items-center gap-2 text-[0.8125rem]">
                <span aria-hidden className={cx('h-2 w-2 shrink-0 rounded-full', e.estado === 'hecho' ? 'bg-azul' : e.estado === 'trabajando' ? 'bg-rojo anim-pulso' : 'border border-coffee-400')} />
                <Link to="/lector/$id" params={{ id: e.documento }} className="min-w-0 flex-1 truncate italic text-coffee-800 underline-offset-4 hover:underline">{e.titulo}</Link>
                <span className="shrink-0 text-apagado">{e.estado === 'hecho' ? 'hecho' : e.estado === 'trabajando' ? 'trabajando' : 'en cola'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialogo abierto={confirmar} alCambiar={setConfirmar} titulo={soloTranscripcion ? '¿Revisar las transcripciones?' : '¿Percibir los medios?'}
        pie={<><Boton variante="linea" onClick={() => setConfirmar(false)}>Cancelar</Boton><Boton variante="tinta" icono="rayo" cargando={ocupado === 'lanzar'} onClick={() => void lanzar()}>Confirmar por {costeLegible(estimacion?.usd ?? 0)}</Boton></>}>
        <p className="text-[0.9375rem] text-coffee-700">
          Se trabajan {numero(estimacion?.documentos.length ?? 0)} {estimacion?.documentos.length === 1 ? 'medio' : 'medios'}, dos a la vez; los demás esperan en cola. Costará unos {costeLegible(estimacion?.usd ?? 0)}, por la duración de cada uno; si al lanzarlo la estimación pasara del tope, no se lanzaría nada. Los documentos se siguen pudiendo leer mientras tanto, y la comprensión se pone al día sola después.
        </p>
      </Dialogo>
    </div>
  );
}
