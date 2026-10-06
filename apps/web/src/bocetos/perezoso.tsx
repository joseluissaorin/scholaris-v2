/**
 * <Boceto> para el marco (lo que se carga con la primera pantalla): el
 * componente y el registro llegan en su propio trozo, solo cuando hace falta
 * dibujar algo (al soltar un archivo, en una página de error).
 */
import { lazy, Suspense } from 'react';
import type { PropsBoceto } from './boceto';

const Diferido = lazy(() => import('./boceto').then((m) => ({ default: m.Boceto })));

export function BocetoPerezoso(props: PropsBoceto & { alto?: string }) {
  return <Suspense fallback={<span className={props.className} style={props.style} aria-hidden />}><Diferido {...props} /></Suspense>;
}
