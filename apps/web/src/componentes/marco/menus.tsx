/** Los menús del marco (Añadir y Cuenta). Se cargan aparte: ver `Perezoso` en navegacion.tsx. */
import { useState, type ReactNode } from 'react';
import { modoIngesta, ponerModoIngesta, type ModoIngesta } from '../../datos/ingesta';
import { MenuRaiz, MenuDisparador, MenuContenido, MenuElemento, MenuSeparador, MenuRotulo } from '@scholaris/ui';
import { disparar, ponerTema, useTema } from '../../lib/acciones';
import { useSesion } from '../../sesion';
import { esSimulado } from '../../datos/api';
import { TECLA_MOD, useNombre } from './navegacion';

function ModoLectura() {
  const [modo, setModo] = useState<ModoIngesta>(modoIngesta);
  const elegir = (m: ModoIngesta) => { ponerModoIngesta(m); setModo(m); };
  return (
    <>
      <MenuElemento icono={modo === 'rapido' ? 'hecho' : undefined} alElegir={() => elegir('rapido')}>Rápido <span className="text-apagado">· en minutos</span></MenuElemento>
      <MenuElemento icono={modo === 'economico' ? 'hecho' : undefined} alElegir={() => elegir('economico')}>Económico <span className="text-apagado">· en unas horas, mitad de precio</span></MenuElemento>
    </>
  );
}

export default function Menus({ tipo, alinear, lado, abiertoAlMontar, children }: { tipo: 'anadir' | 'cuenta'; alinear?: 'start' | 'end' | 'center'; lado?: 'right' | 'top' | 'bottom'; abiertoAlMontar?: boolean; children: ReactNode }) {
  return tipo === 'anadir'
    ? <MenuAnadir alinear={alinear} lado={lado} abierto={abiertoAlMontar}>{children}</MenuAnadir>
    : <MenuCuenta lado={lado} abierto={abiertoAlMontar}>{children}</MenuCuenta>;
}

/** Menú de «Añadir»: el mismo en el riel y en la barra móvil. */
function MenuAnadir({ children, alinear = 'start', lado, abierto }: { children: ReactNode; alinear?: 'start' | 'end' | 'center'; lado?: 'right' | 'top' | 'bottom'; abierto?: boolean }) {
  return (
    <MenuRaiz defaultOpen={abierto}>
      <MenuDisparador asChild>{children}</MenuDisparador>
      <MenuContenido alinear={alinear} lado={lado} className="w-64">
        <MenuRotulo>Añadir a la biblioteca</MenuRotulo>
        <MenuElemento icono="subir" atajo={`${TECLA_MOD} U`} alElegir={() => disparar('archivos')}>Archivos…</MenuElemento>
        <MenuElemento icono="camara" alElegir={() => disparar('camara')}>Fotografiar páginas</MenuElemento>
        <MenuElemento icono="enlace" alElegir={() => disparar('enlace')}>Desde un enlace…</MenuElemento>
        <MenuSeparador />
        <MenuElemento icono="pila" alElegir={() => disparar('spdf')}>Importar un .spdf…</MenuElemento>
        <MenuSeparador />
        <MenuRotulo>Cómo leerlo</MenuRotulo>
        <ModoLectura />
      </MenuContenido>
    </MenuRaiz>
  );
}

function MenuCuenta({ children, lado, abierto }: { children: ReactNode; lado?: 'right' | 'top' | 'bottom'; abierto?: boolean }) {
  const sesion = useSesion();
  const nombre = useNombre();
  const tema = useTema();
  return (
    <MenuRaiz defaultOpen={abierto}>
      <MenuDisparador asChild>{children}</MenuDisparador>
      <MenuContenido alinear={lado === 'right' ? 'end' : 'start'} lado={lado} className="w-64">
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="text-[0.9375rem] text-tinta">{nombre ?? 'Tu biblioteca'}</p>
          <p className="rotulo mt-0.5 text-apagado">{sesion.modo === 'local' ? (esSimulado() ? 'Demostración' : 'Versión local') : sesion.usuario?.correo}</p>
        </div>
        <MenuSeparador />
        <MenuRotulo>Tema</MenuRotulo>
        {(['claro', 'oscuro', 'sistema'] as const).map((t) => (
          <MenuElemento key={t} icono={t === 'claro' ? 'sol' : t === 'oscuro' ? 'luna' : 'ajustes'} alElegir={() => ponerTema(t)} atajo={tema === t ? '●' : undefined}>
            {t === 'claro' ? 'Claro' : t === 'oscuro' ? 'Oscuro' : 'Como el sistema'}
          </MenuElemento>
        ))}
        <MenuSeparador />
        {sesion.abrirPerfil ? <MenuElemento icono="editar" alElegir={sesion.abrirPerfil}>Perfil</MenuElemento> : null}
        {sesion.salir ? <MenuElemento icono="salir" alElegir={sesion.salir}>Cerrar sesión</MenuElemento> : null}
      </MenuContenido>
    </MenuRaiz>
  );
}

