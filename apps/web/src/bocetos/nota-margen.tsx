/**
 * Notas al margen: la primera vez que alguien llega a una función que no es
 * evidente, aparece a su lado una nota a mano («aquí», «¡ojo!», «p. 145») que
 * se dibuja, se queda unos segundos y se va. No dice nada que no diga ya la
 * interfaz (es decorativa para los lectores de pantalla) y no vuelve a salir:
 * se recuerda en el navegador. Sin movimiento, aparece y se va sin más.
 *
 * Solo va en el margen de verdad: antes de enseñarse se mide, invisible, y si
 * debajo hay contenido (texto, imágenes, páginas, controles, tarjetas) o se sale
 * de la ventana o del área de contenido, no sale (y queda pendiente para otra
 * vez). Si mientras está a la vista algo se le mete debajo (al desplazarse, al
 * cambiar el tamaño), se va.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Boceto } from './boceto';
import { BOCETOS, type NombreBoceto } from './registro';

const CLAVE = 'scholaris.notas-vistas';

function vistas(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? '[]') as string[]); } catch { return new Set(); }
}
function marcar(id: string) {
  try { const v = vistas(); v.add(id); localStorage.setItem(CLAVE, JSON.stringify([...v])); } catch { /* sin almacenamiento */ }
}

/** Lo que se lee, se mira o se pulsa: siempre es contenido. */
const HOJA = 'img, picture, video, canvas, svg, p, h1, h2, h3, h4, h5, h6, a, button, input, select, textarea, label, li, blockquote, pre, code, table, figure, mark, kbd, .facsimil, [data-portada]';

/** Una superficie: algo con fondo o con borde (una tarjeta, una página, una barra). */
function superficie(el: Element): boolean {
  const c = getComputedStyle(el);
  const alfa = /rgba?\(([^)]+)\)/.exec(c.backgroundColor)?.[1]?.split(',').map((x) => x.trim());
  const fondo = c.backgroundImage !== 'none' || (!!alfa && (alfa.length < 4 || Number(alfa[3]) > 0.05) && c.backgroundColor !== 'transparent');
  // Un borde por un solo lado es un filete (separa filas), no una superficie; dos o más, una caja.
  const borde = ['top', 'right', 'bottom', 'left'].filter((l) => parseFloat(c.getPropertyValue(`border-${l}-width`)) > 0 && c.getPropertyValue(`border-${l}-style`) !== 'none').length >= 2;
  return fondo || borde;
}

function esContenido(el: Element): boolean {
  if (el.closest(HOJA)) return true;
  if ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) return true;
  // Subiendo hasta el área de contenido (sin contarla): ¿hay alguna superficie debajo?
  for (let e: Element | null = el; e && e.id !== 'contenido' && e !== document.body; e = e.parentElement) {
    if (superficie(e)) return true;
  }
  return false;
}

/** ¿Está libre el sitio que ocupa la nota? Se prueba una rejilla de puntos de su caja. */
function libre(nota: HTMLElement): boolean {
  const r = nota.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const area = document.getElementById('contenido')?.getBoundingClientRect();
  // Dentro de la ventana y del área de contenido (nunca encima de la barra lateral).
  if (r.left < (area?.left ?? 0) + 4 || r.right > Math.min(innerWidth, area?.right ?? innerWidth) - 4 || r.top < 0 || r.bottom > innerHeight) return false;
  for (const fx of [0.08, 0.35, 0.65, 0.92]) {
    for (const fy of [0.12, 0.5, 0.88]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const debajo = document.elementsFromPoint(x, y).find((e) => !nota.contains(e));
      if (debajo && esContenido(debajo)) return false;
    }
  }
  return true;
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
  const [fase, setFase] = useState<'nada' | 'mide' | 've' | 'va'>('nada');
  const caja = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!cuando || vistas().has(id)) return;
    const a = setTimeout(() => setFase('mide'), espera);
    return () => clearTimeout(a);
  }, [id, espera, cuando]);

  // Medir antes de enseñarse: si el sitio no está libre, no sale.
  useLayoutEffect(() => {
    if (fase !== 'mide' || !caja.current) return;
    if (libre(caja.current)) { marcar(id); setFase('ve'); } else setFase('nada');
  }, [fase, id]);

  // A la vista: se va sola al cabo de un rato, o antes si algo se le mete debajo.
  useEffect(() => {
    if (fase !== 've') return;
    const b = setTimeout(() => setFase('va'), dura);
    let raf = 0;
    const vigilar = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (caja.current && !libre(caja.current)) setFase('va'); }); };
    addEventListener('scroll', vigilar, { capture: true, passive: true });
    addEventListener('resize', vigilar);
    return () => { clearTimeout(b); cancelAnimationFrame(raf); removeEventListener('scroll', vigilar, { capture: true }); removeEventListener('resize', vigilar); };
  }, [fase, dura]);

  useEffect(() => {
    if (fase !== 'va') return;
    const c = setTimeout(() => setFase('nada'), 600);
    return () => clearTimeout(c);
  }, [fase]);

  if (fase === 'nada') return null;
  return (
    <span
      ref={caja}
      aria-hidden
      onClick={() => setFase('va')}
      style={fase === 'mide' ? { visibility: 'hidden' } : undefined}
      className={`nota-margen pointer-events-auto z-20 ${fase === 'va' ? 'nota-margen-va' : ''} ${className ?? ''}`}
    >
      {fase === 'mide' ? <span className="block" style={{ aspectRatio: `${BOCETOS[nombre].caja[0]} / ${BOCETOS[nombre].caja[1]}` }} /> : <Boceto nombre={nombre} decorativo dibujar="ya" ritmo={0.8} />}
    </span>
  );
}
