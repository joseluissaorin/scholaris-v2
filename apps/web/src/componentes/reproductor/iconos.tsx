/**
 * Iconos propios del reproductor, con el mismo trazo redondo que los de
 * `@scholaris/ui` (que no tiene subtítulos, imagen dentro de imagen, pantalla
 * completa ni volumen).
 */
const TRAZOS = {
  subtitulos: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M10.5 10.2a2.2 2.2 0 100 3.6M17 10.2a2.2 2.2 0 100 3.6" /></>,
  pip: <><rect x="3" y="5" width="18" height="14" rx="2" /><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" /></>,
  ampliar: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  reducir: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  volumen: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" /></>,
  silencio: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  atras: <><path d="M4 12a8 8 0 108-8H8.5" /><path d="M11 1.5L8.2 4.2 11 7" /></>,
  adelante: <><path d="M20 12a8 8 0 11-8-8h3.5" /><path d="M13 1.5l2.8 2.7L13 7" /></>,
  enlace: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.2-1.2" /></>,
  reintentar: <><path d="M20 12a8 8 0 11-2.3-5.6" /><path d="M20 4v4.5h-4.5" /></>,
} as const;

export type NombreIconoReproductor = keyof typeof TRAZOS;

export function IconoR({ nombre, tam = 20, grosor = 1.8 }: { nombre: NombreIconoReproductor; tam?: number; grosor?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={tam} height={tam} fill="none" stroke="currentColor" strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {TRAZOS[nombre]}
    </svg>
  );
}
