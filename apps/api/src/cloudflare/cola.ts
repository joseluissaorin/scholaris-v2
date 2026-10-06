/** Mensajes de la cola de segundo plano. */
export type MensajeCola =
  | { tipo: 'vigilantes'; usuario: string; plan: 'gratis' | 'pro'; modo: 'diario' | 'semanal' }
  /** Volver a mandar a Vectorize los vectores de un documento que se quedaron pendientes. */
  | { tipo: 'reindexar'; usuario: string; documento: string };
