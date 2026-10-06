import { Component, type ReactNode } from 'react';
import { Boton, Composicion, Esqueleto } from '@scholaris/ui';
import { Logo } from './logo';

/** El marco mientras arranca: misma geometría que el definitivo, sin saltos. */
export function EsperaMarco() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Cargando Scholaris">
      <div className="hidden w-56 shrink-0 flex-col bg-barra lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-barra-2 px-5"><Logo tam={32} sobreOscuro /><span className="text-[1.125rem] font-semibold text-sobre-barra">Scholaris</span></div>
      </div>
      <div className="fondo-bauhaus flex-1 px-5 py-8 lg:px-10">
        <Esqueleto className="h-4 w-32" />
        <Esqueleto className="mt-3 h-8 w-64" />
        <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => <Esqueleto key={i} className="aspect-[3/4] rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}

export class FalloArranque extends Component<{ children: ReactNode; promesa: Promise<unknown> }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
        <div className="relative max-w-lg text-center">
          <Composicion estilo="malevich" className="mx-auto mb-6 h-28 w-40" />
          <p className="rotulo text-rojo">Sin conexión con la biblioteca</p>
          <h1 className="mt-2 text-[1.5rem] font-semibold">No encontramos el servidor de Scholaris.</h1>
          <p className="mt-3 text-[0.9375rem] text-coffee-600">Comprueba la conexión o vuelve a intentarlo en un momento. Si usas la versión local, asegúrate de que está en marcha.</p>
          <p className="dato mt-2 text-apagado">{this.state.error.message}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Boton variante="tinta" onClick={() => location.reload()}>Reintentar</Boton>
            <Boton variante="linea" comoHijo><a href="?demostracion">Abrir la demostración</a></Boton>
          </div>
        </div>
      </main>
    );
  }
}
