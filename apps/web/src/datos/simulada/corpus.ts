/**
 * Corpus de demostración para trabajar sin API. Los pasajes son paráfrasis
 * propias escritas para la demo, no citas de las obras: sirven para que la
 * búsqueda, el lector y la autocita tengan algo verosímil que enseñar.
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
  { id: 'b-tfg', nombre: 'Escritura abyecta del duelo', descripcion: 'Emilia Llanos, Kristeva y el archivo del duelo.', color: 'rojo', creada: '2026-03-02T10:00:00Z' },
  { id: 'b-espacios', nombre: 'Espacios otros', descripcion: 'Heterotopías, cárcel, archivo.', color: 'azul', creada: '2026-05-11T10:00:00Z' },
  { id: 'b-clases', nombre: 'Clases y entrevistas', descripcion: 'Grabaciones del curso y del seminario.', color: 'amarillo', creada: '2026-09-20T10:00:00Z' },
];

export const DOCUMENTOS: DocDemo[] = [
  {
    id: 'd-foucault', tipo: 'pdf', unidades: 314, romanas: 8, sinFolio: 2,
    meta: { titulo: 'Vigilar y castigar', subtitulo: 'Nacimiento de la prisión', autores: [a('Michel', 'Foucault')], anio: 2009, anioOriginal: 1975, editorial: 'Siglo XXI', lugar: 'Madrid', idioma: 'es', tipoCSL: 'book', isbn: '978-84-323-1371-2',
      procedencia: { titulo: { fuente: 'pdf', confianza: 0.98 }, autores: { fuente: 'lectura', confianza: 0.95 }, anio: { fuente: 'openalex', confianza: 0.9 }, anioOriginal: { fuente: 'openalex', confianza: 0.86 }, editorial: { fuente: 'lectura', confianza: 0.8 }, isbn: { fuente: 'lectura', confianza: 0.97 } } },
    secciones: [
      { titulo: 'Primera parte. Suplicio', nivel: 1, unidad: 11 }, { titulo: 'I. El cuerpo de los condenados', nivel: 2, unidad: 11 }, { titulo: 'II. La resonancia de los suplicios', nivel: 2, unidad: 44 },
      { titulo: 'Segunda parte. Castigo', nivel: 1, unidad: 85 }, { titulo: 'I. El castigo generalizado', nivel: 2, unidad: 85 }, { titulo: 'II. La benignidad de las penas', nivel: 2, unidad: 112 },
      { titulo: 'Tercera parte. Disciplina', nivel: 1, unidad: 141 }, { titulo: 'I. Los cuerpos dóciles', nivel: 2, unidad: 141 }, { titulo: 'II. Los medios del buen encauzamiento', nivel: 2, unidad: 181 }, { titulo: 'III. El panoptismo', nivel: 2, unidad: 207 },
      { titulo: 'Cuarta parte. Prisión', nivel: 1, unidad: 241 }, { titulo: 'I. Unas instituciones completas y austeras', nivel: 2, unidad: 241 }, { titulo: 'II. Ilegalismos y delincuencia', nivel: 2, unidad: 271 },
    ],
    banco: [
      'El castigo deja de ser un espectáculo público y se repliega hacia un ejercicio discreto, administrativo, casi invisible.',
      'Lo que cambia no es tanto la dureza de la pena como el objeto sobre el que se aplica: ya no el cuerpo que sufre, sino el alma que se corrige.',
      'La disciplina fabrica individuos: los distribuye en el espacio, los ordena en el tiempo y los compone en fuerzas útiles.',
      'El examen combina la mirada jerárquica y la sanción normalizadora; convierte a cada uno en un caso que se puede describir y comparar.',
      'El poder no se posee como una cosa: se ejerce, circula, pasa por los cuerpos y por los gestos más menudos.',
      'La prisión nace con su propio fracaso a cuestas, y ese fracaso la alimenta en lugar de abolirla.',
      'La norma sustituye a la ley como principio de clasificación: separa lo normal de lo anómalo con una aritmética de los cuerpos.',
      'Cada reforma del sistema penal promete humanizar el castigo y, al mismo tiempo, extiende el alcance de la vigilancia.',
      'El saber y el poder se implican mutuamente: no hay relación de poder sin un campo de saber que la acompañe.',
      'El empleo del tiempo, el horario, la cadencia del ejercicio: la disciplina descompone el gesto para recomponerlo eficaz.',
    ],
    fijos: {
      207: 'El panóptico es una máquina de disociar la pareja ver y ser visto: en el anillo periférico se es totalmente visto sin ver nunca; en la torre central se ve todo sin ser visto jamás.',
      208: 'De ahí el efecto principal del panóptico: inducir en el detenido un estado consciente y permanente de visibilidad que garantiza el funcionamiento automático del poder.',
      209: 'Quien está sometido a un campo de visibilidad, y lo sabe, reproduce por su cuenta las coacciones del poder; se convierte en el principio de su propio sometimiento.',
      11: 'La escena del suplicio público abre el libro como un contraste: en menos de un siglo, el castigo pasará del cadalso al reglamento.',
      264: 'La prisión no fracasa en reducir los delitos: produce delincuencia, un tipo de ilegalismo útil, vigilado y separable de los demás.',
    },
    bibliotecas: ['b-espacios'], creado: '2026-05-12T09:14:00Z', bytes: 18_400_000, mime: 'application/pdf',
  },
  {
    id: 'd-kristeva', tipo: 'pdf_escaneado', unidades: 282, romanas: 0, sinFolio: 6, dudosas: [118, 126],
    meta: { titulo: 'Poderes de la perversión', subtitulo: 'Ensayo sobre Louis-Ferdinand Céline', autores: [a('Julia', 'Kristeva')], anio: 1988, anioOriginal: 1980, editorial: 'Siglo XXI', lugar: 'México', idioma: 'es', tipoCSL: 'book',
      procedencia: { titulo: { fuente: 'lectura', confianza: 0.93 }, autores: { fuente: 'lectura', confianza: 0.94 }, anio: { fuente: 'crossref', confianza: 0.7 }, editorial: { fuente: 'lectura', confianza: 0.62 } } },
    secciones: [
      { titulo: 'I. Aproximación a la abyección', nivel: 1, unidad: 7 }, { titulo: 'Ni sujeto ni objeto', nivel: 2, unidad: 7 }, { titulo: 'El cadáver', nivel: 2, unidad: 15 },
      { titulo: 'II. De qué tener miedo', nivel: 1, unidad: 38 }, { titulo: 'III. De la suciedad a la mancha', nivel: 1, unidad: 82 }, { titulo: 'IV. Semiótica de la abominación bíblica', nivel: 1, unidad: 118 },
      { titulo: 'V. Ni amo ni esclavo', nivel: 1, unidad: 150 }, { titulo: 'VI. Céline: ni comediante ni mártir', nivel: 1, unidad: 182 }, { titulo: 'VII. Dolor y horror', nivel: 1, unidad: 210 },
    ],
    banco: [
      'Lo abyecto no es un objeto frente a mí: es lo que, rechazado, no deja de desafiar a su amo desde el borde.',
      'Lo que provoca la abyección no es la falta de limpieza o de salud, sino aquello que perturba una identidad, un sistema, un orden.',
      'El cadáver, visto sin Dios y fuera de la ciencia, es el colmo de la abyección: la muerte infestando la vida.',
      'El sujeto se constituye expulsando aquello que lo amenaza, pero lo expulsado nunca se va del todo.',
      'La literatura moderna explora ese borde en el que el lenguaje roza lo innombrable y lo convierte en estilo.',
      'El duelo por la madre arcaica deja en el sujeto una herida que la escritura intenta, sin éxito, suturar.',
      'La impureza no es una cualidad de las cosas sino un efecto de los límites que una cultura traza.',
      'El horror se dice con una lengua que se quiebra: elipsis, exclamaciones, puntos suspensivos.',
    ],
    fijos: {
      9: 'No es la falta de limpieza o de salud lo que vuelve abyecto algo, sino lo que perturba una identidad, un sistema, un orden; lo que no respeta los límites, los lugares, las reglas.',
      16: 'El cadáver es el colmo de la abyección: es la muerte que invade la vida, un borde que ha terminado por ocuparlo todo.',
      212: 'En el dolor y en el horror, la escritura se sitúa en el límite: no representa lo abyecto, lo atraviesa.',
    },
    bibliotecas: ['b-tfg'], creado: '2026-03-03T18:40:00Z', bytes: 96_200_000, mime: 'application/pdf',
  },
  {
    id: 'd-llanos', tipo: 'pdf', unidades: 24, sinFolio: 0,
    meta: { titulo: 'Emilia Llanos: las cartas como archivo del duelo', autores: [a('Marta', 'Ríos Abad')], anio: 2021, revista: 'Revista de Literatura', volumen: '83', numero: '166', paginas: '411-434', doi: '10.3989/revliteratura.2021.02.016', idioma: 'es', tipoCSL: 'article-journal',
      procedencia: { titulo: { fuente: 'crossref', confianza: 0.99 }, autores: { fuente: 'crossref', confianza: 0.99 }, doi: { fuente: 'pdf', confianza: 1 } } },
    secciones: [{ titulo: 'Introducción', nivel: 1, unidad: 1 }, { titulo: 'Una correspondencia interrumpida', nivel: 1, unidad: 5 }, { titulo: 'El duelo como forma', nivel: 1, unidad: 12 }, { titulo: 'Conclusiones', nivel: 1, unidad: 21 }],
    banco: [
      'Las cartas que Emilia Llanos conservó tras 1936 funcionan como un archivo íntimo que se resiste a la clausura del duelo.',
      'La escritura epistolar de Llanos alterna la confidencia con un pudor casi notarial.',
      'Conservar es también una forma de hablar: el archivo personal dice lo que la autora no publicó.',
      'La crítica ha leído a Llanos casi siempre desde Lorca; aquí se propone leerla desde su propia voz.',
      'El duelo no aparece como tema sino como forma: tachaduras, fechas repetidas, cartas sin enviar.',
    ],
    fijos: { 13: 'En las cartas posteriores a 1936 el duelo no se nombra: se inscribe en la forma, en las fechas que vuelven y en los sobres que nunca se enviaron.' },
    bibliotecas: ['b-tfg'], creado: '2026-03-04T11:02:00Z', bytes: 1_240_000, mime: 'application/pdf',
  },
  {
    id: 'd-deleuze', tipo: 'pdf', unidades: 522, romanas: 4, sinFolio: 2,
    meta: { titulo: 'Mil mesetas', subtitulo: 'Capitalismo y esquizofrenia', autores: [a('Gilles', 'Deleuze'), a('Félix', 'Guattari')], anio: 2004, anioOriginal: 1980, editorial: 'Pre-Textos', lugar: 'Valencia', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: '1. Introducción: Rizoma', nivel: 1, unidad: 15 }, { titulo: '6. 28 de noviembre de 1947. ¿Cómo hacerse un cuerpo sin órganos?', nivel: 1, unidad: 161 }, { titulo: '10. 1730. Devenir-intenso, devenir-animal, devenir-imperceptible', nivel: 1, unidad: 245 }, { titulo: '14. Lo liso y lo estriado', nivel: 1, unidad: 487 }],
    banco: [
      'Un rizoma no empieza ni acaba: siempre está en el medio, entre las cosas, como una hierba que crece por en medio.',
      'Cualquier punto de un rizoma puede conectarse con cualquier otro, a diferencia del árbol que fija un orden.',
      'Devenir no es imitar ni identificarse: es entrar en una zona de vecindad en la que ya no se distingue lo uno de lo otro.',
      'El espacio liso es el del nómada; el estriado, el del Estado que mide, reparte y cierra.',
      'Un agenciamiento compone cuerpos, enunciados y deseos en una misma máquina.',
      'El deseo no carece de nada: produce, conecta, se agencia.',
    ],
    fijos: { 16: 'Un rizoma no tiene principio ni fin, siempre está en el medio, entre las cosas; es alianza, únicamente alianza.' },
    bibliotecas: ['b-espacios'], creado: '2026-05-20T16:22:00Z', bytes: 31_000_000, mime: 'application/pdf',
  },
  {
    id: 'd-borges', tipo: 'epub', unidades: 96,
    meta: { titulo: 'Ficciones', autores: [a('Jorge Luis', 'Borges')], anio: 2011, anioOriginal: 1944, editorial: 'Debolsillo', lugar: 'Barcelona', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: 'Tlön, Uqbar, Orbis Tertius', nivel: 1, unidad: 1 }, { titulo: 'Pierre Menard, autor del Quijote', nivel: 1, unidad: 22 }, { titulo: 'La biblioteca de Babel', nivel: 1, unidad: 41 }, { titulo: 'El jardín de senderos que se bifurcan', nivel: 1, unidad: 55 }, { titulo: 'Funes el memorioso', nivel: 1, unidad: 72 }],
    banco: [
      'La biblioteca imaginada contiene todos los libros posibles y, por eso mismo, ninguno que pueda leerse con provecho.',
      'Un documento apócrifo, citado con todo el aparato de la erudición, acaba por modificar la realidad que pretendía describir.',
      'Recordarlo todo equivale a no poder pensar: pensar es olvidar diferencias, generalizar, abstraer.',
      'El mismo texto, escrito de nuevo en otra época, ya no dice lo mismo.',
      'El laberinto no está en el espacio sino en el tiempo, en las bifurcaciones que cada decisión abre.',
    ],
    fijos: { 43: 'La biblioteca es total: sus anaqueles registran todas las combinaciones posibles de los símbolos ortográficos, es decir, todo lo que es dable expresar.', 74: 'Funes no solo recordaba cada hoja de cada árbol, sino cada una de las veces que la había visto o imaginado.' },
    bibliotecas: [], creado: '2026-08-02T21:10:00Z', bytes: 820_000, mime: 'application/epub+zip',
  },
  {
    id: 'd-camus', tipo: 'fotos', unidades: 48, sinFolio: 0,
    meta: { titulo: 'El mito de Sísifo', autores: [a('Albert', 'Camus')], anio: 1995, anioOriginal: 1942, editorial: 'Alianza', lugar: 'Madrid', idioma: 'es', tipoCSL: 'book' },
    secciones: [{ titulo: 'Un razonamiento absurdo', nivel: 1, unidad: 1 }, { titulo: 'El mito de Sísifo', nivel: 1, unidad: 41 }],
    banco: [
      'Lo absurdo nace de la confrontación entre la llamada humana y el silencio irrazonable del mundo.',
      'No hay más que un problema filosófico verdaderamente serio, y es el de saber si la vida merece vivirse.',
      'La lucidez que debía ser su tormento consuma al mismo tiempo su victoria.',
      'Rebelión, libertad y pasión: tres consecuencias que se extraen del absurdo sin apelar a nada más.',
    ],
    fijos: { 46: 'La lucha por llegar a las cimas basta para llenar un corazón humano: hay que imaginarse a Sísifo dichoso.' },
    bibliotecas: [], creado: '2026-09-28T12:00:00Z', bytes: 64_000_000, mime: 'image/jpeg',
  },
  {
    id: 'd-serrat', tipo: 'audio', unidades: 52, duracion: 3125,
    meta: { titulo: 'Entrevista a Joan Manuel Serrat', subtitulo: 'Seminario de canción de autor, Universidad de La Laguna', autores: [a('Joan Manuel', 'Serrat')], editores: [a('Alba', 'Medina'), a('Isabel', 'Castells')], anio: 2026, idioma: 'es', tipoCSL: 'interview' },
    secciones: [{ titulo: 'Infancia en el Poble Sec', nivel: 1, unidad: 1 }, { titulo: 'Machado y Miguel Hernández', nivel: 1, unidad: 14 }, { titulo: 'La canción como poema', nivel: 1, unidad: 29 }, { titulo: 'Preguntas del público', nivel: 1, unidad: 43 }],
    hablantes: ['Isabel Castells', 'Joan Manuel Serrat'],
    banco: [
      'Musicar a Machado fue una manera de leerlo en voz alta para gente que nunca había abierto el libro.',
      'La canción tiene algo de poema que se escucha una sola vez y tiene que quedarse.',
      'Yo no elegía los poemas: ellos me elegían a mí cuando ya llevaban tiempo dando vueltas.',
      'El barrio me enseñó a mirar: la calle era una escuela de oficios y de palabras.',
      'Miguel Hernández escribe desde el cuerpo, desde el hambre y desde el amor; eso no se puede cantar en falso.',
      'Una canción se termina cuando deja de pedirte cambios, no cuando tú quieres.',
    ],
    fijos: { 15: 'Con Machado tuve la sensación de que el poema ya traía la música dentro y yo solo tenía que no estropearla.' },
    bibliotecas: ['b-clases'], creado: '2026-09-30T19:00:00Z', bytes: 48_000_000, mime: 'audio/mpeg',
  },
  {
    id: 'd-clase', tipo: 'video', unidades: 80, duracion: 4810,
    meta: { titulo: 'Teoría de la Literatura · Sesión 7: la abyección', autores: [a('Ana', 'Castellano')], anio: 2026, idioma: 'es', tipoCSL: 'speech', editorial: 'Universidad de La Laguna' },
    secciones: [{ titulo: 'Repaso: sujeto y lenguaje', nivel: 1, unidad: 1 }, { titulo: 'Kristeva y lo abyecto', nivel: 1, unidad: 12 }, { titulo: 'Lecturas: Llanos y la carta', nivel: 1, unidad: 41 }, { titulo: 'Debate', nivel: 1, unidad: 66 }],
    hablantes: ['Ana Castellano', 'Estudiante'],
    banco: [
      'Fijaos en que la abyección no es un tema: es una posición del sujeto frente a sus propios límites.',
      'Cuando leemos las cartas, la pregunta no es qué dicen sino qué conservan y por qué.',
      'Kristeva toma de Lacan la idea de un sujeto en proceso, pero la lleva al cuerpo.',
      'La pizarra de hoy tiene tres columnas: lo expulsado, el borde y la escritura.',
      'Un archivo personal es siempre un relato sobre la pérdida, aunque nadie lo escriba como tal.',
    ],
    fijos: { 13: 'Lo abyecto, para Kristeva, no es lo sucio: es lo que pone en crisis el límite entre el dentro y el fuera del sujeto.' },
    bibliotecas: ['b-clases', 'b-tfg'], creado: '2026-10-01T08:30:00Z', bytes: 1_400_000_000, mime: 'video/mp4',
  },
  {
    id: 'd-heterotopias', tipo: 'presentacion', unidades: 24,
    meta: { titulo: 'Espacios otros: heterotopías', autores: [a('José Luis', 'Saorín Ferrer')], anio: 2026, idioma: 'es', tipoCSL: 'speech' },
    secciones: [{ titulo: 'Qué es una heterotopía', nivel: 1, unidad: 2 }, { titulo: 'Seis principios', nivel: 1, unidad: 6 }, { titulo: 'La casa vacía como anti-archivo', nivel: 1, unidad: 16 }],
    banco: [
      'Heterotopía: un lugar real que funciona como contraemplazamiento de todos los demás.',
      'El cementerio, el jardín, el museo, la biblioteca: espacios que acumulan tiempo.',
      'La casa vacía guarda lo que nadie quiso archivar: un anti-archivo.',
      'Seis principios: universalidad, función variable, yuxtaposición, heterocronía, apertura y cierre, función respecto al resto del espacio.',
    ],
    fijos: { 17: 'La casa vacía funciona como anti-archivo: conserva por abandono lo que la institución nunca habría catalogado.' },
    bibliotecas: ['b-espacios'], creado: '2026-06-01T10:00:00Z', bytes: 12_800_000, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  {
    id: 'd-cartas', tipo: 'hoja', unidades: 12,
    meta: { titulo: 'Inventario de cartas de Emilia Llanos (1915-1936)', autores: [a('José Luis', 'Saorín Ferrer')], anio: 2026, idioma: 'es', tipoCSL: 'dataset' },
    secciones: [{ titulo: 'Cartas', nivel: 1, unidad: 1 }],
    banco: [
      '| fecha | destinatario | lugar | notas |\n|---|---|---|---|\n| 1921-03-12 | F. G. L. | Granada | menciona el carmen |\n| 1924-07-02 | F. G. L. | Granada | sin sobre |',
      '| fecha | destinatario | lugar | notas |\n|---|---|---|---|\n| 1936-09-01 | (sin enviar) | Granada | tachaduras |\n| 1936-11-20 | (sin enviar) | Granada | fecha repetida |',
    ],
    fijos: {},
    bibliotecas: ['b-tfg'], creado: '2026-04-10T10:00:00Z', bytes: 48_000, mime: 'text/csv',
  },
  {
    id: 'd-web', tipo: 'web', unidades: 18,
    meta: { titulo: 'La cárcel como archivo: leer a Foucault hoy', autores: [a('Lucía', 'Benítez')], anio: 2025, revista: 'Revista de Occidente (blog)', url: 'https://ejemplo.org/la-carcel-como-archivo', idioma: 'es', tipoCSL: 'post-weblog' },
    secciones: [{ titulo: 'La cárcel como archivo', nivel: 1, unidad: 1 }, { titulo: 'Vigilancia de plataforma', nivel: 2, unidad: 9 }],
    banco: [
      'Releer el panóptico hoy obliga a pensar en plataformas que vigilan sin torre y sin guardia.',
      'El expediente penitenciario fue el primer gran archivo de individuos; el perfil digital es su heredero.',
      'La visibilidad ya no se impone: se ofrece voluntariamente a cambio de reconocimiento.',
    ],
    fijos: { 10: 'La vigilancia de plataforma invierte el panóptico: ya no hace falta una torre, porque cada uno publica su propia celda.' },
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
      const offset = d.id === 'd-llanos' ? 410 : d.id === 'd-camus' ? 14 : 0;
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
