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

export class Trabajador extends DurableObject<Env> {
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
    const ctx = await this.contexto(p);
    const emisor = emisorDesdeEnv(this.env, p.usuario);
    return procesarTanda(ctx, p, info, id, {
      alBuscables: async (r) => {
        if (r.legibles) await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'unidades', tarea: p.tarea, documento: p.documento, desde: r.legibles[0], hasta: r.legibles[1], buscables: true });
      },
    });
  }

  async consolidar(p: ParamsIngesta, info: InfoTuberia): Promise<ResumenConsolidacion> {
    return consolidarTuberia(await this.contexto(p), p, info);
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
}
