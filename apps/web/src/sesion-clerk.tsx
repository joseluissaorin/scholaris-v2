import { useEffect, type ReactNode } from 'react';
import { ClerkProvider, SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import { esES } from '@clerk/localizations';
import { FormaBauhaus } from '@scholaris/ui';
import { ponerProveedorToken } from './datos/api';
import { ContextoSesion } from './sesion';

/** Clerk vestido de Scholaris: Georgia, tinta de café, sin sombras genéricas. */
const apariencia = {
  variables: {
    colorPrimary: '#22160f',
    colorDanger: '#b8321c',
    colorBackground: '#faf7f0',
    colorInputBackground: '#faf7f0',
    colorText: '#22160f',
    colorTextSecondary: '#75614f',
    fontFamily: 'Georgia, "Iowan Old Style", serif',
    borderRadius: '3px',
  },
  elements: { card: { boxShadow: 'none', border: '1px solid #d9cfbd' } },
};

function Puente({ children, espera }: { children: ReactNode; espera: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    ponerProveedorToken(() => getToken());
    return () => ponerProveedorToken(null);
  }, [getToken]);

  if (!isLoaded) return <>{espera}</>;
  if (!isSignedIn) return <Entrada />;
  return (
    <ContextoSesion.Provider
      value={{
        modo: 'clerk',
        usuario: { nombre: user?.fullName ?? user?.firstName ?? 'Tu cuenta', correo: user?.primaryEmailAddress?.emailAddress ?? '', imagen: user?.imageUrl },
        salir: () => void clerk.signOut(),
        abrirPerfil: () => clerk.openUserProfile(),
      }}
    >
      {children}
    </ContextoSesion.Provider>
  );
}

function Entrada() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-16">
      <FormaBauhaus forma="cuarto" className="pointer-events-none absolute -right-24 -top-24 h-[34rem] w-[34rem]" />
      <FormaBauhaus forma="circulo" className="pointer-events-none absolute -bottom-20 -left-16 h-64 w-64" />
      <div className="relative flex flex-col items-center gap-8">
        <div className="text-center">
          <p className="rotulo text-apagado">Scholaris</p>
          <h1 className="titular mt-3 max-w-[14ch] text-[3.25rem] text-tinta">Has leído los libros. Nosotros recordamos las páginas.</h1>
        </div>
        <SignIn routing="hash" />
      </div>
    </main>
  );
}

export default function SesionClerk({ clave, children, espera }: { clave: string; children: ReactNode; espera: ReactNode }) {
  return (
    <ClerkProvider publishableKey={clave} localization={esES} appearance={apariencia}>
      <Puente espera={espera}>{children}</Puente>
    </ClerkProvider>
  );
}
