/**
 * Reordenadores construidos sobre otros puertos, para comparar en el banco de
 * calidad con Jev y con los de Workers AI:
 *
 * - `reordenadorConRedactor`: reordenación por lista con un LLM rápido (una
 *   llamada: nota 0-3 para cada pasaje).
 */
import type { Redactor, Reordenador } from '@scholaris/nucleo';

const SISTEMA = `Ordenas resultados de un buscador académico. Recibes una consulta y pasajes numerados (en cualquier idioma).
Puntúa cada pasaje de 0 a 3 según cuánto ayuda a responder la consulta: 3 = la responde directamente o contiene la frase buscada; 2 = trata el asunto con información útil; 1 = solo comparte tema o palabras; 0 = nada que ver.
El idioma no importa. Devuelve SOLO JSON {"p":[nota del pasaje 1, nota del 2, ...]} con exactamente una nota por pasaje.`;

export function reordenadorConRedactor(redactor: Redactor, o: { caracteres?: number; calidad?: 'rapida' | 'alta' } = {}): Reordenador {
  const max = o.caracteres ?? 700;
  return {
    nombre: `llm:${redactor.nombre}`,
    async reordenar(consulta, textos) {
      if (!textos.length) return [];
      const cuerpo = textos.map((t, i) => `[${i + 1}] ${t.replace(/\s+/g, ' ').slice(0, max)}`).join('\n\n');
      const r = await redactor.generar<{ p: number[] }>({
        sistema: SISTEMA,
        mensajes: [{ rol: 'usuario', partes: [{ texto: `Consulta: ${consulta}\n\n${cuerpo}` }] }],
        esquema: { type: 'object', properties: { p: { type: 'array', items: { type: 'number' } } }, required: ['p'] },
        temperatura: 0, maxTokens: 400, calidad: o.calidad ?? 'rapida',
      });
      const p = r.json?.p ?? [];
      return textos.map((_, i) => {
        const v = Number(p[i]);
        return Number.isFinite(v) ? Math.max(0, Math.min(3, v)) / 3 : 0;
      });
    },
  };
}
