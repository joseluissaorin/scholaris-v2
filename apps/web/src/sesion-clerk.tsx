import { useEffect, type ReactNode } from 'react';
import { ClerkProvider, SignIn, useAuth, useClerk, useUser } from '@clerk/react';
import { esES } from '@clerk/localizations';
import { Composicion } from '@scholaris/ui';
import { Logo } from './componentes/marco/logo';
import { ponerProveedorToken } from './datos/api';
import { ContextoSesion } from './sesion';

/** Clerk vestido de Scholaris: Georgia, tinta de café, sin sombras genéricas. */
const apariencia = {
  variables: {
    colorPrimary: '#2c1810',
    colorDanger: '#b83e33',
    colorBackground: '#faf7f0',
    colorInputBackground: '#faf7f0',
    colorText: '#2c1810',
    colorTextSecondary: '#7a5f4f',
    fontFamily: "'DM Sans', system-ui, sans-serif",
    borderRadius: '0.75rem',
  },
  elements: {
    card: { boxShadow: 'none', border: 'none', background: 'transparent' },
    cardBox: { boxShadow: 'none', border: 'none' },
    footer: { background: 'transparent' },
    formButtonPrimary: { background: 'linear-gradient(180deg,#4a2e1a 0%,#2c1810 100%)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.14), 0 1px 2px rgb(26 15 10 / 0.3), 0 3px 8px rgb(26 15 10 / 0.18)' },
    formFieldInput: { boxShadow: 'inset 0 2px 4px rgb(44 24 16 / 0.07)', borderColor: '#d4c4b0' },
    socialButtonsBlockButton: { boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.65), 0 1px 2px rgb(44 24 16 / 0.10)', borderColor: '#d4c4b0' },
  },
};

function Puente({ children, espera }: { children: ReactNode; espera: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();

  // El token se ofrece cuando hay sesión: antes, las peticiones esperan (no salen sin él).
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    ponerProveedorToken(() => getToken());
    return () => ponerProveedorToken(null);
  }, [getToken, isLoaded, isSignedIn]);

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

/** La entrada de siempre: el panel café con el logo y una frase, y el formulario sobre crema. */
function Entrada() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative flex flex-col justify-between overflow-hidden bg-barra px-6 py-6 text-sobre-barra lg:px-10 lg:py-8">
        <div aria-hidden className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle, #faf7f0 1px, transparent 1.2px)', backgroundSize: '24px 24px' }} />
        <div className="relative flex items-center gap-3">
          <Logo tam={40} sobreOscuro />
          <div><p className="text-[1.25rem] font-bold">Scholaris</p><p className="text-[0.8125rem] text-sobre-barra-2">Tu biblioteca, leída y citable</p></div>
        </div>
        <div className="relative my-10 hidden max-w-md lg:block">
          <Composicion estilo="malevich" className="mb-8 h-28 w-44 opacity-95" />
          <p className="text-[1.25rem] leading-snug">«Siempre imaginé que el Paraíso sería algún tipo de biblioteca.»</p>
          <p className="mt-3 text-[0.875rem] text-sobre-barra-2">— Jorge Luis Borges</p>
        </div>
        <p className="relative hidden text-[0.75rem] text-sobre-barra-2 lg:block">PDF · escaneos · audio · vídeo · cada cita con su página o su minuto</p>
      </section>
      <section className="fondo-bauhaus flex items-center justify-center px-4 py-10">
        <SignIn routing="hash" />
      </section>
    </main>
  );
}

export default function SesionClerk({ clave, children, espera }: { clave: string; children: ReactNode; espera: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={clave}
      localization={esES}
      appearance={apariencia}
      // Tras entrar, sin recargar la página: se cambia la URL y la app aparece en el sitio.
      routerPush={(a) => window.history.pushState(null, '', a)}
      routerReplace={(a) => window.history.replaceState(null, '', a)}
    >
      <Puente espera={espera}>{children}</Puente>
    </ClerkProvider>
  );
}
