/**
 * Muelles. El relieve de Scholaris es físico: lo que se pulsa se hunde deprisa
 * y, al soltarlo, sube con un muelle que se pasa un pelo y vuelve; las tarjetas
 * se levantan del papel y se posan. Un muelle se describe con su rigidez y su
 * amortiguación (masa 1) y aquí se convierte en lo que entiende el navegador:
 * una curva `linear()` de CSS (la misma que hay, ya calculada, en tema.css) o
 * fotogramas para la Web Animations API.
 */
export interface Muelle {
  /** Rigidez (k): cuanto más, más deprisa vuelve. */
  rigidez: number;
  /** Amortiguación (c): por debajo de 2·√k se pasa y rebota. */
  amortiguacion: number;
}

/** Los muelles del lenguaje táctil. Los mismos valores generan los tokens de tema.css. */
export const MUELLES = {
  /** Soltar: el botón vuelve a subir y se pasa un poco (≈5 %). */
  soltar: { rigidez: 560, amortiguacion: 30 },
  /** Levantar: una tarjeta que se despega del papel, blanda. */
  levantar: { rigidez: 320, amortiguacion: 26 },
  /** Asentar: lo que entra en pantalla se posa sin rebotar. */
  asentar: { rigidez: 210, amortiguacion: 29 },
  /** Sello: una cita que se estampa, con un rebote seco. */
  sello: { rigidez: 760, amortiguacion: 19 },
} as const satisfies Record<string, Muelle>;

export type NombreMuelle = keyof typeof MUELLES;

/** Simula el muelle de 0 a 1 (con velocidad inicial opcional) hasta que se para. */
export function simular(m: Muelle, v0 = 0, paso = 1 / 240): { x: number[]; duracion: number } {
  let x = 0, v = v0;
  const xs = [0];
  let t = 0;
  for (;;) {
    const a = -m.rigidez * (x - 1) - m.amortiguacion * v;
    v += a * paso;
    x += v * paso;
    t += paso;
    xs.push(x);
    if ((Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) || t > 3) break;
  }
  xs[xs.length - 1] = 1;
  return { x: xs, duracion: t * 1000 };
}

/** La curva como `linear(…)` de CSS, con ~40 puntos (y cuánto dura, en ms). */
export function curvaCss(m: Muelle, puntos = 40): { curva: string; duracion: number } {
  const { x, duracion } = simular(m);
  const valores: string[] = [];
  for (let i = 0; i <= puntos; i++) {
    const v = x[Math.round((i / puntos) * (x.length - 1))]!;
    valores.push(String(Math.round(v * 1000) / 1000));
  }
  return { curva: `linear(${valores.join(', ')})`, duracion: Math.round(duracion) };
}

/** Curvas calculadas una vez por muelle (para `el.animate`). */
const memo = new Map<Muelle, { curva: string; duracion: number }>();
export function curva(m: Muelle | NombreMuelle): { curva: string; duracion: number } {
  const muelle = typeof m === 'string' ? MUELLES[m] : m;
  let c = memo.get(muelle);
  if (!c) {
    c = soportaLinear() ? curvaCss(muelle) : { curva: 'cubic-bezier(0.16, 1, 0.3, 1)', duracion: Math.round(simular(muelle).duracion * 0.8) };
    memo.set(muelle, c);
  }
  return c;
}

let _linear: boolean | undefined;
function soportaLinear(): boolean {
  if (_linear == null) _linear = typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)');
  return _linear;
}
