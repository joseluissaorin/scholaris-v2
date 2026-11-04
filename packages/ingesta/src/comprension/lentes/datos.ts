/**
 * Lente datos: hojas de cálculo, tablas y conjuntos de datos, leídos con la
 * estadística descriptiva y la documentación de datos: qué se mide, unidad de
 * análisis, variables y unidades, población y período, fuentes, hallazgos,
 * calidad y lagunas.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const datos: DefinicionLente = {
  id: 'datos',
  version: 'datos@1',
  segmentos: ['parte', 'tabla'],
  conFicha: ['tabla'],
  guiaEstructura: `Partes: las hojas de un libro de cálculo o los ficheros de un conjunto de datos, si hay varios.
Tablas: cada tabla con encabezados propios (una hoja puede contener varias, separadas por filas en blanco o por títulos). Las tablas auxiliares (leyendas, notas metodológicas) también son tablas.`,
  instrucciones: `Lente: lectura de datos.
- Qué mide la tabla: el fenómeno, la unidad de análisis (persona, hogar, municipio, año, obra…) y lo que representa cada fila.
- Variables: nombre de cada columna, qué significa, tipo (categórica, ordinal, numérica, fecha, texto) y unidad de medida; códigos y categorías.
- Población, muestra y período: a quién o a qué cubre, cuándo y dónde.
- Fuentes: de dónde salen los datos, si consta (organismo, encuesta, registro), y la metodología declarada.
- Hallazgos: máximos, mínimos, tendencias, totales y diferencias notables, con las cifras exactas y la fila o celda donde están.
- Calidad: valores faltantes, celdas vacías, inconsistencias, duplicados, cambios de unidad o de criterio, notas a pie.
No calcules lo que no puedas verificar en el material; si haces una cuenta, di cuál.`,
  datosSegmento: objeto({
    titulo: cadena(),
    mide: cadena('Qué fenómeno mide.'),
    unidadAnalisis: cadena('Qué es cada fila.'),
    variables: lista(objeto({ nombre: cadena(), significado: cadena(), tipo: cadena(), unidad: cadena() }, ['nombre'])),
    poblacion: cadena('Población o muestra.'),
    periodo: cadena(),
    fuente: cadena(),
    hallazgos: lista(objeto({ hallazgo: cadena(), cifra: cadena('Cifra literal.') }, ['hallazgo'])),
    calidad: cadenas('Faltantes, inconsistencias, notas metodológicas.'),
  }, ['mide', 'unidadAnalisis', 'variables', 'hallazgos']),
  datosGlobal: objeto({
    descripcion: cadena('Qué es el conjunto de datos y para qué sirve.'),
    tablas: cadenas('Tablas u hojas y su contenido.'),
    cobertura: cadena('Población, ámbito y período.'),
    fuentes: cadenas(),
    metodologia: cadena(),
    hallazgos: lista(objeto({ hallazgo: cadena(), cifra: cadena() }, ['hallazgo'])),
    calidad: cadena('Calidad y lagunas de conjunto.'),
    usos: cadenas('Preguntas que estos datos permiten responder.'),
  }, ['descripcion', 'tablas', 'cobertura', 'hallazgos']),
  entidades: ['concepto', 'organizacion', 'lugar', 'fecha', 'persona', 'evento', 'obra'],
};
