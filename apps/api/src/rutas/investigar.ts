/**
 * Investigar (docs/COMPRENSION.md, «Responder: el modo Investigar»):
 *
 *   POST /busqueda/investigar   Investigar → text/event-stream de EventoInvestigacion
 *
 * El agente vive en @scholaris/investigar; aquí se comprueban la petición y las
 * cuotas, se montan sus puertos y se emiten sus eventos. Cuenta como una búsqueda
 * del día y como una investigación del día (con su propio límite por plan), y el
 * presupuesto de cada investigación tiene el tope del plan.
 */
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventoInvestigacion, Investigar } from '@scholaris/contrato';
import { investigar, type OpcionesInvestigar } from '@scholaris/investigar';
import type { Entorno } from '../entorno.js';
import { cuerpoJson, exigir, fallo } from '../compartido/errores.js';
import { puertosInvestigar } from '../compartido/investigar.js';
import { LIMITES } from '../compartido/planes.js';
import type { PuertosUsuario } from '../puertos.js';
import { filtrosEnAmbito } from './ambito.js';
import { consumirBusqueda } from './busqueda.js';
import { puertos, type Ctx } from './util.js';

/** Comprueba y consume la cuota diaria de investigaciones (en la estantería, como las búsquedas). */
export async function consumirInvestigacion(p: PuertosUsuario): Promise<void> {
  const plan = p.config.modo === 'local' ? 'local' : p.usuario.plan;
  const limite = LIMITES[plan].investigacionesDia;
  if (limite === null) return;
  const dia = new Date().toISOString().slice(0, 10);
  await p.sql.ejecutar('INSERT INTO pl_uso (metrica, periodo, n) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', 'investigacionesDia', dia);
  const f = await p.sql.ejecutar<{ n: number }>('UPDATE pl_uso SET n = n + 1 WHERE metrica = ? AND periodo = ? AND n + 1 <= ? RETURNING n', 'investigacionesDia', dia, limite);
  if (!f.length) fallo(plan === 'gratis' ? 'requiere_pro' : 'cuota_superada', `Has hecho las ${limite} investigaciones de hoy que permite tu plan. Vuelve mañana${plan === 'gratis' ? ' o pásate a Pro' : ''}.`, { cuota: 'investigacionesDia' });
}

export function validarInvestigar(b: Investigar): void {
  exigir(b && typeof b.pregunta === 'string' && b.pregunta.trim().length > 0, 'Escribe la pregunta que hay que investigar.');
  exigir(b.pregunta.length <= 4000, 'La pregunta es demasiado larga (máximo 4000 caracteres).');
  exigir(b.profundidad === undefined || ['rapida', 'normal', 'exhaustiva'].includes(b.profundidad), 'La profundidad es «rapida», «normal» o «exhaustiva».');
  exigir(b.cuaderno === undefined || b.cuaderno === false || typeof b.cuaderno === 'string', '«cuaderno» es el id de un cuaderno o false.');
}

/** Las opciones del agente para esta petición y este usuario. */
export function opcionesInvestigar(c: Ctx, b: Investigar): OpcionesInvestigar {
  const p = puertos(c);
  const u = c.get('usuario');
  const plan = p.config.modo === 'local' ? 'local' : u.plan;
  const tope = LIMITES[plan].presupuestoInvestigar;
  // Un invitado de una biblioteca compartida o una clave de solo lectura investiga sin escribir cuadernos.
  const soloLectura = !!u.ambito || (u.via === 'clave_api' && !u.alcances?.includes('escritura'));
  const filtros = u.ambito ? filtrosEnAmbito(c, b.filtros) : b.filtros;
  return {
    ...(filtros ? { filtros } : {}),
    profundidad: plan === 'gratis' && b.profundidad === 'exhaustiva' ? 'normal' : b.profundidad ?? 'normal',
    ...(tope ? { tope } : {}),
    ...(b.presupuesto ? { presupuesto: b.presupuesto } : {}),
    ...(b.idioma ? { idioma: b.idioma } : {}),
    cuaderno: soloLectura ? false : b.cuaderno ?? undefined,
    sinHistorial: !!u.ambito || !!b.sinHistorial,
  } as OpcionesInvestigar;
}

/**
 * Prepara una investigación: valida, monta el agente (sin clave de Gemini, error antes
 * de gastar cuota) y consume las cuotas. Devuelve el flujo de eventos.
 */
export async function prepararInvestigacion(c: Ctx, b: Investigar): Promise<AsyncGenerator<EventoInvestigacion>> {
  validarInvestigar(b);
  const p = puertos(c);
  const o = opcionesInvestigar(c, b);
  const pi = await puertosInvestigar(p, b.modelo, o.profundidad);
  await consumirInvestigacion(p);
  await consumirBusqueda(p);
  const control = new AbortController();
  c.req.raw.signal?.addEventListener?.('abort', () => control.abort(), { once: true });
  return investigar(pi, b.pregunta.trim(), { ...o, signal: control.signal });
}

export function rutasInvestigar(app: Hono<Entorno>): void {
  app.post('/busqueda/investigar', async (c: Ctx) => {
    const b = await cuerpoJson<Investigar>(c);
    // Todo lo que puede fallar antes de empezar (petición, clave, cuotas) es un error JSON normal.
    const gen = await prepararInvestigacion(c, b);
    return streamSSE(c, async (sse) => {
      const enviar = (e: EventoInvestigacion) => sse.writeSSE({ event: e.tipo, data: JSON.stringify(e) });
      try {
        for await (const e of gen) await enviar(e);
      } catch (e) {
        console.error('investigar', e);
        await enviar({ tipo: 'error', mensaje: 'No he podido terminar la investigación. Vuelve a intentarlo.' });
      }
    });
  });
}
