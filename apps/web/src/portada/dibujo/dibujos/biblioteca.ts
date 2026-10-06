/**
 * La biblioteca que no se acaba: dos estanterías que huyen hacia un punto de
 * fuga, encajadas a lápiz con regla, como se aprende a dibujar la perspectiva.
 * Al fondo, donde tendría que estar el libro, el cuadrado negro de Malévich.
 * Un lector diminuto, con su libro, para dar la escala.
 *
 * Las posiciones de los lomos están escritas a mano (la profundidad de cada
 * uno); la perspectiva solo las lleva a su sitio, como haría la regla.
 */
import { type Dibujo, type Elemento, type Punto, tinta, lapiz, rojo, plano, nota, sombra } from '../boceto';

const FUGA: Punto = [600, 214];
const IZQ = 70, DER = 1130; // aristas delanteras de las dos paredes
const BALDAS = [34, 104, 172, 240, 308, 376, 432]; // alturas de las baldas en primer término

/** Un punto de la pared a profundidad z (1 = delante; cuanto más grande, más lejos). */
const pared = (x0: number, y0: number, z: number): Punto => [FUGA[0] + (x0 - FUGA[0]) / z, FUGA[1] + (y0 - FUGA[1]) / z];

/** Profundidad de cada lomo, por balda, escrita a mano: aquí juntos, allí un hueco, allá uno caído. */
const LOMOS_IZQ: number[][] = [
  [1.03, 1.07, 1.1, 1.16, 1.19, 1.22, 1.3, 1.34, 1.37, 1.48, 1.52, 1.6, 1.66, 1.71, 1.9, 1.96, 2.1, 2.3, 2.38, 2.6, 2.9, 3.2],
  [1.02, 1.05, 1.12, 1.15, 1.25, 1.28, 1.31, 1.42, 1.45, 1.55, 1.62, 1.65, 1.8, 1.86, 2, 2.08, 2.24, 2.5, 2.7, 3, 3.4],
  [1.04, 1.08, 1.11, 1.2, 1.23, 1.36, 1.4, 1.44, 1.58, 1.7, 1.74, 1.92, 2.04, 2.2, 2.4, 2.66, 3.1],
  [1.02, 1.09, 1.13, 1.17, 1.27, 1.33, 1.5, 1.54, 1.64, 1.78, 1.84, 2.02, 2.16, 2.44, 2.8],
  [1.05, 1.1, 1.14, 1.24, 1.29, 1.39, 1.46, 1.57, 1.68, 1.82, 1.98, 2.12, 2.34, 2.56],
  [1.03, 1.06, 1.18, 1.21, 1.32, 1.43, 1.53, 1.61, 1.76, 1.94, 2.26],
];
// La pared derecha se queda a medio hacer: menos lomos, y luego solo lápiz.
const LOMOS_DER: number[][] = [
  [1.04, 1.08, 1.12, 1.2, 1.24, 1.35, 1.4, 1.5],
  [1.02, 1.06, 1.14, 1.18, 1.3, 1.34, 1.46],
  [1.05, 1.09, 1.16, 1.26, 1.3, 1.42],
  [1.03, 1.1, 1.13, 1.22, 1.33],
  [1.06, 1.11, 1.2, 1.28],
  [1.04, 1.12, 1.17],
];

function lomos(x0: number, filas: number[][], hastaZ: number): Elemento[] {
  const fuera: Elemento[] = [];
  filas.forEach((fila, b) => {
    const arriba = BALDAS[b]!, abajo = BALDAS[b + 1]!;
    fila.forEach((z, i) => {
      if (z > hastaZ) return;
      const alto = 0.62 + ((i * 37 + b * 11) % 9) / 26; // no todos los libros miden lo mismo
      const pie = pared(x0, abajo - 2, z);
      const cabeza = pared(x0, abajo - (abajo - arriba) * alto, z);
      const g = z < 1.4 ? 1.7 : z < 2 ? 1.2 : 0.8;
      // Cada cinco o seis, un libro tumbado sobre el de al lado.
      if ((i * 7 + b * 3) % 11 === 5 && z < 2.2) {
        const lado = pared(x0, abajo - (abajo - arriba) * alto * 0.7, z + 0.03);
        fuera.push(tinta([pie, lado], { g, recto: true, temblor: 0.4 }));
        return;
      }
      fuera.push(tinta([cabeza, pie], { g, recto: true, temblor: 0.4 }));
      // Los de delante tienen grosor: el segundo canto del lomo y una banda en la cabeza.
      if (z < 1.45) {
        const z2 = z + 0.022;
        fuera.push(tinta([pared(x0, abajo - (abajo - arriba) * alto, z2), pared(x0, abajo - 2, z2)], { g: g * 0.6, recto: true, temblor: 0.4 }));
        if ((i + b) % 3 === 0) fuera.push(tinta([pared(x0, abajo - (abajo - arriba) * alto * 0.8, z), pared(x0, abajo - (abajo - arriba) * alto * 0.8, z2)], { g: 0.8, recto: true }));
      }
    });
  });
  return fuera;
}

const balda = (x0: number, y: number, z1: number, o: { lapiz?: boolean; g?: number } = {}): Elemento =>
  o.lapiz ? lapiz([pared(x0, y, 1), pared(x0, y, z1)]) : tinta([pared(x0, y, 1), pared(x0, y, z1)], { recto: true, g: o.g ?? 1.8, temblor: 0.5 });

export const biblioteca: Dibujo = {
  id: 'biblioteca',
  ancho: 1200,
  alto: 470,
  duracion: 4.4,
  titulo: { es: 'Una biblioteca sin fin', en: 'A library without end' },
  descripcion: {
    es: 'Dos estanterías llenas de libros que se alejan en perspectiva hasta un punto de fuga. Las líneas de lápiz con que se construyó la perspectiva siguen a la vista; la pared de la derecha está a medio dibujar. Al fondo, donde debería estar el libro que se busca, hay un cuadrado negro. Un lector diminuto, de pie en el pasillo, sostiene un libro abierto.',
    en: 'Two bookcases full of books recede in perspective towards a single vanishing point. The pencil lines used to construct the perspective are still there, and the right-hand wall is only half drawn. At the far end, where the book you are looking for should be, there is a black square. A tiny reader stands in the aisle holding an open book.',
  },
  elementos: [
    // La construcción: horizonte, punto de fuga y las líneas que van a él.
    lapiz([[0, FUGA[1]], [1200, FUGA[1] + 3]], { g: 0.7 }),
    lapiz([[FUGA[0] - 10, FUGA[1] - 10], [FUGA[0] + 10, FUGA[1] + 10]]),
    lapiz([[FUGA[0] + 10, FUGA[1] - 10], [FUGA[0] - 10, FUGA[1] + 10]]),
    ...BALDAS.flatMap((y) => [lapiz([[IZQ, y], FUGA], { g: 0.6 }), lapiz([[DER, y], FUGA], { g: 0.6 })]),
    lapiz([[0, 470], FUGA], { g: 0.6 }),
    lapiz([[1200, 470], FUGA], { g: 0.6 }),
    nota(FUGA[0] - 6, FUGA[1] + 96, ['F', 'VP'], { tam: 16 }),
    lapiz([[FUGA[0], FUGA[1] + 80], [FUGA[0], FUGA[1] + 12]], { g: 0.6 }),

    // El fondo de la galería: el cuadrado negro.
    plano([[536, 146], [668, 150], [664, 282], [532, 278]], 'negro'),

    // Las aristas delanteras, con regla y dos pasadas.
    tinta([[IZQ, 0], [IZQ + 2, 470]], { recto: true, g: 2.6, pasadas: 2 }),
    tinta([[DER, 0], [DER - 2, 470]], { recto: true, g: 2.6 }),
    // Las baldas de la izquierda, en tinta hasta lejos; las de la derecha, a medias.
    ...BALDAS.map((y) => balda(IZQ, y, 3.5, { g: y === 432 ? 2.4 : 1.8 })),
    ...BALDAS.map((y) => lapiz([pared(IZQ, y, 3.5), pared(IZQ, y, 7)], { g: 0.8 })),
    ...BALDAS.map((y, i) => balda(DER, y, i % 2 ? 1.6 : 2.2, { g: 1.6 })),
    ...lomos(IZQ, LOMOS_IZQ, 3.5),
    ...lomos(DER, LOMOS_DER, 2),

    // Sombra bajo las baldas de la izquierda, empezada y dejada.
    sombra([pared(IZQ, 104, 1), pared(IZQ, 104, 1.6), pared(IZQ, 120, 1.6), pared(IZQ, 120, 1)], 80, 5, { cobertura: 0.7, g: 0.7 }),
    sombra([pared(IZQ, 308, 1), pared(IZQ, 308, 1.3), pared(IZQ, 326, 1.3), pared(IZQ, 326, 1)], 80, 5, { cobertura: 0.5, g: 0.7 }),

    // El suelo: baldosas hexagonales a lápiz que se pierden.
    lapiz([[330, 470], [380, 430], [460, 430], [510, 470]], { g: 0.7 }),
    lapiz([[460, 430], [500, 398], [560, 398], [592, 420]], { g: 0.7 }),
    lapiz([[690, 470], [732, 436], [800, 436], [838, 470]], { g: 0.7 }),

    // El lector, diminuto, con su libro abierto.
    tinta([[566, 330], [562, 344], [568, 352], [576, 346], [574, 332], [566, 330]], { g: 1.4 }),
    tinta([[570, 352], [571, 398]], { g: 1.8 }),
    tinta([[571, 398], [562, 432]], { g: 1.6 }),
    tinta([[571, 398], [582, 430]], { g: 1.6 }),
    tinta([[570, 364], [586, 372], [596, 366]], { g: 1.3 }),
    tinta([[590, 360], [598, 368], [608, 362], [600, 356], [590, 360]], { g: 1.2 }),

    // Un libro rojo que alguien dejó medio sacado.
    plano([[166, 238], [182, 236], [178, 180], [160, 184]], 'rojo', { aguada: true, encima: true }),
    tinta([[160, 184], [178, 180], [182, 236]], { g: 1.4 }),

    nota(690, 132, ['aquí, al fondo,\nla página que buscabas', 'there, at the far end,\nthe page you were after'], { tam: 19, giro: -3 }),
    lapiz([[688, 142], [662, 160]], { recto: false }),
    nota(900, 452, ['(sin terminar)', '(unfinished)'], { tam: 15, giro: -2 }),
  ],
};
