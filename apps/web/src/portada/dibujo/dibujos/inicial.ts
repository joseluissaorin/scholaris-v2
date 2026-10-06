/**
 * La inicial: una E lombarda a medio iluminar, la de «En algún disco duro». El
 * cuerpo de la letra va en minio, dado con un pincel que no llena del todo;
 * detrás, un cuadrado plano de oro desplazado, como una segunda pasada de
 * imprenta; alrededor, la filigrana de pluma en azul que baja por el margen.
 */
import { type Dibujo, type Punto, tinta, lapiz, azul, plano, nota, circulo, sombra } from '../boceto';

/** Contorno de la letra, escrito una vez y usado por la tinta y por el color. */
const exterior: Punto[] = circulo([150, 150], 112, 16, -52, -308);
const interior: Punto[] = circulo([166, 150], 68, 14, -300, -60);

export const inicial: Dibujo = {
  id: 'inicial-e',
  ancho: 300,
  alto: 420,
  duracion: 3,
  titulo: { es: 'Inicial E iluminada', en: 'Illuminated initial E' },
  descripcion: {
    es: 'Una E mayúscula de las que abrían los capítulos en los códices, pintada en rojo sobre un cuadrado de oro que se ha corrido un poco. Se ven las líneas de lápiz del encaje, la filigrana azul que cae por el margen y, en una esquina, la duda del dibujante: «¿más grande?».',
    en: 'A capital E of the kind that opened chapters in medieval codices, painted red over a square of gold that has slipped a little out of register. The pencil lines of the layout show through, blue pen-flourishing trails down the margin and, in a corner, the draughtsman\'s doubt: “bigger?”.',
  },
  elementos: [
    // Encaje: el cuadrado, las diagonales, el centro.
    lapiz([[22, 24], [282, 22], [284, 280], [20, 282]], { cerrado: true }),
    lapiz([[22, 24], [284, 280]], { g: 0.6 }),
    lapiz([[282, 22], [20, 282]], { g: 0.6 }),
    lapiz(circulo([150, 150], 112, 18), { recto: false, g: 0.7 }),
    lapiz([[40, 152], [262, 148]], { g: 0.6 }),

    // El oro, plano y corrido.
    plano([[38, 40], [276, 34], [272, 270], [42, 274]], 'oro', { opacidad: 0.9 }),
    // El cuerpo de la letra en minio, a pincel.
    plano([...exterior, ...interior], 'rojo', { aguada: true, opacidad: 0.92 }),
    // La lengua de la E.
    plano([[98, 140], [206, 136], [214, 150], [206, 164], [98, 162]], 'rojo', { aguada: true, opacidad: 0.92 }),

    // La pluma repasa los contornos, sin cerrar.
    tinta(exterior, { g: 2.6 }),
    tinta(interior.slice(0, 7), { g: 2.2 }),
    tinta(interior.slice(8), { g: 2.2 }),
    tinta([[98, 140], [160, 138], [206, 136], [218, 150], [206, 164], [150, 163], [98, 162]], { g: 2 }),
    // El filete que cierra la letra por la derecha: dos pasadas que no coinciden.
    tinta([[232, 56], [236, 150], [232, 244]], { g: 1.6, pasadas: 2 }),
    tinta([[222, 54], [244, 58]], { g: 2 }),
    tinta([[222, 246], [244, 242]], { g: 2 }),
    // Sombreado dentro del ojo superior, a medias.
    sombra([[120, 96], [210, 80], [214, 128], [116, 134]], 40, 6, { cobertura: 0.55, g: 0.8 }),

    // La filigrana azul: una vid que baja por el margen y se enrosca.
    azul([[30, 60], [14, 110], [20, 170], [12, 230], [22, 290], [16, 350], [30, 400]], { g: 1.4 }),
    azul([[20, 170], [4, 160], [0, 176], [10, 182]], { g: 1 }),
    azul([[14, 250], [36, 244], [40, 260], [28, 264]], { g: 1 }),
    azul([[18, 320], [2, 314], [-2, 330], [8, 336]], { g: 1 }),
    azul([[30, 400], [48, 412], [62, 400], [52, 390], [44, 398]], { g: 1.1 }),
    azul([[282, 30], [296, 12], [290, 2]], { g: 1 }),
    azul(circulo([150, 150], 128, 10, 200, 250), { g: 0.9 }),

    // Puntos de oro, como se ponían en las esquinas.
    plano(circulo([14, 30], 4, 6), 'oro', { encima: true }),
    plano(circulo([292, 290], 4, 6), 'oro', { encima: true }),

    nota(178, 312, ['¿más grande?', 'bigger?'], { tam: 20, giro: -6 }),
    lapiz([[236, 300], [262, 286]], { recto: false }),
    nota(56, 362, ['minio, dos manos', 'minium, two coats'], { tam: 15, tinta: 'rojo', giro: 3 }),
  ],
};
