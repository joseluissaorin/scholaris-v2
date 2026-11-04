/**
 * Durable Object `Trabajador`: hace una lectura (un pliego, un tramo, la
 * primera página) en su propia invocación. En Workers cada invocación tiene un
 * límite de conexiones salientes simultáneas (6); los pasos en paralelo de un
 * Workflow comparten la suya y las llamadas al lector se ponían en cola. Cada
 * trabajador tiene su propio cupo, así que la lectura va de verdad en paralelo.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Progreso } from '@scholaris/nucleo';
import type { ParamsIngesta } from '../puertos.js';
import { leerPrimeraPagina, leerUnPliego, transcribirUnTramo, type ContextoMotor, type InfoPlan } from '../compartido/motor-ingesta.js';
import { consolidarTuberia, enviarLoteTuberia, procesarTanda, recogerLoteTuberia, type InfoTuberia, type ResultadoTanda, type ResumenConsolidacion } from '../compartido/tuberia-plataforma.js';
import type { Env } from './env.js';
import { SqlRemoto } from './sql.js';
import { almacenDesdeEnv, catalogosDesdeEnv, cuentasDesdeEnv, emisorDesdeEnv, geminiPara, indiceDesdeEnv, inteligenciaPara, origenDe } from './puertos-cf.js';
import { espacioNombresDe } from './indice-vectorize.js';
import { recortadorCF } from './conversor.js';
import { UnaVez } from '../compartido/una-vez.js';
import { cerrarComprension, pasoEntidades, pasoFichas, pasoGlobal, pasoIndexado, pasoPersonajes, pasoSegmentos, planificarComprension, type ContextoComprension, type PlanComprension } from '@scholaris/ingesta';
import { contextoComprension, registroEnConsola, type ParamsComprension } from '../compartido/comprension.js';
import type { PasoTrabajador } from './flujo-comprension.js';

export class Trabajador extends DurableObject<Env> {
  /**
   * Cada objeto atiende un trabajo de una tarea («<tarea>:t3», «<tarea>:consolidar»).
   * Si el paso que lo pidió caduca, el trabajo sigue aquí, y el reintento se suma
   * a él en vez de lanzar otro igual en paralelo (ver `una-vez.ts`).
   */
  private readonly unaVez = new UnaVez(this.ctx.storage);

  private async contexto(p: ParamsIngesta): Promise<ContextoMotor> {
    const env = this.env;
    const cuentas = cuentasDesdeEnv(env);
    const ia = await inteligenciaPara(env, cuentas, p.usuario, { sinCache: true, economico: p.modo === 'economico' });
    const gemini = await geminiPara(env, cuentas, p.usuario);
    const estanteria = env.ESTANTERIA.getByName(p.usuario);
    const emisor = emisorDesdeEnv(env, p.usuario);
    return {
      almacen: almacenDesdeEnv(env, origenDe(env)),
      inteligencia: ia,
      sql: new SqlRemoto({ sql: (c, ps) => estanteria.sql(c, ps), lote: (s) => estanteria.lote(s) }),
      indice: indiceDesdeEnv(env, ia),
      espacioNombres: espacioNombresDe(p.usuario),
      ...(gemini ? { gemini } : {}),
      ...(env.SIN_VERIFICACION === '1' ? { sinVerificacion: true } : {}),
      ...(env.CORREO_CONTACTO ? { correoContacto: env.CORREO_CONTACTO } : {}),
      catalogos: catalogosDesdeEnv(env, almacenDesdeEnv(env, origenDe(env))),
      // La consolidación vectoriza las figuras de página por el recorte de su región.
      ...(recortadorCF(env) ? { recortar: recortadorCF(env)! } : {}),
      alProgreso: async (pr: Progreso) => { await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'progreso', progreso: pr }); },
      alUnidades: async (desde: number, hasta: number) => { await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'unidades', tarea: p.tarea, documento: p.documento, desde, hasta }); },
    };
  }

  async pliego(p: ParamsIngesta, info: InfoPlan, id: number): Promise<number> {
    return leerUnPliego(await this.contexto(p), p, info, id);
  }

  async tramo(p: ParamsIngesta, info: InfoPlan, n: number): Promise<number> {
    return transcribirUnTramo(await this.contexto(p), p, info, n);
  }

  async tanda(p: ParamsIngesta, info: InfoTuberia, id: number): Promise<ResultadoTanda> {
    // Sin recordar el resultado: volver a indexar una tanda es inocuo (las lecturas están grabadas)
    // y vuelve a escribir su estado si un relanzamiento lo necesita.
    return this.unaVez.hacer(`tanda:${p.tarea}:${id}`, async () => {
      const ctx = await this.contexto(p);
      const emisor = emisorDesdeEnv(this.env, p.usuario);
      return procesarTanda(ctx, p, info, id, {
        alBuscables: async (r) => {
          if (r.legibles) await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'unidades', tarea: p.tarea, documento: p.documento, desde: r.legibles[0], hasta: r.legibles[1], buscables: true });
        },
      });
    });
  }

  async consolidar(p: ParamsIngesta, info: InfoTuberia): Promise<ResumenConsolidacion> {
    // Una consolidación por preparación, recordada: la terminada se devuelve tal cual a quien
    // pregunte después (los reintentos del paso) y la que está en marcha se comparte con el
    // reintento que llega. Un relanzamiento del vigilante vuelve a preparar y a leer las tandas,
    // así que trae otra fecha y consolida de nuevo, pero en fila: nunca dos a la vez.
    const clave = `consolidar:${p.tarea}:${p.documento}:${info.preparado ?? 'sin-fecha'}`;
    return this.unaVez.hacer(clave, async () => consolidarTuberia(await this.contexto(p), p, info), { recordar: true, exclusivo: true });
  }

  async enviarLote(p: ParamsIngesta, info: InfoTuberia): Promise<string | null> {
    // Un lote por tarea: este objeto («<tarea>:lote») es el mismo en los relanzamientos,
    // así que un reintento o un relanzamiento recoge el lote ya pagado en vez de mandar otro.
    const ya = await this.ctx.storage.get<string>('lote');
    if (ya) return ya;
    const id = await enviarLoteTuberia(await this.contexto(p), p, info);
    if (id) await this.ctx.storage.put('lote', id);
    return id;
  }

  async recogerLote(p: ParamsIngesta, info: InfoTuberia, id: string): Promise<{ listo: boolean; error?: string }> {
    return recogerLoteTuberia(await this.contexto(p), p, info, id);
  }

  async primeraPagina(p: ParamsIngesta, info: InfoPlan): Promise<number> {
    return leerPrimeraPagina(await this.contexto(p), p, info);
  }

  // -------------------------------------------------------------------------
  // Comprensión (Workflow `scholaris-comprension`): un objeto por paso de cada instancia.
  // -------------------------------------------------------------------------

  private async contextoComprension(p: ParamsComprension, limite?: number): Promise<ContextoComprension> {
    const env = this.env;
    const cuentas = cuentasDesdeEnv(env);
    const ia = await inteligenciaPara(env, cuentas, p.usuario, { sinCache: true });
    const estanteria = env.ESTANTERIA.getByName(p.usuario);
    const tarea = env.TAREA.getByName(`tarea:${p.usuario}:${p.instancia}`);
    return contextoComprension({
      sql: new SqlRemoto({ sql: (c, ps) => estanteria.sql(c, ps), lote: (s) => estanteria.lote(s) }),
      usuario: p.usuario, almacen: almacenDesdeEnv(env, origenDe(env)),
      ...(await geminiPara(env, cuentas, p.usuario).then((g) => (g ? { gemini: g } : {}))),
      embebedor: ia.embebedor, indice: indiceDesdeEnv(env, ia), espacioNombres: espacioNombresDe(p.usuario),
      emisor: emisorDesdeEnv(env, p.usuario),
      latido: () => tarea.esperar(Date.now() + 4 * 60_000).catch(() => undefined),
      registro: registroEnConsola(p.instancia),
      ...(limite ? { limite } : {}),
    });
  }

  /** El plan, una vez por instancia (recordado: un reintento no vuelve a borrar lo anterior). */
  async comprensionPlan(p: ParamsComprension): Promise<PlanComprension> {
    return this.unaVez.hacer(`cmp-plan:${p.instancia}`, async () => planificarComprension(await this.contextoComprension(p), p.documento, {
      ...(p.forzar ? { forzar: true } : {}), ...(p.lentes?.length ? { lentes: p.lentes } : {}), ...(p.economico ? { economico: true } : {}),
    }), { recordar: true });
  }

  /**
   * Un paso; los reintentos se suman al que sigue en marcha y lo ya hecho consta en la
   * procedencia. El trabajo se acota al plazo del paso (cada llamada al modelo se corta a
   * lo que quede): un reintento que se suma no puede quedarse esperando a algo colgado.
   */
  async comprensionPaso(p: ParamsComprension, plan: PlanComprension, paso: PasoTrabajador, lote?: number): Promise<unknown> {
    return this.unaVez.hacer(`cmp:${p.instancia}:${paso}:${lote ?? ''}`, async () => {
      const plazo = (plan.plazos as Partial<Record<PasoTrabajador, number>>)[paso] ?? 600;
      const ctx = await this.contextoComprension(p, Date.now() + plazo * 1000 - 5_000);
      const t0 = Date.now();
      console.log(JSON.stringify({ que: 'comprension', instancia: p.instancia, documento: p.documento, paso, lote, estado: 'inicio', plazo }));
      try {
        let r: unknown;
        switch (paso) {
          case 'estructura': r = await pasoSegmentos(ctx, plan); break;
          case 'fichas': r = await pasoFichas(ctx, plan, lote ?? 0); break;
          case 'entidades': r = await pasoEntidades(ctx, plan); break;
          case 'personajes': r = await pasoPersonajes(ctx, plan); break;
          case 'global': r = await pasoGlobal(ctx, plan); break;
          case 'indexado': {
            const x = await pasoIndexado(ctx, plan);
            // Lo que no llegó al índice dentro del plazo se reenvía desde la estantería.
            if (x.pendientes) await this.env.COLA.send({ tipo: 'reindexar', usuario: p.usuario, documento: p.documento }, { delaySeconds: 120 }).catch(() => undefined);
            r = x;
            break;
          }
        }
        console.log(JSON.stringify({ que: 'comprension', instancia: p.instancia, documento: p.documento, paso, lote, estado: 'fin', ms: Date.now() - t0 }));
        return r;
      } catch (e) {
        // Nunca un «Error:» vacío: el Workflow y el vigilante tienen que saber qué paso y por qué.
        const mensaje = (e as Error)?.message || (e as Error)?.name || String(e) || 'error sin mensaje';
        console.log(JSON.stringify({ que: 'comprension', instancia: p.instancia, documento: p.documento, paso, lote, estado: 'error', ms: Date.now() - t0, error: mensaje.slice(0, 500) }));
        throw new Error(`${paso}${lote !== undefined ? ` ${lote}` : ''}: ${mensaje}`.slice(0, 900));
      }
    });
  }

  /** Cierra (bien o mal), avisa al vigilante de que ha terminado y deja seguir a la cola de la biblioteca. */
  async comprensionCerrar(p: ParamsComprension, plan: PlanComprension | null, r: { ok: boolean; error?: string }): Promise<void> {
    const ctx = await this.contextoComprension(p);
    let sinModelo = false;
    if (plan) sinModelo = (await cerrarComprension(ctx, plan, r)).estado === 'sin_modelo';
    else {
      const { actualizarEstado } = await import('@scholaris/ingesta');
      await actualizarEstado(ctx.sql, p.documento, { estado: 'error', error: r.error ?? 'La comprensión no pudo empezar.' }, new Date().toISOString());
      await (ctx.sql as SqlRemoto).vaciarPendientes();
    }
    await this.env.TAREA.getByName(`tarea:${p.usuario}:${p.instancia}`).emitir({ tipo: 'fin', tarea: p.instancia, documento: p.documento, estado: r.ok ? 'listo' : 'error', ...(r.error ? { error: r.error } : {}) });
    const mensaje = sinModelo ? 'Sin modelo de comprensión: hace falta una clave de Gemini.' : r.ok ? 'Comprensión terminada' : r.error ?? 'La comprensión ha fallado';
    await emisorDesdeEnv(this.env, p.usuario).emitir(`usuario:${p.usuario}`, { tipo: 'comprension', documento: p.documento, paso: 'fin', avance: 1, mensaje, estado: r.ok && !sinModelo ? 'hecho' : 'error' }).catch(() => undefined);
    await this.env.ESTANTERIA.getByName(p.usuario).comprensionesPendientes({ id: p.usuario, plan: p.plan }).catch(() => 0);
  }
}
