/**
 * Lente periodismo: géneros y redacción periodística (Martínez Albertos,
 * Grijelmo, Gomis, Entman para el encuadre). Titular y entradilla, pirámide
 * invertida, fuentes y atribución, citas, encuadre, sesgos y verificación.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto, opcion } from './comun.js';

const GENEROS = ['noticia', 'crónica', 'reportaje', 'entrevista', 'perfil', 'columna', 'editorial', 'artículo de opinión', 'crítica', 'carta al director', 'otro'] as const;

export const periodismo: DefinicionLente = {
  id: 'periodismo',
  version: 'periodismo@1',
  segmentos: ['articulo', 'apartado', 'bloque'],
  conFicha: ['articulo', 'apartado', 'bloque'],
  guiaEstructura: `Artículos: en un número de periódico o revista, cada pieza con su titular es un segmento.
Apartados: dentro de una pieza larga, los ladillos o subtítulos; si no los hay, la entradilla, el cuerpo y el cierre.
Bloques: en piezas de radio o televisión, cada noticia o sección del informativo, o cada tramo con un asunto (presentación, conexión, declaraciones, cierre).`,
  instrucciones: `Lente: análisis periodístico.
- Género: noticia, crónica, reportaje, entrevista, perfil, columna, editorial, artículo de opinión, crítica. Separa información e interpretación u opinión.
- Estructura: titular, antetítulo y subtítulo, entradilla (las cinco uves dobles: qué, quién, cuándo, dónde, por qué, y cómo), pirámide invertida o estructura cronológica, ladillos, cierre.
- Fuentes y atribución: quién dice qué, fuentes identificadas, anónimas («fuentes cercanas»), oficiales, documentales; verbos de atribución (afirma, admite, denuncia) y su carga; citas directas e indirectas.
- Encuadre (framing): cómo se define el problema, a quién se atribuye la causa, qué juicio moral y qué solución se sugieren; selección y saliencia.
- Sesgos y retórica: léxico valorativo, adjetivación, eufemismos, omisiones, equilibrio de voces, uso de cifras y de imágenes.
- Verificación: qué afirmaciones son comprobables, cuáles se sostienen con datos en el propio texto y cuáles no.
La fecha de publicación y el medio importan: si no constan en el documento y los sabes, son contexto externo.`,
  datosSegmento: objeto({
    genero: opcion(GENEROS),
    titular: cadena(),
    hechos: cadenas('Qué, quién, cuándo, dónde, por qué y cómo.'),
    fuentes: lista(objeto({ fuente: cadena(), tipo: cadena('Oficial, experta, testigo, anónima, documental…'), afirma: cadena() }, ['fuente', 'afirma'])),
    citasDirectas: cadenas('Citas literales entrecomilladas.'),
    encuadre: cadena('Cómo se define el asunto y qué se destaca.'),
    valoracion: cadena('Opinión o léxico valorativo, si lo hay.'),
    verificable: cadenas('Afirmaciones comprobables y si el texto las sostiene.'),
    funcion: cadena('Qué aporta a la pieza o al número.'),
  }, ['genero', 'hechos', 'fuentes', 'encuadre']),
  datosGlobal: objeto({
    genero: opcion(GENEROS),
    medio: cadena('Medio, sección y fecha, si constan.'),
    asunto: cadena(),
    estructura: cadena('Pirámide invertida, cronológica, por bloques…'),
    fuentes: lista(objeto({ fuente: cadena(), tipo: cadena() }, ['fuente'])),
    encuadre: cadena(),
    sesgos: cadenas('Sesgos, omisiones o desequilibrios observables.'),
    tesis: cadena('En opinión: lo que se defiende.'),
  }, ['genero', 'asunto', 'estructura', 'fuentes', 'encuadre']),
  entidades: ['persona', 'organizacion', 'lugar', 'evento', 'fecha', 'concepto', 'obra', 'tema', 'objeto'],
};
