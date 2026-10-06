/**
 * Durable Object `Estanteria`: la biblioteca de UN usuario. Su SQLite lleva el
 * esquema SPDF v4 (muchos documentos), el de las funciones y el de la
 * plataforma. Las rutas de usuario corren aquí dentro (SQL local y síncrono);
 * el Workflow de ingesta escribe por RPC.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Progreso, ValorSQL } from '@scholaris/nucleo';
import { ejecutarVigilantesProgramados } from '@scholaris/funciones';
import { crearAppUsuario } from '../app.js';
import type { PuertosUsuario, UsuarioSesion, ParamsIngesta } from '../puertos.js';
import { HUELLA_ESQUEMA, prepararEstanteria } from '../compartido/esquema-plataforma.js';
import { apuntarProgreso, leerTarea, limpiarTemporales } from '../compartido/estanteria.js';
import { cerrarIngesta, type DatosCierre } from '../compartido/cierre.js';
import { puertosFunciones } from '../compartido/servicios.js';
import type { Env } from './env.js';
import { reindexar as reindexarMotor } from '../compartido/motor-ingesta.js';
import { espacioNombresDe } from './indice-vectorize.js';
import { conversorCF } from './conversor.js';
import { SqlDO } from './sql.js';
import { LIMITES } from '../compartido/planes.js';
import { cuerpoError } from '../compartido/errores.js';
import { almacenDesdeEnv, configDesdeEnv, cuentasDesdeEnv, emisorDesdeEnv, indiceDesdeEnv, inteligenciaPara, origenDe } from './puertos-cf.js';

const app = crearAppUsuario();

export class Estanteria extends DurableObject<Env> {
  private readonly base: SqlDO;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.base = new SqlDO(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      // Despertar en frío: los esquemas solo se aplican si cambiaron desde la última vez.
      if ((await ctx.storage.get<string>('esquema')) === HUELLA_ESQUEMA) return;
      if (await prepararEstanteria(this.base)) await ctx.storage.put('esquema', HUELLA_ESQUEMA);
    });
  }

  private puertos(usuario: UsuarioSesion, origen: string): PuertosUsuario {
    const env = this.env;
    const cuentas = cuentasDesdeEnv(env);
    const almacen = almacenDesdeEnv(env, origen);
    let ia: Promise<Awaited<ReturnType<typeof inteligenciaPara>>> | null = null;
    const inteligencia = () => (ia ??= inteligenciaPara(env, cuentas, usuario.id));
    const p: PuertosUsuario = {
      usuario,
      sql: this.base,
      almacen,
      indice: null,
      inteligencia,
      emisor: emisorDesdeEnv(env, usuario.id),
      orquestador: {
        lanzarIngesta: async (params: ParamsIngesta) => {
          await env.INGESTA.create({ id: params.tarea, params });
        },
        cancelar: async (tarea: string) => {
          try { await (await env.INGESTA.get(this.instanciaDe(tarea))).terminate(); } catch { /* ya terminada */ }
        },
        estado: async (tarea: string) => {
          try { return (await (await env.INGESTA.get(this.instanciaDe(tarea))).status()).status; } catch { return null; }
        },
      },
      cuentas,
      config: configDesdeEnv(env, origen),
      segundoPlano: (pr) => this.ctx.waitUntil(pr.catch((e: unknown) => console.error('segundo plano', e))),
      vaciarEstanteria: async () => {
        await this.ctx.storage.deleteAll();
        if (await prepararEstanteria(this.base)) await this.ctx.storage.put('esquema', HUELLA_ESQUEMA);
      },
      ...(conversorCF(env) ? { convertir: conversorCF(env)! } : {}),
    };
    // El índice depende del espacio del embebedor: se resuelve al primer uso.
    Object.defineProperty(p, 'indice', { get: () => (this.indice ??= indicePerezoso(env, inteligencia, this.base)), enumerable: true });
    return p;
  }

  private indice: ReturnType<typeof indicePerezoso> | null = null;

  /** Atiende una petición HTTP ya autenticada por la puerta. */
  /** Ritmo por usuario, aquí y no en un DO aparte: la petición ya pasa por esta estantería (un salto menos). */
  private marcas: number[] = [];
  private usuarioGuardado: string | undefined;

  async atender(usuario: UsuarioSesion, peticion: Request): Promise<Response> {
    const ahora = Date.now();
    while (this.marcas.length && (this.marcas[0] as number) < ahora - 60_000) this.marcas.shift();
    const porMinuto = LIMITES[usuario.plan]?.porMinuto ?? LIMITES.gratis.porMinuto;
    if (this.marcas.length >= porMinuto) {
      const reintentar = Math.max(1, Math.ceil(((this.marcas[0] as number) + 60_000 - ahora) / 1000));
      return Response.json(cuerpoError('limite_de_ritmo', 'Vas demasiado deprisa. Espera unos segundos y vuelve a intentarlo.', { reintentar }), { status: 429, headers: { 'retry-after': String(reintentar) } });
    }
    this.marcas.push(ahora);
    // Cada escritura retiene la respuesta hasta que es durable: solo cuando cambia.
    if (this.usuarioGuardado !== usuario.id) {
      if ((await this.ctx.storage.get<string>('usuario')) !== usuario.id) await this.ctx.storage.put('usuario', usuario.id);
      this.usuarioGuardado = usuario.id;
    }
    const p = this.puertos(usuario, origenDe(this.env, peticion));
    return app.fetch(peticion, { puertos: p }, { waitUntil: (pr: Promise<unknown>) => this.ctx.waitUntil(pr), passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
  }

  // -------------------------------------------------------------------------
  // RPC para el Workflow y la cola
  // -------------------------------------------------------------------------

  async sql(consulta: string, parametros: ValorSQL[]): Promise<Record<string, ValorSQL>[]> {
    return this.base.ejecutarSync(consulta, parametros);
  }

  async lote(sentencias: Array<{ consulta: string; parametros: ValorSQL[] }>): Promise<number> {
    return this.base.lote(sentencias);
  }

  async progreso(p: Progreso): Promise<boolean> {
    const t = await leerTarea(this.base, p.tarea);
    // Si la tarea se canceló, el Workflow lo sabe por aquí y para.
    if (!t || t.estado === 'cancelada' || t.estado === 'error') return false;
    await apuntarProgreso(this.base, p);
    return true;
  }

  async metadatosSubida(documento: string): Promise<Record<string, unknown> | null> {
    const [f] = this.base.ejecutarSync<{ metadatos: string | null }>('SELECT metadatos FROM pl_subidas WHERE documento = ? ORDER BY creada DESC LIMIT 1', [documento]);
    return f?.metadatos ? (JSON.parse(f.metadatos) as Record<string, unknown>) : null;
  }

  async cerrar(usuario: Pick<UsuarioSesion, 'id' | 'plan'>, datos: DatosCierre): Promise<void> {
    const u: UsuarioSesion = { id: usuario.id, plan: usuario.plan, correo: '', nombre: '', funciones: [], via: 'clerk' };
    await cerrarIngesta(this.puertos(u, origenDe(this.env)), datos);
  }

  /** Instancia del Workflow de una tarea (cambia si se relanza). */
  private instanciaDe(tarea: string): string {
    const [f] = this.base.ejecutarSync<{ params: string | null }>('SELECT params FROM pl_tareas WHERE id = ?', [tarea]);
    const p = f?.params ? (JSON.parse(f.params) as { instancia?: string }) : {};
    return p.instancia ?? tarea;
  }

  /**
   * Vigilante: la tarea lleva un rato sin avanzar. Si su Workflow ha muerto o
   * sigue «corriendo» sin hacer nada, se relanza con los mismos parámetros
   * (lo ya leído está grabado en el almacén: no se paga dos veces).
   */
  async vigilarTarea(tarea: string, sinAvanceMs: number): Promise<string> {
    const [f] = this.base.ejecutarSync<{ estado: string; params: string | null; actualizada: string }>('SELECT estado, params, actualizada FROM pl_tareas WHERE id = ?', [tarea]);
    if (!f || (f.estado !== 'en_cola' && f.estado !== 'procesando')) return 'terminada';
    const params = f.params ? (JSON.parse(f.params) as ParamsIngesta & { instancia?: string; relanzamientos?: number }) : null;
    if (!params?.documento || !params.usuario) return 'sin_parametros';
    let estado: string | null = null;
    try { estado = (await (await this.env.INGESTA.get(params.instancia ?? tarea)).status()).status; } catch { estado = null; }
    const muerto = estado === null || estado === 'errored' || estado === 'terminated' || estado === 'complete';
    const parado = estado === 'running' || estado === 'waiting' || estado === 'queued';
    if (!muerto && !(parado && sinAvanceMs > 240_000)) return `sigue (${estado})`;
    const n = (params.relanzamientos ?? 0) + 1;
    if (n > 3) {
      await this.cerrar({ id: params.usuario, plan: params.plan }, { tarea, documento: params.documento, ok: false, error: 'La ingesta se ha detenido varias veces. Prueba a reintentarla más tarde.' });
      return 'abandonada';
    }
    try { await (await this.env.INGESTA.get(params.instancia ?? tarea)).terminate(); } catch { /* ya estaba muerta */ }
    const instancia = `${tarea}-r${n}`;
    const nuevos = { ...params, instancia, relanzamientos: n };
    this.base.ejecutarSync("UPDATE pl_tareas SET params = ?, estado = 'procesando', actualizada = ? WHERE id = ?", [JSON.stringify(nuevos), new Date().toISOString(), tarea]);
    await this.env.INGESTA.create({ id: instancia, params: nuevos });
    console.log(JSON.stringify({ que: 'vigilante', tarea, estado, instancia }));
    return `relanzada (${estado ?? 'desconocido'})`;
  }

  /** Cola: reenvía al índice los vectores pendientes de un documento. */
  async reindexar(usuario: string, documento: string): Promise<number> {
    const ia = await inteligenciaPara(this.env, cuentasDesdeEnv(this.env), usuario);
    const indice = indiceDesdeEnv(this.env, ia, this.base);
    if (!indice) return 0;
    const n = await reindexarMotor(this.base, indice, espacioNombresDe(usuario), documento);
    this.base.ejecutarSync("DELETE FROM pl_avisos WHERE documento = ? AND codigo = 'vectores_pendientes'", [documento]);
    return n;
  }

  /** Cron: vigilantes diarios o semanales del usuario. */
  async vigilantes(usuario: Pick<UsuarioSesion, 'id' | 'plan'>, modo: 'diario' | 'semanal'): Promise<void> {
    const u: UsuarioSesion = { id: usuario.id, plan: usuario.plan, correo: '', nombre: '', funciones: [], via: 'clerk' };
    // Mantenimiento diario: fuera los temporales caducados.
    const almacen = almacenDesdeEnv(this.env, origenDe(this.env));
    await limpiarTemporales(this.base, (k) => almacen.borrar(k)).catch((e: unknown) => console.error('temporales', e));
    // Subidas que se quedaron a medias hace más de un día: fuera, con lo que llegaran a subir.
    const hace24 = new Date(Date.now() - 86400_000).toISOString();
    for (const d of this.base.ejecutarSync<{ id: string }>("SELECT id FROM documentos WHERE estado = 'pendiente' AND creado < ? AND id NOT IN (SELECT documento FROM pl_tareas WHERE estado IN ('en_cola','procesando') AND documento IS NOT NULL)", [hace24])) {
      await almacen.borrarPrefijo(`u/${usuario.id}/d/${d.id}/`).catch(() => undefined);
      this.base.ejecutarSync('DELETE FROM pl_subidas WHERE documento = ?', [d.id]);
      this.base.ejecutarSync('DELETE FROM unidades WHERE documento = ?', [d.id]);
      this.base.ejecutarSync('DELETE FROM documentos WHERE id = ?', [d.id]);
    }
    // Huérfanos: en error desde hace más de un día y sin original ni paquete en el almacén (no hay nada que reintentar).
    for (const d of this.base.ejecutarSync<{ id: string; original: string; datos: string }>("SELECT id, original, metadatos AS datos FROM documentos WHERE estado = 'error' AND actualizado < ? AND id NOT IN (SELECT documento FROM pl_tareas WHERE estado IN ('en_cola','procesando') AND documento IS NOT NULL)", [hace24])) {
      const prefijo = `u/${usuario.id}/d/${d.id}/`;
      const url = (() => { try { return (JSON.parse(d.datos) as { url?: string }).url; } catch { return undefined; } })();
      if (url) continue;
      const original = d.original ? (d.original.startsWith('u/') ? d.original : `${prefijo}${d.original}`) : '';
      if ((original && (await almacen.existe(original))) || (await almacen.existe(`${prefijo}paquete.json`))) continue;
      await almacen.borrarPrefijo(prefijo).catch(() => undefined);
      this.base.ejecutarSync('DELETE FROM pl_subidas WHERE documento = ?', [d.id]);
      this.base.ejecutarSync('DELETE FROM unidades WHERE documento = ?', [d.id]);
      this.base.ejecutarSync('DELETE FROM documentos WHERE id = ?', [d.id]);
    }
    await ejecutarVigilantesProgramados(await puertosFunciones(this.puertos(u, origenDe(this.env))), modo);
  }
}

/** Índice que espera a la inteligencia para saber su espacio (la primera vez). */
function indicePerezoso(env: Env, inteligencia: () => Promise<Awaited<ReturnType<typeof inteligenciaPara>>>, sql: SqlDO) {
  let real: ReturnType<typeof indiceDesdeEnv> | undefined;
  const obtener = async () => (real ??= indiceDesdeEnv(env, await inteligencia(), sql));
  return {
    get espacio() {
      if (!real) throw new Error('Índice aún no inicializado');
      return real.espacio;
    },
    insertar: async (ns: string, e: Parameters<NonNullable<ReturnType<typeof indiceDesdeEnv>>['insertar']>[1]) => (await obtener())!.insertar(ns, e),
    consultar: async (ns: string, v: Float32Array | number[], o: Parameters<NonNullable<ReturnType<typeof indiceDesdeEnv>>['consultar']>[2]) => (await obtener())!.consultar(ns, v, o),
    borrar: async (ns: string, ids: string[]) => (await obtener())!.borrar(ns, ids),
  };
}
