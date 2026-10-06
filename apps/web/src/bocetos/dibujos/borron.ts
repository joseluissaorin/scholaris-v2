/**
 * Algo se ha torcido: la plumilla se abrió de golpe, soltó un borrón y
 * salpicó la hoja. El renglón de arriba ya estaba tachado. Nada que no se
 * arregle mojando otra vez la pluma.
 */
import { type Dibujo, tinta, lapiz, plano, disco, sombra, nota, circulo } from '../../dibujo/boceto';

export const borron: Dibujo = {
  id: 'borron',
  ancho: 340,
  alto: 220,
  duracion: 2,
  titulo: 'Una plumilla rota y un borrón',
  descripcion:
    'Una plumilla con la punta abierta acaba de soltar un borrón de tinta, con salpicaduras alrededor; arriba, un renglón escrito y tachado. En la esquina, en rojo: «vuelve a intentarlo».',
  elementos: [
    // Encaje: la pauta del renglón y el eje de la plumilla.
    lapiz([[14, 58], [200, 56]], { g: 0.6 }),
    lapiz([[14, 90], [140, 89]], { g: 0.6 }),
    lapiz([[310, 14], [176, 136]], { g: 0.6 }),

    // El renglón, escrito y tachado dos veces.
    tinta([[22, 54], [30, 46], [36, 56], [44, 48], [54, 54], [64, 46], [72, 56], [84, 50], [96, 54], [104, 46], [116, 56], [128, 50], [140, 54], [152, 48], [164, 54]], { g: 1.4 }),
    tinta([[16, 54], [96, 50], [178, 46]], { g: 2.4, recto: true, pasadas: 2 }),
    tinta([[22, 86], [30, 80], [38, 88], [48, 82], [58, 86], [68, 80], [78, 88], [92, 84], [104, 86]], { g: 1.4 }),

    // El mango y la virola, que salen por la esquina.
    tinta([[257, 34], [290, 4]], { g: 2.2 }),
    tinta([[287, 66], [320, 36]], { g: 2.2 }),
    tinta([[263, 28], [294, 58]], { g: 1.6 }),
    // La plumilla: los dos hombros que se estrechan, el ojo, la raja y las puntas abiertas.
    tinta([[257, 34], [237, 55], [219, 80], [204, 102], [184, 120]], { g: 2.4 }),
    tinta([[287, 66], [263, 85], [237, 100], [214, 112], [194, 134]], { g: 2.4 }),
    tinta(circulo([237, 81], 4, 8), { g: 1.2, recto: false }),
    tinta([[234, 85], [209, 107], [186, 121]], { g: 1.2 }),
    tinta([[209, 107], [193, 132]], { g: 1.2 }),
    // Arrepentimiento: la punta quedó primero cerrada.
    tinta([[206, 112], [190, 127]], { g: 0.8, temblor: 1.2 }),
    sombra([[237, 55], [263, 85], [237, 100], [219, 80]], 40, 4, { cobertura: 0.55, g: 0.7 }),

    // El borrón: contorno a pluma, dos sombreados que se cruzan.
    tinta([[98, 130], [114, 138], [130, 132], [140, 140], [146, 152], [164, 154], [152, 166], [150, 180], [138, 184], [130, 198], [116, 186], [100, 190], [92, 180], [72, 176], [86, 162], [78, 148], [98, 130]], { g: 2.2, pasadas: 2 }),
    sombra([[96, 134], [126, 130], [146, 140], [156, 158], [150, 182], [128, 192], [96, 190], [80, 170], [84, 146]], 35, 2.4, { cobertura: 0.95, g: 1 }),
    sombra([[100, 140], [140, 140], [150, 170], [126, 188], [92, 184], [86, 160]], -40, 3, { cobertura: 0.7, g: 0.9 }),
    plano([[106, 150], [128, 146], [134, 166], [114, 172]], 'rojo', { aguada: true, encima: true, opacidad: 0.6 }),
    // La gota que cayó de la punta y las salpicaduras.
    tinta([[186, 124], [174, 136], [162, 150]], { g: 1.8 }),
    disco([172, 120], 3, 'tinta'),
    disco([62, 150], 2.6, 'tinta'),
    disco([166, 196], 3.2, 'tinta'),
    disco([70, 200], 2, 'tinta'),
    disco([150, 116], 1.8, 'tinta'),

    nota(330, 206, 'vuelve a intentarlo', { tam: 19, giro: -4, tinta: 'rojo', ancla: 'end' }),
  ],
};
