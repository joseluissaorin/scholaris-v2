/**
 * Lente general: para lo que no encaja en ninguna disciplina concreta. Lo
 * esencial de cada apartado y sus pruebas.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const general: DefinicionLente = {
  id: 'general',
  version: 'general@1',
  segmentos: ['parte', 'apartado'],
  conFicha: ['apartado'],
  guiaEstructura: `Apartados: las divisiones que marque el propio documento (títulos, numeración). Si no las hay, bloques de contenido homogéneo de una a cinco páginas o de tres a diez minutos.`,
  instrucciones: `Lente: lectura atenta general.
Di de qué trata cada apartado, cuál es su idea principal, qué datos o ejemplos da y cómo se relaciona con el resto. Identifica a las personas, obras, lugares e instituciones que aparecen. Señala el género y la finalidad del documento.`,
  datosSegmento: objeto({
    ideaPrincipal: cadena(),
    puntos: cadenas('Lo esencial, en orden.'),
    datos: cadenas('Cifras, fechas y hechos concretos.'),
    relacion: cadena('Cómo se enlaza con lo anterior y lo siguiente.'),
  }, ['ideaPrincipal', 'puntos']),
  datosGlobal: objeto({
    genero: cadena('Qué clase de documento es.'),
    finalidad: cadena(),
    destinatario: cadena(),
    estructura: cadena(),
    ideas: lista(objeto({ idea: cadena(), apartado: cadena() }, ['idea'])),
  }, ['genero', 'finalidad', 'estructura', 'ideas']),
  entidades: ['persona', 'obra', 'lugar', 'organizacion', 'concepto', 'evento', 'fecha'],
};
