/**
 * La primera vez, en tres viñetas de cuaderno: una hoja que cae sobre la mesa
 * (suelta), una página abierta con su folio rodeado en minio (lee) y la
 * manícula de la portada, en pequeño, señalando un renglón subrayado (cita).
 * Entre viñeta y viñeta, una flecha a lápiz.
 */
import { type Dibujo, tinta, lapiz, rojo, nota, sombra } from '../../dibujo/boceto';

export const primerosPasos: Dibujo = {
  id: 'primeros-pasos',
  ancho: 640,
  alto: 200,
  duracion: 2.4,
  titulo: 'Suelta, lee, cita',
  descripcion: 'Tres viñetas dibujadas a pluma y unidas por flechas de lápiz. En la primera, una hoja cae sobre una mesa, con rayas de movimiento. En la segunda, una página abierta con el folio «p. 145» rodeado en rojo. En la tercera, una manita con el índice extendido señala un renglón subrayado en rojo. Debajo de cada una, a mano: «suelta», «lee», «cita».',
  elementos: [
    // 1. Suelta: la mesa, el sitio donde caerá, la hoja en el aire.
    lapiz([[20, 140], [190, 138]], { g: 0.8 }),
    lapiz([[52, 26], [110, 14], [118, 52]], { g: 0.6, recto: false }),
    tinta([[14, 141], [102, 139], [194, 140]], { g: 2, recto: true }),
    tinta([[60, 48], [122, 36], [136, 94], [104, 102], [74, 108]], { g: 2, recto: true, pasadas: 2 }),
    tinta([[74, 108], [62, 50]], { g: 1.6, recto: true }),
    tinta([[104, 102], [116, 94], [136, 94]], { g: 1.2, recto: true }),
    tinta([[72, 62], [116, 53]], { g: 0.8, recto: true }),
    tinta([[75, 74], [120, 65]], { g: 0.8, recto: true }),
    tinta([[78, 86], [108, 80]], { g: 0.8, recto: true }),
    tinta([[54, 34], [48, 18]], { g: 1.1 }),
    tinta([[84, 26], [80, 8]], { g: 1.1 }),
    tinta([[116, 22], [114, 10]], { g: 1.2 }),
    sombra([[60, 132], [150, 130], [160, 138], [52, 139]], 70, 5, { cobertura: 0.6, g: 0.8 }),

    lapiz([[200, 88], [238, 86]], { g: 1.2 }),
    lapiz([[230, 80], [239, 86], [230, 92]], { g: 1.2 }),

    // 2. Lee: la página abierta, sus renglones, el folio en minio.
    lapiz([[248, 132], [394, 132]], { g: 0.6 }),
    tinta([[252, 52], [286, 42], [320, 50], [354, 42], [388, 52]], { g: 2 }),
    tinta([[252, 52], [254, 130], [288, 122], [320, 130], [354, 122], [386, 130], [388, 52]], { g: 2 }),
    tinta([[320, 50], [320, 130]], { g: 1.4, pasadas: 2 }),
    tinta([[262, 66], [308, 64]], { g: 0.8, recto: true }),
    tinta([[262, 80], [310, 79]], { g: 0.8, recto: true }),
    tinta([[262, 94], [304, 93]], { g: 0.8, recto: true }),
    tinta([[262, 108], [298, 106]], { g: 0.8, recto: true }),
    tinta([[332, 90], [378, 92]], { g: 0.8, recto: true }),
    tinta([[332, 104], [376, 106]], { g: 0.8, recto: true }),
    nota(355, 76, 'p. 145', { tam: 13, tinta: 'tinta', ancla: 'middle' }),
    rojo([[342, 62], [333, 68], [336, 80], [356, 84], [376, 78], [378, 66], [362, 61], [344, 64]], { g: 1.6 }),

    lapiz([[408, 88], [446, 86]], { g: 1.2 }),
    lapiz([[438, 80], [447, 86], [438, 92]], { g: 1.2 }),

    // 3. Cita: la manícula de la portada, en pequeño, y el renglón subrayado.
    lapiz([[554, 46], [636, 46], [636, 132], [556, 132]], { g: 0.6 }),
    tinta([[562, 62], [628, 61]], { g: 0.8, recto: true }),
    tinta([[562, 76], [624, 76]], { g: 0.8, recto: true }),
    tinta([[562, 91], [630, 90]], { g: 1.1, recto: true }),
    tinta([[562, 106], [620, 106]], { g: 0.8, recto: true }),
    tinta([[562, 120], [600, 119]], { g: 0.8, recto: true }),
    rojo([[560, 96], [596, 95.5], [631, 96.5]], { g: 1.6 }),
    tinta([[438, 84.2], [450.4, 83.2], [462.4, 81.6], [469.1, 81.1]], { g: 1.6 }),
    tinta([[438, 118], [451.4, 119], [463.9, 120.1], [469.6, 120.6]], { g: 1.6 }),
    tinta([[469.1, 79], [472.2, 84.2], [469.9, 89.4], [473, 94.6], [470.2, 99.8], [473.3, 105], [470.4, 110.7], [473.5, 116.4], [470.7, 122.2]], { g: 1.3 }),
    tinta([[473.8, 83.7], [481.6, 81.1], [491, 81.6], [498.2, 84.7], [504, 86.8], [518, 86.8], [533.6, 87.1], [545, 87.3]], { g: 1.8 }),
    tinta([[545, 87.3], [550.2, 88.4], [552.8, 91.7], [550.8, 95.1], [545, 96.4], [531, 96.4], [517, 96.2], [508.1, 95.9]], { g: 1.7 }),
    tinta([[501.4, 96.7], [513.3, 97.2], [522.7, 98.2], [526.8, 100.3], [524.8, 102.9], [518, 103.4], [506.6, 102.9]], { g: 1.5 }),
    tinta([[505, 103.4], [510.7, 105], [512.3, 108.1], [509.2, 110.2], [501.9, 110.2]], { g: 1.5 }),
    tinta([[503.4, 110.7], [508.1, 112.3], [509.2, 115.4], [506, 117], [499.8, 117]], { g: 1.5 }),
    tinta([[500.8, 117.5], [504.5, 119], [504.5, 121.6], [501.4, 122.7], [495.6, 121.6], [484.2, 121.6], [474.3, 119]], { g: 1.5 }),
    sombra([[440, 90.4], [467, 88.4], [468.1, 117], [440, 116]], 62, 3.5, { cobertura: 0.6, g: 0.6 }),

    nota(105, 182, 'suelta', { tam: 22, tinta: 'tinta', ancla: 'middle', giro: -2 }),
    nota(320, 182, 'lee', { tam: 22, tinta: 'tinta', ancla: 'middle', giro: 1 }),
    nota(535, 182, 'cita', { tam: 22, tinta: 'tinta', ancla: 'middle', giro: -3 }),
    nota(596, 192, 'y ya', { tam: 13, tinta: 'rojo', giro: -8 }),
  ],
};
