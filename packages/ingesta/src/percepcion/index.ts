/**
 * Percepción completa de un medio (docs/COMPRENSION.md, «Ingesta», paso 1) y
 * anclaje material de las páginas. Notas y mediciones en NOTAS.md.
 */
export * from './tipos.js';
export { ventana, ventanasDe, partirVentana, marca, aSegundos, turnosDe, transcripcionDeVentana, hablantesDe, type Ventana, type Turno } from './ventanas.js';
export { esquemaVentana, instruccionesSistema, textoVentana, VERSION_PERCEPCION, ESCALAS, ANGULACIONES, MOVIMIENTOS, CLASES_SONIDO, type ContextoVentana } from './esquema.js';
export { normalizarVentana, fusionar, fusionarPlanos, fusionarEscenas, fusionarSonidos, fusionarDialogos, componerEscenas, regionDeCaja, corteCercano, type VentanaNormalizada, type EscenaPlana, type DialogoPlano } from './fusion.js';
export { Unificador, fusionarReparto, repartoInicial, repartoDeWikidata, separarInterpretes, normalNombre } from './reparto.js';
export { percibirMedio, mirarVentana, ErrorPresupuesto, type VentanaGrabada, type OpcionesVentana } from './percibir.js';
export { PROXY, clavesProxy, PARAMETROS_PROXY, interpretarEscenasFfmpeg, cortesDe, interpretarSilencios, type CortesProxy, type ActividadAudio } from './proxy.js';
export { fuenteGemini, ErrorSinProxy, type PuertoFicheros, type FicheroRemoto, type AlmacenProxy, type CacheGemini, type PuertosFuenteGemini } from './fuente-gemini.js';
export { anclarMaterial, buscarCita, textoEn, esqueleto, regionPorLineas, regionPorVision, unirRegiones, cajasPrincipales, type PuertosAnclaje, type UnidadAnclable, type LineaPagina, type AnclajeResultado } from './anclaje.js';
export {
  revisarTranscripcionConVideo, hablantesDeDialogos, coberturaTranscripcion, transcribirConVideo, revisarHablantesVentana, aplicarCorrecciones, palabrasDeUnidad, palabrasDeUnidades, palabrasTranscritas, comprobarRevision, frasesUbicadas, subventanasDe, segmentosDePalabras, esRota,
  VERSION_REVISION, ESQUEMA_OIDO, ESQUEMA_HABLANTES,
  type CorreccionTranscripcion, type RevisionTranscripcion, type CoberturaTranscripcion, type Hueco, type SegmentoOido, type PalabraUbicada, type FraseUbicada, type PuertosRevision, type OpcionesRevisionTranscripcion, type Tramo,
} from './revision.js';
