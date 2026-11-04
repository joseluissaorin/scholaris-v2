/**
 * Lente ensayo: retórica y teoría de la argumentación (Aristóteles, Perelman y
 * Olbrechts-Tyteca, Toulmin, Lausberg, Weston). Tesis, tipología de los
 * argumentos, estructura, refutación, falacias, dispositio, autoridades, estilo y ethos.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto, opcion } from './comun.js';

const ESTRUCTURA = ['deductiva', 'inductiva', 'encuadrada', 'paralela', 'en espiral', 'otra'] as const;
const ARGUMENTO = ['autoridad', 'analogía', 'ejemplo', 'causa y efecto', 'reducción al absurdo', 'datos', 'definición', 'experiencia personal', 'mayoría', 'tradición', 'consecuencias', 'otro'] as const;

export const ensayo: DefinicionLente = {
  id: 'ensayo',
  version: 'ensayo@1',
  segmentos: ['parte', 'apartado'],
  conFicha: ['apartado'],
  guiaEstructura: `Partes: las grandes divisiones que marque la obra (partes, capítulos, ensayos de un libro misceláneo).
Apartados: epígrafes o secciones numeradas; si no los hay, movimientos del argumento de una a cinco páginas (planteamiento, desarrollo de cada línea argumental, objeciones, conclusión).`,
  instrucciones: `Lente: retórica y argumentación.
- Tesis: la idea que se defiende, explícita o implícita; dónde aparece.
- Argumentos y su tipología: de autoridad, por analogía, por el ejemplo, causa y efecto, reducción al absurdo, datos, definición, experiencia personal, consecuencias; su fuerza y sus premisas implícitas (garantías, en términos de Toulmin).
- Estructura: deductiva, inductiva, encuadrada, en espiral; dispositio (exordio, narratio, argumentatio con confirmatio y refutatio, peroratio).
- Refutación y contraargumentos: objeciones que se anticipan y cómo se responden; concesiones.
- Falacias: ad hominem, hombre de paja, falsa disyuntiva, generalización apresurada, petición de principio, pendiente resbaladiza…, solo si de verdad las hay.
- Autoridades y obras con que discute: a quién cita, para apoyarse o para rebatir.
- Estilo y ethos: cómo se construye la figura del autor (autoridad, cercanía, ironía), registro, recursos retóricos (interrogación retórica, metáfora argumentativa, ejemplo narrativo), pathos.
Distingue con cuidado lo que el autor afirma, lo que atribuye a otros y lo que concede.`,
  datosSegmento: objeto({
    idea: cadena('Idea principal del apartado.'),
    tesisLocal: cadena('Lo que se sostiene aquí.'),
    argumentos: lista(objeto({ argumento: cadena(), tipo: opcion(ARGUMENTO), premisa: cadena('Premisa implícita, si la hay.') }, ['argumento', 'tipo'])),
    contraargumentos: lista(objeto({ objecion: cadena(), respuesta: cadena() }, ['objecion'])),
    autoridades: lista(objeto({ quien: cadena(), uso: cadena('Para apoyar o para rebatir.') }, ['quien'])),
    falacias: cadenas(),
    recursos: cadenas('Recursos retóricos y de estilo.'),
    funcion: cadena('Lugar del apartado en la dispositio del conjunto.'),
  }, ['idea', 'tesisLocal', 'argumentos', 'funcion']),
  datosGlobal: objeto({
    tesis: cadena(),
    problema: cadena('Pregunta o problema de partida.'),
    estructura: opcion(ESTRUCTURA),
    dispositio: cadena('Cómo se ordena el discurso de principio a fin.'),
    lineas: lista(objeto({ linea: cadena('Línea argumental.'), apartados: cadenas('Ids de los segmentos donde se desarrolla.') }, ['linea'])),
    refutaciones: cadenas('Posiciones que combate.'),
    autoridades: cadenas('Autores y obras con que dialoga.'),
    ethos: cadena('Figura del autor y registro.'),
    conclusion: cadena(),
    valoracion: cadena('Solidez del argumento: fuerzas y debilidades.'),
  }, ['tesis', 'problema', 'estructura', 'lineas', 'conclusion']),
  entidades: ['concepto', 'persona', 'obra', 'organizacion', 'evento', 'lugar', 'tema', 'fecha'],
};
