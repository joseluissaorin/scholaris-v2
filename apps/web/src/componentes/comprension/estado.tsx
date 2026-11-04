/**
 * El estado de la comprensión de un documento: si está hecha, en marcha (con su
 * avance en vivo), pendiente o fallida; con qué lente, qué modelo y cuánto costó;
 * y el botón para comprenderlo (o rehacerlo). Comprender gasta modelo: el botón
 * lo dice y rehacer pide una confirmación.
 */
import { useState } from 'react';
import type { MapaComprension } from '@scholaris/contrato';
import { avisar, BarraAvance, Boton, cx, Dialogo, Icono } from '@scholaris/ui';
import { useAvanceVivo, useComprender } from '../../datos/comprension';
import { avanceComprension, DISCIPLINA_LENTE, NOMBRE_ESTADO, NOMBRE_LENTE } from '../../lib/comprension';
import { costeLegible } from '../../lib/investigacion';
import { numero } from '../../lib/numero';
import { haceCuanto } from '../../lib/formato';

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
  const [confirmar, setConfirmar] = useState(false);
  const e = mapa?.estado ?? null;
  const valor = e?.estado ?? 'pendiente';
  const enMarcha = valor === 'en_marcha' || (vivo?.estado === 'en_marcha' && valor !== 'hecho');
  const av = avanceComprension(e, vivo);

  const lanzar = async (forzar: boolean) => {
    setConfirmar(false);
    try {
      await pedir(forzar ? { forzar: true } : {});
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
            <Boton variante="fantasma" tam="p" icono="rayo" onClick={() => setConfirmar(true)} disabled={pidiendo}>Volver a comprender</Boton>
          ) : !enMarcha && valor !== 'sin_modelo' ? (
            <Boton variante="tinta" tam="p" icono="chispa" cargando={pidiendo} disabled={!listo || pidiendo} onClick={() => void lanzar(valor === 'error')}
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
          {mapa ? `${numero(mapa.totales.segmentos)} segmentos${mapa.totales.planos ? `, de ellos ${numero(mapa.totales.planos)} planos` : ''}, ${numero(mapa.totales.fichas)} fichas y ${numero(mapa.totales.apariciones)} apariciones de ${numero(mapa.totales.entidades)} entidades. ` : ''}
          {e.modelo ? <>Con <span className="dato">{e.modelo}</span>, </> : null}{costeLegible(e.usd)}, {haceCuanto(e.actualizado)}.
        </p>
      ) : null}
      {e?.avisos.length && !compacto ? (
        <ul className="mt-2 flex flex-col gap-1">
          {e.avisos.map((a, i) => <li key={i} className="flex items-start gap-2 text-[0.8125rem] text-coffee-600"><Icono nombre="aviso" tam={14} className="mt-0.5 shrink-0 text-ocre" />{a}</li>)}
        </ul>
      ) : null}

      <Dialogo abierto={confirmar} alCambiar={setConfirmar} titulo="¿Volver a comprender este documento?"
        pie={<><Boton variante="linea" onClick={() => setConfirmar(false)}>Cancelar</Boton><Boton variante="tinta" icono="rayo" onClick={() => void lanzar(true)}>Volver a comprender</Boton></>}>
        <p className="text-[0.9375rem] text-coffee-700">
          Se vuelve a leer la obra entera con el modelo y se sustituyen la estructura, las fichas y las apariciones. La última vez costó {costeLegible(e?.usd ?? 0)}. Mientras tanto, lo que hay se sigue viendo.
        </p>
      </Dialogo>
    </section>
  );
}
