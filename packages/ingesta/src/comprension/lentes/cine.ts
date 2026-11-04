/**
 * Lente cine: análisis fílmico (Bordwell y Thompson, Aumont, Casetti y Di Chio,
 * Carmona). Découpage en secuencias, escenas y planos; escala, angulación,
 * movimiento, composición, montaje y sonido diegético o extradiegético.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, ESCALAS_PLANO, ESQUEMA_PARTICIPANTE, lista, objeto, opcion } from './comun.js';

export const cine: DefinicionLente = {
  id: 'cine',
  version: 'cine@2',
  segmentos: ['secuencia', 'escena', 'plano'],
  conFicha: ['secuencia', 'escena'],
  guiaEstructura: `Secuencias: bloques narrativos con unidad de acción que agrupan varias escenas (el prólogo, «Coppelia», «la primera visita»). Una película de hora y media suele tener entre doce y treinta.
Escenas: unidad de lugar, tiempo y acción. Cambian con un corte a otro espacio o con un salto temporal. Una película suele tener entre cuarenta y ciento veinte.
Planos: solo si llega la percepción con sus cortes; nunca los inventes desde el diálogo.
Los títulos de crédito iniciales y finales son segmentos propios.`,
  instrucciones: `Lente: análisis fílmico.
- Puesta en escena: espacio (decorado, exteriores), vestuario, atrezo, actuación, disposición de los cuerpos.
- Puesta en cuadro: escala de plano (${ESCALAS_PLANO.join(', ')}), angulación (normal, picado, contrapicado, cenital, nadir, aberrante), movimiento de cámara (fija, panorámica, travelling, grúa, cámara en mano, zoom), composición (quién domina el encuadre, marcos dentro del marco, líneas, primer término y fondo), profundidad de campo, luz (clave alta o baja, contraluz) y color.
- Montaje: corte, fundido, encadenado, raccord (de mirada, de movimiento, de eje) y sus rupturas, elipsis, montaje paralelo o alterno, plano y contraplano, ritmo.
- Sonido: diálogo, ruido, música diegética (suena en el mundo de la película) o extradiegética, canciones identificadas, silencios, voz en off o en over.
- Narración fílmica: punto de vista, ocularización y auricularización (qué vemos y oímos y desde quién), lo que sabe el espectador frente a los personajes.
- Objetos y símbolos (qué significan en la obra), texto en pantalla, función narrativa de la escena.
Si una adaptación literaria es conocida, compárala solo como contexto externo, marcado.
No describas planos que no veas: si solo tienes el diálogo y unos fotogramas sueltos, las decisiones de cámara que no consten se dejan vacías o se dicen como inferencia a partir de los fotogramas.
La ficha de una escena se funda en lo percibido (lo que se ve y se oye: escenas, planos, sonido, quién está) y en la transcripción. Si el tramo no tiene transcripción completa, dilo en la ficha y no deduzcas de ella lo que no se dice. Quién habla, según la percepción cuando difiera de la etiqueta de la transcripción.`,
  datosSegmento: objeto({
    lugar: cadena(),
    tiempo: cadena('Día, noche, época.'),
    personajes: lista(ESQUEMA_PARTICIPANTE),
    accion: cadena(),
    dialogoClave: lista(objeto({ hablante: cadena(), texto: cadena('Literal.'), u: { type: 'integer' } }, ['texto'])),
    escalas: lista(opcion(ESCALAS_PLANO)),
    angulacion: cadena(),
    movimiento: cadena(),
    composicion: cadena('Quién domina el encuadre y cómo.'),
    luzColor: cadena(),
    montaje: cadena('Relación con lo anterior y ritmo interno: corte, elipsis, raccord, montaje paralelo…'),
    sonido: objeto({ diegetico: cadenas(), extradiegetico: cadenas(), musica: cadenas('Piezas o canciones, si se identifican.'), silencio: cadena() }),
    objetosSimbolos: lista(objeto({ objeto: cadena(), sentido: cadena() }, ['objeto'])),
    textoEnPantalla: cadena(),
    funcionNarrativa: cadena(),
  }, ['lugar', 'personajes', 'accion', 'funcionNarrativa']),
  datosGlobal: objeto({
    estructura: cadena('Actos y secuencias, y cómo se encadenan.'),
    narracion: cadena('Punto de vista, focalización y saber del espectador.'),
    puestaEnEscena: cadena(),
    fotografia: cadena('Luz, color, encuadres dominantes.'),
    montaje: cadena(),
    sonidoMusica: cadena('Música diegética y extradiegética, canciones, silencios.'),
    personajes: lista(objeto({ nombre: cadena(), actor: cadena(), papel: cadena(), arco: cadena() }, ['nombre', 'papel'])),
    adaptacion: cadena('Si adapta una obra: cuál y qué cambia (contexto externo, marcado).'),
    sentido: cadena('Interpretación de conjunto.'),
  }, ['estructura', 'narracion', 'montaje', 'personajes', 'sentido']),
  entidades: ['personaje', 'persona', 'lugar', 'objeto', 'motivo', 'obra_musical', 'obra', 'organizacion', 'evento', 'concepto'],
};
