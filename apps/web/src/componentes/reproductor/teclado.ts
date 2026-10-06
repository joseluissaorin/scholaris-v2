/**
 * El teclado del reproductor (solo mientras está abierto en el lector):
 *
 *   Espacio, K   reproducir o pausar
 *   J / L        10 s atrás / adelante
 *   ← / →        5 s atrás / adelante
 *   Mayús ← / →  línea anterior / siguiente de la transcripción
 *   [ / ]        más despacio / más deprisa (también < y >)
 *   M            sin sonido
 *   F            pantalla completa
 *   C            subtítulos
 *   I            imagen dentro de imagen
 *   0-9          ir al 0 %, 10 %… 90 %
 */
import { useEffect, type RefObject } from 'react';
import { motor } from './motor';
import { velocidadVecina } from './maquina';
import { lineaEn, type Transcripcion } from './transcripcion';

export const ATAJOS: Array<[string[], string]> = [
  [['Espacio'], 'Reproducir o pausar (también K)'],
  [['J', 'L'], '10 segundos atrás o adelante'],
  [['←', '→'], '5 segundos atrás o adelante'],
  [['Mayús', '←', '→'], 'Línea anterior o siguiente'],
  [['[', ']'], 'Más despacio o más deprisa'],
  [['M'], 'Quitar o devolver el sonido'],
  [['C'], 'Subtítulos'],
  [['F'], 'Pantalla completa'],
  [['I'], 'Imagen dentro de imagen'],
  [['0', '9'], 'Ir al 0 %… 90 %'],
];

const esCampo = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

/** Salto de línea con Mayús: si ya se está dentro de la línea, «anterior» vuelve a su principio. */
export function instanteLinea(tr: Transcripcion, t: number, dir: 1 | -1): number | null {
  if (!tr.lineas.length) return null;
  const i = lineaEn(tr, t);
  if (dir > 0) return tr.lineas[Math.min(tr.lineas.length - 1, i + 1)]!.t0;
  if (i < 0) return 0;
  const l = tr.lineas[i]!;
  if (t - l.t0 > 1) return l.t0;
  return tr.lineas[Math.max(0, i - 1)]!.t0;
}

export function useTeclado(o: { transcripcion: RefObject<Transcripcion | null>; pantalla: RefObject<HTMLElement | null>; ayuda: () => void; activo: boolean }) {
  useEffect(() => {
    if (!o.activo) return;
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || esCampo(e.target)) return;
      const m = motor();
      const enBoton = (e.target as HTMLElement | null)?.closest?.('button, a, [role="menuitem"], [role="slider"]');
      const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const hecho = () => { e.preventDefault(); e.stopPropagation(); };
      switch (tecla) {
        case ' ':
          if (enBoton) return; // el espacio sobre un botón lo pulsa
          hecho(); m.alternar(); return;
        case 'k': hecho(); m.alternar(); return;
        case 'j': hecho(); m.saltar(-10); return;
        case 'l': hecho(); m.saltar(10); return;
        case 'ArrowLeft': case 'ArrowRight': {
          const dir = tecla === 'ArrowRight' ? 1 : -1;
          if (e.shiftKey && o.transcripcion.current) {
            const t = instanteLinea(o.transcripcion.current, m.tiempo(), dir);
            if (t != null) { hecho(); m.irA(t, { osd: dir > 0 ? 'Línea siguiente' : 'Línea anterior' }); }
            return;
          }
          hecho(); m.saltar(dir * 5); return;
        }
        case '[': case '<': hecho(); m.ponerVelocidad(velocidadVecina(m.instantanea().velocidad, -1)); return;
        case ']': case '>': hecho(); m.ponerVelocidad(velocidadVecina(m.instantanea().velocidad, 1)); return;
        case 'm': hecho(); m.alternarSilencio(); return;
        case 'c': hecho(); m.alternarSubtitulos(); return;
        case 'f': if (m.instantanea().tipo === 'video') { hecho(); void m.alternarPantallaCompleta(o.pantalla.current); } return;
        case 'i': if (m.instantanea().tipo === 'video') { hecho(); void m.alternarPip(); } return;
        case '?': hecho(); o.ayuda(); return;
        default:
          if (/^[0-9]$/.test(tecla) && !e.shiftKey) {
            const d = m.instantanea().duracion;
            if (d) { hecho(); m.irA((Number(tecla) / 10) * d); }
          }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [o.activo, o.transcripcion, o.pantalla, o.ayuda]);
}
