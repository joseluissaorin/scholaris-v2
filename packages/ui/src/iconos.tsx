import type { SVGProps } from 'react';

/**
 * Iconos propios, de trazo fino y geometría Bauhaus (círculo, cuadrado, triángulo).
 * Un solo componente con un mapa de trazados: pesan menos que una librería y
 * hablan el mismo idioma que el resto del sistema.
 */
const TRAZOS = {
  biblioteca: <><path d="M4 4v16M8 4v16" /><path d="M12 5l3.5-1 4 15.5-3.5 1z" /><path d="M3 20h18" /></>,
  lector: <><path d="M3 5.5C6 4 9 4 12 6c3-2 6-2 9-.5V19c-3-1.5-6-1.5-9 .5-3-2-6-2-9-.5z" /><path d="M12 6v13.5" /></>,
  buscar: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5.5 5.5" /></>,
  escribir: <><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z" /><path d="M14 7l3 3" /><path d="M13 20h7" /></>,
  explorar: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="17" r="2.5" /><path d="M7.6 8.3l3 6.5M16.8 7.6l-3.6 7.3M8 7h8" /></>,
  ajustes: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  subir: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4" /></>,
  camara: <><path d="M3 8a1 1 0 011-1h3l2-2.5h6L17 7h3a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><circle cx="12" cy="13" r="3.8" /></>,
  enlace: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.2 1.2" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.2-1.2" /></>,
  mas: <path d="M12 5v14M5 12h14" />,
  cerrar: <path d="M6 6l12 12M18 6L6 18" />,
  derecha: <path d="M5 12h14M13 6l6 6-6 6" />,
  izquierda: <path d="M19 12H5M11 6l-6 6 6 6" />,
  abajo: <path d="M6 9l6 6 6-6" />,
  arriba: <path d="M6 15l6-6 6 6" />,
  cuadricula: <><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></>,
  lista: <path d="M4 6h16M4 12h16M4 18h16" />,
  filtro: <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />,
  ordenar: <path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5" />,
  citar: <><path d="M5 17c3-1 4-3.5 4-7V7H5v4h3" /><path d="M14 17c3-1 4-3.5 4-7V7h-4v4h3" /></>,
  copiar: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>,
  hecho: <path d="M4.5 12.5l5 5L20 7" />,
  deshacer: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></>,
  papelera: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  vigilante: <><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" /></>,
  historial: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  pausa: <path d="M8 5v14M16 5v14" />,
  documento: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  audio: <><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="1" /><path d="M16 10.5l5-3v9l-5-3" /></>,
  imagen: <><rect x="3" y="4" width="18" height="16" rx="1" /><circle cx="9" cy="9.5" r="1.8" /><path d="M3 17l5-5 4 4 3-3 6 6" /></>,
  web: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" /></>,
  hoja: <><rect x="3.5" y="4" width="17" height="16" rx="1" /><path d="M3.5 9h17M3.5 14.5h17M9.5 4v16" /></>,
  diapositiva: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M12 16v4M8 20h8" /></>,
  pila: <><path d="M4 8l8-4 8 4-8 4z" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" /></>,
  chispa: <path d="M12 3c.6 4.5 2.5 6.6 7 7.5-4.5.9-6.4 3-7 7.5-.6-4.5-2.5-6.6-7-7.5 4.5-.9 6.4-3 7-7.5z" />,
  idiomas: <><path d="M3 5h9M7.5 3v2M5 5c1 4 3.5 6.5 6.5 7.5M10 5c-1 4-3.5 7-6.5 8.5" /><path d="M12.5 21l4-9.5 4 9.5M14 18h5" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>,
  luna: <path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z" />,
  salir: <><path d="M14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  opciones: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  editar: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>,
  fijar: <><path d="M9 3h6l-1 6 4 3v2H6v-2l4-3z" /><path d="M12 14v7" /></>,
  llave: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16.5 6.5l3 3M14 9l2 2" /></>,
  descargar: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  aviso: <><path d="M12 3.5L21.5 20h-19z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  teclado: <><rect x="2.5" y="6" width="19" height="12" rx="1" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  ojo: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  marcador: <path d="M6 3h12v18l-6-4.5L6 21z" />,
  saltar: <><path d="M4 12h11M11 7l5 5-5 5" /><path d="M20 4v16" /></>,
  rayo: <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" />,
  nube: <path d="M7 18.5h10a4 4 0 00.6-8 6 6 0 00-11.4 1.5A3.3 3.3 0 007 18.5z" />,
  casa: <><path d="M4 11l8-6.5 8 6.5" /><path d="M6 9.5V20h12V9.5" /></>,
  figura: <><rect x="4" y="4" width="16" height="11" /><path d="M4 19h16M4 22h10" /></>,
  indice: <path d="M4 5h3M10 5h10M4 10h3M10 10h10M7 15h3M13 15h7M7 20h3M13 20h7" />,
} as const;

export type NombreIcono = keyof typeof TRAZOS;

export interface PropsIcono extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  nombre: NombreIcono;
  /** Tamaño en píxeles. */
  tam?: number;
  /** Texto alternativo; sin él, el icono es decorativo. */
  titulo?: string;
  grosor?: number;
}

export function Icono({ nombre, tam = 18, titulo, grosor = 1.75, ...resto }: PropsIcono) {
  const relleno = nombre === 'play' || nombre === 'marcador' ? 'currentColor' : 'none';
  return (
    <svg
      viewBox="0 0 24 24"
      width={tam}
      height={tam}
      fill={relleno}
      stroke="currentColor"
      strokeWidth={grosor}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={titulo ? undefined : true}
      role={titulo ? 'img' : undefined}
      focusable="false"
      {...resto}
    >
      {titulo ? <title>{titulo}</title> : null}
      {TRAZOS[nombre]}
    </svg>
  );
}
