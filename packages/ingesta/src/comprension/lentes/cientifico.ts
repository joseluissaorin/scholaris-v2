/**
 * Lente científica: el artículo, la tesis o el informe de investigación con la
 * estructura IMRyD (introducción, método, resultados y discusión) y la lectura
 * crítica de la metodología: pregunta, hipótesis, marco teórico, diseño,
 * muestra, instrumentos, análisis, resultados con cifras, limitaciones y contribución.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto, opcion } from './comun.js';

const SECCION = ['resumen', 'introducción', 'estado de la cuestión', 'marco teórico', 'método', 'resultados', 'discusión', 'conclusiones', 'anexo', 'bibliografía', 'otra'] as const;

export const cientifico: DefinicionLente = {
  id: 'cientifico',
  version: 'cientifico@1',
  segmentos: ['parte', 'apartado'],
  conFicha: ['apartado'],
  guiaEstructura: `Partes: en tesis y libros, los capítulos o partes; en un artículo no suele haberlas.
Apartados: las secciones del documento (Resumen, Introducción, Método, Resultados, Discusión, Conclusiones) y sus subapartados numerados. Si el documento no las titula, los bloques que cumplan esas funciones.`,
  instrucciones: `Lente: lectura crítica de la investigación.
- Estructura IMRyD: qué función cumple cada sección (introducción, método, resultados, discusión) y si cumple con ella.
- Pregunta de investigación, objetivos e hipótesis, explícitos o implícitos.
- Marco teórico y estado de la cuestión: con qué teorías y trabajos dialoga, qué hueco dice llenar.
- Método: diseño (experimental, cuasiexperimental, observacional, cualitativo, de corpus, computacional, revisión sistemática…), muestra o corpus (tamaño, selección, sesgos), instrumentos y variables, procedimiento, análisis (pruebas estadísticas, modelos, codificación).
- Datos y resultados: las cifras exactas (porcentajes, medias, intervalos, p, tamaños del efecto), tablas y figuras que las contienen.
- Discusión: interpretación de los resultados, comparación con otros trabajos, alternativas, generalización.
- Limitaciones (las que reconocen los autores y las que se observan) y contribución.
- Obras con que discute: a quién confirma, a quién rebate.
Copia las cifras tal como están en el texto y no redondees.`,
  datosSegmento: objeto({
    seccion: opcion(SECCION, 'Función de la sección en el artículo.'),
    idea: cadena(),
    afirmaciones: lista(objeto({ afirmacion: cadena(), apoyo: cadena('Dato, cita o razonamiento que la sostiene.') }, ['afirmacion'])),
    metodo: cadena('Diseño, muestra, instrumentos o análisis que se describen aquí.'),
    resultados: lista(objeto({ resultado: cadena(), cifra: cadena('Cifra literal.') }, ['resultado'])),
    figurasTablas: cadenas('Tablas y figuras mencionadas y lo que muestran.'),
    citas: cadenas('Trabajos con que discute aquí.'),
    limitaciones: cadenas(),
  }, ['seccion', 'idea', 'afirmaciones']),
  datosGlobal: objeto({
    pregunta: cadena('Pregunta de investigación.'),
    hipotesis: cadenas(),
    marco: cadena('Marco teórico y estado de la cuestión.'),
    diseno: cadena('Tipo de estudio.'),
    muestra: cadena('Muestra, corpus o datos: tamaño y selección.'),
    instrumentos: cadenas('Instrumentos, variables y medidas.'),
    analisis: cadena('Técnicas de análisis.'),
    resultados: lista(objeto({ resultado: cadena(), cifra: cadena() }, ['resultado'])),
    discusion: cadena(),
    limitaciones: cadenas(),
    contribucion: cadena(),
    dialoga: lista(objeto({ obra: cadena(), relacion: cadena('Confirma, amplía, rebate…') }, ['obra'])),
  }, ['pregunta', 'diseno', 'muestra', 'resultados', 'limitaciones', 'contribucion']),
  entidades: ['concepto', 'persona', 'obra', 'organizacion', 'lugar', 'evento', 'fecha', 'objeto'],
};
