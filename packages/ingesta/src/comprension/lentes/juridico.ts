/**
 * Lente jurídica: leyes, reglamentos, sentencias y contratos, con la teoría de la
 * norma (Kelsen, Hart, Díez-Picazo): norma y rango, supuesto de hecho y
 * consecuencia jurídica, remisiones, excepciones, vigencia y definiciones legales.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto } from './comun.js';

export const juridico: DefinicionLente = {
  id: 'juridico',
  version: 'juridico@1',
  segmentos: ['parte', 'articulo', 'apartado'],
  conFicha: ['articulo'],
  guiaEstructura: `Partes: títulos, capítulos y secciones de la norma; en una sentencia, antecedentes de hecho, fundamentos de derecho y fallo; en un contrato, expositivo y cláusulas.
Artículos: cada artículo, disposición (adicional, transitoria, derogatoria, final) o cláusula, con su número tal como figura.
Apartados: los números y letras dentro de un artículo, solo si el artículo es largo y cada apartado tiene contenido normativo propio.`,
  instrucciones: `Lente: análisis jurídico.
- Norma: qué tipo de texto es (ley orgánica u ordinaria, real decreto, reglamento, orden, directiva, sentencia, contrato), su rango y su ámbito.
- Estructura de cada precepto: supuesto de hecho (a qué casos se aplica) y consecuencia jurídica (qué se manda, prohíbe o permite, y a quién); sujetos obligados y beneficiarios; plazos.
- Definiciones legales: términos que la norma define, literalmente.
- Remisiones internas y externas (a otros artículos o a otras normas), excepciones y salvedades («salvo que», «sin perjuicio de»).
- Vigencia: entrada en vigor, derogaciones, modificaciones y régimen transitorio, si constan.
- En sentencias: hechos probados, cuestión jurídica, ratio decidendi frente a obiter dicta, fallo, votos particulares.
Cita el texto normativo literalmente; no parafrasees lo que manda. Lo que sepas de reformas posteriores es contexto externo.`,
  datosSegmento: objeto({
    numero: cadena('Número o denominación del artículo, disposición o cláusula.'),
    rubrica: cadena('Título del artículo, si lo tiene.'),
    supuesto: cadena('Supuesto de hecho.'),
    consecuencia: cadena('Consecuencia jurídica.'),
    sujetos: cadenas('Obligados y beneficiarios.'),
    definiciones: lista(objeto({ termino: cadena(), definicion: cadena('Literal.') }, ['termino', 'definicion'])),
    remisiones: cadenas('Artículos o normas a que remite.'),
    excepciones: cadenas(),
    plazos: cadenas(),
    vigencia: cadena('Entrada en vigor, derogación o régimen transitorio, si se dice.'),
  }, ['numero', 'supuesto', 'consecuencia']),
  datosGlobal: objeto({
    norma: cadena('Tipo, rango y denominación oficial.'),
    ambito: cadena('Ámbito material, territorial y temporal.'),
    objeto: cadena('Qué regula y con qué finalidad.'),
    estructura: cadena('Títulos, capítulos y disposiciones.'),
    definiciones: lista(objeto({ termino: cadena(), definicion: cadena() }, ['termino', 'definicion'])),
    obligaciones: cadenas('Obligaciones y derechos principales.'),
    remisiones: cadenas('Normas con que se relaciona.'),
    vigencia: cadena(),
    fallo: cadena('En sentencias: lo que se decide y por qué.'),
  }, ['norma', 'ambito', 'objeto', 'estructura']),
  entidades: ['organizacion', 'concepto', 'obra', 'persona', 'lugar', 'fecha', 'evento'],
};
