/** Mensajes de la cola de segundo plano. */
export type MensajeCola =
  | { tipo: 'vigilantes'; usuario: string; plan: 'gratis' | 'pro'; modo: 'diario' | 'semanal' };
