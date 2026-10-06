import { lazy, Suspense, useEffect, useState } from 'react';
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Tostadora, BarraAvance } from '@scholaris/ui';
import { BarraMovil, PieMovil, Riel } from '../componentes/marco/navegacion';
import { Entrada } from '../componentes/marco/entrada';
import { alDisparar } from '../lib/acciones';
import { recuperarTareas } from '../datos/ingesta';
import { NoEncontrado, ErrorDeRuta } from '../componentes/comunes/errores';
import { EsperaMarco } from '../componentes/marco/espera';
import { useHayMini } from '../componentes/reproductor/estado-global';

const Paleta = lazy(() => import('../componentes/marco/paleta'));
// El reproductor pequeño: solo si algo suena fuera del lector.
// Se puede coger y lanzar a cualquier esquina (con inercia): el arrastre viaja en el mismo trozo, fuera del marco.
const MiniReproductor = lazy(() => Promise.all([import('../componentes/reproductor/mini'), import('../movimiento/arrastre')]).then(([m, a]) => ({
  default: () => <a.Arrastrable clave="mini"><m.default /></a.Arrastrable>,
})));

export const Route = createRootRouteWithContext<{ consultas: QueryClient }>()({
  component: Marco,
  // Si la raíz espera (primera carga), el armazón entero: barra, cabecera y esqueletos.
  pendingComponent: EsperaMarco,
  pendingMs: 0,
  pendingMinMs: 0,
  notFoundComponent: NoEncontrado,
  errorComponent: ErrorDeRuta,
});

/** Una línea roja arriba mientras una navegación espera datos (nunca un spinner). */
function IndicadorCarga() {
  const cargando = useRouterState({ select: (s) => s.status === 'pending' });
  if (!cargando) return null;
  // Fuera del flujo: un contenedor fijo. Dentro de la fila flexible empujaría la barra lateral.
  return <div className="pointer-events-none fixed inset-x-0 top-0 z-[80]"><BarraAvance className="rounded-none" etiqueta="Cargando" /></div>;
}

function Marco() {
  const [paleta, setPaleta] = useState(false);
  const [paletaCargada, setPaletaCargada] = useState(false);
  const hayMini = useHayMini();

  useEffect(() => alDisparar('paleta', () => { setPaletaCargada(true); setPaleta(true); }), []);
  useEffect(() => {
    void recuperarTareas();
    // La paleta se precarga cuando el navegador está ocioso: ⌘K abre al instante.
    const h = 'requestIdleCallback' in window ? requestIdleCallback(() => void import('../componentes/marco/paleta')) : setTimeout(() => void import('../componentes/marco/paleta'), 1500);
    return () => { if ('cancelIdleCallback' in window) cancelIdleCallback(h as number); };
  }, []);

  return (
    <div className="flex min-h-dvh">
      <a href="#contenido" className="sr-only z-[90] rounded-xl bg-coffee-800 px-3 py-2 text-cream-50 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Saltar al contenido</a>
      <IndicadorCarga />
      <Riel />
      <div className="fondo-bauhaus flex min-w-0 flex-1 flex-col">
        <BarraMovil />
        <main id="contenido" tabIndex={-1} className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none lg:pb-10">
          <Outlet />
        </main>
      </div>
      <PieMovil />
      <Entrada />
      {paletaCargada ? <Suspense fallback={null}><Paleta abierta={paleta} alCambiar={setPaleta} /></Suspense> : null}
      {hayMini ? <Suspense fallback={null}><MiniReproductor /></Suspense> : null}
      <Tostadora />
    </div>
  );
}
