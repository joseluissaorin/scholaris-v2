/**
 * Corpus de demostración para trabajar sin API.
 *
 * Todo es ficticio salvo una obra de dominio público: autores, obras,
 * editoriales, revistas, entrevistas y universidades se han inventado para la
 * demo, y sus pasajes los ha escrito Scholaris. Ninguna persona real aparece
 * diciendo o haciendo algo que no dijo o no hizo.
 *
 * La excepción son las «Rimas» de Gustavo Adolfo Bécquer (1871, dominio
 * público): sus pasajes son versos literales, con «/» entre verso y verso. La
 * edición, la paginación y la editorial sí son inventadas.
 *
 * Fuera de los textos solo aparecen datos verdaderos y comprobables (Jeremy
 * Bentham proyectó el Panóptico en 1791; París es París).
 */
import type { Ancla, MetadatosDocumento, TipoEntrada } from '@scholaris/nucleo';
import { aRomano } from '@scholaris/nucleo';

export interface DocDemo {
  id: string;
  tipo: TipoEntrada;
  meta: MetadatosDocumento;
  unidades: number;
  duracion?: number;
  /** Preliminares con folio romano (solo libros). */
  romanas?: number;
  /** Páginas sin folio al principio (portadillas). */
  sinFolio?: number;
  /** Folios deducidos con poca confianza: desde-hasta (físicas). */
  dudosas?: [number, number];
  secciones: Array<{ titulo: string; nivel: number; unidad: number }>;
  banco: string[];
  /** Pasajes fijos en una unidad concreta (para que las demos sean exactas). */
  fijos: Record<number, string>;
  bibliotecas: string[];
  creado: string;
  bytes: number;
  mime: string;
  hablantes?: string[];
}

const a = (nombre: string, apellidos: string) => ({ nombre, apellidos });

export const BIBLIOTECAS = [
  { id: 'b-tfg', nombre: 'Escritura abyecta del duelo', descripcion: 'Elvira Montesdeoca, lo abyecto y el archivo del duelo.', color: 'rojo', creada: '2026-03-02T10:00:00Z' },
  { id: 'b-espacios', nombre: 'Espacios otros', descripcion: 'Heterotopías, cárcel, archivo.', color: 'azul', creada: '2026-05-11T10:00:00Z' },
  { id: 'b-clases', nombre: 'Clases y entrevistas', descripcion: 'Grabaciones del curso y del seminario.', color: 'amarillo', creada: '2026-09-20T10:00:00Z' },
];

export const DOCUMENTOS: DocDemo[] = [
  {
    id: 'd-mirada', tipo: 'pdf', unidades: 314, romanas: 8, sinFolio: 2,
    meta: { titulo: 'La mirada que ordena', subtitulo: 'Vigilancia y castigo en la ciudad moderna', autores: [a('Inés', 'Valcárcel Ruiz')], anio: 2009, anioOriginal: 1998, editorial: 'Ediciones del Faro Viejo', lugar: 'Madrid', idioma: 'es', tipoCSL: 'book',
      procedencia: { titulo: { fuente: 'pdf', confianza: 0.98 }, autores: { fuente: 'lectura', confianza: 0.95 }, anio: { fuente: 'lectura', confianza: 0.9 }, anioOriginal: { fuente: 'lectura', confianza: 0.86 }, editorial: { fuente: 'lectura', confianza: 0.8 } } },
    secciones: [
      { titulo: 'Primera parte. El espectáculo', nivel: 1, unidad: 11 }, { titulo: 'I. La plaza y el cadalso', nivel: 2, unidad: 11 }, { titulo: 'II. El público que mira', nivel: 2, unidad: 44 },
      { titulo: 'Segunda parte. El reglamento', nivel: 1, unidad: 85 }, { titulo: 'I. La pena medida', nivel: 2, unidad: 85 }, { titulo: 'II. El expediente', nivel: 2, unidad: 112 },
      { titulo: 'Tercera parte. La disciplina', nivel: 1, unidad: 141 }, { titulo: 'I. Cuerpos en fila', nivel: 2, unidad: 141 }, { titulo: 'II. El horario y el examen', nivel: 2, unidad: 181 }, { titulo: 'III. La torre de Bentham', nivel: 2, unidad: 207 },
      { titulo: 'Cuarta parte. La prisión', nivel: 1, unidad: 241 }, { titulo: 'I. La celda como método', nivel: 2, unidad: 241 }, { titulo: 'II. El delito útil', nivel: 2, unidad: 271 },
    ],
    banco: [
      'El castigo deja de ser una función de plaza mayor y se retira a los despachos, donde se vuelve discreto, administrativo y casi invisible.',
      'Lo que cambia no es tanto la dureza de la pena como su destinatario: ya no castiga el cuerpo que sufre, sino que corrige la conducta del que obedece.',
      'La disciplina reparte a las personas en el espacio, las ordena en el tiempo y las suma como piezas de una maquinaria útil.',
      'El examen junta la mirada del superior y la nota que clasifica: cada alumno, cada soldado, cada preso acaba convertido en un caso.',
      'El poder que describe este libro no se guarda en un cofre: se ejerce, pasa de mano en mano y se aloja en los gestos más pequeños.',
      'La prisión nace acompañada de su propio fracaso, y cada fracaso sirve de argumento para construir otra prisión.',
      'La norma va ocupando el lugar de la ley: separa lo normal de lo anómalo con una contabilidad minuciosa de los cuerpos.',
      'Cada reforma penal promete un castigo más humano y, a la vez, alarga el brazo de la vigilancia.',
      'Saber y mandar van juntos: cada archivo de individuos es también un instrumento para gobernarlos.',
      'El horario, la campana y la fila descomponen el gesto para volver a montarlo más rápido y más dócil.',
    ],
    fijos: {
      207: 'La torre que Bentham proyectó en 1791 separa dos experiencias: desde las celdas del anillo se es visto sin ver; desde la torre central se ve sin ser visto.',
      208: 'De ahí su efecto principal: el preso que se sabe visible a todas horas acaba vigilándose a sí mismo, y el poder funciona solo, aunque nadie esté mirando.',
      209: 'Quien vive bajo una mirada que no puede comprobar termina haciendo el trabajo del guardián: se convierte en el principio de su propia obediencia.',
      11: 'El libro empieza en una plaza llena de público para medir la distancia recorrida: en menos de un siglo, el castigo pasa del cadalso al reglamento.',
      264: 'La prisión no consigue reducir los delitos, pero produce algo que le resulta útil: una delincuencia conocida, fichada y separable de las demás.',
    },
    bibliotecas: ['b-espacios'], creado: '2026-05-12T09:14:00Z', bytes: 18_400_000, mime: 'application/pdf',
  },
  {
    id: 'd-asco', tipo: 'pdf_escaneado', unidades: 282, romanas: 0, sinFolio: 6, dudosas: [118, 126],
    meta: { titulo: 'Los bordes del asco', subtitulo: 'Ensayo sobre lo abyecto en la novela de posguerra', autores: [a('Clara', 'Etxeberria Goñi')], anio: 1994, editorial: 'Editorial Aldaba', lugar: 'Bilbao', idioma: 'es', tipoCSL: 'book',
      procedencia: { titulo: { fuente: 'lectura', confianza: 0.93 }, autores: { fuente: 'lectura', confianza: 0.94 }, anio: { fuente: 'lectura', confianza: 0.7 }, editorial: { fuente: 'lectura', confianza: 0.62 } } },
    secciones: [
      { titulo: 'I. Una aproximación a lo abyecto', nivel: 1, unidad: 7 }, { titulo: 'Ni dentro ni fuera', nivel: 2, unidad: 7 }, { titulo: 'El cadáver', nivel: 2, unidad: 15 },
      { titulo: 'II. El miedo y sus objetos', nivel: 1, unidad: 38 }, { titulo: 'III. De la suciedad a la mancha', nivel: 1, unidad: 82 }, { titulo: 'IV. Lo impuro en la casa', nivel: 1, unidad: 118 },
      { titulo: 'V. Las voces que se quiebran', nivel: 1, unidad: 150 }, { titulo: 'VI. La novela del hambre', nivel: 1, unidad: 182 }, { titulo: 'VII. Dolor y escritura', nivel: 1, unidad: 210 },
    ],
    banco: [
      'Lo abyecto no está delante del sujeto como una cosa: es lo que se ha expulsado y, desde el borde, sigue reclamando su sitio.',
      'No provoca asco la falta de higiene sino lo que desordena: lo que borra la línea entre lo propio y lo ajeno.',
      'El cadáver es el caso extremo: la muerte instalada en medio de la vida, un límite que lo ha invadido todo.',
      'El sujeto se forma echando fuera lo que lo amenaza, pero lo expulsado nunca se marcha del todo.',
      'La novela de posguerra explora ese borde en el que la lengua toca lo que no se puede nombrar y lo convierte en estilo.',
      'El duelo deja una herida que la escritura intenta coser una y otra vez, sin conseguirlo.',
      'La impureza no es una cualidad de las cosas, sino el efecto de los límites que cada cultura dibuja.',
      'El horror se cuenta con una lengua rota: elipsis, exclamaciones, frases que no terminan.',
    ],
    fijos: {
      9: 'Lo abyecto no es lo sucio, sino aquello que perturba una identidad, un sistema o un orden: lo que no respeta los límites ni los lugares asignados.',
      16: 'El cadáver es el colmo de lo abyecto: la muerte que se instala en la vida, un borde que ha acabado por ocuparlo todo.',
      212: 'En el dolor y en el horror, la escritura se coloca en el límite: no representa lo abyecto, lo atraviesa.',
    },
    bibliotecas: ['b-tfg'], creado: '2026-03-03T18:40:00Z', bytes: 96_200_000, mime: 'application/pdf',
  },
  {
    id: 'd-montesdeoca', tipo: 'pdf', unidades: 24, sinFolio: 0,
    meta: { titulo: 'Elvira Montesdeoca: las cartas como archivo del duelo', autores: [a('Marta', 'Ríos Abad')], anio: 2021, revista: 'Cuadernos de Filología Insular', volumen: '41', numero: '2', paginas: '411-434', doi: '10.5555/cfi.2021.41.2.016', idioma: 'es', tipoCSL: 'article-journal',
      procedencia: { titulo: { fuente: 'pdf', confianza: 0.99 }, autores: { fuente: 'pdf', confianza: 0.99 }, doi: { fuente: 'pdf', confianza: 1 } } },
    secciones: [{ titulo: 'Introducción', nivel: 1, unidad: 1 }, { titulo: 'Una correspondencia interrumpida', nivel: 1, unidad: 5 }, { titulo: 'El duelo como forma', nivel: 1, unidad: 12 }, { titulo: 'Conclusiones', nivel: 1, unidad: 21 }],
    banco: [
      'Las cartas que Elvira Montesdeoca guardó después de 1936 funcionan como un archivo íntimo que se resiste a cerrar el duelo.',
      'La escritura epistolar de Montesdeoca alterna la confidencia con un pudor casi notarial.',
      'Conservar también es una forma de hablar: el archivo personal dice lo que la poeta nunca publicó.',
      'La crítica ha leído a Montesdeoca casi siempre a la sombra de su corresponsal; aquí se propone leerla desde su propia voz.',
      'El duelo no aparece como tema sino como forma: tachaduras, fechas repetidas, cartas que no se enviaron.',
    ],
    fijos: { 13: 'En las cartas posteriores a 1936 el duelo no se nombra: se inscribe en la forma, en las fechas que vuelven y en los sobres que nunca se enviaron.' },
    bibliotecas: ['b-tfg'], creado: '2026-03-04T11:02:00Z', bytes: 1_240_000, mime: 'application/pdf',
  },
  {
    id: 'd-mapas', tipo: 'pdf', unidades: 522, romanas: 4, sinFolio: 2,
    meta: { titulo: 'Mapas sin centro', subtitulo: 'Rizomas, redes y archivos', autores: [a('Tomás', 'Arribas'), a('Lena', 'Hoffmann')], anio: 2004, anioOriginal: 1999, editorial: 'Ediciones Contraluz', lugar: 'Valencia', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: '1. Introducción: el rizoma', nivel: 1, unidad: 15 }, { titulo: '6. Un cuerpo que no se deja ordenar', nivel: 1, unidad: 161 }, { titulo: '10. Devenir y vecindad', nivel: 1, unidad: 245 }, { titulo: '14. Lo liso y lo estriado', nivel: 1, unidad: 487 }],
    banco: [
      'Un rizoma no empieza ni acaba: crece siempre por el medio, entre las cosas, como la hierba que brota entre dos losas.',
      'En un rizoma cualquier punto puede conectarse con cualquier otro; el árbol, en cambio, fija un orden de ramas y raíces.',
      'Devenir no es imitar ni identificarse: es entrar en una zona de vecindad donde ya no se distingue lo uno de lo otro.',
      'El espacio liso es el del que viaja sin mapa; el estriado, el de la administración que mide, reparte y cierra.',
      'Una red de archivos funciona como un rizoma: nadie la recorre entera y cada entrada abre un camino distinto.',
      'El deseo no es carencia: produce, conecta y se agencia con lo que encuentra.',
    ],
    fijos: { 16: 'Un rizoma no tiene principio ni fin: siempre está en el medio, entre las cosas, y solo sabe de alianzas.' },
    bibliotecas: ['b-espacios'], creado: '2026-05-20T16:22:00Z', bytes: 31_000_000, mime: 'application/pdf',
  },
  {
    id: 'd-voces', tipo: 'epub', unidades: 96,
    meta: { titulo: 'El archivo de las voces y otros cuentos', autores: [a('Aurelio', 'Bermejo')], anio: 2011, anioOriginal: 1958, editorial: 'Editorial Brújula', lugar: 'Montevideo', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: 'El archivo de las voces', nivel: 1, unidad: 1 }, { titulo: 'El copista de Toledo', nivel: 1, unidad: 22 }, { titulo: 'La sala de los catálogos', nivel: 1, unidad: 41 }, { titulo: 'El jardín de los relojes', nivel: 1, unidad: 55 }, { titulo: 'El hombre que no olvidaba', nivel: 1, unidad: 72 }],
    banco: [
      'El archivo guardaba todas las voces que se habían oído en la ciudad, y por eso nadie encontraba nunca la que buscaba.',
      'El copista rehízo el manuscrito palabra por palabra; tres siglos después, el mismo texto ya no decía lo mismo.',
      'Recordarlo todo es no poder pensar: pensar es olvidar diferencias, juntar, resumir.',
      'Los catálogos describían los libros con tanto detalle que acabaron por sustituirlos.',
      'En el jardín, cada reloj marcaba la hora de una decisión que alguien no llegó a tomar.',
    ],
    fijos: { 43: 'La sala de los catálogos era total: sus fichas describían todos los libros posibles, también los que nadie había escrito todavía.', 74: 'Ramón Ibarra no solo recordaba cada hoja de cada árbol, sino cada una de las veces que la había mirado.' },
    bibliotecas: [], creado: '2026-08-02T21:10:00Z', bytes: 820_000, mime: 'application/epub+zip',
  },
  {
    id: 'd-becquer', tipo: 'fotos', unidades: 48, sinFolio: 0,
    meta: { titulo: 'Rimas', autores: [a('Gustavo Adolfo', 'Bécquer')], anio: 1998, anioOriginal: 1871, editorial: 'Ediciones del Faro Viejo', lugar: 'Madrid', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: 'Rimas I-XXX', nivel: 1, unidad: 1 }, { titulo: 'Rimas XXXI-LXXVI', nivel: 1, unidad: 25 }],
    // Versos literales de las «Rimas» (dominio público).
    banco: [
      '¿Qué es poesía?, dices mientras clavas / en mi pupila tu pupila azul. / ¿Qué es poesía? ¿Y tú me lo preguntas? / Poesía... eres tú.',
      'Del salón en el ángulo oscuro, / de su dueña tal vez olvidada, / silenciosa y cubierta de polvo / veíase el arpa.',
      'Por una mirada, un mundo; / por una sonrisa, un cielo; / por un beso... ¡yo no sé / qué te diera por un beso!',
      'Asomaba a sus ojos una lágrima / y a mi labio una frase de perdón; / habló el orgullo y se enjugó su llanto, / y la frase en mis labios expiró.',
      '¡Los suspiros son aire y van al aire! / ¡Las lágrimas son agua y van al mar! / Dime, mujer, cuando el amor se olvida, / ¿sabes tú adónde va?',
    ],
    fijos: { 46: 'Volverán las oscuras golondrinas / en tu balcón sus nidos a colgar, / y otra vez con el ala a sus cristales / jugando llamarán.' },
    bibliotecas: [], creado: '2026-09-28T12:00:00Z', bytes: 64_000_000, mime: 'image/jpeg',
  },
  {
    id: 'd-almeida', tipo: 'audio', unidades: 52, duracion: 3125,
    meta: { titulo: 'Entrevista a Ramiro Almeida', subtitulo: 'Seminario de canción de autor, Universidad de Valdeluz', autores: [a('Ramiro', 'Almeida')], editores: [a('Lucía', 'Ferrán'), a('Óscar', 'Medel')], anio: 2026, idioma: 'es', tipoCSL: 'interview' },
    secciones: [{ titulo: 'Infancia en el barrio del puerto', nivel: 1, unidad: 1 }, { titulo: 'Bécquer y las golondrinas', nivel: 1, unidad: 14 }, { titulo: 'La canción como poema', nivel: 1, unidad: 29 }, { titulo: 'Preguntas del público', nivel: 1, unidad: 43 }],
    hablantes: ['Lucía Ferrán', 'Ramiro Almeida'],
    banco: [
      'Ponerle música a Bécquer fue una manera de leerlo en voz alta para gente que nunca había abierto el libro.',
      'La canción tiene algo de poema que se escucha una sola vez y tiene que quedarse.',
      'Yo no elegía los poemas: ellos me elegían a mí cuando ya llevaban tiempo dando vueltas.',
      'El barrio me enseñó a mirar: el muelle era una escuela de oficios y de palabras.',
      'Las rimas están escritas desde el cuerpo y desde la pérdida; eso no se puede cantar en falso.',
      'Una canción se termina cuando deja de pedirte cambios, no cuando tú quieres.',
    ],
    fijos: { 15: 'Con las golondrinas de Bécquer tuve la sensación de que el poema ya traía la música dentro y yo solo tenía que no estropearla.' },
    bibliotecas: ['b-clases'], creado: '2026-09-30T19:00:00Z', bytes: 48_000_000, mime: 'audio/mpeg',
  },
  {
    id: 'd-clase', tipo: 'video', unidades: 80, duracion: 4810,
    meta: { titulo: 'Teoría de la Literatura · Sesión 7: la abyección', autores: [a('Ana', 'Castellano')], anio: 2026, idioma: 'es', tipoCSL: 'speech', editorial: 'Universidad de Valdeluz' },
    secciones: [{ titulo: 'Repaso: sujeto y lenguaje', nivel: 1, unidad: 1 }, { titulo: 'Etxeberria y lo abyecto', nivel: 1, unidad: 12 }, { titulo: 'Lecturas: Montesdeoca y la carta', nivel: 1, unidad: 41 }, { titulo: 'Debate', nivel: 1, unidad: 66 }],
    hablantes: ['Ana Castellano', 'Estudiante'],
    banco: [
      'Fijaos en que la abyección no es un tema: es una posición del sujeto frente a sus propios límites.',
      'Cuando leemos las cartas, la pregunta no es qué dicen sino qué conservan y por qué.',
      'Etxeberria parte de una idea de sujeto en proceso y la lleva al cuerpo y a la casa.',
      'La pizarra de hoy tiene tres columnas: lo expulsado, el borde y la escritura.',
      'Un archivo personal es siempre un relato sobre la pérdida, aunque nadie lo escriba como tal.',
    ],
    fijos: { 13: 'Lo abyecto, para Etxeberria, no es lo sucio: es lo que pone en crisis el límite entre el dentro y el fuera del sujeto.' },
    bibliotecas: ['b-clases', 'b-tfg'], creado: '2026-10-01T08:30:00Z', bytes: 1_400_000_000, mime: 'video/mp4',
  },
  {
    id: 'd-heterotopias', tipo: 'presentacion', unidades: 24,
    meta: { titulo: 'Espacios otros: heterotopías', autores: [a('Nuria', 'Santana Brito')], anio: 2026, idioma: 'es', tipoCSL: 'speech' },
    secciones: [{ titulo: 'Qué es una heterotopía', nivel: 1, unidad: 2 }, { titulo: 'Seis rasgos', nivel: 1, unidad: 6 }, { titulo: 'La casa vacía como antiarchivo', nivel: 1, unidad: 16 }],
    banco: [
      'Heterotopía: un lugar real que funciona como el reverso de todos los demás lugares.',
      'El cementerio, el jardín, el museo, la biblioteca: espacios que acumulan tiempo.',
      'La casa vacía guarda lo que nadie quiso archivar: un antiarchivo.',
      'Seis rasgos: están en todas las culturas, cambian de función, yuxtaponen espacios, acumulan tiempo, se abren y se cierran, y reflejan el resto del espacio.',
    ],
    fijos: { 17: 'La casa vacía funciona como antiarchivo: conserva por abandono lo que ninguna institución habría catalogado.' },
    bibliotecas: ['b-espacios'], creado: '2026-06-01T10:00:00Z', bytes: 12_800_000, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  {
    id: 'd-cartas', tipo: 'hoja', unidades: 12,
    meta: { titulo: 'Inventario de cartas de Elvira Montesdeoca (1915-1936)', autores: [a('Marta', 'Ríos Abad')], anio: 2026, idioma: 'es', tipoCSL: 'dataset' },
    secciones: [{ titulo: 'Cartas', nivel: 1, unidad: 1 }],
    banco: [
      '| fecha | destinatario | lugar | notas |\n|---|---|---|---|\n| 1921-03-12 | R. A. | Garachico | menciona la huerta |\n| 1924-07-02 | R. A. | Garachico | sin sobre |',
      '| fecha | destinatario | lugar | notas |\n|---|---|---|---|\n| 1936-09-01 | (sin enviar) | Garachico | tachaduras |\n| 1936-11-20 | (sin enviar) | Garachico | fecha repetida |',
    ],
    fijos: {},
    bibliotecas: ['b-tfg'], creado: '2026-04-10T10:00:00Z', bytes: 48_000, mime: 'text/csv',
  },
  {
    id: 'd-web', tipo: 'web', unidades: 18,
    meta: { titulo: 'La cárcel como archivo: leer a Valcárcel hoy', autores: [a('Lucía', 'Benítez')], anio: 2025, revista: 'Cuaderno de Crítica (blog)', url: 'https://ejemplo.org/la-carcel-como-archivo', idioma: 'es', tipoCSL: 'post-weblog' },
    secciones: [{ titulo: 'La cárcel como archivo', nivel: 1, unidad: 1 }, { titulo: 'Vigilancia de plataforma', nivel: 2, unidad: 9 }],
    banco: [
      'Releer hoy la torre de Bentham obliga a pensar en plataformas que vigilan sin torre y sin guardia.',
      'El expediente penitenciario fue el primer gran archivo de individuos; el perfil digital es su heredero.',
      'La visibilidad ya no se impone: se ofrece voluntariamente a cambio de reconocimiento.',
    ],
    fijos: { 10: 'La vigilancia de plataforma le da la vuelta al panóptico: ya no hace falta una torre, porque cada uno publica su propia celda.' },
    bibliotecas: ['b-espacios'], creado: '2026-07-14T10:00:00Z', bytes: 210_000, mime: 'text/html',
  },
];

// ---------------------------------------------------------------------------
// Generación determinista de unidades
// ---------------------------------------------------------------------------

function aleatorio(semilla: number) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function hash(t: string) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function anclaDe(d: DocDemo, orden: number): Ancla {
  switch (d.tipo) {
    case 'pdf': case 'pdf_escaneado': case 'fotos': {
      const sin = d.sinFolio ?? 0, rom = d.romanas ?? 0;
      let impresa: string | null = null, romana = false;
      const offset = d.id === 'd-montesdeoca' ? 410 : d.id === 'd-becquer' ? 14 : 0;
      if (orden > sin && orden <= sin + rom) { impresa = aRomano(orden - sin); romana = true; }
      else if (orden > sin + rom) impresa = String(orden - sin - rom + offset);
      const dudosa = d.dudosas && orden >= d.dudosas[0] && orden <= d.dudosas[1];
      return { tipo: 'pagina', fisica: orden, impresa, romana, origen: impresa ? (dudosa ? 'deducido' : 'leido') : 'ninguno', confianza: dudosa ? 0.58 : impresa ? 0.97 : 1 };
    }
    case 'audio': case 'video': {
      const paso = (d.duracion ?? 60) / d.unidades;
      const t0 = Math.round((orden - 1) * paso), t1 = Math.round(orden * paso);
      const hablante = d.hablantes ? d.hablantes[orden % 3 === 0 ? 0 : 1] : undefined;
      return { tipo: 'tiempo', t0, t1, ...(hablante ? { hablante } : {}) };
    }
    case 'epub': {
      const sec = [...d.secciones].reverse().find((s) => s.unidad <= orden);
      return { tipo: 'seccion', ruta: [sec?.titulo ?? d.meta.titulo], parrafo: orden - (sec?.unidad ?? 1) + 1, impresa: String(Math.round(orden * 2.1) + 6) };
    }
    case 'presentacion': return { tipo: 'diapositiva', n: orden };
    case 'hoja': return { tipo: 'hoja', hoja: 'Cartas', filaDesde: (orden - 1) * 50 + 1, filaHasta: orden * 50 };
    case 'web': {
      const sec = [...d.secciones].reverse().find((s) => s.unidad <= orden);
      return { tipo: 'web', url: d.meta.url ?? '', ruta: [sec?.titulo ?? ''], parrafo: orden, consultada: '2026-07-14' };
    }
    default: return { tipo: 'imagen' };
  }
}

/** Texto de una unidad: párrafos compuestos del banco, con el pasaje fijo si lo hay. */
export function textoDe(d: DocDemo, orden: number): string {
  const r = aleatorio(hash(d.id) + orden * 7919);
  const fijo = d.fijos[orden];
  // Portadillas y preliminares sin folio: lo que hay de verdad en ellas.
  if ((d.tipo === 'pdf' || d.tipo === 'pdf_escaneado') && orden <= (d.sinFolio ?? 0)) {
    return orden === 1 ? `## ${d.meta.titulo}\n\n${d.meta.autores.map((x) => `${x.nombre} ${x.apellidos}`).join(' y ')}` : `${d.meta.editorial ?? ''}${d.meta.lugar ? `, ${d.meta.lugar}` : ''}${d.meta.anio ? `, ${d.meta.anio}` : ''}`;
  }
  if (d.tipo === 'hoja') return d.banco[orden % d.banco.length] as string;
  if (d.tipo === 'presentacion') {
    const sec = [...d.secciones].reverse().find((s) => s.unidad <= orden);
    const vinetas = [0, 1, 2].map(() => `- ${d.banco[Math.floor(r() * d.banco.length)]}`);
    return `## ${sec?.titulo ?? d.meta.titulo}\n\n${fijo ? `- ${fijo}\n` : ''}${vinetas.join('\n')}`;
  }
  const nParrafos = d.tipo === 'audio' || d.tipo === 'video' || d.tipo === 'web' || d.tipo === 'epub' ? 1 : 3;
  const parrafos: string[] = [];
  for (let p = 0; p < nParrafos; p++) {
    const n = 2 + Math.floor(r() * 3);
    const frases: string[] = [];
    for (let i = 0; i < n; i++) frases.push(d.banco[Math.floor(r() * d.banco.length)] as string);
    parrafos.push([...new Set(frases)].join(' '));
  }
  if (fijo) parrafos.splice(nParrafos > 1 ? 1 : 0, nParrafos > 1 ? 0 : 1, fijo);
  const titulo = d.secciones.find((s) => s.unidad === orden && (d.tipo === 'pdf' || d.tipo === 'pdf_escaneado' || d.tipo === 'fotos'));
  return (titulo ? `## ${titulo.titulo}\n\n` : '') + parrafos.join('\n\n');
}

export function portadaColor(d: DocDemo): string {
  const colores = ['#b8321c', '#23457a', '#e2a52a', '#22160f', '#4f6f33'];
  return colores[hash(d.id) % colores.length] as string;
}
