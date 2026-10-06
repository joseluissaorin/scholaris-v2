import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { DetalleDocumento, MapaFolios, ResumenDocumento } from '@scholaris/contrato';
import { Dialog } from 'radix-ui';
import {
  avisar, Boton, cx, Esqueleto, Folio, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo, Rotulo, Consejo,
} from '@scholaris/ui';
import { BLOQUE, q } from '../datos/consultas';
import { api } from '../datos/api';
import { useIngestas } from '../datos/ingesta';
import { validarBusquedaLector, type BusquedaLector } from '../lib/anclas';
import { anotarReciente, ponerPreferencia, preferencia } from '../lib/acciones';
import { anioCita, autores, ESTILOS_RAPIDOS, esMedio, tiempoACadena, NOMBRE_TIPO } from '../lib/formato';
import { Flujo, useUnidadEnCache, type ManejadorFlujo, type ModoLectura } from '../componentes/lector/flujo';
import { Medio, type ManejadorMedio } from '../componentes/lector/medio';
import { Ficha } from '../componentes/lector/ficha';
import { BarraSeleccion, useSeleccion } from '../componentes/lector/seleccion';
import { MenuDocumento, reintentarDocumento } from '../componentes/biblioteca/documento';

export const Route = createFileRoute('/lector/$id')({
  validateSearch: (s: Record<string, unknown>): BusquedaLector => validarBusquedaLector(s),
  loaderDeps: ({ search }) => ({ u: search.u }),
  loader: async ({ context, params, deps }) => {
    const c = context.consultas;
    void c.prefetchQuery(q.secciones(params.id));
    void c.prefetchQuery(q.folios(params.id));
    void c.prefetchQuery(q.bloque(params.id, Math.floor(((deps.u ?? 1) - 1) / BLOQUE)));
    await c.ensureQueryData(q.documento(params.id));
  },
  pendingComponent: EsperaLector,
  component: Lector,
});

function EsperaLector() {
  return (
    <div className="px-5 py-6 md:px-12">
      <Esqueleto className="h-5 w-64" />
      <div className="mt-10 grid gap-10 lg:grid-cols-2"><Esqueleto className="aspect-[1/1.414]" /><div className="flex flex-col gap-3">{Array.from({ length: 12 }, (_, i) => <Esqueleto key={i} className="h-3" style={{ width: `${90 - (i % 4) * 7}%` }} />)}</div></div>
    </div>
  );
}

type Panel = 'indice' | 'figuras' | 'ficha';

function Lector() {
  const { id } = Route.useParams();
  const busqueda = Route.useSearch();
  const navegar = useNavigate({ from: '/lector/$id' });
  const { data: doc } = useSuspenseQuery(q.documento(id));
  const qc = useQueryClient();
  const { data: bibliotecas = [] } = useQuery(q.bibliotecas());
  const { data: folios } = useQuery(q.folios(id));
  const ingesta = useIngestas().find((i) => i.documento === id && i.etapa !== 'listo');
  const medio = esMedio(doc.tipo);
  const paginado = ['pdf', 'pdf_escaneado', 'fotos', 'imagen', 'presentacion'].includes(doc.tipo);
  const [modo, setModo] = useState<ModoLectura>(() => preferencia<ModoLectura>('modo', 'ambas'));
  const [panel, setPanel] = useState<Panel | null>(() => (typeof window !== 'undefined' && window.innerWidth >= 1280 && preferencia('panel', 'cerrado') === 'abierto' ? 'indice' : null));
  const [actual, setActual] = useState(busqueda.u ?? 1);
  const [tiempo, setTiempo] = useState(busqueda.t ?? 0);
  const flujo = useRef<ManejadorFlujo>(null);
  const reproductor = useRef<ManejadorMedio>(null);
  const zona = useRef<HTMLDivElement>(null);
  const unidad = useUnidadEnCache(id);
  const [sel, limpiarSel] = useSeleccion(zona, unidad);
  const { data: original } = useQuery({ ...q.original(id), enabled: medio });

  // Primera unidad: la del enlace, o la que corresponde a sección y párrafo.
  const { data: secciones } = useQuery(q.secciones(id));
  const inicial = busqueda.u ?? (busqueda.sec && secciones ? (secciones.find((s) => s.titulo === busqueda.sec)?.unidadDesde ?? 1) + Math.max(0, (busqueda.par ?? 1) - 1) : 1);

  useEffect(() => {
    anotarReciente(id);
    void api().perspectivas.abierto(id, busqueda.u).catch(() => undefined);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // La URL sigue a la lectura (sin recolocar): el enlace se puede copiar en cualquier momento.
  useEffect(() => {
    const h = setTimeout(() => {
      void navegar({ search: (s) => (medio ? { ...s, t: Math.floor(tiempo), u: undefined } : { ...s, u: actual > 1 ? actual : undefined, sec: undefined, par: undefined }), replace: true, resetScroll: false });
    }, 600);
    return () => clearTimeout(h);
  }, [actual, Math.floor(tiempo / 5)]); // eslint-disable-line react-hooks/exhaustive-deps

  const alVer = useCallback((o: number) => setActual(o), []);
  const alVerMedio = useCallback((o: number, t: number) => { setActual(o); setTiempo(t); }, []);

  const folioActual = folios?.folios[actual - 1];
  const etiquetaActual = medio ? tiempoACadena(tiempo) : folioActual?.impresa ? `p. ${folioActual.impresa}` : doc.tipo === 'presentacion' ? `diap. ${actual}` : paginado ? `[${actual}]` : `§ ${actual}`;

  function irA(entrada: string): boolean {
    const t = entrada.trim().toLowerCase().replace(/^(p\.?|pág\.?|página)\s*/, '');
    if (!t) return false;
    if (medio) {
      const partes = t.split(':').map(Number);
      if (partes.some(Number.isNaN)) return false;
      const s = partes.reduce((a, b) => a * 60 + b, 0);
      reproductor.current?.irA(s);
      return true;
    }
    const fisica = /^\[(\d+)\]$/.exec(t);
    if (fisica) { flujo.current?.irA(Number(fisica[1]), true); return true; }
    const f = folios?.folios.find((x) => x.impresa?.toLowerCase() === t);
    if (f) { flujo.current?.irA(f.orden, true); return true; }
    if (/^\d+$/.test(t) && Number(t) <= doc.unidades && !folios?.folios.some((x) => x.impresa)) { flujo.current?.irA(Number(t), true); return true; }
    return false;
  }

  const abrirPanel = (p: Panel) => { setPanel((x) => (x === p ? null : p)); ponerPreferencia('panel', panel === p ? 'cerrado' : 'abierto'); };
  const resumen: ResumenDocumento = { id: doc.id, tipo: doc.tipo, estado: doc.estado, titulo: doc.metadatos.titulo, autores: autores(doc.metadatos), unidades: doc.unidades, bytes: doc.bytes, creado: doc.creado, actualizado: doc.actualizado, bibliotecas: doc.bibliotecas };

  return (
    <div className="min-h-dvh">
      {/* Barra del lector */}
      <div className="sticky top-14 z-30 border-b border-filete bg-papel/95 backdrop-blur md:top-0">
        <div className="flex h-[4.25rem] items-center gap-2 px-3 md:gap-3 md:px-6">
          <Consejo texto="Volver a la biblioteca">
            <Link to="/" aria-label="Volver a la biblioteca" className="grid h-10 w-10 shrink-0 place-items-center rounded-s text-tinta-2 hover:bg-hondo hover:text-tinta"><Icono nombre="izquierda" tam={18} /></Link>
          </Consejo>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[1.0625rem] leading-tight tracking-[-0.01em]"><em className="not-italic md:italic">{doc.metadatos.titulo}</em></h1>
            <p className="truncate text-[0.8125rem] text-tinta-2">{autores(doc.metadatos) || 'Sin autor'} · {anioCita(doc.metadatos)} · <span className="text-apagado">{NOMBRE_TIPO[doc.tipo]}</span></p>
          </div>

          <IrA etiqueta={etiquetaActual} total={medio ? tiempoACadena(doc.duracion ?? 0) : String(Math.max(doc.unidades, ingesta?.unidades ?? 0))} alIr={irA} medio={medio} />

          {paginado ? (
            <div role="group" aria-label="Modo de lectura" className="hidden rounded-s border border-filete-fuerte p-0.5 md:flex">
              {(['pagina', 'ambas', 'texto'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={modo === m} onClick={() => { setModo(m); ponerPreferencia('modo', m); }} className={cx('h-8 rounded-[2px] px-2.5 text-[0.8125rem]', modo === m ? 'bg-tinta text-sobre-tinta' : 'text-tinta-2 hover:text-tinta')}>
                  {m === 'pagina' ? 'Página' : m === 'ambas' ? 'Página y texto' : 'Texto'}
                </button>
              ))}
            </div>
          ) : null}

          <EstiloCita />
          <div className="hidden items-center gap-1 sm:flex">
            <BotonPanel activo={panel === 'indice'} icono="indice" etiqueta="Índice" alPulsar={() => abrirPanel('indice')} />
            <BotonPanel activo={panel === 'ficha'} icono="editar" etiqueta="Ficha" alPulsar={() => abrirPanel('ficha')} />
          </div>
          <MenuDocumento doc={resumen} bibliotecas={bibliotecas}>
            <button type="button" aria-label="Más acciones" className="grid h-10 w-10 shrink-0 place-items-center rounded-s text-tinta-2 hover:bg-hondo hover:text-tinta"><Icono nombre="opciones" tam={18} /></button>
          </MenuDocumento>
        </div>
        {doc.avisos?.some((a) => a.codigo === 'vectores_pendientes') && doc.estado === 'listo' ? (
          <div className="flex items-center gap-3 border-t border-filete bg-hoja px-4 py-2 text-[0.8125rem] text-tinta-2 md:px-6">
            <Icono nombre="historial" tam={14} className="shrink-0" />
            <span>Ya se puede leer, citar y buscar por texto. La búsqueda por significado se completa sola en unos minutos.</span>
          </div>
        ) : null}
        {doc.estado === 'error' ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-filete bg-rojo-suave/60 px-4 py-2 text-[0.8125rem] md:px-6">
            <span className="h-2 w-2 shrink-0 bg-rojo" />
            <span className="flex-1">{doc.error ?? 'No se pudo leer este documento.'}</span>
            <Boton variante="linea" tam="p" icono="rayo" className="bg-papel" onClick={() => void reintentarDocumento(qc, doc.id)}>Reintentar</Boton>
          </div>
        ) : null}
        {ingesta || doc.estado === 'procesando' ? (
          <div className="flex items-center gap-3 border-t border-filete bg-amarillo-suave/60 px-4 py-2 text-[0.8125rem] md:px-6">
            <span className="h-2 w-2 shrink-0 rounded-full bg-rojo anim-pulso" />
            <span>{ingesta?.preparadas && !ingesta.leidas ? 'Estás viendo la vista previa de tu navegador. Scholaris sigue leyendo; en cuanto termine se podrá buscar y citar.' : `Se está leyendo${ingesta?.leidas ? `: ${ingesta.leidas} de ${ingesta.unidades ?? doc.unidades}` : ''}. Ya puedes leerlo; se podrá buscar y citar en cuanto termine.`}</span>
          </div>
        ) : null}
      </div>

      <div className="flex">
        <div ref={zona} className="min-w-0 flex-1 px-5 pb-24 md:px-12">
          {medio ? (
            <Medio ref={reproductor} doc={doc} url={original?.url || null} inicial={busqueda.t ?? 0} resaltar={busqueda.q} alVer={alVerMedio} />
          ) : (
            <Flujo ref={flujo} doc={doc} modo={modo} inicial={inicial} resaltar={busqueda.q} leidas={ingesta ? ingesta.leidas : undefined} total={ingesta?.unidades ?? undefined} alVer={alVer} />
          )}
        </div>
        {panel ? (
          <aside aria-label="Panel del documento" className="sticky top-[4.25rem] hidden h-[calc(100dvh-4.25rem)] w-[23rem] shrink-0 flex-col border-l border-filete bg-papel xl:flex">
            <PanelDocumento doc={doc} panel={panel} setPanel={setPanel} irA={(o) => flujo.current?.irA(o, true)} irT={(t) => reproductor.current?.irA(t)} actual={actual} />
          </aside>
        ) : null}
      </div>

      {/* En pantallas sin hueco lateral, el panel es una hoja que sube. */}
      <Dialog.Root open={!!panel && typeof window !== 'undefined' && window.innerWidth < 1280} onOpenChange={(v) => !v && setPanel(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_21_17/0.38)] xl:hidden anim-aparece" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-l border-t border-filete-fuerte bg-papel shadow-flota xl:hidden anim-tostada">
            <Dialog.Title className="sr-only">Panel del documento</Dialog.Title>
            {panel ? <PanelDocumento doc={doc} panel={panel} setPanel={setPanel} irA={(o) => { setPanel(null); flujo.current?.irA(o, true); }} irT={(t) => { setPanel(null); reproductor.current?.irA(t); }} actual={actual} /> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Botón de panel en el móvil */}
      <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-20 flex gap-2 sm:hidden">
        <Boton variante="tinta" tam="m" icono="indice" onClick={() => setPanel('indice')}>Índice</Boton>
        <Boton variante="linea" tam="m" soloIcono icono="editar" aria-label="Ficha" className="bg-papel" onClick={() => setPanel('ficha')} />
      </div>

      {sel ? <BarraSeleccion sel={sel} documento={id} meta={doc.metadatos} alCerrar={limpiarSel} /> : null}
    </div>
  );
}

function BotonPanel({ activo, icono, etiqueta, alPulsar }: { activo: boolean; icono: 'indice' | 'editar'; etiqueta: string; alPulsar: () => void }) {
  return (
    <button type="button" aria-pressed={activo} onClick={alPulsar} className={cx('flex h-10 items-center gap-1.5 rounded-s px-2.5 text-[0.875rem]', activo ? 'bg-tinta text-sobre-tinta' : 'text-tinta-2 hover:bg-hondo hover:text-tinta')}>
      <Icono nombre={icono} tam={16} /><span className="hidden lg:inline">{etiqueta}</span>
    </button>
  );
}

/** El folio actual, siempre a la vista; al pulsarlo se convierte en «ir a». */
function IrA({ etiqueta, total, alIr, medio }: { etiqueta: string; total: string; alIr: (t: string) => boolean; medio: boolean }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState(false);
  if (editando) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (alIr(texto)) { setEditando(false); setTexto(''); setError(false); } else setError(true); }} className="flex items-center gap-1">
        <label className="sr-only" htmlFor="ir-a">{medio ? 'Ir al minuto' : 'Ir a la página impresa'}</label>
        <input id="ir-a" autoFocus value={texto} onChange={(e) => { setTexto(e.target.value); setError(false); }} onBlur={() => !texto && setEditando(false)} onKeyDown={(e) => e.key === 'Escape' && setEditando(false)}
          placeholder={medio ? '12:04' : '145, xiv o [153]'} className={cx('h-10 w-32 rounded-s border bg-hoja px-2 font-mono text-[0.9375rem] outline-none', error ? 'border-rojo' : 'border-tinta')} aria-invalid={error} />
        {error ? <span role="alert" className="sr-only">No existe esa página.</span> : null}
      </form>
    );
  }
  return (
    <Consejo texto={medio ? 'Ir a un instante' : 'Ir a una página impresa (145, xiv) o física ([153])'}>
      <button type="button" onClick={() => setEditando(true)} className="flex h-10 shrink-0 items-baseline gap-1.5 rounded-s px-2 hover:bg-hondo" aria-label={`${etiqueta} / ${total}: ir a otra ${medio ? 'posición' : 'página'}`}>
        <Folio grande>{etiqueta}</Folio>
        <span className="hidden font-mono text-[0.75rem] text-apagado sm:inline">/ {total}</span>
      </button>
    </Consejo>
  );
}

function EstiloCita() {
  const [estilo, setEstilo] = useState(() => preferencia('estilo', 'apa'));
  const actual = ESTILOS_RAPIDOS.find((e) => e.id === estilo) ?? ESTILOS_RAPIDOS[0];
  return (
    <MenuRaiz>
      <MenuDisparador asChild>
        <button type="button" className="hidden h-10 shrink-0 items-center gap-1.5 rounded-s px-2.5 text-[0.8125rem] text-tinta-2 hover:bg-hondo hover:text-tinta lg:flex" aria-label={`Estilo de cita: ${actual.nombre}`}>
          <Icono nombre="citar" tam={15} />{actual.nombre}
        </button>
      </MenuDisparador>
      <MenuContenido>
        <MenuRotulo>Al citar una selección</MenuRotulo>
        {ESTILOS_RAPIDOS.map((e) => <MenuElemento key={e.id} icono={e.id === estilo ? 'hecho' : undefined} alElegir={() => { setEstilo(e.id); ponerPreferencia('estilo', e.id); avisar(`Las citas saldrán en ${e.nombre}.`); }}>{e.nombre}</MenuElemento>)}
      </MenuContenido>
    </MenuRaiz>
  );
}

function PanelDocumento({ doc, panel, setPanel, irA, irT, actual }: { doc: DetalleDocumento; panel: Panel; setPanel: (p: Panel | null) => void; irA: (o: number) => void; irT: (t: number) => void; actual: number }) {
  const { data: secciones, isPending } = useQuery(q.secciones(doc.id));
  const { data: figuras } = useQuery({ ...q.figuras(doc.id), enabled: panel === 'figuras' || !esMedio(doc.tipo) });
  const { data: folios } = useQuery(q.folios(doc.id));
  const pestanas: Array<[Panel, string]> = [['indice', 'Índice'], ...(figuras?.length ? [['figuras', 'Figuras'] as [Panel, string]] : []), ['ficha', 'Ficha']];
  const etiqueta = (orden: number, m?: MapaFolios) => {
    const f = m?.folios[orden - 1];
    if (esMedio(doc.tipo)) return f?.t0 != null ? tiempoACadena(f.t0) : '';
    return f?.impresa ? `p. ${f.impresa}` : doc.tipo === 'presentacion' ? `diap. ${orden}` : `[${orden}]`;
  };
  const enCurso = secciones ? [...secciones].reverse().find((s) => s.unidadDesde <= actual) : undefined;
  return (
    <>
      <div className="flex items-center gap-1 border-b border-filete px-3">
        {pestanas.map(([p, n]) => (
          <button key={p} type="button" onClick={() => setPanel(p)} aria-pressed={panel === p} className={cx('relative h-12 px-3 text-[0.9375rem]', panel === p ? 'italic text-tinta' : 'text-tinta-2 hover:text-tinta')}>
            {n}{panel === p ? <span className="absolute inset-x-2 bottom-0 h-[3px] bg-tinta" /> : null}
          </button>
        ))}
        <button type="button" onClick={() => setPanel(null)} aria-label="Cerrar el panel" className="ml-auto grid h-9 w-9 place-items-center rounded-s text-apagado hover:bg-hondo hover:text-tinta"><Icono nombre="cerrar" tam={15} /></button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {panel === 'indice' ? (
          isPending ? <div className="flex flex-col gap-3">{Array.from({ length: 8 }, (_, i) => <Esqueleto key={i} className="h-4" />)}</div>
          : !secciones?.length ? <p className="text-[0.9375rem] text-apagado">Este documento no trae índice. Puedes ir a cualquier página con el folio de arriba.</p>
          : (
            <ol className="flex flex-col">
              {secciones.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => (esMedio(doc.tipo) ? irT(folios?.folios[s.unidadDesde - 1]?.t0 ?? 0) : irA(s.unidadDesde))}
                    className={cx('group flex w-full items-baseline gap-3 rounded-s py-2 pr-2 text-left hover:bg-hondo', s.nivel > 1 ? 'pl-5 text-[0.875rem] text-tinta-2' : 'pl-2 text-[0.9375rem]', enCurso?.id === s.id && 'bg-hondo text-tinta')}>
                    <span className="min-w-0 flex-1">{enCurso?.id === s.id ? <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rojo align-middle" /> : null}{s.titulo}</span>
                    <span className="shrink-0 font-mono text-[0.75rem] text-apagado tnum">{etiqueta(s.unidadDesde, folios)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )
        ) : panel === 'figuras' ? (
          <ul className="grid grid-cols-2 gap-3">
            {figuras?.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => irA(f.unidad)} className="group block w-full text-left">
                  {f.imagenUrl ? <img src={f.imagenUrl} alt={f.descripcion ?? f.pie ?? ''} loading="lazy" className="aspect-[4/3] w-full rounded-s border border-filete object-cover" /> : <div className="grid aspect-[4/3] place-items-center rounded-s border border-filete bg-hondo"><Icono nombre="figura" tam={22} className="text-apagado" /></div>}
                  <p className="mt-1.5 line-clamp-2 text-[0.8125rem] group-hover:underline">{f.pie}</p>
                  <Rotulo>{f.etiqueta}</Rotulo>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Ficha doc={doc} />
        )}
      </div>
    </>
  );
}
