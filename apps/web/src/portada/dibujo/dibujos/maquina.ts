/**
 * Las máquinas que contestan. A la izquierda, la lista de diez enlaces del
 * buscador; a la derecha, el bocadillo del asistente, lleno de renglones
 * seguros de sí mismos y con una cita inventada que alguien ha tachado en rojo.
 * Debajo, una pila de libros que se ha quedado plana.
 */
import { type Dibujo, type Elemento, tinta, lapiz, azul, rojo, plano, nota, sombra } from '../boceto';

/** Un renglón de garabato: la letra que no se lee, escrita deprisa. */
const renglon = (x: number, y: number, largo: number, g = 1.3): Elemento =>
  tinta([[x, y], [x + largo * 0.3, y - 2], [x + largo * 0.6, y + 1], [x + largo, y - 1]], { g, temblor: 1.4 });

export const maquina: Dibujo = {
  id: 'maquina',
  ancho: 760,
  alto: 380,
  duracion: 3.4,
  titulo: { es: 'Un buscador y un asistente que contesta', en: 'A search engine and an assistant that answers' },
  descripcion: {
    es: 'A la izquierda, diez renglones azules subrayados, como los enlaces de un buscador. A la derecha, un bocadillo de cómic lleno de renglones seguros de sí mismos; dentro, una cita con autor, año y página está tachada en rojo, y una nota al margen dice: «no existe». Debajo, una pila de libros dibujada como un rectángulo plano, aplastada.',
    en: 'On the left, ten blue underlined lines, like the links of a search engine. On the right, a comic-strip speech bubble full of self-assured lines of writing; inside it, a citation with author, year and page has been struck out in red, and a marginal note says “does not exist”. Below, a pile of books drawn as a flat black rectangle, squashed.',
  },
  elementos: [
    // Encaje.
    lapiz([[20, 30], [220, 28], [222, 300], [18, 302]], { cerrado: true, g: 0.7 }),
    lapiz([[300, 20], [740, 24], [736, 250], [302, 246]], { cerrado: true, g: 0.7 }),

    // Diez enlaces azules: cada uno subrayado, cada vez con menos ganas.
    ...Array.from({ length: 10 }, (_, i): Elemento[] => {
      const y = 50 + i * 25;
      const largo = 150 - ((i * 37) % 60);
      return [
        azul([[34, y], [34 + largo * 0.5, y - 1.5], [34 + largo, y]], { g: 1.4, temblor: 1.2 }),
        azul([[34, y + 6], [34 + largo * (1 - i * 0.07), y + 6]], { g: 0.7, recto: true }),
      ];
    }).flat(),
    nota(30, 336, ['diez enlaces', 'ten links'], { tam: 18 }),
    nota(30, 358, ['y ninguna página', 'and not one page'], { tam: 18 }),

    // El bocadillo del asistente.
    tinta([[330, 40], [500, 28], [700, 40], [724, 130], [700, 226], [520, 238], [420, 232], [380, 280], [384, 228], [330, 214], [314, 130], [330, 40]], { g: 2.4 }),
    renglon(350, 72, 330),
    renglon(350, 98, 340),
    renglon(350, 124, 300),
    // La cita inventada, legible, y tachada.
    nota(352, 156, ['(Autor, 1971, p. 212)', '(Author, 1971, p. 212)'], { tam: 19, tinta: 'tinta' }),
    rojo([[346, 150], [430, 144], [540, 148]], { g: 2.4 }),
    rojo([[350, 158], [450, 151], [542, 154]], { g: 1.4 }),
    renglon(350, 180, 260),
    renglon(350, 204, 150),
    nota(566, 204, ['no existe', 'does not exist'], { tam: 20, tinta: 'rojo', giro: -8 }),
    rojo([[560, 192], [552, 174], [560, 164]], { g: 1 }),

    // La pila de libros, aplastada en un rectángulo plano.
    lapiz([[440, 290], [600, 288]], { g: 0.7 }),
    lapiz([[446, 300], [596, 300]], { g: 0.7 }),
    lapiz([[438, 312], [604, 311]], { g: 0.7 }),
    plano([[430, 326], [620, 322], [622, 342], [432, 346]], 'negro', { opacidad: 0.9 }),
    sombra([[430, 348], [622, 344], [624, 358], [432, 362]], 20, 6, { cobertura: 0.6, g: 0.7 }),
    nota(636, 342, ['todo pesa\nlo mismo', 'all of it\nweighs the same'], { tam: 16 }),
  ],
};
