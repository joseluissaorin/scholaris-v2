/**
 * Clientes de los dos modos de respuesta, normalizados a RespuestaNormalizada:
 *
 * - `responder`: POST /api/v2/busqueda/responder (SSE: resultados, texto, cita, fin), lo
 *   mismo que `respuesta()` del SDK. Las notas van en el texto como [^n].
 * - `investigar`: POST /api/v2/busqueda/investigar (SSE: inicio, plan, paso, evidencia,
 *   texto, verificacion, fin). `fin` trae el Markdown con marcas [E1]…, las evidencias
 *   en el orden de las marcas (EvidenciaInvestigacion: Evidencia + id, etiqueta, cita…),
 *   las fuentes y el coste.
 */
import { leerSSE } from '@scholaris/contrato';
import type { Ancla } from '@scholaris/nucleo';
import type { CitaRespuesta, ModoRespuesta, Pregunta, RespuestaNormalizada } from './tipos.js';

export interface OpcionesCliente {
  base: string;
  clave: string;
  /** Para las pruebas. */
  fetch?: typeof fetch;
  /** Plazo de una respuesta entera (por defecto 15 min: Investigar puede tardar). */
  plazoMs?: number;
}

/** Lo que llega por SSE de /busqueda/responder (el contrato: EventoRespuesta). */
type EventoResponder =
  | { tipo: 'resultados'; resultados: Array<{ fragmento: { id: string; ancla: Ancla; anclaFin?: Ancla } }> }
  | { tipo: 'texto'; delta: string }
  | { tipo: 'cita'; n: number; fragmento: string; documento: string; etiqueta: string; citaCorta?: string; pasaje?: { texto: string; ancla?: Ancla; anclaFin?: Ancla } }
  | { tipo: 'fin'; ms: number; confianza?: string }
  | { tipo: 'error'; mensaje: string };

/** Lo que llega por SSE de /busqueda/investigar (contrato de la rama comprension/investigar). */
interface EvidenciaInvestigacion {
  id: string;
  documento: string;
  ancla: Ancla;
  anclaFin?: Ancla;
  cita?: string;
  modo?: string;
  fragmento?: string;
  etiqueta?: string;
  traduccion?: string;
  nota?: string;
}
type EventoInvestigar =
  | { tipo: 'inicio' | 'plan' | 'paso' | 'verificacion' }
  | { tipo: 'evidencia'; evidencia: EvidenciaInvestigacion }
  | { tipo: 'texto'; delta: string }
  | { tipo: 'fin'; markdown: string; evidencias: EvidenciaInvestigacion[]; coste?: { usd?: number }; avisos?: string[]; ms?: number }
  | { tipo: 'error'; mensaje: string };

async function* pedirSSE<T>(o: OpcionesCliente, ruta: string, cuerpo: unknown): AsyncGenerator<T> {
  const f = o.fetch ?? fetch;
  const r = await f(`${o.base.replace(/\/$/, '')}/api/v2${ruta}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${o.clave}`, 'content-type': 'application/json', accept: 'text/event-stream', 'x-scholaris-cliente': 'banco-comprension' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(o.plazoMs ?? 15 * 60_000),
  });
  if (!r.ok) {
    let mensaje = `HTTP ${r.status}`;
    try { mensaje += `: ${(await r.text()).slice(0, 300)}`; } catch { /* sin cuerpo */ }
    throw new Error(mensaje);
  }
  if (!r.body) throw new Error('Respuesta sin cuerpo');
  yield* leerSSE<T>(r.body);
}

export async function preguntarResponder(o: OpcionesCliente, p: Pregunta): Promise<RespuestaNormalizada> {
  const t = Date.now();
  let markdown = '';
  const citas: CitaRespuesta[] = [];
  // Ancla de cada fragmento del contexto: la de una nota sin pasaje relevante es la del fragmento entero.
  const anclas = new Map<string, { ancla: Ancla; anclaFin?: Ancla }>();
  let error: string | undefined;
  try {
    for await (const e of pedirSSE<EventoResponder>(o, '/busqueda/responder', { consulta: p.pregunta })) {
      if (e.tipo === 'resultados') for (const x of e.resultados ?? []) anclas.set(x.fragmento.id, { ancla: x.fragmento.ancla, ...(x.fragmento.anclaFin ? { anclaFin: x.fragmento.anclaFin } : {}) });
      else if (e.tipo === 'texto') markdown += e.delta;
      else if (e.tipo === 'cita') {
        const a = e.pasaje?.ancla ? { ancla: e.pasaje.ancla, ...(e.pasaje.anclaFin ? { anclaFin: e.pasaje.anclaFin } : {}) } : anclas.get(e.fragmento);
        citas.push({
          id: String(e.n), documento: e.documento, fragmento: e.fragmento, etiqueta: e.etiqueta,
          ...(a ? { ancla: a.ancla } : {}), ...(a?.anclaFin ? { anclaFin: a.anclaFin } : {}),
          ...(e.pasaje?.texto ? { texto: e.pasaje.texto } : {}), modo: 'texto',
        });
      } else if (e.tipo === 'error') error = e.mensaje;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return { modo: 'responder', preguntaId: p.id, markdown, citas, ms: Date.now() - t, ...(error ? { error } : {}), fecha: new Date().toISOString() };
}

export async function preguntarInvestigar(o: OpcionesCliente, p: Pregunta): Promise<RespuestaNormalizada> {
  const t = Date.now();
  let markdown = '';
  let evidencias: EvidenciaInvestigacion[] = [];
  const vistas: EvidenciaInvestigacion[] = [];
  let usd: number | undefined;
  let avisos: string[] | undefined;
  let error: string | undefined;
  try {
    for await (const e of pedirSSE<EventoInvestigar>(o, '/busqueda/investigar', { pregunta: p.pregunta, sinHistorial: true, cuaderno: false })) {
      if (e.tipo === 'texto') markdown += e.delta;
      else if (e.tipo === 'evidencia') vistas.push(e.evidencia);
      else if (e.tipo === 'fin') {
        if (e.markdown) markdown = e.markdown;
        evidencias = e.evidencias?.length ? e.evidencias : vistas;
        usd = e.coste?.usd;
        avisos = e.avisos;
      } else if (e.tipo === 'error') error = e.mensaje;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  if (!evidencias.length) evidencias = vistas;
  const citas: CitaRespuesta[] = evidencias.map((ev) => ({
    id: ev.id, documento: ev.documento, ancla: ev.ancla, ...(ev.anclaFin ? { anclaFin: ev.anclaFin } : {}),
    ...(ev.etiqueta ? { etiqueta: ev.etiqueta } : {}), ...(ev.cita ? { texto: ev.cita } : {}),
    ...(ev.fragmento ? { fragmento: ev.fragmento } : {}), ...(ev.modo ? { modo: ev.modo } : {}),
  }));
  return {
    modo: 'investigar', preguntaId: p.id, markdown, citas, ms: Date.now() - t,
    ...(usd !== undefined ? { usd } : {}), ...(avisos?.length ? { avisos } : {}), ...(error ? { error } : {}), fecha: new Date().toISOString(),
  };
}

export function clientePara(modo: ModoRespuesta, o: OpcionesCliente): (p: Pregunta) => Promise<RespuestaNormalizada> {
  return modo === 'investigar' ? (p) => preguntarInvestigar(o, p) : (p) => preguntarResponder(o, p);
}
