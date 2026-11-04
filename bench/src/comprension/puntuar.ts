/**
 * Puntuación del banco de comprensión: funciones puras, sin red, para que los
 * números se puedan comprobar en las pruebas.
 *
 * Nota de una pregunta (0-100):
 *   50 % acierto (puntos obligatorios) + 30 % exhaustividad (todos los puntos)
 *   + 20 % precisión de las citas,
 *   menos 10 por cada punto contradicho, 15 por cada trampa en la que cae y 10 por
 *   cada cita inventada (nunca por debajo de 0).
 */
import type { Categoria, JuicioCita, JuicioPregunta, JuicioPunto, JuicioTrampa, Pregunta, Puntuacion, VeredictoPunto } from './tipos.js';

export const VALOR_PUNTO: Record<VeredictoPunto, number> = { cubierto: 1, parcial: 0.5, ausente: 0, contradicho: 0 };

const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function puntuar(p: Pregunta, puntos: JuicioPunto[], trampas: JuicioTrampa[], citas: JuicioCita[]): Puntuacion {
  const veredicto = new Map(puntos.map((j) => [j.id, j.veredicto]));
  // Un punto que el juez no devolvió cuenta como ausente.
  const valor = (id: string) => VALOR_PUNTO[veredicto.get(id) ?? 'ausente'];
  const obligatorios = p.rubrica.puntos.filter((x) => x.obligatorio);
  const acierto = media((obligatorios.length ? obligatorios : p.rubrica.puntos).map((x) => valor(x.id)));
  const exhaustividad = media(p.rubrica.puntos.map((x) => valor(x.id)));
  const contradichos = p.rubrica.puntos.filter((x) => veredicto.get(x.id) === 'contradicho').length;
  const nTrampas = trampas.filter((t) => t.activada).length;
  const cuenta = (v: JuicioCita['veredicto']) => citas.filter((c) => c.veredicto === v).length;
  const sostienen = cuenta('sostiene'), parciales = cuenta('parcial'), noSostienen = cuenta('no_sostiene'), inventadas = cuenta('inventada'), sinComprobar = cuenta('sin_comprobar');
  const comprobadas = citas.length - sinComprobar;
  const precisionCitas = comprobadas ? (sostienen + 0.5 * parciales) / comprobadas : 0;
  const bruta = 0.5 * acierto + 0.3 * exhaustividad + 0.2 * precisionCitas - 0.1 * contradichos - 0.15 * nTrampas - 0.1 * inventadas;
  return {
    acierto, exhaustividad, contradichos, trampas: nTrampas,
    citas: citas.length, citasSostienen: sostienen, citasParciales: parciales, citasNoSostienen: noSostienen, citasInventadas: inventadas, citasSinComprobar: sinComprobar,
    precisionCitas, nota: Math.round(Math.max(0, Math.min(1, bruta)) * 1000) / 10,
  };
}

export interface Agregado {
  n: number;
  nota: number;
  acierto: number;
  exhaustividad: number;
  precisionCitas: number;
  contradichos: number;
  trampas: number;
  citas: number;
  citasInventadas: number;
}

export function agregar(juicios: JuicioPregunta[]): Agregado {
  const ps = juicios.map((j) => j.puntuacion);
  const citas = ps.reduce((a, x) => a + x.citas, 0);
  const comprobadas = ps.reduce((a, x) => a + x.citas - x.citasSinComprobar, 0);
  const pesoCitas = ps.reduce((a, x) => a + x.citasSostienen + 0.5 * x.citasParciales, 0);
  return {
    n: ps.length,
    nota: media(ps.map((x) => x.nota)),
    acierto: media(ps.map((x) => x.acierto)),
    exhaustividad: media(ps.map((x) => x.exhaustividad)),
    // Precisión de las citas sobre el total de citas (micro), no media de medias.
    precisionCitas: comprobadas ? pesoCitas / comprobadas : 0,
    contradichos: ps.reduce((a, x) => a + x.contradichos, 0),
    trampas: ps.reduce((a, x) => a + x.trampas, 0),
    citas,
    citasInventadas: ps.reduce((a, x) => a + x.citasInventadas, 0),
  };
}

/** Agregados por categoría (una pregunta cuenta en todas las suyas) y el total («todas»). */
export function porCategoria(preguntas: Pregunta[], juicios: JuicioPregunta[]): Record<string, Agregado> {
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const grupos = new Map<string, JuicioPregunta[]>([['todas', juicios]]);
  for (const j of juicios) {
    for (const c of porId.get(j.preguntaId)?.categorias ?? ([] as Categoria[])) {
      const l = grupos.get(c) ?? [];
      l.push(j);
      grupos.set(c, l);
    }
  }
  return Object.fromEntries([...grupos].map(([k, l]) => [k, agregar(l)]));
}

/** Acuerdo entre dos series de veredictos de puntos (exacto y «cubierto o no» binario). */
export function acuerdo(a: Record<string, VeredictoPunto>, b: Record<string, VeredictoPunto>): { n: number; exacto: number; binario: number; distancia: number } {
  const ids = Object.keys(a).filter((k) => b[k] !== undefined);
  if (!ids.length) return { n: 0, exacto: 0, binario: 0, distancia: 0 };
  const exacto = ids.filter((k) => a[k] === b[k]).length / ids.length;
  const bin = (v: VeredictoPunto) => VALOR_PUNTO[v] >= 0.5;
  const binario = ids.filter((k) => bin(a[k]!) === bin(b[k]!)).length / ids.length;
  const distancia = media(ids.map((k) => Math.abs(VALOR_PUNTO[a[k]!] - VALOR_PUNTO[b[k]!])));
  return { n: ids.length, exacto, binario, distancia };
}
