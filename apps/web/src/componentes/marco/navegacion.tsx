/**
 * La barra lateral de siempre: café oscuro, el logo dibujado a mano, los
 * lugares con su icono y la marca amarilla del activo, y abajo la cuenta.
 * En el móvil, la cabecera oscura con el menú que se despliega, y un botón
 * redondo para añadir.
 */
import { cloneElement, lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { cx, Icono, type NombreIcono } from '@scholaris/ui';
import { disparar } from '../../lib/acciones';
import { useSesion } from '../../sesion';
import { esSimulado } from '../../datos/api';
import { q } from '../../datos/consultas';
import { Logo } from './logo';

type Destino = '/' | '/buscar' | '/escribir' | '/explorar' | '/ajustes';

export const SECCIONES: Array<{ a: Destino; etiqueta: string; icono: NombreIcono; sub?: Array<{ a: string; etiqueta: string }> }> = [
  { a: '/', etiqueta: 'Biblioteca', icono: 'biblioteca' },
  { a: '/buscar', etiqueta: 'Buscar', icono: 'buscar', sub: [{ a: '/buscar/vigilantes', etiqueta: 'Vigilantes' }, { a: '/buscar/historial', etiqueta: 'Historial' }] },
  { a: '/escribir', etiqueta: 'Escribir', icono: 'escribir', sub: [{ a: '/escribir', etiqueta: 'Autocita' }, { a: '/escribir/cuadernos', etiqueta: 'Cuadernos' }] },
  { a: '/explorar', etiqueta: 'Explorar', icono: 'explorar', sub: [{ a: '/explorar', etiqueta: 'Mapa de conceptos' }, { a: '/explorar/grafo', etiqueta: 'Grafo de citas' }, { a: '/explorar/entidades', etiqueta: 'Personas y obras' }, { a: '/explorar/conceptos', etiqueta: 'Conceptos' }, { a: '/explorar/perspectivas', etiqueta: 'Perspectivas' }, { a: '/explorar/corpus', etiqueta: 'Corpus' }] },
];

const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const TECLA_MOD = esMac ? '⌘' : 'Ctrl';

function useAlertasPendientes() {
  const { data } = useQuery({ ...q.alertas(), staleTime: 60_000 });
  return data?.filter((a) => !a.vista).length ?? 0;
}

/** Menús del marco: se cargan con la intención y en tiempo ocioso (Radix no pesa en el primer pintado). */
const Menus = lazy(() => import('./menus'));
const precargarMenus = () => void import('./menus');
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) requestIdleCallback(precargarMenus, { timeout: 4000 });
  else setTimeout(precargarMenus, 2500);
}

function Perezoso({ tipo, alinear, lado, children }: { tipo: 'anadir' | 'cuenta'; alinear?: 'start' | 'end' | 'center'; lado?: 'right' | 'top' | 'bottom'; children: ReactElement<{ onClick?: () => void; onPointerEnter?: () => void; onFocus?: () => void }> }) {
  const [montado, setMontado] = useState(false);
  if (!montado) return cloneElement(children, { onPointerEnter: precargarMenus, onFocus: precargarMenus, onClick: () => setMontado(true) });
  return <Suspense fallback={children}><Menus tipo={tipo} alinear={alinear} lado={lado} abiertoAlMontar>{children}</Menus></Suspense>;
}

export function MenuAnadir({ children, alinear = 'start', lado }: { children: ReactElement; alinear?: 'start' | 'end' | 'center'; lado?: 'right' | 'top' | 'bottom' }) {
  return <Perezoso tipo="anadir" alinear={alinear} lado={lado}>{children as ReactElement<object>}</Perezoso>;
}

function MenuCuenta({ children, lado }: { children: ReactElement; lado?: 'right' | 'top' | 'bottom' }) {
  return <Perezoso tipo="cuenta" lado={lado}>{children as ReactElement<object>}</Perezoso>;
}

export function useNombre() {
  const s = useSesion();
  const { data: yo } = useQuery({ ...q.yo(), enabled: !s.usuario });
  return s.usuario?.nombre ?? yo?.usuario.nombre;
}

function useCorreo() {
  const s = useSesion();
  const { data: yo } = useQuery({ ...q.yo(), enabled: !s.usuario });
  return s.usuario?.correo || (s.modo === 'local' ? (esSimulado() ? 'Demostración' : 'Versión local') : yo?.usuario.correo);
}

/** El contenido de la barra: el mismo en escritorio y en el cajón del móvil. */
function ContenidoBarra({ alNavegar }: { alNavegar?: () => void }) {
  const ruta = useRouterState({ select: (s) => s.location.pathname });
  const pendientes = useAlertasPendientes();
  const nombre = useNombre();
  const correo = useCorreo();
  const sesion = useSesion();
  const activa = (a: Destino) => (a === '/' ? ruta === '/' || ruta.startsWith('/lector') : ruta.startsWith(a));

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-barra-2 px-5">
        <Logo tam={32} sobreOscuro />
        <span className="text-[1.125rem] font-semibold tracking-wide text-sobre-barra">Scholaris</span>
      </div>

      <div className="flex flex-col gap-2 px-3 pt-4">
        <MenuAnadir lado="right">
          <button type="button" className="flex h-10 items-center gap-2.5 rounded-xl border border-[#9a3128] bg-[linear-gradient(180deg,#cc5246_0%,#b83e33_100%)] px-3 text-[0.875rem] font-semibold text-[#fdf8f1] shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_2px_6px_rgb(0_0_0/0.35)] transition-transform hover:-translate-y-px active:translate-y-px active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.3)]">
            <Icono nombre="mas" tam={17} grosor={2.2} />
            Añadir documentos
          </button>
        </MenuAnadir>
        <button type="button" onClick={() => { disparar('paleta'); alNavegar?.(); }} className="flex h-9 items-center gap-2.5 rounded-xl border border-black/30 bg-black/20 px-3 text-[0.8125rem] text-sobre-barra-2 shadow-[inset_0_2px_4px_rgb(0_0_0/0.35)] hover:text-sobre-barra">
          <Icono nombre="buscar" tam={15} />
          <span className="flex-1 text-left">Buscar en todo</span>
          <kbd className="dato rounded-md border border-white/15 px-1.5 py-0.5 text-[0.625rem] text-sobre-barra-2">{TECLA_MOD} K</kbd>
        </button>
      </div>

      <nav aria-label="Principal" className="sin-barra flex-1 overflow-y-auto px-3 py-3">
        {SECCIONES.map((s, i) => (
          <div key={s.a} className={cx(i > 0 && 'mt-0.5')}>
            <Link
              to={s.a}
              onClick={alNavegar}
              className={cx('relative flex items-center rounded-xl px-3 py-2 text-[0.875rem] font-medium transition-colors duration-150', activa(s.a) ? 'bg-barra-2 text-sobre-barra shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-sobre-barra-2 hover:bg-barra-2 hover:text-sobre-barra')}
              aria-current={activa(s.a) ? 'page' : undefined}
            >
              {activa(s.a) ? <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-amarillo" /> : null}
              <Icono nombre={s.icono} tam={16} className="mr-3" />
              <span className="flex-1">{s.etiqueta}</span>
              {s.a === '/buscar' && pendientes ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amarillo px-1 text-[0.625rem] font-bold text-coffee-800" aria-label={`${pendientes} alertas sin ver`}>{pendientes}</span> : null}
            </Link>
            {s.sub && activa(s.a) ? (
              <ul className="mb-1 ml-[1.375rem] mt-0.5 border-l border-barra-2 pl-3">
                {s.sub.map((x) => (
                  <li key={x.a}>
                    <Link to={x.a} onClick={alNavegar} activeOptions={{ exact: true, includeSearch: false }} className="block rounded-lg px-2.5 py-1.5 text-[0.8125rem] text-sobre-barra-2 hover:text-sobre-barra data-[status=active]:font-semibold data-[status=active]:text-sobre-barra">
                      {x.etiqueta}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        <div className="mt-3 border-t border-barra-2/70 pt-3">
          <Link to="/ajustes" onClick={alNavegar} className={cx('relative flex items-center rounded-xl px-3 py-2 text-[0.875rem] font-medium transition-colors', activa('/ajustes') ? 'bg-barra-2 text-sobre-barra' : 'text-sobre-barra-2 hover:bg-barra-2 hover:text-sobre-barra')}>
            {activa('/ajustes') ? <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-amarillo" /> : null}
            <Icono nombre="ajustes" tam={16} className="mr-3" />Ajustes
          </Link>
        </div>
      </nav>

      <div className="shrink-0 space-y-3 border-t border-barra-2 p-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-semibold text-sobre-barra">{nombre ?? 'Tu biblioteca'}</p>
            <p className="truncate text-[0.6875rem] text-sobre-barra-2">{correo}</p>
          </div>
          <Link to="/buscar/vigilantes" onClick={alNavegar} className="relative grid h-8 w-8 place-items-center rounded-xl text-sobre-barra-2 hover:bg-barra-2 hover:text-sobre-barra" aria-label="Alertas">
            <Icono nombre="vigilante" tam={16} />
            {pendientes ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amarillo" /> : null}
          </Link>
          <MenuCuenta lado="right">
            <button type="button" className="grid h-8 w-8 place-items-center rounded-xl text-sobre-barra-2 hover:bg-barra-2 hover:text-sobre-barra" aria-label={sesion.salir ? 'Cuenta, tema y salir' : 'Cuenta y tema'}>
              <Icono nombre="opciones" tam={16} />
            </button>
          </MenuCuenta>
        </div>
        <div>
          <div className="mb-2 h-px bg-rojo/30" />
          <p className="text-[0.6875rem] text-sobre-barra-2/80">Scholaris v2{esSimulado() ? ' · demostración' : sesion.modo === 'local' ? ' · versión local' : ''}</p>
        </div>
      </div>
    </>
  );
}

/** Escritorio: la barra lateral fija. */
export function Riel() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col bg-barra lg:flex">
      <ContenidoBarra />
    </aside>
  );
}

/** Móvil: la cabecera oscura con el menú desplegable. */
export function BarraMovil() {
  const [abierta, setAbierta] = useState(false);
  const ruta = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setAbierta(false), [ruta]);
  useEffect(() => {
    if (!abierta) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setAbierta(false);
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [abierta]);
  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 bg-barra px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <Link to="/" className="flex items-center gap-2" aria-label="Scholaris, ir a la biblioteca">
          <Logo tam={28} sobreOscuro />
          <span className="text-[1.0625rem] font-semibold text-sobre-barra">Scholaris</span>
        </Link>
        <span className="flex-1" />
        <button type="button" onClick={() => disparar('paleta')} aria-label="Buscar en todo" className="grid h-10 w-10 place-items-center rounded-xl text-sobre-barra-2 hover:bg-barra-2 hover:text-sobre-barra">
          <Icono nombre="buscar" tam={20} />
        </button>
        <button type="button" onClick={() => setAbierta(!abierta)} aria-expanded={abierta} aria-label="Menú" className="-mr-2 grid h-10 w-10 place-items-center rounded-xl text-sobre-barra-2 hover:bg-barra-2 hover:text-sobre-barra">
          <Icono nombre={abierta ? 'cerrar' : 'menu'} tam={22} />
        </button>
      </header>
      {abierta ? (
        <>
          <div className="fixed inset-0 z-40 bg-[rgb(26_15_10/0.6)] backdrop-blur-sm lg:hidden anim-aparece" onClick={() => setAbierta(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-barra shadow-[var(--shadow-lifted)] lg:hidden anim-entra">
            <ContenidoBarra alNavegar={() => setAbierta(false)} />
          </aside>
        </>
      ) : null}
    </>
  );
}

/** Móvil: el botón redondo de añadir, levantado sobre el papel. */
export function PieMovil() {
  return (
    <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-30 lg:hidden">
      <MenuAnadir alinear="end" lado="top">
        <button type="button" aria-label="Añadir a la biblioteca" className="grid h-14 w-14 place-items-center rounded-full border border-[#9a3128] bg-[linear-gradient(180deg,#cc5246_0%,#b83e33_100%)] text-[#fdf8f1] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_18px_rgb(120_30_20/0.35),0_2px_4px_rgb(44_24_16/0.2)] active:translate-y-px active:shadow-[inset_0_2px_6px_rgb(0_0_0/0.3)]">
          <Icono nombre="mas" tam={24} grosor={2.2} />
        </button>
      </MenuAnadir>
    </div>
  );
}
