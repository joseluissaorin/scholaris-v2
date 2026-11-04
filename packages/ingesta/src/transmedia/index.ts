/**
 * Transmedia y transidioma (docs/COMPRENSION.md, «Relaciones y alineaciones» y
 * «Transidioma»): detección de relaciones entre las obras de la biblioteca,
 * alineación gruesa y fina de cada pareja, alineación de traducciones párrafo a
 * párrafo y la ficha de cada relación.
 */
export * from './tipos.js';
export { normalizar as normalizarTitulo, obraDe, medioDe, rotulo, claseDeObra, type Obra, type Medio } from './obras.js';
export { obraWikidata, urlWikidata, PROPIEDADES as PROPIEDADES_WIKIDATA, type ObraWikidata } from './wikidata.js';
export { detectarRelaciones, evaluarPar, combinar, senalesMetadatos, senalesContenido, senalesWikidata, senalEntidades, entidadesPorDocumento } from './deteccion.js';
export {
  TIPOS_RELACION, idRelacion, idFichaRelacion, guardarDetectadas, crearRelacionUsuario, confirmarRelacion, rechazarRelacion, leerRechazos, leerRelacion,
  borrarRelacionCompleta, borrarRelacionesDeDocumento, ErrorRelacion, type RechazoRelacion,
} from './relaciones.js';
export { materialObra, textoMarcado, cabeceraObra, limpiarMarcas, idCortoDe, type MaterialObra } from './material.js';
export {
  TIPOS_CORRESPONDENCIA, alinearObras, alineacionGruesa, alineacionGruesaProporcional, alineacionFina, gruposFinos, anclarLado, ladoDeSegmentos, prefijoRelacion,
  ESQUEMA_FINA, ESQUEMA_GRUESA, type GrupoFino, type ResultadoAlineacion,
} from './alineacion.js';
export { alinearTraduccion, parrafosDe, galeChurch, type Parrafo } from './traduccion.js';
export { fichaRelacion, CLASE_FICHA, ASPECTOS, CAMBIOS_PERSONAJE } from './ficha.js';
export {
  SE_ALINEAN, alinearRelacion, pasoTransmedia, pasoTransmediaBiblioteca, transmediaEnProceso, relacionesPorAlinear, leerEstadoAlineacion, huellaRelacion,
  type ResultadoAlinear,
} from './flujo.js';
export { correspondencias, textoDeLado, type Correspondencia } from './consultas.js';
