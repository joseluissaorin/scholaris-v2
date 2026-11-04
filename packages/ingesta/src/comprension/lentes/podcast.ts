/**
 * Lente pódcast: la conversación o el programa sonoro, con la pragmática del
 * diálogo (Grice, Brown y Levinson, Briz) y el lenguaje radiofónico (Balsebre:
 * palabra, música, efectos y silencio). Formato, secciones, turnos, tesis y tono.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const podcast: DefinicionLente = {
  id: 'podcast',
  version: 'podcast@1',
  segmentos: ['bloque', 'intervencion'],
  conFicha: ['bloque'],
  guiaEstructura: `Bloques: las secciones del programa (presentación, sumario, cada tema o sección fija, anuncios, despedida), separadas a menudo por cortinillas, sintonías o cambios de asunto. Un episodio de una hora suele tener entre cinco y quince.
Intervenciones: turnos largos y significativos de cada voz dentro de un bloque (una exposición, un relato, una opinión desarrollada). No se segmenta cada réplica breve.`,
  instrucciones: `Lente: análisis del pódcast y del lenguaje sonoro.
- Formato: conversación, entrevista, monólogo, tertulia, narrativo o de ficción sonora, divulgativo; secciones fijas, sintonía, cortinillas, música de fondo, anuncios y patrocinios (señálalos como tales).
- Voces: quién habla, en qué papel (presentador, invitado, colaborador), cómo se reparte la palabra.
- Pragmática: actos de habla, turnos (toma, cesión, robo), solapamientos e interrupciones, cortesía y atenuación, implicaturas y presuposiciones, humor e ironía, complicidad con el oyente (apelaciones, guiños).
- Contenido: tesis de cada interlocutor, argumentos, anécdotas, datos, acuerdos y desacuerdos, cambios de postura.
- Lenguaje sonoro: palabra, música (diegética en la grabación o añadida en la edición), efectos, silencios y pausas, tono, ritmo y prosodia cuando el material los deja ver.
Cita las palabras de cada voz tal como están, con su nombre.`,
  datosSegmento: objeto({
    asunto: cadena(),
    clase: cadena('Sección: presentación, tema, entrevista, anuncio, despedida…'),
    voces: lista(objeto({ quien: cadena(), papel: cadena(), tesis: cadena('Lo que sostiene o cuenta.') }, ['quien'])),
    argumentos: cadenas(),
    desacuerdos: cadenas(),
    turnos: cadena('Reparto de la palabra, interrupciones, solapamientos.'),
    pragmatica: cadena('Cortesía, implicaturas, humor, apelaciones al oyente.'),
    sonido: cadena('Música, cortinillas, efectos, silencios.'),
    tono: cadena(),
    funcion: cadena('Qué aporta al episodio.'),
  }, ['asunto', 'clase', 'voces', 'funcion']),
  datosGlobal: objeto({
    formato: cadena('Conversación, entrevista, tertulia, narrativo, divulgativo…'),
    programa: cadena('Nombre del programa, episodio y fecha, si constan.'),
    participantes: lista(objeto({ nombre: cadena(), papel: cadena(), posicion: cadena() }, ['nombre', 'papel'])),
    secciones: cadenas('Secciones en orden.'),
    asuntos: cadenas(),
    tesis: lista(objeto({ quien: cadena(), tesis: cadena() }, ['quien', 'tesis'])),
    dinamica: cadena('Cómo conversan: complicidad, tensión, control del tema.'),
    lenguajeSonoro: cadena('Uso de música, efectos y silencios.'),
  }, ['formato', 'participantes', 'asuntos', 'tesis']),
  entidades: ['persona', 'obra', 'organizacion', 'lugar', 'evento', 'concepto', 'tema', 'obra_musical', 'fecha'],
};
