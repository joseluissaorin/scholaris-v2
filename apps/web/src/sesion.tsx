/**
 * La sesión: Clerk en la nube, un solo usuario sin cuenta en la versión local.
 * Clerk se carga en su propio trozo y solo si la instancia lo pide: la versión
 * local no paga ni un byte por él.
 */
import { createContext, lazy, Suspense, useContext, type ReactNode } from 'react';
import type { ConfigPublica } from '@scholaris/contrato';

export interface Sesion {
  modo: 'local' | 'clerk';
  usuario?: { nombre: string; correo: string; imagen?: string; id?: string; creada?: number };
  salir?: () => void;
  abrirPerfil?: () => void;
}

const Contexto = createContext<Sesion>({ modo: 'local' });
export const ContextoSesion = Contexto;
export const useSesion = () => useContext(Contexto);

const SesionClerk = lazy(() => import('./sesion-clerk'));

export function claveClerk(config: ConfigPublica): string | undefined {
  // En local manda el servidor: una clave de Clerk horneada en la web no debe colarse (el modo sin conexión no tiene Clerk).
  if (config.modo === 'local') return config.clerkPublishableKey;
  return config.clerkPublishableKey ?? (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined);
}

export function ProveedorSesion({ config, children, espera }: { config: ConfigPublica; children: ReactNode; espera: ReactNode }) {
  const clave = claveClerk(config);
  if (!clave || !config.requiereAutenticacion) {
    return <Contexto.Provider value={{ modo: 'local' }}>{children}</Contexto.Provider>;
  }
  return (
    <Suspense fallback={espera}>
      <SesionClerk clave={clave} espera={espera}>{children}</SesionClerk>
    </Suspense>
  );
}
