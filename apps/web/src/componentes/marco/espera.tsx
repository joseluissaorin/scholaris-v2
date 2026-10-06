import { Component, type ReactNode } from 'react';
import { Esqueleto, FormaBauhaus } from '@scholaris/ui';
import { Monograma } from './monograma';

/** El marco mientras arranca: misma geometría que el definitivo, sin saltos. */
export function EsperaMarco() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Cargando Scholaris">
      <div className="hidden w-[5.5rem] shrink-0 flex-col items-center gap-6 border-r border-filete py-5 md:flex">
        <Monograma />
        {[0, 1, 2, 3].map((i) => <Esqueleto key={i} className="h-10 w-10" />)}
      </div>
      <div className="flex-1 px-5 py-8 md:px-12 md:py-12">
        <Esqueleto className="h-3 w-24" />
        <Esqueleto className="mt-5 h-16 w-2/3 max-w-xl" />
        <div className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => <Esqueleto key={i} className="aspect-[3/4]" />)}
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
        <FormaBauhaus forma="triangulo" className="pointer-events-none absolute -right-20 -top-10 h-96 w-96" />
        <div className="relative max-w-lg">
          <p className="rotulo text-rojo">Sin conexión con la biblioteca</p>
          <h1 className="titular mt-3 text-[3rem]">No encontramos el servidor de Scholaris.</h1>
          <p className="mt-4 text-tinta-2">Comprueba la conexión o vuelve a intentarlo en un momento. Si usas la versión local, asegúrate de que está en marcha.</p>
          <p className="mt-2 font-mono text-[0.8125rem] text-apagado">{this.state.error.message}</p>
          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => location.reload()} className="h-10 rounded-s border border-tinta bg-tinta px-4 text-sobre-tinta">Reintentar</button>
            <a href="?demostracion" className="grid h-10 place-items-center rounded-s border border-filete-fuerte px-4">Abrir la demostración</a>
          </div>
        </div>
      </main>
    );
  }
}
