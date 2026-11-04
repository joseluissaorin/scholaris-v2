/**
 * Lente teatro: análisis del texto dramático (Ubersfeld, Pavis, Bobes Naves,
 * García Barrientos). Dramatis personae, acotaciones, formas del diálogo,
 * conflicto, espacio escénico y dramático, tiempo dramático y metateatro.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, ESQUEMA_PARTICIPANTE, lista, objeto } from './comun.js';

export const teatro: DefinicionLente = {
  id: 'teatro',
  version: 'teatro@1',
  segmentos: ['acto', 'cuadro', 'escena'],
  conFicha: ['acto', 'escena'],
  guiaEstructura: `Actos (jornadas en el teatro áureo): los que marque el texto («Acto primero», «Jornada segunda»).
Cuadros: cambios de decorado o de lugar dentro de un acto, si el texto los marca («Cuadro segundo») o si una acotación cambia el espacio escénico.
Escenas: en la convención clásica, cada entrada o salida de un personaje abre una escena; si el texto las numera, se respetan. Si no las numera, una escena es una unidad de acción entre entradas y salidas significativas.`,
  instrucciones: `Lente: análisis dramático.
- Dramatis personae: quién está en escena, quién entra y sale, jerarquía de los personajes y sus funciones actanciales (sujeto, objeto, destinador, destinatario, ayudante, oponente).
- Acotaciones o didascalias: explícitas (del autor) e implícitas (en el diálogo); qué indican sobre espacio, gesto, movimiento, voz, luz, música y vestuario.
- Formas del diálogo: diálogo, monólogo, soliloquio, aparte, réplica, esticomitia, tirada; quién domina la palabra.
- Acción: exposición, nudo, clímax y desenlace; conflicto (de quién contra quién o contra qué), peripecia, anagnórisis, tensión dramática y su progresión.
- Espacio: escénico (lo que se ve en el escenario) y dramático (el mundo que se evoca), espacio latente y fuera de escena; decorado.
- Tiempo: tiempo dramático (de la historia) frente a tiempo escénico (de la representación), elipsis entre actos, unidades.
- Metateatro: teatro dentro del teatro, alusiones a la representación, ruptura de la cuarta pared.
- Lenguaje: verso o prosa (si es verso, la polimetría y su función), registro, humor, ironía dramática.
Si hay noticias de puestas en escena o de estreno, son contexto externo y se marcan.`,
  datosSegmento: objeto({
    enEscena: lista(ESQUEMA_PARTICIPANTE),
    entradasSalidas: cadenas('Quién entra o sale y cuándo.'),
    acotaciones: cadenas('Acotaciones significativas, literales o resumidas.'),
    formaDialogo: cadenas('Diálogo, monólogo, soliloquio, aparte, esticomitia…'),
    accion: cadena(),
    conflicto: cadena('Qué se enfrenta aquí.'),
    espacioEscenico: cadena(),
    espacioDramatico: cadena('Lugares evocados fuera de escena.'),
    tiempo: cadena('Tiempo dramático y relación con lo anterior.'),
    tension: cadena('Cómo sube o baja la tensión.'),
    funcion: cadena('Qué función cumple en la estructura dramática.'),
  }, ['enEscena', 'accion', 'conflicto', 'funcion']),
  datosGlobal: objeto({
    estructura: cadena('Actos, cuadros y progresión de la acción.'),
    conflicto: cadena('Conflicto central y conflictos secundarios.'),
    personajes: lista(objeto({ nombre: cadena(), papel: cadena(), funcion: cadena('Función actancial.') }, ['nombre', 'papel'])),
    espacio: cadena('Espacio escénico y dramático.'),
    tiempo: cadena('Tiempo dramático frente a tiempo escénico.'),
    lenguaje: cadena('Verso o prosa, polimetría, registro.'),
    metateatro: cadena(),
    genero: cadena('Tragedia, comedia, drama, auto, entremés, farsa…'),
    sentido: cadena('Interpretación de conjunto.'),
  }, ['estructura', 'conflicto', 'personajes', 'genero', 'sentido']),
  entidades: ['personaje', 'lugar', 'objeto', 'motivo', 'persona', 'obra', 'evento', 'concepto', 'organizacion'],
};
