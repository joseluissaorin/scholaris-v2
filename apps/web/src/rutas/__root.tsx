import { lazy, Suspense, useEffect, useState } from 'react';
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Tostadora, BarraAvance } from '@scholaris/ui';
import { BarraMovil, PieMovil, Riel } from '../componentes/marco/navegacion';
import { Entrada } from '../componentes/marco/entrada';
import { alDisparar } from '../lib/acciones';
import { recuperarTareas } from '../datos/ingesta';
import { NoEncontrado, ErrorDeRuta } from '../componentes/comunes/errores';

const Paleta = lazy(() => import('../componentes/marco/paleta'));

export const Route = createRootRouteWithContext<{ consultas: QueryClient }>()({
  component: Marco,
  notFoundComponent: NoEncontrado,
  errorComponent: ErrorDeRuta,
});

/** Una línea roja arriba mientras una navegación espera datos (nunca un spinner). */
function IndicadorCarga() {
  const cargando = useRouterState({ select: (s) => s.status === 'pending' });
  if (!cargando) return null;
  return <BarraAvance className="fixed inset-x-0 top-0 z-[80]" etiqueta="Cargando" />;
}

function Marco() {
  const [paleta, setPaleta] = useState(false);
  const [paletaCargada, setPaletaCargada] = useState(false);

  useEffect(() => alDisparar('paleta', () => { setPaletaCargada(true); setPaleta(true); }), []);
  useEffect(() => {
    void recuperarTareas();
    // La paleta se precarga cuando el navegador está ocioso: ⌘K abre al instante.
    const h = 'requestIdleCallback' in window ? requestIdleCallback(() => void import('../componentes/marco/paleta')) : setTimeout(() => void import('../componentes/marco/paleta'), 1500);
    return () => { if ('cancelIdleCallback' in window) cancelIdleCallback(h as number); };
  }, []);

  return (
    <div className="flex min-h-dvh">
      <a href="#contenido" className="sr-only z-[90] rounded-s bg-tinta px-3 py-2 text-sobre-tinta focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Saltar al contenido</a>
      <IndicadorCarga />
      <Riel />
      <div className="flex min-w-0 flex-1 flex-col">
        <BarraMovil />
        <main id="contenido" tabIndex={-1} className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
          <Outlet />
        </main>
      </div>
      <PieMovil />
      <Entrada />
      {paletaCargada ? <Suspense fallback={null}><Paleta abierta={paleta} alCambiar={setPaleta} /></Suspense> : null}
      <Tostadora />
    </div>
  );
}
