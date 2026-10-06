import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Cabecera, Pestanas } from '../componentes/comunes/cabecera';

export const Route = createFileRoute('/administracion')({
  component: () => (
    <>
      <Cabecera antetitulo="Solo para quien administra Scholaris" titulo="Administración" forma="cuadrado" color="var(--s-rojo)" compacta />
      <Pestanas etiqueta="Administración" elementos={[{ a: '/administracion/cupones', texto: 'Cupones' }]} />
      <Outlet />
    </>
  ),
});
