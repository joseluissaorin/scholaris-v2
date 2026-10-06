/**
 * La constelación: un mapa del cielo dibujado como los diagramas astronómicos
 * de los tratados, con el compás a lápiz y el limbo graduado a pluma. Las
 * estrellas son documentos de una biblioteca; las líneas, las relaciones que
 * aparecen cuando se leen juntos. Unas van en tinta (están en las páginas) y
 * otras a lápiz (son hipótesis: las decide quien lee).
 *
 * Detrás, los círculos de Kandinski, planos.
 */
import { type Dibujo, type Elemento, type Punto, tinta, lapiz, rojo, blanco, plano, disco, nota, circulo } from '../boceto';

const C: Punto = [440, 340];

/** Una estrella de ocho puntas a pluma, con el punto de oro en el centro. */
function estrella([x, y]: Punto, r = 10, clara = false): Elemento[] {
  const t = clara ? blanco : tinta;
  return [
    t([[x - r, y + 1], [x + r, y - 1]], { g: 1.6, recto: true }),
    t([[x + 1, y - r], [x - 1, y + r]], { g: 1.6, recto: true }),
    t([[x - r * 0.5, y - r * 0.5], [x + r * 0.5, y + r * 0.5]], { g: 1, recto: true }),
    t([[x + r * 0.5, y - r * 0.5], [x - r * 0.5, y + r * 0.5]], { g: 1, recto: true }),
    plano(circulo([x, y], r * 0.3, 6), 'oro', { encima: true }),
  ];
}

const E = {
  ficciones: [262, 214] as Punto,
  arqueologia: [486, 150] as Punto,
  mesetas: [640, 300] as Punto,
  sisifo: [214, 444] as Punto,
  poderes: [470, 500] as Punto,
  loQueHay: [690, 508] as Punto,
  entrevista: [372, 330] as Punto,
  apuntes: [780, 150] as Punto,
};

/** Una línea de constelación: no llega del todo a las estrellas. */
function enlace(a: Punto, b: Punto, conLapiz = false): Elemento {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const m = Math.hypot(dx, dy);
  const ux = dx / m, uy = dy / m;
  const p: Punto[] = [[a[0] + ux * 16, a[1] + uy * 16], [b[0] - ux * 16, b[1] - uy * 16]];
  return conLapiz ? lapiz(p, { g: 1.3 }) : tinta(p, { g: 1.3, recto: true });
}

/** Las marcas del limbo graduado, cada diez grados; más largas cada treinta. */
const limbo: Elemento[] = Array.from({ length: 36 }, (_, i) => {
  const a = (i * 10 * Math.PI) / 180;
  const r1 = 286, r2 = i % 3 ? 296 : 306;
  return tinta([[C[0] + Math.cos(a) * r1, C[1] + Math.sin(a) * r1], [C[0] + Math.cos(a) * r2, C[1] + Math.sin(a) * r2]], { g: i % 3 ? 1 : 1.6, recto: true });
});

export const constelacion: Dibujo = {
  id: 'constelacion',
  ancho: 900,
  alto: 680,
  duracion: 4,
  titulo: { es: 'Mapa de una biblioteca dibujado como un mapa del cielo', en: 'A library mapped like a chart of the sky' },
  descripcion: {
    es: 'Un diagrama astronómico hecho a mano: círculos concéntricos trazados con compás, un anillo graduado y, dentro, estrellas que son libros (Ficciones, La arqueología del saber, Mil mesetas, El mito de Sísifo, Poderes de la perversión, Lo que hay) junto a una entrevista y unos apuntes. Unas líneas de tinta los unen porque lo dicen las páginas; otras, a lápiz, son hipótesis que quedan para quien lee. Detrás flotan, planos, un gran círculo azul y uno rojo pequeño. Una nota en rojo pregunta por una de las líneas.',
    en: 'A hand-drawn astronomical diagram: concentric circles traced with compasses, a graduated ring and, inside, stars that are books (Ficciones, The Archaeology of Knowledge, A Thousand Plateaus, The Myth of Sisyphus, Powers of Horror, Lo que hay) together with an interview and some notes. Ink lines join them because the pages say so; others, in pencil, are hypotheses left for the reader. Behind them float, flat, a large blue circle and a small red one. A red note questions one of the lines.',
  },
  elementos: [
    // El compás.
    lapiz(circulo(C, 96, 20), { recto: false }),
    lapiz(circulo(C, 192, 24), { recto: false }),
    lapiz(circulo(C, 286, 28), { recto: false }),
    lapiz([[C[0] - 320, C[1] + 2], [C[0] + 320, C[1] - 2]], { g: 0.6 }),
    lapiz([[C[0] - 2, C[1] - 320], [C[0] + 2, C[1] + 320]], { g: 0.6 }),
    lapiz([[C[0] - 230, C[1] - 220], [C[0] + 230, C[1] + 220]], { g: 0.5 }),

    // Kandinski, plano: el círculo azul grande que muerde el borde y el rojo pequeño.
    disco([792, 118], 150, 'azul', { opacidad: 0.92 }),
    disco([150, 560], 46, 'rojo'),
    plano([[560, 610], [640, 610], [600, 540]], 'amarillo'),

    // El limbo, a pluma, con dos pasadas que no coinciden en el círculo exterior.
    tinta(circulo(C, 286, 28, 0, 330), { g: 2, recto: false }),
    tinta(circulo(C, 296, 28, 10, 350), { g: 1, recto: false }),
    ...limbo,
    tinta(circulo(C, 192, 22, 40, 300), { g: 1.2, recto: false }),

    // Las relaciones que están en las páginas.
    enlace(E.ficciones, E.arqueologia),
    enlace(E.arqueologia, E.mesetas),
    enlace(E.mesetas, E.loQueHay),
    enlace(E.loQueHay, E.poderes),
    enlace(E.poderes, E.entrevista),
    enlace(E.entrevista, E.ficciones),
    enlace(E.sisifo, E.entrevista),
    // Las que son solo hipótesis.
    enlace(E.mesetas, E.poderes, true),
    enlace(E.arqueologia, E.entrevista, true),
    enlace(E.sisifo, E.poderes, true),
    enlace(E.mesetas, E.apuntes, true),

    ...estrella(E.ficciones, 13),
    ...estrella(E.arqueologia, 11),
    ...estrella(E.mesetas, 14),
    ...estrella(E.sisifo, 10),
    ...estrella(E.poderes, 12),
    ...estrella(E.loQueHay, 11),
    ...estrella(E.entrevista, 9),
    ...estrella(E.apuntes, 12, true),

    nota(E.ficciones[0] - 18, E.ficciones[1] - 22, 'Ficciones, 1944', { tam: 17, ancla: 'end' }),
    nota(E.arqueologia[0] + 18, E.arqueologia[1] - 14, ['La arqueología del saber, 1969', 'The Archaeology of Knowledge, 1969'], { tam: 17 }),
    nota(E.mesetas[0] + 22, E.mesetas[1] + 6, ['Mil mesetas, 1980', 'A Thousand Plateaus, 1980'], { tam: 17 }),
    nota(E.sisifo[0] - 16, E.sisifo[1] + 30, ['El mito de Sísifo, 1942', 'The Myth of Sisyphus, 1942'], { tam: 17, ancla: 'middle' }),
    nota(E.poderes[0] + 4, E.poderes[1] + 34, ['Poderes de la perversión, 1980', 'Powers of Horror, 1980'], { tam: 17, ancla: 'middle' }),
    nota(E.loQueHay[0] + 20, E.loQueHay[1] + 6, 'Lo que hay, 2022', { tam: 17 }),
    nota(E.entrevista[0] + 16, E.entrevista[1] + 26, ['tu entrevista, 12:04', 'your interview, 12:04'], { tam: 16, tinta: 'rojo' }),
    nota(E.apuntes[0] - 8, E.apuntes[1] + 34, ['tus apuntes', 'your notes'], { tam: 17, tinta: 'papel', ancla: 'middle' }),

    // La pregunta: una de las líneas a lápiz, rodeada y discutida.
    rojo(circulo([556, 400], 36, 10, 200, 520, 22), { g: 1.3, recto: false }),
    nota(604, 396, ['¿y esta?', 'and this one?'], { tam: 20, tinta: 'rojo', giro: -6 }),
    nota(70, 664, ['las líneas las traza la máquina; lo que significan, tú', 'the machine draws the lines; what they mean is up to you'], { tam: 18, giro: -1.5 }),
  ],
};
