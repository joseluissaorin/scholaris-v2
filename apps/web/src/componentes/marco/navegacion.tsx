import { Link, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  cx, Icono, Teclas, Consejo, MenuRaiz, MenuDisparador, MenuContenido, MenuElemento, MenuSeparador, MenuRotulo, type NombreIcono,
} from '@scholaris/ui';
import { disparar, ponerTema, useTema } from '../../lib/acciones';
import { useSesion } from '../../sesion';
import { esSimulado } from '../../datos/api';
import { q } from '../../datos/consultas';
import { Monograma } from './monograma';

export const SECCIONES: Array<{ a: '/' | '/buscar' | '/escribir' | '/explorar'; etiqueta: string; icono: NombreIcono; n: string }> = [
  { a: '/', etiqueta: 'Biblioteca', icono: 'biblioteca', n: '01' },
  { a: '/buscar', etiqueta: 'Buscar', icono: 'buscar', n: '02' },
  { a: '/escribir', etiqueta: 'Escribir', icono: 'escribir', n: '03' },
  { a: '/explorar', etiqueta: 'Explorar', icono: 'explorar', n: '04' },
];

const esMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const TECLA_MOD = esMac ? '⌘' : 'Ctrl';

function useAlertasPendientes() {
  const { data } = useQuery({ ...q.alertas(), staleTime: 60_000 });
  return data?.filter((a) => !a.vista).length ?? 0;
}

/** Menú de «Añadir»: el mismo en el riel y en la barra móvil. */
export function MenuAnadir({ children, alinear = 'start' }: { children: React.ReactNode; alinear?: 'start' | 'end' | 'center' }) {
  return (
    <MenuRaiz>
      <MenuDisparador asChild>{children}</MenuDisparador>
      <MenuContenido alinear={alinear} className="w-64">
        <MenuRotulo>Añadir a la biblioteca</MenuRotulo>
        <MenuElemento icono="subir" atajo={`${TECLA_MOD} U`} alElegir={() => disparar('archivos')}>Archivos…</MenuElemento>
        <MenuElemento icono="camara" alElegir={() => disparar('camara')}>Fotografiar páginas</MenuElemento>
        <MenuElemento icono="enlace" alElegir={() => disparar('enlace')}>Desde un enlace…</MenuElemento>
        <MenuSeparador />
        <MenuElemento icono="pila" alElegir={() => disparar('spdf')}>Importar un .spdf…</MenuElemento>
      </MenuContenido>
    </MenuRaiz>
  );
}

function MenuCuenta({ children }: { children: React.ReactNode }) {
  const sesion = useSesion();
  const nombre = useNombre();
  const tema = useTema();
  return (
    <MenuRaiz>
      <MenuDisparador asChild>{children}</MenuDisparador>
      <MenuContenido alinear="start" className="w-64">
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="text-[0.9375rem] text-tinta">{nombre ?? 'Tu biblioteca'}</p>
          <p className="rotulo mt-0.5 text-apagado">{sesion.modo === 'local' ? (esSimulado() ? 'Demostración' : 'Versión local') : sesion.usuario?.correo}</p>
        </div>
        <MenuSeparador />
        <MenuRotulo>Tema</MenuRotulo>
        {(['claro', 'oscuro', 'sistema'] as const).map((t) => (
          <MenuElemento key={t} icono={t === 'claro' ? 'sol' : t === 'oscuro' ? 'luna' : 'ajustes'} alElegir={() => ponerTema(t)} atajo={tema === t ? '●' : undefined}>
            {t === 'claro' ? 'Claro' : t === 'oscuro' ? 'Oscuro' : 'Como el sistema'}
          </MenuElemento>
        ))}
        <MenuSeparador />
        {sesion.abrirPerfil ? <MenuElemento icono="editar" alElegir={sesion.abrirPerfil}>Perfil</MenuElemento> : null}
        {sesion.salir ? <MenuElemento icono="salir" alElegir={sesion.salir}>Cerrar sesión</MenuElemento> : null}
      </MenuContenido>
    </MenuRaiz>
  );
}

function useNombre() {
  const s = useSesion();
  const { data: yo } = useQuery({ ...q.yo(), enabled: !s.usuario });
  return s.usuario?.nombre ?? yo?.usuario.nombre;
}

function Iniciales() {
  const s = useSesion();
  const n = useNombre() ?? 'Tú';
  if (s.usuario?.imagen) return <img src={s.usuario.imagen} alt="" className="h-9 w-9 rounded-full object-cover" />;
  return <span className="grid h-9 w-9 place-items-center rounded-full border border-filete-fuerte bg-hoja text-[0.9375rem] italic text-tinta">{n.charAt(0)}</span>;
}

/** El riel de escritorio: monograma, cuatro lugares, añadir, buscar y la cuenta. */
export function Riel() {
  const pendientes = useAlertasPendientes();
  return (
    <nav aria-label="Principal" className="sticky top-0 hidden h-dvh w-[5.5rem] shrink-0 flex-col items-center border-r border-filete bg-papel/80 py-5 backdrop-blur md:flex">
      <Link to="/" aria-label="Scholaris, ir a la biblioteca" className="mb-7">
        <Monograma />
      </Link>

      <MenuAnadir>
        <button type="button" aria-label="Añadir a la biblioteca" className="group mb-6 grid h-12 w-12 place-items-center rounded-full bg-rojo text-[#fbf5ec] transition-transform duration-150 hover:scale-105 active:scale-95 dark:text-papel">
          <Icono nombre="mas" tam={22} grosor={2} className="transition-transform duration-200 group-data-[state=open]:rotate-45" />
        </button>
      </MenuAnadir>

      <ul className="flex flex-col gap-1">
        {SECCIONES.map((s) => (
          <li key={s.a}>
            <Link
              to={s.a}
              activeOptions={{ exact: s.a === '/' }}
              className="group relative flex w-[4.5rem] flex-col items-center gap-1 rounded-s py-2.5 text-tinta-2 transition-colors hover:bg-hondo/70 hover:text-tinta data-[status=active]:text-tinta"
            >
              <span aria-hidden className="absolute -left-2 top-2 bottom-2 w-[3px] bg-rojo opacity-0 transition-opacity group-data-[status=active]:opacity-100" />
              <span className="relative">
                <Icono nombre={s.icono} tam={21} />
                {s.a === '/buscar' && pendientes ? <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-amarillo ring-2 ring-papel" aria-label={`${pendientes} alertas sin ver`} /> : null}
              </span>
              <span className="text-[0.75rem] leading-none group-data-[status=active]:italic">{s.etiqueta}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col items-center gap-3">
        <Consejo texto={<span>Buscar en todo <Teclas className="ml-1 border-white/30 bg-transparent text-sobre-tinta">{TECLA_MOD} K</Teclas></span>} lado="right">
          <button type="button" onClick={() => disparar('paleta')} aria-label={`Buscar en todo (${TECLA_MOD} K)`} className="grid h-10 w-10 place-items-center rounded-s text-tinta-2 hover:bg-hondo hover:text-tinta">
            <Icono nombre="teclado" tam={19} />
          </button>
        </Consejo>
        <Link to="/ajustes" aria-label="Ajustes" className="grid h-10 w-10 place-items-center rounded-s text-tinta-2 hover:bg-hondo hover:text-tinta data-[status=active]:bg-hondo data-[status=active]:text-tinta">
          <Icono nombre="ajustes" tam={19} />
        </Link>
        <MenuCuenta>
          <button type="button" aria-label="Cuenta y tema" className="rounded-full"><Iniciales /></button>
        </MenuCuenta>
        <span className="rotulo mt-2 select-none text-[0.625rem] text-apagado [writing-mode:vertical-rl] rotate-180">
          {esSimulado() ? 'Demostración · v2' : 'Scholaris · v2'}
        </span>
      </div>
    </nav>
  );
}

/** Barra superior en el móvil: monograma, título del lugar, buscar y cuenta. */
export function BarraMovil() {
  const ruta = useRouterState({ select: (s) => s.location.pathname });
  const actual = SECCIONES.find((s) => (s.a === '/' ? ruta === '/' : ruta.startsWith(s.a)));
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-filete bg-papel/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <Link to="/" aria-label="Scholaris"><Monograma tam={30} /></Link>
      <span className="titular flex-1 truncate text-[1.375rem]">{actual?.etiqueta ?? (ruta.startsWith('/ajustes') ? 'Ajustes' : ruta.startsWith('/lector') ? 'Lector' : '')}</span>
      <button type="button" onClick={() => disparar('paleta')} aria-label="Buscar en todo" className="tactil-grande grid h-10 w-10 place-items-center rounded-s text-tinta-2">
        <Icono nombre="buscar" tam={20} />
      </button>
      <MenuCuenta>
        <button type="button" aria-label="Cuenta y tema" className="rounded-full"><Iniciales /></button>
      </MenuCuenta>
    </header>
  );
}

/** Pestañas inferiores en el móvil, con «Añadir» en el centro. */
export function PieMovil() {
  const pendientes = useAlertasPendientes();
  const [a, b, c, d] = SECCIONES as [typeof SECCIONES[0], typeof SECCIONES[0], typeof SECCIONES[0], typeof SECCIONES[0]];
  const enlace = (s: typeof a) => (
    <Link
      to={s.a}
      activeOptions={{ exact: s.a === '/' }}
      className="group relative flex flex-1 flex-col items-center justify-center gap-1 text-tinta-2 data-[status=active]:text-tinta"
    >
      <span aria-hidden className="absolute top-0 h-[3px] w-8 bg-rojo opacity-0 group-data-[status=active]:opacity-100" />
      <span className="relative">
        <Icono nombre={s.icono} tam={22} />
        {s.a === '/buscar' && pendientes ? <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-amarillo ring-2 ring-papel" /> : null}
      </span>
      <span className="text-[0.6875rem] leading-none group-data-[status=active]:italic">{s.etiqueta}</span>
    </Link>
  );
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-stretch border-t border-filete bg-papel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {enlace(a)}
      {enlace(b)}
      <div className="flex flex-1 items-center justify-center">
        <MenuAnadir alinear="center">
          <button type="button" aria-label="Añadir a la biblioteca" className={cx('-mt-6 grid h-14 w-14 place-items-center rounded-full bg-rojo text-[#fbf5ec] shadow-flota ring-4 ring-papel dark:text-papel')}>
            <Icono nombre="mas" tam={24} grosor={2} />
          </button>
        </MenuAnadir>
      </div>
      {enlace(c)}
      {enlace(d)}
    </nav>
  );
}
