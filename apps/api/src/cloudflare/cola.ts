/** Mensajes de la cola de segundo plano. */
export type MensajeCola =
  | { tipo: 'vigilantes'; usuario: string; plan: 'gratis' | 'pro'; modo: 'diario' | 'semanal' }
  /** Volver a mandar a Vectorize los vectores de un documento que se quedaron pendientes. */
  | { tipo: 'reindexar'; usuario: string; documento: string }
  /** Mantenimiento de una cuenta entera, por tandas con reanudación: reinsertar en Vectorize o rellenar vectores de figuras. */
  | { tipo: 'mantenimiento'; usuario: string; trabajo: TrabajoMantenimiento; desde?: string };

export type TrabajoMantenimiento = 'reindexar' | 'figuras';
