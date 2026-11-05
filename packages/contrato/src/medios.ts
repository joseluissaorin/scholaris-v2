/**
 * La transcripción revisada de los audios y los vídeos y la percepción de los
 * que ya están en la biblioteca (apps/api/src/rutas/transcripcion.ts):
 *
 *   GET  /documentos/:id/transcripcion/revision → RevisionTranscripcionVista
 *   POST /documentos/:id/transcripcion/revisar  RevisarTranscripcion
 *        → RevisionSimulada (con `simular`) | RevisionLanzada (202)
 *   POST /transcripcion/revisar                 PedirMediosBiblioteca → EstimacionMedios | MediosLanzados (202)
 *   POST /medios/percibir                       PedirMediosBiblioteca → EstimacionMedios | MediosLanzados (202)
 *
 * Todo lo que gasta modelo se estima antes: con `simular` (o sin `confirmar`, en
 * las de la biblioteca) solo se calcula lo que se haría y lo que costaría.
 */

/** Lo que se le haría a un medio: el proxy ligero, la percepción, rellenar huecos, revisar hablantes y reescribir la transcripción. */
export type ParteTrabajoMedio = 'proxy' | 'percepcion' | 'huecos' | 'hablantes' | 'reescritura';

export interface EstimacionMedio {
  documento: string;
  titulo: string;
  tipo: string;
  /** Segundos. */
  duracion: number;
  tieneProxy: boolean;
  tienePercepcion: boolean;
  tieneRevision: boolean;
  revisionAplicada: boolean;
  hara: ParteTrabajoMedio[];
  /** Dólares. */
  usd: number;
}

/** Dólares por hora de medio de cada parte. */
export interface PreciosMedio {
  percepcion: number;
  huecos: number;
  hablantes: number;
}

/** Un tramo en que suena algo y la transcripción no lo recoge (o lo recoge con los tiempos rotos). */
export interface HuecoTranscripcion {
  t0: number;
  t1: number;
  motivo: 'sin_texto' | 'tiempos_rotos';
  /** Segundos con sonido dentro del hueco. */
  activo: number;
}

export interface CoberturaTranscripcionVista {
  /** Segundos con sonido en la banda de la voz. */
  activo: number;
  /** Segundos con sonido cubiertos por palabras con instante válido. */
  cubierto: number;
  huecos: number;
  segundosSinTexto: number;
  palabrasRotas: number;
  /** Segundos sin palabras que son música según la percepción: no cuentan como habla perdida (fuera de `activo`). */
  musica?: number;
  /** Los huecos con su tramo (los primeros), para marcarlos en la línea del tiempo. */
  lista?: HuecoTranscripcion[];
}

export interface TareaMedioVista {
  id: string;
  /** en_cola | procesando | listo | error | cancelada */
  estado: string;
  actualizada: string;
  error?: string;
}

export interface RevisionTranscripcionVista {
  documento: string;
  version?: string;
  modelo?: string;
  /** Cuándo se aplicó a las unidades (null: guardada sin aplicar, o aún no hay revisión). */
  aplicada: string | null;
  correcciones?: { huecos: number; tiemposRotos: number; hablantes: number; desfases: number };
  cobertura?: { antes: CoberturaTranscripcionVista; despues?: CoberturaTranscripcionVista };
  usd?: number;
  avisos?: string[];
  /** La última tarea de revisión o de percepción de este medio. */
  tarea: TareaMedioVista | null;
  avisosDocumento: Array<{ codigo: string; mensaje: string }>;
}

export interface RevisarTranscripcion {
  /** Volver a revisar aunque haya una revisión guardada sin aplicar. */
  rehacer?: boolean;
  /** Aplicar aunque ya conste como aplicada. */
  forzar?: boolean;
  /** Revisar también quién dice cada frase (planes de pago). */
  hablantes?: boolean;
  /** Hacer antes la percepción completa del medio. */
  percepcion?: boolean;
  /** Solo decir qué se haría y cuánto costaría. */
  simular?: boolean;
  presupuestoUsd?: number;
}

export interface RevisionSimulada {
  documento: string;
  lanzada: false;
  estimacion: EstimacionMedio | null;
  precios: PreciosMedio;
}

export interface RevisionLanzada {
  documento: string;
  tarea: string;
  lanzada: true;
  estimacion: EstimacionMedio | null;
}

export interface PedirMediosBiblioteca {
  documentos?: string[];
  /** Sin él, solo se estima. */
  confirmar?: boolean;
  rehacer?: boolean;
  hablantes?: boolean;
  /** Tope del gasto total: si la estimación lo pasa, no se lanza nada (409). */
  presupuestoUsd?: number;
}

export interface EstimacionMedios {
  lanzada: false;
  documentos: EstimacionMedio[];
  usd: number;
  horas: number;
  precios: PreciosMedio;
  /** En la percepción: si se revisarán también los hablantes. */
  hablantes?: boolean;
  aviso?: string;
}

export interface MediosLanzados {
  lanzada: true;
  documentos: EstimacionMedio[];
  usd: number;
  horas: number;
  precios?: PreciosMedio;
  hablantes?: boolean;
  encolados: number;
  lanzados: Array<{ documento: string; tarea: string }>;
}
