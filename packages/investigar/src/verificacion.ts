/**
 * La verificación: cada frase de la respuesta se comprueba contra las pruebas que
 * cita (un modelo barato, por lotes). Las citas literales tienen que estar en sus
 * pruebas. Lo visual se comprueba volviendo a mirar el vídeo o la página. Las
 * frases que afirman un hecho sin prueba se marcan.
 */
import type { FraseVerificada } from '@scholaris/contrato';
import { contieneLiteral } from '@scholaris/busqueda';
import { recortar, type ContextoHerramientas } from './contexto.js';
import type { Numerador } from './sintesis.js';
import { volverAMirar } from './vision.js';

export interface FraseRespuesta {
  /** El texto tal como está en la respuesta (con sus marcas). */
  original: string;
  /** Sin marcas ni Markdown. */
  limpia: string;
  evidencias: string[];
  /** Fila de una tabla (no se le añade la marca de «sin prueba» dentro). */
  tabla: boolean;
}

const MARCA_E = /\[E(\d+)\]/g;

/**
 * Parte un párrafo en oraciones sin cortar dentro de una cita «…» ni de un paréntesis:
 * el corte va tras el punto (y las marcas [E#] que lo siguen), antes de mayúscula o signo de apertura.
 */
export function oracionesDe(parrafo: string): string[] {
  const salida: string[] = [];
  let profundidad = 0;
  let inicio = 0;
  for (let i = 0; i < parrafo.length; i++) {
    const c = parrafo[i]!;
    let cierraOracion = false;
    if (c === '«' || c === '(' || c === '“') profundidad++;
    else if ((c === '»' || c === ')' || c === '”') && profundidad > 0) {
      profundidad--;
      // «… apostamos.» [E8] Después: la cita acababa en punto, la oración también.
      cierraOracion = profundidad === 0 && /[.!?…]\s*$/.test(parrafo.slice(Math.max(0, i - 3), i));
    }
    if (profundidad > 0 || (!cierraOracion && !'.!?…'.includes(c))) continue;
    let j = i + 1;
    // Lo que cierra la oración: comillas, paréntesis y las marcas que van detrás del punto.
    for (;;) {
      const m = /^(?:[»”)\]]|\s*\[E\d+\])/.exec(parrafo.slice(j));
      if (!m) break;
      j += m[0].length;
    }
    const resto = parrafo.slice(j);
    // No se corta ante un paréntesis: tras una cita suele venir su localizador («…» (11:30-12:01) [E34]).
    if (/^\s+[«“"¿¡\p{Lu}]/u.test(resto)) {
      salida.push(parrafo.slice(inicio, j).trim());
      inicio = j;
      i = j - 1;
    }
  }
  const ultimo = parrafo.slice(inicio).trim();
  if (ultimo) salida.push(ultimo);
  return salida;
}

/** Las frases de la respuesta (oraciones de cada párrafo y filas de tabla), sin encabezados ni la lista de pruebas. */
export function frasesDe(markdown: string): FraseRespuesta[] {
  const cuerpo = markdown.replace(/\n#{1,3}\s*(Pruebas|Evidence)\s*\n[\s\S]*$/i, '');
  const salida: FraseRespuesta[] = [];
  for (const linea of cuerpo.split('\n')) {
    const l = linea.trim();
    if (!l || /^#{1,6}\s/.test(l) || /^\|?\s*:?-{3,}/.test(l)) continue;
    const tabla = l.startsWith('|');
    const trozos = tabla ? [l] : oracionesDe(l.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^>\s*/, ''));
    for (const t of trozos) {
      const evidencias = [...new Set([...t.matchAll(MARCA_E)].map((m) => `E${m[1]}`))];
      const limpia = t.replace(MARCA_E, '').replace(/\*\*|__|`/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
      if (limpia.length < 25) continue;
      salida.push({ original: t, limpia, evidencias, tabla });
    }
  }
  return salida;
}

const ESQUEMA = {
  type: 'object',
  properties: {
    frases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          veredicto: { type: 'string', enum: ['respaldada', 'parcial', 'sin_respaldo', 'sin_prueba', 'interpretacion'] },
          nota: { type: 'string', description: 'Qué falta o qué no cuadra, en una frase (vacío si está respaldada).' },
        },
        required: ['i', 'veredicto'],
      },
    },
  },
  required: ['frases'],
};

const SISTEMA = `Compruebas frase a frase una respuesta académica contra sus pruebas. Para cada frase numerada:
- Si cita pruebas: «respaldada» si las pruebas dicen lo que afirma (o lo implican claramente); «parcial» si solo sostienen una parte o la frase exagera; «sin_respaldo» si no lo dicen o lo contradicen.
- Si no cita pruebas: «interpretacion» si es comentario, análisis o conclusión razonada (no necesita cita); «sin_prueba» si afirma un hecho concreto de las obras (qué pasa, qué dice alguien, cómo está filmado, en qué página o minuto) que necesitaría una prueba.
- Una afirmación de ausencia («la película no muestra…», «el cuento no menciona…», «no hay…») es «sin_prueba» salvo que las pruebas citadas muestren el tramo entero donde debería estar.
Sé estricto con los datos concretos (quién, qué, cuándo, cómo se ve, quién dice qué) y generoso con la interpretación. Las notas, en español.`;

/** Verifica las frases. `revisiones`: cuántas frases visuales se pueden volver a mirar. */
export async function verificar(ctx: ContextoHerramientas, numerador: Numerador, markdown: string, revisiones: number): Promise<{ frases: FraseVerificada[]; detalle: Array<FraseRespuesta & { veredicto: FraseVerificada['veredicto'] | 'interpretacion'; nota?: string; revisada?: boolean }> }> {
  const frases = frasesDe(markdown);
  const veredictos = new Map<number, { veredicto: FraseVerificada['veredicto'] | 'interpretacion'; nota?: string; revisada?: boolean }>();
  // 1. Citas literales: tienen que estar en alguna de sus pruebas.
  frases.forEach((f, i) => {
    for (const m of f.original.matchAll(/«([^«»]{12,})»/g)) {
      const cita = (m[1] as string).trim();
      const enAlguna = f.evidencias.some((id) => {
        const x = numerador.marcada(id);
        if (!x) return false;
        return contieneLiteral(x.evidencia.cita ?? '', cita) || contieneLiteral(x.prueba.ambito?.texto ?? '', cita) || contieneLiteral(x.prueba.evidencia.cita ?? '', cita);
      });
      // Una traducción entre paréntesis detrás de la marca no está en la prueba: no cuenta.
      const esTraduccion = new RegExp(`\\]\\s*\\(\\s*«${cita.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(f.original);
      if (!enAlguna && !esTraduccion && f.evidencias.length) veredictos.set(i, { veredicto: 'sin_respaldo', nota: `La cita «${recortar(cita, 80)}» no está en sus pruebas.` });
    }
  });
  // 2. El verificador, por lotes.
  const modelo = ctx.p.modelos.verificador ?? ctx.p.modelos.agente;
  const pendientes = frases.map((f, i) => ({ f, i })).filter(({ i }) => !veredictos.has(i));
  const lotes: Array<typeof pendientes> = [];
  for (let k = 0; k < pendientes.length; k += 16) lotes.push(pendientes.slice(k, k + 16));
  await Promise.all(lotes.map(async (lote) => {
    const ids = [...new Set(lote.flatMap(({ f }) => f.evidencias))];
    const pruebas = ids.map((id) => {
      const x = numerador.marcada(id);
      if (!x) return '';
      const e = x.evidencia;
      // La cita exacta y, si la prueba es una página o un tramo, su texto entero: una frase puede
      // apoyarse en otra parte de la misma página (y el principio no basta para juzgarla).
      const amb = x.prueba.ambito?.texto;
      const contexto = amb && amb.length > (e.cita?.length ?? 0) + 40 ? `\n   Texto de la unidad: ${recortar(amb, 6000)}` : '';
      return `[${id}] ${e.citaCorta} · ${e.modo}${e.nota ? ` (${recortar(e.nota, 160)})` : ''}: ${recortar(e.cita ?? '', 900)}${contexto}`;
    }).filter(Boolean).join('\n');
    const lista = lote.map(({ f, i }) => `${i}. ${f.limpia}${f.evidencias.length ? ` [cita: ${f.evidencias.join(', ')}]` : ' [sin citas]'}`).join('\n');
    try {
      const r = await modelo.turno({
        sistema: SISTEMA,
        mensajes: [{ rol: 'usuario', partes: [{ tipo: 'texto', texto: `PRUEBAS:\n${pruebas || '(ninguna)'}\n\nFRASES:\n${lista}` }] }],
        esquema: ESQUEMA, temperatura: 0, pensamiento: 'bajo', maxTokens: 6000, ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      ctx.cuentas.apuntar(r.uso);
      for (const x of ((r.json as { frases?: Array<{ i: number; veredicto: string; nota?: string }> })?.frases ?? [])) {
        if (!lote.some((l) => l.i === x.i)) continue;
        const v = (['respaldada', 'parcial', 'sin_respaldo', 'sin_prueba', 'interpretacion'] as const).find((y) => y === x.veredicto);
        if (!v) continue;
        // Una frase con citas no puede quedar «sin prueba», ni una sin citas «respaldada».
        const f = frases[x.i]!;
        const ajustado = f.evidencias.length ? (v === 'sin_prueba' || v === 'interpretacion' ? 'respaldada' : v) : (v === 'respaldada' || v === 'parcial' || v === 'sin_respaldo' ? 'sin_prueba' : v);
        veredictos.set(x.i, { veredicto: ajustado, ...(x.nota?.trim() ? { nota: x.nota.trim() } : {}) });
      }
    } catch (e) {
      ctx.avisos.push(`La verificación de un lote falló: ${(e as Error).message}`);
    }
  }));
  // 3. Lo visual y quién dice qué, volviendo a mirar: primero lo visual, luego las atribuciones de
  // una frase a un hablante que solo se apoyan en la transcripción (sus etiquetas pueden fallar).
  let quedan = revisiones;
  const aRevisar: Array<{ i: number; f: FraseRespuesta; prueba: NonNullable<ReturnType<Numerador['marcada']>> }> = [];
  for (const [i, f] of frases.entries()) {
    const v = veredictos.get(i);
    if (!v || (v.veredicto !== 'respaldada' && v.veredicto !== 'parcial')) continue;
    const visual = f.evidencias.map((id) => numerador.marcada(id)).find((x) => x && x.prueba.capa === 'percepcion' && (x.evidencia.modo === 'video' || x.evidencia.modo === 'imagen'));
    if (visual) aRevisar.push({ i, f, prueba: visual });
  }
  for (const [i, f] of frases.entries()) {
    const v = veredictos.get(i);
    if (!v || (v.veredicto !== 'respaldada' && v.veredicto !== 'parcial') || aRevisar.some((x) => x.i === i)) continue;
    const dicho = f.evidencias.map((id) => numerador.marcada(id)).find((x) => {
      const a = x?.evidencia.ancla;
      return x && x.evidencia.modo === 'audio' && a?.tipo === 'tiempo' && !!a.hablante && f.limpia.toLowerCase().includes(a.hablante.toLowerCase());
    });
    if (dicho) aRevisar.push({ i, f, prueba: dicho });
  }
  for (const { i, f, prueba: visual } of aRevisar) {
    if (quedan <= 0) break;
    const v = veredictos.get(i)!;
    quedan--;
    try {
      const r = await volverAMirar(ctx, visual.prueba, f.limpia);
      if (!r) continue;
      if (r.veredicto === 'no') veredictos.set(i, { veredicto: 'sin_respaldo', nota: `Al volver a mirar: ${r.nota}`, revisada: true });
      else veredictos.set(i, { ...v, ...(r.veredicto === 'dudoso' ? { veredicto: 'parcial' as const, nota: `Al volver a mirar: ${r.nota}` } : {}), revisada: true });
    } catch (e) {
      ctx.avisos.push(`No se pudo volver a mirar: ${(e as Error).message}`);
    }
  }
  const detalle = frases.map((f, i) => ({ ...f, ...(veredictos.get(i) ?? { veredicto: (f.evidencias.length ? 'respaldada' : 'interpretacion') as FraseVerificada['veredicto'] | 'interpretacion', nota: 'Sin verificar.' }) }));
  const salida: FraseVerificada[] = detalle
    .filter((d) => d.veredicto !== 'interpretacion')
    .map((d) => ({ frase: d.limpia, evidencias: d.evidencias, veredicto: d.veredicto as FraseVerificada['veredicto'], ...(d.nota ? { nota: d.nota } : {}), ...(d.revisada ? { revisada: true } : {}) }));
  return { frases: salida, detalle };
}

/** Confianza de la respuesta según la verificación. */
export function confianzaDe(frases: FraseVerificada[]): 'alta' | 'media' | 'baja' {
  const conCita = frases.filter((f) => f.evidencias.length);
  if (!conCita.length) return 'baja';
  const buenas = conCita.filter((f) => f.veredicto === 'respaldada').length;
  const malas = frases.filter((f) => f.veredicto === 'sin_respaldo' || f.veredicto === 'sin_prueba').length;
  const r = buenas / conCita.length;
  if (r >= 0.85 && malas <= 1) return 'alta';
  if (r >= 0.6) return 'media';
  return 'baja';
}

/** Marca en el texto las frases sin respaldo o sin prueba (fuera de las tablas). */
export function marcarSinPrueba(markdown: string, detalle: Array<FraseRespuesta & { veredicto: string }>): string {
  let salida = markdown;
  for (const d of detalle) {
    if (d.tabla || (d.veredicto !== 'sin_respaldo' && d.veredicto !== 'sin_prueba')) continue;
    const i = salida.indexOf(d.original);
    if (i < 0) continue;
    const fin = i + d.original.length;
    salida = `${salida.slice(0, fin)} [sin prueba]${salida.slice(fin)}`;
  }
  return salida;
}
