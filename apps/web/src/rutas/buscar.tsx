import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Cabecera, Pestanas } from '../componentes/comunes/cabecera';
import { q } from '../datos/consultas';

export const Route = createFileRoute('/buscar')({
  component: () => {
    const { data: alertas } = useQuery(q.alertas());
    const pendientes = alertas?.filter((a) => !a.vista).length ?? 0;
    return (
      <>
        <Cabecera numero="02" antetitulo="Dentro de todo lo que has leído" titulo="Buscar" forma="circulo" compacta />
        <Pestanas etiqueta="Buscar" elementos={[
          { a: '/buscar', texto: 'Buscar y preguntar', exacta: true },
          { a: '/buscar/vigilantes', texto: 'Vigilantes', insignia: pendientes },
          { a: '/buscar/historial', texto: 'Historial' },
        ]} />
        <Outlet />
      </>
    );
  },
});
