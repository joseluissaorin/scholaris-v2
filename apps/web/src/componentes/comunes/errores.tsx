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

/** ¿Es un «no existe» de la API (404)? */
export function esNoEncontrado(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { estado?: number }).estado === 404;
}

/**
 * Una consulta que ha fallado, dentro de la pantalla (la barra y el resto siguen):
 * el mismo borrón a mano que el error de ruta, el motivo y «Reintentar». Nunca un
 * hueco en blanco ni un estado vacío que mienta («no hay nada» cuando no se pudo mirar).
 */
export function FalloConsulta({ error, reintentar, compacto = false, className }: { error: unknown; reintentar?: () => void; compacto?: boolean; className?: string }) {
  const motivo = error instanceof Error && error.message ? error.message : 'No se pudo cargar.';
  if (compacto) {
    return (
      <div role="alert" className={`rounded-xl border border-dashed border-cream-500 bg-cream-100/60 px-4 py-3 text-[0.875rem] text-coffee-600 shadow-[var(--hundido)] ${className ?? ''}`}>
        <p>{motivo}</p>
        {reintentar ? <button type="button" onClick={reintentar} className="mt-1 font-medium text-coffee-800 underline underline-offset-2 hover:text-rojo">Reintentar</button> : null}
      </div>
    );
  }
  return (
    <div role="alert" className={`anim-sube flex flex-col items-center gap-3 rounded-2xl border border-dashed border-cream-500 bg-cream-100/60 px-6 py-10 text-center shadow-[var(--hundido)] ${className ?? ''}`}>
      <BocetoPerezoso nombre="borron" dibujar="ya" className="w-[min(13rem,60vw)]" />
      <h3 className="text-[1.0625rem] font-semibold text-coffee-800">No pudimos cargar esto.</h3>
      <p className="max-w-[48ch] text-[0.875rem] text-coffee-600">{motivo}</p>
      {reintentar ? <Boton variante="linea" onClick={reintentar}>Reintentar</Boton> : null}
    </div>
  );
}

/** El motivo sin repetir el titular: la API suele decir «Este enlace ya no funciona: …». */
export function motivoEnlace(error: unknown): string {
  const m = error instanceof Error ? error.message.replace(/^Este enlace ya no funciona[:.]?\s*/i, '').trim() : '';
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Quien lo compartió lo ha retirado o ha caducado.';
}
