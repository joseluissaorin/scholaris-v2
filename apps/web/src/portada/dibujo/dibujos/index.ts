/** Todos los dibujos del cuaderno, por nombre. */
import { manicula } from './manicula';
import { inicial } from './inicial';
import { biblioteca } from './biblioteca';
import { constelacion } from './constelacion';
import { maquina } from './maquina';
import { triada } from './triada';
import { caracol } from './caracol';

export const DIBUJOS = { manicula, inicial, biblioteca, constelacion, maquina, triada, caracol } as const;
export type NombreDibujo = keyof typeof DIBUJOS;
