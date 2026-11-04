/**
 * La película plano a plano, sincronizada con el reproductor: una línea con las
 * secuencias, las escenas y lo que suena (música, canciones, lluvia), y debajo,
 * los planos de la escena en curso con su escala. Al reproducir o al recorrer la
 * línea se encienden la escena y el plano de cada instante; la tarjeta del plano
 * dice cómo está filmado (escala, angulación, movimiento, composición, luz) y
 * quién está en cuadro, con su región sobre el fotograma; la ficha de la escena
 * cuenta qué pasa y con qué función.
 *
 * El cabezal se mueve tocando el DOM desde el reloj del motor; React solo se
 * entera cuando cambia la escena o el plano.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DetalleDocumento } from '@scholaris/contrato';
import type { Segmento } from '@scholaris/nucleo';
import { cx, Esqueleto, Folio, Rotulo } from '@scholaris/ui';
import { qc } from '../../datos/comprension';
import {
  construirPelicula, duracionPlano, enCuadro, enInstante, rasgosPlano, tramosDe, type Pelicula, type PlanoVista, type SonidoVista, type TramoPelicula,
} from '../../lib/comprension';
import { tiempoACadena } from '../../lib/formato';
import { numero } from '../../lib/numero';
import { RecuadroMano } from '../comunes/recuadro-mano';
import { motor } from '../reproductor/motor';
import { useMotor } from '../reproductor/ganchos';
import { FichaSegmento } from './mapa';
import { useFotogramaEn } from './material';

// ---------------------------------------------------------------------------
// Datos y reloj
// ---------------------------------------------------------------------------

/** El découpage de un vídeo: segmentos, fichas de plano y lo que se oye. */
export function usePelicula(doc: Pick<DetalleDocumento, 'id' | 'duracion' | 'tipo'>, activo = true): { pelicula: Pelicula | null; segmentos: Segmento[] | undefined; cargando: boolean } {
  const s = useQuery({ ...qc.segmentos(doc.id), enabled: activo });
  const f = useQuery({ ...qc.fichas(doc.id, 'plano'), enabled: activo && !!s.data?.some((x) => x.tipo === 'plano') });
  const a = useQuery({ ...qc.apariciones(doc.id), enabled: activo && !!s.data?.length });
  const pelicula = useMemo(() => (s.data?.length ? construirPelicula(s.data, f.data ?? [], a.data ?? [], doc.duracion ?? 0) : null), [s.data, f.data, a.data, doc.duracion]);
  return { pelicula, segmentos: s.data, cargando: s.isPending };
}

interface Posicion { secuencia: number; escena: number; plano: number; sonido: number[] }

/** La secuencia, la escena, el plano y lo que suena en el instante del motor (solo re-renderiza al cambiar). */
export function usePosicion(p: Pelicula | null, documento: string): Posicion {
  const [pos, setPos] = useState<Posicion>({ secuencia: -1, escena: -1, plano: -1, sonido: [] });
  const cache = useMemo(() => (p ? { sq: tramosDe(p.secuencias), es: tramosDe(p.escenas), pl: tramosDe(p.planos) } : null), [p]);
  useEffect(() => {
    if (!p || !cache) return;
    return motor().escucharTiempo((t) => {
      if (motor().instantanea().documento !== documento) return;
      const i = enInstante(p, t, cache);
      const sonido = p.sonido.flatMap((s, k) => (t >= s.t0 && t < s.t1 ? [k] : []));
      setPos((x) => (x.secuencia === i.secuencia && x.escena === i.escena && x.plano === i.plano && x.sonido.join() === sonido.join() ? x : { ...i, sonido }));
    });
  }, [p, cache, documento]);
  return pos;
}

// ---------------------------------------------------------------------------
// La vista
// ---------------------------------------------------------------------------

export function VistaPelicula({ doc, sinComprension }: { doc: DetalleDocumento; sinComprension?: ReactNode }) {
  const { pelicula: p, segmentos, cargando } = usePelicula(doc);
  const pos = usePosicion(p, doc.id);
  const inst = useMotor();
  const propio = inst.documento === doc.id;
  const irA = useCallback((t: number) => motor().irA(t + 0.01), []);

  if (cargando) return <div className="flex flex-col gap-3 pt-2"><Esqueleto className="h-32 rounded-2xl" /><Esqueleto className="h-56 rounded-2xl" /></div>;
  if (!p || (!p.escenas.length && !p.planos.length)) return <>{sinComprension}</>;
  const escena = p.escenas[pos.escena];
  const plano = p.planos[pos.plano];
  const segEscena = escena ? segmentos?.find((s) => s.id === escena.id) : undefined;
  return (
    <div className="flex flex-col gap-5 pb-24 pt-2">
      <section aria-label="Línea de la película" className="rounded-2xl border border-cream-400 bg-cream-50 p-3 shadow-[var(--levantado)] sm:p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[1rem] font-semibold text-coffee-800">La película plano a plano</h2>
          <p className="text-[0.8125rem] text-apagado">
            {numero(p.secuencias.length)} {p.secuencias.length === 1 ? 'secuencia' : 'secuencias'}, {numero(p.escenas.length)} {p.escenas.length === 1 ? 'escena' : 'escenas'} y {numero(p.planos.length)} {p.planos.length === 1 ? 'plano' : 'planos'}
          </p>
          {!propio ? <p className="w-full text-[0.75rem] text-ocre">Reproduce el vídeo para que la línea siga al reproductor.</p> : null}
        </div>
        <LineaPelicula p={p} pos={pos} alIr={irA} />
        {escena ? <PlanosDeEscena p={p} escena={escena} pos={pos} alIr={irA} /> : null}
      </section>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        {plano ? <TarjetaPlano plano={plano} documento={doc.id} indice={pos.plano} total={p.planos.length} alIr={irA} /> : (
          <div className="rounded-2xl border border-dashed border-cream-500 bg-cream-100/60 p-4 text-[0.875rem] text-coffee-600 shadow-[var(--hundido)]">
            {escena ? 'En este tramo no hay planos percibidos: la escena se analizó desde la transcripción.' : 'Entre escenas: nada que describir en este instante.'}
          </div>
        )}
        {segEscena ? <FichaSegmento key={segEscena.id} documento={doc.id} segmento={segEscena} alIr={(a) => { if (a.tipo === 'tiempo') irA(a.instante ?? a.t0); }} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// La línea: secuencias, escenas y sonido
// ---------------------------------------------------------------------------

const pct = (t: number, d: number) => `${d > 0 ? Math.max(0, Math.min(100, (t / d) * 100)) : 0}%`;

function LineaPelicula({ p, pos, alIr }: { p: Pelicula; pos: Posicion; alIr: (t: number) => void }) {
  const zona = useRef<HTMLDivElement>(null);
  const cabezal = useRef<HTMLDivElement>(null);
  const arrastre = useRef(false);
  const [vista, setVista] = useState<{ x: number; t: number } | null>(null);
  const d = p.duracion || 1;
  useEffect(() => motor().escucharTiempo((t) => { if (cabezal.current) cabezal.current.style.left = pct(t, d); }), [d]);

  const tiempoDe = (e: PointerEvent) => {
    const r = zona.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, t: Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d)) };
  };
  const sobre = (t: number) => {
    const i = enInstante(p, t);
    return [p.escenas[i.escena]?.titulo, p.planos[i.plano] ? rasgosPlano(p.planos[i.plano]!) : ''].filter(Boolean).join(' · ');
  };
  const altoSonido = sonidoAlto(p.sonido);

  return (
    <div className="mt-3 flex gap-2">
      {/* Los nombres de los carriles, a la altura de cada uno. */}
      <div aria-hidden className="flex w-[4.75rem] shrink-0 flex-col gap-1.5 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-coffee-500 sm:w-24">
        <span className="flex h-7 items-center justify-end">Secuencias</span>
        <span className="flex h-7 items-center justify-end">Escenas</span>
        {p.sonido.length ? <span className="flex items-center justify-end" style={{ height: altoSonido }}>Sonido</span> : null}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-col gap-1.5">
          <Carril nombre="Secuencias" tramos={p.secuencias} actual={pos.secuencia} d={d} alIr={alIr} tono="tinta" />
          <Carril nombre="Escenas" tramos={p.escenas} actual={pos.escena} d={d} alIr={alIr} tono="azul" />
          {p.sonido.length ? <CarrilSonido sonido={p.sonido} actuales={pos.sonido} d={d} alIr={alIr} alto={altoSonido} /> : null}
        </div>
        {/* El cabezal cruza todos los carriles; debajo, la franja para recorrer arrastrando. */}
        <div ref={cabezal} aria-hidden className="pointer-events-none absolute -bottom-6 top-0 z-20 w-0" style={{ left: 0 }}>
          <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-rojo/75" />
          <span className="absolute bottom-[0.3rem] left-0 h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 border-cream-50 bg-rojo shadow-[0_1px_3px_rgb(0_0_0/0.3)]" />
        </div>
        <div
          ref={zona}
          aria-hidden
          className="relative mt-1.5 h-5 cursor-ew-resize touch-none select-none"
          onPointerDown={(e) => { arrastre.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const x = tiempoDe(e); setVista(x); alIr(x.t); }}
          onPointerMove={(e) => { const x = tiempoDe(e); setVista(x); if (arrastre.current) alIr(x.t); }}
          onPointerUp={() => { arrastre.current = false; }}
          onPointerLeave={() => { if (!arrastre.current) setVista(null); }}
          title="Arrastra para recorrer la película"
        >
          <div className="absolute inset-x-0 top-2 h-1 rounded-full bg-cream-200 shadow-[var(--hundido)]" />
          {vista ? (
            <span className="pointer-events-none absolute top-6 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[rgb(26_15_10/0.88)] px-2 py-1 text-[0.6875rem] text-cream-50 shadow-[0_4px_12px_rgb(0_0_0/0.25)]" style={{ left: vista.x }}>
              <span className="font-mono">{tiempoACadena(vista.t)}</span> {sobre(vista.t)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Las pistas del carril del sonido: cada sonido en la primera libre (si se solapan, se apilan). */
function pistasSonido(sonido: SonidoVista[]): number[] {
  const fin: number[] = [];
  return sonido.map((s) => { let k = fin.findIndex((f) => f <= s.t0); if (k < 0) { k = fin.length; fin.push(0); } fin[k] = s.t1; return k; });
}
const sonidoAlto = (sonido: SonidoVista[]) => `${Math.max(1, ...pistasSonido(sonido).map((k) => k + 1)) * 0.875 + 0.375}rem`;

/**
 * Un carril de tramos (secuencias, escenas o planos): cada tramo es un botón; el
 * actual se hunde en tinta. Con el teclado, el carril es un solo tabulador y las
 * flechas pasan de un tramo a otro (y el vídeo va con ellas).
 */
const Carril = memo(function Carril({ nombre, tramos, actual, d, desde = 0, alIr, tono, alto = 'h-7', rotulos }: {
  nombre: string; tramos: TramoPelicula[]; actual: number; d: number;
  /** El segundo que cae en el borde izquierdo (los planos de una escena empiezan en ella). */
  desde?: number;
  alIr: (t: number) => void; tono: 'tinta' | 'azul'; alto?: string;
  /** Texto dentro de cada tramo si cabe (los planos: su escala). */
  rotulos?: (t: TramoPelicula, i: number) => string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enfocable = actual >= 0 ? actual : 0;
  const tecla = (e: KeyboardEvent, i: number) => {
    const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tramos.length - 1 : -2;
    if (j === -2) return;
    e.preventDefault();
    const k = Math.max(0, Math.min(tramos.length - 1, j));
    refs.current[k]?.focus();
    alIr(tramos[k]!.t0);
  };
  return (
    <div role="group" aria-label={`${nombre} (las flechas pasan de uno a otro)`} className={cx('carril-pelicula relative overflow-hidden rounded-lg bg-cream-100 shadow-[var(--hundido)]', alto)}>
      {tramos.map((t, i) => {
        const activo = i === actual;
        const texto = rotulos?.(t, i) ?? t.titulo;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            tabIndex={i === enfocable ? 0 : -1}
            onClick={() => alIr(t.t0)}
            onKeyDown={(e) => tecla(e, i)}
            aria-current={activo ? 'true' : undefined}
            aria-label={`${t.titulo}, ${tiempoACadena(t.t0)}-${tiempoACadena(t.t1)}`}
            title={`${t.titulo} (${tiempoACadena(t.t0)}-${tiempoACadena(t.t1)})`}
            className={cx(
              'absolute inset-y-0.5 overflow-hidden rounded-[5px] border px-1 text-left text-[0.625rem] font-medium transition-[background,color,box-shadow]',
              activo
                ? (tono === 'azul' ? 'z-10 border-[#1d3557] bg-azul text-cream-50 shadow-[0_2px_6px_rgb(43_76_126/0.35)]' : 'z-10 border-[#1a0f0a] bg-coffee-800 text-cream-50 shadow-[0_2px_6px_rgb(44_24_16/0.35)]')
                : 'border-cream-400 bg-cream-50 text-coffee-600 hover:bg-cream-200 hover:text-coffee-800',
            )}
            style={{ left: pct(t.t0 - desde, d), width: `max(3px, calc(${pct(t.t1 - t.t0, d)} - 1px))` }}
          >
            <span className="block truncate">{texto}</span>
          </button>
        );
      })}
    </div>
  );
});

/** El carril del sonido: música, canciones y ruidos con nombre, apilados si se solapan. */
function CarrilSonido({ sonido, actuales, d, alIr, alto }: { sonido: SonidoVista[]; actuales: number[]; d: number; alIr: (t: number) => void; alto: string }) {
  const pistas = useMemo(() => pistasSonido(sonido), [sonido]);
  return (
    <div role="group" aria-label="Sonido" className="carril-pelicula relative overflow-hidden rounded-lg bg-cream-100 shadow-[var(--hundido)]" style={{ height: alto }}>
      {sonido.map((s, i) => {
        const activo = actuales.includes(i);
        return (
          <button key={s.id} type="button" onClick={() => alIr(s.t0)} aria-current={activo ? 'true' : undefined}
            aria-label={`${s.forma ?? s.nombre}, ${tiempoACadena(s.t0)}-${tiempoACadena(s.t1)}`} title={`${s.forma ?? s.nombre} (${tiempoACadena(s.t0)}-${tiempoACadena(s.t1)})`}
            className={cx('absolute h-3 overflow-hidden rounded-full border px-1.5 text-left text-[0.5625rem] font-semibold leading-[0.6875rem]', activo ? 'border-[#9a6b12] bg-amarillo text-coffee-900' : 'border-cream-400 bg-amarillo-suave text-coffee-700 hover:bg-amarillo/60')}
            style={{ left: pct(s.t0, d), width: `max(6px, ${pct(s.t1 - s.t0, d)})`, top: `${0.1875 + pistas[i]! * 0.875}rem` }}>
            <span className="block truncate">{s.nombre}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Los planos de la escena en curso, a lo ancho: cada uno con su escala abreviada. */
function PlanosDeEscena({ p, escena, pos, alIr }: { p: Pelicula; escena: TramoPelicula; pos: Posicion; alIr: (t: number) => void }) {
  const planos = useMemo(() => p.planos.filter((x) => x.escena === escena.id), [p, escena.id]);
  const cabezal = useRef<HTMLDivElement>(null);
  const span = Math.max(1, escena.t1 - escena.t0);
  useEffect(() => motor().escucharTiempo((t) => {
    if (!cabezal.current) return;
    const dentro = t >= escena.t0 && t < escena.t1;
    cabezal.current.style.opacity = dentro ? '1' : '0';
    cabezal.current.style.left = pct(t - escena.t0, span);
  }), [escena.t0, escena.t1, span]);
  if (!planos.length) return null;
  const actual = planos.findIndex((x) => x.id === p.planos[pos.plano]?.id);
  return (
    <div className="mt-3 border-t border-cream-200 pt-3">
      <p className="flex items-baseline gap-2 text-[0.8125rem]">
        <span className="font-semibold text-coffee-800">{escena.titulo}</span>
        <span className="font-mono text-[0.75rem] text-apagado">{tiempoACadena(escena.t0)}-{tiempoACadena(escena.t1)}</span>
        <span className="ml-auto text-[0.75rem] text-apagado">{planos.length} {planos.length === 1 ? 'plano' : 'planos'}</span>
      </p>
      <div className="mt-2 flex gap-2">
        <span aria-hidden className="flex h-9 w-[4.75rem] shrink-0 items-center justify-end text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-coffee-500 sm:w-24">Planos</span>
        <div className="relative min-w-0 flex-1">
          <Carril nombre="Planos de la escena" tramos={planos} actual={actual} d={span} desde={escena.t0} alIr={alIr} tono="tinta" alto="h-9" rotulos={(t) => ABREVIATURA[(t as PlanoVista).escala ?? ''] ?? (t as PlanoVista).escala ?? ''} />
          <div ref={cabezal} aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-rojo" style={{ left: 0, opacity: 0 }} />
        </div>
      </div>
    </div>
  );
}

/** Las escalas en corto, como en un guion técnico. */
const ABREVIATURA: Record<string, string> = {
  'gran plano general': 'GPG', 'plano general': 'PG', 'plano de conjunto': 'PC', 'plano entero': 'PE', 'plano americano': 'PA', 'plano medio': 'PM',
  'plano medio corto': 'PMC', 'primer plano': 'PP', 'primerísimo primer plano': 'PPP', 'plano detalle': 'PD', 'plano inserto': 'Inserto',
};

// ---------------------------------------------------------------------------
// El plano en curso
// ---------------------------------------------------------------------------

const COLOR_CLASE = { persona: 'rojo', objeto: 'amarillo' } as const;

/** El fotograma de un plano con quién y qué está en cuadro, cada uno en su región. */
export function FotogramaConRegiones({ documento, plano, className }: { documento: string; plano: PlanoVista; className?: string }) {
  const instante = plano.personas.find((x) => x.instante != null)?.instante ?? (plano.t0 + plano.t1) / 2;
  const f = useFotogramaEn(documento, instante);
  const vistos = enCuadro(plano);
  return (
    <div className={cx('rounded-xl bg-[rgb(26_15_10/0.9)] p-1.5 shadow-[var(--hundido)]', className)}>
      <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-[4px] bg-coffee-900">
        {f ? <img src={f.url} alt={`Fotograma de ${tiempoACadena(f.t)}: ${plano.titulo}`} className="absolute inset-0 h-full w-full object-cover" /> : (
          <span className="absolute inset-0 grid place-items-center font-mono text-[0.8125rem] text-cream-300">{tiempoACadena(instante)}</span>
        )}
        {vistos.map((v, i) => <RecuadroMano key={`${plano.id}-${i}`} region={v.region} clave={`${plano.id}|${v.nombre}`} tinta={COLOR_CLASE[v.clase]} rotulo={v.nombre} etiqueta={`${v.nombre}, en cuadro`} />)}
      </div>
    </div>
  );
}

const TarjetaPlano = memo(function TarjetaPlano({ plano, documento, indice, total, alIr }: { plano: PlanoVista; documento: string; indice: number; total: number; alIr: (t: number) => void }) {
  const filas: Array<[string, string | undefined]> = [
    ['Escala', plano.escala], ['Angulación', plano.angulacion], ['Movimiento', plano.movimiento === 'fija' ? 'cámara fija' : plano.movimiento],
    ['Composición', plano.composicion], ['Luz', plano.luz], ['Color', plano.color], ['Texto en pantalla', plano.textoEnPantalla ? `«${plano.textoEnPantalla}»` : undefined],
  ];
  return (
    <article aria-label="El plano en curso" aria-live="polite" className="rounded-2xl border border-cream-400 bg-cream-50 p-4 shadow-[var(--levantado)]">
      <div className="flex items-center gap-2">
        <Rotulo>Plano {numero(indice + 1)} de {numero(total)}</Rotulo>
        <span className="text-[0.75rem] text-apagado">{duracionPlano(plano.t0, plano.t1)}</span>
        <button type="button" onClick={() => alIr(plano.t0)} className="ml-auto" aria-label={`Ir al principio del plano, ${tiempoACadena(plano.t0)}`}><Folio>{tiempoACadena(plano.t0)}-{tiempoACadena(plano.t1)}</Folio></button>
      </div>
      <h3 className="mt-1 text-[1rem] font-semibold text-coffee-800">{rasgosPlano(plano) || plano.titulo}</h3>
      {plano.resumen ? <p className="mt-0.5 text-[0.875rem] text-coffee-700">{plano.resumen}</p> : null}
      <FotogramaConRegiones documento={documento} plano={plano} className="mt-3" />
      {plano.personas.length || plano.objetos.length ? (
        <div className="mt-3">
          <p className="text-[0.75rem] font-semibold text-coffee-500">En cuadro</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {plano.personas.map((x) => <li key={`p-${x.nombre}`} className="inline-flex items-center gap-1.5 rounded-lg border border-cream-400 bg-cream-50 px-2 py-0.5 text-[0.8125rem] text-coffee-800 shadow-[var(--relieve)]"><span aria-hidden className="h-2 w-2 rounded-full bg-rojo" />{x.nombre}{x.nota ? <span className="text-coffee-500">, {x.nota}</span> : null}</li>)}
            {plano.objetos.map((x) => <li key={`o-${x.nombre}`} className="inline-flex items-center gap-1.5 rounded-lg border border-cream-400 bg-cream-50 px-2 py-0.5 text-[0.8125rem] text-coffee-800 shadow-[var(--relieve)]"><span aria-hidden className="h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-amarillo" />{x.nombre}</li>)}
          </ul>
        </div>
      ) : null}
      <dl className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        {filas.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold text-coffee-500">{k}</dt><dd className="text-coffee-800">{v}</dd></div>)}
      </dl>
    </article>
  );
});

// ---------------------------------------------------------------------------
// Sobre el escenario del reproductor
// ---------------------------------------------------------------------------

/** Quién está en cuadro en el instante, rodeado sobre el vídeo (en el escenario del reproductor). */
export function EnCuadroSobreVideo({ doc }: { doc: Pick<DetalleDocumento, 'id' | 'duracion' | 'tipo'> }) {
  const { pelicula } = usePelicula(doc);
  const pos = usePosicion(pelicula, doc.id);
  const plano = pelicula?.planos[pos.plano];
  const vistos = enCuadro(plano);
  if (!plano || !vistos.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0" aria-label={`En cuadro: ${vistos.map((v) => v.nombre).join(', ')}`} role="img">
      {vistos.map((v, i) => <RecuadroMano key={`${plano.id}-${i}`} region={v.region} clave={`${plano.id}|${v.nombre}`} tinta={COLOR_CLASE[v.clase]} rotulo={v.nombre} etiqueta={v.nombre} />)}
    </div>
  );
}

