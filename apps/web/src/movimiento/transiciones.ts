/**
 * Transiciones entre pantallas. Con la View Transitions API (Chrome, Edge,
 * Safari 18): el contenido viejo se desvanece y el nuevo sube del papel; hacia
 * el lector, la hoja sube más; al volver, baja a la mesa. Una portada de la
 * Biblioteca (o una tarjeta de resultado de Buscar) viaja y crece hasta su sitio
 * en el lector, y al volver regresa a su hueco en la rejilla.
 *
 * Sin la API, el contenido nuevo sube igual, con la Web Animations API. Solo
 * cambia de pantalla cuando cambia la ruta: los cambios de `?u=` o `?t=` (el
 * lector siguiendo la lectura) no animan nada. Con `prefers-reduced-motion`,
 * nada.
 *
 * El enrutador llama a `startViewTransition` al confirmar cada navegación; aquí
 * se sustituye por una versión que sabe de dónde viene y adónde va.
 */
import { quieto } from './preferencias';

interface EnrutadorConTransicion {
  startViewTransition: (fn: () => Promise<void>) => Promise<void> | void;
  latestLocation: { pathname: string };
  subscribe: (evento: 'onResolved', oyente: (e: { toLocation: { pathname: string }; pathChanged: boolean }) => void) => () => void;
}

const NOMBRE = 'compartido';
const html = () => document.documentElement;

/** Lo que el clic dejó preparado: qué elemento sale y cómo encontrar adónde llega. */
let origen: HTMLElement | null = null;
let destino: (() => HTMLElement | null) | null = null;

/**
 * Al pulsar una portada o un resultado: ese elemento será el que viaje. `llegada`
 * busca su sitio en la pantalla nueva (por defecto, la portada del lector o la
 * columna de lectura).
 */
export function prepararViaje(el: HTMLElement | null, llegada: 'portada' | 'lectura' = 'portada') {
  if (!el || quieto() || !('startViewTransition' in document)) return;
  limpiar();
  origen = el;
  destino = () => document.querySelector<HTMLElement>(`[data-compartido="${llegada}"]`);
}

function limpiar() {
  if (origen) origen.style.viewTransitionName = '';
  origen = null;
  destino = null;
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera (poco) a que la pantalla nueva tenga pintado lo que buscamos. */
async function hasta(buscar: () => HTMLElement | null, intentos = 10): Promise<HTMLElement | null> {
  for (let i = 0; i < intentos; i++) {
    const el = buscar();
    if (el) return el;
    await espera(16);
  }
  return null;
}

function tipoDe(desde: string, hacia: string): 'lector' | 'mesa' | 'seccion' {
  const a = desde.startsWith('/lector/'), b = hacia.startsWith('/lector/');
  if (b && !a) return 'lector';
  if (a && !b) return 'mesa';
  return 'seccion';
}

export function instalarTransiciones(enrutador: EnrutadorConTransicion) {
  if (typeof document === 'undefined') return;
  let ruta = location.pathname;
  enrutador.subscribe('onResolved', (e) => { ruta = e.toLocation.pathname; });
  const conApi = 'startViewTransition' in document;

  enrutador.startViewTransition = (fn) => {
    const desde = ruta, hacia = enrutador.latestLocation.pathname;
    if (desde === hacia || quieto()) { limpiar(); return fn(); }
    const tipo = tipoDe(desde, hacia);

    if (!conApi) {
      // Sin la API: lo nuevo sube del papel cuando ya está pintado.
      return fn().then(() => {
        requestAnimationFrame(() => {
          document.getElementById('contenido')?.animate(
            [{ opacity: 0, transform: `translateY(${tipo === 'lector' ? 22 : 10}px)` }, { opacity: 1, transform: 'none' }],
            { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          );
        });
      });
    }

    // De vuelta del lector: la portada pequeña de la barra vuelve a su hueco en la rejilla.
    if (tipo === 'mesa' && !origen) {
      const id = desde.split('/')[2];
      const portada = document.querySelector<HTMLElement>('[data-compartido="portada"]');
      if (portada && id) {
        origen = portada;
        destino = () => document.querySelector<HTMLElement>(`a[href^="/lector/${CSS.escape(id)}"] > [data-portada]`);
      }
    }
    if (origen) origen.style.viewTransitionName = NOMBRE;
    const llegada = destino;
    html().dataset.transicion = tipo;

    const t = document.startViewTransition(async () => {
      if (origen) origen.style.viewTransitionName = '';
      await fn();
      // React pinta la pantalla nueva en cuanto se confirma; se le da un instante.
      await espera(0);
      if (llegada) {
        const el = await hasta(llegada);
        if (el) { el.style.viewTransitionName = NOMBRE; origen = el; }
      } else {
        await hasta(() => document.getElementById('contenido'), 2);
      }
    });
    void t.finished.finally(() => {
      delete html().dataset.transicion;
      limpiar();
    });
    return t.updateCallbackDone;
  };
}
