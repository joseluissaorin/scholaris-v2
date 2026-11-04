/** Informe del banco de comprensión: JSON completo y Markdown legible. */
import { agregar, porCategoria, type Agregado } from './puntuar.js';
import type { JuicioPregunta, ModoRespuesta, Pregunta, RespuestaNormalizada } from './tipos.js';

export interface Ejecucion {
  fecha: string;
  modo: ModoRespuesta;
  juez: string;
  base: string;
  sha: string;
  etiqueta?: string;
  preguntas: number;
  total: Agregado;
  porCategoria: Record<string, Agregado>;
  /** Coste y latencia del sistema que responde y del juez. */
  coste: { usdRespuestas?: number; usdJuez: number; msP50: number; msP95: number; msMedia: number };
  errores: Array<{ pregunta: string; error: string }>;
  detalle: Array<{ pregunta: Pregunta; respuesta: RespuestaNormalizada; juicio: JuicioPregunta }>;
}

export function percentil(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1))] as number;
}

export function resumir(base: Omit<Ejecucion, 'total' | 'porCategoria' | 'coste' | 'errores' | 'preguntas'>): Ejecucion {
  const juicios = base.detalle.map((d) => d.juicio);
  const ms = base.detalle.map((d) => d.respuesta.ms);
  const usdR = base.detalle.map((d) => d.respuesta.usd).filter((x): x is number => typeof x === 'number');
  return {
    ...base,
    preguntas: base.detalle.length,
    total: agregar(juicios),
    porCategoria: porCategoria(base.detalle.map((d) => d.pregunta), juicios),
    coste: {
      ...(usdR.length ? { usdRespuestas: usdR.reduce((a, b) => a + b, 0) } : {}),
      usdJuez: juicios.reduce((a, j) => a + j.usdJuez, 0),
      msP50: percentil(ms, 50), msP95: percentil(ms, 95), msMedia: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0,
    },
    errores: base.detalle.filter((d) => d.respuesta.error).map((d) => ({ pregunta: d.pregunta.id, error: d.respuesta.error as string })),
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const n1 = (x: number) => x.toFixed(1);
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const celda = (t: string) => t.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function informeMarkdown(e: Ejecucion): string {
  const t = e.total;
  const cats = Object.entries(e.porCategoria).filter(([k]) => k !== 'todas').sort((a, b) => a[0].localeCompare(b[0]));
  const filasCat = cats.map(([k, a]) => `| ${k} | ${a.n} | ${n1(a.nota)} | ${pct(a.acierto)} | ${pct(a.exhaustividad)} | ${pct(a.precisionCitas)} | ${a.citasInventadas} | ${a.contradichos} | ${a.trampas} |`);
  const filasPreg = e.detalle.map(({ pregunta: p, respuesta: r, juicio: j }) => {
    const x = j.puntuacion;
    return `| ${p.id} | ${p.categorias.join(', ')} | ${p.dificultad} | ${n1(x.nota)} | ${pct(x.acierto)} | ${pct(x.exhaustividad)} | ${x.citas ? `${x.citasSostienen + x.citasParciales / 2}/${x.citas - x.citasSinComprobar}` : '0'} | ${x.citasInventadas} | ${x.contradichos} | ${x.trampas} | ${s(r.ms)} |`;
  });
  // Lo que más falla: puntos obligatorios ausentes o contradichos, trampas y citas que no sostienen.
  const fallos = e.detalle.flatMap(({ pregunta: p, juicio: j }) => {
    const porId = new Map(p.rubrica.puntos.map((x) => [x.id, x]));
    const malos = j.puntos.filter((x) => porId.get(x.id)?.obligatorio && (x.veredicto === 'contradicho' || x.veredicto === 'ausente'));
    return [
      ...malos.filter((x) => x.veredicto === 'contradicho').map((x) => `- **${p.id}** contradice ${x.id} («${celda(porId.get(x.id)!.afirmacion).slice(0, 140)}»): ${celda(x.motivo)}`),
      ...j.trampas.filter((x) => x.activada).map((x) => `- **${p.id}** cae en la trampa «${celda(x.trampa)}»: ${celda(x.motivo)}`),
      ...j.citas.filter((c) => c.veredicto === 'inventada' || c.veredicto === 'no_sostiene').slice(0, 3).map((c) => `- **${p.id}** cita ${c.cita} (${c.etiqueta || 's. l.'}) ${c.veredicto === 'inventada' ? 'inventada' : 'que no sostiene'} la frase «${celda(c.frase).slice(0, 120)}»: ${celda(c.motivo)}`),
    ];
  });
  return `# Banco de comprensión: ${e.modo}

${e.fecha.slice(0, 16).replace('T', ' ')} UTC, \`${e.sha}\`${e.etiqueta ? `, ${e.etiqueta}` : ''}. Sistema: \`${e.base}\` (modo ${e.modo}). Juez: \`${e.juez}\`. ${e.preguntas} preguntas.

Nota media **${n1(t.nota)}** sobre 100. Acierto (puntos obligatorios) **${pct(t.acierto)}**, exhaustividad ${pct(t.exhaustividad)}, precisión de las citas **${pct(t.precisionCitas)}** sobre ${t.citas} citas, citas inventadas **${t.citasInventadas}**, puntos contradichos ${t.contradichos}, trampas ${t.trampas}.

Latencia de la respuesta: mediana ${s(e.coste.msP50)}, p95 ${s(e.coste.msP95)}. Coste del juez: ${e.coste.usdJuez.toFixed(3)} $${e.coste.usdRespuestas !== undefined ? `; coste declarado de las respuestas: ${e.coste.usdRespuestas.toFixed(3)} $` : ''}.${e.errores.length ? `\n\nErrores: ${e.errores.map((x) => `${x.pregunta} (${celda(x.error).slice(0, 120)})`).join('; ')}.` : ''}

La nota de cada pregunta pondera el acierto (50 %), la exhaustividad (30 %) y la precisión de las citas (20 %), y resta 10 por punto contradicho, 15 por trampa y 10 por cita inventada.

## Por categoría

| Categoría | n | Nota | Acierto | Exhaustividad | Precisión de citas | Inventadas | Contradichos | Trampas |
|---|---|---|---|---|---|---|---|---|
${filasCat.join('\n')}

## Por pregunta

| Pregunta | Categorías | Dif. | Nota | Acierto | Exhaust. | Citas que sostienen | Inventadas | Contradichos | Trampas | Tiempo |
|---|---|---|---|---|---|---|---|---|---|---|
${filasPreg.join('\n')}

## Fallos más significativos

${fallos.length ? fallos.join('\n') : 'Ninguno.'}
`;
}
