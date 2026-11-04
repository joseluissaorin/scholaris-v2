/**
 * Dos obras INVENTADAS para enseñar la comprensión en la demostración: un
 * cuento, «Las tardes del Mirlo», y la película que lo adapta, «Arena en los
 * bolsillos». Autores, intérpretes, editorial, textos, diálogos y planos son
 * de la demo, escritos para ella: no existen ni copian ninguna obra real. Son la
 * excepción al corpus de dominio público de `corpus.ts`, porque una adaptación
 * entre medios con la que enseñar escenas, planos y alineaciones no la hay de
 * dominio público con película.
 *
 * Aquí está el material (páginas, diálogos y el découpage con quién está en
 * cuadro y dónde), y en `comprension.ts`, lo que la comprensión saca de él.
 */
import type { Region } from '@scholaris/nucleo';
import type { DocDemo } from './corpus';

const a = (nombre: string, apellidos: string) => ({ nombre, apellidos });

export const ID_CUENTO = 'd-mirlo';
export const ID_PELICULA = 'd-arena';
export const BIBLIOTECA_INVENTADA = { id: 'b-adaptacion', nombre: 'Del cuento a la película', descripcion: 'Un cuento y la película que lo adapta (obras inventadas para la demostración).', color: 'rojo', creada: '2026-10-20T10:00:00Z' };

// ---------------------------------------------------------------------------
// El cuento: doce páginas escaneadas, en cuatro partes
// ---------------------------------------------------------------------------

const PAGINAS_CUENTO: string[] = [
  `La primera vez que vi a Ernesto Valdivia fue en la terraza de El Mirlo, un jueves de octubre en que el viento del muelle levantaba las servilletas de papel. Yo tenía diecinueve años, un examen de Resistencia de Materiales al día siguiente y la costumbre de estudiar donde nadie me conociera. Él ocupaba la mesa del rincón, la que daba al puerto, con un libro abierto boca abajo y una taza de té que removía sin prisa, como si el azúcar fuera a contarle algo.

Don Julián, el dueño, le llevó la canela en un platito aparte. Me fijé porque nadie en el barrio pedía té, y menos con canela. Ernesto levantó la vista, me miró los apuntes y sonrió con media boca.`,
  `—Las vigas no se caen por falta de cálculo —dijo—, se caen por falta de paciencia.

No supe qué contestar. Pensé que era uno de esos viejos que hablan con cualquiera y bajé la cabeza hacia las fórmulas. Pero él siguió removiendo el té y, al cabo de un rato, dejó sobre mi mesa el libro que leía. Era un tomo delgado, de tapas azules, con un título que no conocía: Cuaderno de bajamar, de Celestino Arráiz.

—Léalo en voz baja —me pidió—. Los poemas de Arráiz se asustan con el ruido.

Lo guardé por educación. Esa noche, en lugar de repasar los momentos de inercia, leí el cuaderno entero. Al día siguiente suspendí el examen y volví a El Mirlo.`,
  `Ernesto estaba en la misma mesa, como si no se hubiera movido en veinticuatro horas. Le devolví el libro y le dije, sin mucha convicción, que me había gustado.

—Mentira —contestó—, le ha gustado mucho, y eso le preocupa.

Tenía razón, y me molestó que la tuviera. Pidió otro té y uno para mí, sin preguntarme. Me contó que tenía una librería de viejo en la calle Real, dos puertas más arriba de la ferretería, y que si quería más libros como aquel, allí los encontraría.

—No cobro a los que leen en voz baja —añadió—. A los otros, el doble.

Me reí por primera vez aquella semana. Cuando me levanté para irme, Don Julián me miró con una cara que entonces no supe leer.`,
  `La librería olía a papel húmedo y a la canela del té, que Ernesto preparaba en un hornillo detrás del mostrador. Las estanterías llegaban hasta el techo y no seguían ningún orden que yo pudiera entender: los poetas junto a los manuales de navegación, las novelas rusas encima de los almanaques.

—El orden alfabético es para los que ya saben lo que buscan —me explicó—. Aquí se viene a encontrar lo que no se busca.

Me llevó a la trastienda, un cuarto sin ventanas donde guardaba los libros que no vendía. Allí, entre dos pilas de revistas, había una butaca de mimbre y una mesa camilla con un brasero apagado.`,
  `Sobre la mesa, al alcance de la mano, estaba el reloj de arena. Era de madera oscura y vidrio soplado, con la arena de un color rosado que nunca he vuelto a ver. Ernesto le daba la vuelta cada vez que empezábamos a hablar de algo importante, y cuando la arena se acababa, cambiaba de tema.

—Media hora exacta —me dijo la primera tarde—. Ninguna conversación seria debería durar más.

Le pregunté de dónde lo había sacado. Me contestó que se lo había regalado alguien que ya no estaba en la isla, y le dio la vuelta antes de que yo pudiera preguntar quién. Entendí que esa media hora no era para hablar de eso.`,
  `Durante semanas fui a la librería todas las tardes que podía. Mis notas mejoraron, quizá porque estudiaba menos y entendía más, y empecé a leer en voz baja incluso los apuntes.

En el barrio, en cambio, empezaron a hablar. Mi amigo Rafa me paró un día a la salida de la facultad y me dijo, con la voz que se pone para las malas noticias:

—Tomás, no te conviene que te vean tanto con el librero.

—¿Por qué? —le pregunté.

—Porque la gente dice cosas —respondió, y no quiso decir cuáles.

No se lo conté a Ernesto. Pero aquella tarde, cuando él le dio la vuelta al reloj, yo miré la arena en lugar de mirarlo a él.`,
  `En noviembre llegaron las lluvias. Una tarde la tormenta nos sorprendió en la trastienda y la luz se fue con el primer trueno. Ernesto encendió una vela y no le dio la vuelta al reloj.

—Hoy no hace falta —dijo—. La lluvia ya cuenta el tiempo por nosotros.

Escuchamos el agua en el tejado de uralita durante un rato largo. Luego, sin que yo le preguntara nada, empezó a hablar de su juventud.`,
  `Me contó que a mi edad había querido ser marino, que se había embarcado en un mercante con destino a Southampton y que, al tercer día de travesía, había descubierto que se mareaba hasta en los sueños. Me contó que en el puerto de vuelta lo esperaba una persona a la que nunca nombró, y que esa persona le había enseñado a leer en voz baja.

—Era la única manera de leer juntos sin que nos oyeran —dijo, y se quedó callado.

La vela se consumía. Yo no me atreví a preguntar nada más. Cuando volvió la luz, Ernesto se levantó, puso agua a hervir y siguió hablando de Arráiz como si no hubiera dicho nada.`,
  `Después de aquella tarde, los jueves se convirtieron en nuestros. Cada jueves Ernesto me prestaba un libro y cada jueves yo le devolvía el de la semana anterior, con un papelito entre las páginas que más me habían gustado. Él los leía en silencio, asentía o negaba con la cabeza y guardaba los papelitos en una lata de galletas.

Así leí a los rusos, a los poetas del exilio, a un tal Arráiz que nadie más parecía conocer. Así aprendí que un libro prestado pesa más que uno comprado, porque hay que devolverlo.

Rafa dejó de saludarme. Don Julián seguía sirviéndome el té, pero ya no me traía la canela.`,
  `La noticia llegó en febrero, en un sobre con membrete del ayuntamiento que Ernesto dejó abierto sobre el mostrador para que yo lo leyera. El local se derribaba en primavera; había un proyecto de aparcamiento para el muelle nuevo.

—No es por el aparcamiento —me dijo, y no quiso explicar por qué era.

Le ofrecí ayuda para buscar otro local. Él negó con la cabeza. Iba a irse de la isla, a casa de una hermana en la península, y los libros se quedarían donde estaban, para que los derribaran con las paredes.

—Los libros no se mudan —dijo—. Se regalan o se pierden.`,
  `Pasé las últimas semanas sacando libros a escondidas, en la mochila de la facultad, de tres en tres. Ernesto hacía como que no me veía. Algunas tardes ni siquiera hablábamos: yo llenaba la mochila y él leía en la butaca de mimbre, junto al reloj, sin darle la vuelta.

El día de su marcha bajé al muelle. Llovía otra vez, una lluvia fina que no mojaba del todo. Ernesto llevaba una sola maleta y un paquete envuelto en papel de estraza.

—Para usted —me dijo—. Así no tendrá que pedirle a nadie media hora.`,
  `Abrí el paquete cuando el barco ya era una mancha en la bocana. Era el reloj de arena, con la arena rosada quieta en la mitad de abajo.

Volví a El Mirlo y me senté en la mesa del rincón, la que daba al puerto. Don Julián me trajo un té sin que se lo pidiera, y esta vez, después de dudar un momento, trajo también la canela.

Puse el reloj sobre la mesa. No le di la vuelta. Me pareció que, mientras la arena siguiera abajo, la conversación con Ernesto no se habría terminado del todo.`,
];

export const CUENTO: DocDemo = {
  id: ID_CUENTO, tipo: 'pdf_escaneado', unidades: PAGINAS_CUENTO.length, sinFolio: 0, romanas: 0,
  meta: {
    titulo: 'Las tardes del Mirlo', autores: [a('Adela', 'Sorní Ibarra')], anio: 1990, anioOriginal: 1988, editorial: 'Ediciones del Ancla', lugar: 'Santa Cruz de la Palma', idioma: 'es', tipoCSL: 'chapter',
    contenedor: 'Cuentos de bajamar',
    procedencia: { titulo: { fuente: 'lectura', confianza: 0.95 }, autores: { fuente: 'lectura', confianza: 0.95 }, anio: { fuente: 'lectura', confianza: 0.9 } },
  },
  secciones: [{ titulo: 'I', nivel: 1, unidad: 1 }, { titulo: 'II', nivel: 1, unidad: 4 }, { titulo: 'III', nivel: 1, unidad: 7 }, { titulo: 'IV', nivel: 1, unidad: 10 }],
  pasajes: PAGINAS_CUENTO,
  bibliotecas: [BIBLIOTECA_INVENTADA.id], creado: '2026-10-21T18:00:00Z', bytes: 4_830_000, mime: 'application/pdf',
};

// ---------------------------------------------------------------------------
// La película: 98 minutos, con diálogos solo donde se habla
// ---------------------------------------------------------------------------

/** Tramos de la transcripción: [t0, t1, texto con los turnos marcados]. */
const DIALOGOS: Array<[number, number, string]> = [
  [170, 232, '**Ernesto:** Ese libro de cálculo lo está leyendo al revés. Las vigas no se caen por las cuentas, se caen por las prisas.\n\n**Tomás:** ¿Perdone?\n\n**Ernesto:** Nada, nada. Siga con sus vigas.'],
  [300, 372, '**Don Julián:** Su té, don Ernesto. La canela, aparte, como siempre.\n\n**Ernesto:** Gracias, Julián. Al muchacho, otro, que estudia con hambre.\n\n**Tomás:** No hace falta, de verdad.'],
  [410, 470, '**Ernesto:** Tome. Arráiz. Léalo bajito, que se asusta.\n\n**Tomás:** ¿Quién es Arráiz?\n\n**Ernesto:** Alguien que escribió para gente como usted y como yo. Devuélvamelo el jueves.'],
  [520, 610, '**Tomás:** Se lo traigo. Me lo leí entero anoche.\n\n**Ernesto:** Y suspendió el examen.\n\n**Tomás:** ¿Cómo lo sabe?\n\n**Ernesto:** Porque tiene usted cara de haber leído toda la noche. Esa cara no aprueba Resistencia de Materiales.'],
  [700, 790, '**Ernesto:** Tengo una librería en la calle Real. Pase cuando quiera. A los que leen bajito no les cobro.\n\n**Tomás:** ¿Y a los otros?\n\n**Ernesto:** A los otros, el doble, y además les hablo de política.'],
  [900, 1010, '**Ernesto:** Aquí no hay orden alfabético. El alfabeto es para quien ya sabe lo que busca.\n\n**Tomás:** ¿Y cómo encuentra usted las cosas?\n\n**Ernesto:** No las encuentro. Me encuentran ellas.'],
  [1200, 1300, '**Tomás:** ¿Todos estos los ha leído?\n\n**Ernesto:** Todos no. Algunos me leyeron a mí, que es peor.'],
  [1500, 1600, '**Tomás:** ¿Y eso?\n\n**Ernesto:** Media hora exacta. Ninguna conversación seria debería durar más.\n\n**Tomás:** ¿Quién se lo regaló?\n\n**Ernesto:** Alguien que ya no vive en la isla. Otra media hora, otro día.'],
  [1820, 1900, '**Ernesto:** Se acabó la arena. Hablemos del tiempo, que es lo único de lo que se puede hablar sin reloj.'],
  [2060, 2160, '**Nieves:** Tú eres el de la librería, ¿no? El que baja todas las tardes.\n\n**Tomás:** Bajo, sí. La librería está abajo.\n\n**Nieves:** En este barrio todo se sabe, chico. Y lo que no se sabe, se inventa.'],
  [2300, 2380, '**Nieves:** Ese hombre es buena gente, pero aquí la gente buena tiene mala fama.'],
  [2500, 2600, '**Nieves:** ¿Bailas o te lo tengo que prestar como un libro?\n\n**Tomás:** No sé bailar boleros.\n\n**Nieves:** Nadie sabe. Se aprende bailando mal.'],
  [2880, 2990, '**Ernesto:** Hoy no le damos la vuelta. La lluvia lleva la cuenta por nosotros.\n\n**Tomás:** Se ha ido la luz en todo el barrio.\n\n**Ernesto:** Mejor. A oscuras se dicen las cosas que de día dan vergüenza.'],
  [3400, 3560, '**Ernesto:** Yo quise ser marino, ¿sabe? Me embarqué en un mercante y al tercer día me mareaba hasta dormido.\n\n**Tomás:** ¿Y volvió?\n\n**Ernesto:** Volví porque alguien me esperaba en el muelle. Me enseñó a leer en voz baja. Era la única forma de leer juntos sin que nos oyeran.'],
  [3800, 3900, '**Tomás:** Cada jueves un libro nuevo, cada jueves un papelito entre las páginas. Así aprendí que un libro prestado pesa más que uno comprado.'],
  [4500, 4620, '**Ernesto:** Lo derriban en primavera. Un aparcamiento para el muelle nuevo.\n\n**Tomás:** Le ayudo a buscar otro local.\n\n**Ernesto:** No es por el aparcamiento, muchacho. Me voy a la península, con mi hermana.'],
  [4880, 4960, '**Ernesto:** Llévese los que quiera. Los libros no se mudan: o se regalan o se pierden.'],
  [5200, 5320, '**Ernesto:** Para usted. Así no tendrá que pedirle a nadie media hora.\n\n**Tomás:** No sé qué decirle.\n\n**Ernesto:** Entonces no diga nada. Léalo bajito.'],
  [5680, 5760, '**Don Julián:** ¿Té, Tomás? Con canela, como a él.\n\n**Tomás:** Con canela.'],
];

export const PELICULA: DocDemo = {
  id: ID_PELICULA, tipo: 'video', unidades: DIALOGOS.length, duracion: 5880,
  meta: {
    titulo: 'Arena en los bolsillos', autores: [a('Rafael', 'Abenoza')], anio: 1997, editorial: 'Producciones Bocana', lugar: 'Santa Cruz de la Palma', idioma: 'es', tipoCSL: 'motion_picture',
    procedencia: { titulo: { fuente: 'lectura', confianza: 0.97 }, autores: { fuente: 'lectura', confianza: 0.9 } },
  },
  secciones: [],
  pasajes: DIALOGOS.map((d) => d[2]),
  tiempos: DIALOGOS.map((d) => [d[0], d[1]]),
  hablantes: ['Ernesto', 'Tomás', 'Don Julián', 'Nieves'],
  turnos: DIALOGOS.map((d) => /^\*\*([^*]+):\*\*/.exec(d[2])?.[1] ?? ''),
  bibliotecas: [BIBLIOTECA_INVENTADA.id], creado: '2026-10-21T18:30:00Z', bytes: 1_240_000_000, mime: 'video/mp4',
};

// ---------------------------------------------------------------------------
// El reparto y lo que hay en cada sitio
// ---------------------------------------------------------------------------

export interface EntidadInventada {
  id: string;
  nombre: string;
  /** El tipo del grafo (persona, lugar, obra, concepto). */
  tipo: 'persona' | 'lugar' | 'obra' | 'concepto';
  /** El tipo fino de la comprensión. */
  fino: 'personaje' | 'lugar' | 'obra' | 'obra_musical' | 'motivo' | 'tema';
  descripcion: string;
  /** Formas literales con que aparece (las más largas primero). */
  formas: string[];
  /** Quién lo interpreta en la película (inventado). */
  actor?: string;
}

export const ENTIDADES_INVENTADAS: EntidadInventada[] = [
  { id: 'e-ernesto', nombre: 'Ernesto Valdivia', tipo: 'persona', fino: 'personaje', descripcion: 'librero de viejo de la calle Real', formas: ['Ernesto Valdivia', 'Ernesto', 'el librero'], actor: 'Dámaso Lugo' },
  { id: 'e-tomas', nombre: 'Tomás Ledesma', tipo: 'persona', fino: 'personaje', descripcion: 'estudiante de ingeniería; narra el cuento', formas: ['Tomás'], actor: 'Iván Cejas' },
  { id: 'e-julian', nombre: 'Don Julián', tipo: 'persona', fino: 'personaje', descripcion: 'dueño del café El Mirlo', formas: ['Don Julián', 'Julián'], actor: 'Abilio Tejera' },
  { id: 'e-nieves', nombre: 'Nieves', tipo: 'persona', fino: 'personaje', descripcion: 'vecina de la azotea; solo en la película', formas: ['Nieves'], actor: 'Marta Quevedo' },
  { id: 'e-rafa', nombre: 'Rafa', tipo: 'persona', fino: 'personaje', descripcion: 'compañero de facultad de Tomás; solo en el cuento', formas: ['Rafa'] },
  { id: 'e-mirlo', nombre: 'El Mirlo', tipo: 'lugar', fino: 'lugar', descripcion: 'café del puerto con terraza', formas: ['El Mirlo'] },
  { id: 'e-libreria', nombre: 'La librería de la calle Real', tipo: 'lugar', fino: 'lugar', descripcion: 'librería de viejo de Ernesto, con su trastienda', formas: ['librería', 'calle Real', 'trastienda'] },
  { id: 'e-muelle', nombre: 'El muelle', tipo: 'lugar', fino: 'lugar', descripcion: 'el puerto de la isla', formas: ['muelle', 'puerto', 'bocana'] },
  { id: 'e-reloj', nombre: 'El reloj de arena', tipo: 'concepto', fino: 'motivo', descripcion: 'el reloj de media hora de la trastienda', formas: ['reloj de arena', 'reloj', 'arena'] },
  { id: 'e-te', nombre: 'El té con canela', tipo: 'concepto', fino: 'motivo', descripcion: 'lo que Ernesto pide en El Mirlo y lo que el barrio niega', formas: ['canela', 'té'] },
  { id: 'e-lluvia', nombre: 'La lluvia', tipo: 'concepto', fino: 'motivo', descripcion: 'la lluvia y la tormenta que cuentan el tiempo', formas: ['lluvias', 'lluvia', 'tormenta', 'Llovía'] },
  { id: 'e-bajamar', nombre: 'Cuaderno de bajamar', tipo: 'obra', fino: 'obra', descripcion: 'poemario de Celestino Arráiz (inventado) que Ernesto presta a Tomás', formas: ['Cuaderno de bajamar', 'Arráiz', 'cuaderno'] },
  { id: 'e-bolero', nombre: 'Bolero del muelle', tipo: 'obra', fino: 'obra_musical', descripcion: 'bolero instrumental de la banda sonora (inventado)', formas: ['boleros', 'bolero'] },
  { id: 'e-amistad', nombre: 'La amistad', tipo: 'concepto', fino: 'tema', descripcion: 'la amistad entre dos hombres de edades y mundos distintos', formas: [] },
  { id: 'e-sospecha', nombre: 'La sospecha del barrio', tipo: 'concepto', fino: 'tema', descripcion: 'lo que se dice y no se dice de Ernesto', formas: [] },
  { id: 'e-tiempo', nombre: 'El tiempo que se acaba', tipo: 'concepto', fino: 'tema', descripcion: 'la media hora, la mudanza, el derribo', formas: [] },
];

// ---------------------------------------------------------------------------
// El découpage: secuencias, escenas y planos (con quién está y dónde)
// ---------------------------------------------------------------------------

export interface Visto { nombre: string; region: Region; nota?: string }
export interface PlanoInventado {
  t0: number; t1: number; escala: string; angulacion?: string; movimiento: string; descripcion: string;
  composicion?: string; luz?: string; color?: string; textoEnPantalla?: string; personas?: Visto[]; objetos?: Visto[];
}
export interface EscenaInventada {
  id: string; titulo: string; t0: number; t1: number; lugar: string; tiempo: string; personajes: string[]; accion: string;
  /** Fondo del fotograma de la demo. */
  fondo: 'terraza' | 'libreria' | 'trastienda' | 'azotea' | 'lluvia' | 'muelle' | 'negro';
  sonido: { diegetico: string[]; extradiegetico: string[]; musica: string[]; silencio?: string };
  montaje: string;
  funcion: string;
  ficha: string;
  planos: PlanoInventado[];
}
export interface SecuenciaInventada { id: string; titulo: string; resumen: string; escenas: EscenaInventada[] }

const r = (x: number, y: number, w: number, h: number): Region => ({ x, y, w, h });
const E = (region: Region, nota?: string): Visto => ({ nombre: 'Ernesto', region, ...(nota ? { nota } : {}) });
const T = (region: Region, nota?: string): Visto => ({ nombre: 'Tomás', region, ...(nota ? { nota } : {}) });
const J = (region: Region, nota?: string): Visto => ({ nombre: 'Don Julián', region, ...(nota ? { nota } : {}) });
const N = (region: Region, nota?: string): Visto => ({ nombre: 'Nieves', region, ...(nota ? { nota } : {}) });
const sinSonido = { diegetico: [], extradiegetico: [], musica: [] };

export const SECUENCIAS: SecuenciaInventada[] = [
  {
    id: 'sq1', titulo: 'Créditos y puerto', resumen: 'Los títulos de crédito sobre el puerto al amanecer.',
    escenas: [{
      id: 'es1', titulo: 'Títulos sobre el puerto', t0: 0, t1: 150, lugar: 'El puerto', tiempo: 'Amanecer', personajes: [], fondo: 'muelle',
      accion: 'Los títulos de crédito pasan sobre el puerto vacío mientras sale el sol.',
      sonido: { diegetico: ['gaviotas', 'el viento del muelle'], extradiegetico: ['Bolero del muelle'], musica: ['Bolero del muelle (tema principal)'] },
      montaje: 'Encadenados lentos entre tres vistas del puerto.', funcion: 'Presenta el espacio que cerrará la película: el muelle de la partida.',
      ficha: 'La película abre donde el cuento no empieza: en el muelle. Los encadenados lentos y el bolero extradiegético instalan una nostalgia anticipada; el espacio de la despedida se enseña antes que los personajes, de modo que el final queda inscrito en el principio.',
      planos: [
        { t0: 0, t1: 52, escala: 'gran plano general', movimiento: 'fija', descripcion: 'El puerto vacío al amanecer; las grúas a contraluz.', luz: 'contraluz de amanecer', color: 'ocres y azules apagados', textoEnPantalla: 'PRODUCCIONES BOCANA PRESENTA' },
        { t0: 52, t1: 104, escala: 'plano general', movimiento: 'panorámica', descripcion: 'La panorámica recorre el muelle hasta la terraza cerrada de El Mirlo.', textoEnPantalla: 'ARENA EN LOS BOLSILLOS' },
        { t0: 104, t1: 150, escala: 'plano de conjunto', movimiento: 'fija', descripcion: 'Las sillas apiladas de la terraza; un camarero las empieza a bajar.', textoEnPantalla: 'SEGÚN UN CUENTO DE ADELA SORNÍ' },
      ],
    }],
  },
  {
    id: 'sq2', titulo: 'El encuentro en El Mirlo', resumen: 'Tomás conoce a Ernesto en la terraza del café y acepta su invitación.',
    escenas: [
      {
        id: 'es2', titulo: 'La terraza de El Mirlo', t0: 150, t1: 485, lugar: 'Terraza del café El Mirlo, frente al puerto', tiempo: 'Día, octubre', personajes: ['Tomás', 'Ernesto', 'Don Julián'], fondo: 'terraza',
        accion: 'Tomás estudia para un examen; Ernesto, en la mesa del rincón, le habla de vigas, le invita a un té y le presta un libro de poemas.',
        sonido: { diegetico: ['viento', 'gaviotas', 'la cucharilla contra la taza'], extradiegetico: [], musica: [], silencio: 'Pausa larga antes de que Ernesto deje el libro sobre la mesa.' },
        montaje: 'Plano y contraplano desigual: Ernesto en planos más cercanos y largos que Tomás; corte en raccord de mirada hacia el libro.',
        funcion: 'Planteamiento: el encuentro y el primer préstamo.',
        ficha: 'La escena traduce en puesta en cuadro lo que el cuento confía a la voz del narrador. Donde el relato de Tomás juzga a Ernesto («uno de esos viejos que hablan con cualquiera», p. 2), la película deja que la composición hable: Ernesto ocupa el primer término y domina el encuadre en el plano de conjunto, mientras Tomás queda al fondo, pequeño y desenfocado. El plano detalle del té con canela, en picado, convierte un gesto de costumbre en un signo que el resto de la película irá cargando de sentido.',
        planos: [
          { t0: 150, t1: 171, escala: 'gran plano general', movimiento: 'panorámica', descripcion: 'El puerto desde la terraza; el viento levanta las servilletas.', textoEnPantalla: 'CAFÉ EL MIRLO', luz: 'luz de mediodía, clave alta' },
          { t0: 171, t1: 188, escala: 'plano medio', movimiento: 'fija', descripcion: 'Tomás estudia, inclinado sobre los apuntes.', personas: [T(r(0.1, 0.2, 0.34, 0.74), 'subraya los apuntes')], objetos: [{ nombre: 'Apuntes', region: r(0.2, 0.74, 0.3, 0.16) }] },
          { t0: 188, t1: 206, escala: 'plano medio corto', angulacion: 'contrapicado', movimiento: 'fija', descripcion: 'Ernesto en la mesa del rincón, con un libro abierto boca abajo.', composicion: 'Ernesto, ligeramente desde abajo, ocupa dos tercios del cuadro.', personas: [E(r(0.5, 0.1, 0.38, 0.86), 'remueve el té sin prisa')], objetos: [{ nombre: 'Taza de té', region: r(0.34, 0.66, 0.12, 0.14) }] },
          { t0: 206, t1: 232, escala: 'plano de conjunto', movimiento: 'fija', descripcion: 'Ernesto habla en primer término; Tomás, al fondo, levanta la cabeza.', composicion: 'Ernesto domina el encuadre en primer término; Tomás queda al fondo, pequeño y desenfocado.', personas: [E(r(0.5, 0.06, 0.42, 0.92), 'habla de vigas'), T(r(0.1, 0.32, 0.15, 0.4), 'escucha al fondo')] },
          { t0: 232, t1: 262, escala: 'primer plano', movimiento: 'fija', descripcion: 'Tomás, desconcertado, no sabe qué contestar.', personas: [T(r(0.3, 0.08, 0.42, 0.88), 'desconcertado')] },
          { t0: 262, t1: 300, escala: 'plano detalle', angulacion: 'picado', movimiento: 'fija', descripcion: 'La cucharilla remueve el té; la canela espera en un platito aparte.', objetos: [{ nombre: 'Té con canela', region: r(0.28, 0.3, 0.44, 0.44), nota: 'la canela, en un platito aparte' }] },
          { t0: 300, t1: 340, escala: 'plano medio', movimiento: 'travelling', descripcion: 'Don Julián sirve otro té en la mesa de Ernesto.', personas: [J(r(0.1, 0.08, 0.3, 0.88), 'sirve el té'), E(r(0.58, 0.2, 0.32, 0.78), 'señala a Tomás')] },
          { t0: 340, t1: 372, escala: 'plano medio corto', movimiento: 'fija', descripcion: 'Ernesto invita al muchacho con un gesto.', personas: [E(r(0.38, 0.1, 0.4, 0.86), 'invita con un gesto')] },
          { t0: 372, t1: 410, escala: 'plano entero', movimiento: 'fija', descripcion: 'Tomás, de pie junto a su mesa, duda.', personas: [T(r(0.4, 0.06, 0.2, 0.9), 'duda si acercarse')] },
          { t0: 410, t1: 445, escala: 'plano detalle', angulacion: 'cenital', movimiento: 'fija', descripcion: 'El libro de tapas azules sobre los apuntes.', textoEnPantalla: 'CUADERNO DE BAJAMAR · C. ARRÁIZ', objetos: [{ nombre: 'Cuaderno de bajamar', region: r(0.3, 0.26, 0.38, 0.44), nota: 'tapas azules' }] },
          { t0: 445, t1: 485, escala: 'plano general', movimiento: 'fija', descripcion: 'Los dos en sus mesas, el puerto al fondo; Ernesto vuelve a su té.', composicion: 'Las dos mesas a ambos lados del cuadro, separadas por el vacío del centro.', personas: [E(r(0.62, 0.3, 0.17, 0.5)), T(r(0.16, 0.34, 0.15, 0.46))] },
        ],
      },
      {
        id: 'es3', titulo: 'La invitación', t0: 485, t1: 850, lugar: 'Terraza del café El Mirlo', tiempo: 'Día siguiente', personajes: ['Tomás', 'Ernesto'], fondo: 'terraza',
        accion: 'Tomás devuelve el libro; Ernesto adivina que ha suspendido y lo invita a su librería.',
        sonido: { diegetico: ['murmullo del café'], extradiegetico: [], musica: [] },
        montaje: 'Elipsis por corte: el mismo encuadre de la terraza, otro día.', funcion: 'Nudo: la invitación a la librería.',
        ficha: 'Una elipsis por corte repite el encuadre de la escena anterior para decir que ha pasado un día. El diálogo condensa dos páginas del cuento y deja fuera la mirada de Don Julián, que en el relato anuncia el rumor; aquí el humor de Ernesto («a los otros, el doble») ocupa todo el espacio.',
        planos: [
          { t0: 485, t1: 560, escala: 'plano general', movimiento: 'fija', descripcion: 'El mismo encuadre de la terraza, al día siguiente; Ernesto en la misma mesa.', personas: [E(r(0.6, 0.3, 0.18, 0.5)), T(r(0.2, 0.34, 0.15, 0.46), 'llega con el libro')] },
          { t0: 560, t1: 700, escala: 'plano medio', movimiento: 'fija', descripcion: 'Tomás devuelve el libro; Ernesto sonríe.', personas: [T(r(0.08, 0.16, 0.34, 0.8)), E(r(0.56, 0.12, 0.36, 0.84), 'sonríe con media boca')] },
          { t0: 700, t1: 850, escala: 'primer plano', movimiento: 'fija', descripcion: 'Ernesto habla de su librería de la calle Real.', personas: [E(r(0.32, 0.08, 0.4, 0.88), 'habla de la librería')] },
        ],
      },
    ],
  },
  {
    id: 'sq3', titulo: 'La librería', resumen: 'Tomás descubre la librería, su trastienda y el reloj de arena.',
    escenas: [
      {
        id: 'es4', titulo: 'La trastienda', t0: 850, t1: 1470, lugar: 'Librería de la calle Real y su trastienda', tiempo: 'Tarde', personajes: ['Tomás', 'Ernesto'], fondo: 'libreria',
        accion: 'Ernesto enseña a Tomás la librería sin orden alfabético y lo lleva a la trastienda.',
        sonido: { diegetico: ['el hornillo', 'la lluvia lejana sobre la uralita'], extradiegetico: [], musica: [] },
        montaje: 'Travelling continuo entre las estanterías hasta la puerta de la trastienda.', funcion: 'Presenta el espacio de la amistad.',
        ficha: 'La película amplía la visita: lo que en el cuento es una enumeración de estanterías se convierte en un travelling continuo que sigue a los dos por el laberinto de libros hasta la trastienda, un espacio de intimidad que la cámara presenta como un refugio.',
        planos: [
          { t0: 850, t1: 1060, escala: 'plano general', movimiento: 'travelling', descripcion: 'Ernesto guía a Tomás entre estanterías que llegan al techo.', personas: [E(r(0.54, 0.2, 0.18, 0.66)), T(r(0.3, 0.24, 0.16, 0.62))], luz: 'luz de ventana, polvo en suspensión' },
          { t0: 1060, t1: 1300, escala: 'plano medio', movimiento: 'fija', descripcion: 'Tomás pregunta si los ha leído todos.', personas: [T(r(0.12, 0.14, 0.34, 0.82)), E(r(0.58, 0.16, 0.32, 0.8))] },
          { t0: 1300, t1: 1470, escala: 'plano entero', movimiento: 'fija', descripcion: 'La puerta de la trastienda se abre.', composicion: 'Marco dentro del marco: la puerta encierra a los dos.', personas: [E(r(0.42, 0.18, 0.16, 0.74)), T(r(0.58, 0.2, 0.14, 0.7))] },
        ],
      },
      {
        id: 'es5', titulo: 'El reloj de arena', t0: 1470, t1: 2020, lugar: 'La trastienda', tiempo: 'Tarde', personajes: ['Tomás', 'Ernesto'], fondo: 'trastienda',
        accion: 'Ernesto da la vuelta al reloj de arena y explica la regla de la media hora; Tomás pregunta quién se lo regaló.',
        sonido: { diegetico: ['la arena que cae', 'el brasero'], extradiegetico: [], musica: [], silencio: 'Silencio casi total mientras cae la arena.' },
        montaje: 'Plano y contraplano equilibrado por primera vez; inserto del reloj al principio y al final.', funcion: 'Introduce el motivo central y el secreto de Ernesto.',
        ficha: 'Es la escena más fiel al cuento: el diálogo conserva la regla de la media hora y el regalo de «alguien que ya no vive en la isla». La película subraya el motivo con dos insertos del reloj, uno al dar la vuelta y otro al acabarse la arena, que enmarcan la conversación. En el plano de conjunto el reloj ocupa el centro, entre los dos: el tiempo es lo que los une y lo que los separa.',
        planos: [
          { t0: 1470, t1: 1525, escala: 'plano medio', movimiento: 'fija', descripcion: 'Ernesto se sienta en la butaca de mimbre.', personas: [E(r(0.36, 0.14, 0.36, 0.82), 'se sienta')], luz: 'clave baja, una lámpara' },
          { t0: 1525, t1: 1560, escala: 'plano detalle', movimiento: 'fija', descripcion: 'La mano de Ernesto da la vuelta al reloj de arena.', objetos: [{ nombre: 'Reloj de arena', region: r(0.4, 0.16, 0.2, 0.66), nota: 'arena rosada' }] },
          { t0: 1560, t1: 1640, escala: 'plano medio corto', movimiento: 'fija', descripcion: 'Tomás pregunta qué es eso.', personas: [T(r(0.3, 0.1, 0.4, 0.86), 'pregunta')] },
          { t0: 1640, t1: 1760, escala: 'plano de conjunto', angulacion: 'picado', movimiento: 'fija', descripcion: 'Los dos a cada lado de la mesa camilla; el reloj, entre ambos.', composicion: 'Simetría: el reloj en el eje del cuadro, Ernesto y Tomás a cada lado.', personas: [E(r(0.6, 0.2, 0.26, 0.7)), T(r(0.12, 0.22, 0.26, 0.68))], objetos: [{ nombre: 'Reloj de arena', region: r(0.45, 0.44, 0.1, 0.22) }] },
          { t0: 1760, t1: 1820, escala: 'primerísimo primer plano', movimiento: 'fija', descripcion: 'La arena cae por el cuello del reloj.', objetos: [{ nombre: 'Reloj de arena', region: r(0.25, 0.05, 0.5, 0.9) }] },
          { t0: 1820, t1: 1900, escala: 'plano medio', movimiento: 'fija', descripcion: 'Ernesto anuncia que se ha acabado la arena.', personas: [E(r(0.34, 0.12, 0.38, 0.84), 'cambia de tema')] },
          { t0: 1900, t1: 2020, escala: 'plano general', movimiento: 'travelling', descripcion: 'Travelling de retroceso: la trastienda entera, los dos pequeños en el centro.', personas: [E(r(0.5, 0.42, 0.1, 0.32)), T(r(0.38, 0.44, 0.1, 0.3))] },
        ],
      },
    ],
  },
  {
    id: 'sq4', titulo: 'Nieves', resumen: 'Una vecina, ausente del cuento, pone voz a lo que se dice en el barrio.',
    escenas: [
      {
        id: 'es6', titulo: 'La vecina de la azotea', t0: 2020, t1: 2460, lugar: 'Azotea del edificio de Tomás', tiempo: 'Atardecer', personajes: ['Tomás', 'Nieves'], fondo: 'azotea',
        accion: 'Nieves, que tiende la ropa, le dice a Tomás lo que se murmura de Ernesto.',
        sonido: { diegetico: ['sábanas al viento', 'una radio en otra azotea'], extradiegetico: [], musica: [] },
        montaje: 'Plano secuencia con cámara en mano entre las sábanas.', funcion: 'Externaliza la sospecha del barrio, que en el cuento cuenta Rafa.',
        ficha: 'La película sustituye a Rafa, el compañero de facultad del cuento, por Nieves, una vecina que no existe en el relato. La sospecha deja de ser un aviso velado («la gente dice cosas») y toma cuerpo en una mujer que la nombra con ironía y, a la vez, la desactiva: «aquí la gente buena tiene mala fama».',
        planos: [
          { t0: 2020, t1: 2300, escala: 'plano medio', movimiento: 'cámara en mano', descripcion: 'Nieves tiende sábanas; Tomás sube a la azotea.', personas: [N(r(0.52, 0.14, 0.3, 0.82), 'tiende la ropa'), T(r(0.14, 0.2, 0.26, 0.76))], luz: 'atardecer, contraluz cálido' },
          { t0: 2300, t1: 2460, escala: 'primer plano', movimiento: 'fija', descripcion: 'Nieves habla de la mala fama de la gente buena.', personas: [N(r(0.3, 0.08, 0.42, 0.88), 'ironiza')] },
        ],
      },
      {
        id: 'es7', titulo: 'El baile en la azotea', t0: 2460, t1: 2840, lugar: 'Azotea', tiempo: 'Noche', personajes: ['Tomás', 'Nieves'], fondo: 'azotea',
        accion: 'Suena un bolero en la radio y Nieves enseña a Tomás a bailar.',
        sonido: { diegetico: ['Bolero del muelle, en la radio'], extradiegetico: [], musica: ['Bolero del muelle'] },
        montaje: 'Pocos planos largos; la música pasa de diegética a extradiegética al final.', funcion: 'Respiro y contrapunto: la vida del barrio frente a la trastienda.',
        ficha: 'Escena añadida. El bolero que sonó en los créditos vuelve como música diegética, en una radio, y el baile torpe de Tomás repite la lección de Ernesto con otro maestro: se aprende haciendo mal las cosas.',
        planos: [
          { t0: 2460, t1: 2700, escala: 'plano entero', movimiento: 'travelling', descripcion: 'Nieves y Tomás bailan entre las sábanas.', personas: [N(r(0.44, 0.12, 0.18, 0.84)), T(r(0.56, 0.12, 0.18, 0.84))], luz: 'noche, una bombilla' },
          { t0: 2700, t1: 2840, escala: 'gran plano general', movimiento: 'grúa', descripcion: 'La grúa se eleva sobre las azoteas del barrio.', personas: [N(r(0.47, 0.6, 0.04, 0.12)), T(r(0.51, 0.6, 0.04, 0.12))] },
        ],
      },
    ],
  },
  {
    id: 'sq5', titulo: 'La tormenta', resumen: 'A oscuras, durante una tormenta, Ernesto cuenta su juventud.',
    escenas: [
      {
        id: 'es8', titulo: 'La lluvia', t0: 2840, t1: 3370, lugar: 'La trastienda', tiempo: 'Noviembre, tormenta', personajes: ['Tomás', 'Ernesto'], fondo: 'lluvia',
        accion: 'Se va la luz; Ernesto enciende una vela y no da la vuelta al reloj.',
        sonido: { diegetico: ['lluvia sobre la uralita', 'trueno'], extradiegetico: [], musica: [] },
        montaje: 'Planos largos a la luz de la vela.', funcion: 'Suspende la regla de la media hora.',
        ficha: 'La lluvia sustituye al reloj como medida del tiempo, en la película como en el cuento. La luz de la vela, en clave muy baja, deja medio rostro de cada uno en sombra.',
        planos: [
          { t0: 2840, t1: 3100, escala: 'plano medio', movimiento: 'fija', descripcion: 'Ernesto enciende una vela; el reloj queda quieto.', personas: [E(r(0.4, 0.14, 0.36, 0.82), 'enciende una vela')], objetos: [{ nombre: 'Reloj de arena', region: r(0.2, 0.5, 0.1, 0.22), nota: 'quieto' }], luz: 'clave baja, vela' },
          { t0: 3100, t1: 3370, escala: 'plano de conjunto', movimiento: 'fija', descripcion: 'Los dos escuchan la lluvia en silencio.', personas: [E(r(0.56, 0.24, 0.26, 0.66)), T(r(0.16, 0.26, 0.26, 0.64))] },
        ],
      },
      {
        id: 'es9', titulo: 'La juventud de Ernesto', t0: 3370, t1: 3780, lugar: 'La trastienda', tiempo: 'La misma noche', personajes: ['Tomás', 'Ernesto'], fondo: 'lluvia',
        accion: 'Ernesto cuenta que quiso ser marino y que alguien lo esperaba en el muelle.',
        sonido: { diegetico: ['lluvia'], extradiegetico: [], musica: [], silencio: 'Silencio tras «sin que nos oyeran».' },
        montaje: 'Un solo plano que se acerca muy despacio a Ernesto.', funcion: 'Revela, sin nombrarlo, el secreto de Ernesto.',
        ficha: 'La analepsis del cuento no se convierte en un flashback: la película la deja en la palabra, en un único plano que se cierra sobre Ernesto mientras habla. La persona que lo esperaba en el muelle sigue sin nombre; el silencio que sigue a la confesión dura más que en el relato.',
        planos: [
          { t0: 3370, t1: 3780, escala: 'primer plano', movimiento: 'zoom', descripcion: 'Zoom lentísimo hacia Ernesto mientras recuerda.', personas: [E(r(0.3, 0.06, 0.44, 0.9), 'recuerda')], luz: 'vela' },
        ],
      },
    ],
  },
  {
    id: 'sq6', titulo: 'Los jueves', resumen: 'Montaje de los jueves de lectura y préstamos.',
    escenas: [{
      id: 'es10', titulo: 'Montaje de los jueves', t0: 3780, t1: 4470, lugar: 'Librería, El Mirlo, el cuarto de Tomás', tiempo: 'Invierno', personajes: ['Tomás', 'Ernesto', 'Don Julián'], fondo: 'libreria',
      accion: 'Varios jueves seguidos: préstamos, papelitos entre las páginas, la lata de galletas.',
      sonido: { diegetico: [], extradiegetico: ['Bolero del muelle', 'voz en off de Tomás'], musica: ['Bolero del muelle (variación al piano)'] },
      montaje: 'Montaje de secuencia con encadenados y voz en off.', funcion: 'Condensa el paso del tiempo y la amistad.',
      ficha: 'La frecuencia iterativa del cuento («cada jueves») se resuelve con un montaje de encadenados sobre la voz en off de Tomás, la única de la película. La negación de la canela, que el cuento cuenta en una frase, se ve en un plano: Don Julián deja el té sin el platito.',
      planos: [
        { t0: 3780, t1: 3990, escala: 'plano detalle', movimiento: 'fija', descripcion: 'Un papelito entre las páginas de un libro.', objetos: [{ nombre: 'Papelito', region: r(0.36, 0.3, 0.26, 0.4) }] },
        { t0: 3990, t1: 4200, escala: 'plano medio', movimiento: 'fija', descripcion: 'Ernesto guarda los papelitos en una lata de galletas.', personas: [E(r(0.36, 0.12, 0.36, 0.84))] },
        { t0: 4200, t1: 4470, escala: 'plano medio', movimiento: 'fija', descripcion: 'Don Julián deja el té de Tomás sin la canela.', personas: [J(r(0.5, 0.1, 0.3, 0.86), 'sin la canela'), T(r(0.12, 0.2, 0.28, 0.76))], objetos: [{ nombre: 'Té sin canela', region: r(0.4, 0.66, 0.12, 0.14) }] },
      ],
    }],
  },
  {
    id: 'sq7', titulo: 'El cierre', resumen: 'El ayuntamiento derriba el local; Ernesto se va de la isla.',
    escenas: [
      {
        id: 'es11', titulo: 'La noticia', t0: 4470, t1: 4840, lugar: 'La librería', tiempo: 'Febrero', personajes: ['Tomás', 'Ernesto'], fondo: 'libreria',
        accion: 'Ernesto enseña la carta del ayuntamiento y anuncia que se va a la península.',
        sonido: sinSonido, montaje: 'Plano y contraplano.', funcion: 'Desenlace anunciado.',
        ficha: 'La escena sigue al cuento casi frase por frase; la película añade un inserto de la carta, con el membrete del ayuntamiento, para que el espectador lea lo que el narrador del cuento lee.',
        planos: [
          { t0: 4470, t1: 4560, escala: 'plano detalle', movimiento: 'fija', descripcion: 'La carta del ayuntamiento sobre el mostrador.', textoEnPantalla: 'AYUNTAMIENTO · NOTIFICACIÓN DE DERRIBO', objetos: [{ nombre: 'Carta del ayuntamiento', region: r(0.24, 0.18, 0.52, 0.64) }] },
          { t0: 4560, t1: 4840, escala: 'plano medio', movimiento: 'fija', descripcion: 'Ernesto dice que no es por el aparcamiento.', personas: [E(r(0.5, 0.12, 0.36, 0.84)), T(r(0.1, 0.2, 0.28, 0.76))] },
        ],
      },
      {
        id: 'es12', titulo: 'Las cajas', t0: 4840, t1: 5160, lugar: 'La librería', tiempo: 'Marzo', personajes: ['Tomás', 'Ernesto'], fondo: 'libreria',
        accion: 'Tomás llena cajas con los libros que Ernesto le regala.',
        sonido: sinSonido, montaje: 'Elipsis entre cajas cada vez más llenas.', funcion: 'Despedida de la librería.',
        ficha: 'En el cuento Tomás saca los libros a escondidas y Ernesto «hacía como que no me veía»; la película convierte el disimulo en un regalo explícito y en cajas a la vista.',
        planos: [
          { t0: 4840, t1: 5160, escala: 'plano general', movimiento: 'fija', descripcion: 'Estanterías vacías y cajas en el suelo.', personas: [T(r(0.2, 0.3, 0.18, 0.6), 'llena una caja'), E(r(0.64, 0.26, 0.16, 0.64))] },
        ],
      },
    ],
  },
  {
    id: 'sq8', titulo: 'El muelle', resumen: 'La despedida en el muelle y el último té en El Mirlo.',
    escenas: [
      {
        id: 'es13', titulo: 'La despedida', t0: 5160, t1: 5660, lugar: 'El muelle', tiempo: 'Llovizna', personajes: ['Tomás', 'Ernesto'], fondo: 'muelle',
        accion: 'Ernesto entrega a Tomás un paquete y embarca.',
        sonido: { diegetico: ['llovizna', 'sirena del barco'], extradiegetico: [], musica: [] },
        montaje: 'Del plano entero al gran plano general con grúa.', funcion: 'Separación.',
        ficha: 'Por primera vez Tomás domina el encuadre: en el contrapicado de la entrega, Ernesto queda en segundo término. La grúa final reduce a Tomás a una figura mínima en el muelle mientras el barco cruza la bocana.',
        planos: [
          { t0: 5160, t1: 5230, escala: 'gran plano general', movimiento: 'fija', descripcion: 'El muelle bajo la llovizna, el barco atracado.' },
          { t0: 5230, t1: 5300, escala: 'plano entero', movimiento: 'fija', descripcion: 'Ernesto con una maleta y un paquete de papel de estraza.', personas: [E(r(0.42, 0.08, 0.2, 0.88), 'con la maleta')], objetos: [{ nombre: 'Paquete', region: r(0.56, 0.5, 0.1, 0.12) }] },
          { t0: 5300, t1: 5380, escala: 'plano medio', angulacion: 'contrapicado', movimiento: 'fija', descripcion: 'Ernesto entrega el paquete.', composicion: 'Tomás domina el encuadre en primer término; Ernesto, en segundo.', personas: [T(r(0.08, 0.06, 0.4, 0.92), 'recibe el paquete'), E(r(0.6, 0.2, 0.26, 0.74), 'entrega el paquete')] },
          { t0: 5380, t1: 5480, escala: 'primer plano', movimiento: 'fija', descripcion: 'Tomás no sabe qué decir.', personas: [T(r(0.3, 0.08, 0.42, 0.88))] },
          { t0: 5480, t1: 5660, escala: 'gran plano general', movimiento: 'grúa', descripcion: 'El barco sale por la bocana; Tomás, pequeño en el muelle.', personas: [T(r(0.47, 0.66, 0.04, 0.1), 'solo en el muelle')] },
        ],
      },
      {
        id: 'es14', titulo: 'El último té', t0: 5660, t1: 5820, lugar: 'Terraza del café El Mirlo', tiempo: 'Tarde', personajes: ['Tomás', 'Don Julián'], fondo: 'terraza',
        accion: 'Tomás se sienta en la mesa del rincón; Don Julián le trae el té con canela; Tomás da la vuelta al reloj.',
        sonido: { diegetico: ['viento', 'la arena que cae'], extradiegetico: ['Bolero del muelle (en los últimos segundos)'], musica: ['Bolero del muelle'] },
        montaje: 'Inserto del reloj y fundido a negro.', funcion: 'Final: el reloj vuelve a contar.',
        ficha: 'La película cambia el último gesto del cuento. En el relato, Tomás no da la vuelta al reloj y la conversación con Ernesto queda en suspenso; aquí, en un plano detalle, le da la vuelta, y la arena que cae convierte la espera en continuidad: Tomás ocupa la mesa de Ernesto y su media hora. El té con canela que Don Julián le sirve sin pedirlo cierra el motivo de la negación.',
        planos: [
          { t0: 5660, t1: 5700, escala: 'plano general', movimiento: 'fija', descripcion: 'Tomás en la mesa del rincón, la que da al puerto.', personas: [T(r(0.6, 0.3, 0.18, 0.52), 'en la mesa de Ernesto')] },
          { t0: 5700, t1: 5760, escala: 'plano medio', movimiento: 'fija', descripcion: 'Don Julián le sirve el té con canela.', personas: [J(r(0.12, 0.1, 0.3, 0.86), 'trae la canela'), T(r(0.56, 0.18, 0.32, 0.8))], objetos: [{ nombre: 'Té con canela', region: r(0.42, 0.66, 0.12, 0.14) }] },
          { t0: 5760, t1: 5790, escala: 'plano detalle', movimiento: 'fija', descripcion: 'La mano de Tomás da la vuelta al reloj de arena.', objetos: [{ nombre: 'Reloj de arena', region: r(0.36, 0.18, 0.26, 0.62), nota: 'Tomás le da la vuelta' }] },
          { t0: 5790, t1: 5820, escala: 'primer plano', movimiento: 'fija', descripcion: 'Tomás mira el puerto mientras cae la arena; fundido a negro.', personas: [T(r(0.3, 0.08, 0.42, 0.88), 'mira el puerto')] },
        ],
      },
      {
        id: 'es15', titulo: 'Créditos finales', t0: 5820, t1: 5880, lugar: '', tiempo: '', personajes: [], fondo: 'negro',
        accion: 'Créditos finales sobre negro.', sonido: { diegetico: [], extradiegetico: ['Bolero del muelle'], musica: ['Bolero del muelle'] },
        montaje: 'Fundido a negro.', funcion: 'Cierre.', ficha: 'Créditos sobre negro con el bolero entero.',
        planos: [{ t0: 5820, t1: 5880, escala: 'plano general', movimiento: 'fija', descripcion: 'Créditos sobre negro.', textoEnPantalla: 'FIN' }],
      },
    ],
  },
];

/** Las escenas del cuento: [id, título, parte, página de inicio, página de fin, resumen]. */
export const ESCENAS_CUENTO: Array<{ id: string; titulo: string; parte: number; desde: number; hasta: number; resumen: string; ficha: string; orden: string; duracion: string; frecuencia: string }> = [
  { id: 'ce1', titulo: 'El encuentro en El Mirlo', parte: 0, desde: 1, hasta: 2, orden: 'cronológico', duracion: 'escena', frecuencia: 'singulativa',
    resumen: 'Tomás conoce a Ernesto en la terraza del café y recibe el Cuaderno de bajamar.',
    ficha: 'El relato empieza en analepsis desde un presente que no se precisa («La primera vez que vi…»): el narrador autodiegético recuerda y juzga a la vez. La focalización interna fija hace que Ernesto llegue filtrado por los prejuicios del joven («uno de esos viejos que hablan con cualquiera»), que el cuento irá desmontando.' },
  { id: 'ce2', titulo: 'La invitación', parte: 0, desde: 3, hasta: 3, orden: 'cronológico', duracion: 'escena', frecuencia: 'singulativa',
    resumen: 'Tomás devuelve el libro y Ernesto lo invita a su librería; Don Julián los mira.',
    ficha: 'La escena cierra la primera parte con una mirada que el narrador no supo leer entonces: la prolepsis implícita anuncia la sospecha del barrio.' },
  { id: 'ce3', titulo: 'La trastienda', parte: 1, desde: 4, hasta: 4, orden: 'cronológico', duracion: 'pausa descriptiva', frecuencia: 'singulativa',
    resumen: 'La librería sin orden alfabético y la trastienda.', ficha: 'Una pausa descriptiva presenta la librería como un desorden con sentido; la trastienda, sin ventanas, es el espacio de la intimidad.' },
  { id: 'ce4', titulo: 'El reloj de arena', parte: 1, desde: 5, hasta: 5, orden: 'cronológico', duracion: 'escena', frecuencia: 'iterativa',
    resumen: 'Ernesto explica la media hora del reloj y calla quién se lo regaló.', ficha: 'El motivo central entra con frecuencia iterativa («le daba la vuelta cada vez…»): el reloj marca el ritmo de todas las conversaciones y, a la vez, impone lo que no se dice.' },
  { id: 'ce5', titulo: 'Las sospechas del barrio', parte: 1, desde: 6, hasta: 6, orden: 'cronológico', duracion: 'sumario', frecuencia: 'iterativa',
    resumen: 'Rafa advierte a Tomás de lo que dice la gente.', ficha: 'El sumario de las semanas de visitas desemboca en el aviso de Rafa, en estilo directo. La sospecha nunca se nombra; el desplazamiento de la mirada de Tomás hacia la arena la dice.' },
  { id: 'ce6', titulo: 'La lluvia', parte: 2, desde: 7, hasta: 7, orden: 'cronológico', duracion: 'escena', frecuencia: 'singulativa',
    resumen: 'Durante una tormenta, sin luz, Ernesto no da la vuelta al reloj.', ficha: 'La regla se suspende: «la lluvia ya cuenta el tiempo por nosotros». La escena abre la confidencia.' },
  { id: 'ce7', titulo: 'La juventud de Ernesto', parte: 2, desde: 8, hasta: 8, orden: 'analepsis', duracion: 'sumario', frecuencia: 'singulativa',
    resumen: 'Ernesto cuenta que quiso ser marino y que alguien lo esperaba en el puerto.', ficha: 'Analepsis externa en estilo indirecto: la voz de Ernesto llega mediada por la del narrador. La persona sin nombre y la lectura en voz baja explican, sin decirlo, el secreto del personaje.' },
  { id: 'ce8', titulo: 'Los jueves', parte: 2, desde: 9, hasta: 9, orden: 'cronológico', duracion: 'sumario', frecuencia: 'iterativa',
    resumen: 'Los préstamos de cada jueves y la canela que Don Julián deja de servir.', ficha: 'El sumario iterativo condensa el invierno. La canela negada es la forma en que el barrio dice su juicio sin palabras.' },
  { id: 'ce9', titulo: 'La noticia', parte: 3, desde: 10, hasta: 10, orden: 'cronológico', duracion: 'escena', frecuencia: 'singulativa',
    resumen: 'El derribo del local y la marcha de Ernesto a la península.', ficha: 'La carta del ayuntamiento es la causa visible; la frase «no es por el aparcamiento» señala la otra, la que el cuento no dice.' },
  { id: 'ce10', titulo: 'La despedida en el muelle', parte: 3, desde: 11, hasta: 11, orden: 'cronológico', duracion: 'escena', frecuencia: 'singulativa',
    resumen: 'Tomás saca libros a escondidas y despide a Ernesto, que le deja un paquete.', ficha: 'El regalo se anuncia con la frase de la media hora: la regla del reloj pasa de Ernesto a Tomás.' },
  { id: 'ce11', titulo: 'El reloj quieto', parte: 3, desde: 12, hasta: 12, orden: 'cronológico', duracion: 'escena', frecuencia: 'singulativa',
    resumen: 'En El Mirlo, Tomás deja el reloj sin darle la vuelta.', ficha: 'El final suspende el tiempo: mientras la arena siga abajo, la conversación no ha terminado. Don Julián vuelve a traer la canela, una reparación pequeña y tardía.' },
];

// El índice de la película (lo que la comprensión deja en `secciones`): una entrada por secuencia, en su
// primer tramo de diálogo (la demo no tiene tramos sin palabras).
PELICULA.secciones = SECUENCIAS.map((s) => {
  const t0 = s.escenas[0]!.t0;
  const k = DIALOGOS.findIndex((d) => d[0] >= t0);
  return { titulo: s.titulo, nivel: 1, unidad: (k < 0 ? DIALOGOS.length - 1 : k) + 1 };
}).filter((x, i, a) => i === 0 || x.unidad !== a[i - 1]!.unidad);
