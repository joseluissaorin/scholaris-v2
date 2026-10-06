/**
 * Biblioteca de prueba: cuatro obras reales de dominio público (es, en, la y un
 * discurso grabado), 30 fragmentos con texto LITERAL de las ediciones digitales
 * que se indican en cada documento, una lámina sin texto con su figura, y
 * vectores del embebedor falso.
 *
 * Los folios del Quijote y de Boecio son los de las copias en PDF de esta
 * biblioteca de prueba (las ediciones digitales no tienen páginas); los de Darwin,
 * los de la primera edición. Nadie dice aquí nada que no escribiera o dijera.
 */
import type { Ancla, AnclaPagina, Documento, MetadatosDocumento, SQL } from '@scholaris/nucleo';
import { vectorABytes } from '@scholaris/nucleo';
import type { EmbebedorFalso } from './falsos.js';

export const pag = (fisica: number, impresa: string | null, romana = false): AnclaPagina => ({ tipo: 'pagina', fisica, impresa, romana, origen: 'leido', confianza: 0.98 });

export interface DocFixtura {
  id: string;
  tipo: Documento['tipo'];
  metadatos: MetadatosDocumento;
  /** Unidades: id, ancla, fragmentos (texto, sección) y figura opcional. */
  unidades: Array<{ id: string; ancla: Ancla; impresa?: string | null; fragmentos: Array<{ id: string; texto: string; seccion: string[]; anclaFin?: Ancla }>; figura?: { id: string; pie: string; descripcion: string } }>;
}

export const DOCUMENTOS: DocFixtura[] = [
  {
    // Cervantes, «Don Quijote» (1605-1615). Texto: Project Gutenberg n.º 2000, https://www.gutenberg.org/ebooks/2000
    id: 'doc-quijote',
    tipo: 'pdf',
    metadatos: {
      titulo: 'Don Quijote', autores: [{ nombre: 'Miguel de', apellidos: 'Cervantes Saavedra' }], anio: 1999, anioOriginal: 1605,
      editorial: 'Project Gutenberg', idioma: 'es', tipoCSL: 'book', url: 'https://www.gutenberg.org/ebooks/2000',
    },
    unidades: [
      { id: 'un-q-xiv', ancla: pag(14, 'xiv', true), impresa: 'xiv', fragmentos: [
        { id: 'fr-q-01', texto: "Y así, ¿qué podrá engendrar el estéril y mal cultivado ingenio mío, sino la historia de un hijo seco, avellanado, antojadizo y lleno de pensamientos varios y nunca imaginados de otro alguno, bien como quien se engendró en una cárcel, donde toda incomodidad tiene su asiento y donde todo triste ruido hace su habitación?", seccion: ["Primera parte", "Prólogo"] },
      ] },
      { id: 'un-q-011', ancla: pag(25, '11'), impresa: '11', fragmentos: [
        { id: 'fr-q-02', texto: "En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo de los de lanza en astillero, adarga antigua, rocín flaco y galgo corredor.", seccion: ["Primera parte", "Capítulo I"] },
        { id: 'fr-q-03', texto: "Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lantejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.", seccion: ["Primera parte", "Capítulo I"] },
      ] },
      { id: 'un-q-139', ancla: pag(153, '139'), impresa: '139', fragmentos: [
        { id: 'fr-q-04', texto: "En esto, descubrieron treinta o cuarenta molinos de viento que hay en aquel campo; y, así como don Quijote los vio, dijo a su escudero: — La ventura va guiando nuestras cosas mejor de lo que acertáramos a desear, porque ves allí, amigo Sancho Panza, donde se descubren treinta, o pocos más, desaforados gigantes, con quien pienso hacer batalla y quitarles a todos las vidas, con cuyos despojos comenzaremos a enriquecer; que ésta es buena guerra, y es gran servicio de Dios quitar tan mala simiente de sobre la faz de la tierra.", seccion: ["Primera parte", "Capítulo VIII"] },
        { id: 'fr-q-05', texto: "— Mire vuestra merced —respondió Sancho— que aquellos que allí se parecen no son gigantes, sino molinos de viento, y lo que en ellos parecen brazos son las aspas, que, volteadas del viento, hacen andar la piedra del molino.", seccion: ["Primera parte", "Capítulo VIII"] },
      ] },
      { id: 'un-q-199', ancla: pag(213, '199'), impresa: '199', fragmentos: [
        { id: 'fr-q-06', texto: "— Ésta es cadena de galeotes, gente forzada del rey, que va a las galeras. — ¿Cómo gente forzada? —preguntó don Quijote—. ¿Es posible que el rey haga fuerza a ninguna gente?", seccion: ["Primera parte", "Capítulo XXII"] },
        { id: 'fr-q-07', texto: "— No digo eso —respondió Sancho—, sino que es gente que, por sus delitos, va condenada a servir al rey en las galeras de por fuerza. — En resolución —replicó don Quijote—, comoquiera que ello sea, esta gente, aunque los llevan, van de por fuerza, y no de su voluntad.", seccion: ["Primera parte", "Capítulo XXII"], anclaFin: pag(214, '200') },
      ] },
      { id: 'un-q-200', ancla: pag(214, '200'), impresa: '200', fragmentos: [
        { id: 'fr-q-08', texto: "— Pues desa manera —dijo su amo—, aquí encaja la ejecución de mi oficio: desfacer fuerzas y socorrer y acudir a los miserables.", seccion: ["Primera parte", "Capítulo XXII"] },
      ] },
      { id: 'un-q-233', ancla: pag(247, '233'), impresa: '233', fragmentos: [
        { id: 'fr-q-09', texto: "La libertad, Sancho, es uno de los más preciosos dones que a los hombres dieron los cielos; con ella no pueden igualarse los tesoros que encierra la tierra ni el mar encubre; por la libertad, así como por la honra, se puede y debe aventurar la vida, y, por el contrario, el cautiverio es el mayor mal que puede venir a los hombres.", seccion: ["Segunda parte", "Capítulo LVIII"] },
      ] },
    ],
  },
  {
    // Darwin, «On the Origin of Species» (1859, 1.ª ed., John Murray). Texto: Project Gutenberg n.º 1228,
    // https://www.gutenberg.org/ebooks/1228. Folios de la primera edición, cotejados con darwin-online.org.uk (F373): pp. 1, 80-81,
    // 116 y 490; el diagrama es una lámina plegada sin folio que mira a la p. 117.
    id: 'doc-darwin',
    tipo: 'pdf',
    metadatos: {
      titulo: 'On the Origin of Species', subtitulo: 'By Means of Natural Selection, or the Preservation of Favoured Races in the Struggle for Life',
      autores: [{ nombre: 'Charles', apellidos: 'Darwin' }], anio: 1859,
      editorial: 'John Murray', lugar: 'London', idioma: 'en', tipoCSL: 'book',
    },
    unidades: [
      { id: 'un-dar-001', ancla: pag(15, '1'), impresa: '1', fragmentos: [
        { id: 'fr-dar-01', texto: "When on board H.M.S. ‘Beagle,’ as naturalist, I was much struck with certain facts in the distribution of the inhabitants of South America, and in the geological relations of the present to the past inhabitants of that continent.", seccion: ["Introduction"] },
        { id: 'fr-dar-02', texto: "These facts seemed to me to throw some light on the origin of species—that mystery of mysteries, as it has been called by one of our greatest philosophers.", seccion: ["Introduction"] },
      ] },
      { id: 'un-dar-080', ancla: pag(94, '80'), impresa: '80', fragmentos: [
        { id: 'fr-dar-03', texto: "If such do occur, can we doubt (remembering that many more individuals are born than can possibly survive) that individuals having any advantage, however slight, over others, would have the best chance of surviving and of procreating their kind?", seccion: ["Chapter IV", "Natural Selection"], anclaFin: pag(95, '81') },
      ] },
      { id: 'un-dar-081', ancla: pag(95, '81'), impresa: '81', fragmentos: [
        { id: 'fr-dar-04', texto: "On the other hand, we may feel sure that any variation in the least degree injurious would be rigidly destroyed. This preservation of favourable variations and the rejection of injurious variations, I call Natural Selection.", seccion: ["Chapter IV", "Natural Selection"] },
      ] },
      { id: 'un-dar-116', ancla: pag(130, '116'), impresa: '116', fragmentos: [
        { id: 'fr-dar-05', texto: "The accompanying diagram will aid us in understanding this rather perplexing subject. Let A to L represent the species of a genus large in its own country; these species are supposed to resemble each other in unequal degrees, as is so generally the case in nature, and as is represented in the diagram by the letters standing at unequal distances.", seccion: ["Chapter IV", "Divergence of Character"] },
      ] },
      { id: 'un-dar-lam', ancla: pag(131, null), impresa: null, fragmentos: [], figura: { id: 'fg-dar-01', pie: 'Lámina: el diagrama de la divergencia de caracteres', descripcion: 'Diagrama plegado sin texto: las especies A a L de un género en la base y líneas que se ramifican hacia arriba entre horizontales numeradas de I a XIV, cada intervalo de mil generaciones.' } },
      { id: 'un-dar-490', ancla: pag(504, '490'), impresa: '490', fragmentos: [
        { id: 'fr-dar-06', texto: "Thus, from the war of nature, from famine and death, the most exalted object which we are capable of conceiving, namely, the production of the higher animals, directly follows.", seccion: ["Chapter XIV", "Recapitulation and Conclusion"] },
        { id: 'fr-dar-07', texto: "There is grandeur in this view of life, with its several powers, having been originally breathed into a few forms or into one; and that, whilst this planet has gone cycling on according to the fixed law of gravity, from so simple a beginning endless forms most beautiful and most wonderful have been, and are being, evolved.", seccion: ["Chapter XIV", "Recapitulation and Conclusion"] },
      ] },
    ],
  },
  {
    // Boecio, «De consolatione philosophiae» (c. 524). Texto latino de Wikisource:
    // https://la.wikisource.org/wiki/De_philosophiae_consolatione (grafía con u por v, como allí).
    id: 'doc-boecio',
    tipo: 'pdf',
    metadatos: {
      titulo: 'De consolatione philosophiae', autores: [{ nombre: 'Anicius Manlius Severinus', apellidos: 'Boethius' }],
      anio: 524, idioma: 'la', tipoCSL: 'book', url: 'https://la.wikisource.org/wiki/De_philosophiae_consolatione',
    },
    unidades: [
      { id: 'un-boe-003', ancla: pag(23, '3'), impresa: '3', fragmentos: [
        { id: 'fr-boe-01', texto: "Carmina qui quondam studio florente peregi, Flebilis heu maestos cogor inire modos.", seccion: ["Liber I", "Metrum I"] },
        { id: 'fr-boe-02', texto: "Haec dum mecum tacitus ipse reputarem querimoniamque lacrimabilem stili officio signarem astitisse mihi supra uerticem uisa est mulier reuerendi admodum uultus, oculis ardentibus et ultra communem hominum ualentiam perspicacibus, colore uiuido atque inexhausti uigoris, quamuis ita aeui plena foret ut nullo modo nostrae crederetur aetatis, statura discretionis ambiguae.", seccion: ["Liber I", "Prosa I"] },
      ] },
      { id: 'un-boe-031', ancla: pag(51, '31'), impresa: '31', fragmentos: [
        { id: 'fr-boe-03', texto: "Fortunae te regendum dedisti, dominae moribus oportet obtemperes.", seccion: ["Liber II", "Prosa I"] },
        { id: 'fr-boe-04', texto: "Haec nostra uis est, hunc continuum ludum ludimus: rotam uolubili orbe uersamus, infima summis, summa infimis mutare gaudemus. Ascende si placet, sed ea lege, ne uti cum ludicri mei ratio poscet descendere iniuriam putes.", seccion: ["Liber II", "Prosa II"] },
      ] },
      { id: 'un-boe-052', ancla: pag(72, '52'), impresa: '52', fragmentos: [
        { id: 'fr-boe-05', texto: "Liquet igitur esse beatitudinem statum bonorum omnium congregatione perfectum.", seccion: ["Liber III", "Prosa II"] },
        { id: 'fr-boe-06', texto: "Deum, rerum omnium principem, bonum esse communis humanorum conceptio probat animorum; nam cum nihil deo melius excogitari queat, id quo melius nihil est bonum esse quis dubitet?", seccion: ["Liber III", "Prosa X"] },
      ] },
      { id: 'un-boe-120', ancla: pag(140, '120'), impresa: '120', fragmentos: [
        { id: 'fr-boe-07', texto: "Deum igitur aeternum esse cunctorum ratione degentium commune iudicium est. Quid sit igitur aeternitas consideremus; haec enim nobis naturam pariter diuinam scientiamque patefacit. Aeternitas igitur est interminabilis uitae tota simul et perfecta possessio.", seccion: ["Liber V", "Prosa VI"] },
      ] },
    ],
  },
  {
    // John F. Kennedy, discurso en la Universidad Rice (Houston, 12 de septiembre de 1962); obra del Gobierno
    // federal de EE. UU., de dominio público. Transcripción: https://en.wikisource.org/wiki/We_choose_to_go_to_the_moon
    // Grabación: https://commons.wikimedia.org/wiki/File:Jfk_rice_university_we_choose_to_go_to_the_moon.ogg (1060 s).
    // Los tiempos son aproximados: proporcionales a la posición del pasaje en la transcripción.
    id: 'doc-kennedy',
    tipo: 'audio',
    metadatos: {
      titulo: 'Address at Rice University on the Nation’s Space Effort', autores: [{ nombre: 'John F.', apellidos: 'Kennedy' }],
      anio: 1962, fecha: '1962-09-12', idioma: 'en', tipoCSL: 'speech', lugar: 'Houston',
    },
    unidades: [
      { id: 'un-ken-1', ancla: { tipo: 'tiempo', t0: 99, t1: 318, hablante: 'Kennedy' }, fragmentos: [
        { id: 'fr-ken-01', texto: "No man can fully grasp how far and how fast we have come, but condense, if you will, the 50 thousand years of man's recorded history in a time span of but a half-century. Stated in these terms, we know very little about the first 40 years, except at the end of them advanced man had learned to use the skins of animals to cover them.", seccion: ["Discurso"] },
        { id: 'fr-ken-02', texto: "William Bradford, speaking in 1630 of the founding of the Plymouth Bay Colony, said that all great and honorable actions are accompanied with great difficulties, and both must be enterprised and overcome with answerable courage.", seccion: ["Discurso"] },
      ] },
      { id: 'un-ken-2', ancla: { tipo: 'tiempo', t0: 318, t1: 488, hablante: 'Kennedy' }, fragmentos: [
        { id: 'fr-ken-03', texto: "For the eyes of the world now look into space, to the moon and to the planets beyond, and we have vowed that we shall not see it governed by a hostile flag of conquest, but by a banner of freedom and peace.", seccion: ["Discurso"] },
        { id: 'fr-ken-04', texto: "We set sail on this new sea because there is new knowledge to be gained, and new rights to be won, and they must be won and used for the progress of all people.", seccion: ["Discurso"] },
        { id: 'fr-ken-05', texto: "There is no strife, no prejudice, no national conflict in outer space as yet. Its hazards are hostile to us all. Its conquest deserves the best of all mankind, and its opportunity for peaceful cooperation may never come again.", seccion: ["Discurso"] },
      ] },
      { id: 'un-ken-3', ancla: { tipo: 'tiempo', t0: 488, t1: 1060, hablante: 'Kennedy' }, fragmentos: [
        { id: 'fr-ken-06', texto: "We choose to go to the moon. We choose to go to the moon... (interrupted by applause) we choose to go to the moon in this decade and do the other things, not because they are easy, but because they are hard, because that goal will serve to organize and measure the best of our energies and skills, because that challenge is one that we are willing to accept, one we are unwilling to postpone, and one which we intend to win, and the others, too.", seccion: ["Discurso"] },
        { id: 'fr-ken-07', texto: "Well, space is there, and we're going to climb it, and the moon and the planets are there, and new hopes for knowledge and peace are there. And, therefore, as we set sail we ask God's blessing on the most hazardous and dangerous and greatest adventure on which man has ever embarked.", seccion: ["Discurso"] },
      ] },
    ],
  },
];

export function contarFragmentos(): number {
  return DOCUMENTOS.reduce((n, d) => n + d.unidades.reduce((m, u) => m + u.fragmentos.length, 0), 0);
}

/** Carga la fixtura en una estantería vacía y calcula los vectores con el embebedor falso. */
export async function cargarFixtura(sql: SQL, emb: EmbebedorFalso): Promise<void> {
  const ahora = '2026-10-06T10:00:00Z';
  await sql.ejecutar(`INSERT INTO espacios (id, proveedor, modelo, dims, normalizado, modalidades) VALUES (?, ?, ?, ?, 1, ?)`,
    emb.espacio.id, emb.espacio.proveedor, emb.espacio.modelo, emb.espacio.dims, JSON.stringify(emb.espacio.modalidades));
  for (const d of DOCUMENTOS) {
    const m = d.metadatos;
    await sql.ejecutar(
      `INSERT INTO documentos (id, tipo, metadatos, estado, huella, original, mime, bytes, unidades, creado, actualizado, titulo, autores, anio, idioma)
       VALUES (?, ?, ?, 'listo', ?, '', ?, 1000, ?, ?, ?, ?, ?, ?, ?)`,
      d.id, d.tipo, JSON.stringify(m), `huella-${d.id}`, d.tipo === 'audio' ? 'audio/mpeg' : 'application/pdf', d.unidades.length, ahora, ahora,
      m.titulo, m.autores.map((a) => a.apellidos).join('; '), m.anio ?? null, m.idioma ?? null,
    );
    let ordenU = 0, ordenF = 0;
    for (const u of d.unidades) {
      const texto = u.fragmentos.map((f) => f.texto).join('\n\n');
      await sql.ejecutar(
        `INSERT INTO unidades (id, documento, orden, ancla, texto, lector, confianza, impresa, t0, t1) VALUES (?, ?, ?, ?, ?, 'fixtura', 1, ?, ?, ?)`,
        u.id, d.id, ordenU++, JSON.stringify(u.ancla), texto, u.impresa ?? null,
        u.ancla.tipo === 'tiempo' ? u.ancla.t0 : null, u.ancla.tipo === 'tiempo' ? u.ancla.t1 : null,
      );
      // Vector de la unidad (vía visual): su texto o la descripción de su figura.
      const textoVisual = texto || (u.figura ? `${u.figura.pie}. ${u.figura.descripcion}` : '');
      if (textoVisual) {
        const [v] = await emb.vectorizar([{ modalidad: 'texto', texto: textoVisual }], 'documento');
        await sql.ejecutar(`INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('unidad', ?, ?, ?, ?)`, u.id, emb.espacio.id, d.id, vectorABytes(v!));
      }
      if (u.figura) {
        await sql.ejecutar(`INSERT INTO figuras (id, documento, unidad, imagen, pie, descripcion, ancla) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          u.figura.id, d.id, u.id, `img/${u.figura.id}.png`, u.figura.pie, u.figura.descripcion, JSON.stringify(u.ancla));
        const [v] = await emb.vectorizar([{ modalidad: 'texto', texto: `${u.figura.pie}. ${u.figura.descripcion}` }], 'documento');
        await sql.ejecutar(`INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('figura', ?, ?, ?, ?)`, u.figura.id, emb.espacio.id, d.id, vectorABytes(v!));
      }
      for (const f of u.fragmentos) {
        const contexto = `${m.titulo} (${m.autores[0]?.apellidos}), ${f.seccion.join(' › ')}`;
        await sql.ejecutar(
          `INSERT INTO fragmentos (id, documento, unidad, orden, texto, contexto, seccion, ancla, ancla_fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          f.id, d.id, u.id, ordenF++, f.texto, contexto, JSON.stringify(f.seccion), JSON.stringify(u.ancla), f.anclaFin ? JSON.stringify(f.anclaFin) : null,
        );
        const [v] = await emb.vectorizar([{ modalidad: 'texto', texto: `${contexto}\n${f.texto}` }], 'documento');
        await sql.ejecutar(`INSERT INTO vectores (objetivo, id, espacio, documento, valores) VALUES ('fragmento', ?, ?, ?, ?)`, f.id, emb.espacio.id, d.id, vectorABytes(v!));
      }
    }
  }
}
