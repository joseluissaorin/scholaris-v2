import { cx, Icono, type NombreIcono } from '@scholaris/ui';

/**
 * El icono de tipo de documento sobre su forma de color (Kandinsky): el libro
 * sobre el círculo azul, el sonido sobre el triángulo amarillo, la imagen en
 * movimiento sobre el cuadrado rojo. Una plaquita con relieve.
 */
const FORMA: Partial<Record<NombreIcono, 'circulo' | 'triangulo' | 'cuadrado'>> = {
  documento: 'circulo', lector: 'circulo', web: 'circulo', hoja: 'circulo',
  audio: 'triangulo', camara: 'triangulo', imagen: 'triangulo',
  video: 'cuadrado', diapositiva: 'cuadrado',
};

export function IconoTipo({ nombre, tam = 34, className }: { nombre: NombreIcono; tam?: number; className?: string }) {
  const f = FORMA[nombre] ?? 'circulo';
  return (
    <span className={cx('relative grid shrink-0 place-items-center rounded-lg border border-cream-400 bg-cream-50 text-coffee-700 shadow-[var(--relieve)]', className)} style={{ width: tam, height: tam }} aria-hidden>
      <svg viewBox="0 0 20 20" className="absolute right-[3px] top-[3px] h-[38%] w-[38%]">
        {f === 'circulo' ? <circle cx="10" cy="10" r="8" fill="var(--s-azul)" /> : f === 'triangulo' ? <path d="M10 2L18 17H2z" fill="var(--s-amarillo)" /> : <rect x="3" y="3" width="14" height="14" fill="var(--s-rojo)" />}
      </svg>
      <Icono nombre={nombre} tam={Math.round(tam * 0.5)} className="relative" />
    </span>
  );
}
