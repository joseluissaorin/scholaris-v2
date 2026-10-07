/**
 * El subrayado del pasaje en el lector: las oraciones que se citan, sobre amarillo,
 * y el resto del fragmento en un tono muy suave alrededor. Se pinta con la CSS
 * Custom Highlight API (rangos sobre el texto ya pintado: no cambia el DOM ni
 * el Markdown); sin ella, el párrafo del pasaje se marca al margen.
 *
 * El pasaje puede partirse entre dos páginas: cada página subraya su trozo.
 * Al llegar desde un resultado (o al pasar al siguiente), la página que tiene el
 * principio del pasaje lo coloca a un tercio de la ventana, una sola vez.
 */
import { useEffect, type RefObject } from 'react';
import { ubicarPasajeEnUnidad } from '@scholaris/nucleo';
import { quieto } from '../../movimiento/preferencias';

type Registro = { add: (r: Range) => void; delete: (r: Range) => boolean };
interface ApiResaltados { get: (n: string) => Registro | undefined; set: (n: string, h: Registro) => void }

function registro(nombre: string): Registro | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: ApiResaltados } }).CSS;
  const Resaltado = (globalThis as unknown as { Highlight?: new () => Registro }).Highlight;
  if (!css?.highlights || !Resaltado) return null;
  let h = css.highlights.get(nombre);
  if (!h) { h = new Resaltado(); css.highlights.set(nombre, h); }
  return h;
}

/** Texto visible del contenedor y, para cada nodo de texto, dónde empieza. */
function mapaDeTexto(el: HTMLElement): { todo: string; nodos: Array<{ n: Text; desde: number }> } {
  const nodos: Array<{ n: Text; desde: number }> = [];
  let todo = '';
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { nodos.push({ n: n as Text, desde: todo.length }); todo += (n as Text).data; }
  return { todo, nodos };
}

function rango(mapa: ReturnType<typeof mapaDeTexto>, a: number, b: number): Range | null {
  const punto = (x: number, fin: boolean): [Text, number] | null => {
    for (let i = 0; i < mapa.nodos.length; i++) {
      const { n, desde } = mapa.nodos[i]!;
      const hasta = desde + n.data.length;
      if (x < hasta || (fin && x === hasta) || i === mapa.nodos.length - 1) return [n, Math.max(0, Math.min(n.data.length, x - desde))];
    }
    return null;
  };
  const p = punto(a, false), q = punto(b, true);
  if (!p || !q) return null;
  const r = document.createRange();
  r.setStart(p[0], p[1]);
  r.setEnd(q[0], q[1]);
  return r;
}

// Un solo desplazamiento por llegada: la clave del pasaje que hay que poner a la vista.
let pendiente: string | null = null;
export function pedirDesplazamiento(clave: string | null) { pendiente = clave; }

/** Subraya `pasaje` (y `contexto`, en suave) dentro de `ref`. `clave` identifica la llegada. */
export function useSubrayado(ref: RefObject<HTMLElement | null>, pasaje: string | undefined, contexto: string | undefined, version: unknown) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !pasaje) return;
    const mapa = mapaDeTexto(el);
    const enPagina = ubicarPasajeEnUnidad(mapa.todo, pasaje);
    if (!enPagina) return;
    const r = rango(mapa, enPagina.desde, enPagina.hasta);
    if (!r) return;
    const limpiezas: Array<() => void> = [];
    const h = registro('pasaje');
    if (h) {
      h.add(r);
      limpiezas.push(() => h.delete(r));
      if (contexto) {
        const c = ubicarPasajeEnUnidad(mapa.todo, contexto);
        const rc = c ? rango(mapa, c.desde, c.hasta) : null;
        const hc = rc ? registro('pasaje-contexto') : null;
        if (rc && hc) { hc.add(rc); limpiezas.push(() => hc.delete(rc)); }
      }
    } else {
      const bloque = (r.startContainer.parentElement?.closest('p, li, td, h2, h3') ?? null) as HTMLElement | null;
      if (bloque) { bloque.setAttribute('data-pasaje-respaldo', ''); limpiezas.push(() => bloque.removeAttribute('data-pasaje-respaldo')); }
    }
    // A la vista, a un tercio de la altura: solo la página que tiene su principio, y una vez.
    const clave = claveDePasaje(pasaje);
    if (pendiente === clave && enPagina.parte !== 'final') {
      pendiente = null;
      // Después de que el flujo haya colocado la página (y medido las alturas reales).
      let hecho = false;
      const t = window.setTimeout(() => {
        hecho = true;
        const caja = r.getBoundingClientRect();
        if (!caja.height && !caja.width) return;
        window.scrollTo({ top: Math.max(0, window.scrollY + caja.top - window.innerHeight * 0.3), behavior: quieto() ? 'auto' : 'smooth' });
      }, 340);
      limpiezas.push(() => { window.clearTimeout(t); if (!hecho && pendiente === null) pendiente = clave; });
    }
    return () => { for (const f of limpiezas) f(); };
  }, [ref, pasaje, contexto, version]);
}

/** La clave con la que el lector pide poner un pasaje a la vista. */
export const claveDePasaje = (pasaje: string) => `${pasaje.length}:${pasaje.slice(0, 40)}`;
