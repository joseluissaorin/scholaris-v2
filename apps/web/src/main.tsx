import { lazy, StrictMode, Suspense, use, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './arbol-rutas.gen';
import { arrancar } from './datos/api';
import { clienteConsultas } from './datos/consultas';
import { claveClerk, ProveedorSesion } from './sesion';
import { EsperaContenido, EsperaMarco, FalloArranque } from './componentes/marco/espera';
import { instalarTransiciones } from './movimiento/transiciones';
import './estilos.css';

export const enrutador = createRouter({
  routeTree,
  context: { consultas: clienteConsultas },
  // Precarga al pasar o enfocar un enlace: la siguiente pantalla ya tiene sus datos.
  defaultPreload: 'intent',
  defaultPreloadDelay: 60,
  defaultPreloadStaleTime: 0,
  // Al cambiar de sección se queda lo anterior hasta 300 ms; después, el esqueleto de la
  // sección en su sitio (dentro del marco: la barra lateral no se desmonta nunca).
  defaultPendingMs: 300,
  defaultPendingMinMs: 200,
  defaultPendingComponent: EsperaContenido,
  scrollRestoration: true,
});

// Entre pantallas: el contenido sube del papel y las portadas viajan al lector.
instalarTransiciones(enrutador as never);

declare module '@tanstack/react-router' {
  interface Register { router: typeof enrutador }
}

// La configuración se pide ya, en paralelo al resto del arranque.
const promesaConfig = arrancar();

/*
 * Nada en cascada: en cuanto se sabe la configuración, a la vez,
 *  · se abre la conexión con Clerk y se baja su trozo (si la instancia lo usa);
 *  · se baja el código de la pantalla a la que se llega.
 * Así, cuando Clerk está listo, la sección ya está en el navegador.
 */
void promesaConfig.then((config) => {
  const clave = claveClerk(config);
  if (clave && config.requiereAutenticacion) {
    void import('./sesion-clerk');
    try {
      const anfitrion = atob(clave.split('_')[2] ?? '').replace(/\$$/, '');
      if (anfitrion) {
        const l = document.createElement('link');
        l.rel = 'preconnect'; l.href = `https://${anfitrion}`; l.crossOrigin = 'anonymous';
        document.head.appendChild(l);
      }
    } catch { /* clave sin anfitrión legible */ }
  }
  try {
    const coincidencias = enrutador.matchRoutes(location.pathname, Object.fromEntries(new URLSearchParams(location.search)));
    for (const m of coincidencias) {
      const ruta = (enrutador.routesById as unknown as Record<string, unknown>)[m.routeId];
      if (ruta) void enrutador.loadRouteChunk(ruta as never);
    }
  } catch { /* se cargará al renderizar */ }
}).catch(() => undefined);

/**
 * El enrutador no pinta nada hasta resolver su primera carga. Mientras tanto, el
 * armazón se queda encima (fijo, fuera del flujo) y se retira en cuanto la
 * primera pantalla se ha pintado: nunca hay un fotograma vacío.
 */
function EnrutadorConArmazon() {
  const [pintado, setPintado] = useState(() => enrutador.state.status === 'idle' && enrutador.state.matches.length > 0);
  useEffect(() => {
    if (pintado) return;
    return enrutador.subscribe('onRendered', () => setPintado(true));
  }, [pintado]);
  return (
    <>
      <RouterProvider router={enrutador} />
      {pintado ? null : <div className="fixed inset-0 z-[95]"><EsperaMarco /></div>}
    </>
  );
}

/** Un enlace de solo lectura (`/p/<token>`): sin cuenta, fuera del marco y de Clerk. */
const VistaPublica = lazy(() => import('./publico/vista-publica'));

function Aplicacion() {
  const config = use(promesaConfig);
  if (location.pathname.startsWith('/p/')) return <VistaPublica />;
  return (
    <ProveedorSesion config={config} espera={<EsperaMarco />}>
      <EnrutadorConArmazon />
    </ProveedorSesion>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={clienteConsultas}>
      <FalloArranque promesa={promesaConfig}>
        <Suspense fallback={<EsperaMarco />}>
          <Aplicacion />
        </Suspense>
      </FalloArranque>
    </QueryClientProvider>
  </StrictMode>,
);
