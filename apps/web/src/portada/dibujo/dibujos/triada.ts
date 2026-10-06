/**
 * El cuestionario de Kandinski en la Bauhaus (1923) pedía emparejar tres formas
 * con tres colores, y la respuesta canónica fue: triángulo amarillo, cuadrado
 * rojo, círculo azul. Aquí las tres formas planas son las tres cosas que
 * Scholaris deja en tus manos, y el boceto las mide, las encaja y las anota.
 */
import { type Dibujo, tinta, lapiz, plano, disco, nota, circulo, rojo } from '../boceto';

export const triada: Dibujo = {
  id: 'triada',
  ancho: 900,
  alto: 340,
  duracion: 3,
  titulo: { es: 'Triángulo amarillo, cuadrado rojo, círculo azul', en: 'Yellow triangle, red square, blue circle' },
  descripcion: {
    es: 'Las tres formas de la Bauhaus, planas y de color: un triángulo amarillo, un cuadrado rojo y un círculo azul. Encima, las líneas de lápiz con que se construyeron (la altura del triángulo, las diagonales del cuadrado, el compás del círculo) y debajo de cada una, escrito a mano: pensar, juzgar, escribir. En una esquina, a lápiz: «cuestionario de la Bauhaus, 1923».',
    en: 'The three shapes of the Bauhaus, flat and in colour: a yellow triangle, a red square and a blue circle. Over them, the pencil lines that built them (the triangle\'s height, the square\'s diagonals, the compass of the circle) and, under each, handwritten: think, judge, write. In a corner, in pencil: “Bauhaus questionnaire, 1923”.',
  },
  elementos: [
    // El triángulo: encaje, color, la pluma que no lo cierra.
    lapiz([[40, 250], [250, 250]]),
    lapiz([[145, 30], [145, 262]], { g: 0.7 }),
    lapiz(circulo([145, 250], 105, 8, 180, 240), { recto: false, g: 0.6 }),
    plano([[44, 248], [246, 252], [146, 66]], 'amarillo'),
    tinta([[146, 60], [40, 252], [190, 254]], { g: 2.2, recto: true }),
    tinta([[150, 64], [252, 248]], { g: 1.4, recto: true, pasadas: 2 }),

    // El cuadrado: diagonales, un lado repasado, el rojo que se sale.
    lapiz([[340, 56], [540, 56], [540, 256], [340, 256]], { cerrado: true }),
    lapiz([[340, 56], [540, 256]], { g: 0.6 }),
    lapiz([[540, 56], [340, 256]], { g: 0.6 }),
    plano([[350, 66], [546, 60], [540, 254], [348, 250]], 'rojo'),
    tinta([[336, 52], [544, 54], [542, 262]], { g: 2.2, recto: true }),
    tinta([[338, 60], [340, 260], [500, 258]], { g: 1.4, recto: true }),

    // El círculo: el compás, el centro pinchado, la pluma que da vuelta y media.
    lapiz([[640, 156], [860, 156]], { g: 0.6 }),
    lapiz([[750, 40], [750, 270]], { g: 0.6 }),
    disco([750, 156], 100, 'azul'),
    tinta(circulo([750, 156], 104, 22, -30, 300), { g: 2, recto: false }),
    tinta(circulo([752, 154], 110, 10, 300, 420), { g: 1, recto: false }),
    rojo([[745, 151], [755, 161]], { g: 1.4, recto: true }),
    rojo([[755, 151], [745, 161]], { g: 1.4, recto: true }),

    nota(145, 300, ['pensar', 'think'], { tam: 28, ancla: 'middle', tinta: 'tinta' }),
    nota(440, 300, ['juzgar', 'judge'], { tam: 28, ancla: 'middle', tinta: 'tinta' }),
    nota(750, 300, ['escribir', 'write'], { tam: 28, ancla: 'middle', tinta: 'tinta' }),
    nota(560, 330, ['cuestionario de la Bauhaus, 1923', 'Bauhaus questionnaire, 1923'], { tam: 15, giro: -1 }),
    nota(214, 140, ['tuyo', 'yours'], { tam: 16, tinta: 'rojo', giro: -10 }),
    nota(556, 82, ['tuyo', 'yours'], { tam: 16, tinta: 'rojo', giro: 8 }),
    nota(862, 70, ['tuyo', 'yours'], { tam: 16, tinta: 'rojo', giro: -6, ancla: 'end' }),
  ],
};
