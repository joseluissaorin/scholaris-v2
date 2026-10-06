import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { FaseIngesta } from '@scholaris/nucleo';
import { Boton, cx, Icono } from '@scholaris/ui';
import { IconoTipo } from '../comunes/icono-tipo';
import { cancelarIngesta, retirarIngesta, type Ingesta } from '../../datos/ingesta';
import { bytes, duracion, ICONO_TIPO, NOMBRE_TIPO, nombreUnidad, esMedio, tiempoACadena } from '../../lib/formato';
import { Boceto } from '../../bocetos/boceto';

const FASES: Partial<Record<FaseIngesta, string>> = {
  subida: 'Subiendo', conversion: 'Convirtiendo', lectura: 'Leyendo', folios: 'Buscando los folios impresos', metadatos: 'Identificando la obra',
  estructura: 'Reconociendo capítulos', contexto: 'Situando cada pasaje', vectores: 'Haciéndolo buscable', figuras: 'Recortando figuras', indexado: 'Ordenando el índice', listo: 'Listo',
};

function textoEtapa(i: Ingesta): string {
  switch (i.etapa) {
    case 'preparando': return 'Preparando…';
    case 'convirtiendo':
      if (!i.preparadas) return 'Subiendo y abriendo el archivo…';
      // En los medios, lo hecho son segundos de audio ya extraídos.
      if (esMedio(i.tipo)) return `Extrayendo el sonido en tu navegador · ${tiempoACadena(i.preparadas)}${i.duracion ? ` de ${tiempoACadena(i.duracion)}` : ''}`;
      return `Imprimiendo en tu navegador · ${i.preparadas}${i.unidades ? ` de ${i.unidades}` : ''}`;
    case 'procesando': return i.fase ? `${FASES[i.fase] ?? i.fase}${i.fase === 'lectura' && i.unidades ? ` · ${i.leidas} de ${i.unidades}` : ''}` : (i.mensaje ?? 'Leyendo…');
    case 'listo': return 'Listo. Ya se puede buscar y citar.';
    case 'duplicado': return 'Ya estaba en tu biblioteca.';
    case 'cancelada': return 'Cancelado.';
    case 'error': return i.error ?? 'Algo falló.';
  }
}

/** El orden de las fases, para dibujar el camino. */
const ORDEN: FaseIngesta[] = ['subida', 'conversion', 'lectura', 'folios', 'metadatos', 'estructura', 'contexto', 'vectores', 'figuras', 'indexado', 'listo'];
const TINTAS_FASE = ['var(--s-azul)', 'var(--s-rojo)', 'var(--s-amarillo)'];

/**
 * Las fases como una línea de Kandinsky que se dibuja sola: un trazo que cruza
 * la tarjeta con una parada (un círculo de color) por fase; lo recorrido va en
 * tinta, la parada actual late y lo que falta queda a lápiz.
 */
function CaminoFases({ i }: { i: Ingesta }) {
  const n = ORDEN.length;
  const k = i.etapa === 'listo' || i.etapa === 'duplicado' ? n - 1 : i.etapa === 'procesando' && i.fase ? Math.max(0, ORDEN.indexOf(i.fase)) : i.etapa === 'convirtiendo' ? 1 : 0;
  const x = (j: number) => 6 + (j / (n - 1)) * 288;
  const y = (j: number) => 13 - Math.sin((j / (n - 1)) * Math.PI) * 6;
  const d = ORDEN.map((_, j) => `${j ? 'L' : 'M'}${x(j).toFixed(1)} ${y(j).toFixed(1)}`).join('');
  return (
    <svg viewBox="0 0 300 20" className="h-5 w-full" aria-hidden preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--s-cream-400)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="var(--s-coffee-800)" strokeWidth="1.6" pathLength={1} strokeDasharray="1 2"
        className="transition-[stroke-dashoffset] duration-[900ms] ease-[var(--ease-tinta)]" style={{ strokeDashoffset: 1 - k / (n - 1) }} />
      {ORDEN.map((f, j) => (
        <circle key={f} cx={x(j)} cy={y(j)} r={j === k ? 3.2 : 2} fill={j <= k ? TINTAS_FASE[j % 3] : 'var(--s-cream-400)'}
          className={cx('transition-[fill] duration-500', j === k && i.etapa !== 'listo' && 'fase-viva')} />
      ))}
    </svg>
  );
}

/** Algo que tarda: pasado un rato, el caracol de los márgenes aparece en la tarjeta. */
function useTras(ms: number, activo: boolean) {
  const [ya, setYa] = useState(false);
  useEffect(() => { if (!activo) return; const h = setTimeout(() => setYa(true), ms); return () => clearTimeout(h); }, [ms, activo]);
  return ya && activo;
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
  const abierta = i.documento && (leida > 0 || (!esMedio(i.tipo) && i.preparadas > 0) || i.etapa === 'listo' || i.etapa === 'duplicado');
  const terminado = i.etapa === 'listo' || i.etapa === 'duplicado' || i.etapa === 'cancelada' || i.etapa === 'error';
  const miniaturas = i.miniaturas.slice(-14);
  const imprimiendo = i.etapa === 'preparando' || i.etapa === 'convirtiendo';
  const lento = useTras(45_000, !terminado);

  // Tres fases, tres tintas: el navegador imprime (azul), Scholaris lee (rojo), se puede buscar (amarillo).
  const fImprenta = i.etapa === 'preparando' ? 0.05 : i.etapa === 'convirtiendo' ? Math.max(0.1, total ? i.preparadas / total : 0.5) : 1;
  const fLectura = i.etapa === 'listo' || i.etapa === 'duplicado' ? 1 : total ? Math.min(1, leida / total) : i.etapa === 'procesando' ? i.avance : 0;
  const fBusqueda = i.etapa === 'listo' || i.etapa === 'duplicado' ? 1 : total ? Math.min(1, i.buscables / total) : 0;

  return (
    <article className={cx('relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-cream-50 shadow-[var(--levantado)] anim-sube', i.etapa === 'error' ? 'border-rojo/60' : 'border-cream-400')} aria-live="polite">
      {/* Las tres tintas se llenan con transform (sin repintar anchos) y se asientan con muelle. */}
      <div className="grid grid-cols-3 gap-0.5 bg-cream-200" aria-hidden>
        {[[fImprenta, 'bg-azul'], [fLectura, 'bg-rojo'], [fBusqueda, 'bg-amarillo']].map(([f, c], k) => (
          <div key={k} className="h-1.5 overflow-hidden bg-cream-200"><div className={cx('h-full transition-transform duration-[var(--dur-asentar)] ease-[var(--muelle-asentar)]', c as string)} style={{ transform: `translateX(${Math.round((f as number) * 100) - 100}%)` }} /></div>
        ))}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          {i.etapa === 'listo' ? (
            <span className="anim-sello grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg border border-[#c48a1f] bg-amarillo text-coffee-800 shadow-[var(--relieve)]"><Icono nombre="hecho" tam={17} grosor={2.2} /></span>
          ) : i.etapa === 'error' ? (
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-rojo text-[#fdf8f1] shadow-[var(--relieve-oscuro)]"><Icono nombre="aviso" tam={17} /></span>
          ) : (
            <IconoTipo nombre={ICONO_TIPO[i.tipo]} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.9375rem] font-semibold leading-tight text-coffee-800" title={i.nombre}>{i.nombre}</p>
            <p className={cx('mt-1 truncate text-[0.8125rem]', i.etapa === 'error' ? 'text-rojo' : 'text-coffee-500')}>{textoEtapa(i)}</p>
          </div>
          <button type="button" onClick={() => (terminado ? retirarIngesta(i.id) : void cancelarIngesta(i.id))} aria-label={terminado ? 'Quitar de la mesa' : `Cancelar «${i.nombre}»`} className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-coffee-300 hover:bg-cream-200 hover:text-coffee-800">
            <Icono nombre="cerrar" tam={15} />
          </button>
        </div>

        {!terminado ? <CaminoFases i={i} /> : null}

        {/* Las páginas, apareciendo: salen de la prensa (dibujada a mano) y vuelan a la bandeja hundida. */}
        {miniaturas.length || (imprimiendo && !esMedio(i.tipo)) ? (
          <div className="relative flex h-[4.75rem] items-end justify-end gap-1.5 overflow-hidden rounded-xl bg-cream-200/70 px-2 py-2 shadow-[var(--hundido)]" aria-hidden>
            {imprimiendo ? <Boceto nombre="imprenta" decorativo dibujar="ya" ritmo={0.8} className="absolute bottom-1 left-1.5 w-[4.6rem] opacity-90" /> : null}
            {miniaturas.map((m, k) => {
              const n = i.miniaturas.length - miniaturas.length + k + 1;
              return (
                <div key={m} className="relative h-full w-[2.6rem] shrink-0 overflow-hidden rounded-[3px] bg-white shadow-[0_1px_2px_rgb(44_24_16/0.15),0_2px_5px_rgb(44_24_16/0.08)] anim-vuela">
                  <img src={m} alt="" className="h-full w-full object-cover" />
                  {n <= leida ? <span className="anim-llena absolute inset-x-0 bottom-0 h-1 origin-left bg-rojo" /> : null}
                </div>
              );
            })}
          </div>
        ) : !esMedio(i.tipo) && total ? (
          <div className="flex flex-wrap gap-[3px] rounded-xl bg-cream-200/70 p-2 shadow-[var(--hundido)]" role="img" aria-label={`${leida} de ${total} leídas`}>
            {Array.from({ length: marcas }, (_, k) => {
              const hasta = ((k + 1) / marcas) * total;
              return <span key={k} className={cx('h-3 w-[7px] rounded-[1.5px] transition-colors duration-300', leida >= hasta ? 'bg-rojo' : i.preparadas >= hasta ? 'bg-azul/60' : 'bg-cream-400/70')} />;
            })}
          </div>
        ) : null}

        {lento ? (
          <div className="anim-sube flex items-center gap-2 text-[0.75rem] text-coffee-500">
            <Boceto nombre="caracol" decorativo dibujar="ya" className="w-20 shrink-0" />
            <span>Va despacio, pero va. Puedes cerrar la página: seguirá leyendo.</span>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <span className="mr-auto truncate text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-coffee-400">
            {NOMBRE_TIPO[i.tipo]}{esMedio(i.tipo) ? (i.duracion ? ` · ${duracion(i.duracion)}` : '') : total ? ` · ${nombreUnidad(i.tipo, total)}` : ''}{i.bytes ? ` · ${bytes(i.bytes)}` : ''} · <Cronometro desde={i.inicio} hasta={i.fin} />
          </span>
          {i.buscables > 0 && i.etapa !== 'listo' && i.documento ? (
            <Boton comoHijo variante="linea" tam="p"><Link to="/buscar" search={{ doc: i.documento }}><Icono nombre="buscar" tam={14} />Buscar ya</Link></Boton>
          ) : null}
          {abierta ? (
            <Boton comoHijo variante={i.etapa === 'listo' || i.etapa === 'duplicado' ? 'tinta' : 'linea'} tam="p">
              <Link to="/lector/$id" params={{ id: i.documento! }}>{i.etapa === 'listo' || i.etapa === 'duplicado' ? 'Abrir' : 'Leer ya'}<Icono nombre="derecha" tam={14} /></Link>
            </Boton>
          ) : null}
        </div>
      </div>
    </article>
  );
}
