import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { FaseIngesta } from '@scholaris/nucleo';
import { cx, Icono, Rotulo } from '@scholaris/ui';
import { cancelarIngesta, retirarIngesta, type Ingesta } from '../../datos/ingesta';
import { bytes, ICONO_TIPO, NOMBRE_TIPO, nombreUnidad, esMedio } from '../../lib/formato';

const FASES: Partial<Record<FaseIngesta, string>> = {
  subida: 'Subiendo', conversion: 'Convirtiendo', lectura: 'Leyendo', folios: 'Buscando los folios impresos', metadatos: 'Identificando la obra',
  estructura: 'Reconociendo capítulos', contexto: 'Situando cada pasaje', vectores: 'Haciéndolo buscable', figuras: 'Recortando figuras', indexado: 'Ordenando el índice', listo: 'Listo',
};

function textoEtapa(i: Ingesta): string {
  switch (i.etapa) {
    case 'preparando': return 'Preparando…';
    case 'convirtiendo': return i.preparadas ? `Imprimiendo en tu navegador · ${i.preparadas}${i.unidades ? ` de ${i.unidades}` : ''}` : 'Subiendo y abriendo el archivo…';
    case 'procesando': return i.fase ? `${FASES[i.fase] ?? i.fase}${i.fase === 'lectura' && i.unidades ? ` · ${i.leidas} de ${i.unidades}` : ''}` : (i.mensaje ?? 'Leyendo…');
    case 'listo': return 'Listo. Ya se puede buscar y citar.';
    case 'duplicado': return 'Ya estaba en tu biblioteca.';
    case 'cancelada': return 'Cancelado.';
    case 'error': return i.error ?? 'Algo falló.';
  }
}

function Cronometro({ desde, hasta }: { desde: number; hasta?: number }) {
  const [, setT] = useState(0);
  useEffect(() => { if (hasta) return; const h = setInterval(() => setT((x) => x + 1), 1000); return () => clearInterval(h); }, [hasta]);
  const s = Math.max(0, Math.round(((hasta ?? Date.now()) - desde) / 1000));
  return <span className="tnum">{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}</span>;
}

/**
 * La tarjeta de una ingesta en vivo. Las páginas aparecen mientras se leen:
 * primero las miniaturas que imprime el navegador, luego cada marca se rellena
 * de tinta cuando el servidor ya la ha leído (y se puede buscar).
 */
export function TarjetaIngesta({ i }: { i: Ingesta }) {
  const total = i.unidades ?? 0;
  const leida = i.leidas;
  const marcas = Math.min(total || 24, 48);
  const abierta = i.documento && (leida > 0 || i.etapa === 'listo' || i.etapa === 'duplicado');
  const terminado = i.etapa === 'listo' || i.etapa === 'duplicado' || i.etapa === 'cancelada' || i.etapa === 'error';
  const miniaturas = i.miniaturas.slice(-14);

  return (
    <article className={cx('relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-m border bg-hoja p-4 anim-entra', i.etapa === 'error' ? 'border-rojo' : 'border-filete')} aria-live="polite">
      <div className="flex items-start gap-3">
        <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full', i.etapa === 'listo' ? 'bg-amarillo text-tinta' : i.etapa === 'error' ? 'bg-rojo text-[#fbf5ec]' : 'bg-tinta text-sobre-tinta')}>
          <Icono nombre={i.etapa === 'listo' ? 'hecho' : i.etapa === 'error' ? 'aviso' : ICONO_TIPO[i.tipo]} tam={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1rem] leading-tight text-tinta" title={i.nombre}>{i.nombre}</p>
          <p className={cx('mt-1 truncate text-[0.8125rem]', i.etapa === 'error' ? 'text-rojo' : 'text-tinta-2')}>{textoEtapa(i)}</p>
        </div>
        {!terminado ? (
          <button type="button" onClick={() => void cancelarIngesta(i.id)} aria-label={`Cancelar «${i.nombre}»`} className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-tinta">
            <Icono nombre="cerrar" tam={15} />
          </button>
        ) : (
          <button type="button" onClick={() => retirarIngesta(i.id)} aria-label="Quitar de la mesa" className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-tinta">
            <Icono nombre="cerrar" tam={15} />
          </button>
        )}
      </div>

      {/* Las páginas, apareciendo. */}
      {miniaturas.length ? (
        <div className="flex h-[4.25rem] items-end gap-1.5 overflow-hidden" aria-hidden>
          {miniaturas.map((m, k) => {
            const n = i.miniaturas.length - miniaturas.length + k + 1;
            return (
              <div key={m} className="relative h-[4.25rem] w-[3.1rem] shrink-0 overflow-hidden rounded-[2px] border border-filete bg-papel anim-entra">
                <img src={m} alt="" className="h-full w-full object-cover" />
                <span className={cx('absolute inset-x-0 bottom-0 h-1', n <= leida ? 'bg-tinta' : 'bg-transparent')} />
              </div>
            );
          })}
        </div>
      ) : null}

      {!esMedio(i.tipo) && total ? (
        <div className="flex flex-wrap gap-[3px]" role="img" aria-label={`${leida} de ${total} leídas`}>
          {Array.from({ length: marcas }, (_, k) => {
            const hasta = ((k + 1) / marcas) * total;
            const lista = leida >= hasta;
            const preparada = i.preparadas >= hasta;
            return <span key={k} className={cx('h-3 w-[7px] transition-colors duration-300', lista ? 'bg-tinta' : preparada ? 'bg-filete-fuerte' : 'bg-hondo')} />;
          })}
        </div>
      ) : (
        <div className="relative h-[3px] bg-hondo">
          <div className="absolute inset-y-0 left-0 bg-rojo transition-[width] duration-500" style={{ width: `${Math.round(i.avance * 100)}%` }} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <Rotulo className="truncate">
          {NOMBRE_TIPO[i.tipo]}{total ? ` · ${nombreUnidad(i.tipo, total)}` : ''}{i.bytes ? ` · ${bytes(i.bytes)}` : ''} · <Cronometro desde={i.inicio} hasta={i.fin} />
        </Rotulo>
        {abierta ? (
          <Link to="/lector/$id" params={{ id: i.documento! }} className="ml-auto flex shrink-0 items-center gap-1 text-[0.875rem] text-tinta underline decoration-rojo decoration-2 underline-offset-4 hover:decoration-tinta">
            {i.etapa === 'listo' || i.etapa === 'duplicado' ? 'Abrir' : 'Leer ya'} <Icono nombre="derecha" tam={14} />
          </Link>
        ) : null}
      </div>
    </article>
  );
}
