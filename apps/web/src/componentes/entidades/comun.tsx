/** Piezas comunes de las entidades: nombres de los tipos y el pasaje con la mención marcada. */
import type { TipoEntidad } from '@scholaris/contrato';
import { numero } from '../../lib/numero';

export const NOMBRE_TIPO_ENTIDAD: Record<TipoEntidad, string> = {
  persona: 'Persona', obra: 'Obra', lugar: 'Lugar', organizacion: 'Organización', concepto: 'Concepto', evento: 'Acontecimiento', fecha: 'Fecha',
};

export const PLURAL_TIPO_ENTIDAD: Record<TipoEntidad, string> = {
  persona: 'Personas', obra: 'Obras', lugar: 'Lugares', organizacion: 'Organizaciones', concepto: 'Conceptos', evento: 'Acontecimientos', fecha: 'Fechas',
};

/** Color de cada tipo, con la correspondencia de Kandinsky que usa el grafo. */
export const PUNTO_TIPO_ENTIDAD: Partial<Record<TipoEntidad, 'azul' | 'rojo' | 'amarillo' | 'tinta'>> = {
  persona: 'azul', obra: 'rojo', lugar: 'amarillo', organizacion: 'tinta',
};

/** «… leí la biografía de ⟦Charlie Parker⟧, a quien…» con la mención resaltada. */
export function Pasaje({ texto, className }: { texto: string; className?: string }) {
  const partes = texto.split(/⟦|⟧/);
  return (
    <span className={className}>
      {partes.map((p, i) => (i % 2 === 1 ? <mark key={i} className="rounded-sm bg-amarillo-suave px-0.5 text-coffee-900">{p}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}

/** «1 mención», «2 menciones». */
export const menciones = (n: number) => `${numero(n)} ${n === 1 ? 'mención' : 'menciones'}`;
export const documentos = (n: number) => `${numero(n)} ${n === 1 ? 'documento' : 'documentos'}`;
