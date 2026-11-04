/**
 * Lente entrevista: análisis del diálogo desde la pragmática (Austin, Searle,
 * Grice, Brown y Levinson, Briz y el grupo Val.Es.Co., Sacks, Schegloff y
 * Jefferson). Actos de habla, turnos, cortesía y atenuación, implicaturas,
 * presuposiciones, preguntas y respuestas, tesis y desacuerdos.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const entrevista: DefinicionLente = {
  id: 'entrevista',
  version: 'entrevista@1',
  segmentos: ['bloque', 'intervencion'],
  conFicha: ['bloque'],
  guiaEstructura: `Bloques: tramos temáticos de la conversación, cada uno abierto por una pregunta o un cambio de asunto del entrevistador (la infancia, la obra, la política…). Una entrevista de una hora suele tener entre seis y quince.
Intervenciones: cada turno de habla largo y significativo de un interlocutor dentro de un bloque (una respuesta completa, una pregunta extensa). No hace falta segmentar cada réplica breve.`,
  instrucciones: `Lente: pragmática de la entrevista.
- Participantes: quién pregunta y quién responde, en calidad de qué (autoridad, testigo, autor), relación entre ellos y con la audiencia.
- Preguntas: abiertas o cerradas, de seguimiento, repreguntas, preguntas con presuposiciones o cargadas; cuáles se responden, cuáles se esquivan y cómo.
- Actos de habla: asertivos, directivos, compromisivos, expresivos, declarativos; actos indirectos.
- Turnos: toma, cesión y robo de turno, solapamientos e interrupciones, silencios y pausas significativas, quién controla el tema.
- Cortesía y atenuación: estrategias de imagen (positiva y negativa), atenuantes e intensificadores, ironía, humor.
- Implicaturas (lo que se da a entender sin decirlo) y presuposiciones; máximas conversacionales que se violan o se explotan.
- Tesis y posiciones de cada interlocutor, acuerdos y desacuerdos, cambios de postura a lo largo de la conversación.
- Tono y prosodia: énfasis, risas, vacilaciones, ritmo, cuando el material los deja ver (transcripción o audio).
Cita las palabras de cada interlocutor tal como están, con su nombre.`,
  datosSegmento: objeto({
    asunto: cadena(),
    preguntas: lista(objeto({ quien: cadena(), pregunta: cadena(), tipo: cadena('Abierta, cerrada, de seguimiento, cargada…') }, ['pregunta'])),
    respuestas: lista(objeto({ quien: cadena(), tesis: cadena('Lo que sostiene.'), responde: cadena('Responde, esquiva, matiza, reformula…') }, ['quien', 'tesis'])),
    actosHabla: cadenas('Actos de habla relevantes.'),
    turnos: cadena('Quién controla el tema, interrupciones, solapamientos, silencios.'),
    cortesia: cadena('Estrategias de cortesía, atenuación e intensificación.'),
    implicaturas: cadenas('Lo que se da a entender y las presuposiciones.'),
    desacuerdos: cadenas(),
    tono: cadena(),
    funcion: cadena('Qué aporta al conjunto de la entrevista.'),
  }, ['asunto', 'respuestas', 'turnos', 'funcion']),
  datosGlobal: objeto({
    participantes: lista(objeto({ nombre: cadena(), papel: cadena('Entrevistador, entrevistado, moderador…'), posicion: cadena('Tesis y actitud de conjunto.') }, ['nombre', 'papel'])),
    asuntos: cadenas('Temas tratados, en orden.'),
    tesis: lista(objeto({ quien: cadena(), tesis: cadena() }, ['quien', 'tesis'])),
    desacuerdos: cadenas(),
    dinamica: cadena('Control de los turnos y del tema, tensión, complicidad.'),
    pragmatica: cadena('Rasgos pragmáticos dominantes: cortesía, implicaturas, evasivas.'),
    formato: cadena('Medio, duración, contexto de la entrevista.'),
  }, ['participantes', 'asuntos', 'tesis', 'dinamica']),
  entidades: ['persona', 'obra', 'organizacion', 'lugar', 'evento', 'concepto', 'tema', 'fecha', 'obra_musical'],
};
