import { Link, type ErrorComponentProps } from '@tanstack/react-router';
import { Boton, FormaBauhaus } from '@scholaris/ui';
import { BocetoPerezoso } from '../../bocetos/perezoso';

export function NoEncontrado() {
  return (
    <section className="relative mx-auto max-w-3xl overflow-hidden px-6 py-24">
      <FormaBauhaus forma="circulo" className="anim-florece pointer-events-none absolute -right-24 top-6 h-80 w-80 opacity-90" />
      <BocetoPerezoso nombre="pagina-arrancada" dibujar="ya" className="relative mb-6 w-[min(20rem,80vw)]" />
      <p className="rotulo anim-sube text-rojo">Error 404 · folio inexistente</p>
      <h1 className="relative mt-3 text-[1.5rem] font-bold tracking-[-0.01em]">Esta página no está en ningún libro.</h1>
      <p className="relative mt-4 max-w-md text-tinta-2">Quizá el enlace era de otra biblioteca, o el documento ya no existe.</p>
      <Boton comoHijo variante="tinta" className="relative mt-8"><Link to="/">Volver a la biblioteca</Link></Boton>
    </section>
  );
}

export function ErrorDeRuta({ error, reset }: ErrorComponentProps) {
  return (
    <section className="relative mx-auto max-w-3xl overflow-hidden px-6 py-24">
      <FormaBauhaus forma="triangulo" className="anim-florece pointer-events-none absolute -right-16 top-4 h-72 w-72" />
      <BocetoPerezoso nombre="borron" dibujar="ya" className="relative mb-6 w-[min(18rem,75vw)]" />
      <p className="rotulo anim-sube text-rojo">Algo se ha torcido</p>
      <h1 className="relative mt-3 text-[1.5rem] font-bold tracking-[-0.01em]">No pudimos abrir esto.</h1>
      <p className="relative mt-4 max-w-lg text-tinta-2">{error instanceof Error ? error.message : 'Error desconocido.'}</p>
      <div className="relative mt-8 flex gap-2">
        <Boton variante="tinta" onClick={reset}>Reintentar</Boton>
        <Boton comoHijo variante="linea"><Link to="/">Ir a la biblioteca</Link></Boton>
      </div>
    </section>
  );
}
