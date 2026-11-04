/**
 * Lente documental: el cine de no ficción (Nichols, Plantinga, Weinrichter,
 * Català). Modos de representación, tesis, testimonios, material de archivo,
 * voz over, retórica audiovisual y ética de la representación.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, ESQUEMA_PARTICIPANTE, lista, objeto, opcion } from './comun.js';

const MODOS = ['expositivo', 'observacional', 'participativo', 'reflexivo', 'performativo', 'poético'] as const;

export const documental: DefinicionLente = {
  id: 'documental',
  version: 'documental@1',
  segmentos: ['secuencia', 'bloque'],
  conFicha: ['secuencia', 'bloque'],
  guiaEstructura: `Secuencias: grandes movimientos del documental, cada uno con un asunto o una etapa del argumento (introducción, un caso, un testimonio largo, el desenlace). Suelen marcarlos rótulos, cambios de lugar o de tema, o la voz over.
Bloques: dentro de cada secuencia, tramos homogéneos: una entrevista, un montaje de archivo, una escena observacional, un pasaje de voz over. Un documental de hora y media suele tener entre diez y veinticinco secuencias.`,
  instrucciones: `Lente: análisis del documental.
- Modos de representación (Nichols): expositivo (voz over que argumenta), observacional (cámara que mira sin intervenir), participativo (el cineasta interviene y entrevista), reflexivo (el documental se piensa a sí mismo), performativo (la experiencia subjetiva del autor), poético (asociación de imágenes y ritmo). Un documental mezcla modos: di cuál domina en cada tramo.
- Tesis y argumento: qué sostiene, cómo lo prueba, qué deja fuera; estructura argumentativa del montaje.
- Fuentes: testimonios (quién habla, con qué autoridad, cómo se le presenta: rótulo, encuadre, lugar), expertos, testigos, material de archivo (noticiarios, fotografías, documentos, películas familiares) y su tratamiento (contexto, recontextualización, manipulación).
- Voz: voz over o voz en off, narrador, rótulos, entrevistador presente o ausente.
- Retórica audiovisual: montaje (por contraste, por acumulación, de evidencia), música y su función persuasiva o emocional, reconstrucciones y dramatizaciones, recursos de autenticidad.
- Ética de la representación: relación con los sujetos filmados, consentimiento, dar o quitar la palabra, el punto de vista sobre los otros.
Lo que se sabe del rodaje o de la recepción fuera de la película es contexto externo y se marca.`,
  datosSegmento: objeto({
    asunto: cadena(),
    modo: opcion(MODOS, 'Modo dominante en el tramo.'),
    tesis: cadena('Qué afirma o sugiere este tramo.'),
    testimonios: lista(ESQUEMA_PARTICIPANTE),
    archivo: cadenas('Material de archivo usado y su origen, si consta.'),
    voz: cadena('Voz over, rótulos, entrevistador.'),
    montaje: cadena('Cómo se articula: contraste, acumulación, evidencia, paralelo.'),
    sonidoMusica: cadena(),
    recursos: cadenas('Reconstrucciones, dramatizaciones, gráficos, textos en pantalla.'),
    funcion: cadena('Qué aporta al argumento del conjunto.'),
  }, ['asunto', 'modo', 'tesis', 'funcion']),
  datosGlobal: objeto({
    tesis: cadena('Lo que sostiene el documental.'),
    argumento: cadena('Cómo se construye la prueba a lo largo de la obra.'),
    modos: lista(opcion(MODOS), 'Modos de representación presentes, del más al menos dominante.'),
    estructura: cadena(),
    fuentes: lista(objeto({ nombre: cadena(), papel: cadena('Testigo, experto, protagonista…') }, ['nombre', 'papel'])),
    archivo: cadena('Uso del material de archivo.'),
    retorica: cadena('Recursos persuasivos y emocionales.'),
    etica: cadena('Relación con los sujetos representados.'),
    omisiones: cadenas('Lo que no se dice o no se muestra y podría importar.'),
  }, ['tesis', 'argumento', 'modos', 'fuentes', 'retorica']),
  entidades: ['persona', 'organizacion', 'lugar', 'evento', 'obra', 'concepto', 'fecha', 'obra_musical', 'tema', 'objeto'],
};
