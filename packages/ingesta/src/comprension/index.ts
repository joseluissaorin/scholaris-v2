/**
 * La capa de comprensión (docs/COMPRENSION.md): lentes, estructura, fichas,
 * entidades con sus apariciones e indexado, paso a paso sobre puertos.
 */
export * from './tipos.js';
export * from './flujo.js';
export * from './estado.js';
export { modeloDesdeRedactor, llamar, ErrorPresupuestoComprension, modeloDelPaso, ErrorPlazo, MARGEN_PASO_MS } from './modelo.js';
export { DEFINICIONES_LENTES, ESQUEMA_ELECCION, SISTEMA_ELECCION, elegirLentes, lente, senales, versionDe, type Eleccion, type EntradaEleccion } from './lentes/index.js';
export { REGLAS_COMUNES, VERSION_COMPRENSION, esquemaFichaGlobal, esquemaFichasSegmento } from './lentes/comun.js';
export { leerMaterial, textoParaModelo, muestraDe, etiquetaUnidad, tokensDe, huecosTranscripcion, coberturaDelMaterial, type VozPercibida, type Material, type UnidadMaterial, type FotogramaMaterial } from './material.js';
export { localizarCita, limpiarProsa, hablantePercibido, anclarReferencias, anclarReferencia, anclaDe, tramoDeCaracteres, hablanteEn, buscarFormasEnUnidad, textoDeCaracteres, type CitaLocalizada } from './anclaje.js';
export { construirArbol, segmentosDeSecciones, segmentosDePercepcion, borradoresDelModelo, guardarEstructura, esquemaEstructura, ventanas } from './estructura.js';
export { fichasDeLote, fichaGlobal, lotesDeFichas, textoEstructura, idCorto, prefijoMaterial, huellaEntradaSegmento } from './fichas.js';
export {
  TIPO_GRAFO, TIPOS_FINOS, ESQUEMA_ENTIDADES, resolverEntidades, aparicionesDeTexto, aparicionesDePercepcion, aparicionesDeTemas, enlazarReparto, fichasDeEntidades,
  unirEntidades, conocidasEnBiblioteca, extraerEntidadesDelModelo, analizarEntidades, principalesDe, conLimite, cacheWikidataSql,
  ESQUEMA_ANALISIS, ESPERA_TOTAL_WIKIDATA_MS, FRAGMENTO_REPARTO, type EntidadResuelta, type Papel,
} from './entidades.js';
export { buscarObraAudiovisual, repartoWikidata, ESPERA_WIKIDATA_MS, type PapelWikidata, type CacheWikidata } from './reparto.js';
export { fichasDePlanos, prosaPlano, textoEscena, textoPlano } from './medios.js';
export { indexarFichas, textoVectorFicha } from './indexado.js';
export { huella as huellaComprension } from './util.js';
