/**
 * Las figuras y los fotogramas como objetos de primera: la imagen (recortada a
 * su región si la ingesta la guardó), la descripción que hizo el modelo, el pie
 * impreso, su ancla, «Citar figura» y «Buscar parecidas». El visor es el mismo
 * en el lector, en el inspector y en Buscar.
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog } from 'radix-ui';
import type { Ancla } from '@scholaris/nucleo';
import type { FiguraEncontrada, FiguraVista, RegionFigura } from '@scholaris/contrato';
import { avisar, Boton, cx, Esqueleto, Folio, Icono, Rotulo } from '@scholaris/ui';
import { api } from '../../datos/api';
import { clienteConsultas, q } from '../../datos/consultas';
import { citaEnTexto, tiempoACadena } from '../../lib/formato';
import { estiloActual } from '../../lib/referencia';

/** Lo que el visor necesita de una figura, venga del documento o de toda la biblioteca. */
export interface FiguraVisor {
  id: string;
  documento: string;
  /** Título del documento (en Buscar, donde se mezclan). */
  titulo?: string;
  /** Unidad base 1, como en la web. */
  unidad: number;
  imagenUrl: string;
  pie?: string;
  descripcion?: string;
  ancla: Ancla;
  etiqueta: string;
  region?: RegionFigura;
  t?: number;
  escena?: boolean;
}

export const deVista = (documento: string, f: FiguraVista): FiguraVisor => ({ ...f, documento });
export const deEncontrada = (f: FiguraEncontrada): FiguraVisor => ({ ...f, unidad: f.unidad + 1 });

export const esFotograma = (f: Pick<FiguraVisor, 'ancla'>) => f.ancla.tipo === 'tiempo';

/** Un fotograma en negro o vacío no dice nada: se aparta de las listas. */
export const esVacio = (f: Pick<FiguraVisor, 'descripcion'>) => /\b(en negro|pantalla negra|fundido|en blanco|vac[ií]o)\b/i.test(f.descripcion ?? '') && (f.descripcion ?? '').length < 60;

/** El texto alternativo: la descripción, el pie o, en su defecto, qué es y dónde está. */
export function altFigura(f: FiguraVisor): string {
  const d = f.descripcion?.trim();
  const p = f.pie?.trim();
  if (d && p) return `${d} (${p})`;
  return d || p || (esFotograma(f) ? `Fotograma en ${f.etiqueta}` : `Figura de la ${f.etiqueta}`);
}

/** Las figuras de un documento, en el formato del visor y en orden de aparición. */
export function useFigurasDocumento(documento: string, activo = true): { figuras: FiguraVisor[]; cargando: boolean } {
  const { data, isPending } = useQuery({ ...q.figuras(documento), enabled: activo });
  const figuras = useMemo(() => (data ?? []).map((f) => deVista(documento, f)).sort((a, b) => (a.t ?? -1) - (b.t ?? -1) || a.unidad - b.unidad), [data, documento]);
  return { figuras, cargando: activo && isPending };
}

/** Tamaño natural de una imagen (para recortar la región con su proporción real). */
const tamanos = new Map<string, { w: number; h: number }>();
function useTamano(src: string | undefined): { w: number; h: number } | null {
  const [t, setT] = useState(() => (src ? tamanos.get(src) ?? null : null));
  useEffect(() => {
    if (!src || tamanos.has(src)) { setT(src ? tamanos.get(src) ?? null : null); return; }
    const i = new Image();
    i.onload = () => { const v = { w: i.naturalWidth, h: i.naturalHeight }; tamanos.set(src, v); setT(v); };
    i.src = src;
  }, [src]);
  return t;
}

/**
 * La imagen de una figura. Si trae región, la página se recorta a la figura
 * (lo que se guarda es la página entera) con un SVG: `cubrir` llena la caja,
 * `contener` la enseña entera. Sin región, la imagen tal cual.
 */
export const ImagenFigura = memo(function ImagenFigura({ fig, className, recortar = true, ajuste = 'cubrir', perezosa = true }: {
  fig: Pick<FiguraVisor, 'imagenUrl' | 'region' | 'descripcion' | 'pie' | 'etiqueta' | 'ancla'>; className?: string; recortar?: boolean; ajuste?: 'cubrir' | 'contener'; perezosa?: boolean;
}) {
  const [rota, setRota] = useState(false);
  const r = recortar && fig.region && fig.region.w > 0 && fig.region.h > 0 ? fig.region : undefined;
  const tam = useTamano(r ? fig.imagenUrl : undefined);
  const alt = altFigura(fig as FiguraVisor);
  if (!fig.imagenUrl || rota) {
    return <div className={cx('grid place-items-center bg-hondo text-apagado', className)} role="img" aria-label={alt}><Icono nombre={esFotograma(fig) ? 'video' : 'figura'} tam={22} /></div>;
  }
  if (r) {
    const alto = 1000 * (tam ? tam.h / tam.w : 1.414);
    const caja = `${r.x * 1000} ${r.y * alto} ${r.w * 1000} ${r.h * alto}`;
    return (
      <svg viewBox={caja} preserveAspectRatio={ajuste === 'cubrir' ? 'xMidYMid slice' : 'xMidYMid meet'} role="img" aria-label={alt} className={cx('block', ajuste === 'cubrir' && 'bg-white', className)}>
        <image href={fig.imagenUrl} x={0} y={0} width={1000} height={alto} onError={() => setRota(true)} />
      </svg>
    );
  }
  return <img src={fig.imagenUrl} alt={alt} loading={perezosa ? 'lazy' : 'eager'} decoding="async" onError={() => setRota(true)} className={cx(ajuste === 'cubrir' ? 'bg-white object-cover object-top' : 'object-contain', className)} />;
});

/** La página entera con el recuadro de la figura (en el visor, «Ver en la página»). */
function PaginaConRecuadro({ fig }: { fig: FiguraVisor }) {
  const r = fig.region!;
  return (
    <div className="relative inline-block max-h-full">
      <img src={fig.imagenUrl} alt={altFigura(fig)} className="block max-h-[70dvh] w-auto max-w-full bg-white object-contain" />
      <span aria-hidden className="pointer-events-none absolute border-2 border-rojo shadow-[0_0_0_9999px_rgb(26_15_10/0.35)]" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
    </div>
  );
}

/** «Figure 1: The Transformer…» (Vaswani et al., 2017, p. 3): el pie (o la descripción) con su cita. */
export async function citarFigura(f: FiguraVisor): Promise<void> {
  try {
    const doc = await clienteConsultas.fetchQuery(q.documento(f.documento));
    const { region: _r, escena: _e, ...anclaLimpia } = f.ancla as Ancla & { region?: unknown; escena?: unknown };
    const ancla = (anclaLimpia.tipo === 'tiempo' ? { ...anclaLimpia, t1: Math.max(anclaLimpia.t1, anclaLimpia.t0) } : anclaLimpia) as Ancla;
    const cita = citaEnTexto(doc.metadatos, ancla, estiloActual());
    const nombre = f.pie?.trim() || (esFotograma(f) ? `Fotograma en ${tiempoACadena(f.t ?? 0)}` : 'Figura');
    const texto = `${nombre} ${cita}`;
    await navigator.clipboard.writeText(texto);
    avisar(`Cita de la figura copiada: ${texto}`, { tono: 'exito', duracion: 6000 });
  } catch (e) {
    avisar(e instanceof Error ? e.message : 'No se pudo copiar la cita.', { tono: 'error' });
  }
}

async function copiar(texto: string, aviso: string) {
  try { await navigator.clipboard.writeText(texto); avisar(aviso, { tono: 'exito' }); } catch { avisar('El navegador no dejó copiar.', { tono: 'error' }); }
}

/**
 * El visor: la imagen grande sobre la mesa de luz, lo que se ve (descripción
 * automática), el pie impreso, dónde está, y las acciones. ← y → recorren la lista.
 */
export function VisorFigura({ figuras, indice, alCambiar, alIr, contexto }: {
  figuras: FiguraVisor[];
  indice: number | null;
  alCambiar: (i: number | null) => void;
  /** Ir a la figura en el lector (si ya se está en él, sin navegar). Por defecto, abre el lector. */
  alIr?: (f: FiguraVisor) => void;
  /** Una línea encima del título («Attention Is All You Need»). */
  contexto?: ReactNode;
}) {
  const navegar = useNavigate();
  // Una parecida de otro documento se enseña aquí mismo, encima de la lista.
  const [ajena, setAjena] = useState<FiguraVisor | null>(null);
  const [paginaEntera, setPaginaEntera] = useState(false);
  const [parecidas, setParecidas] = useState<{ de: string; lista: FiguraVisor[] | null; error?: string } | null>(null);
  const f = ajena ?? (indice != null ? figuras[indice] : undefined);
  useEffect(() => { setPaginaEntera(false); }, [f?.id]);

  useEffect(() => {
    if (indice == null) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea')) return;
      if (e.key === 'ArrowRight' && indice < figuras.length - 1) { setAjena(null); alCambiar(indice + 1); }
      if (e.key === 'ArrowLeft' && indice > 0) { setAjena(null); alCambiar(indice - 1); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [indice, figuras.length, alCambiar]);

  async function buscarParecidas(base: FiguraVisor) {
    setParecidas({ de: base.id, lista: null });
    try {
      const r = await api().figuras.parecidas(base.id, 12);
      setParecidas({ de: base.id, lista: r.map(deEncontrada).filter((x) => !esVacio(x)) });
    } catch (e) {
      setParecidas({ de: base.id, lista: [], error: e instanceof Error ? e.message : 'No se pudieron buscar.' });
    }
  }

  function ir(x: FiguraVisor) {
    alCambiar(null);
    setAjena(null);
    if (alIr && !ajena) { alIr(x); return; }
    void navegar({ to: '/lector/$id', params: { id: x.documento }, search: esFotograma(x) ? { t: Math.floor(x.t ?? 0) } : { u: x.unidad } });
  }

  const cerrar = () => { alCambiar(null); setAjena(null); setParecidas(null); };
  const fotograma = f ? esFotograma(f) : false;

  return (
    <Dialog.Root open={!!f} onOpenChange={(v) => { if (!v) cerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_15_10/0.62)] backdrop-blur-sm anim-aparece" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-cream-400 bg-cream-50 shadow-[var(--levantado-alto)] anim-dialogo focus:outline-none sm:inset-6 lg:inset-x-[max(1.5rem,calc(50vw-42rem))] lg:inset-y-8">
          {f ? (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1.45fr)_minmax(20rem,1fr)] lg:grid-rows-1">
              {/* La mesa de luz */}
              <div className="relative flex min-h-0 items-center justify-center bg-[radial-gradient(ellipse_at_center,#3a2618_0%,#1a0f0a_75%)] p-4 sm:p-8">
                {paginaEntera && f.region ? <PaginaConRecuadro fig={f} /> : (
                  <ImagenFigura key={f.id} fig={f} ajuste="contener" perezosa={false} className="h-full max-h-[72dvh] w-full drop-shadow-[0_18px_30px_rgb(0_0_0/0.45)]" />
                )}
                {indice != null && !ajena && figuras.length > 1 ? (
                  <>
                    <button type="button" disabled={indice === 0} onClick={() => alCambiar(indice - 1)} aria-label="Figura anterior" className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-cream-50/90 text-coffee-800 shadow-[var(--relieve)] hover:bg-cream-50 disabled:opacity-30"><Icono nombre="izquierda" tam={18} /></button>
                    <button type="button" disabled={indice === figuras.length - 1} onClick={() => alCambiar(indice + 1)} aria-label="Figura siguiente" className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-cream-50/90 text-coffee-800 shadow-[var(--relieve)] hover:bg-cream-50 disabled:opacity-30"><Icono nombre="derecha" tam={18} /></button>
                    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[#1a0f0a]/70 px-3 py-1 font-mono text-[0.75rem] text-cream-200 tnum">{indice + 1} de {figuras.length}</span>
                  </>
                ) : null}
              </div>

              {/* Lo que se sabe de ella */}
              <div className="flex min-h-0 flex-col border-t border-cream-300 lg:border-l lg:border-t-0">
                <div className="flex items-start gap-3 border-b border-cream-300 px-5 pb-3 pt-4">
                  <div className="min-w-0 flex-1">
                    {contexto || f.titulo ? <p className="truncate text-[0.75rem] text-apagado">{contexto ?? f.titulo}</p> : null}
                    <Dialog.Title className="flex items-center gap-2 text-[1.0625rem] font-semibold text-coffee-800">
                      {fotograma ? <span aria-hidden className="h-2.5 w-2.5 bg-rojo" /> : <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-azul" />}
                      {fotograma ? 'Fotograma' : 'Figura'}
                      <Folio>{f.etiqueta}</Folio>
                      {f.escena ? <span className="rounded-md bg-amarillo-suave px-1.5 py-0.5 text-[0.6875rem] font-semibold text-coffee-700">cambio de escena</span> : null}
                    </Dialog.Title>
                  </div>
                  <Dialog.Close className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-coffee-400 hover:bg-cream-200 hover:text-coffee-800" aria-label="Cerrar"><Icono nombre="cerrar" tam={16} /></Dialog.Close>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                  <Rotulo>Lo que se ve</Rotulo>
                  {f.descripcion ? (
                    <>
                      <p className="mt-1.5 font-serif text-[1.0625rem] leading-[1.55] text-coffee-800">{f.descripcion}</p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-apagado"><Icono nombre="chispa" tam={12} />Descripción automática, hecha al leer el documento. Sirve para buscar; no es una cita.</p>
                    </>
                  ) : <p className="mt-1.5 text-[0.9375rem] text-apagado">Esta {fotograma ? 'imagen' : 'figura'} no tiene descripción automática.</p>}

                  <div className="mt-5">
                    <Rotulo>{fotograma ? 'Rótulo' : 'Pie impreso'}</Rotulo>
                    {f.pie ? <p className="mt-1.5 border-l-2 border-coffee-300 pl-3 font-serif text-[0.9375rem] italic leading-[1.5] text-coffee-700">{f.pie}</p>
                      : <p className="mt-1.5 text-[0.875rem] text-apagado">{fotograma ? 'Los fotogramas no llevan pie.' : 'Sin pie impreso.'}</p>}
                  </div>

                  <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
                    <dt className="text-apagado">Dónde</dt>
                    <dd className="text-coffee-700">{fotograma ? `en ${tiempoACadena(f.t ?? 0)}` : f.ancla.tipo === 'pagina' ? `${f.etiqueta} · página física ${f.ancla.fisica}` : f.etiqueta}{f.ancla.tipo === 'tiempo' && f.ancla.hablante ? ` · habla ${f.ancla.hablante}` : ''}</dd>
                    {f.region ? (<><dt className="text-apagado">Región</dt><dd className="dato text-coffee-700">{Math.round(f.region.w * 100)} × {Math.round(f.region.h * 100)} % de la página, desde ({Math.round(f.region.x * 100)}, {Math.round(f.region.y * 100)})</dd></>) : null}
                    <dt className="text-apagado">Identificador</dt>
                    <dd className="dato truncate text-coffee-600">{f.id}</dd>
                  </dl>

                  {parecidas?.de === f.id ? (
                    <div className="mt-6">
                      <Rotulo>Parecidas en tu biblioteca</Rotulo>
                      {parecidas.lista == null ? <div className="mt-2 grid grid-cols-3 gap-2">{Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} className="aspect-[4/3]" />)}</div>
                        : parecidas.error ? <p className="mt-2 text-[0.875rem] text-apagado">{parecidas.error}</p>
                        : !parecidas.lista.length ? <p className="mt-2 text-[0.875rem] text-apagado">No hay otras figuras que se le parezcan.</p>
                        : (
                          <ul className="mt-2 grid grid-cols-3 gap-2">
                            {parecidas.lista.map((x) => (
                              <li key={x.id}>
                                <button type="button" onClick={() => { const i = figuras.findIndex((y) => y.id === x.id); if (i >= 0) { setAjena(null); alCambiar(i); } else setAjena(x); }}
                                  className="group block w-full overflow-hidden rounded-lg border border-cream-400 bg-cream-50 text-left shadow-[var(--relieve)] hover:-translate-y-px hover:shadow-[var(--levantado)]" title={altFigura(x)}>
                                  <ImagenFigura fig={x} className="aspect-[4/3] w-full" />
                                  <span className="block truncate px-1.5 py-1 text-[0.6875rem] text-coffee-600"><span className="font-mono">{x.etiqueta}</span>{x.documento !== f.documento && x.titulo ? ` · ${x.titulo}` : ''}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-cream-300 bg-cream-100/70 px-5 py-3">
                  <Boton variante="tinta" tam="p" icono={fotograma ? 'play' : 'lector'} onClick={() => ir(f)}>{fotograma ? `Ir a ${tiempoACadena(f.t ?? 0)}` : `Ir a la ${f.etiqueta}`}</Boton>
                  <Boton variante="linea" tam="p" icono="citar" onClick={() => void citarFigura(f)}>Citar figura</Boton>
                  <Boton variante="linea" tam="p" icono="buscar" onClick={() => void buscarParecidas(f)}>Buscar parecidas</Boton>
                  {f.descripcion ? <Boton variante="fantasma" tam="p" icono="copiar" onClick={() => void copiar(f.descripcion!, 'Descripción copiada.')}>Copiar descripción</Boton> : null}
                  {f.region ? <Boton variante="fantasma" tam="p" icono="documento" aria-pressed={paginaEntera} onClick={() => setPaginaEntera((x) => !x)}>{paginaEntera ? 'Solo la figura' : 'Ver en la página'}</Boton> : null}
                </div>
              </div>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
