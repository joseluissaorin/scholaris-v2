/**
 * Las alineaciones entre dos obras relacionadas (escena ↔ pasaje, párrafo
 * traducido ↔ original): la forma de cada tipo de correspondencia, la fila de
 * cada alineación con sus dos anclas y su nota, y el visor de cada lado (el
 * vídeo en su tramo, o la página con la región rodeada y los caracteres
 * subrayados).
 */
import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import type { Alineacion, Evidencia, Ficha, LadoAlineacion, Segmento, TipoCorrespondencia } from '@scholaris/nucleo';
import type { DetalleDocumento } from '@scholaris/contrato';
import { cx, Folio, Icono } from '@scholaris/ui';
import {
  cambiosDeFicha, cambiosPorAspecto, etiquetaAncla, etiquetaLado, FORMA_CORRESPONDENCIA, NOMBRE_ASPECTO, NOMBRE_CAMBIO_PERSONAJE, NOMBRE_CORRESPONDENCIA, personajesDeFicha, SENTIDO_CORRESPONDENCIA, tramoDe,
} from '../../lib/comprension';
import { enlaceAncla, PaginaConRegion, PalabrasDelTramo } from './material';
import { EscenarioCompacto } from './escenario';

const COLOR = { azul: 'var(--s-azul)', amarillo: 'var(--s-amarillo)', rojo: 'var(--s-rojo)', tinta: 'var(--s-coffee-800)' };

/** La forma de un tipo de correspondencia: círculo, triángulo o cuadrado, lleno o hueco. */
export function FormaCorrespondencia({ tipo, tam = 12, className }: { tipo: TipoCorrespondencia; tam?: number; className?: string }) {
  const f = FORMA_CORRESPONDENCIA[tipo];
  const c = COLOR[f.color];
  const relleno = f.hueca ? 'none' : c;
  return (
    <svg viewBox="0 0 20 20" width={tam} height={tam} className={cx('shrink-0', className)} aria-hidden>
      {f.forma === 'circulo' ? <circle cx="10" cy="10" r="8" fill={relleno} stroke={c} strokeWidth="2.4" /> : null}
      {f.forma === 'triangulo' ? <path d="M10 2.5 18 17.5H2z" fill={relleno} stroke={c} strokeWidth="2.2" strokeLinejoin="round" /> : null}
      {f.forma === 'cuadrado' ? <rect x="3" y="3" width="14" height="14" fill={relleno} stroke={c} strokeWidth="2.4" /> : null}
    </svg>
  );
}

/** El título del segmento de un lado («La terraza de El Mirlo»), si se conoce. */
const tituloLado = (l: LadoAlineacion | undefined, segmentos: Map<string, Segmento>) => (l?.segmento ? segmentos.get(l.segmento)?.titulo : undefined);

/**
 * Una alineación en una fila: el lado izquierdo, el tipo y la nota en el centro
 * y el lado derecho. Pulsar la fila la elige (los visores van con ella); cada
 * folio abre su obra en el lector, en el sitio exacto.
 */
export const FilaAlineacion = memo(function FilaAlineacion({ al, izq, der, segmentos, elegida, alElegir, numero }: {
  al: Alineacion;
  izq: string;
  der: string;
  segmentos: Map<string, Segmento>;
  elegida: boolean;
  alElegir: (id: string) => void;
  numero: number;
}) {
  const ladoDe = (doc: string) => (al.a?.documento === doc ? al.a : al.b?.documento === doc ? al.b : undefined);
  const a = ladoDe(izq), b = ladoDe(der);
  const celda = (l: LadoAlineacion | undefined, alinear: 'izq' | 'der') => (l ? (
    <div className={cx('flex min-w-0 flex-1 flex-col gap-0.5', alinear === 'der' ? 'items-end text-right' : 'items-start')}>
      <Link {...enlaceAncla(l.documento, l.ancla)} onClick={(e) => e.stopPropagation()} aria-label={`Abrir en el lector (${etiquetaLado(l)})`} className="rounded-md"><Folio>{etiquetaLado(l)}</Folio></Link>
      {tituloLado(l, segmentos) ? <span className="max-w-full truncate text-[0.75rem] text-coffee-600">{tituloLado(l, segmentos)}</span> : null}
    </div>
  ) : (
    <div className={cx('flex min-w-0 flex-1 flex-col', alinear === 'der' ? 'items-end text-right' : 'items-start')}>
      <span className="rounded-md border border-dashed border-cream-500 px-1.5 py-0.5 text-[0.6875rem] text-apagado">no está</span>
    </div>
  ));
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={elegida}
        aria-label={`Correspondencia ${numero}: ${NOMBRE_CORRESPONDENCIA[al.tipo].toLocaleLowerCase('es')}, ${etiquetaLado(a)} y ${etiquetaLado(b)}`}
        onClick={() => alElegir(al.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alElegir(al.id); } }}
        className={cx('cursor-pointer rounded-xl border p-3 text-left transition-[background,box-shadow,border-color]',
          elegida ? 'border-coffee-500 bg-cream-50 shadow-[var(--levantado)]' : 'border-cream-300 bg-cream-50/60 hover:border-cream-500 hover:bg-cream-50')}
      >
        {/* Arriba, las dos anclas unidas por el tipo de correspondencia; debajo, en qué cambia. */}
        <div className="flex items-start gap-2">
          {celda(a, 'izq')}
          <div className="flex shrink-0 flex-col items-center px-1 pt-0.5" title={SENTIDO_CORRESPONDENCIA[al.tipo]}>
            <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-coffee-800"><FormaCorrespondencia tipo={al.tipo} />{NOMBRE_CORRESPONDENCIA[al.tipo]}</span>
            <span className="text-[0.6875rem] text-apagado">{SENTIDO_CORRESPONDENCIA[al.tipo]}</span>
          </div>
          {celda(b, 'der')}
        </div>
        <p className={cx('mt-2 text-[0.8125rem] leading-snug text-coffee-700', !elegida && 'line-clamp-2')}>{al.nota}</p>
      </div>
    </li>
  );
});

/**
 * Un lado de la vista lado a lado: el vídeo en el tramo (con la región y las
 * palabras), la página con la región y los caracteres, o, si en esta obra no
 * está, lo que eso quiere decir.
 */
export function VisorLado({ doc, lado, tipo, otroTitulo, conMotor }: {
  doc: DetalleDocumento | undefined;
  lado: LadoAlineacion | undefined;
  tipo: TipoCorrespondencia | undefined;
  otroTitulo: string;
  /** Solo un lado puede llevar el reproductor (el motor es uno). */
  conMotor: boolean;
}) {
  if (!doc) return <span className="esqueleto block h-64 rounded-2xl" />;
  const medio = doc.tipo === 'video' || doc.tipo === 'audio';
  const tramo = lado ? tramoDe(lado) : null;
  return (
    <section aria-label={doc.metadatos.titulo} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-cream-400 bg-cream-50 p-3 shadow-[var(--levantado)] sm:p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold italic text-coffee-800">{doc.metadatos.titulo}</h2>
        {lado ? <Link {...enlaceAncla(doc.id, lado.ancla)} className="flex shrink-0 items-center gap-1 text-[0.75rem] font-medium text-coffee-600 underline decoration-cream-500 underline-offset-4 hover:text-coffee-800"><Icono nombre="lector" tam={13} />Abrir aquí</Link> : null}
      </div>
      {medio && conMotor ? (
        <EscenarioCompacto doc={doc} tramo={tramo} {...(lado?.ancla.region ? { region: lado.ancla.region } : {})} {...(lado?.ancla.tipo === 'tiempo' && lado.ancla.instante != null ? { instante: lado.ancla.instante } : {})} />
      ) : null}
      {!lado ? (
        <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-cream-500 bg-cream-100/60 p-4 text-center shadow-[var(--hundido)]">
          <p className="max-w-[30ch] text-[0.875rem] text-coffee-600">
            {tipo === 'anadido' || tipo === 'suprimido' ? <>Esto no está en <em>{doc.metadatos.titulo}</em>: solo en <em>{otroTitulo}</em>.</> : 'Sin pasaje en esta obra.'}
          </p>
        </div>
      ) : lado.ancla.tipo === 'tiempo' ? (
        <PalabrasDelTramo documento={doc.id} ancla={lado.ancla} vivo={conMotor} alrededor={30} />
      ) : (
        <PaginaConRegion documento={doc.id} ancla={lado.ancla} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// La ficha de la relación: qué cambia y qué pasa con cada personaje
// ---------------------------------------------------------------------------

/** Las pruebas de un cambio, como folios de cada obra que abren el lector (los índices apuntan a `ficha.evidencias`). */
function FoliosPruebas({ ficha, indices, obra }: { ficha: Ficha; indices: number[]; obra: string }) {
  const evs = indices.map((i) => ficha.evidencias[i]).filter((e): e is Evidencia => !!e);
  if (!evs.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-[0.6875rem] italic text-apagado">{obra}</span>
      {evs.map((e, k) => (
        <Link key={k} {...enlaceAncla(e.documento, e.ancla)} title={e.cita} aria-label={`${obra}, ${etiquetaAncla(e.ancla, e.anclaFin)}: ${e.cita ?? ''}`}
          className="inline-flex h-6 items-center rounded-md border border-cream-400 bg-cream-50 px-1.5 font-mono text-[0.6875rem] text-coffee-700 shadow-[var(--relieve)] hover:border-cream-500">
          {etiquetaAncla(e.ancla, e.anclaFin)}
        </Link>
      ))}
    </span>
  );
}

/**
 * Lo que cambia de una obra a otra, por aspectos (estructura, punto de vista,
 * personajes, tiempo, final…), cada afirmación con sus pruebas en las dos obras;
 * lo que no se pudo anclar va marcado como inferido. Debajo, los personajes.
 */
export function CambiosRelacion({ ficha, tituloA, tituloB, className }: { ficha: Ficha; tituloA: string; tituloB: string; className?: string }) {
  const grupos = cambiosPorAspecto(cambiosDeFicha(ficha));
  const personajes = personajesDeFicha(ficha);
  const modo = typeof ficha.datos.modo === 'string' ? ficha.datos.modo : '';
  if (!grupos.length && !personajes.length && !modo) return null;
  return (
    <div className={cx('flex flex-col gap-4', className)}>
      {modo ? <p className="max-w-[72ch] rounded-xl border border-cream-400 bg-cream-100/70 px-4 py-2.5 text-[0.9375rem] text-coffee-800 shadow-[var(--hundido)]">{modo}</p> : null}
      {grupos.length ? (
        <dl className="grid grid-cols-1 gap-x-5 gap-y-3 text-[0.875rem] sm:grid-cols-[10rem_minmax(0,1fr)]">
          {grupos.map(([aspecto, cs]) => (
            <div key={aspecto} className="contents">
              <dt className="font-semibold text-coffee-500">{NOMBRE_ASPECTO[aspecto] ?? aspecto}</dt>
              <dd className="flex min-w-0 flex-col gap-2">
                {cs.map((c, i) => (
                  <div key={i}>
                    <p className="text-coffee-800">
                      {c.afirmacion}
                      {c.inferido ? <span className="ml-1.5 inline-block rounded-md border border-dashed border-coffee-400 px-1.5 align-[0.1em] text-[0.6875rem] font-semibold text-coffee-600" title="Sin prueba anclada en las obras">inferido</span> : null}
                    </p>
                    {c.pruebas.a.length || c.pruebas.b.length ? (
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <FoliosPruebas ficha={ficha} indices={c.pruebas.a} obra={tituloA} />
                        <FoliosPruebas ficha={ficha} indices={c.pruebas.b} obra={tituloB} />
                      </p>
                    ) : null}
                  </div>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {personajes.length ? (
        <section aria-label="Personajes">
          <h3 className="text-[0.875rem] font-semibold text-coffee-800">Personajes</h3>
          <ul className="mt-1.5 flex flex-col gap-1.5 text-[0.875rem]">
            {personajes.map((p) => (
              <li key={p.nombre} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium text-coffee-800">{p.nombre}</span>
                <span className="rounded-md bg-cream-200 px-1.5 text-[0.75rem] font-semibold text-coffee-600 shadow-[var(--hundido)]">{NOMBRE_CAMBIO_PERSONAJE[p.cambio] ?? p.cambio}</span>
                {p.nota ? <span className="text-coffee-700">{p.nota}</span> : null}
                <FoliosPruebas ficha={ficha} indices={p.pruebas.a} obra={tituloA} />
                <FoliosPruebas ficha={ficha} indices={p.pruebas.b} obra={tituloB} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
