/**
 * La página de las claves de API: una llave antigua de paletón dentado, con su
 * aro, y una etiqueta de cartón atada con un hilo rojo donde alguien ha escrito
 * «API». Las llaves buenas no se dejan en la puerta.
 */
import { type Dibujo, tinta, lapiz, rojo, plano, sombra, nota, circulo } from '../../dibujo/boceto';

export const llave: Dibujo = {
  id: 'llave',
  ancho: 340,
  alto: 180,
  duracion: 1.9,
  titulo: 'Una llave antigua con una etiqueta',
  descripcion:
    'Una llave antigua dibujada a pluma, con un aro redondo y un paletón dentado; de ella cuelga, atada con un hilo rojo, una etiqueta de cartón en la que pone «API». Arriba, a lápiz: «guárdala bien».',
  elementos: [
    // Encaje: el eje de la caña y el compás del aro.
    lapiz([[14, 90], [320, 89]]),
    lapiz(circulo([66, 88], 38, 12), { recto: false, g: 0.6 }),
    lapiz([[236, 140], [272, 140]], { g: 0.6 }),

    // El aro, de dos vueltas, la de dentro sin cerrar.
    tinta([[66, 52], [90, 60], [101, 84], [94, 110], [68, 122], [42, 113], [31, 89], [40, 64], [62, 53]], { g: 2.8 }),
    tinta([[66, 70], [80, 75], [85, 90], [78, 103], [64, 106], [52, 98], [48, 85], [55, 74]], { g: 1.8 }),
    sombra([[48, 96], [70, 122], [92, 110], [100, 92], [86, 96], [74, 106], [58, 104]], 50, 4, { cobertura: 0.6, g: 0.8 }),

    // El collarín y la caña.
    tinta([[100, 80], [104, 80], [105, 100], [100, 100]], { g: 1.8 }),
    tinta([[112, 78], [118, 78], [119, 102], [112, 102]], { g: 2 }),
    tinta([[118, 84], [190, 83], [268, 84]], { g: 2.6 }),
    tinta([[118, 96], [190, 96], [236, 96]], { g: 2.2 }),
    tinta([[268, 84], [276, 86], [279, 90], [276, 95], [268, 96]], { g: 2 }),
    sombra([[120, 91], [266, 91], [266, 96], [120, 96]], 0, 2.5, { cobertura: 0.6, g: 0.7 }),

    // El paletón, con sus dientes; el primero salió corto y se alargó.
    tinta([[236, 96], [236, 138], [246, 139], [246, 128], [254, 128], [255, 140], [266, 141], [268, 96]], { g: 2.4, recto: true }),
    tinta([[246, 128], [246, 132]], { g: 0.9 }),
    sombra([[238, 100], [266, 100], [266, 138], [256, 138], [254, 126], [238, 126]], 60, 4, { cobertura: 0.55, g: 0.8 }),

    // La etiqueta de cartón, con su ojal.
    plano([[118, 142], [130, 122], [204, 114], [210, 160], [132, 168]], 'oro', { aguada: true, opacidad: 0.45 }),
    tinta([[118, 142], [130, 122], [204, 114], [210, 160], [132, 168], [119, 144]], { g: 1.8, recto: true }),
    tinta(circulo([134, 143], 5, 8), { g: 1.2, recto: false }),
    // El hilo, del aro al ojal, con su nudo.
    rojo([[82, 118], [88, 136], [104, 150], [122, 148], [134, 142], [140, 132], [130, 130], [134, 142]], { g: 1.4 }),
    rojo([[134, 146], [128, 160], [120, 166]], { g: 1.1 }),

    nota(172, 150, 'API', { tam: 24, giro: -5, tinta: 'tinta', ancla: 'middle' }),
    nota(176, 44, 'guárdala bien', { tam: 19, giro: -4, tinta: 'lapiz' }),
  ],
};
