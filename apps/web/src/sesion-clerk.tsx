import { useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { localizacionClerk } from './lib/clerk-es';
import { Composicion } from '@scholaris/ui';
import { Logo } from './componentes/marco/logo';
import { ponerProveedorToken } from './datos/api';
import { ContextoSesion } from './sesion';
import { cuponPendiente } from './lib/cupon-pendiente';

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
        usuario: { nombre: user?.fullName ?? user?.firstName ?? 'Tu cuenta', correo: user?.primaryEmailAddress?.emailAddress ?? '', imagen: user?.imageUrl, id: user?.id, creada: user?.createdAt?.getTime() },
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
  // Con un cupón esperando (un enlace «?cupon=»), lo primero es crear la cuenta; quien ya la tiene, entra.
  const [cupon] = useState(cuponPendiente);
  const [registro, setRegistro] = useState(!!cupon);
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
          <p className="text-[1.25rem] leading-snug">«Yo, que me figuraba el Paraíso / bajo la especie de una biblioteca.»</p>
          <p className="mt-3 text-[0.875rem] text-sobre-barra-2">Jorge Luis Borges, «Poema de los dones»</p>
        </div>
        <p className="relative hidden text-[0.75rem] text-sobre-barra-2 lg:block">PDF · escaneos · audio · vídeo · cada cita con su página o su minuto</p>
      </section>
      <section className="fondo-bauhaus flex flex-col items-center justify-center gap-5 px-4 py-10">
        {cupon ? (
          <div role="status" className="flex max-w-md items-center gap-4 rounded-xl border border-cream-400 bg-cream-50 px-4 py-3 shadow-[var(--relieve)]">
            <span aria-hidden className="anim-sello grid shrink-0 -rotate-6 place-items-center rounded-lg border-2 border-double border-rojo px-3 py-1.5 font-mono text-[0.6875rem] font-bold uppercase leading-tight tracking-[0.18em] text-rojo">
              <span className="text-[0.9375rem] tracking-[0.24em]">Pro</span><span>cupón</span>
            </span>
            <p className="text-[0.875rem] text-coffee-700">
              Tu cupón <span className="font-mono">{cupon}</span> te espera. {registro ? 'Crea tu cuenta' : 'Entra'} y se canjea solo, sin pasar por el pago.
            </p>
          </div>
        ) : null}
        {registro ? <SignUp routing="hash" /> : <SignIn routing="hash" />}
        {cupon ? (
          <button type="button" className="text-[0.8125rem] text-coffee-600 underline underline-offset-2 hover:text-coffee-800" onClick={() => setRegistro(!registro)}>
            {registro ? '¿Ya tienes cuenta? Entra con ella' : '¿Aún no tienes cuenta? Créala'}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export default function SesionClerk({ clave, children, espera }: { clave: string; children: ReactNode; espera: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={clave}
      localization={localizacionClerk}
      appearance={apariencia}
      // Tras entrar, sin recargar la página: se cambia la URL y la app aparece en el sitio.
      routerPush={(a) => window.history.pushState(null, '', a)}
      routerReplace={(a) => window.history.replaceState(null, '', a)}
    >
      <Puente espera={espera}>{children}</Puente>
    </ClerkProvider>
  );
}
