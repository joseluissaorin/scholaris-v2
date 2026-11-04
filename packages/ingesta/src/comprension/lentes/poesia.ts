/**
 * Lente poesía: métrica y retórica (Navarro Tomás, Quilis, Domínguez Caparrós,
 * Lausberg). Cómputo silábico, rima, estrofa, encabalgamiento, figuras, yo
 * lírico, tópicos e intertextos.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto, opcion } from './comun.js';

const ARTE = ['menor', 'mayor', 'mixto', 'verso libre', 'prosa poética'] as const;
const RIMA = ['consonante', 'asonante', 'mixta', 'sin rima', 'blanca'] as const;

export const poesia: DefinicionLente = {
  id: 'poesia',
  version: 'poesia@1',
  segmentos: ['parte', 'poema', 'estrofa'],
  conFicha: ['poema'],
  guiaEstructura: `Partes: las secciones de un poemario (títulos de sección, numeración romana, blancos amplios).
Poemas: cada texto con título propio, número o separación clara (asteriscos, cambio de página con título). En una antología, cada poema es un segmento aunque compartan página.
Estrofas: grupos de versos separados por un blanco; en formas fijas (soneto, décima, lira), las que marque la forma. Solo como segmentos si el poema es largo (más de unas cuarenta líneas); si no, se analizan dentro de la ficha del poema.`,
  instrucciones: `Lente: métrica, retórica y lírica.
- Métrica: cómputo silábico con sus licencias (sinalefa, diéresis, sinéresis, hiato) y la ley del acento final (+1 en final agudo, -1 en esdrújulo); versos de arte menor (hasta ocho sílabas) y de arte mayor; acentos rítmicos, cesura y hemistiquios en los versos compuestos (alejandrino, dodecasílabo); verso libre y versículo cuando no hay medida.
- Rima: consonante o asonante, esquema (ABBA, -a-a…), versos sueltos, rima interna, rima blanca.
- Estrofa y forma: soneto, romance, silva, décima, lira, cuarteto, redondilla, terceto, octava real, seguidilla, copla; formas libres. Encabalgamiento (abrupto, suave, sirremático o léxico) y pausas.
- Figuras retóricas: fónicas (aliteración, paronomasia, onomatopeya), sintácticas o de construcción (anáfora, paralelismo, quiasmo, hipérbaton, asíndeton, polisíndeton, epíteto) y semánticas o tropos (metáfora, símil, metonimia, sinécdoque, hipérbole, antítesis, oxímoron, paradoja, personificación, ironía).
- Enunciación lírica: yo lírico, tú lírico o destinatario, apóstrofe, objeto lírico, actitud (enunciativa, apelativa, carmínica).
- Tópicos (carpe diem, locus amoenus, beatus ille, ubi sunt, tempus fugit, collige virgo rosas, memento mori, amor más allá de la muerte…), símbolos e imágenes recurrentes, campos semánticos.
- Intertextos: citas, epígrafes, alusiones y tradiciones con las que dialoga (lo que no esté en el texto, marcado como externo).
Cita los versos tal como están, con su puntuación, y da el cómputo de los que analices.`,
  datosSegmento: objeto({
    tema: cadena('De qué trata el poema en una frase.'),
    estrofa: cadena('Forma estrófica o composición (soneto, romance, silva, verso libre…).'),
    arte: opcion(ARTE),
    medida: cadena('Medida dominante y licencias relevantes (endecasílabos con sinalefa en el v. 3…).'),
    rima: opcion(RIMA),
    esquemaRima: cadena('Esquema de rima (ABBA ABBA CDC DCD, -a-a…).'),
    encabalgamientos: cadenas('Encabalgamientos significativos y su efecto.'),
    figuras: lista(objeto({ figura: cadena(), verso: cadena('Verso o versos literales.'), efecto: cadena() }, ['figura', 'verso'])),
    yoLirico: cadena('Quién habla, a quién y con qué actitud.'),
    topicos: cadenas(),
    imagenes: cadenas('Imágenes y símbolos centrales.'),
    intertextos: cadenas(),
    estructuraInterna: cadena('Partes del contenido y su progresión.'),
  }, ['tema', 'estrofa', 'arte', 'rima', 'figuras', 'yoLirico', 'estructuraInterna']),
  datosGlobal: objeto({
    estructura: cadena('Organización del poemario o del poema largo: secciones, orden, progresión.'),
    formas: cadena('Formas métricas y estróficas dominantes y su evolución.'),
    voz: cadena('Yo lírico, destinatarios y actitudes a lo largo de la obra.'),
    imagenes: cadenas('Imágenes, símbolos y campos semánticos que atraviesan la obra.'),
    topicos: cadenas(),
    lenguaje: cadena('Léxico, registro y figuras dominantes.'),
    tradicion: cadena('Escuela, movimiento o tradición en que se inscribe (externo, marcado).'),
    intertextos: cadenas(),
    sentido: cadena('Interpretación de conjunto.'),
  }, ['estructura', 'formas', 'voz', 'imagenes', 'sentido']),
  entidades: ['tema', 'motivo', 'persona', 'personaje', 'obra', 'lugar', 'objeto', 'concepto', 'evento'],
};
