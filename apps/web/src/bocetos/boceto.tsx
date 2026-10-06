/**
 * <Boceto>: un dibujo a mano que se dibuja solo (primero el lápiz, luego la
 * pluma, al final el color y las notas) la primera vez que entra en pantalla.
 *
 * El motor y el dibujo llegan en sus propios trozos; mientras tanto la caja ya
 * ocupa su sitio. El SVG se calcula una vez por dibujo y se guarda. Con
 * `prefers-reduced-motion`, el boceto aparece ya terminado. Lo que dice el
 * dibujo está en su <title>/<desc>, o se marca decorativo.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { BOCETOS, type NombreBoceto } from './registro';

const cache = new Map<string, Promise<string>>();

function svgDe(nombre: NombreBoceto, decorativo: boolean, sufijo: string, espera: number): Promise<string> {
  const clave = `${nombre}|${decorativo ? 1 : 0}|${espera}`;
  let p = cache.get(clave);
  if (!p) {
    p = Promise.all([import('../dibujo/boceto'), BOCETOS[nombre].carga()]).then(([{ aSvg }, d]) =>
      // El sufijo se cambia en cada uso (las máscaras necesitan ids únicos): se guarda con un hueco.
      aSvg(d, { decorativo, espera, sufijo: 'SFX' }),
    );
    cache.set(clave, p);
  }
  return p.then((s) => s.replace(/SFX/g, sufijo));
}

/** Precarga un boceto (al pasar por encima de algo que lo va a enseñar, por ejemplo). */
export function precargarBoceto(nombre: NombreBoceto) {
  void svgDe(nombre, true, 'p', 0);
}

export interface PropsBoceto {
  nombre: NombreBoceto;
  className?: string;
  style?: CSSProperties;
  /** Sin título para lectores de pantalla (cuando el texto de al lado ya lo dice). */
  decorativo?: boolean;
  /** Segundos antes de empezar a dibujar. */
  espera?: number;
  /**
   * Quién decide cuándo se dibuja: `vista` (al entrar en pantalla, por defecto),
   * `ya` (al montarse) o un booleano controlado desde fuera.
   */
  dibujar?: 'vista' | 'ya' | boolean;
  /** Dibuja más deprisa (multiplica la duración). */
  ritmo?: number;
}

export function Boceto({ nombre, className, style, decorativo = false, espera = 0, dibujar = 'vista', ritmo = 1 }: PropsBoceto) {
  const id = useId().replace(/[^a-z0-9]/gi, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [visto, setVisto] = useState(dibujar === true);
  const caja = useRef<HTMLSpanElement>(null);
  const [w, h] = BOCETOS[nombre].caja;

  useEffect(() => {
    let vivo = true;
    void svgDe(nombre, decorativo, id, espera).then((s) => vivo && setSvg(s));
    return () => { vivo = false; };
  }, [nombre, decorativo, espera, id]);

  useEffect(() => {
    if (typeof dibujar === 'boolean') { setVisto(dibujar); return; }
    if (!svg) return;
    // Dos fotogramas: el SVG se pinta sin dibujar y después la pluma corre.
    let r2 = 0;
    const lanzar = () => { const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setVisto(true)); }); return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); }; };
    if (dibujar === 'ya' || !('IntersectionObserver' in window)) return lanzar();
    const el = caja.current;
    if (!el) return;
    let parar: (() => void) | undefined;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); parar = lanzar(); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); parar?.(); };
  }, [svg, dibujar]);

  return (
    <span
      ref={caja}
      className={`boceto${visto ? ' visto' : ''}${className ? ` ${className}` : ''}`}
      style={{ aspectRatio: `${w} / ${h}`, ...(ritmo !== 1 ? { ['--ritmo' as string]: ritmo } : null), ...style }}
      aria-hidden={decorativo || !svg ? true : undefined}
      // El SVG lo genera nuestro propio motor a partir de coordenadas escritas a mano: no hay entrada del usuario.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
