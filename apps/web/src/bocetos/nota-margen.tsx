/**
 * Notas al margen: la primera vez que alguien llega a una función que no es
 * evidente, aparece a su lado una nota a mano («aquí», «¡ojo!», «p. 145») que
 * se dibuja, se queda unos segundos y se va. No dice nada que no diga ya la
 * interfaz (es decorativa para los lectores de pantalla) y no vuelve a salir:
 * se recuerda en el navegador. Sin movimiento, aparece y se va sin más.
 */
import { useEffect, useState } from 'react';
import { Boceto } from './boceto';
import type { NombreBoceto } from './registro';

const CLAVE = 'scholaris.notas-vistas';

function vistas(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as string[]); } catch { return new Set(); }
}
function marcar(id: string) {
  try { const v = vistas(); v.add(id); localStorage.setItem(CLAVE, JSON.stringify([...v])); } catch { /* sin almacenamiento */ }
}

export function NotaMargen({ id, nombre, className, espera = 1200, dura = 7000, cuando = true }: {
  /** Identificador estable: cada nota sale una sola vez. */
  id: string;
  nombre: Extract<NombreBoceto, 'nota-aqui' | 'nota-ojo' | 'nota-folio'>;
  className?: string;
  /** Milisegundos antes de aparecer. */
  espera?: number;
  /** Cuánto se queda. */
  dura?: number;
  /** Solo cuando la función ya está a la vista. */
  cuando?: boolean;
}) {
  const [fase, setFase] = useState<'nada' | 've' | 'va'>('nada');
  useEffect(() => {
    if (!cuando || vistas().has(id)) return;
    const a = setTimeout(() => { marcar(id); setFase('ve'); }, espera);
    const b = setTimeout(() => setFase('va'), espera + dura);
    const c = setTimeout(() => setFase('nada'), espera + dura + 600);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, [id, espera, dura, cuando]);
  if (fase === 'nada') return null;
  return (
    <span
      aria-hidden
      onClick={() => setFase('va')}
      className={`nota-margen pointer-events-auto z-20 ${fase === 'va' ? 'nota-margen-va' : ''} ${className ?? ''}`}
    >
      <Boceto nombre={nombre} decorativo dibujar="ya" ritmo={0.8} />
    </span>
  );
}
