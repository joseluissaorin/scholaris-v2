import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Cabecera, Pestanas } from '../componentes/comunes/cabecera';

export const Route = createFileRoute('/escribir')({
  component: () => (
    <>
      <Cabecera numero="03" antetitulo="Escribe de memoria; nosotros lo fundamentamos" titulo="Escribir" forma="triangulo" compacta />
      <Pestanas etiqueta="Escribir" elementos={[{ a: '/escribir', texto: 'Autocita', exacta: true }, { a: '/escribir/cuadernos', texto: 'Cuadernos' }]} />
      <Outlet />
    </>
  ),
});
