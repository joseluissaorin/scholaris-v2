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
import { prepararTuberia, type InfoTuberia } from '../compartido/tuberia-plataforma.js';
import { componer, ErrorReserva, leerPrimeraPagina, leerUnPliego, limpiarTrabajo, preparar, revectorizar, soloVectores, transcribirUnTramo, type ContextoMotor, type InfoPlan } from '../compartido/motor-ingesta.js';
import type { Env } from './env.js';
import { SqlRemoto } from './sql.js';
import { almacenDesdeEnv, catalogosDesdeEnv, cuentasDesdeEnv, emisorDesdeEnv, geminiPara, indiceDesdeEnv, inteligenciaPara, origenDe } from './puertos-cf.js';
import { espacioNombresDe } from './indice-vectorize.js';
import { conversorCF } from './conversor.js';
import { adelantarMoov, esMp4 } from '../compartido/medio-rapido.js';

const REINTENTOS = { limit: 5, delay: '10 seconds', backoff: 'exponential' } as const;
/** Tandas a la vez (cada una en su trabajador, con su propio cupo de conexiones). */
const OLEADA = 24;

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
      catalogos: catalogosDesdeEnv(env, almacenDesdeEnv(env, origenDe(env))),
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

    // Pasos largos y callados (consolidar, revectorizar, esperar al original…): mientras trabajan,
    // le dicen al vigilante cada minuto que siguen vivos. Si no, a los 4 min los relanza y se repite todo.
    const tareaDO = this.env.TAREA.getByName(`tarea:${p.usuario}:${p.tarea}`);
    const vivo = (minutos = 3) => tareaDO.esperar(Date.now() + minutos * 60_000).catch(() => undefined);
    const conLatido = async <T>(fn: () => Promise<T>): Promise<T> => {
      await vivo();
      const latido = setInterval(() => { void vivo(); }, 60_000);
      try { return await fn(); } finally { clearInterval(latido); }
    };

    try {
      if (soloVectores(p)) {
        const r = await step.do('revectorizar', { retries: REINTENTOS, timeout: '30 minutes' }, async () => conLatido(async () => {
          const ctx = await this.contexto(p);
          await ctx.emitir(progreso('vectores', 0, 0.1, 'Calculando vectores'));
          return revectorizar(ctx, p);
        }));
        await step.do('cerrar', { retries: REINTENTOS }, async () => {
          await estanteria.cerrar({ id: p.usuario, plan: p.plan }, { tarea: p.tarea, documento: p.documento, ok: true, ...(r.vectoresPendientes ? { avisos: [{ codigo: 'vectores_pendientes', mensaje: 'Los vectores aún no están en el índice: ya se puede leer y buscar por texto, y la búsqueda semántica llegará en unos minutos.' }] } : {}) });
          if (r.vectoresPendientes) await this.env.COLA.send({ tipo: 'reindexar', usuario: p.usuario, documento: p.documento }, { delaySeconds: 120 });
        });
        return r;
      }

      const info: InfoTuberia = await step.do('preparar', { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '30 minutes' }, async () => {
        const ctx = await this.contexto(p);
        await ctx.emitir(progreso('conversion', 0, 0.01, p.paquete ? 'Planificando la lectura' : 'Convirtiendo en el servidor'));
        // Latido mientras se convierte (el contenedor puede tardar): el vigilante no la da por parada.
        const latido = setInterval(() => { void ctx.emitir(progreso('conversion', 0.5, 0.02, 'Convirtiendo…')).catch(() => undefined); }, 60_000);
        try {
          const i = await prepararTuberia(ctx, p);
          // Cuota de páginas (o minutos) del mes: se consume antes de leer.
          const cuentas = cuentasDesdeEnv(this.env);
          if (!(await cuentas.consumir(p.usuario, p.plan, 'paginasMes', i.coste))) {
            throw new NonRetryableError(p.plan === 'gratis'
              ? `Este documento necesita ${i.coste} páginas de lectura y no te quedan suficientes este mes en el plan gratuito.`
              : `Este documento necesita ${i.coste} páginas de lectura y has llegado al máximo de tu plan este mes.`);
          }
          await ctx.emitir(progreso('lectura', 0, 0.03, `${i.unidades} unidades en ${i.tandas.length} tandas`));
          return i;
        } catch (e) {
          if (e instanceof ErrorReserva) throw new NonRetryableError(e.message);
          throw e;
        } finally {
          clearInterval(latido);
        }
      });

      // Modo económico: lo difícil, a la API por lotes (mitad de precio); se espera durmiendo.
      if (info.economico) {
        const lote = await step.do('enviar-lote', { retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '30 minutes' }, async () =>
          conLatido(() => this.env.TRABAJADOR.getByName(`${p.tarea}:lote`).enviarLote(p, info)));
        if (lote) {
          for (let i = 0; i < 288; i++) {
            const minutos = i < 6 ? 2 : 5;
            // Avisar al vigilante de que esta espera es a propósito (si no, la relanza y paga otro lote).
            await step.do(`aviso-espera-${i}`, async () => { await this.env.TAREA.getByName(`tarea:${p.usuario}:${p.tarea}`).esperar(Date.now() + minutos * 60_000); });
            await step.sleep(`espera-lote-${i}`, `${minutos} minutes`);
            const r = await step.do(`recoger-lote-${i}`, { retries: { limit: 3, delay: '30 seconds' }, timeout: '10 minutes' }, async () =>
              this.env.TRABAJADOR.getByName(`${p.tarea}:lote`).recogerLote(p, info, lote));
            if (r.listo) break;
          }
        }
      }

      // Las tandas: cada una en su trabajador (su propio cupo de conexiones), muchas a la vez.
      // Al terminar cada una, sus páginas se pueden leer y su texto buscar.
      const contador = this.env.TAREA.getByName(`tarea:${p.usuario}:${p.tarea}`);
      const emisor = emisorDesdeEnv(this.env, p.usuario);
      const total = info.tandas.length;
      let vectoresPendientes = false;
      await enParalelo(info.tandas, OLEADA, (t) => step.do(`tanda-${t.id}`, { retries: REINTENTOS, timeout: '10 minutes' }, async () => {
        const r = await this.env.TRABAJADOR.getByName(`${p.tarea}:t${t.id}`).tanda(p, info, t.id);
        const hechos = await contador.sumar('tandas');
        const pr = progreso('lectura', hechos / Math.max(1, total), 0.03 + 0.67 * (hechos / Math.max(1, total)), `${hechos} de ${total}`);
        await estanteria.progreso({ ...pr, unidadesBuscables: undefined } as Progreso);
        await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'progreso', progreso: pr });
        return { legibles: r.legibles, vectoresPendientes: !!r.vectoresPendientes };
      }).then((r) => { if (r.vectoresPendientes) vectoresPendientes = true; }));

      const metadatosUsuario = await step.do('metadatos-usuario', async () => (await estanteria.metadatosSubida(p.documento)) ?? null);

      const plazo = Math.min(3600, 120 + 2 * info.unidades);
      const resumen = await step.do('consolidar', { retries: { limit: 4, delay: '5 seconds', backoff: 'exponential' }, timeout: `${plazo} seconds` }, async () => {
        await emisor.emitir(`usuario:${p.usuario}`, { tipo: 'progreso', progreso: progreso('indexado', 0, 0.72, 'Consolidando: folios, secciones y vectores') });
        return conLatido(() => this.env.TRABAJADOR.getByName(`${p.tarea}:consolidar`).consolidar(p, info));
      });
      if (resumen.vectoresPendientes) vectoresPendientes = true;

      // El original pudo seguir subiendo mientras se leía el paquete: se espera hasta 2 h.
      const bytesOriginal = (info.original ?? p.original) ? await step.do('original', { retries: { limit: 720, delay: '10 seconds', backoff: 'constant' } }, async () => {
        const cab = await almacenDesdeEnv(this.env, origenDe(this.env)).cabecera(info.original ?? p.original);
        // Esperar al navegador es legítimo: cada intento renueva el aviso al vigilante.
        if (!cab) { await vivo(2); throw new Error('El original aún no ha terminado de subir'); }
        return cab.bytes;
      }) : undefined;

      // MP4 con el índice al final: se pone delante para que suene al instante (lo que hace «ffmpeg -movflags +faststart»).
      const claveOriginal = info.original ?? p.original;
      const mimeOriginal = info.mime ?? p.mime;
      if (bytesOriginal && claveOriginal && esMp4(mimeOriginal, claveOriginal)) {
        await step.do('medio-rapido', { retries: { limit: 2, delay: '10 seconds' }, timeout: '15 minutes' }, async () => {
          await vivo(16);
          try { return (await adelantarMoov(almacenDesdeEnv(this.env, origenDe(this.env)), claveOriginal, mimeOriginal)).estado; }
          catch (e) { return `fallo: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200); }
        });
      }

      await step.do('cerrar', { retries: REINTENTOS }, async () => {
        await estanteria.cerrar({ id: p.usuario, plan: p.plan }, {
          ...(bytesOriginal ? { bytes: bytesOriginal } : {}),
          tarea: p.tarea, documento: p.documento, ok: true, original: info.original ?? p.original, bibliotecas: p.bibliotecas ?? [], unidades: resumen.unidades,
          ...(info.mime ? { mime: info.mime } : {}),
          ...(vectoresPendientes ? { avisos: [{ codigo: 'vectores_pendientes', mensaje: 'Los vectores aún no están en el índice: ya se puede leer y buscar por texto, y la búsqueda semántica llegará en unos minutos.' }] } : {}),
          ...(metadatosUsuario ? { metadatosUsuario: metadatosUsuario as Record<string, unknown> } : {}),
        });
        await limpiarTrabajo(almacenDesdeEnv(this.env, origenDe(this.env)), p);
        if (vectoresPendientes) await this.env.COLA.send({ tipo: 'reindexar', usuario: p.usuario, documento: p.documento }, { delaySeconds: 120 });
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
