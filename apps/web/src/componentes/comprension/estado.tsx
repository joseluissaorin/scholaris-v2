/**
 * El estado de la comprensión de un documento: si está hecha, en marcha (con su
 * avance en vivo), pendiente o fallida; con qué lente, qué modelo y cuánto costó;
 * y el botón para comprenderlo (o rehacerlo). Comprender gasta modelo: antes de
 * empezar se dice lo que costaría (aproximado) y se confirma; durante, cada paso
 * con su estado; después, lo que costó cada uno y los avisos del flujo.
 */
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MapaComprension } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, cx, Dialogo, Icono } from '@scholaris/ui';
import { useAvanceVivo, useComprender } from '../../datos/comprension';
import { q } from '../../datos/consultas';
import { avanceComprension, DISCIPLINA_LENTE, NOMBRE_ESTADO, NOMBRE_LENTE, NOMBRE_PASO, pasosDeComprension, type EstadoPaso } from '../../lib/comprension';
import { dolaresAproximados, estimarComprension, PRESUPUESTO_COMPRENSION } from '../../lib/estimacion';
import { costeLegible, duracionLegible } from '../../lib/investigacion';
import { numero } from '../../lib/numero';
import { haceCuanto } from '../../lib/formato';

/** «1 ficha», «12 fichas», con los números a la española. */
const cuantos = (n: number, uno: string, varios: string) => `${numero(n)} ${n === 1 ? uno : varios}`;

export function EstadoComprension({ documento, mapa, listo, compacto, className }: {
  documento: string;
  mapa: MapaComprension | undefined;
  /** El documento ya está leído (la comprensión solo empieza entonces). */
  listo: boolean;
  compacto?: boolean;
  className?: string;
}) {
  const vivo = useAvanceVivo(documento);
  const { pedir, pidiendo } = useComprender(documento);
  const { data: doc } = useQuery(q.documento(documento));
  const [confirmar, setConfirmar] = useState<'primera' | 'rehacer' | null>(null);
  const [economico, setEconomico] = useState(false);
  const [verPasos, setVerPasos] = useState(false);
  const idPasos = useId();
  const e = mapa?.estado ?? null;
  const valor = e?.estado ?? 'pendiente';
  const enMarcha = valor === 'en_marcha' || (vivo?.estado === 'en_marcha' && valor !== 'hecho');
  const av = avanceComprension(e, vivo);

  const pasos = pasosDeComprension(e, vivo);
  const estimacion = doc ? estimarComprension({ tipo: doc.tipo, unidades: doc.unidades, ...(doc.duracion ? { duracion: doc.duracion } : {}) }, { economico }) : null;
  const lanzar = async (forzar: boolean) => {
    setConfirmar(null);
    try {
      await pedir({ ...(forzar ? { forzar: true } : {}), ...(economico ? { economico: true } : {}) });
      avisar(forzar ? 'Se vuelve a comprender el documento.' : 'Empieza la comprensión del documento.', { tono: 'exito' });
    } catch (err) {
      avisar(err instanceof Error && err.message ? err.message : 'No se pudo pedir la comprensión.', { tono: 'error' });
    }
  };

  const lentes = mapa?.lentes.length ? mapa.lentes : e?.lentes ?? [];
  return (
    <section aria-label="Estado de la comprensión" className={cx('relative rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado)]', compacto ? 'p-3.5' : 'p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className={cx('h-2.5 w-2.5 shrink-0', valor === 'hecho' ? 'rounded-full bg-azul' : enMarcha ? 'rounded-full bg-rojo anim-pulso' : valor === 'error' ? 'bg-rojo' : 'rotate-45 bg-amarillo')} />
        <p role="status" className="text-[0.9375rem] font-semibold text-coffee-800">{enMarcha ? NOMBRE_ESTADO.en_marcha : NOMBRE_ESTADO[valor]}</p>
        {lentes.length ? (
          <span className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-coffee-600">
            <span className="sr-only">Lentes:</span>
            {lentes.map((l, i) => (
              <span key={l} title={`Leído con ${DISCIPLINA_LENTE[l]}`} className={cx('rounded-md border px-1.5 py-px text-[0.75rem] font-medium', i === 0 ? 'border-coffee-500 bg-cream-100 text-coffee-800' : 'border-cream-400 text-coffee-600')}>
                {NOMBRE_LENTE[l]}
              </span>
            ))}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {valor === 'hecho' && !enMarcha ? (
            <Boton variante="fantasma" tam="p" icono="rayo" onClick={() => setConfirmar('rehacer')} disabled={pidiendo}>Volver a comprender</Boton>
          ) : !enMarcha && valor !== 'sin_modelo' ? (
            <Boton variante="tinta" tam="p" icono="chispa" cargando={pidiendo} disabled={!listo || pidiendo} onClick={() => (valor === 'error' ? void lanzar(true) : setConfirmar('primera'))}
              title={listo ? undefined : 'La comprensión empieza cuando termina la lectura del documento'}>
              {valor === 'error' ? 'Reintentar' : 'Comprender'}
            </Boton>
          ) : null}
        </div>
      </div>

      {enMarcha ? (
        <div className="mt-3">
          <BarraAvance valor={av.valor || undefined} tono="azul" etiqueta="Avance de la comprensión" />
          <p className="mt-1.5 flex items-center justify-between gap-3 text-[0.8125rem] text-coffee-600">
            <span aria-live="polite">{av.texto}</span>
            <span className="dato text-apagado">{Math.round(av.valor * 100)} %</span>
          </p>
          {!compacto ? <ListaPasos pasos={pasos} className="mt-3" /> : null}
        </div>
      ) : valor === 'pendiente' ? (
        <p className="mt-2 max-w-[62ch] text-[0.875rem] text-coffee-600">
          {listo
            ? 'Todavía no se ha comprendido. Comprender lee la obra entera con la lente de su género: su estructura con un resumen de cada parte, una ficha de cada escena o capítulo, los personajes, lugares y motivos con cada aparición anclada y una ficha global. Tarda unos minutos y gasta modelo.'
            : 'Se podrá comprender en cuanto termine la lectura del documento.'}
        </p>
      ) : valor === 'sin_modelo' ? (
        <p className="mt-2 text-[0.875rem] text-coffee-600">Esta instalación no tiene un modelo de comprensión configurado. Añade una clave propia de Gemini en Ajustes para comprender los documentos.</p>
      ) : valor === 'error' ? (
        <p role="alert" className="mt-2 text-[0.875rem] text-rojo">{e?.error ?? 'La comprensión se detuvo con un error.'}</p>
      ) : null}

      {e && valor === 'hecho' && !compacto ? (
        <p className="mt-2 text-[0.8125rem] text-apagado">
          {mapa ? `${cuantos(mapa.totales.segmentos, 'segmento', 'segmentos')}${mapa.totales.planos ? `, de ellos ${cuantos(mapa.totales.planos, 'plano', 'planos')}` : ''}, ${cuantos(mapa.totales.fichas, 'ficha', 'fichas')} y ${cuantos(mapa.totales.apariciones, 'aparición', 'apariciones')}${mapa.totales.entidades ? ` de ${cuantos(mapa.totales.entidades, 'entidad', 'entidades')}` : ''}. ` : ''}
          {e.modelo ? <>Con <span className="dato">{e.modelo}</span>, </> : null}{costeLegible(e.usd)}, {haceCuanto(e.actualizado)}.{' '}
          <button type="button" aria-expanded={verPasos} aria-controls={idPasos} onClick={() => setVerPasos((x) => !x)} className="font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">{verPasos ? 'Ocultar los pasos' : 'Ver cada paso'}</button>
        </p>
      ) : null}
      {verPasos && valor === 'hecho' && !compacto ? <div id={idPasos}><ListaPasos pasos={pasos} className="mt-3" /></div> : null}
      {e?.avisos.length ? (
        compacto ? (
          <p className="mt-2 flex items-start gap-2 text-[0.75rem] text-coffee-600" title={e.avisos.join('\n')}><Icono nombre="aviso" tam={13} className="mt-0.5 shrink-0 text-ocre" />{e.avisos.length === 1 ? e.avisos[0] : `${e.avisos.length} avisos del flujo (en la comprensión entera)`}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1" aria-label="Avisos de la comprensión">
            {e.avisos.map((a, i) => <li key={i} className="flex items-start gap-2 text-[0.8125rem] text-coffee-600"><Icono nombre="aviso" tam={14} className="mt-0.5 shrink-0 text-ocre" />{a}</li>)}
          </ul>
        )
      ) : null}

      <Dialogo abierto={!!confirmar} alCambiar={(v) => { if (!v) setConfirmar(null); }} titulo={confirmar === 'rehacer' ? '¿Volver a comprender este documento?' : '¿Comprender este documento?'}
        pie={<><Boton variante="linea" onClick={() => setConfirmar(null)}>Cancelar</Boton><Boton variante="tinta" icono={confirmar === 'rehacer' ? 'rayo' : 'chispa'} onClick={() => void lanzar(confirmar === 'rehacer')}>{confirmar === 'rehacer' ? 'Volver a comprender' : 'Comprender'}</Boton></>}>
        <div className="flex flex-col gap-3 text-[0.9375rem] text-coffee-700">
          {confirmar === 'rehacer' ? (
            <p>Se vuelve a leer la obra entera con el modelo y se sustituyen la estructura, las fichas y las apariciones. La última vez costó {costeLegible(e?.usd ?? 0)}. Mientras tanto, lo que hay se sigue viendo.</p>
          ) : (
            <p>Se lee la obra entera con la lente de su género: la estructura, una ficha de cada parte, los personajes, lugares y motivos con cada aparición y una ficha global. Tarda unos minutos.</p>
          )}
          {estimacion != null ? (
            <p className="rounded-xl border border-cream-400 bg-cream-100/70 px-3.5 py-2.5 shadow-[var(--hundido)]">
              Costará <strong className="font-semibold text-coffee-800">{dolaresAproximados(estimacion)}</strong>, calculado por el tamaño del documento. El tope por documento es de {PRESUPUESTO_COMPRENSION} USD: si se llega, lo que falta sigue con el modelo rápido.
            </p>
          ) : null}
          <label className="flex items-start gap-2.5 text-[0.875rem]">
            <input type="checkbox" checked={economico} onChange={(x) => setEconomico(x.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--s-coffee-800)]" />
            <span>Solo con el modelo rápido: cuesta bastante menos y las fichas salen algo menos finas.</span>
          </label>
        </div>
      </Dialogo>
    </section>
  );
}

/** Cada paso del flujo con su estado y, si está hecho, lo que tardó y lo que costó. */
function ListaPasos({ pasos, className }: { pasos: EstadoPaso[]; className?: string }) {
  return (
    <ol className={cx('grid grid-cols-1 gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2', className)} aria-label="Pasos de la comprensión">
      {pasos.map((p) => (
        <li key={p.paso} className="flex items-baseline gap-2">
          <span aria-hidden className={cx('mt-1 h-2 w-2 shrink-0 self-start', p.estado === 'hecho' ? 'rounded-full bg-azul' : p.estado === 'en_marcha' ? 'rounded-full bg-rojo anim-pulso' : 'rounded-full border border-coffee-400')} />
          <span className={cx('min-w-0 flex-1', p.estado === 'pendiente' ? 'text-apagado' : 'text-coffee-800')}>
            {NOMBRE_PASO[p.paso]}{p.detalle ? <span className="text-coffee-500">, {p.detalle}</span> : null}
            <span className="sr-only">: {p.estado === 'hecho' ? 'hecho' : p.estado === 'en_marcha' ? 'en marcha' : 'pendiente'}</span>
          </span>
          {p.estado === 'hecho' && (p.ms || p.usd) ? <span className="dato shrink-0 text-apagado">{p.ms ? duracionLegible(p.ms) : ''}{p.ms && p.usd ? ' · ' : ''}{p.usd ? costeLegible(p.usd) : ''}</span> : null}
        </li>
      ))}
    </ol>
  );
}
