/**
 * Lo que comparten todas las lentes: las reglas de anclaje y de escritura, y
 * las piezas de los esquemas JSON (evidencias, listas, enumeraciones).
 *
 * Los esquemas van en el subconjunto de JSON Schema que acepta Gemini en
 * `responseJsonSchema`: objetos poco profundos, sin `$ref` ni nulos.
 */

/** Versión común del flujo (anclaje, esquema envolvente, pasos). Sube si cambian. */
export const VERSION_COMPRENSION = 'comprension@1';

/** Reglas que valen para cualquier lente: van al principio del sistema. */
export const REGLAS_COMUNES = `Eres un especialista que estudia una obra entera para dejar en una base de datos lo que anotaría un investigador que la conoce a fondo. Trabajas para un sistema académico que cita con página y segundo exactos.

Material: el documento llega troceado en unidades citables marcadas así: «⟦U12 · p. 14⟧» (página) o «⟦U12 · 1:02:03-1:02:40⟧» (tramo de tiempo). En los medios pueden venir también fotogramas descritos («⟦F34 · 1:02:10⟧ …») y una percepción de escenas y planos. El número tras la U es el orden de la unidad: es lo que pones en «u».

Anclaje (obligatorio):
- Cada afirmación que hagas tiene que poder sostenerse con el material. En «evidencias» pones la unidad («u») y una cita LITERAL copiada carácter a carácter del texto de esa unidad, de entre 4 y 30 palabras, sin puntos suspensivos en medio ni arreglos. Si la prueba es visual, das el fotograma («f») y describes en «apoya» lo que se ve.
- No cites lo que no está. Si algo lo infieres (una intención, un sentido simbólico), dilo como inferencia en el texto («sugiere», «puede leerse como») y apóyalo en lo que sí está.
- Lo que sepas de fuera del documento (biografía, recepción, contexto histórico, datos de Wikidata) se marca como externo: en los campos de contexto con «externo: true» y en la prosa con fórmulas como «fuera del texto, se sabe que…». Nunca se presenta como si lo dijera la obra.

Escritura:
- Prosa analítica en la lengua del documento (si es español, español impecable: tildes, eñes, ¿ y ¡ de apertura). Registro académico, preciso y sin relleno, con el vocabulario técnico de la disciplina bien usado. Nada de fórmulas vacías («cabe destacar», «en definitiva», «juega un papel crucial»).
- Incisos con comas o paréntesis. Si usas la raya, a la española: pegada al inciso y separada por espacios del texto exterior (—así—); nunca la raya con espacios a ambos lados a la inglesa.
- Sin emojis. Sin markdown en los campos de texto salvo comillas latinas «» para citar.
- Las marcas del material («⟦U12 · p. 14⟧», «⟦F34 · …⟧») no van nunca en la prosa: las pruebas van en «evidencias»; en el texto, si hace falta, el localizador humano («p. 14», «1:02:03»).
- Los nombres propios, tal como los da la obra; los personajes, con el nombre con que la obra los conoce.
- Además de la prosa, «resumen_es» y «resumen_en»: una o dos frases en español y en inglés (para encontrar la ficha desde cualquier lengua).`;

// ---------------------------------------------------------------------------
// Piezas de esquema
// ---------------------------------------------------------------------------

export const cadena = (description?: string) => (description ? { type: 'string', description } : { type: 'string' });
export const entero = (description?: string) => (description ? { type: 'integer', description } : { type: 'integer' });
export const numero = (description?: string) => (description ? { type: 'number', description } : { type: 'number' });
export const logico = (description?: string) => (description ? { type: 'boolean', description } : { type: 'boolean' });
export const lista = (items: Record<string, unknown>, description?: string) => (description ? { type: 'array', items, description } : { type: 'array', items });
export const cadenas = (description?: string) => lista(cadena(), description);
export const opcion = (valores: readonly string[], description?: string) => ({ type: 'string', enum: [...valores], ...(description ? { description } : {}) });
export function objeto(propiedades: Record<string, unknown>, requeridas: string[] = [], description?: string): Record<string, unknown> {
  return { type: 'object', properties: propiedades, ...(requeridas.length ? { required: requeridas } : {}), ...(description ? { description } : {}) };
}

/** Una prueba: unidad y cita literal, o un fotograma. */
export const ESQUEMA_REF = objeto({
  u: entero('Orden de la unidad (el número tras la U).'),
  cita: cadena('Cita literal copiada de esa unidad (4-30 palabras).'),
  f: entero('Número de fotograma, si la prueba es visual.'),
  t: numero('En medios, el segundo exacto, si se sabe.'),
  apoya: cadena('Qué afirmación sostiene, o lo que se ve u oye.'),
});

export const ESQUEMA_EVIDENCIAS = lista(ESQUEMA_REF, 'Pruebas de lo que se afirma (al menos dos si hay material).');

/** Contexto que puede venir de fuera de la obra. */
export const ESQUEMA_CONTEXTO = lista(objeto({
  dato: cadena(),
  externo: logico('true si no sale del documento (biografía, historia, recepción, Wikidata).'),
}, ['dato', 'externo']), 'Contexto, con lo externo marcado.');

/** Tema o motivo que atraviesa la obra, con sus apariciones. */
export const ESQUEMA_TEMA = objeto({
  nombre: cadena('Nombre breve y estable («la amistad», «el helado de fresa»).'),
  descripcion: cadena('Qué es y cómo se trata en la obra.'),
  formas: cadenas('Palabras o expresiones literales que lo señalan en el texto (para encontrar todas sus apariciones).'),
  apariciones: lista(ESQUEMA_REF, 'Todas las apariciones que veas, con su cita.'),
}, ['nombre', 'descripcion', 'formas', 'apariciones']);

/** El envoltorio de la ficha de un segmento: lo común más los datos de la lente. */
export function esquemaFichasSegmento(datos: Record<string, unknown>): Record<string, unknown> {
  return objeto({
    fichas: lista(objeto({
      segmento: cadena('El id del segmento («s3»).'),
      texto: cadena('Prosa analítica (150-450 palabras) con el vocabulario de la disciplina.'),
      resumen_es: cadena(), resumen_en: cadena(),
      datos,
      evidencias: ESQUEMA_EVIDENCIAS,
    }, ['segmento', 'texto', 'resumen_es', 'resumen_en', 'datos', 'evidencias'])),
  }, ['fichas']);
}

/** El envoltorio de la ficha global. */
export function esquemaFichaGlobal(datos: Record<string, unknown>): Record<string, unknown> {
  return objeto({
    texto: cadena('Ensayo analítico de la obra entera (900-2000 palabras): lo que escribiría un especialista que la ha estudiado.'),
    resumen_es: cadena(), resumen_en: cadena(),
    sinopsis: cadena('Sinopsis extensa y ordenada (300-700 palabras).'),
    temas: lista(ESQUEMA_TEMA, 'Temas que atraviesan la obra.'),
    motivos: lista(ESQUEMA_TEMA, 'Motivos recurrentes (objetos, imágenes, frases, sonidos) con todas sus apariciones.'),
    contexto: ESQUEMA_CONTEXTO,
    datos,
    evidencias: ESQUEMA_EVIDENCIAS,
  }, ['texto', 'resumen_es', 'resumen_en', 'sinopsis', 'temas', 'motivos', 'contexto', 'datos', 'evidencias']);
}

/** Personaje o participante tal como lo ve una ficha. */
export const ESQUEMA_PARTICIPANTE = objeto({ nombre: cadena(), papel: cadena('Qué hace o qué función cumple aquí.') }, ['nombre']);

/** Las escalas de plano, en el vocabulario del análisis fílmico español. */
export const ESCALAS_PLANO = [
  'gran plano general', 'plano general', 'plano de conjunto', 'plano entero', 'plano americano', 'plano medio', 'plano medio corto',
  'primer plano', 'primerísimo primer plano', 'plano detalle', 'plano inserto',
] as const;
