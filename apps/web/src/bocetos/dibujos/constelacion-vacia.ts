/**
 * Explorar vacío: el mapa del cielo de la portada, a medio empezar. El compás
 * ya ha dado sus vueltas a lápiz y el limbo solo tiene unas marcas; hay cuatro
 * estrellas sueltas y unas líneas punteadas que todavía no se atreven a unirlas.
 * Detrás, tenue, el círculo azul de Kandinski.
 */
import { type Dibujo, tinta, lapiz, rojo, plano, disco, nota, circulo } from '../../dibujo/boceto';

export const constelacionVacia: Dibujo = {
  id: 'constelacion-vacia',
  ancho: 420,
  alto: 240,
  duracion: 2.2,
  titulo: 'Un mapa del cielo a medio empezar',
  descripcion:
    'Un diagrama astronómico apenas comenzado: arcos de compás a lápiz, un trozo de limbo graduado a pluma, cuatro estrellas sueltas y unas líneas punteadas a lápiz que no llegan a unirlas. Detrás, un círculo azul tenue. Al margen, a mano: «faltan estrellas».',
  elementos: [
    // El compás: el centro, el eje y las vueltas a lápiz.
    disco([262, 112], 66, 'azul', { aguada: true, opacidad: 0.22 }),
    lapiz([[60, 124], [352, 122]], { g: 0.6 }),
    lapiz(circulo([200, 124], 112, 18, 150, 395), { recto: false }),
    lapiz(circulo([200, 124], 72, 12, 190, 330), { recto: false, g: 0.7 }),
    rojo([[196, 120], [204, 128]], { g: 1.2, recto: true }),
    rojo([[204, 120], [196, 128]], { g: 1.2, recto: true }),

    // El limbo, apenas empezado: dos arcos y unas pocas marcas.
    tinta([[91.8, 95], [94.7, 85.7], [103, 68], [114.2, 52], [128, 38.2], [144, 27], [161.7, 18.7], [171, 15.8]], { g: 1.8, pasadas: 2 }),
    tinta([[87.2, 83], [96.1, 64], [108.1, 46.8], [122.8, 32.1], [140, 20.1], [149.3, 15.3]], { g: 1.4 }),
    tinta([[94.7, 85.7], [87.2, 83]], { g: 1.1, recto: true }),
    tinta([[103, 68], [90.9, 61]], { g: 1.8, recto: true }),
    tinta([[114.2, 52], [108.1, 46.8]], { g: 1.1, recto: true }),
    tinta([[128, 38.2], [122.8, 32.1]], { g: 1.1, recto: true }),
    tinta([[144, 27], [137, 14.9]], { g: 1.8, recto: true }),
    tinta([[161.7, 18.7], [159, 11.2]], { g: 1.1, recto: true }),

    // Las estrellas, sueltas.
    tinta([[141, 101], [159, 99]], { g: 1.8, recto: true }),
    tinta([[151, 91], [149, 109]], { g: 1.8, recto: true }),
    tinta([[223, 75], [249, 73]], { g: 2, recto: true, pasadas: 2 }),
    tinta([[237, 61], [235, 87]], { g: 2, recto: true }),
    tinta([[229, 67], [243, 81]], { g: 1.1, recto: true }),
    tinta([[243, 67], [229, 81]], { g: 1.1, recto: true }),
    tinta([[266, 151], [286, 149]], { g: 1.8, recto: true }),
    tinta([[277, 140], [275, 160]], { g: 1.8, recto: true }),
    tinta([[175, 177], [189, 175]], { g: 1.6, recto: true }),
    tinta([[183, 169], [181, 183]], { g: 1.6, recto: true }),
    plano([[147, 97], [153, 97], [153, 103], [147, 103]], 'oro', { encima: true }),
    plano([[232, 70], [240, 70], [240, 78], [232, 78]], 'oro', { encima: true }),
    plano([[273, 147], [279, 147], [279, 153], [273, 153]], 'oro', { encima: true }),

    // Las relaciones, a lápiz y a trozos: ninguna llega.
    lapiz([[163.4, 95.9], [182.6, 90.1]], { g: 1.1 }),
    lapiz([[194.1, 86.7], [209.4, 82]], { g: 1.1 }),
    lapiz([[242.5, 86.4], [250.9, 102.3]], { g: 1.1 }),
    lapiz([[256.5, 112.9], [263, 125.3]], { g: 1.1 }),
    lapiz([[155.4, 112.9], [161.6, 127.6]], { g: 1.1 }),
    lapiz([[166.3, 138.7], [171, 149.7]], { g: 1.1 }),

    nota(330, 44, 'faltan\nestrellas', { tam: 20, giro: -5 }),
    nota(292, 184, '¿con cuál?', { tam: 14, giro: -6, tinta: 'rojo' }),
  ],
};
