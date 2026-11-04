/**
 * Lente narrativa: cuento, novela, relato, crónica novelada. El vocabulario es el
 * de la narratología (Genette, Bal, Pozuelo Yvancos, Garrido Domínguez): historia
 * frente a relato, orden, duración y frecuencia, voz y focalización, discurso.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, ESQUEMA_PARTICIPANTE, lista, objeto, opcion } from './comun.js';

const ORDEN = ['cronológico', 'analepsis', 'prolepsis', 'in medias res', 'mixto'] as const;
const DURACION = ['escena', 'sumario', 'elipsis', 'pausa descriptiva', 'alargamiento'] as const;
const FRECUENCIA = ['singulativa', 'repetitiva', 'iterativa'] as const;
const FOCALIZACION = ['cero', 'interna fija', 'interna variable', 'interna múltiple', 'externa'] as const;

export const narrativa: DefinicionLente = {
  id: 'narrativa',
  version: 'narrativa@1',
  segmentos: ['parte', 'capitulo', 'escena'],
  conFicha: ['capitulo', 'escena'],
  guiaEstructura: `Partes y capítulos: los que marque la obra (números, títulos, blancos tipográficos, asteriscos). Si no los hay, no los inventes.
Escenas: unidades de acción con continuidad de tiempo, lugar y personajes. Una escena cambia cuando hay un salto temporal (elipsis), un cambio de lugar o un cambio de núcleo de la acción, o cuando el relato pasa de mostrar a resumir. Un cuento de veinte páginas suele tener entre ocho y veinte escenas; una novela, las que pida cada capítulo. Las analepsis largas son escenas propias.`,
  instrucciones: `Lente: narratología.
Distingue siempre historia (fábula: los acontecimientos en su orden cronológico) y relato (cómo se cuentan, en qué orden y con qué ritmo).
- Orden: analepsis y prolepsis (con su alcance y su amplitud), comienzo in medias res, anacronías.
- Duración o velocidad: escena (tiempo del relato ≈ tiempo de la historia, con diálogo), sumario, elipsis (explícita o implícita), pausa descriptiva, alargamiento.
- Frecuencia: singulativa, repetitiva, iterativa («todos los domingos…»).
- Voz: quién narra (narrador homodiegético o autodiegético, heterodiegético; intradiegético o extradiegético), desde cuándo narra (narración ulterior, simultánea), a quién (narratario).
- Modo y focalización: cero, interna (fija, variable, múltiple), externa; distancia; restricciones de saber del narrador.
- Discurso de los personajes: estilo directo, indirecto, indirecto libre, monólogo interior, discurso narrativizado; polifonía e ironía.
- Personajes: función en la trama, caracterización (directa, indirecta), transformación; actantes (sujeto, objeto, ayudante, oponente) si ayuda.
- Espacio: real, simbólico, cerrado o abierto, espacios de intimidad frente a espacios públicos.
- Motivos, símbolos, intertextos (citas, alusiones a otras obras y autores), registro y estilo (léxico, humor, oralidad).
En cada escena di qué pasa, quién está, dónde y cuándo, cómo se cuenta y qué función cumple en el conjunto.`,
  datosSegmento: objeto({
    acontecimientos: cadenas('Lo que ocurre, en orden.'),
    personajes: lista(ESQUEMA_PARTICIPANTE),
    espacio: cadena('Lugar y su valor.'),
    tiempoHistoria: cadena('Cuándo ocurre en la historia (momento, día, época).'),
    orden: opcion(ORDEN),
    duracion: opcion(DURACION),
    frecuencia: opcion(FRECUENCIA),
    narrador: cadena('Voz: quién narra y desde dónde.'),
    focalizacion: opcion(FOCALIZACION),
    discurso: cadenas('Modalidades del discurso presentes (directo, indirecto libre, monólogo interior…).'),
    motivos: cadenas(),
    funcionTrama: cadena('Qué función cumple en la trama y en el sentido de la obra.'),
  }, ['acontecimientos', 'personajes', 'orden', 'duracion', 'focalizacion', 'funcionTrama']),
  datosGlobal: objeto({
    fabula: lista(objeto({ acontecimiento: cadena(), segmento: cadena('Id del segmento donde se cuenta.') }, ['acontecimiento']), 'La historia en orden cronológico.'),
    ordenRelato: cadena('Cómo se dispone el relato frente a la historia: anacronías, comienzo, final.'),
    narrador: cadena(),
    focalizacion: cadena(),
    discurso: cadena('Cómo se representan las voces de los personajes.'),
    personajes: lista(objeto({ nombre: cadena(), papel: cadena(), arco: cadena('Cómo cambia.') }, ['nombre', 'papel'])),
    espacios: cadenas(),
    tiempo: cadena('Época de la historia y tiempo de la narración.'),
    estilo: cadena(),
    intertextos: cadenas('Obras, autores y tradiciones con que dialoga (lo externo, marcado).'),
    sentido: cadena('Interpretación: qué propone la obra.'),
  }, ['fabula', 'ordenRelato', 'narrador', 'focalizacion', 'personajes', 'sentido']),
  entidades: ['personaje', 'lugar', 'obra', 'persona', 'objeto', 'motivo', 'organizacion', 'evento', 'concepto'],
};
