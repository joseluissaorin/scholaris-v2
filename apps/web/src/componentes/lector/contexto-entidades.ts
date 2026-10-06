/**
 * El contexto del resaltado de entidades, aparte para que `Markdown` no
 * arrastre el globo ni sus dependencias allí donde no hay entidades.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface MarcadorEntidades {
  /** Parte un trozo de texto y envuelve las entidades; null si no hay ninguna. */
  marcar: (texto: string, clave: string) => ReactNode[] | null;
}

export const ContextoEntidades = createContext<MarcadorEntidades | null>(null);

export const useMarcadorEntidades = () => useContext(ContextoEntidades);
