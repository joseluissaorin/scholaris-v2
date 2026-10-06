/**
 * El cuaderno de la aplicación: cada boceto se escribió a mano, punto a punto,
 * en `dibujos/` (con el mismo motor que la portada, en `src/dibujo/`). Aquí solo
 * se dice dónde está cada uno y qué caja ocupa, para reservarle el sitio exacto
 * antes de que llegue (cero saltos). Cada boceto es su propio trozo diminuto y
 * el motor otro: nada de esto pesa en el marco.
 */
import type { Dibujo } from '../dibujo/boceto';

type Cargador = () => Promise<Dibujo>;

export interface EntradaBoceto {
  carga: Cargador;
  /** [ancho, alto] de la caja que se enseña (la `caja` del dibujo si la tiene). */
  caja: readonly [number, number];
}

const de = <K extends string>(m: Promise<Record<K, Dibujo>>, k: K): Promise<Dibujo> => m.then((x) => x[k]);

/**
 * Los dibujos propios se buscan por nombre de fichero (`dibujos/<nombre>.ts`, que
 * exporta un único `Dibujo`). Con el glob, un dibujo que aún no existe no rompe
 * la compilación: solo falla al pedirlo.
 */
let PROPIOS: Record<string, () => Promise<Record<string, unknown>>> = {};
try {
  PROPIOS = import.meta.glob<Record<string, unknown>>('./dibujos/*.ts');
} catch {
  /* fuera de Vite (la mesa de dibujo, con tsx): se importa por ruta */
}
function propio(nombre: string): Promise<Dibujo> {
  const cargar = PROPIOS[`./dibujos/${nombre}.ts`] ?? (() => import(/* @vite-ignore */ `./dibujos/${nombre}.ts`));
  return cargar().then((m) => {
    const d = Object.values(m).find((v): v is Dibujo => !!v && typeof v === 'object' && 'elementos' in v);
    if (!d) throw new Error(`El boceto «${nombre}» no exporta ningún dibujo.`);
    return d;
  });
}

export const BOCETOS = {
  // De la portada, tal cual: la misma mano.
  manecilla: { carga: () => de(import('../portada/dibujo/dibujos/manicula'), 'manecilla'), caja: [380, 184] },
  caracol: { carga: () => de(import('../portada/dibujo/dibujos/caracol'), 'caracol'), caja: [380, 220] },
  // Los de la aplicación, dibujados para ella.
  'estante': { carga: () => propio('estante'), caja: [420, 220] },
  'lupa': { carga: () => propio('lupa'), caja: [360, 240] },
  'tintero': { carga: () => propio('tintero'), caja: [340, 240] },
  'constelacion-vacia': { carga: () => propio('constelacion-vacia'), caja: [420, 240] },
  'imprenta': { carga: () => propio('imprenta'), caja: [300, 220] },
  'sobre': { carga: () => propio('sobre'), caja: [340, 220] },
  'llave': { carga: () => propio('llave'), caja: [340, 180] },
  'latas': { carga: () => propio('latas'), caja: [440, 200] },
  'borron': { carga: () => propio('borron'), caja: [340, 220] },
  'pagina-arrancada': { carga: () => propio('pagina-arrancada'), caja: [360, 240] },
  'manicula-suelta': { carga: () => propio('manicula-suelta'), caja: [260, 300] },
  'compas': { carga: () => propio('compas'), caja: [140, 90] },
  'escuadra': { carga: () => propio('escuadra'), caja: [140, 90] },
  'regla': { carga: () => propio('regla'), caja: [140, 90] },
  'transportador': { carga: () => propio('transportador'), caja: [140, 90] },
  'nota-aqui': { carga: () => propio('nota-aqui'), caja: [150, 70] },
  'nota-ojo': { carga: () => propio('nota-ojo'), caja: [150, 70] },
  'nota-folio': { carga: () => propio('nota-folio'), caja: [150, 70] },
  'primeros-pasos': { carga: () => propio('primeros-pasos'), caja: [640, 200] },
} satisfies Record<string, EntradaBoceto>;

export type NombreBoceto = keyof typeof BOCETOS;
