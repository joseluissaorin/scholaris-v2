import type { Ancla } from './dominio.js';

/** Cómo se imprime un ancla dentro de una cita: «p. 23», «pp. 23-24», «12:04», «diap. 7». */
export function anclaACita(ancla: Ancla, fin?: Ancla): string {
  switch (ancla.tipo) {
    case 'pagina': {
      const a = ancla.impresa ?? `[${ancla.fisica}]`;
      if (fin && fin.tipo === 'pagina') {
        const b = fin.impresa ?? `[${fin.fisica}]`;
        if (b !== a) return `pp. ${a}-${b}`;
      }
      return `p. ${a}`;
    }
    case 'tiempo':
      return tiempoACadena(ancla.t0) + (fin && fin.tipo === 'tiempo' ? `-${tiempoACadena(fin.t1)}` : '');
    case 'seccion':
      return ancla.impresa ? `p. ${ancla.impresa}` : [...ancla.ruta.slice(-1), `párr. ${ancla.parrafo}`].join(', ');
    case 'diapositiva':
      return `diap. ${ancla.n}`;
    case 'hoja':
      return `${ancla.hoja}, filas ${ancla.filaDesde}-${ancla.filaHasta}`;
    case 'web':
      return [...ancla.ruta.slice(-1), `párr. ${ancla.parrafo}`].join(', ');
    case 'imagen':
      return 'fig.';
  }
}

export function tiempoACadena(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
