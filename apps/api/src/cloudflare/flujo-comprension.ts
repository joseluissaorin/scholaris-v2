/**
 * Workflow `Comprension` (`scholaris-comprension`): la capa de comprensión de un
 * documento ya «listo» (docs/COMPRENSION.md). Pasos durables:
 *
 *   plan → estructura → [fichas-0 … fichas-n ‖ entidades → personajes] → global → indexado → cerrar
 *
 * Cada paso corre en su propio Trabajador (su cupo de conexiones) y pasa por
 * `UnaVez`: si el paso caduca, el trabajo sigue en el objeto y el reintento se
 * suma a él en vez de pagar otra vez al modelo. Además cada paso consta como
 * hecho en la procedencia del documento: un relanzamiento del vigilante (otra
 * instancia) se salta lo ya hecho. El plazo de cada paso sale del tamaño del
 * documento (`plan.plazos`) y, mientras trabaja, el paso late para el vigilante.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { enParalelo } from '@scholaris/nucleo';
import type { PlanComprension } from '@scholaris/ingesta';
import type { ParamsComprension } from '../compartido/comprension.js';
import type { Env } from './env.js';
import { conLatidoAcotado } from '../compartido/latido.js';

const REINTENTOS = { limit: 4, delay: '20 seconds', backoff: 'exponential' } as const;
/** Tandas de fichas a la vez (cada una es una llamada larga al modelo). */
const TANDAS_A_LA_VEZ = 6;

export type PasoTrabajador = 'estructura' | 'fichas' | 'entidades' | 'personajes' | 'global' | 'indexado';

export class FlujoComprension extends WorkflowEntrypoint<Env, ParamsComprension> {
  async run(evento: Readonly<WorkflowEvent<ParamsComprension>>, step: WorkflowStep): Promise<unknown> {
    const p = evento.payload;
    const trabajador = (clave: string) => this.env.TRABAJADOR.getByName(`${p.instancia}:${clave}`);
    // El vigilante mira la tarea «tarea:<usuario>:<instancia>»: cada latido le dice que seguimos.
    const tarea = this.env.TAREA.getByName(`tarea:${p.usuario}:${p.instancia}`);
    const vivo = (hasta: number) => tarea.esperar(hasta);
    // Mientras el paso espera al Trabajador, late, pero nunca más allá de su plazo (ver compartido/latido.ts).
    const conLatido = <T>(segundos: number, fn: () => Promise<T>): Promise<T> => conLatidoAcotado(vivo, segundos, fn);
    const opciones = (segundos: number) => ({ retries: REINTENTOS, timeout: `${Math.max(120, Math.round(segundos))} seconds` as const });
    // Los resultados de los pasos son JSON pequeño (el plan, unos contadores).
    const paso = async (nombre: string, segundos: number, fn: () => Promise<unknown>): Promise<unknown> =>
      step.do(nombre, opciones(segundos), async () => JSON.parse(JSON.stringify(await conLatido(segundos, fn) ?? null)) as Record<string, never>);

    let plan: PlanComprension | null = null;
    try {
      plan = (await paso('plan', 600, () => trabajador('plan').comprensionPlan(p))) as PlanComprension;
      if (!plan.hecha) {
        const pl = plan;
        const { lotes } = (await paso('estructura', pl.plazos.estructura, () => trabajador('estructura').comprensionPaso(p, pl, 'estructura'))) as { lotes: number };
        await Promise.all([
          enParalelo(Array.from({ length: lotes }, (_, i) => i), TANDAS_A_LA_VEZ, (i) =>
            paso(`fichas-${i}`, pl.plazos.fichas, () => trabajador(`fichas-${i}`).comprensionPaso(p, pl, 'fichas', i))),
          (async () => {
            await paso('entidades', pl.plazos.entidades, () => trabajador('entidades').comprensionPaso(p, pl, 'entidades'));
            // El análisis de las principales, aparte: tandas pequeñas y a la vez (un plan de antes no trae su plazo).
            await paso('personajes', pl.plazos.personajes ?? pl.plazos.entidades, () => trabajador('personajes').comprensionPaso(p, pl, 'personajes'));
          })(),
        ]);
        await paso('global', pl.plazos.global, () => trabajador('global').comprensionPaso(p, pl, 'global'));
        await paso('indexado', pl.plazos.indexado, () => trabajador('indexado').comprensionPaso(p, pl, 'indexado'));
      }
      const pl: PlanComprension = plan;
      await step.do('cerrar', { retries: REINTENTOS }, async () => { await trabajador('cerrar').comprensionCerrar(p, pl, { ok: true }); });
      return { documento: p.documento, hecha: true };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      await step.do('fallo', { retries: { limit: 3, delay: '5 seconds' } }, async () => {
        await trabajador('cerrar').comprensionCerrar(p, plan, { ok: false, error: legible(mensaje) });
      });
      throw e instanceof NonRetryableError ? e : new NonRetryableError(legible(mensaje));
    }
  }
}

/** Mensaje de error apto para la interfaz. */
export function legible(m: string): string {
  if (/presupuesto/i.test(m)) return m;
  if (/bloquead|PROHIBITED|SAFETY/i.test(m)) return 'El modelo se negó a analizar parte de esta obra (filtro de seguridad). Lo hecho hasta ahí se conserva.';
  if (/timed out|WorkflowTimeoutError|plazo/i.test(m)) return 'La comprensión tardó más de lo previsto y se detuvo. Vuelve a pedirla: lo ya hecho se aprovecha.';
  if (/No existe el documento/i.test(m)) return 'El documento ya no existe.';
  return 'No he podido terminar la comprensión de este documento. Vuelve a pedirla más tarde: lo ya hecho se aprovecha.';
}
