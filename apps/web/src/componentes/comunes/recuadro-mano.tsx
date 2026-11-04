/**
 * El recuadro a mano: la región de una prueba, rodeada como se rodea algo en
 * un libro con la pluma roja. Una sola línea que empieza un poco antes de la
 * esquina, da la vuelta temblando lo justo y se pasa al cerrar. Se dibuja una
 * vez al aparecer (con `prefers-reduced-motion`, ya dibujado).
 *
 * Va sobre la imagen de la unidad (página o fotograma): `region` en fracciones
 * 0-1 de esa imagen; el contenedor tiene que ocupar exactamente la imagen.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Region } from '@scholaris/nucleo';
import { cx } from '@scholaris/ui';
import { semillaDe } from '../../dibujo/azar';
import { caminoAbierto, quebrada, temblar, type Punto } from '../../dibujo/pluma';
import { quieto } from '../../movimiento/preferencias';

/** Holgura alrededor de la región, en píxeles: el trazo no tapa lo que señala. */
const HOLGURA = 5;

function trazo(ancho: number, alto: number, semilla: number): string {
  const w = ancho + 2 * HOLGURA, h = alto + 2 * HOLGURA;
  // Las esquinas, un poco fuera de sitio, y el cierre que se pasa del principio.
  const sobra = Math.min(14, w * 0.12);
  const esquinas: Punto[] = [[sobra * 0.4, 1.2], [w - 0.6, -0.4], [w + 0.5, h - 0.8], [0.4, h + 0.6], [-0.6, 0.8], [sobra * 1.3, -0.6]];
  const linea = temblar(quebrada(esquinas, false, 5), semilla, { temblor: Math.min(1.3, 0.5 + Math.min(w, h) / 160), desborde: 2.5 });
  return caminoAbierto(linea);
}

export const RecuadroMano = memo(function RecuadroMano({ region, clave, visible = true, aLaVista, etiqueta = 'La región que señala la prueba', className }: {
  region: Region;
  /** Para que el temblor sea siempre el mismo con la misma prueba. */
  clave?: string;
  visible?: boolean;
  /** Al aparecer, si la región no se ve entera, se lleva a un tercio de la ventana (una vez). */
  aLaVista?: boolean;
  etiqueta?: string;
  className?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => { const r = el.getBoundingClientRect(); setTam((t) => (t && Math.abs(t.w - r.width) < 0.5 && Math.abs(t.h - r.height) < 0.5 ? t : { w: r.width, h: r.height })); };
    medir();
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const camino = useMemo(() => (tam && tam.w > 1 && tam.h > 1 ? trazo(tam.w, tam.h, semillaDe(clave ?? `${region.x},${region.y}`)) : ''), [tam, clave, region.x, region.y]);

  useEffect(() => {
    if (!aLaVista) return;
    // Después de que el lector haya colocado la página (y medido las alturas reales).
    const h = window.setTimeout(() => {
      const r = caja.current?.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) return;
      if (r.top >= 72 && r.bottom <= window.innerHeight - 24) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - window.innerHeight * 0.3), behavior: quieto() ? 'auto' : 'smooth' });
    }, 480);
    return () => window.clearTimeout(h);
  }, [aLaVista]);

  return (
    <div
      ref={caja}
      role="img"
      aria-label={etiqueta}
      className={cx('recuadro-mano pointer-events-none absolute transition-opacity duration-300', visible ? 'opacity-100' : 'opacity-0', className)}
      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
    >
      {camino ? (
        <svg aria-hidden className="absolute overflow-visible" style={{ left: -HOLGURA, top: -HOLGURA, width: (tam?.w ?? 0) + 2 * HOLGURA, height: (tam?.h ?? 0) + 2 * HOLGURA }}>
          {/* Un velo de tinta muy leve debajo del trazo, para que se lea sobre cualquier imagen. */}
          <path key={visible ? 'velo' : 'velo-oculto'} d={camino} pathLength={1} fill="none" stroke="var(--s-cream-50)" strokeOpacity="0.55" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="recuadro-trazo" />
          <path key={visible ? 'si' : 'no'} d={camino} pathLength={1} fill="none" stroke="var(--s-rojo)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className="recuadro-trazo" />
        </svg>
      ) : null}
    </div>
  );
});
