/**
 * El texto de la portada, en castellano y en inglés. Los párrafos admiten un
 * HTML mínimo (<em>, <strong class="senalada">). La versión inglesa no es una
 * traducción palabra por palabra: dice lo mismo como lo diría alguien que
 * escribe en inglés.
 */
import type { Lengua } from './dibujo/boceto';

export interface Capitulo {
  id: string;
  /** «Capítulo primero,» */
  numero: string;
  /** «que trata de…» */
  rubrica: string;
  parrafos: string[];
  /** Nota al margen, como una glosa. */
  glosa?: string;
  /** Las primeras palabras del capítulo siguiente: el reclamo al pie del folio. */
  reclamo?: string;
  folio: string;
}

export interface Cosa {
  /** Lo que hace, en pocas palabras. */
  que: string;
  /** Cómo, en una frase. */
  como: string;
  /** El dato que susurra la monoespaciada. */
  dato: string;
}

export interface Textos {
  lengua: Lengua;
  html: string;
  ruta: string;
  otra: { ruta: string; nombre: string; etiqueta: string; hreflang: string };
  titulo: string;
  descripcion: string;
  saltar: string;
  nav: { ensayo: string; entrar: string; inicio: string };
  heroe: { rotulo: string; titular: string; entradilla: string; empezar: string; probar: string; leer: string; nota: string };
  capitulos: Capitulo[];
  especimen: { cita: string; fuente: string; folio: string; nota: string; minuto: string };
  hace: { numero: string; rubrica: string; folio: string; cosas: Cosa[] };
  quien: Capitulo;
  colofon: { titulo: string; texto: string; firma: string; empezar: string; probar: string; pie: string };
}

const es: Textos = {
  lengua: 'es',
  html: 'es',
  ruta: '/acerca',
  otra: { ruta: '/en', nombre: 'English', etiqueta: 'Read this page in English', hreflang: 'en' },
  titulo: 'Scholaris, una mano que señala la página',
  descripcion:
    'Scholaris lee tus libros, artículos, apuntes y entrevistas y, cuando le preguntas, no contesta por ti: te señala el pasaje, la página impresa o el minuto exacto. Nunca inventa una cita.',
  saltar: 'Saltar al texto',
  nav: { ensayo: 'Leer el porqué', entrar: 'Entrar', inicio: 'Scholaris, portada' },
  heroe: {
    rotulo: 'Scholaris · cuaderno de una biblioteca',
    titular: 'Una mano que señala la página y luego se aparta.',
    entradilla:
      'Scholaris lee tus libros, tus artículos, tus apuntes y tus entrevistas, y cuando le preguntas algo no te devuelve una opinión: te señala el pasaje, la página impresa o el minuto exacto en que se dijo, para que el pensamiento lo sigas poniendo tú.',
    empezar: 'Empezar',
    probar: 'Probar sin cuenta',
    leer: 'O leer antes por qué existe',
    nota: 'sin inventar ni una cita',
  },
  capitulos: [
    {
      id: 'abundancia',
      numero: 'Capítulo primero,',
      rubrica: 'que trata de la abundancia y de lo poco que en ella se encuentra',
      folio: 'fol. 2r',
      parrafos: [
        'En algún disco duro, dentro de una carpeta que se llamaba «leer» y que luego se llamó «leer de verdad» y después «tesis_final_2», está el párrafo que necesitas. Lo subrayaste una tarde. Sabes que estaba en una página par, más o menos hacia el final de un capítulo, y que al lado había una nota tuya a lápiz que decía algo parecido a «¡sí!». No lo encuentras.',
        'Nunca hubo tanto que leer ni fue tan fácil guardarlo, y sin embargo la experiencia más común de quien estudia sigue siendo esa: saber que algo existe y no poder llegar hasta ello. Tenemos bibliotecas que caben en un bolsillo y que se comportan como aquella otra, interminable, de galerías hexagonales, donde están todos los libros posibles y ninguno se deja abrir por la página justa. La abundancia no ha resuelto el problema de encontrar; lo ha agrandado hasta volverlo invisible, porque ahora la culpa parece nuestra.',
      ],
      glosa: 'Cf. J. L. Borges, «La biblioteca de Babel», en <em>Ficciones</em> (1944). Sin número de página: esta portada tampoco cita lo que no ha comprobado.',
      reclamo: 'Un archivo',
    },
    {
      id: 'archivo',
      numero: 'Capítulo segundo,',
      rubrica: 'que trata del archivo y de quién decide lo que se puede decir',
      folio: 'fol. 2v',
      parrafos: [
        'Un archivo nunca es inocente. Lo que se guarda, el orden en que se guarda y lo que se deja fuera deciden, antes que nadie, lo que luego se podrá pensar; durante siglos lo decidieron los copistas, los bibliotecarios y los índices, y hoy lo deciden, cada vez más, unas máquinas que no enseñan sus estanterías. <strong class="senalada">Cuando no sabes de dónde sale lo que lees, no puedes discutirlo, y lo que no se puede discutir acaba mandando.</strong>',
        'Por eso nos importa tanto la procedencia, que no es un adorno académico ni una nota al pie que nadie mira, sino lo mínimo que necesita una lectura para ser tuya: saber quién lo dijo, dónde, en qué edición, en qué página y con qué grado de certeza, y poder ir a comprobarlo.',
      ],
      glosa: 'Cf. M. Foucault, <em>La arqueología del saber</em> (1969), «El <em>a priori</em> histórico y el archivo».',
      reclamo: 'El buscador',
    },
    {
      id: 'maquinas',
      numero: 'Capítulo tercero,',
      rubrica: 'que trata de las máquinas que contestan',
      folio: 'fol. 3r',
      parrafos: [
        'El buscador te devuelve diez enlaces y una página de anuncios; el asistente conversacional, una respuesta redonda, segura de sí misma, sin un solo folio. El primero te deja en la puerta de un edificio ajeno; el segundo te cuenta lo que hay dentro sin dejarte entrar y, a veces, se inventa los libros, los autores y las páginas con la misma voz tranquila con la que acierta.',
        'Los dos aplanan. Convierten la diferencia entre un texto y otro —entre una edición de 1925 y una traducción de 1970, entre lo que alguien dijo y lo que se dice que dijo— en una superficie lisa donde todo pesa lo mismo. Y los dos, sin quererlo, te quitan el trabajo que más te importaba hacer: leer el pasaje, desconfiar de él, ponerlo al lado de otro y pensar.',
      ],
      reclamo: 'En los márgenes',
    },
    {
      id: 'mano',
      numero: 'Capítulo cuarto,',
      rubrica: 'que trata de la mano que señala',
      folio: 'fol. 3v',
      parrafos: [
        'En los márgenes de los libros antiguos aparece una y otra vez una manita con el índice extendido. Los paleógrafos la llaman manícula, y servía exactamente para eso: para decirle a un lector futuro «mira aquí», sin decirle qué tenía que pensar de lo que iba a ver.',
        'Scholaris quiere ser esa mano. Cuando le preguntas algo, te devuelve el pasaje, el libro y la página impresa —la de verdad, la que pondrías en una nota al pie— o el minuto exacto de la entrevista en que alguien lo dijo. Si no lo encuentra, lo dice. <strong class="senalada">No inventa citas:</strong> cada una se comprueba contra el texto que tú le diste antes de enseñártela, y cada dato lleva su procedencia a la vista, de dónde salió, con qué confianza y quién lo corrigió.',
      ],
      reclamo: 'Una biblioteca',
    },
    {
      id: 'constelaciones',
      numero: 'Capítulo quinto,',
      rubrica: 'que trata de cómo una biblioteca ordenada empieza a pensar contigo',
      folio: 'fol. 4r',
      parrafos: [
        'Una biblioteca bien leída deja ver relaciones que nadie había anotado: dos autores que no se citan y hablan de lo mismo, un concepto que cambia de nombre al cruzar una frontera, una pregunta que vuelve cada cuarenta años con otra ropa. Scholaris lee toda tu biblioteca a la vez y dibuja esas relaciones (personas, obras, lugares, conceptos, fechas) como un mapa del cielo, con constelaciones que no estaban en ningún libro y que solo aparecen cuando los libros se ponen juntos.',
        'Las líneas las traza la máquina, siempre ancladas a la página de la que salen; qué significan, cuáles importan y adónde llevan, eso lo decides tú. Queremos una estructura que multiplique el pensamiento en lugar de cerrarlo, que funcione menos como un árbol, con su tronco y su jerarquía, y más como un rizoma, donde cualquier punto puede conectarse con cualquier otro y cada conexión es el principio de una idea que todavía no existe.',
      ],
      glosa: 'Cf. G. Deleuze y F. Guattari, <em>Mil mesetas</em> (1980), «Introducción: rizoma».',
      reclamo: 'No escribirá',
    },
    {
      id: 'nunca',
      numero: 'Capítulo sexto,',
      rubrica: 'que trata de lo que Scholaris no hará nunca',
      folio: 'fol. 4v',
      parrafos: [
        'No escribirá tu ensayo. No resumirá un libro para que no tengas que leerlo. No decidirá por ti qué cita es la buena ni qué autor tiene razón. Pensar, juzgar y escribir siguen siendo tuyos, y lo son por una cuestión de principio: un pensamiento que no ha pasado por el cuerpo de quien lo firma se parece demasiado a un rumor.',
      ],
      reclamo: 'Cualquier cosa',
    },
  ],
  especimen: {
    cita: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero…',
    fuente: 'Miguel de Cervantes, <em>El ingenioso hidalgo don Quijote de la Mancha</em>, Madrid, Juan de la Cuesta, 1605',
    folio: 'fol. 1r',
    nota: 'el folio de la edición que tienes delante, no el número que pone el visor',
    minuto: 'Y si lo que tienes es una grabación, el minuto 12:04, palabra a palabra.',
  },
  hace: {
    numero: 'Capítulo séptimo,',
    rubrica: 'que trata de lo que hace, contado deprisa',
    folio: 'fol. 5r',
    cosas: [
      { que: 'Cualquier cosa entra', como: 'PDF digitales o escaneados, fotos de páginas, EPUB, Word, presentaciones, audio, vídeo y enlaces: todo se vuelve una biblioteca que se puede buscar y citar.', dato: 'PDF · EPUB · DOCX · MP3 · MP4' },
      { que: 'La página impresa', como: 'El folio de verdad, el que pondrías en la nota, aunque el libro empiece en romanos o la paginación salte.', dato: 'p. 145 · xiv · fol. 1r' },
      { que: 'El minuto exacto', como: 'Entrevistas, clases y grabaciones transcritas palabra a palabra; cada cita salta a su segundo.', dato: '12:04' },
      { que: 'Preguntas a toda la biblioteca', como: 'En cualquier lengua, también en castellano antiguo o en latín, con respuestas cuyas citas se comprueban una a una antes de llegar a ti.', dato: 'citas verificadas' },
      { que: 'Tus citas, en tu estilo', como: 'APA, MLA, Chicago o el que pida tu revista; BibTeX y RIS; y una autocita que repasa tu borrador y propone cada referencia con su página.', dato: 'CSL · BibTeX · RIS' },
      { que: 'En tu ordenador o en la nube', como: 'Se instala en casa, sin cuenta y con tu biblioteca en tu disco (la lectura usa tus propias claves de IA o tu propio servidor de inferencia), o se usa en la nube desde cualquier sitio.', dato: 'local · nube' },
      { que: 'Un formato abierto y tuyo', como: 'Tu biblioteca entera, ya leída, en un archivo SPDF abierto que te llevas cuando quieras.', dato: '.spdf' },
    ],
  },
  quien: {
    id: 'quien',
    numero: 'Capítulo octavo y último,',
    rubrica: 'que trata de para quién es',
    folio: 'fol. 5v',
    parrafos: [
      'Para quien lee para escribir. Para la doctoranda con trescientos PDF y una directora que pide la página; para el profesor que prepara clase con veinte años de subrayados; para la periodista que vuelve a una entrevista de hace dos años buscando una frase; para el traductor, la archivera, el estudiante de primero que todavía no sabe que va a necesitarlo, y para cualquiera que haya dicho alguna vez «lo leí en algún sitio».',
    ],
  },
  colofon: {
    titulo: 'Aquí se acaba la portada',
    texto:
      'Scholaris lo hace José Luis Saorín Ferrer, filólogo, programador y artista, en Santa Cruz de Tenerife. Los dibujos de esta página están escritos trazo a trazo, como quien calca, y un programa les pone el pulso: tiemblan siempre igual, pero tiemblan.',
    firma: 'Santa Cruz de Tenerife, otoño de 2026',
    empezar: 'Empezar',
    probar: 'Probar sin cuenta',
    pie: 'Scholaris',
  },
};

const en: Textos = {
  lengua: 'en',
  html: 'en',
  ruta: '/en',
  otra: { ruta: '/acerca', nombre: 'Español', etiqueta: 'Leer esta página en español', hreflang: 'es' },
  titulo: 'Scholaris, a hand that points to the page',
  descripcion:
    'Scholaris reads your books, papers, notes and interviews and, when you ask, doesn’t answer for you: it points to the passage, the printed page or the exact minute. It never invents a citation.',
  saltar: 'Skip to the text',
  nav: { ensayo: 'Read the why', entrar: 'Sign in', inicio: 'Scholaris, home' },
  heroe: {
    rotulo: 'Scholaris · a library’s notebook',
    titular: 'A hand that points to the page, then steps aside.',
    entradilla:
      'Scholaris reads your books, your papers, your notes and your interviews, and when you ask it something it doesn’t hand you an opinion. It points to the passage, the printed page, the exact minute something was said, so that the thinking stays yours.',
    empezar: 'Start',
    probar: 'Try it without an account',
    leer: 'Or first read why it exists',
    nota: 'without inventing a single citation',
  },
  capitulos: [
    {
      id: 'abundancia',
      numero: 'Chapter the first,',
      rubrica: 'which treats of abundance, and of how little is found in it',
      folio: 'fol. 2r',
      parrafos: [
        'Every student has a folder called “to read”, which later became “to read, really” and later still “thesis_final_2”, and somewhere inside it is the paragraph you need. You underlined it one afternoon. You know it was on a left-hand page, somewhere near the end of a chapter, with a pencilled note of yours beside it that said something like “yes!”. You cannot find it.',
        'There has never been so much to read, nor has keeping it ever been so easy, and yet the commonest experience of anyone who studies is still this one: knowing that something exists and being unable to reach it. Our libraries fit in a pocket and behave like that other one, the endless library of hexagonal galleries, which holds every possible book and opens none of them at the right page. Abundance did not solve the problem of finding; it enlarged it until it became invisible, because now the fault seems to be ours.',
      ],
      glosa: 'Cf. J. L. Borges, “The Library of Babel”, in <em>Ficciones</em> (1944). No page number: this page doesn’t cite what it hasn’t checked either.',
      reclamo: 'An archive',
    },
    {
      id: 'archivo',
      numero: 'Chapter the second,',
      rubrica: 'which treats of the archive, and of who decides what can be said',
      folio: 'fol. 2v',
      parrafos: [
        'An archive is never innocent. What is kept, the order in which it is kept and what is left out decide, before anyone else does, what can later be thought. For centuries copyists, librarians and indexes made that decision; today it is made, more and more, by machines that do not show their shelves. <strong class="senalada">When you cannot tell where what you read comes from, you cannot argue with it, and whatever cannot be argued with ends up in charge.</strong>',
        'That is why provenance matters so much to us. It is no academic ornament, no footnote that nobody reads, but the least a reading needs in order to be yours: knowing who said it, where, in which edition, on which page and with what degree of certainty, and being able to go and check.',
      ],
      glosa: 'Cf. M. Foucault, <em>The Archaeology of Knowledge</em> (1969), “The historical <em>a priori</em> and the archive”.',
      reclamo: 'A search',
    },
    {
      id: 'maquinas',
      numero: 'Chapter the third,',
      rubrica: 'which treats of the machines that answer',
      folio: 'fol. 3r',
      parrafos: [
        'A search engine gives you ten links and a page of advertisements; a chatbot gives you a rounded answer, sure of itself, without a single page number. The first leaves you at the door of somebody else’s building; the second tells you what is inside without letting you in and, now and then, invents the books, the authors and the pages in the same calm voice it uses when it is right.',
        'Both of them flatten. They turn the difference between one text and another (between a 1925 edition and a 1970 translation, between what someone said and what someone is said to have said) into a smooth surface where everything weighs the same. And both, without meaning to, take away the work you most wanted to do yourself: read the passage, distrust it, set it beside another one, and think.',
      ],
      reclamo: 'In the margins',
    },
    {
      id: 'mano',
      numero: 'Chapter the fourth,',
      rubrica: 'which treats of the pointing hand',
      folio: 'fol. 3v',
      parrafos: [
        'In the margins of old books a small hand with an outstretched finger appears again and again. Palaeographers call it a manicule, and it was for exactly this: to tell some future reader “look here”, without telling them what to think of what they were about to see.',
        'Scholaris wants to be that hand. Ask it something and it gives you back the passage, the book and the printed page (the real one, the one you would put in a footnote) or the exact minute of the interview in which someone said it. If it cannot find it, it says so. <strong class="senalada">It does not invent citations:</strong> each one is checked against the text you gave it before you ever see it, and every piece of data carries its provenance in plain view, where it came from, how sure we are of it and who corrected it.',
      ],
      reclamo: 'A well-read',
    },
    {
      id: 'constelaciones',
      numero: 'Chapter the fifth,',
      rubrica: 'which treats of how an ordered library begins to think with you',
      folio: 'fol. 4r',
      parrafos: [
        'A well-read library reveals relations nobody had written down: two authors who never cite each other and talk about the same thing, a concept that changes its name when it crosses a border, a question that comes back every forty years in different clothes. Scholaris reads your whole library at once and draws those relations (people, works, places, concepts, dates) like a chart of the sky, with constellations that were in no single book and only appear when the books are put together.',
        'The machine draws the lines, always anchored to the page they come from; what they mean, which of them matter and where they lead is for you to decide. We want a structure that multiplies thought instead of closing it, one that works less like a tree, with its trunk and its hierarchy, and more like a rhizome, where any point can connect to any other and every connection is the beginning of an idea that does not exist yet.',
      ],
      glosa: 'Cf. G. Deleuze and F. Guattari, <em>A Thousand Plateaus</em> (1980), “Introduction: Rhizome”.',
      reclamo: 'It will not',
    },
    {
      id: 'nunca',
      numero: 'Chapter the sixth,',
      rubrica: 'which treats of what Scholaris will never do',
      folio: 'fol. 4v',
      parrafos: [
        'It will not write your essay. It will not summarise a book so that you can skip it. It will not decide for you which quotation is the good one or which author is right. Thinking, judging and writing remain yours, and they do as a matter of principle: a thought that has not passed through the body of the person who signs it is too much like a rumour.',
      ],
      reclamo: 'Anything',
    },
  ],
  especimen: {
    cita: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero…',
    fuente: 'Miguel de Cervantes, <em>El ingenioso hidalgo don Quijote de la Mancha</em>, Madrid, Juan de la Cuesta, 1605',
    folio: 'fol. 1r',
    nota: 'the folio of the edition in front of you, not the number your viewer shows',
    minuto: 'And if what you have is a recording, minute 12:04, word for word.',
  },
  hace: {
    numero: 'Chapter the seventh,',
    rubrica: 'which treats of what it does, told quickly',
    folio: 'fol. 5r',
    cosas: [
      { que: 'Anything goes in', como: 'Digital or scanned PDFs, photos of pages, EPUB, Word, slides, audio, video and links: all of it becomes a library you can search and cite.', dato: 'PDF · EPUB · DOCX · MP3 · MP4' },
      { que: 'The printed page', como: 'The real folio, the one you would put in a footnote, even when the book starts in roman numerals or the pagination jumps.', dato: 'p. 145 · xiv · fol. 1r' },
      { que: 'The exact minute', como: 'Interviews, lectures and recordings transcribed word for word; every citation jumps to its second.', dato: '12:04' },
      { que: 'Questions to the whole library', como: 'In any language, Old Spanish and Latin included, with answers whose citations are checked one by one before they reach you.', dato: 'verified citations' },
      { que: 'Your citations, your style', como: 'APA, MLA, Chicago or whatever your journal asks for; BibTeX and RIS; and an autocite that reads your draft and proposes each reference with its page.', dato: 'CSL · BibTeX · RIS' },
      { que: 'On your computer or in the cloud', como: 'Install it at home, with no account and your library on your own disk (reading uses your own AI keys or your own inference server), or use it in the cloud from anywhere.', dato: 'local · cloud' },
      { que: 'An open format that is yours', como: 'Your whole library, already read, in an open SPDF file you can take with you whenever you like.', dato: '.spdf' },
    ],
  },
  quien: {
    id: 'quien',
    numero: 'Chapter the eighth and last,',
    rubrica: 'which treats of whom it is for',
    folio: 'fol. 5v',
    parrafos: [
      'For those who read in order to write. For the doctoral student with three hundred PDFs and a supervisor who wants the page number; for the lecturer preparing a class with twenty years of underlining; for the journalist going back to a two-year-old interview in search of one sentence; for the translator, the archivist, the first-year student who doesn’t yet know they will need it, and for anyone who has ever said “I read it somewhere”.',
    ],
  },
  colofon: {
    titulo: 'Here ends the front page',
    texto:
      'Scholaris is made by José Luis Saorín Ferrer, philologist, programmer and artist, in Santa Cruz de Tenerife. The drawings on this page are written stroke by stroke, as if traced, and a program gives them a pulse: they always tremble the same way, but they tremble.',
    firma: 'Santa Cruz de Tenerife, autumn 2026',
    empezar: 'Start',
    probar: 'Try it without an account',
    pie: 'Scholaris',
  },
};

export const TEXTOS: Record<Lengua, Textos> = { es, en };
