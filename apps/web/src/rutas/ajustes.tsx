import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Cabecera, Pestanas } from '../componentes/comunes/cabecera';

export const Route = createFileRoute('/ajustes')({
  component: () => (
    <>
      <Cabecera antetitulo="Tu cuenta, tus claves, tus datos" titulo="Ajustes" forma="circulo" color="var(--s-amarillo)" compacta />
      <Pestanas etiqueta="Ajustes" elementos={[
        { a: '/ajustes', texto: 'Cuenta y plan', exacta: true },
        { a: '/ajustes/claves', texto: 'Claves' },
        { a: '/ajustes/privacidad', texto: 'Privacidad' },
        { a: '/ajustes/apariencia', texto: 'Apariencia' },
      ]} />
      <Outlet />
    </>
  ),
});
