/**
 * La drôlerie: el caracol de los márgenes góticos, que allí se batía con
 * caballeros y aquí lleva un libro abierto a cuestas, con su cinta roja. Va
 * despacio, que es como se lee.
 */
import { type Dibujo, type Punto, tinta, lapiz, rojo, plano, nota, sombra } from '../boceto';

/** La espiral de la concha, trazada de fuera adentro como se dibuja a pulso. */
const espiral: Punto[] = Array.from({ length: 30 }, (_, i) => {
  const a = (i / 29) * Math.PI * 4.2;
  const r = 58 * Math.pow(0.72, a / Math.PI) ;
  return [150 + Math.cos(a + 3.3) * r, 104 + Math.sin(a + 3.3) * r * 0.92] as Punto;
});

export const caracol: Dibujo = {
  id: 'caracol',
  ancho: 380,
  alto: 220,
  duracion: 2.6,
  titulo: { es: 'Un caracol con un libro a cuestas', en: 'A snail carrying a book' },
  descripcion: {
    es: 'Un caracol dibujado a pluma, como los de los márgenes de los códices, avanza hacia la derecha con un libro abierto sobre la concha; del libro cuelga una cinta roja. Al lado, escrito a mano: «despacio, que es como se lee».',
    en: 'A snail drawn in pen, like those in the margins of medieval manuscripts, crawls to the right with an open book on its shell; a red ribbon hangs from the book. Beside it, handwritten: “slowly, which is how one reads”.',
  },
  elementos: [
    lapiz([[10, 172], [370, 170]], { g: 0.7 }),
    // El cuerpo: la base que se arrastra, la cabeza, los cuernos.
    tinta([[40, 170], [120, 166], [220, 164], [278, 160], [300, 140], [296, 118], [282, 112], [270, 124], [262, 146]], { g: 2.4 }),
    tinta([[46, 170], [30, 172], [20, 176]], { g: 1.4 }),
    tinta([[290, 116], [300, 86], [306, 72]], { g: 1.6 }),
    tinta([[282, 114], [280, 88], [276, 76]], { g: 1.3 }),
    plano([[303, 68], [309, 69], [308, 75], [302, 74]], 'negro'),
    tinta([[290, 132], [296, 130]], { g: 1.6 }),
    // La concha, de fuera adentro.
    tinta(espiral, { g: 2.2 }),
    tinta([[92, 104], [94, 140], [108, 162]], { g: 1.8 }),
    sombra([[96, 120], [140, 150], [200, 156], [210, 164], [104, 164]], 70, 5, { cobertura: 0.7, g: 0.8 }),
    // El libro abierto encima.
    tinta([[96, 44], [140, 36], [152, 46], [164, 36], [208, 44]], { g: 2 }),
    tinta([[96, 44], [100, 58], [150, 54], [154, 60], [158, 54], [206, 58], [208, 44]], { g: 1.6 }),
    tinta([[152, 46], [154, 60]], { g: 1.2 }),
    tinta([[108, 46], [140, 42]], { g: 0.7 }),
    tinta([[166, 42], [196, 46]], { g: 0.7 }),
    rojo([[154, 60], [156, 82], [150, 96], [158, 104]], { g: 2 }),
    nota(228, 32, ['despacio,\nque es\ncomo se lee', 'slowly,\nwhich is\nhow one reads'], { tam: 18, giro: -4 }),
  ],
};
