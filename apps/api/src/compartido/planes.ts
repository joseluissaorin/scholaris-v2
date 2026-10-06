/** Límites de cada plan. null = sin límite. */
import type { Plan } from '@scholaris/contrato';

export interface LimitesPlan {
  documentos: number | null;
  paginasMes: number | null;
  busquedasDia: number | null;
  autocitasMes: number | null;
  bytes: number | null;
  /** Peticiones por minuto (limitador de ritmo). */
  porMinuto: number;
  /** Tamaño máximo de un original. */
  bytesSubida: number;
}

const MB = 1024 * 1024;

export const LIMITES: Record<Plan | 'local', LimitesPlan> = {
  gratis: { documentos: 25, paginasMes: 1500, busquedasDia: 100, autocitasMes: 5, bytes: 1024 * MB, porMinuto: 120, bytesSubida: 200 * MB },
  pro: { documentos: 5000, paginasMes: 60000, busquedasDia: 5000, autocitasMes: 500, bytes: 100 * 1024 * MB, porMinuto: 600, bytesSubida: 4 * 1024 * MB },
  local: { documentos: null, paginasMes: null, busquedasDia: null, autocitasMes: null, bytes: null, porMinuto: 100000, bytesSubida: 16 * 1024 * MB },
};

export type Metrica = 'paginasMes' | 'busquedasDia' | 'autocitasMes';

/** Periodo de la métrica: «2026-10» para las mensuales, «2026-10-06» para las diarias. */
export function periodo(m: Metrica, fecha = new Date()): string {
  const iso = fecha.toISOString();
  return m === 'busquedasDia' ? iso.slice(0, 10) : iso.slice(0, 7);
}
