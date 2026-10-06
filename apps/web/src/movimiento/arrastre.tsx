/**
 * Arrastrar con inercia, como una tarjeta sobre la mesa: se levanta al cogerla
 * (crece un pelo y se inclina según la velocidad), sigue al dedo y, al soltar,
 * sale despedida con la velocidad que llevaba y se posa con muelle en la
 * esquina más cercana a donde iba. Se recuerda la esquina.
 *
 * Es un envoltorio: no toca el componente que envuelve (se engancha a su primer
 * elemento por debajo de un `display: contents`) y mueve solo `translate` y
 * `rotate`, que se componen con sus propias animaciones. Sin movimiento
 * reducido, el salto a la esquina es inmediato.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { curva } from './muelle';
import { quieto } from './preferencias';

type Esquina = 'ai' | 'ad' | 'bi' | 'bd'; // arriba/abajo · izquierda/derecha

const MARGEN = 20;
const IGNORAR = 'button, a, input, select, textarea, [role="slider"], video';

export function Arrastrable({ children, clave, desde = 640 }: { children: ReactNode; clave: string; /** Ancho mínimo de ventana para poder arrastrar. */ desde?: number }) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raiz = caja.current;
    if (!raiz) return;
    let el: HTMLElement | null = null;
    let quitar: (() => void) | null = null;

    const enganchar = () => {
      const nuevo = raiz.firstElementChild as HTMLElement | null;
      if (nuevo === el) return;
      quitar?.();
      el = nuevo;
      if (el) quitar = preparar(el);
    };
    const mo = new MutationObserver(enganchar);
    mo.observe(raiz, { childList: true });
    enganchar();
    return () => { mo.disconnect(); quitar?.(); };

    function preparar(n: HTMLElement): () => void {
      const guardada = (sessionStorage.getItem(`esquina.${clave}`) as Esquina | null) ?? 'bd';
      let dx = 0, dy = 0;
      // La posición de reposo (sin desplazar) se mide una vez; las esquinas se calculan desde ahí.
      const reposo = () => { const t = n.style.translate; n.style.translate = ''; const r = n.getBoundingClientRect(); n.style.translate = t; return r; };
      const destino = (e: Esquina, r: DOMRect) => ({
        // A la izquierda, sin tapar la barra lateral: el borde del contenido.
        x: e[1] === 'd' ? innerWidth - MARGEN - r.right : (document.getElementById('contenido')?.getBoundingClientRect().left ?? 0) + MARGEN - r.left,
        y: e[0] === 'b' ? innerHeight - MARGEN - r.bottom : MARGEN + 56 - r.top,
      });
      const poner = (x: number, y: number) => { dx = x; dy = y; n.style.translate = `${x}px ${y}px`; };
      if (innerWidth >= desde && guardada !== 'bd') { const d = destino(guardada, reposo()); poner(d.x, d.y); }

      let inicio: { x: number; y: number; dx: number; dy: number; t: number } | null = null;
      let ultimo = { x: 0, y: 0, t: 0 }, v = { x: 0, y: 0 };
      let movido = false;

      const abajo = (e: PointerEvent) => {
        if (innerWidth < desde || e.button !== 0 || (e.target as HTMLElement).closest(IGNORAR)) return;
        inicio = { x: e.clientX, y: e.clientY, dx, dy, t: performance.now() };
        ultimo = { x: e.clientX, y: e.clientY, t: inicio.t };
        v = { x: 0, y: 0 };
        movido = false;
        n.setPointerCapture(e.pointerId);
        n.getAnimations().forEach((a) => { if ((a as CSSAnimation).animationName == null) a.cancel(); });
      };
      const mueve = (e: PointerEvent) => {
        if (!inicio) return;
        const ox = e.clientX - inicio.x, oy = e.clientY - inicio.y;
        if (!movido && Math.hypot(ox, oy) < 6) return;
        if (!movido) { movido = true; n.dataset.arrastrando = ''; }
        const t = performance.now(), dt = Math.max(1, t - ultimo.t);
        v = { x: 0.8 * ((e.clientX - ultimo.x) / dt) + 0.2 * v.x, y: 0.8 * ((e.clientY - ultimo.y) / dt) + 0.2 * v.y };
        ultimo = { x: e.clientX, y: e.clientY, t };
        poner(inicio.dx + ox, inicio.dy + oy);
        if (!quieto()) n.style.rotate = `${Math.max(-4, Math.min(4, v.x * 2.2))}deg`;
      };
      const arriba = () => {
        if (!inicio) return;
        inicio = null;
        delete n.dataset.arrastrando;
        if (!movido) return;
        // Adonde iba: la posición más la velocidad proyectada (la inercia).
        const r = reposo();
        const px = r.left + dx + v.x * 220 + r.width / 2, py = r.top + dy + v.y * 220 + r.height / 2;
        const esquina: Esquina = `${py < innerHeight / 2 ? 'a' : 'b'}${px < innerWidth / 2 ? 'i' : 'd'}` as Esquina;
        sessionStorage.setItem(`esquina.${clave}`, esquina);
        const d = destino(esquina, r);
        const desdeX = dx, desdeY = dy;
        poner(d.x, d.y);
        n.style.rotate = '';
        if (quieto()) return;
        const { curva: c, duracion } = curva('levantar');
        n.animate([{ translate: `${desdeX}px ${desdeY}px` }, { translate: `${d.x}px ${d.y}px` }], { duration: duracion + 120, easing: c });
      };
      // Un arrastre no es un clic: se traga el clic que lo termina.
      const clic = (e: MouseEvent) => { if (movido) { e.stopPropagation(); e.preventDefault(); movido = false; } };
      const redimensiona = () => { if (innerWidth < desde) { poner(0, 0); return; } const e = (sessionStorage.getItem(`esquina.${clave}`) as Esquina | null) ?? 'bd'; const d = destino(e, reposo()); poner(d.x, d.y); };

      n.addEventListener('pointerdown', abajo);
      n.addEventListener('pointermove', mueve);
      n.addEventListener('pointerup', arriba);
      n.addEventListener('pointercancel', arriba);
      n.addEventListener('click', clic, true);
      addEventListener('resize', redimensiona);
      n.classList.add('arrastrable');
      return () => {
        n.removeEventListener('pointerdown', abajo);
        n.removeEventListener('pointermove', mueve);
        n.removeEventListener('pointerup', arriba);
        n.removeEventListener('pointercancel', arriba);
        n.removeEventListener('click', clic, true);
        removeEventListener('resize', redimensiona);
      };
    }
  }, [clave, desde]);

  return <div ref={caja} className="contents">{children}</div>;
}
