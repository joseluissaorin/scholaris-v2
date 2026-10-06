import { lazy, Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { TipoEntrada } from '@scholaris/nucleo';
import type { Biblioteca, ResumenDocumento } from '@scholaris/contrato';
import {
  avisar, Boton, Campo, Chip, Composicion, cx, Dialogo, Esqueleto, Folio, Icono, MenuContenido, MenuDisparador, MenuElemento, MenuRaiz, Rotulo, Tarjeta, Teclas, Vacio,
} from '@scholaris/ui';
import { q } from '../datos/consultas';
import { api } from '../datos/api';
import { recuperarTareas, useIngestas } from '../datos/ingesta';
import { disparar, ponerBibliotecaActiva } from '../lib/acciones';
import { Cabecera } from '../componentes/comunes/cabecera';
import { FichaDocumento, FilaDocumento, puntoColeccion } from '../componentes/biblioteca/documento';
import { TarjetaIngesta } from '../componentes/biblioteca/ingesta';
import { TECLA_MOD } from '../componentes/marco/navegacion';
import { numero } from '../lib/numero';
import { IconoTipo } from '../componentes/comunes/icono-tipo';
import { bytes } from '../lib/formato';

const Compartir = lazy(() => import('../componentes/biblioteca/compartir'));

const GRUPOS: Array<{ id: string; nombre: string; tipos: TipoEntrada[]; punto?: 'rojo' | 'azul' | 'amarillo' | 'tinta' }> = [
  { id: 'libros', nombre: 'Libros y artículos', tipos: ['pdf', 'epub'], punto: 'azul' },
  { id: 'escaneos', nombre: 'Escaneos y fotos', tipos: ['pdf_escaneado', 'fotos', 'imagen'], punto: 'tinta' },
  { id: 'medios', nombre: 'Audio y vídeo', tipos: ['audio', 'video'], punto: 'rojo' },
  { id: 'textos', nombre: 'Textos y web', tipos: ['documento', 'web'], punto: 'amarillo' },
  { id: 'otros', nombre: 'Diapositivas y hojas', tipos: ['presentacion', 'hoja'] },
];

type Orden = 'recientes' | 'titulo' | 'autor' | 'anio';
const ORDENES: Record<Orden, string> = { recientes: 'Añadidos hace poco', titulo: 'Título', autor: 'Autor', anio: 'Año de la obra' };

interface BusquedaBiblioteca { q?: string; grupo?: string; col?: string; orden?: Orden; vista?: 'rejilla' | 'lista' }

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>): BusquedaBiblioteca => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    grupo: typeof s.grupo === 'string' ? s.grupo : undefined,
    col: typeof s.col === 'string' ? s.col : undefined,
    orden: (['recientes', 'titulo', 'autor', 'anio'] as const).includes(s.orden as Orden) ? (s.orden as Orden) : undefined,
    vista: s.vista === 'lista' ? 'lista' : undefined,
  }),
  // La mesa de entrada se conoce antes del primer pintado: nada empuja la rejilla después.
  loader: async ({ context }) => {
    void context.consultas.prefetchQuery(q.bibliotecas());
    await Promise.all([context.consultas.ensureQueryData(q.documentos()), recuperarTareas()]);
  },
  component: PaginaBiblioteca,
});

const normal = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function ordenar(lista: ResumenDocumento[], orden: Orden) {
  const c = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const apellido = (d: ResumenDocumento) => d.autores.split(',')[0]?.trim().split(' ').at(-1) ?? '';
  switch (orden) {
    case 'titulo': return [...lista].sort((a, b) => c.compare(a.titulo, b.titulo));
    case 'autor': return [...lista].sort((a, b) => c.compare(apellido(a), apellido(b)) || c.compare(a.titulo, b.titulo));
    case 'anio': return [...lista].sort((a, b) => (a.anio ?? 9999) - (b.anio ?? 9999));
    default: return [...lista].sort((a, b) => b.creado.localeCompare(a.creado));
  }
}

function PaginaBiblioteca() {
  const busqueda = Route.useSearch();
  const navegar = useNavigate({ from: '/' });
  const { data, isPending } = useQuery(q.documentos());
  const { data: bibliotecas = [] } = useQuery(q.bibliotecas());
  const ingestas = useIngestas();
  const [texto, setTexto] = useState(busqueda.q ?? '');
  const diferido = useDeferredValue(texto);
  const [nueva, setNueva] = useState(false);
  const [compartir, setCompartir] = useState(false);
  const orden = busqueda.orden ?? 'recientes';
  const vista = busqueda.vista ?? 'rejilla';

  const fijar = (cambio: Partial<BusquedaBiblioteca>) => void navegar({ search: (s) => ({ ...s, ...cambio }), replace: true });

  // Las subidas van a la colección que se está mirando.
  useEffect(() => { ponerBibliotecaActiva(busqueda.col); return () => ponerBibliotecaActiva(undefined); }, [busqueda.col]);
  // El filtro de texto se refleja en la URL sin bloquear la escritura.
  useEffect(() => { const h = setTimeout(() => fijar({ q: texto || undefined }), 300); return () => clearTimeout(h); }, [texto]); // eslint-disable-line react-hooks/exhaustive-deps

  const todos = data?.elementos ?? [];
  const enMesa = new Set(ingestas.map((i) => i.documento).filter(Boolean));
  const visibles = useMemo(() => {
    let l = todos.filter((d) => !enMesa.has(d.id) || d.estado === 'listo');
    const g = GRUPOS.find((x) => x.id === busqueda.grupo);
    if (g) l = l.filter((d) => g.tipos.includes(d.tipo));
    if (busqueda.col) l = l.filter((d) => d.bibliotecas.includes(busqueda.col!));
    const t = normal(diferido.trim());
    if (t) l = l.filter((d) => normal(`${d.titulo} ${d.autores} ${d.anio ?? ''}`).includes(t));
    return ordenar(l, orden);
  }, [todos, busqueda.grupo, busqueda.col, diferido, orden, ingestas]); // eslint-disable-line react-hooks/exhaustive-deps

  const recuento = (g: (typeof GRUPOS)[number]) => todos.filter((d) => g.tipos.includes(d.tipo)).length;
  const coleccion = bibliotecas.find((b) => b.id === busqueda.col);
  const vacia = !isPending && !todos.length && !ingestas.length;

  const paginas = todos.reduce((t, d) => t + (d.tipo === 'audio' || d.tipo === 'video' ? 0 : d.unidades), 0);
  const horas = todos.reduce((t, d) => t + (d.duracion ?? 0), 0) / 3600;
  const ocupado = todos.reduce((t, d) => t + d.bytes, 0);

  return (
    <>
      <Cabecera antetitulo={coleccion ? `Colección${coleccion.compartida ? ' compartida' : ''} · ${coleccion.documentos} documentos` : 'Todo lo que has leído, buscable y citable'} titulo={coleccion?.nombre ?? 'Biblioteca'} forma="cuarto" />

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:px-6 lg:px-10">
        {!vacia ? (
          <div className="space-y-3">
            <Campo
              icono="filtro"
              placeholder="Filtrar por título, autor o año"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              aria-label="Filtrar la biblioteca"
              className="[&_input]:h-12"
              sufijo={texto ? <button type="button" aria-label="Borrar el filtro" onClick={() => setTexto('')} className="grid h-8 w-8 place-items-center rounded-lg text-coffee-400 hover:bg-cream-200 hover:text-coffee-800"><Icono nombre="cerrar" tam={14} /></button> : undefined}
            />
            {/* La banda de cifras de siempre */}
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 pt-1 text-[0.8125rem] text-coffee-400">
              <span><strong className="tnum text-[0.9375rem] font-semibold text-coffee-800">{numero(todos.length)}</strong> documentos</span>
              <span><strong className="tnum text-[0.9375rem] font-semibold text-coffee-800">{numero(bibliotecas.length)}</strong> colecciones</span>
              <span><strong className="tnum text-[0.9375rem] font-semibold text-coffee-800">{numero(paginas)}</strong> páginas</span>
              {horas >= 0.1 ? <span><strong className="tnum text-[0.9375rem] font-semibold text-coffee-800">{numero(horas, { maximumFractionDigits: 1 })}</strong> horas de audio y vídeo</span> : null}
              <span className="ml-auto text-coffee-400">{bytes(ocupado)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-cream-300 pb-4">
              <div className="sin-barra -mx-4 flex min-w-0 basis-full gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-1 sm:basis-0 sm:flex-wrap sm:px-0">
                <Chip activo={!busqueda.grupo} onClick={() => fijar({ grupo: undefined })}>Todo</Chip>
                {GRUPOS.map((g) => { const n = recuento(g); return n ? <Chip key={g.id} punto={g.punto} activo={busqueda.grupo === g.id} recuento={n} onClick={() => fijar({ grupo: busqueda.grupo === g.id ? undefined : g.id })}>{g.nombre}</Chip> : null; })}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <MenuRaiz>
                  <MenuDisparador asChild>
                    <Boton variante="fantasma" tam="p" icono="ordenar">{ORDENES[orden]}</Boton>
                  </MenuDisparador>
                  <MenuContenido>
                    {(Object.keys(ORDENES) as Orden[]).map((o) => (
                      <MenuElemento key={o} icono={o === orden ? 'hecho' : undefined} alElegir={() => fijar({ orden: o === 'recientes' ? undefined : o })}>{ORDENES[o]}</MenuElemento>
                    ))}
                  </MenuContenido>
                </MenuRaiz>
                <div role="group" aria-label="Vista" className="flex rounded-lg border border-cream-400 bg-cream-200/70 p-0.5 shadow-[var(--hundido)]">
                  <button type="button" aria-pressed={vista === 'rejilla'} aria-label="Rejilla" onClick={() => fijar({ vista: undefined })} className={cx('grid h-7 w-7 place-items-center rounded-md', vista === 'rejilla' ? 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-400 hover:text-coffee-800')}><Icono nombre="cuadricula" tam={14} /></button>
                  <button type="button" aria-pressed={vista === 'lista'} aria-label="Lista" onClick={() => fijar({ vista: 'lista' })} className={cx('grid h-7 w-7 place-items-center rounded-md', vista === 'lista' ? 'bg-cream-50 text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-400 hover:text-coffee-800')}><Icono nombre="lista" tam={14} /></button>
                </div>
              </div>
            </div>
            {/* Colecciones en el móvil: en fila, como las acciones de siempre */}
            <div className="sin-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
              <Chip activo={!busqueda.col} onClick={() => fijar({ col: undefined })}>Toda la biblioteca</Chip>
              {bibliotecas.map((b) => <Chip key={b.id} punto={(b.color as 'rojo') ?? 'tinta'} activo={busqueda.col === b.id} onClick={() => fijar({ col: busqueda.col === b.id ? undefined : b.id })}>{b.nombre}</Chip>)}
              <Chip icono="mas" onClick={() => setNueva(true)}>Nueva</Chip>
            </div>
          </div>
        ) : null}

        <div className={cx('mt-6 grid grid-cols-1 gap-8', !vacia && 'lg:grid-cols-[minmax(0,1fr)_13.5rem]')}>
          <div className="min-w-0">
            {/* La mesa de entrada */}
            {ingestas.length ? (
              <section aria-label="En la imprenta" className="mb-8">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="rotulo text-[0.75rem] text-coffee-700">En la imprenta</h2>
                  <span className="text-[0.75rem] text-coffee-400">{ingestas.filter((i) => i.etapa !== 'listo').length} en curso<span className="hidden sm:inline"> · las páginas se pueden leer en cuanto aparecen</span></span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {ingestas.map((i) => <TarjetaIngesta key={i.id} i={i} />)}
                </div>
              </section>
            ) : null}

            {!vacia ? (
              <div className="mb-3 flex items-center justify-between">
                <h2 className="rotulo text-[0.75rem] text-coffee-700">{coleccion ? coleccion.nombre : busqueda.grupo ? GRUPOS.find((g) => g.id === busqueda.grupo)?.nombre : 'Documentos'}</h2>
                <span className="text-[0.75rem] text-coffee-400">{numero(visibles.length)} {visibles.length === 1 ? 'documento' : 'documentos'}</span>
              </div>
            ) : null}

            {isPending ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => <div key={i}><Esqueleto className="aspect-[3/4] rounded-xl" /><Esqueleto className="mt-3 h-4 w-4/5" /><Esqueleto className="mt-2 h-3 w-1/2" /></div>)}
              </div>
            ) : vacia ? (
              <BibliotecaVacia />
            ) : !visibles.length ? (
              <Vacio estilo="kandinsky" titulo="Nada coincide con el filtro." accion={<Boton variante="linea" onClick={() => { setTexto(''); fijar({ grupo: undefined, col: undefined, q: undefined }); }}>Quitar los filtros</Boton>}>
                {diferido ? <>Ningún título ni autor contiene «{diferido}». Para buscar dentro de los textos, usa <strong>Buscar</strong>.</> : 'Prueba con otra colección o tipo.'}
              </Vacio>
            ) : vista === 'lista' ? (
              <ListaVirtual docs={visibles} bibliotecas={bibliotecas} />
            ) : (
              <RejillaVirtual docs={visibles} bibliotecas={bibliotecas} />
            )}
          </div>

          {/* La columna de siempre: acciones y colecciones */}
          {!vacia ? (
            <aside className="hidden space-y-6 lg:block">
              <div>
                <h2 className="rotulo mb-2.5 text-[0.75rem] text-coffee-700">Acciones</h2>
                <div className="space-y-0.5">
                  {([['subir', 'Añadir documentos', () => disparar('archivos')], ['enlace', 'Desde un enlace', () => disparar('enlace')], ['pila', 'Importar un .spdf', () => disparar('spdf')], ['buscar', 'Búsqueda semántica', () => disparar('paleta')]] as const).map(([i, t, f]) => (
                    <button key={t} type="button" onClick={f} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.8125rem] text-coffee-600 transition-colors hover:bg-cream-200 hover:text-coffee-800">
                      <Icono nombre={i} tam={16} className="text-coffee-400" />{t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <h2 className="rotulo text-[0.75rem] text-coffee-700">Colecciones</h2>
                  <button type="button" onClick={() => setNueva(true)} className="text-[0.75rem] text-coffee-400 hover:text-coffee-700">Nueva</button>
                </div>
                <div className="space-y-0.5">
                  <button type="button" onClick={() => fijar({ col: undefined })} className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.8125rem] transition-colors', !busqueda.col ? 'bg-cream-50 font-semibold text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-600 hover:bg-cream-200')}>
                    <Icono nombre="biblioteca" tam={15} className="text-coffee-400" /><span className="flex-1">Toda la biblioteca</span><span className="tnum text-[0.75rem] text-coffee-400">{todos.length}</span>
                  </button>
                  {bibliotecas.map((b) => (
                    <button key={b.id} type="button" onClick={() => fijar({ col: busqueda.col === b.id ? undefined : b.id })} className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.8125rem] transition-colors', busqueda.col === b.id ? 'bg-cream-50 font-semibold text-coffee-800 shadow-[var(--relieve)]' : 'text-coffee-600 hover:bg-cream-200')}>
                      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', puntoColeccion(b.color))} />
                      <span className="min-w-0 flex-1 truncate">{b.nombre}</span>
                      {b.compartida ? <Icono nombre="enlace" tam={12} titulo="Compartida" className="text-coffee-300" /> : null}
                      <span className="tnum text-[0.75rem] text-coffee-400">{b.documentos}</span>
                    </button>
                  ))}
                  {!bibliotecas.length ? <p className="px-3 py-2 text-[0.75rem] text-coffee-400">Aún no hay colecciones.</p> : null}
                </div>
                {coleccion && coleccion.permiso === 'propietario' ? <Boton variante="linea" tam="p" icono="enlace" className="mt-3 w-full" onClick={() => setCompartir(true)}>Compartir «{coleccion.nombre}»</Boton> : null}
                {coleccion && coleccion.permiso !== 'propietario' ? <p className="mt-3 px-3 text-[0.75rem] text-coffee-400">Compartida contigo · {coleccion.permiso === 'edicion' ? 'puedes editar' : 'solo lectura'}</p> : null}
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <NuevaColeccion abierta={nueva} alCambiar={setNueva} />
      {compartir && coleccion ? <Suspense fallback={null}><Compartir biblioteca={coleccion} alCerrar={() => setCompartir(false)} /></Suspense> : null}
    </>
  );
}

function columnasPara(ancho: number) {
  return ancho >= 1500 ? 7 : ancho >= 1180 ? 6 : ancho >= 960 ? 5 : ancho >= 720 ? 4 : ancho >= 460 ? 3 : 2;
}

/** Rejilla virtualizada por filas: mil documentos cuestan lo mismo que veinte. */
function RejillaVirtual({ docs, bibliotecas }: { docs: ResumenDocumento[]; bibliotecas: Biblioteca[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [margen, setMargen] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const medir = () => { setAncho(el.clientWidth); setMargen(el.getBoundingClientRect().top + window.scrollY); };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = columnasPara(ancho || 1200);
  const hueco = 20;
  const anchoFicha = ((ancho || 1200) - hueco * (cols - 1)) / cols;
  const filas = Math.ceil(docs.length / cols);
  const v = useWindowVirtualizer({ count: filas, estimateSize: () => anchoFicha * (4 / 3) + 104, overscan: 3, scrollMargin: margen });

  return (
    <div ref={ref} className="relative" style={{ height: v.getTotalSize() }}>
      {v.getVirtualItems().map((fila) => (
        <div
          key={fila.key}
          data-index={fila.index}
          ref={v.measureElement}
          className="absolute inset-x-0 grid pb-8"
          style={{ transform: `translateY(${fila.start - v.options.scrollMargin}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: hueco }}
        >
          {docs.slice(fila.index * cols, fila.index * cols + cols).map((d, k) => <FichaDocumento key={d.id} doc={d} bibliotecas={bibliotecas} indice={fila.index * cols + k} />)}
        </div>
      ))}
    </div>
  );
}

function ListaVirtual({ docs, bibliotecas }: { docs: ResumenDocumento[]; bibliotecas: Biblioteca[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [margen, setMargen] = useState(0);
  useLayoutEffect(() => { setMargen((ref.current?.getBoundingClientRect().top ?? 0) + window.scrollY); }, []);
  const v = useWindowVirtualizer({ count: docs.length, estimateSize: () => 64, overscan: 10, scrollMargin: margen });
  return (
    <div>
      <div className="hidden grid-cols-[2.5rem_minmax(0,3fr)_minmax(0,2fr)_4.5rem_11rem_8.5rem] gap-4 rounded-t-xl border border-b-0 border-cream-300 bg-cream-200/60 px-4 py-2.5 sm:grid">
        <span /><Rotulo>Título</Rotulo><Rotulo>Autoría</Rotulo><Rotulo>Año</Rotulo><Rotulo>Tipo</Rotulo><Rotulo className="text-right">Añadido</Rotulo>
      </div>
      <div ref={ref} className="relative overflow-hidden rounded-b-xl border border-cream-300 shadow-[var(--shadow-soft)] max-sm:rounded-t-xl" style={{ height: v.getTotalSize() + 2 }}>
        {v.getVirtualItems().map((f) => (
          <div key={f.key} className="absolute inset-x-0" style={{ transform: `translateY(${f.start - v.options.scrollMargin}px)` }}>
            <FilaDocumento doc={docs[f.index]!} bibliotecas={bibliotecas} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** La biblioteca vacía: una zona de soltar hundida en el papel, con su composición. */
function BibliotecaVacia() {
  return (
    <div className="relative grid gap-8 overflow-hidden rounded-2xl border-2 border-dashed border-cream-500 bg-cream-200/50 p-8 shadow-[var(--hundido)] md:grid-cols-[1.1fr_1fr] md:p-12">
      <div>
        <Composicion estilo="malevich" className="mb-6 h-24 w-36" />
        <h2 className="text-[1.5rem] font-bold tracking-[-0.01em] text-coffee-800">Suelta cualquier cosa en esta ventana.</h2>
        <p className="mt-3 max-w-md text-[0.9375rem] text-coffee-600">Un PDF, un libro escaneado, las fotos de un capítulo, la grabación de una clase, un DOCX, un enlace. Lo leemos y cada cita apuntará a la página impresa o al segundo exacto.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Boton variante="tinta" tam="g" icono="subir" onClick={() => disparar('archivos')}>Elegir archivos</Boton>
          <Boton variante="linea" tam="g" icono="enlace" onClick={() => disparar('enlace')}>Pegar un enlace</Boton>
        </div>
        <p className="mt-4 text-[0.8125rem] text-apagado">También puedes pegar con <Teclas>{TECLA_MOD}</Teclas> <Teclas>V</Teclas> en cualquier parte.</p>
      </div>
      <ul className="grid grid-cols-2 content-center gap-3">
        {[['documento', 'PDF y escaneos', 'p. 145'], ['camara', 'Fotos de un libro', 'p. 23'], ['audio', 'Audio', '12:04'], ['video', 'Vídeo', '1:02:41'], ['lector', 'EPUB y DOCX', 'cap. 3, párr. 2'], ['diapositiva', 'Diapositivas', 'diap. 7']].map(([i, n, f]) => (
          <li key={n}>
            <Tarjeta className="flex flex-col gap-2 p-3.5">
              <IconoTipo nombre={i as 'documento'} />
              <span className="text-[0.875rem] font-medium">{n}</span>
              <Folio className="self-start">{f}</Folio>
            </Tarjeta>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NuevaColeccion({ abierta, alCambiar }: { abierta: boolean; alCambiar: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navegar = useNavigate({ from: '/' });
  const [nombre, setNombre] = useState('');
  const [color, setColor] = useState('rojo');
  async function crear() {
    if (!nombre.trim()) return;
    alCambiar(false);
    try {
      const b = await api().bibliotecas.crear({ nombre: nombre.trim(), color });
      qc.setQueryData<Biblioteca[]>(['bibliotecas'], (l) => [...(l ?? []), b]);
      void navegar({ search: (s) => ({ ...s, col: b.id }) });
      avisar(`Colección «${b.nombre}» creada. Lo que añadas ahora irá a ella.`, { tono: 'exito' });
    } catch { avisar('No se pudo crear la colección.', { tono: 'error' }); }
    setNombre('');
  }
  return (
    <Dialogo abierto={abierta} alCambiar={alCambiar} titulo="Nueva colección" descripcion="Agrupa documentos por proyecto, curso o seminario. Un documento puede estar en varias."
      pie={<><Boton variante="fantasma" onClick={() => alCambiar(false)}>Cancelar</Boton><Boton variante="tinta" disabled={!nombre.trim()} onClick={() => void crear()}>Crear</Boton></>}>
      <form onSubmit={(e) => { e.preventDefault(); void crear(); }} className="flex flex-col gap-4">
        <Campo autoFocus placeholder="Por ejemplo: TFG, Seminario de Blanco…" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre de la colección" />
        <div role="radiogroup" aria-label="Color" className="flex gap-2">
          {['rojo', 'azul', 'amarillo', 'tinta'].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} className={cx('h-8 w-8 rounded-full ring-offset-2 ring-offset-hoja', puntoColeccion(c), color === c && 'ring-2 ring-tinta')} />
          ))}
        </div>
      </form>
    </Dialogo>
  );
}
