/**
 * Sin conexión: el teléfono de dos latas de cuando éramos pequeños, con el hilo
 * cortado por la mitad y los dos cabos colgando. A lápiz queda por dónde iba
 * la línea; la tijera, en rojo, dice dónde se rompió.
 */
import { type Dibujo, tinta, lapiz, rojo, plano, sombra, nota } from '../../dibujo/boceto';

export const latas: Dibujo = {
  id: 'latas',
  ancho: 440,
  alto: 200,
  duracion: 2,
  titulo: 'Dos latas unidas por un hilo cortado',
  descripcion:
    'Dos latas de conserva usadas como teléfono, una a cada lado, con el hilo que las unía cortado por la mitad: los dos cabos cuelgan sueltos. A lápiz se ve por dónde iba la línea y, encima, escrito a mano: «sin línea».',
  elementos: [
    // Encaje: el eje de las latas y el hilo que había.
    lapiz([[14, 110], [426, 110]], { g: 0.6 }),
    lapiz([[120, 110], [170, 124], [220, 132], [270, 124], [320, 110]], { recto: false, g: 0.8 }),

    // La lata de la izquierda: la boca, el cuerpo, el fondo.
    tinta([[44, 78], [52, 84], [55, 110], [52, 136], [44, 142], [36, 136], [33, 110], [36, 84], [44, 78]], { g: 2.4 }),
    tinta([[44, 78], [80, 79], [112, 80]], { g: 2.4 }),
    tinta([[44, 142], [80, 141], [112, 140]], { g: 2.4 }),
    tinta([[112, 80], [118, 92], [120, 110], [118, 128], [112, 140]], { g: 2 }),
    tinta([[62, 80], [64, 140]], { g: 0.9 }),
    tinta([[96, 80], [97, 139]], { g: 0.9 }),
    sombra([[38, 92], [50, 92], [50, 132], [38, 130]], 70, 3, { cobertura: 0.8, g: 0.8 }),
    sombra([[66, 124], [112, 124], [112, 140], [66, 141]], 30, 5, { cobertura: 0.55, g: 0.8 }),
    plano([[68, 80], [92, 80], [93, 140], [69, 141]], 'rojo', { aguada: true, encima: true, opacidad: 0.8 }),

    // La lata de la derecha, igual pero al revés.
    tinta([[396, 78], [404, 84], [407, 110], [404, 136], [396, 142], [388, 136], [385, 110], [388, 84], [396, 78]], { g: 2.4 }),
    tinta([[396, 78], [360, 79], [328, 80]], { g: 2.4 }),
    tinta([[396, 142], [360, 141], [328, 140]], { g: 2.4 }),
    tinta([[328, 80], [322, 92], [320, 110], [322, 128], [328, 140]], { g: 2 }),
    tinta([[378, 80], [376, 140]], { g: 0.9 }),
    tinta([[344, 80], [343, 139]], { g: 0.9 }),
    sombra([[390, 92], [402, 92], [402, 132], [390, 130]], 70, 3, { cobertura: 0.8, g: 0.8 }),
    sombra([[328, 124], [374, 124], [374, 140], [328, 141]], 30, 5, { cobertura: 0.55, g: 0.8 }),

    // Los nudos y los dos cabos que cuelgan, deshilachados.
    tinta([[120, 106], [126, 110], [120, 114]], { g: 1.6 }),
    tinta([[126, 110], [152, 120], [180, 134], [196, 146], [200, 160], [197, 174]], { g: 1.6 }),
    tinta([[197, 174], [192, 182]], { g: 0.9 }),
    tinta([[197, 174], [203, 183]], { g: 0.9 }),
    tinta([[320, 106], [314, 110], [320, 114]], { g: 1.6 }),
    tinta([[314, 110], [288, 122], [262, 136], [246, 148], [242, 160], [244, 170]], { g: 1.6 }),
    tinta([[244, 170], [238, 178]], { g: 0.9 }),
    tinta([[244, 170], [249, 179]], { g: 0.9 }),

    // Donde se rompió.
    rojo([[214, 126], [226, 138]], { g: 1.6, recto: true }),
    rojo([[226, 126], [214, 138]], { g: 1.6, recto: true }),

    nota(220, 64, 'sin línea', { tam: 22, giro: -4, tinta: 'rojo', ancla: 'middle' }),
    lapiz([[222, 72], [220, 116]], { g: 0.7, recto: false }),
  ],
};
