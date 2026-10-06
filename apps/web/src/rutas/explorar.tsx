import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Cabecera, Pestanas } from '../componentes/comunes/cabecera';

export const Route = createFileRoute('/explorar')({
  component: () => (
    <>
      <Cabecera numero="04" antetitulo="La forma de tu biblioteca" titulo="Explorar" forma="cuadrado" compacta />
      <Pestanas etiqueta="Explorar" elementos={[
        { a: '/explorar', texto: 'Mapa de conceptos', exacta: true },
        { a: '/explorar/grafo', texto: 'Grafo de citas' },
        { a: '/explorar/conceptos', texto: 'Conceptos' },
        { a: '/explorar/perspectivas', texto: 'Perspectivas' },
        { a: '/explorar/corpus', texto: 'Corpus' },
      ]} />
      <Outlet />
    </>
  ),
});
