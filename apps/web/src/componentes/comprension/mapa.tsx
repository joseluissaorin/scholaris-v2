/**
 * El mapa de un documento: el árbol de su estructura con un resumen de una línea
 * por parte, la ficha de cada segmento al elegirlo y la ficha global (sinopsis,
 * análisis, sentido o tesis, temas y motivos con cada una de sus apariciones, y
 * lo que la lente anota). Todo lo citado abre el lector en su sitio exacto.
 */
import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { AnclaMaterial, Evidencia, Ficha, Segmento } from '@scholaris/nucleo';
import type { AparicionVista } from '@scholaris/contrato';
import { cx, Esqueleto, Folio, Icono, Rotulo } from '@scholaris/ui';
import { qc } from '../../datos/comprension';
import {
  arbolDeSegmentos, datoTexto, etiquetaAncla, NOMBRE_LENTE, NOMBRE_SEGMENTO, resumenDe, temasDeFicha, type NodoSegmento, type TemaFicha,
} from '../../lib/comprension';
import { enlaceAncla, VistaAncla } from './material';

// ---------------------------------------------------------------------------
// La estructura
// ---------------------------------------------------------------------------

/**
 * El árbol de la estructura: cada parte con su tipo, su título, su resumen y su
 * folio (que abre el lector ahí). Los niveles se abren y se cierran; el segmento
 * elegido se marca y enseña su ficha debajo.
 */
export function ArbolEstructura({ documento, segmentos, actual, elegido, alElegir, alIr, compacto, className }: {
  documento: string;
  segmentos: readonly Segmento[];
  /** El segmento por donde va la lectura o el reproductor. */
  actual?: string | null;
  elegido?: string | null;
  alElegir?: (s: Segmento | null) => void;
  /** En el lector: ir al segmento sin salir (si no, el folio enlaza al lector). */
  alIr?: (s: Segmento) => void;
  compacto?: boolean;
  className?: string;
}) {
  const arbol = useMemo(() => arbolDeSegmentos(segmentos), [segmentos]);
  // Las ramas que contienen el segmento actual o el elegido, abiertas.
  const camino = useMemo(() => {
    const porId = new Map(segmentos.map((s) => [s.id, s]));
    const abiertos = new Set<string>();
    for (const id of [actual, elegido]) for (let s = id ? porId.get(id) : undefined; s?.padre; s = porId.get(s.padre)) abiertos.add(s.padre);
    return abiertos;
  }, [segmentos, actual, elegido]);
  if (!arbol.length) return null;
  return (
    <ol className={cx('flex flex-col', className)} aria-label="Estructura del documento">
      {arbol.map((n) => <Rama key={n.s.id} n={n} documento={documento} actual={actual} elegido={elegido} alElegir={alElegir} alIr={alIr} compacto={compacto} abiertos={camino} abiertaDeInicio={arbol.length <= 12} />)}
    </ol>
  );
}

const Rama = memo(function Rama({ n, documento, actual, elegido, alElegir, alIr, compacto, abiertos, abiertaDeInicio }: {
  n: NodoSegmento; documento: string; actual?: string | null | undefined; elegido?: string | null | undefined; alElegir?: ((s: Segmento | null) => void) | undefined;
  alIr?: ((s: Segmento) => void) | undefined;
  compacto?: boolean | undefined; abiertos: Set<string>; abiertaDeInicio: boolean;
}) {
  const [abierta, setAbierta] = useState(abiertaDeInicio && n.profundidad === 0);
  const id = useId();
  const s = n.s;
  const verHijos = (abierta || abiertos.has(s.id)) && n.hijos.length > 0;
  const esActual = actual === s.id, esElegido = elegido === s.id;
  const resumen = resumenDe(s);
  return (
    <li>
      <div className={cx('group relative flex items-start gap-1 rounded-xl py-1.5 pr-2 transition-colors', esElegido ? 'bg-cream-50 shadow-[var(--relieve)] ring-1 ring-cream-400' : 'hover:bg-cream-200/70', n.profundidad && 'ml-4')}>
        {n.hijos.length ? (
          <button type="button" onClick={() => setAbierta((x) => !(x || abiertos.has(s.id)))} aria-expanded={verHijos} aria-controls={id}
            aria-label={`${verHijos ? 'Cerrar' : 'Abrir'} ${s.titulo}`} className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-coffee-500 hover:bg-cream-300 hover:text-coffee-800">
            <Icono nombre="abajo" tam={14} className={cx('transition-transform', !verHijos && '-rotate-90')} />
          </button>
        ) : <span className="w-7 shrink-0" aria-hidden />}
        <button type="button" onClick={() => alElegir?.(esElegido ? null : s)} aria-pressed={esElegido} className="min-w-0 flex-1 text-left">
          <span className="flex items-baseline gap-2">
            <span className="shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-coffee-400">{NOMBRE_SEGMENTO[s.tipo][0]}</span>
            <span className={cx('min-w-0 font-medium text-coffee-800', n.profundidad ? 'text-[0.875rem]' : 'text-[0.9375rem]')}>
              {esActual ? <span aria-label="aquí" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rojo align-middle" /> : null}{s.titulo}
            </span>
          </span>
          {resumen && !compacto ? <span className="mt-0.5 block text-[0.8125rem] leading-snug text-coffee-600">{resumen}</span> : null}
        </button>
        {alIr ? (
          <button type="button" onClick={() => alIr(s)} className="mt-0.5 shrink-0 rounded-md opacity-90 hover:opacity-100" aria-label={`Ir a ${s.titulo} (${etiquetaAncla(s.ancla, s.anclaFin)})`}>
            <Folio>{etiquetaAncla(s.ancla, s.anclaFin)}</Folio>
          </button>
        ) : (
          <Link {...enlaceAncla(documento, s.ancla)} className="mt-0.5 shrink-0 rounded-md opacity-90 hover:opacity-100" aria-label={`Abrir ${s.titulo} en el lector (${etiquetaAncla(s.ancla, s.anclaFin)})`}>
            <Folio>{etiquetaAncla(s.ancla, s.anclaFin)}</Folio>
          </Link>
        )}
      </div>
      {verHijos ? (
        <ol id={id} className="flex flex-col">
          {n.hijos.map((h) => <Rama key={h.s.id} n={h} documento={documento} actual={actual} elegido={elegido} alElegir={alElegir} alIr={alIr} compacto={compacto} abiertos={abiertos} abiertaDeInicio={false} />)}
        </ol>
      ) : null}
    </li>
  );
});

// ---------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------

/** La ficha de un segmento: la prosa del análisis, lo que anota la lente y sus pruebas. */
export function FichaSegmento({ documento, segmento, className, alIr }: { documento: string; segmento: Segmento; className?: string; alIr?: (a: AnclaMaterial) => void }) {
  const { data: fichas, isPending } = useQuery(qc.fichasDe(documento, { segmento: segmento.id }));
  const f = fichas?.[0];
  return (
    <article aria-label={`Ficha de ${segmento.titulo}`} className={cx('rounded-2xl border border-cream-400 bg-cream-50 p-4 shadow-[var(--levantado)] anim-sube', className)}>
      <div className="flex items-baseline gap-2">
        <Rotulo>{NOMBRE_SEGMENTO[segmento.tipo][0]}</Rotulo>
        {f ? <span className="text-[0.75rem] text-apagado">lente {NOMBRE_LENTE[f.lente].toLocaleLowerCase('es')}</span> : null}
        <Link {...enlaceAncla(documento, segmento.ancla)} className="ml-auto"><Folio>{etiquetaAncla(segmento.ancla, segmento.anclaFin)}</Folio></Link>
      </div>
      <h3 className="mt-1 text-[1.0625rem] font-semibold leading-snug text-coffee-800">{segmento.titulo}</h3>
      {isPending ? <div className="mt-3 flex flex-col gap-2"><Esqueleto className="h-3" /><Esqueleto className="h-3 w-4/5" /><Esqueleto className="h-3 w-2/3" /></div>
        : !f ? <p className="mt-2 text-[0.875rem] text-coffee-600">{resumenDe(segmento) ?? 'Este segmento no tiene ficha propia.'}</p>
        : (
          <>
            <p className="lectura mt-2 text-[0.9375rem] leading-relaxed text-coffee-800">{f.texto}</p>
            <DatosFicha datos={f.datos} className="mt-3" />
            {f.evidencias.length ? <Pruebas evidencias={f.evidencias} className="mt-4" {...(alIr ? { alIr } : {})} /> : null}
            <PieFicha f={f} />
          </>
        )}
    </article>
  );
}

function PieFicha({ f }: { f: Ficha }) {
  const sinVerificar = Number(f.datos.citasNoVerificadas ?? 0);
  return (
    <p className="mt-3 border-t border-cream-200 pt-2 text-[0.6875rem] text-apagado">
      Escrita por <span className="dato">{f.modelo}</span> ({f.version}){sinVerificar ? `. Se descartaron ${sinVerificar} ${sinVerificar === 1 ? 'cita que no estaba' : 'citas que no estaban'} en el texto` : ''}.
    </p>
  );
}

const ETIQUETAS: Record<string, string> = {
  lugar: 'Lugar', tiempo: 'Tiempo', accion: 'Acción', escalas: 'Escalas de plano', angulacion: 'Angulación', movimiento: 'Movimiento de cámara',
  composicion: 'Composición', luzColor: 'Luz y color', luz: 'Luz', color: 'Color', montaje: 'Montaje', textoEnPantalla: 'Texto en pantalla', funcionNarrativa: 'Función narrativa',
  acontecimientos: 'Acontecimientos', espacio: 'Espacio', tiempoHistoria: 'Tiempo de la historia', orden: 'Orden', duracion: 'Duración', frecuencia: 'Frecuencia',
  narrador: 'Narrador', focalizacion: 'Focalización', discurso: 'Discurso', motivos: 'Motivos', funcionTrama: 'Función en la trama', estructura: 'Estructura',
  narracion: 'Narración', puestaEnEscena: 'Puesta en escena', fotografia: 'Fotografía', sonidoMusica: 'Sonido y música', adaptacion: 'Adaptación', sentido: 'Sentido',
  ordenRelato: 'Orden del relato', espacios: 'Espacios', estilo: 'Estilo', intertextos: 'Intertextos', tesis: 'Tesis', personajes: 'Personajes', dialogoClave: 'Diálogo clave',
  sonido: 'Sonido', objetosSimbolos: 'Objetos y símbolos', fabula: 'La historia en su orden', metrica: 'Métrica', rima: 'Rima', figuras: 'Figuras', yoLirico: 'Yo lírico',
  argumentos: 'Argumentos', metodo: 'Método', resultados: 'Resultados', limitaciones: 'Limitaciones', conserva: 'Conserva', cambia: 'Cambia', anade: 'Añade', suprime: 'Suprime',
  actor: 'Intérprete', papel: 'Papel', arco: 'Arco',
};
/** Lo que no se enseña como dato: lo interno y lo que ya sale en otro sitio. */
const OCULTOS = new Set(['resumen', 'titulo', 'huellaEntrada', 'transcripcion', 'percibido', 'citasNoVerificadas', 'temas', 'motivos', 'contexto', 'sinopsis', 'fuente', 'percepcion', 'personas', 'objetos', 'tesis', 'sentido']);

const etiquetaDe = (k: string) => ETIQUETAS[k] ?? (k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase()));
const cadenas = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

function valorDato(k: string, v: unknown): ReactNode {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (!v) return null;
  if (k === 'personajes' && Array.isArray(v)) {
    const xs = v.filter((x) => x && typeof x === 'object' && (x as { nombre?: string }).nombre) as Array<{ nombre: string; papel?: string; actor?: string; arco?: string }>;
    return xs.length ? <ul className="flex flex-col gap-0.5">{xs.map((x) => <li key={x.nombre}><span className="font-medium text-coffee-800">{x.nombre}</span>{x.actor ? <span className="text-apagado"> ({x.actor})</span> : null}{x.papel ? `: ${x.papel}` : ''}{x.arco ? <span className="text-coffee-600">; {x.arco}</span> : null}</li>)}</ul> : null;
  }
  if (k === 'dialogoClave' && Array.isArray(v)) {
    const xs = v as Array<{ hablante?: string; texto?: string }>;
    return xs.filter((x) => x?.texto).map((x, i) => <span key={i} className="block">{x.hablante ? <span className="font-medium">{x.hablante}: </span> : null}<span className="lectura">«{x.texto}»</span></span>);
  }
  if (k === 'sonido' && typeof v === 'object' && !Array.isArray(v)) {
    const s = v as { diegetico?: unknown; extradiegetico?: unknown; musica?: unknown; silencio?: unknown };
    const filas: Array<[string, string]> = [['Dentro de la historia', cadenas(s.diegetico).join(', ')], ['Fuera de la historia', cadenas(s.extradiegetico).join(', ')], ['Música', cadenas(s.musica).join(', ')], ['Silencio', typeof s.silencio === 'string' ? s.silencio : '']];
    const hay = filas.filter(([, x]) => x);
    return hay.length ? hay.map(([e, x]) => <span key={e} className="block"><span className="text-apagado">{e}: </span>{x}</span>) : null;
  }
  if (k === 'objetosSimbolos' && Array.isArray(v)) {
    const xs = (v as Array<{ objeto?: string; sentido?: string }>).filter((x) => x?.objeto);
    return xs.length ? xs.map((x, i) => <span key={i} className="block"><span className="font-medium">{x.objeto}</span>{x.sentido ? `: ${x.sentido}` : ''}</span>) : null;
  }
  if (k === 'fabula' && Array.isArray(v)) {
    const xs = (v as Array<{ acontecimiento?: string }>).filter((x) => x?.acontecimiento);
    return xs.length ? <ol className="list-decimal pl-5">{xs.map((x, i) => <li key={i}>{x.acontecimiento}</li>)}</ol> : null;
  }
  const lista = cadenas(v);
  if (lista.length) return lista.length > 3 ? <ul className="flex flex-col">{lista.map((x, i) => <li key={i} className="before:mr-1.5 before:text-apagado before:content-['—']">{x}</li>)}</ul> : lista.join(' · ');
  return null;
}

/** Los campos de la lente, en una lista de definiciones: «Focalización: interna fija». */
export function DatosFicha({ datos, className, solo }: { datos: Record<string, unknown>; className?: string; solo?: string[] }) {
  const filas = Object.entries(datos).filter(([k]) => (solo ? solo.includes(k) : !OCULTOS.has(k))).map(([k, v]) => [k, valorDato(k, v)] as const).filter(([, v]) => v != null && v !== '');
  if (!filas.length) return null;
  return (
    <dl className={cx('grid grid-cols-1 gap-x-4 gap-y-2 text-[0.8125rem] sm:grid-cols-[9.5rem_minmax(0,1fr)]', className)}>
      {filas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-coffee-500">{etiquetaDe(k)}</dt>
          <dd className="min-w-0 text-coffee-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Las pruebas de una ficha: cada una con su recorte o su texto y su folio, que abre el lector. */
export function Pruebas({ evidencias, className, max = 6, alIr }: { evidencias: Evidencia[]; className?: string; max?: number; alIr?: (a: AnclaMaterial) => void }) {
  const [todas, setTodas] = useState(false);
  const lista = todas ? evidencias : evidencias.slice(0, max);
  return (
    <section aria-label="Pruebas" className={className}>
      <Rotulo>Pruebas</Rotulo>
      <ul className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {lista.map((e, i) => <TarjetaEvidencia key={i} e={e} {...(alIr ? { alIr } : {})} />)}
      </ul>
      {evidencias.length > max ? (
        <button type="button" onClick={() => setTodas((x) => !x)} className="mt-2 text-[0.8125rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">
          {todas ? 'Ver menos' : `Ver las ${evidencias.length} pruebas`}
        </button>
      ) : null}
    </section>
  );
}

/** Una prueba en pequeño: el material (recorte o palabras) y su folio; pulsarla abre el lector en su sitio. */
export const TarjetaEvidencia = memo(function TarjetaEvidencia({ e, alIr }: { e: Evidencia; alIr?: (a: AnclaMaterial) => void }) {
  const etiqueta = etiquetaAncla(e.ancla, e.anclaFin);
  const cuerpo = (
    <>
      <VistaAncla documento={e.documento} ancla={e.ancla} {...(e.cita ? { cita: e.cita } : {})} palabras={e.modo !== 'video'} altoMax={8} />
      {e.modo === 'video' && e.cita ? <p className="mt-1.5 text-[0.75rem] leading-snug text-coffee-600"><span className="sr-only">Lo que se ve: </span>{e.cita}</p> : null}
      <span className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-coffee-500">
        <Icono nombre={e.modo === 'video' ? 'video' : e.modo === 'audio' ? 'audio' : e.modo === 'imagen' ? 'imagen' : 'documento'} tam={12} className="text-coffee-400" />
        <Folio className="ml-auto">{etiqueta}</Folio>
      </span>
    </>
  );
  const clase = 'levanta block w-full rounded-xl border border-cream-400 bg-cream-50 p-2.5 text-left shadow-[var(--levantado)]';
  return (
    <li>
      {alIr ? <button type="button" onClick={() => alIr(e.ancla)} className={clase} aria-label={`Ir a la prueba (${etiqueta})`}>{cuerpo}</button>
        : <Link {...enlaceAncla(e.documento, e.ancla)} className={clase} aria-label={`Abrir la prueba en el lector (${etiqueta})`}>{cuerpo}</Link>}
    </li>
  );
});

// ---------------------------------------------------------------------------
// La ficha global
// ---------------------------------------------------------------------------

/** Las apariciones de un tema o de un motivo como folios que abren el lector en cada una. */
export function ChipsApariciones({ apariciones, max = 10, alIr }: { apariciones: AparicionVista[]; max?: number; alIr?: (a: AparicionVista) => void }) {
  const [todas, setTodas] = useState(false);
  // Varias apariciones en el mismo tramo (dos palabras de un parlamento) son un solo folio.
  const unicas = useMemo(() => { const vistas = new Set<string>(); return apariciones.filter((a) => { const k = `${a.documento}|${etiquetaAncla(a.ancla, a.anclaFin)}`; if (vistas.has(k)) return false; vistas.add(k); return true; }); }, [apariciones]);
  if (!unicas.length) return <p className="text-[0.75rem] text-apagado">Sin apariciones ancladas.</p>;
  const lista = todas ? unicas : unicas.slice(0, max);
  const clase = 'tactil inline-flex h-7 items-center rounded-md border border-cream-400 bg-cream-50 px-1.5 font-mono text-[0.6875rem] text-coffee-700 shadow-[var(--relieve)] hover:-translate-y-px hover:border-cream-500';
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Apariciones">
      {lista.map((a) => (
        <li key={a.id}>
          {alIr ? <button type="button" onClick={() => alIr(a)} title={a.forma} className={clase}>{etiquetaAncla(a.ancla, a.anclaFin)}</button>
            : <Link {...enlaceAncla(a.documento, a.ancla)} title={a.forma} aria-label={`${a.forma}, ${etiquetaAncla(a.ancla, a.anclaFin)}`} className={clase}>{etiquetaAncla(a.ancla, a.anclaFin)}</Link>}
        </li>
      ))}
      {unicas.length > max ? (
        <li><button type="button" onClick={() => setTodas((x) => !x)} className="h-7 px-1.5 text-[0.75rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">{todas ? 'menos' : `y ${unicas.length - max} más`}</button></li>
      ) : null}
    </ul>
  );
}

function ListaTemas({ titulo, temas, forma }: { titulo: string; temas: TemaFicha[]; forma: 'circulo' | 'triangulo' }) {
  if (!temas.length) return null;
  return (
    <section aria-label={titulo}>
      <h3 className="flex items-center gap-2 text-[0.9375rem] font-semibold text-coffee-800">
        <span aria-hidden className={forma === 'circulo' ? 'h-2.5 w-2.5 rounded-full bg-azul' : 'h-0 w-0 border-x-[6px] border-b-[10px] border-x-transparent border-b-amarillo'} />
        {titulo}
      </h3>
      <ul className="mt-2 flex flex-col gap-3">
        {temas.map((t) => (
          <li key={t.nombre} className="rounded-xl border border-cream-300 bg-cream-50/70 p-3">
            <p className="text-[0.875rem]"><span className="font-semibold text-coffee-800">{t.nombre}</span>{t.descripcion ? <span className="text-coffee-600">. {t.descripcion.replace(/^./, (c) => c.toLocaleUpperCase('es'))}</span> : null}</p>
            <div className="mt-2"><ChipsApariciones apariciones={t.apariciones} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * La ficha global de la obra: lo esencial en una frase, la sinopsis, el sentido
 * o la tesis, los temas y los motivos con todas sus apariciones, el análisis
 * entero (plegado si es largo), lo que anota la lente, el contexto (lo de fuera
 * de la obra, marcado) y las pruebas.
 */
export function FichaGlobal({ ficha, apariciones, className }: { ficha: Ficha; apariciones: AparicionVista[]; className?: string }) {
  const [entera, setEntera] = useState(false);
  const temas = useMemo(() => temasDeFicha(ficha, 'temas', apariciones), [ficha, apariciones]);
  const motivos = useMemo(() => temasDeFicha(ficha, 'motivos', apariciones), [ficha, apariciones]);
  const esencial = (ficha.datos.resumen as { es?: string } | undefined)?.es;
  const sinopsis = datoTexto(ficha, 'sinopsis');
  const tesis = datoTexto(ficha, 'tesis');
  const sentido = datoTexto(ficha, 'sentido');
  const contexto = Array.isArray(ficha.datos.contexto) ? (ficha.datos.contexto as Array<{ dato?: string; externo?: boolean }>).filter((c) => c?.dato) : [];
  const largo = ficha.texto.length > 900;
  return (
    <article aria-label="Ficha global" className={cx('flex flex-col gap-6', className)}>
      {esencial ? <p className="max-w-[68ch] text-[1.0625rem] leading-relaxed text-coffee-800">{esencial}</p> : null}
      {sinopsis ? (
        <section aria-label="Sinopsis">
          <h3 className="text-[0.9375rem] font-semibold text-coffee-800">Sinopsis</h3>
          <p className="lectura mt-1.5 max-w-[68ch] text-[0.9375rem] leading-relaxed text-coffee-800">{sinopsis}</p>
        </section>
      ) : null}
      {tesis || sentido ? (
        <section aria-label={tesis ? 'Tesis' : 'Sentido'} className="max-w-[68ch] rounded-xl border border-cream-400 bg-cream-100/70 px-4 py-3 shadow-[var(--hundido)]">
          <h3 className="text-[0.8125rem] font-semibold text-coffee-600">{tesis ? 'Tesis' : 'Sentido de la obra'}</h3>
          <p className="mt-0.5 text-[0.9375rem] text-coffee-800">{tesis ?? sentido}</p>
        </section>
      ) : null}
      {temas.length || motivos.length ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ListaTemas titulo="Temas" temas={temas} forma="circulo" />
          <ListaTemas titulo="Motivos" temas={motivos} forma="triangulo" />
        </div>
      ) : null}
      {ficha.texto ? (
        <section aria-label="Análisis">
          <h3 className="text-[0.9375rem] font-semibold text-coffee-800">Análisis</h3>
          <div className={cx('lectura mt-1.5 max-w-[68ch] whitespace-pre-line text-[0.9375rem] leading-relaxed text-coffee-800', largo && !entera && 'line-clamp-[9]')}>{ficha.texto}</div>
          {largo ? <button type="button" aria-expanded={entera} onClick={() => setEntera((x) => !x)} className="mt-1 text-[0.8125rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800">{entera ? 'Plegar el análisis' : 'Leer el análisis entero'}</button> : null}
        </section>
      ) : null}
      <DatosFicha datos={ficha.datos} />
      {contexto.length ? (
        <section aria-label="Contexto">
          <h3 className="text-[0.9375rem] font-semibold text-coffee-800">Contexto</h3>
          <ul className="mt-1.5 flex flex-col gap-1 text-[0.875rem] text-coffee-700">
            {contexto.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2">
                {c.externo ? <span className="shrink-0 rounded-md border border-dashed border-coffee-400 px-1.5 text-[0.6875rem] font-semibold text-coffee-600" title="No sale del documento">fuera de la obra</span> : null}
                <span>{c.dato}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {ficha.evidencias.length ? <Pruebas evidencias={ficha.evidencias} /> : null}
      <PieFicha f={ficha} />
    </article>
  );
}
