import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, notFound, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { esNoEncontrado } from '../componentes/comunes/errores';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import type { DetalleDocumento, MapaFolios, ResultadoVista, ResumenDocumento } from '@scholaris/contrato';
import { enmascarar, textoDePasaje } from '@scholaris/nucleo';
import { Dialog } from 'radix-ui';
import {
  avisar, Boton, cx, Dialogo, Esqueleto, Folio, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, MenuRotulo, Rotulo, Consejo, Teclas,
} from '@scholaris/ui';
import { BLOQUE, precargarLector, q } from '../datos/consultas';
import { api } from '../datos/api';
import { useIngestas } from '../datos/ingesta';
import { validarBusquedaLector, type BusquedaLector, type ContextoBusqueda } from '../lib/anclas';
import { anotarVenida, busquedaDeResultado, contextoLimpio, opcionesDeContexto, precargarResultado, sembrarFragmento } from '../datos/recorrido';
import { claveDePasaje, pedirDesplazamiento } from '../componentes/lector/subrayado';
import { anotarReciente, ponerPreferencia, preferencia } from '../lib/acciones';
import { anioVisible, contenedorVisible, autores, ESTILOS_RAPIDOS, esMedio, tiempoACadena, NOMBRE_TIPO } from '../lib/formato';
import { Flujo, useUnidadEnCache, type ManejadorFlujo, type ModoLectura } from '../componentes/lector/flujo';
import { Reproductor, type ManejadorMedio } from '../componentes/reproductor/reproductor';
import { Ficha } from '../componentes/lector/ficha';
import { ProveedorEntidades } from '../componentes/lector/entidades';
import { BarraSeleccion, useSeleccion } from '../componentes/lector/seleccion';
import { MenuDocumento, reintentarDocumento } from '../componentes/biblioteca/documento';
import { BotonReferencia } from '../componentes/comunes/boton-referencia';
import { copiarReferencia } from '../lib/referencia';
import { PanelFiguras } from '../componentes/inspector/panel-figuras';
import { hojear } from '../movimiento/hojear';
import { Portada } from '../componentes/comunes/portada';
import { NotaMargen } from '../bocetos/nota-margen';

export const Route = createFileRoute('/lector/$id')({
  validateSearch: (s: Record<string, unknown>): BusquedaLector => validarBusquedaLector(s),
  // Solo «u»: si una dependencia cambiara al seguir la URL al reproductor (?t=), el lector se remontaría y el medio se soltaría.
  loaderDeps: ({ search }) => ({ u: search.u }),
  loader: async ({ context, params, deps, location }) => {
    // Un enlace con ?t= es de audio o vídeo. Desde un enlace directo esto ya salió en el arranque (main.tsx).
    try {
      await precargarLector(context.consultas, params.id, deps.u ?? 1, (location.search as { t?: unknown }).t != null);
    } catch (e) {
      // Un documento que no existe (o no es tuyo) es un 404 dentro del marco, no un error.
      if (esNoEncontrado(e)) throw notFound();
      throw e;
    }
  },
  pendingComponent: EsperaLector,
  component: LectorRuta,
});

// Otro documento (al pasar al resultado siguiente) es otro lector: nada del anterior (desplazamiento, medio) se arrastra.
function LectorRuta() {
  const { id } = Route.useParams();
  return <Lector key={id} />;
}

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

  // El pasaje que abrió el lector (?f=&pd=&ph=): sus oraciones se subrayan; el resto del fragmento, en suave.
  const conPasaje = !!busqueda.f && busqueda.pd != null && busqueda.ph != null;
  const { data: fragmento } = useQuery({ ...q.fragmento(id, busqueda.f ?? ''), enabled: conPasaje });
  const pasaje = useMemo(() => {
    const crudo = fragmento?.textoCrudo;
    const pd = busqueda.pd, ph = busqueda.ph;
    if (!crudo || pd == null || ph == null || ph <= pd || ph > crudo.length) return undefined;
    const m = enmascarar(crudo).texto;
    return { texto: textoDePasaje(m, pd, ph), contexto: textoDePasaje(m, 0, m.length) };
  }, [fragmento?.textoCrudo, busqueda.pd, busqueda.ph]);
  // Cada pasaje nuevo se pone a la vista una vez (lo hace la página que lo tiene, cuando se pinta).
  const pasajePedido = useRef<string | null>(null);
  if (pasaje && !medio && pasajePedido.current !== pasaje.texto) { pasajePedido.current = pasaje.texto; pedirDesplazamiento(claveDePasaje(pasaje.texto)); }

  // Recorrido de los resultados de la búsqueda de la que se vino (de la caché: no se busca otra vez).
  const rb = busqueda.rb;
  const router = useRouter();
  const desdeResultados = useRouterState({ select: (s) => !!(s.location.state as { desdeResultados?: boolean }).desdeResultados });
  const { data: listaBusqueda } = useQuery({ ...(rb ? opcionesDeContexto(rb) : { queryKey: ['recorrido', 'ninguno'], queryFn: () => ({ resultados: [] }) }), enabled: false });
  const lista = useMemo(() => (listaBusqueda?.resultados ?? []).filter((r: ResultadoVista & { origen?: { propia?: boolean } }) => !r.origen || r.origen.propia), [listaBusqueda]);
  const posicion = rb ? (busqueda.f ? lista.findIndex((r) => r.fragmento.id === busqueda.f) : -1) : -1;
  const pos = posicion >= 0 ? posicion : busqueda.ri ?? -1;
  // Mientras se lee uno, el siguiente (y el anterior) ya se están bajando: documento, páginas y texto.
  useEffect(() => {
    if (pos < 0) return;
    const h = window.setTimeout(() => { for (const k of [pos + 1, pos - 1]) { const r = lista[k]; if (r) void precargarResultado(qc, r); } }, 400);
    return () => window.clearTimeout(h);
  }, [pos, lista, qc]);

  const irAResultado = useCallback((k: number) => {
    const r = lista[k];
    if (!rb || !r) return;
    sembrarFragmento(qc, r);
    anotarVenida(rb, r.fragmento.id);
    const search = busquedaDeResultado(r, { consulta: rb.q, contexto: rb, indice: k });
    const estado = { desdeResultados };
    if (r.documento.id === id) {
      void navegar({ search, replace: true, resetScroll: false, state: estado });
      // El mismo documento: se desplaza al pasaje sin recargar nada.
      if (medio) { if (search.t != null) reproductor.current?.irA(search.t); }
      // Cerca, se desliza; lejos, se salta (deslizar por cien páginas bajaría todas sus imágenes).
      else if (search.u) flujo.current?.irA(search.u, Math.abs(search.u - actual) <= 3);
    } else {
      void navegar({ to: '/lector/$id', params: { id: r.documento.id }, search, replace: true, state: estado });
    }
  }, [lista, rb, qc, id, medio, navegar, desdeResultados, actual]);

  const volverAResultados = useCallback(() => {
    if (!rb) return;
    // Atrás de verdad: la lista sale de la caché, en su sitio y sin buscar otra vez.
    if (desdeResultados && router.history.canGoBack()) router.history.back();
    else void navegar({ to: '/buscar', search: contextoLimpio(rb) as never });
  }, [rb, desdeResultados, router, navegar]);

  // Teclas: N y P recorren los resultados, Esc vuelve a ellos, ? enseña las teclas (el reproductor tiene las suyas).
  const [ayuda, setAyuda] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (rb && tecla === 'n' && pos >= 0 && pos + 1 < lista.length) { e.preventDefault(); irAResultado(pos + 1); }
      else if (rb && tecla === 'p' && pos > 0) { e.preventDefault(); irAResultado(pos - 1); }
      else if (rb && tecla === 'Escape' && !document.fullscreenElement && !window.getSelection()?.toString()) { e.preventDefault(); volverAResultados(); }
      else if (!medio && tecla === '?') { e.preventDefault(); setAyuda(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [rb, pos, lista.length, irAResultado, volverAResultados, medio]);

  // Primera unidad: la del enlace, o la que corresponde a sección y párrafo.
  const { data: secciones } = useQuery(q.secciones(id));
  const inicial = busqueda.u ?? (busqueda.sec && secciones ? (secciones.find((s) => s.titulo === busqueda.sec)?.unidadDesde ?? 1) + Math.max(0, (busqueda.par ?? 1) - 1) : 1);
  // Un enlace por sección y párrafo (EPUB, Markdown, web) solo se sabe situar cuando llega el índice:
  // entonces (y al pasar a otro resultado del mismo documento) se va a esa unidad.
  const destinoSeccion = busqueda.u == null && busqueda.sec && secciones ? inicial : null;
  const seccionSituada = useRef<string | null>(null);
  useEffect(() => {
    if (destinoSeccion == null) return;
    const clave = `${busqueda.sec}|${busqueda.par ?? ''}|${busqueda.f ?? ''}`;
    if (seccionSituada.current === clave) return;
    seccionSituada.current = clave;
    const h = window.setTimeout(() => flujo.current?.irA(destinoSeccion), 30);
    return () => window.clearTimeout(h);
  }, [destinoSeccion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⇧⌘C: copiar la referencia de este documento, desde cualquier parte del lector.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); void copiarReferencia(id); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [id]);

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
    // Cada salto pasa la hoja, hacia delante o hacia atrás.
    const saltar = (o: number) => { flujo.current?.irA(o, true); hojear(zona.current, o >= actual); return true; };
    const fisica = /^\[(\d+)\]$/.exec(t);
    if (fisica) return saltar(Number(fisica[1]));
    const f = folios?.folios.find((x) => x.impresa?.toLowerCase() === t);
    if (f) return saltar(f.orden);
    if (/^\d+$/.test(t) && Number(t) <= doc.unidades && !folios?.folios.some((x) => x.impresa)) return saltar(Number(t));
    return false;
  }

  const abrirPanel = (p: Panel) => { setPanel((x) => (x === p ? null : p)); ponerPreferencia('panel', panel === p ? 'cerrado' : 'abierto'); };
  const resumen: ResumenDocumento = { id: doc.id, tipo: doc.tipo, estado: doc.estado, titulo: doc.metadatos.titulo, autores: autores(doc.metadatos), unidades: doc.unidades, bytes: doc.bytes, creado: doc.creado, actualizado: doc.actualizado, bibliotecas: doc.bibliotecas };

  return (
    <div className="min-h-dvh">
      {/* Barra del lector */}
      <div className="sticky top-14 z-30 border-b border-cream-300 bg-cream-50/90 shadow-[var(--shadow-soft)] backdrop-blur lg:top-0">
        <div className="flex h-[4.25rem] items-center gap-2 px-3 md:gap-3 md:px-6">
          {rb ? (
            <Consejo texto="Volver a los resultados (Esc)">
              <button type="button" onClick={volverAResultados} aria-label="Volver a los resultados" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="izquierda" tam={18} /></button>
            </Consejo>
          ) : (
            <Consejo texto="Volver a la biblioteca">
              <Link to="/" aria-label="Volver a la biblioteca" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="izquierda" tam={18} /></Link>
            </Consejo>
          )}
          {/* La portada en pequeño: aquí aterriza la de la Biblioteca al abrir el documento. */}
          <span data-compartido="portada" aria-hidden className="hidden h-11 w-8 shrink-0 overflow-hidden rounded-r-md rounded-l-sm border border-cream-400 shadow-[var(--shadow-soft)] [container-type:inline-size] sm:block">
            <Portada id={doc.id} titulo="" tipo={doc.tipo} url={doc.portadaUrl} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[0.9375rem] font-semibold leading-tight text-coffee-800">{doc.metadatos.titulo}</h1>
            <p className="truncate text-[0.75rem] text-coffee-500">{autores(doc.metadatos) || 'Sin autor'} · {anioVisible(doc.metadatos)}{contenedorVisible(doc.metadatos) ? <> · <em>{contenedorVisible(doc.metadatos)}</em></> : null} · <span className="text-apagado">{NOMBRE_TIPO[doc.tipo]}</span></p>
          </div>

          <span className="relative">
            <IrA etiqueta={etiquetaActual} total={medio ? tiempoACadena(doc.duracion ?? 0) : String(Math.max(doc.unidades, ingesta?.unidades ?? 0))} alIr={irA} medio={medio} />
            {/* La primera vez: el folio se puede pulsar para ir a cualquier página. */}
            <NotaMargen id="lector-folio" nombre="nota-folio" className="left-1/2 top-full mt-1 hidden w-28 -translate-x-1/2 md:block" espera={1600} />
          </span>

          {paginado ? (
            <div role="group" aria-label="Modo de lectura" className="hidden rounded-xl border border-cream-400 bg-cream-200/70 p-1 shadow-[var(--hundido)] md:flex">
              {(['pagina', 'ambas', 'texto'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={modo === m} onClick={() => { setModo(m); ponerPreferencia('modo', m); }} className={cx('h-8 rounded-md px-2.5 text-[0.8125rem]', modo === m ? 'bg-cream-50 font-semibold text-coffee-800 shadow-[var(--relieve)]' : 'font-medium text-coffee-500 hover:text-coffee-800')}>
                  {m === 'pagina' ? 'Página' : m === 'ambas' ? 'Página y texto' : 'Texto'}
                </button>
              ))}
            </div>
          ) : null}

          <BotonReferencia documento={doc.id} className="hidden md:flex" />
          <Consejo texto="Todo lo que contiene el .spdf: páginas, fragmentos, figuras, vectores, procedencia">
            <Link to="/documentos/$id/contenido" params={{ id: doc.id }} aria-label="Ver todo el SPDF" className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[0.8125rem] font-medium text-coffee-500 hover:bg-cream-200 hover:text-coffee-800 md:flex"><Icono nombre="pila" tam={16} /><span className="hidden 2xl:inline">Todo el SPDF</span></Link>
          </Consejo>
          <div className="hidden items-center gap-1 sm:flex">
            <BotonPanel activo={panel === 'indice'} icono="indice" etiqueta="Índice" alPulsar={() => abrirPanel('indice')} />
            {doc.cuentas.figuras > 0 ? <BotonPanel activo={panel === 'figuras'} icono={medio ? 'video' : 'figura'} etiqueta={medio ? 'Fotogramas' : 'Figuras'} alPulsar={() => abrirPanel('figuras')} /> : null}
            <BotonPanel activo={panel === 'ficha'} icono="editar" etiqueta="Ficha" alPulsar={() => abrirPanel('ficha')} />
          </div>
          <MenuDocumento doc={resumen} bibliotecas={bibliotecas}>
            <button type="button" aria-label="Más acciones" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-coffee-500 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="opciones" tam={18} /></button>
          </MenuDocumento>
        </div>
        {rb ? <BarraRecorrido contexto={rb} posicion={pos} total={lista.length} alAnterior={() => irAResultado(pos - 1)} alSiguiente={() => irAResultado(pos + 1)} alVolver={volverAResultados} /> : null}
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
          <div className="flex items-center gap-3 border-t border-cream-300 bg-amarillo-suave/70 px-4 py-2 text-[0.8125rem] text-coffee-700 md:px-6">
            <span className="h-2 w-2 shrink-0 rounded-full bg-rojo anim-pulso" />
            <span>{ingesta?.preparadas && !ingesta.leidas ? 'Estás viendo la vista previa de tu navegador. Scholaris sigue leyendo; en cuanto termine se podrá buscar y citar.' : `Se está leyendo${ingesta?.leidas ? `: ${ingesta.leidas} de ${ingesta.unidades ?? doc.unidades}` : ''}. Ya puedes leerlo; se podrá buscar y citar en cuanto termine.`}</span>
          </div>
        ) : null}
      </div>

      <div className="flex">
        <div ref={medio ? undefined : zona} data-compartido="lectura" className={cx('min-w-0 flex-1 px-5 md:px-12', !medio && 'pb-24')}>
          {medio ? (
            <Reproductor ref={reproductor} doc={doc} inicial={busqueda.t} resaltar={busqueda.q} {...(pasaje ? { pasaje: pasaje.texto } : {})} alVer={alVerMedio} {...(ingesta?.unidades ? { pendientes: Math.max(0, ingesta.unidades - (ingesta.leidas ?? 0)) } : {})} />
          ) : (
            <ProveedorEntidades documento={doc.id}>
              <Flujo ref={flujo} doc={doc} modo={modo} inicial={inicial} resaltar={busqueda.q} {...(pasaje ? { pasaje: pasaje.texto, contextoPasaje: pasaje.contexto } : {})} leidas={ingesta ? ingesta.leidas : undefined} total={ingesta?.unidades ?? undefined} alVer={alVer} />
            </ProveedorEntidades>
          )}
        </div>
        {panel ? (
          <aside aria-label="Panel del documento" className="sticky top-[4.25rem] hidden h-[calc(100dvh-4.25rem)] w-[23rem] shrink-0 flex-col border-l border-cream-300 bg-cream-50/95 shadow-[-4px_0_16px_rgb(44_24_16/0.05)] xl:flex">
            <PanelDocumento doc={doc} panel={panel} setPanel={setPanel} irA={(o) => { flujo.current?.irA(o, true); hojear(zona.current, o >= actual); }} irT={(t) => reproductor.current?.irA(t)} actual={actual} />
          </aside>
        ) : null}
      </div>

      {/* En pantallas sin hueco lateral, el panel es una hoja que sube. */}
      <Dialog.Root open={!!panel && typeof window !== 'undefined' && window.innerWidth < 1280} onOpenChange={(v) => !v && setPanel(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(26_21_17/0.38)] xl:hidden anim-aparece" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-2xl border-t border-cream-400 bg-cream-50 shadow-[var(--levantado-alto)] xl:hidden anim-tostada">
            <Dialog.Title className="sr-only">Panel del documento</Dialog.Title>
            {panel ? <PanelDocumento doc={doc} panel={panel} setPanel={setPanel} irA={(o) => { setPanel(null); flujo.current?.irA(o, true); hojear(zona.current, o >= actual); }} irT={(t) => { setPanel(null); reproductor.current?.irA(t); }} actual={actual} /> : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Botón de panel en el móvil */}
      <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-20 flex gap-2 sm:hidden">
        {paginado ? <Boton variante="linea" tam="m" soloIcono icono={modo === 'pagina' ? 'documento' : 'imagen'} aria-label={modo === 'pagina' ? 'Ver el texto' : 'Ver la página escaneada'} aria-pressed={modo === 'pagina'} className="bg-papel" onClick={() => setModo((m) => (m === 'pagina' ? 'ambas' : 'pagina'))} /> : null}
        <Boton variante="tinta" tam="m" icono="indice" onClick={() => setPanel('indice')}>Índice</Boton>
        <Boton variante="linea" tam="m" soloIcono icono="editar" aria-label="Ficha" className="bg-papel" onClick={() => setPanel('ficha')} />
      </div>

      {sel ? <BarraSeleccion sel={sel} documento={id} meta={doc.metadatos} alCerrar={limpiarSel} /> : null}

      <Dialogo abierto={ayuda} alCambiar={setAyuda} titulo="Teclas del lector">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-[0.875rem]">
          {ATAJOS_LECTOR.map(([ts, d]) => (
            <div key={d} className="contents">
              <dt className="flex gap-1">{ts.map((t) => <Teclas key={t}>{t}</Teclas>)}</dt>
              <dd className="text-coffee-700">{d}</dd>
            </div>
          ))}
        </dl>
      </Dialogo>
    </div>
  );
}

const ATAJOS_LECTOR: Array<[string[], string]> = [
  [['N'], 'Resultado siguiente (al venir de una búsqueda)'],
  [['P'], 'Resultado anterior'],
  [['Esc'], 'Volver a los resultados'],
  [['⇧', '⌘', 'C'], 'Copiar la referencia del documento'],
  [['/'], 'Buscar'],
  [['⌘', 'K'], 'La paleta: ir a cualquier sitio'],
  [['?'], 'Estas teclas'],
];

/**
 * La barra del recorrido, cuando se llega desde una búsqueda: en qué resultado se
 * está, el anterior y el siguiente (N, P) y la vuelta a la lista (Esc).
 */
function BarraRecorrido({ contexto, posicion, total, alAnterior, alSiguiente, alVolver }: {
  contexto: ContextoBusqueda; posicion: number; total: number; alAnterior: () => void; alSiguiente: () => void; alVolver: () => void;
}) {
  const conLista = posicion >= 0 && total > 0;
  const boton = 'tactil flex h-11 items-center gap-1.5 rounded-xl px-2.5 text-[0.8125rem] font-medium text-coffee-600 hover:bg-cream-200 hover:text-coffee-800 disabled:pointer-events-none disabled:opacity-40 md:h-8';
  return (
    <nav aria-label="Recorrido de los resultados" className="flex items-center gap-1 border-t border-cream-300 bg-cream-100/80 px-2 py-1 md:gap-2 md:px-6">
      <button type="button" onClick={alVolver} className={cx(boton, 'min-w-0')}>
        <Icono nombre="lista" tam={15} className="shrink-0" />
        <span className="hidden sm:inline">Volver a los resultados</span><span className="sm:hidden">Resultados</span>
        <span className="hidden min-w-0 truncate text-apagado lg:inline">de «{contexto.q}»</span>
      </button>
      {conLista ? (
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={alAnterior} disabled={posicion <= 0} aria-label="Resultado anterior (P)" className={boton}><Icono nombre="izquierda" tam={15} /><span className="hidden md:inline">Anterior</span></button>
          <span aria-live="polite" className="dato min-w-[7.5rem] rounded-lg bg-cream-50 px-2.5 py-1 text-center text-[0.75rem] text-coffee-700 shadow-[var(--hundido)]">
            Resultado <span key={posicion} className="anim-folio inline-block font-semibold">{posicion + 1}</span> de {total}
          </span>
          <button type="button" onClick={alSiguiente} disabled={posicion + 1 >= total} aria-label="Resultado siguiente (N)" className={boton}><span className="hidden md:inline">Siguiente</span><Icono nombre="derecha" tam={15} /></button>
        </div>
      ) : null}
    </nav>
  );
}

function BotonPanel({ activo, icono, etiqueta, alPulsar }: { activo: boolean; icono: 'indice' | 'editar' | 'figura' | 'video'; etiqueta: string; alPulsar: () => void }) {
  return (
    <button type="button" aria-pressed={activo} onClick={alPulsar} className={cx('flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[0.8125rem] font-medium transition-[background,box-shadow]', activo ? 'border-[#1a0f0a] bg-coffee-800 text-cream-50 shadow-[inset_0_1px_3px_rgb(0_0_0/0.35)]' : 'border-transparent text-coffee-500 hover:bg-cream-200 hover:text-coffee-800')}>
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
          placeholder={medio ? '12:04' : '145, xiv o [153]'} className={cx('h-9 w-32 rounded-xl border bg-cream-50 px-3 font-mono text-[0.875rem] shadow-[var(--hundido)] outline-none', error ? 'border-rojo' : 'border-coffee-500')} aria-invalid={error} />
        {error ? <span role="alert" className="sr-only">No existe esa página.</span> : null}
      </form>
    );
  }
  return (
    <Consejo texto={medio ? 'Ir a un instante' : 'Ir a una página impresa (145, xiv) o física ([153])'}>
      <button type="button" onClick={() => setEditando(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 hover:bg-cream-200" aria-label={`${etiqueta} / ${total}: ir a otra ${medio ? 'posición' : 'página'}`}>
        {/* El folio cambia como un contador: el nuevo sube y el viejo se va (key). */}
        <Folio grande className="overflow-hidden"><span key={etiqueta} className="anim-folio inline-block">{etiqueta}</span></Folio>
        <span className="hidden font-mono text-[0.75rem] text-apagado sm:inline">/ {total}</span>
      </button>
    </Consejo>
  );
}


function PanelDocumento({ doc, panel, setPanel, irA, irT, actual }: { doc: DetalleDocumento; panel: Panel; setPanel: (p: Panel | null) => void; irA: (o: number) => void; irT: (t: number) => void; actual: number }) {
  const { data: secciones, isPending } = useQuery(q.secciones(doc.id));
  const { data: figuras } = useQuery({ ...q.figuras(doc.id), enabled: panel === 'figuras' || doc.cuentas.figuras > 0 });
  const { data: folios } = useQuery(q.folios(doc.id));
  const pestanas: Array<[Panel, string]> = [['indice', 'Índice'], ...(figuras?.length || doc.cuentas.figuras > 0 ? [['figuras', esMedio(doc.tipo) ? 'Fotogramas' : 'Figuras'] as [Panel, string]] : []), ['ficha', 'Ficha']];
  const etiqueta = (orden: number, m?: MapaFolios) => {
    const f = m?.folios[orden - 1];
    if (esMedio(doc.tipo)) return f?.t0 != null ? tiempoACadena(f.t0) : '';
    return f?.impresa ? `p. ${f.impresa}` : doc.tipo === 'presentacion' ? `diap. ${orden}` : `[${orden}]`;
  };
  const enCurso = secciones ? [...secciones].reverse().find((s) => s.unidadDesde <= actual) : undefined;
  return (
    <>
      <div className="flex items-center gap-1 border-b border-cream-300 px-3 py-2.5"><div className="flex gap-1 rounded-xl border border-cream-400 bg-cream-200/70 p-1 shadow-[var(--hundido)]">
        {pestanas.map(([p, n]) => (
          <button key={p} type="button" onClick={() => setPanel(p)} aria-pressed={panel === p} className={cx('relative h-12 px-3 text-[0.9375rem]', panel === p ? ' text-tinta' : 'text-tinta-2 hover:text-tinta')}>
            {n}{panel === p ? <span className="absolute inset-x-2 bottom-0 h-[3px] bg-tinta" /> : null}
          </button>
        ))}
        </div>
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
                    className={cx('group flex w-full items-baseline gap-3 rounded-lg py-2 pr-2 text-left transition-colors hover:bg-cream-200', s.nivel > 1 ? 'pl-5 text-[0.8125rem] text-coffee-500' : 'pl-2 text-[0.875rem] font-medium text-coffee-700', enCurso?.id === s.id && 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]')}>
                    <span className="min-w-0 flex-1">{enCurso?.id === s.id ? <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rojo align-middle" /> : null}{s.titulo}</span>
                    <span className="dato shrink-0 text-coffee-400">{etiqueta(s.unidadDesde, folios)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )
        ) : panel === 'figuras' ? (
          <PanelFiguras documento={doc.id} actual={actual} alIr={(f) => (f.t !== undefined ? irT(f.t) : irA(f.unidad))} />
        ) : (
          <Ficha doc={doc} />
        )}
      </div>
    </>
  );
}
