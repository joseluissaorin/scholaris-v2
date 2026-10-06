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
import type { Env } from './env.js';
import { SqlRemoto } from './sql.js';
import { almacenDesdeEnv, cuentasDesdeEnv, emisorDesdeEnv, geminiPara, indiceDesdeEnv, inteligenciaPara, origenDe } from './puertos-cf.js';
import { espacioNombresDe } from './indice-vectorize.js';

export class Trabajador extends DurableObject<Env> {
  private async contexto(p: ParamsIngesta): Promise<ContextoMotor> {
    const env = this.env;
    const cuentas = cuentasDesdeEnv(env);
    const ia = await inteligenciaPara(env, cuentas, p.usuario, { sinCache: true });
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

  async primeraPagina(p: ParamsIngesta, info: InfoPlan): Promise<number> {
    return leerPrimeraPagina(await this.contexto(p), p, info);
  }
}
