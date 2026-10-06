/**
 * @scholaris/ingesta: de un PaqueteConversion a un documento leído y citable.
 * Pasos puros sobre puertos; el mismo código corre en un Workflow, en Node y en
 * el banco de pruebas.
 */
export * from './tipos.js';
export * from './texto.js';
export { planificar, cortarPliegos, PAGINAS_POR_PLIEGO, CONCURRENCIA } from './planificar.js';
export { leerCapa, leerCapaPagina, cuerpoDominante, folioVisible } from './pasos/capa.js';
export { leerPliego, leerPaginas, enBucle, entradaDePaginas, type ResultadoPliego, type OpcionesLectura } from './pasos/lectura.js';
export { transcribirTramo, transcribirMedio, segmentarTranscripcion, frasesDe } from './pasos/medios.js';
export { unidadesDeBloques } from './pasos/bloques.js';
export { atribuirHablantes, frasesIndexadas, reconocerReparto, asignarVentana, type Persona, type FraseIndexada } from './pasos/hablantes.js';
export { deducirFolios, pasoFolios, interpretarFolio, etiquetasInformativas, type EntradaFolio } from './pasos/folios.js';
export { pasoEstructura, construirSecciones, titulosDelTexto, anclarIndice, parrafosDeUnidad, rutaDe } from './pasos/estructura.js';
export { trocear, fragmentosDeMedio, pasoFragmentos, type OpcionesTroceado } from './pasos/fragmentos.js';
export * from './pasos/metadatos.js';
export { partirAutores, separarNombre, nombreCompleto } from './pasos/autores.js';
export { pasoContexto, agruparPorSeccion, contextualizarGrupo } from './pasos/contexto.js';
export { vectorizar, textoVectorizable, type PiezaVector } from './pasos/vectores.js';
export { pasoFiguras, reunirFiguras, describirFiguras, piesEnTexto, type FiguraConAncla } from './pasos/figuras.js';
export { escribirDocumento, escribirVectores, escribirEspacio, entradasIndice, metadatosIndice } from './pasos/indexado.js';
export { ejecutarIngesta, type ResultadoIngesta, type OpcionesOrquestador } from './orquestador.js';
export {
  prepararDocumento, leerTanda, indexarTanda, metadatosTempranos, consolidar, enviarLote, recogerLote,
  seccionesDeTanda, anclaProvisional, documentoProvisional, idUnidadDe, huellaCorta, claveLote,
  type ContextoTuberia, type OpcionesTuberia, type EstadoTanda, type ResumenTanda, type ResultadoConsolidacion,
} from './tuberia.js';
export { Cobertura } from './cobertura.js';
export { planificar as planificarTandas, tandasDePaginas } from './planificar.js';
export { revisarTranscripcion, aplicarReemplazos, cribarFrases, alinear, sustituir, reescuchar, nombresPropios, type CambioTranscripcion } from './pasos/revision.js';
export { fichasDe, palabrasCompactas } from './pasos/medios.js';
