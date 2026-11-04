/**
 * Lente clase: la lección, el seminario o la conferencia docente, leídos con la
 * didáctica (objetivos, contenidos, secuencia, ejemplos, actividades,
 * evaluación) y atentos a lo que se escribe en la pizarra o se proyecta.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const clase: DefinicionLente = {
  id: 'clase',
  version: 'clase@1',
  segmentos: ['tema', 'apartado'],
  conFicha: ['tema', 'apartado'],
  guiaEstructura: `Temas: los grandes bloques de contenido que anuncia el docente («hoy vamos a ver…», «pasamos al segundo punto») o que marcan las diapositivas de título. Una clase de una hora suele tener entre dos y seis.
Apartados: dentro de cada tema, los puntos del desarrollo (una definición con sus ejemplos, un ejercicio resuelto, una ronda de preguntas). En apuntes o manuales, los epígrafes.`,
  instrucciones: `Lente: análisis didáctico de una clase.
- Objetivos: qué se pretende que el alumnado entienda o sepa hacer, dicho o implícito.
- Conceptos y definiciones: cada término que se define, con la definición tal como la da el docente; distinciones y clasificaciones.
- Ejemplos y casos: qué ejemplo ilustra qué concepto; ejercicios resueltos paso a paso.
- Pizarra y diapositivas: lo que se escribe o se proyecta (esquemas, fórmulas, citas, gráficos), si el material lo deja ver.
- Secuencia didáctica: cómo se pasa de un punto a otro, recapitulaciones, conexiones con clases anteriores o siguientes.
- Interacción: preguntas del docente, dudas y respuestas del alumnado, debates.
- Referencias: autores, obras y lecturas que se citan o recomiendan.
- Actividades y evaluación: tareas, ejercicios, criterios, fechas de examen o entrega.
Cita las definiciones literalmente: son lo que más se consulta después.`,
  datosSegmento: objeto({
    asunto: cadena(),
    objetivo: cadena(),
    conceptos: lista(objeto({ termino: cadena(), definicion: cadena('Tal como se da en la clase.') }, ['termino', 'definicion'])),
    ejemplos: lista(objeto({ ejemplo: cadena(), ilustra: cadena() }, ['ejemplo'])),
    pizarra: cadenas('Lo escrito o proyectado.'),
    ejercicios: cadenas(),
    preguntas: cadenas('Dudas y preguntas del alumnado o del docente.'),
    referencias: cadenas('Autores y obras citados.'),
    conexiones: cadena('Relación con lo anterior y lo siguiente.'),
  }, ['asunto', 'conceptos']),
  datosGlobal: objeto({
    asignatura: cadena('Materia, nivel y docente, si constan.'),
    objetivos: cadenas(),
    temario: cadenas('Temas en orden.'),
    conceptosClave: lista(objeto({ termino: cadena(), definicion: cadena() }, ['termino', 'definicion'])),
    metodo: cadena('Expositiva, práctica, dialogada, con ejercicios…'),
    referencias: cadenas(),
    tareas: cadenas('Actividades, entregas y evaluación anunciadas.'),
  }, ['objetivos', 'temario', 'conceptosClave']),
  entidades: ['concepto', 'persona', 'obra', 'organizacion', 'evento', 'lugar', 'fecha', 'tema'],
};
