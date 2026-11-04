/**
 * Lente archivo: documentos de archivo y manuscritos, leídos con la diplomática
 * (Riesco Terrero, Cárcel Ortí, Bono), la paleografía (Millares Carlo, Riesco) y
 * la crítica textual (Blecua). Tipo documental, tradición, datas, partes y
 * fórmulas del documento, letra, abreviaturas, conservación y variantes.
 */
import type { DefinicionLente } from '../tipos.js';
import { cadena, cadenas, lista, objeto, opcion } from './comun.js';

const TRADICION = ['original', 'copia simple', 'copia autorizada', 'traslado', 'inserto', 'minuta', 'registro', 'desconocida'] as const;
const LETRA = ['visigótica', 'carolina', 'gótica', 'precortesana', 'cortesana', 'procesal', 'humanística', 'bastarda', 'itálica', 'contemporánea', 'mecanografiada', 'impresa', 'otra'] as const;

export const archivo: DefinicionLente = {
  id: 'archivo',
  version: 'archivo@1',
  segmentos: ['apartado', 'folio'],
  conFicha: ['apartado'],
  guiaEstructura: `Apartados: cada documento dentro de un legajo, expediente o códice (una carta, una escritura, un auto, una diligencia), reconocible por su encabezamiento, su data y su validación (firmas, signos). Si el documento es uno solo, sus partes diplomáticas grandes (protocolo, texto, escatocolo) solo si es extenso.
Folios: las hojas tal como se numeran en el original (fol. 3r, 3v), cuando la foliación consta y ayuda a localizar.`,
  instrucciones: `Lente: diplomática, paleografía y crítica textual.
- Tipo documental: carta, provisión, cédula, privilegio, escritura de venta, testamento, poder, inventario, auto, pleito, acta, partida sacramental…; productor y destinatario.
- Tradición documental: original, copia simple o autorizada, traslado, inserto, minuta, registro.
- Datas: tópica (lugar) y crónica (fecha), con el sistema de datación si no es el actual (era hispánica, estilo de la Natividad o de la Encarnación).
- Partes y fórmulas: protocolo (invocación, intitulación, dirección, salutación), texto o cuerpo (preámbulo, notificación, exposición, disposición, cláusulas finales: de sanción, corroboración, renuncia…) y escatocolo (data, validación, suscripciones, signos notariales, sellos).
- Otorgantes, testigos, escribano o notario.
- Paleografía: tipo de letra (carolina, gótica, precortesana, cortesana, procesal, humanística, bastarda…), manos distintas, abreviaturas (por suspensión, por contracción, signos especiales y de nota tironiana), nexos, puntuación y sistema gráfico.
- Estado de conservación: manchas, roturas, tinta desvaída, lagunas, restauraciones.
- Crítica textual: variantes respecto de otros testimonios, enmiendas, tachaduras, interlineados, lagunas y conjeturas; si propones una lectura dudosa, márcala.
Al citar, respeta la grafía del texto tal como está transcrito en el material.`,
  datosSegmento: objeto({
    tipoDocumental: cadena(),
    tradicion: opcion(TRADICION),
    dataTopica: cadena('Lugar.'),
    dataCronica: cadena('Fecha, normalizada si se puede (con el sistema original).'),
    otorgantes: cadenas(),
    destinatario: cadena(),
    asunto: cadena('Resumen del contenido jurídico o administrativo.'),
    formulas: lista(objeto({ parte: cadena('Invocación, intitulación, exposición, disposición, cláusula, validación…'), texto: cadena('Literal.') }, ['parte'])),
    validacion: cadenas('Suscripciones, signos, sellos, testigos.'),
    letra: opcion(LETRA),
    abreviaturas: cadenas('Abreviaturas notables y su desarrollo.'),
    conservacion: cadena(),
    critica: cadenas('Variantes, enmiendas, lagunas, lecturas dudosas.'),
  }, ['tipoDocumental', 'tradicion', 'dataCronica', 'otorgantes', 'asunto']),
  datosGlobal: objeto({
    descripcion: cadena('Qué es la unidad documental (documento suelto, expediente, legajo, códice).'),
    productor: cadena('Institución o persona que lo produce.'),
    fechas: cadena('Fechas extremas.'),
    lugares: cadenas(),
    contenido: cadena('Alcance y contenido.'),
    tipos: cadenas('Tipos documentales presentes.'),
    letras: cadenas('Letras y manos.'),
    conservacion: cadena(),
    signatura: cadena('Archivo y signatura, si constan.'),
    critica: cadena('Problemas textuales de conjunto.'),
  }, ['descripcion', 'fechas', 'contenido', 'tipos']),
  entidades: ['persona', 'lugar', 'organizacion', 'fecha', 'evento', 'obra', 'objeto', 'concepto'],
};
