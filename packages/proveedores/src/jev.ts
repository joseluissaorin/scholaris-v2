/**
 * Jev (TypeSafe, System One): juicios tipados con probabilidades.
 *
 * - Juez: `si_no` → Noul, `eleccion` → Choice, `escala` → Score. Todas las
 *   preguntas sobre el mismo estado van en UNA petición (Jev las evalúa en
 *   paralelo); si no caben en el presupuesto de 64k tokens, se reparten.
 * - Reordenador: una pregunta Noul por pasaje («¿sirve este pasaje para
 *   responder a la consulta?»), todas en la misma petición; la probabilidad
 *   de «sí» es la puntuación.
 *
 * API comprobada en https://docs.typesafe.ai/api.md (6-10-2026):
 * `POST https://api.typesafe.ai/v1/systemone`, modelo `jev-latest` (= jev-1.13.0),
 * 0,042 $ por millón de tokens de entrada, la salida es gratis.
 */

import type { Juez, PreguntaJuez, Reordenador, RespuestaJuez } from '@scholaris/nucleo';
import { enParalelo } from '@scholaris/nucleo';
import { ahora, apuntador, ErrorProveedor, estimarTokens, limitador, pedir, type ContadorUso, type OpcionesComunes } from './comun.js';
import { costeTokens } from './precios.js';

export interface ConfigJev extends OpcionesComunes {
  clave: string;
  baseUrl?: string;
  modelo?: string;
}

type PreguntaJev =
  | { type: 'noul'; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }
  | { type: 'score'; instructions: unknown; criteria: unknown[] };

type RespuestaJev =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; legend?: Record<string, string>; confidence?: number };

interface CuerpoRespuesta {
  model?: string;
  answers?: Record<string, RespuestaJev>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface ClienteJev {
  readonly contador: ContadorUso;
  /** Petición cruda a /v1/systemone. */
  evaluar(estado: unknown, preguntas: Record<string, PreguntaJev>, operacion?: 'juzgar' | 'reordenar'): Promise<Record<string, RespuestaJev>>;
  juez(): Juez;
  reordenador(o?: { pasajesPorPeticion?: number; instrucciones?: string; criterios?: { si: string; no: string } }): Reordenador;
}

/** Presupuesto prudente: 64k por petición; 32k para estado + la pregunta más larga. */
const MAX_TOKENS_PETICION = 56_000;
const MAX_TOKENS_ESTADO = 28_000;

export function aPreguntaJev(p: PreguntaJuez): PreguntaJev {
  switch (p.tipo) {
    case 'si_no': return { type: 'noul', instructions: p.instrucciones, criteria: { true: p.criterios.si, false: p.criterios.no } };
    case 'eleccion': return { type: 'choice', instructions: p.instrucciones, criteria: p.opciones };
    case 'escala': return { type: 'score', instructions: p.instrucciones, criteria: p.niveles };
  }
}

export function deRespuestaJev(p: PreguntaJuez, r: RespuestaJev | undefined): RespuestaJuez {
  if (!r) throw new ErrorProveedor('jev', 'falta una respuesta');
  switch (p.tipo) {
    case 'si_no':
      if (r.type !== 'noul') throw new ErrorProveedor('jev', `se esperaba noul y llegó ${r.type}`);
      return { tipo: 'si_no', probabilidad: r.noul };
    case 'eleccion': {
      if (r.type !== 'choice') throw new ErrorProveedor('jev', `se esperaba choice y llegó ${r.type}`);
      return { tipo: 'eleccion', probabilidades: r.probabilities, eleccion: r.choice };
    }
    case 'escala': {
      if (r.type !== 'score') throw new ErrorProveedor('jev', `se esperaba score y llegó ${r.type}`);
      const probabilidades = p.niveles.map((_, i) => r.probabilities[String(i)] ?? 0);
      return { tipo: 'escala', valor: r.score, probabilidades };
    }
  }
}

export function crearJev(config: ConfigJev): ClienteJev {
  const base = (config.baseUrl ?? 'https://api.typesafe.ai').replace(/\/+$/, '');
  const modelo = config.modelo ?? 'jev-latest';
  const { contador, apuntar } = apuntador(config);
  const limitar = limitador(config.concurrencia ?? 16);

  async function evaluarUna(estado: unknown, preguntas: Record<string, PreguntaJev>, operacion: 'juzgar' | 'reordenar'): Promise<Record<string, RespuestaJev>> {
    const t0 = ahora();
    const r = await limitar(() => pedir<CuerpoRespuesta>({
      proveedor: 'jev', url: `${base}/v1/systemone`, cabeceras: { authorization: `Bearer ${config.clave}` },
      cuerpo: { model: modelo, state: estado, questions: preguntas },
    }, { ...config, intentos: config.intentos ?? 5 }));
    const entrada = r.usage?.input_tokens ?? estimarTokens(JSON.stringify({ estado, preguntas }));
    apuntar({ proveedor: 'jev', modelo: r.model ?? modelo, operacion, tokensEntrada: entrada, tokensSalida: r.usage?.output_tokens ?? 0, usd: costeTokens('jev-latest', entrada, 0), ms: ahora() - t0, estimado: !r.usage });
    const faltan = Object.keys(preguntas).filter((k) => !r.answers?.[k]);
    if (faltan.length) throw new ErrorProveedor('jev', `faltan respuestas: ${faltan.join(', ')}`);
    return r.answers as Record<string, RespuestaJev>;
  }

  /** Reparte las preguntas en peticiones que quepan en el presupuesto; mismas claves a la salida. */
  async function evaluar(estado: unknown, preguntas: Record<string, PreguntaJev>, operacion: 'juzgar' | 'reordenar' = 'juzgar') {
    const tokEstado = estimarTokens(typeof estado === 'string' ? estado : JSON.stringify(estado));
    if (tokEstado > MAX_TOKENS_ESTADO) throw new ErrorProveedor('jev', `estado demasiado grande (~${tokEstado} tokens; máx. ~${MAX_TOKENS_ESTADO})`);
    const grupos: Array<Record<string, PreguntaJev>> = [];
    let actual: Record<string, PreguntaJev> = {};
    let tok = tokEstado;
    for (const [k, q] of Object.entries(preguntas)) {
      const t = estimarTokens(JSON.stringify(q)) + 8;
      if (Object.keys(actual).length && tok + t > MAX_TOKENS_PETICION) { grupos.push(actual); actual = {}; tok = tokEstado; }
      actual[k] = q; tok += t;
    }
    if (Object.keys(actual).length) grupos.push(actual);
    const partes = await enParalelo(grupos, 8, (g) => evaluarUna(estado, g, operacion));
    return Object.assign({}, ...partes) as Record<string, RespuestaJev>;
  }

  function juez(): Juez {
    return {
      nombre: `jev:${modelo}`,
      async juzgar(estado, preguntas) {
        const ids = Object.keys(preguntas);
        if (!ids.length) return {};
        // Las claves no se envían al modelo (la API lo garantiza), pero se usan ids neutros por si contienen datos.
        const mapa = new Map(ids.map((id, i) => [`q${i}`, id]));
        const qs = Object.fromEntries(ids.map((id, i) => [`q${i}`, aPreguntaJev(preguntas[id] as PreguntaJuez)]));
        const r = await evaluar(estado, qs, 'juzgar');
        return Object.fromEntries([...mapa].map(([q, id]) => [id, deRespuestaJev(preguntas[id] as PreguntaJuez, r[q])]));
      },
    };
  }

  function reordenador(o: { pasajesPorPeticion?: number; instrucciones?: string; criterios?: { si: string; no: string } } = {}): Reordenador {
    const porPeticion = o.pasajesPorPeticion ?? 24;
    // Instrucciones en inglés (idioma principal de Jev); el estado queda en el idioma del usuario.
    const criterios = o.criterios ?? {
      si: 'The passage contains information that directly answers or substantively addresses the query.',
      no: 'The passage is off-topic, only loosely related, or does not help answer the query.',
    };
    return {
      nombre: `jev:${modelo}`,
      async reordenar(consulta, textos) {
        if (!textos.length) return [];
        // Lotes por número y por tamaño del estado.
        const lotes: number[][] = [];
        let actual: number[] = [];
        let tok = estimarTokens(consulta);
        textos.forEach((t, i) => {
          const tt = estimarTokens(t) + 6;
          if (actual.length && (actual.length >= porPeticion || tok + tt > MAX_TOKENS_ESTADO - 1000)) { lotes.push(actual); actual = []; tok = estimarTokens(consulta); }
          actual.push(i); tok += tt;
        });
        if (actual.length) lotes.push(actual);
        const salida = new Array<number>(textos.length).fill(0);
        await enParalelo(lotes, 8, async (idx) => {
          const pasajes = Object.fromEntries(idx.map((i, k) => [`p${k}`, (textos[i] as string).slice(0, 12_000)]));
          const preguntas = Object.fromEntries(idx.map((_, k) => [`p${k}`, {
            type: 'noul' as const,
            instructions: o.instrucciones?.replace('{pasaje}', `passages.p${k}`) ?? `Is passage \`passages.p${k}\` relevant evidence for answering \`query\`?`,
            criteria: { true: criterios.si, false: criterios.no },
          }]));
          const r = await evaluar({ query: consulta, passages: pasajes }, preguntas, 'reordenar');
          idx.forEach((i, k) => { const a = r[`p${k}`]; salida[i] = a?.type === 'noul' ? a.noul : 0; });
        });
        return salida;
      },
    };
  }

  return { contador, evaluar, juez, reordenador };
}
