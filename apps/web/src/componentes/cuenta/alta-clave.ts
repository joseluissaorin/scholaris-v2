/** Dónde se apunta que una cuenta ya vio el alta (la raíz lo mira sin cargar el alta). */
export const claveAltaVista = (usuario: string) => `scholaris:alta-vista:${usuario}`;
