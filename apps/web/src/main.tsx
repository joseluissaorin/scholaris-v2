import { StrictMode, Suspense, use } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { ConsejoProveedor } from '@scholaris/ui';
import { routeTree } from './arbol-rutas.gen';
import { arrancar } from './datos/api';
import { clienteConsultas } from './datos/consultas';
import { ProveedorSesion } from './sesion';
import { EsperaMarco, FalloArranque } from './componentes/marco/espera';
import './estilos.css';

export const enrutador = createRouter({
  routeTree,
  context: { consultas: clienteConsultas },
  // Precarga al pasar o enfocar un enlace: la siguiente pantalla ya tiene sus datos.
  defaultPreload: 'intent',
  defaultPreloadDelay: 60,
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 150,
  defaultPendingMinMs: 0,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register { router: typeof enrutador }
}

// La configuración se pide ya, en paralelo al resto del arranque.
const promesaConfig = arrancar();

function Aplicacion() {
  const config = use(promesaConfig);
  return (
    <ProveedorSesion config={config} espera={<EsperaMarco />}>
      <RouterProvider router={enrutador} />
    </ProveedorSesion>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <ConsejoProveedor delayDuration={350}>
        <FalloArranque promesa={promesaConfig}>
          <Suspense fallback={<EsperaMarco />}>
            <Aplicacion />
          </Suspense>
        </FalloArranque>
      </ConsejoProveedor>
    </QueryClientProvider>
  </StrictMode>,
);
