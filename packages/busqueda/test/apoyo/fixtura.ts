/**
 * Biblioteca de prueba: cuatro documentos (es, en, la y una entrevista en audio),
 * 30 fragmentos con anclas reales (folios impresos, romanos, tramos de tiempo),
 * una lámina sin texto con su figura, y vectores del embebedor falso.
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
    id: 'doc-foucault',
    tipo: 'pdf',
    metadatos: {
      titulo: 'Vigilar y castigar', subtitulo: 'Nacimiento de la prisión',
      autores: [{ nombre: 'Michel', apellidos: 'Foucault' }], anio: 2002, anioOriginal: 1975,
      editorial: 'Siglo XXI', lugar: 'Buenos Aires', idioma: 'es', tipoCSL: 'book', isbn: '9789872102803',
    },
    unidades: [
      { id: 'un-fou-xiv', ancla: pag(14, 'xiv', true), impresa: 'xiv', fragmentos: [
        { id: 'fr-fou-01', texto: 'Índice. I. Suplicio 11. II. Castigo 77. III. Disciplina 139. IV. Prisión 233.', seccion: ['Índice'] },
      ] },
      { id: 'un-fou-011', ancla: pag(25, '11'), impresa: '11', fragmentos: [
        { id: 'fr-fou-02', texto: 'Damiens fue condenado el 2 de marzo de 1757 a pública retractación ante la puerta principal de la iglesia de París. El suplicio era un ceremonial del poder soberano sobre el cuerpo del condenado.', seccion: ['Suplicio', 'El cuerpo de los condenados'] },
        { id: 'fr-fou-03', texto: 'En pocas décadas desapareció el cuerpo supliciado, descuartizado, amputado, como blanco principal de la represión penal. El castigo dejó de ser un espectáculo público.', seccion: ['Suplicio', 'El cuerpo de los condenados'] },
      ] },
      { id: 'un-fou-139', ancla: pag(153, '139'), impresa: '139', fragmentos: [
        { id: 'fr-fou-04', texto: 'Es dócil un cuerpo que puede ser sometido, que puede ser utilizado, que puede ser transformado y perfeccionado. La disciplina fabrica así cuerpos sometidos y ejercitados, cuerpos dóciles.', seccion: ['Disciplina', 'Los cuerpos dóciles'] },
        { id: 'fr-fou-05', texto: 'La disciplina aumenta las fuerzas del cuerpo en términos económicos de utilidad y disminuye esas mismas fuerzas en términos políticos de obediencia.', seccion: ['Disciplina', 'Los cuerpos dóciles'] },
      ] },
      { id: 'un-fou-199', ancla: pag(213, '199'), impresa: '199', fragmentos: [
        { id: 'fr-fou-06', texto: 'El Panóptico de Bentham es la figura arquitectónica de esta composición: en la periferia, una construcción en forma de anillo; en el centro, una torre con anchas ventanas que se abren sobre la cara interior del anillo.', seccion: ['Disciplina', 'El panoptismo'] },
        { id: 'fr-fou-07', texto: 'De ahí el efecto mayor del Panóptico: inducir en el detenido un estado consciente y permanente de visibilidad que garantiza el funcionamiento automático del poder. La vigilancia es permanente en sus efectos, incluso si es discontinua en su acción.', seccion: ['Disciplina', 'El panoptismo'], anclaFin: pag(214, '200') },
      ] },
      { id: 'un-fou-200', ancla: pag(214, '200'), impresa: '200', fragmentos: [
        { id: 'fr-fou-08', texto: 'El Panóptico es una máquina de disociar la pareja ver y ser visto: en el anillo periférico se es totalmente visto, sin ver jamás; en la torre central, se ve todo, sin ser jamás visto.', seccion: ['Disciplina', 'El panoptismo'] },
      ] },
      { id: 'un-fou-233', ancla: pag(247, '233'), impresa: '233', fragmentos: [
        { id: 'fr-fou-09', texto: 'La prisión se ha constituido fuera del aparato judicial, cuando se elaboraron a través de todo el cuerpo social los procedimientos para repartir a los individuos, fijarlos y distribuirlos espacialmente.', seccion: ['Prisión', 'Unas instituciones completas y austeras'] },
      ] },
    ],
  },
  {
    id: 'doc-lewis',
    tipo: 'pdf',
    metadatos: {
      titulo: 'The Discarded Image', subtitulo: 'An Introduction to Medieval and Renaissance Literature',
      autores: [{ nombre: 'C. S.', apellidos: 'Lewis' }], anio: 1964,
      editorial: 'Cambridge University Press', lugar: 'Cambridge', idioma: 'en', tipoCSL: 'book',
    },
    unidades: [
      { id: 'un-lew-010', ancla: pag(20, '10'), impresa: '10', fragmentos: [
        { id: 'fr-lew-01', texto: 'Medieval man was not a dreamer nor a wanderer. He was an organiser, a codifier, a builder of systems. He wanted a place for everything and everything in the right place.', seccion: ['The Medieval Situation'] },
        { id: 'fr-lew-02', texto: 'The Model of the universe which medieval thinkers built was a synthesis of theology, science and history into a single, complex, harmonious mental model.', seccion: ['The Medieval Situation'] },
      ] },
      { id: 'un-lew-075', ancla: pag(85, '75'), impresa: '75', fragmentos: [
        { id: 'fr-lew-03', texto: 'Boethius wrote the Consolation of Philosophy in prison while awaiting execution. For centuries it was one of the most influential books in Europe, and Fortune with her wheel became a commonplace.', seccion: ['Selected Materials: The Seminal Period', 'Boethius'] },
        { id: 'fr-lew-04', texto: 'The wheel of Fortune turns: those raised to the top will fall. Boethius makes Philosophy argue that true happiness cannot depend on the gifts of Fortune.', seccion: ['Selected Materials: The Seminal Period', 'Boethius'] },
      ] },
      { id: 'un-lew-098', ancla: pag(108, '98'), impresa: '98', fragmentos: [
        { id: 'fr-lew-05', texto: 'The central Earth is surrounded by a series of hollow and transparent spheres, one above the other. Each sphere carries a luminous body: the Moon, Mercury, Venus, the Sun, Mars, Jupiter and Saturn.', seccion: ['The Heavens'] },
        { id: 'fr-lew-06', texto: 'Beyond the sphere of the fixed stars lies the Primum Mobile, and beyond that the Empyrean, the true Heaven, full of God. The cosmos of the medieval model is finite and ordered.', seccion: ['The Heavens'] },
      ] },
      { id: 'un-lew-099', ancla: pag(109, null), impresa: null, fragmentos: [], figura: { id: 'fg-lew-01', pie: 'Lámina: las esferas del cosmos ptolemaico', descripcion: 'Diagrama de esferas concéntricas alrededor de la Tierra con los planetas y el primer móvil.' } },
      { id: 'un-lew-122', ancla: pag(132, '122'), impresa: '122', fragmentos: [
        { id: 'fr-lew-07', texto: 'The Longaevi, the long-livers, are the fairies of medieval belief: creatures of the borderland between angels and men, of whom the Model never quite found a place.', seccion: ['The Longaevi'] },
        { id: 'fr-lew-08', texto: '[Note added to this test edition, not by Lewis: the transformer architecture did not exist in 1964; nothing in this book concerns language models.]', seccion: ['Epilogue'] },
      ] },
    ],
  },
  {
    id: 'doc-boecio',
    tipo: 'pdf',
    metadatos: {
      titulo: 'De consolatione philosophiae', autores: [{ nombre: 'Anicius Manlius Severinus', apellidos: 'Boethius' }],
      anio: 2005, anioOriginal: 524, editorial: 'Teubner', lugar: 'Monachii et Lipsiae', idioma: 'la', tipoCSL: 'book',
      editores: [{ nombre: 'Claudio', apellidos: 'Moreschini' }],
    },
    unidades: [
      { id: 'un-boe-003', ancla: pag(23, '3'), impresa: '3', fragmentos: [
        { id: 'fr-boe-01', texto: 'Carmina qui quondam studio florente peregi, flebilis heu maestos cogor inire modos.', seccion: ['Liber I', 'Carmen I'] },
        { id: 'fr-boe-02', texto: 'Haec dum mecum tacitus ipse reputarem querimoniamque lacrimabilem stili officio signarem, astitisse mihi supra verticem visa est mulier reverendi admodum vultus.', seccion: ['Liber I', 'Prosa I'] },
      ] },
      { id: 'un-boe-031', ancla: pag(51, '31'), impresa: '31', fragmentos: [
        { id: 'fr-boe-03', texto: 'Haec nostra vis est, hunc continuum ludum ludimus: rotam volubili orbe versamus, infima summis summa infimis mutare gaudemus. Fortuna loquitur.', seccion: ['Liber II', 'Prosa II'] },
        { id: 'fr-boe-04', texto: 'Ascende, si placet, sed ea lege ne, cum ludicri mei ratio poscet, descendere iniuriam putes.', seccion: ['Liber II', 'Prosa II'] },
      ] },
      { id: 'un-boe-052', ancla: pag(72, '52'), impresa: '52', fragmentos: [
        { id: 'fr-boe-05', texto: 'Beatitudo est status bonorum omnium congregatione perfectus.', seccion: ['Liber III', 'Prosa II'] },
        { id: 'fr-boe-06', texto: 'Deum rerum omnium principem bonum esse communis humanorum conceptio probat animorum. Sed perfectum bonum veram esse beatitudinem constituimus; veram igitur beatitudinem in summo deo sitam esse necesse est.', seccion: ['Liber III', 'Prosa X'] },
      ] },
      { id: 'un-boe-120', ancla: pag(140, '120'), impresa: '120', fragmentos: [
        { id: 'fr-boe-07', texto: 'Deum igitur aeternum esse cunctorum ratione degentium commune iudicium est. … Aeternitas igitur est interminabilis vitae tota simul et perfecta possessio.', seccion: ['Liber V', 'Prosa VI'] },
      ] },
    ],
  },
  {
    id: 'doc-almeida',
    tipo: 'audio',
    metadatos: {
      titulo: 'Entrevista a Ramiro Almeida en la Universidad de Valdeluz', autores: [{ nombre: 'Ramiro', apellidos: 'Almeida' }],
      anio: 2026, idioma: 'es', tipoCSL: 'interview', lugar: 'Valdeluz',
    },
    unidades: [
      { id: 'un-ser-1', ancla: { tipo: 'tiempo', t0: 0, t1: 95, hablante: 'Almeida' }, fragmentos: [
        { id: 'fr-ser-01', texto: 'Empecé a escribir canciones en la lengua en la que pensaba y en la que me enamoraba. La canción es un territorio de libertad.', seccion: ['Los comienzos'] },
        { id: 'fr-ser-02', texto: 'Bécquer me enseñó que la poesía no es un adorno: es una manera de mirar. Ponerle música a sus versos fue un acto de gratitud.', seccion: ['Bécquer y la cárcel'] },
      ] },
      { id: 'un-ser-2', ancla: { tipo: 'tiempo', t0: 95, t1: 240, hablante: 'Almeida' }, fragmentos: [
        { id: 'fr-ser-03', texto: 'Con los poemas escritos desde la cárcel pasó algo parecido: hablan de la libertad con una fuerza que ninguna prisión puede encerrar.', seccion: ['Bécquer y la cárcel'] },
        { id: 'fr-ser-04', texto: 'La censura nos vigilaba constantemente; aprendimos a decir las cosas de otra manera. La vigilancia del poder también enseña a escribir.', seccion: ['La censura'] },
      ] },
      { id: 'un-ser-3', ancla: { tipo: 'tiempo', t0: 240, t1: 400, hablante: 'Almeida' }, fragmentos: [
        { id: 'fr-ser-05', texto: '«Puerto de invierno» nació en una pensión del muelle, mirando al mar. No pensé que acabaría siendo la canción de tanta gente.', seccion: ['Puerto de invierno'] },
        { id: 'fr-ser-06', texto: 'A los estudiantes les diría que lean, que lean mucho, y que desconfíen de quien les prometa la felicidad a cambio de obediencia.', seccion: ['Consejos'] },
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
