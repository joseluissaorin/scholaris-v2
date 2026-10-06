/**
 * Workflow `Ingesta`: un documento, de su paquete a la estantería y a
 * Vectorize. Cada fase es un paso durable; los pliegos de visión y los tramos
 * de audio van en pasos propios lanzados a la vez (Promise.all de step.do), con
 * reintentos y espera exponencial. Si algo falla del todo, la tarea queda en
 * error con su motivo.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Progreso } from '@scholaris/nucleo';
import type { ParamsIngesta } from '../puertos.js';
import { enParalelo } from '@scholaris/nucleo';
import { componer, ErrorReserva, leerPrimeraPagina, leerUnPliego, limpiarTrabajo, preparar, revectorizar, soloVectores, transcribirUnTramo, type ContextoMotor, type InfoPlan } from '../compartido/motor-ingesta.js';
import type { Env } from './env.js';
import { SqlRemoto } from './sql.js';
import { almacenDesdeEnv, cuentasDesdeEnv, emisorDesdeEnv, geminiPara, indiceDesdeEnv, inteligenciaPara, origenDe } from './puertos-cf.js';
import { espacioNombresDe } from './indice-vectorize.js';
import { conversorCF } from './conversor.js';

const REINTENTOS = { limit: 5, delay: '10 seconds', backoff: 'exponential' } as const;

export class FlujoIngesta extends WorkflowEntrypoint<Env, ParamsIngesta> {
  private async contexto(p: ParamsIngesta): Promise<ContextoMotor & { emitir(pr: Progreso): Promise<void> }> {
    const env = this.env;
    const cuentas = cuentasDesdeEnv(env);
    // Una inteligencia por paso: sus limitadores no se comparten entre pasos (ver motor-ingesta).
    const ia = await inteligenciaPara(env, cuentas, p.usuario, { sinCache: true });
    const gemini = await geminiPara(env, cuentas, p.usuario);
    const estanteria = env.ESTANTERIA.getByName(p.usuario);
    const emisor = emisorDesdeEnv(env, p.usuario);
    const emitir = async (pr: Progreso) => {
      const sigue = await estanteria.progreso(pr);
      await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'progreso', progreso: pr });
      if (!sigue) throw new NonRetryableError('La tarea se ha cancelado.');
    };
    return {
      almacen: almacenDesdeEnv(env, origenDe(env)),
      inteligencia: ia,
      sql: new SqlRemoto({ sql: (c, ps) => estanteria.sql(c, ps), lote: (s) => estanteria.lote(s) }),
      indice: indiceDesdeEnv(env, ia),
      espacioNombres: espacioNombresDe(p.usuario),
      ...(env.CORREO_CONTACTO ? { correoContacto: env.CORREO_CONTACTO } : {}),
      ...(env.SIN_VERIFICACION === '1' ? { sinVerificacion: true } : {}),
      ...(gemini ? { gemini } : {}),
      alUnidades: async (desde: number, hasta: number) => { await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'unidades', tarea: p.tarea, documento: p.documento, desde, hasta }); },
      ...(conversorCF(env) ? { convertir: conversorCF(env)! } : {}),
      alProgreso: emitir,
      emitir,
    };
  }

  async run(evento: Readonly<WorkflowEvent<ParamsIngesta>>, step: WorkflowStep): Promise<unknown> {
    const p = evento.payload;
    const inicio = Date.now();
    const estanteria = this.env.ESTANTERIA.getByName(p.usuario);
    const progreso = (fase: Progreso['fase'], avance: number, total: number, mensaje?: string): Progreso => ({
      tarea: p.tarea, documento: p.documento, fase, avance, total, transcurrido: Date.now() - inicio, ...(mensaje ? { mensaje } : {}),
    });

    try {
      if (soloVectores(p)) {
        const r = await step.do('revectorizar', { retries: REINTENTOS, timeout: '30 minutes' }, async () => {
          const ctx = await this.contexto(p);
          await ctx.emitir(progreso('vectores', 0, 0.1, 'Calculando vectores'));
          return revectorizar(ctx, p);
        });
        await step.do('cerrar', { retries: REINTENTOS }, async () => {
          await estanteria.cerrar({ id: p.usuario, plan: p.plan }, { tarea: p.tarea, documento: p.documento, ok: true, ...(r.vectoresPendientes ? { avisos: [{ codigo: 'vectores_pendientes', mensaje: 'Los vectores aún no están en el índice: ya se puede leer y buscar por texto, y la búsqueda semántica llegará en unos minutos.' }] } : {}) });
          if (r.vectoresPendientes) await this.env.COLA.send({ tipo: 'reindexar', usuario: p.usuario, documento: p.documento }, { delaySeconds: 120 });
        });
        return r;
      }

      const info: InfoPlan = await step.do('preparar', { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '30 minutes' }, async () => {
        const ctx = await this.contexto(p);
        await ctx.emitir(progreso('conversion', 0, 0.01, p.paquete ? 'Planificando la lectura' : 'Convirtiendo en el servidor'));
        // Latido mientras se convierte (el contenedor puede tardar): el vigilante no la da por parada.
        const latido = setInterval(() => { void ctx.emitir(progreso('conversion', 0.5, 0.02, 'Convirtiendo…')).catch(() => undefined); }, 60_000);
        try {
          const i = await preparar(ctx, p);
          // Cuota de páginas (o minutos) del mes: se consume antes de leer.
          const cuentas = cuentasDesdeEnv(this.env);
          if (!(await cuentas.consumir(p.usuario, p.plan, 'paginasMes', i.coste))) {
            throw new NonRetryableError(p.plan === 'gratis'
              ? `Este documento necesita ${i.coste} páginas de lectura y no te quedan suficientes este mes en el plan gratuito.`
              : `Este documento necesita ${i.coste} páginas de lectura y has llegado al máximo de tu plan este mes.`);
          }
          await ctx.emitir(progreso('lectura', 0, 0.03, `${i.unidades} unidades; ${i.pliegos.length} pliegos de visión`));
          return i;
        } catch (e) {
          if (e instanceof ErrorReserva) throw new NonRetryableError(e.message);
          throw e;
        } finally {
          clearInterval(latido);
        }
      });

      // Lectura y transcripción: un paso por pliego o tramo, todos a la vez.
      const total = info.pliegos.length + info.tramos.length;
      const contador = this.env.TAREA.getByName(`tarea:${p.usuario}:${p.tarea}`);
      const avisar = async (ctx: Awaited<ReturnType<FlujoIngesta['contexto']>>) => {
        const hechos = await contador.sumar('lectura');
        await ctx.emitir(progreso('lectura', hechos / Math.max(1, total), 0.03 + 0.22 * (hechos / Math.max(1, total)), `${hechos} de ${total}`));
      };
      // Como mucho OLEADA pasos a la vez: los pasos en paralelo de una instancia comparten aislamiento (128 MB).
      const OLEADA = 12;
      const pasosLectura: Array<() => Promise<unknown>> = [
        // La primera página, sola y la primera: se ve en unos segundos.
        ...(info.modo === 'paginas' && info.pliegos.length ? [() => step.do('primera-pagina', { retries: { limit: 2, delay: '2 seconds' }, timeout: '2 minutes' }, async () => leerPrimeraPagina(await this.contexto(p), p, info).catch(() => 0))] : []),
        ...info.pliegos.map((id) => () => step.do(`pliego-${id}`, { retries: REINTENTOS, timeout: '6 minutes' }, async () => {
          const t0 = Date.now();
          const ctx = await this.contexto(p);
          const t1 = Date.now();
          const n = await leerUnPliego(ctx, p, info, id);
          const t2 = Date.now();
          await avisar(ctx);
          console.log(JSON.stringify({ que: 'paso', paso: `pliego-${id}`, contexto: t1 - t0, leer: t2 - t1, avisar: Date.now() - t2 }));
          return n;
        })),
        ...info.tramos.map((n) => () => step.do(`tramo-${n}`, { retries: REINTENTOS, timeout: '12 minutes' }, async () => {
          const ctx = await this.contexto(p);
          const palabras = await transcribirUnTramo(ctx, p, info, n);
          await avisar(ctx);
          return palabras;
        })),
      ];
      await enParalelo(pasosLectura, OLEADA, (f) => f());

      const metadatosUsuario = await step.do('metadatos-usuario', async () => (await estanteria.metadatosSubida(p.documento)) ?? null);

      // El resto de fases, con las lecturas ya grabadas (no se repite ninguna).
      // Plazo a la medida del documento: si algo se cuelga, el reintento llega pronto
      // (la lectura ya está grabada, así que reintentar cuesta segundos).
      const plazo = Math.min(3600, 90 + 2 * info.unidades + 30 * info.tramos.length);
      const resumen = await step.do('componer', { retries: { limit: 4, delay: '5 seconds', backoff: 'exponential' }, timeout: `${plazo} seconds` }, async () => {
        const ctx = await this.contexto(p);
        return componer(ctx, p, info, metadatosUsuario as Record<string, unknown> | null);
      });

      // El original pudo seguir subiendo mientras se leía el paquete: se espera hasta 2 h.
      const bytesOriginal = (info.original ?? p.original) ? await step.do('original', { retries: { limit: 720, delay: '10 seconds', backoff: 'constant' } }, async () => {
        const cab = await almacenDesdeEnv(this.env, origenDe(this.env)).cabecera(info.original ?? p.original);
        if (!cab) throw new Error('El original aún no ha terminado de subir');
        return cab.bytes;
      }) : undefined;

      await step.do('cerrar', { retries: REINTENTOS }, async () => {
        await estanteria.cerrar({ id: p.usuario, plan: p.plan }, {
          ...(bytesOriginal ? { bytes: bytesOriginal } : {}),
          tarea: p.tarea, documento: p.documento, ok: true, original: info.original ?? p.original, bibliotecas: p.bibliotecas ?? [], unidades: resumen.unidades,
          ...(info.mime ? { mime: info.mime } : {}), ...(info.bytes ? { bytes: info.bytes } : {}),
          ...(resumen.vectoresPendientes ? { avisos: [{ codigo: 'vectores_pendientes', mensaje: 'Los vectores aún no están en el índice: ya se puede leer y buscar por texto, y la búsqueda semántica llegará en unos minutos.' }] } : {}),
          ...(metadatosUsuario ? { metadatosUsuario: metadatosUsuario as Record<string, unknown> } : {}),
        });
        await limpiarTrabajo(almacenDesdeEnv(this.env, origenDe(this.env)), p);
        if (resumen.vectoresPendientes) await this.env.COLA.send({ tipo: 'reindexar', usuario: p.usuario, documento: p.documento }, { delaySeconds: 120 });
      });
      return resumen;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      await step.do('fallo', { retries: { limit: 3, delay: '5 seconds' } }, async () => {
        await estanteria.cerrar({ id: p.usuario, plan: p.plan }, { tarea: p.tarea, documento: p.documento, ok: false, error: legible(mensaje) });
      });
      throw e;
    }
  }
}

/** Mensaje de error apto para la interfaz (sin pilas ni volcados de proveedor). */
function legible(m: string): string {
  if (/cancelad/i.test(m)) return 'Cancelada.';
  if (/cuota|páginas de lectura|plan/i.test(m)) return m;
  if (/navegador|YouTube|servidor|paquete|página respondió|texto que leer/i.test(m)) return m;
  return 'No he podido leer este documento. Vuelve a intentarlo; si sigue fallando, prueba a subirlo de nuevo.';
}
