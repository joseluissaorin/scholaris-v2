import { Component, type ReactNode } from 'react';
import { Boton, Esqueleto } from '@scholaris/ui';
import { Logo } from './logo';
import { BocetoPerezoso } from '../../bocetos/perezoso';

/**
 * El armazón mientras arranca: la misma barra café con el logo, la misma
 * cabecera del móvil y esqueletos con relieve donde irá el contenido. Nunca
 * una pantalla vacía, y sin saltos cuando llega lo de verdad.
 */
export function EsperaMarco() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Cargando Scholaris">
      <div className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col bg-barra lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-barra-2 px-5"><Logo tam={32} sobreOscuro /><span className="text-[1.125rem] font-semibold tracking-wide text-sobre-barra">Scholaris</span></div>
        <div className="flex flex-col gap-2 px-3 pt-4">
          <div className="h-10 rounded-xl bg-[linear-gradient(180deg,#cc5246_0%,#b83e33_100%)] opacity-90 shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_2px_6px_rgb(0_0_0/0.35)]" />
          <div className="h-9 rounded-xl bg-black/20 shadow-[inset_0_2px_4px_rgb(0_0_0/0.35)]" />
        </div>
        <div className="flex flex-col gap-1 px-3 py-3">
          {[78, 60, 66, 70].map((w, i) => <div key={i} className="flex items-center gap-3 px-3 py-2.5"><span className="h-4 w-4 rounded bg-white/10" /><span className="h-3 rounded bg-white/10" style={{ width: `${w}%` }} /></div>)}
        </div>
      </div>
      <div className="fondo-bauhaus flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-40 flex h-14 items-center gap-2 bg-barra px-4 lg:hidden"><Logo tam={28} sobreOscuro /><span className="text-[1.0625rem] font-semibold text-sobre-barra">Scholaris</span></div>
        <EsperaContenido />
      </div>
    </div>
  );
}

/** El esqueleto del contenido de una sección: cabecera, filtro y tarjetas, en su sitio. */
export function EsperaContenido() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8 lg:px-10" aria-busy="true" aria-label="Cargando">
      <Esqueleto className="h-7 w-48" />
      <Esqueleto className="mt-2.5 h-3.5 w-72 max-w-full" />
      <Esqueleto className="mt-7 h-12 w-full rounded-xl" />
      <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <div className="aspect-[3/4] rounded-xl border border-cream-300 bg-cream-50 p-3 shadow-[var(--levantado)]"><Esqueleto className="h-3 w-3/4" /><Esqueleto className="mt-2 h-3 w-1/2" /></div>
            <Esqueleto className="mt-3 h-3.5 w-4/5" />
          </div>
        ))}
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
          {/* Sin línea: dos latas-teléfono con el hilo cortado, dibujadas a mano. */}
          <BocetoPerezoso nombre="latas" dibujar="ya" className="mx-auto mb-4 w-[min(22rem,85vw)]" />
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
